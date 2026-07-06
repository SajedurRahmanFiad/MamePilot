
import React, { useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { db } from '../db';
import { BillStatus, Bill, Transaction } from '../types';
import { formatCurrency, ICONS, getPaymentStatusBadgeColor, getStatusColor } from '../constants';
import { theme } from '../theme';
import { useAccounts, useBill, useCompanySettings, useInvoiceSettings, useProductImagesByIds, useUser, useVendor } from '../src/hooks/useQueries';
import { useUpdateBill, useCreateTransaction } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { LoadingOverlay, CommonPaymentModal, Modal } from '../components';
import { getPreservedRouteState } from '../src/utils/navigation';
import { handlePrintBill } from '../src/utils/printUtils';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { buildLocalDateTime, getTodayDate } from '../utils';

const BillDetails: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const user = db.currentUser;
  const { canAccessRecord } = useRolePermissions();
  
  // Query data
  const { data: bill, isPending: billLoading, error: billError } = useBill(id || '');
  const { data: vendor } = useVendor(bill?.vendorId);
  const { data: createdByUser } = useUser(bill?.createdBy);
  const { data: accounts = [] } = useAccounts();
  const billItemProductIds = useMemo(
    () => Array.from(new Set((bill?.items || []).map((item) => String(item?.productId || '').trim()).filter(Boolean))),
    [bill?.items]
  );
  const { data: productImages = {} } = useProductImagesByIds(billItemProductIds);
  const { data: companySettings } = useCompanySettings();
  const { data: invoiceSettings } = useInvoiceSettings();
  
  // Mutations
  const updateMutation = useUpdateBill();
  const createTransactionMutation = useCreateTransaction();
  const toast = useToastNotifications();
  const isPaymentLoading = updateMutation.isPending || createTransactionMutation.isPending;
  
  const loading = billLoading;
  
  // Modal states
  const [isActionOpen, setIsActionOpen] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    date: getTodayDate(),
    time: new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false }),
    accountId: db.settings.defaults.defaultAccountId || '',
    amount: 0
  });

  const [expandedSection, setExpandedSection] = useState<Record<string, boolean>>({
    progress: true,
    payment: false,
  });
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completionOutcome, setCompletionOutcome] = useState<'Received' | 'Returned'>('Received');
  const [completionNote, setCompletionNote] = useState('');

  const isSectionExpanded = (section: string) => !!expandedSection[section];

  const toggleSection = (section: string) => {
    setExpandedSection((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };

  const openCompleteModal = () => {
    setCompletionOutcome('Received');
    setCompletionNote('');
    setShowCompleteModal(true);
  };

  const closeCompleteModal = () => {
    setShowCompleteModal(false);
  };

  type BillTimelineLabel = 'Created' | 'Processing' | 'Received' | 'Returned' | 'Cancelled';
  type BillTimelineItem = {
    label: BillTimelineLabel;
    historyKey: keyof Exclude<Bill['history'], undefined> | null;
    description: string;
  };

  const billProgressSteps = useMemo<BillTimelineItem[]>(
    () => [
      { label: 'Created', historyKey: 'created', description: 'Bill created and waiting to be processed.' },
      { label: 'Processing', historyKey: 'processing', description: 'Bill is currently under processing.' },
      { label: 'Received', historyKey: 'received', description: 'Bill has been marked as received.' },
      { label: 'Returned', historyKey: null, description: 'Bill has been returned.' },
      { label: 'Cancelled', historyKey: 'cancelled', description: 'Bill has been cancelled.' },
    ],
    []
  );

  const getBillProgressIndex = (currentBill?: Bill | null) => {
    if (!currentBill) return 0;
    const returnedHistory = (currentBill.history as Record<string, string | undefined>)?.returned;
    const cancelledHistory = (currentBill.history as Record<string, string | undefined>)?.cancelled;
    if (returnedHistory) {
      return billProgressSteps.findIndex((item) => item.label === 'Returned');
    }
    if (cancelledHistory) {
      return billProgressSteps.findIndex((item) => item.label === 'Cancelled');
    }
    if (currentBill.status === BillStatus.PAID || currentBill.status === BillStatus.RECEIVED) {
      return billProgressSteps.findIndex((item) => item.label === 'Received');
    }
    if (currentBill.status === BillStatus.PROCESSING) {
      return billProgressSteps.findIndex((item) => item.label === 'Processing');
    }
    return billProgressSteps.findIndex((item) => item.label === 'Created');
  };

  const billProgressIndex = getBillProgressIndex(bill);

  const getBillProgressPercent = (activeBill?: Bill | null) => {
    if (!activeBill) return 0;
    const returnedHistory = (activeBill.history as Record<string, string | undefined>)?.returned;
    const cancelledHistory = (activeBill.history as Record<string, string | undefined>)?.cancelled;
    if (returnedHistory || cancelledHistory) return 100;
    if (activeBill.status === BillStatus.PAID || activeBill.status === BillStatus.RECEIVED) return 100;

    const finalStepIndex = billProgressSteps.findIndex((item) => item.label === 'Received');
    const stepIndex = getBillProgressIndex(activeBill);
    return Math.round((stepIndex / Math.max(1, finalStepIndex)) * 100);
  };

  const billProgressPercent = getBillProgressPercent(bill);

  const getFinalBranchStatus = (currentBill?: Bill | null) => {
    if (!currentBill) return null;
    const returnedHistory = (currentBill.history as Record<string, string | undefined>)?.returned;
    const cancelledHistory = (currentBill.history as Record<string, string | undefined>)?.cancelled;
    if (returnedHistory) return 'Returned' as BillTimelineLabel;
    if (cancelledHistory) return 'Cancelled' as BillTimelineLabel;
    if (currentBill.status === BillStatus.PAID || currentBill.status === BillStatus.RECEIVED) return 'Received' as BillTimelineLabel;
    return null;
  };

  const parseHistoryTimestamp = (value?: string | null) => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const candidates: string[] = [raw];
    const onAtMatch = raw.match(/on\s+(.+?)(?:,\s*at\s*|\s+at\s*)(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|a\.m\.|p\.m\.))?)/i);
    if (onAtMatch) {
      const datePart = onAtMatch[1].trim();
      const timePart = onAtMatch[2].trim().replace(/\./g, '');
      candidates.push(`${datePart} ${timePart}`);
      candidates.push(`${datePart}, ${timePart}`);
    }

    const isoMatch = raw.match(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/);
    if (isoMatch) {
      candidates.push(isoMatch[0]);
    }

    for (const candidate of candidates) {
      const parsed = new Date(candidate);
      if (!Number.isNaN(parsed.getTime())) return parsed;
    }

    return null;
  };

  const formatStatusTimestamp = (date: Date) => {
    const now = new Date();
    const local = new Date(date);
    const isToday = local.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = local.toDateString() === yesterday.toDateString();

    const time = local.toLocaleTimeString('en-BD', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });

    if (isToday) return time;
    if (isYesterday) return `Yesterday, ${time}`;
    return `${local.toLocaleDateString('en-BD', { day: 'numeric', month: 'short' })}, ${time}`;
  };

  const getTimelineLabel = (item: BillTimelineItem, index: number) => {
    if (index === billProgressIndex) {
      switch (item.label) {
        case 'Created':
          return 'Created';
        case 'Processing':
          return 'Processing';
        case 'Received':
          return bill.status === BillStatus.RECEIVED || bill.status === BillStatus.PAID ? 'Received' : 'Receiving';
        case 'Returned':
          return getFinalBranchStatus(bill) === 'Returned' ? 'Returned' : 'Returning';
        case 'Cancelled':
          return getFinalBranchStatus(bill) === 'Cancelled' ? 'Cancelled' : 'Cancelling';
        default:
          return item.label;
      }
    }

    if (index < billProgressIndex) {
      return item.label;
    }

    if (index > billProgressIndex) {
      switch (item.label) {
        case 'Processing':
          return 'Process';
        case 'Received':
          return 'Receive';
        case 'Returned':
          return 'Return';
        case 'Cancelled':
          return 'Cancel';
        default:
          return item.label;
      }
    }

    return item.label;
  };

  const getStatusSuffix = (item: BillTimelineItem, index: number) => {
    if (index > billProgressIndex) {
      return '';
    }

    const rawValue = (() => {
      switch (item.label) {
        case 'Created':
          return bill.createdAt || bill.history?.created;
        case 'Processing':
          return bill.processedAt || bill.history?.processing;
        case 'Received':
          return bill.receivedAt || bill.history?.received;
        case 'Returned':
          return (bill.history as Record<string, string | undefined>)?.returned;
        case 'Cancelled':
          return bill.history?.cancelled;
        default:
          return '';
      }
    })();

    const parsed = parseHistoryTimestamp(rawValue);
    if (parsed) {
      return ` (${formatStatusTimestamp(parsed)})`;
    }

    return '';
  };

  const getNextStatusTransitionCTA = () => {
    const isCancelled = Boolean((bill.history as Record<string, string | undefined>)?.cancelled);
    if (isCancelled) return null;

    if (bill.status === BillStatus.ON_HOLD && canMoveCurrentBillToProcessing) {
      return (
        <div className="pt-4">
          <button
            type="button"
            disabled={!canMoveCurrentBillToProcessing}
            onClick={markProcessing}
            className={`w-full rounded-xl py-3 text-sm font-bold transition ${canMoveCurrentBillToProcessing ? `${theme.colors.primary[600]} text-white hover:${theme.colors.primary[700]}` : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
          >
            Mark as Processing
          </button>
        </div>
      );
    }

    if (bill.status === BillStatus.PROCESSING && canMarkCurrentBillReceived) {
      return (
        <div className="pt-4">
          <button
            type="button"
            disabled={!canMarkCurrentBillReceived}
            onClick={openCompleteModal}
            className={`w-full rounded-xl py-3 text-sm font-bold transition ${canMarkCurrentBillReceived ? `${theme.colors.primary[600]} text-white hover:${theme.colors.primary[700]}` : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
          >
            Complete
          </button>
        </div>
      );
    }

    return null;
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading bill...</div>;
  if (billError || !bill) return <div className="p-8 text-center text-gray-500">{billError?.message || 'Bill not found.'}</div>;
  if (!user) return <div className="p-8 text-center text-gray-500">Not authenticated.</div>;
  const canEditCurrentBill = canAccessRecord(bill.createdBy, 'bills.editOwn', 'bills.editAny');
  const canMoveCurrentBillToProcessing = canAccessRecord(
    bill.createdBy,
    'bills.moveOnHoldToProcessingOwn',
    'bills.moveOnHoldToProcessingAny',
  );
  const canMarkCurrentBillReceived = canAccessRecord(
    bill.createdBy,
    'bills.markReceivedOwn',
    'bills.markReceivedAny',
  );
  const canMarkCurrentBillPaid = canAccessRecord(bill.createdBy, 'bills.markPaidOwn', 'bills.markPaidAny');
  const canCancelCurrentBill = canAccessRecord(bill.createdBy, 'bills.cancelOwn', 'bills.cancelAny');

  // Calculate payment status
  const getPaymentStatus = () => {
    const dueAmount = bill.total - bill.paidAmount;
    if (bill.paidAmount === 0) return 'Unpaid';
    if (dueAmount > 0) return 'Partially Paid';
    if (dueAmount === 0) return 'Paid';
    if (dueAmount < 0) return 'Overpaid';
    return 'Unpaid';
  };

  const updateStatus = async (newStatus: BillStatus, historyKey?: keyof Exclude<Bill['history'], undefined>, historyText?: string) => {
    if (!bill) return;
    try {
      const updates = { 
        ...bill, 
        status: newStatus, 
        history: historyKey ? { ...bill.history, [historyKey]: historyText } : bill.history
      };
      await updateMutation.mutateAsync({ id: id!, updates });
      setIsActionOpen(false);
    } catch (err) {
      console.error('Failed to update bill status:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to update bill status');
    }
  };

  const markProcessing = async () => {
    if (!canMoveCurrentBillToProcessing) {
      toast.error('You do not have permission to move bills to processing.');
      return;
    }
    const historyText = `Marked as processing by ${user.name}, on ${new Date().toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })}`;
    await updateStatus(BillStatus.PROCESSING, 'processing', historyText);
  };

  const completeBill = async () => {
    if (!canMarkCurrentBillReceived) {
      toast.error('You do not have permission to complete bills.');
      return;
    }

    const historyText = `Marked as ${completionOutcome.toLowerCase()} by ${user.name}, on ${new Date().toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })}`;
    const newStatus = completionOutcome === 'Returned' ? BillStatus.ON_HOLD : BillStatus.RECEIVED;
    const historyKey = completionOutcome === 'Returned' ? 'returned' : 'received';

    await updateStatus(newStatus, historyKey as keyof Exclude<Bill['history'], undefined>, historyText);
    closeCompleteModal();
  };

  const cancelBill = async () => {
    if (!canCancelCurrentBill) {
      toast.error('You do not have permission to cancel bills.');
      return;
    }
    const historyText = `Reverted/cancelled by ${user.name}, on ${new Date().toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })}`;
    await updateStatus(BillStatus.ON_HOLD, 'cancelled', historyText);
  };

  const handlePayment = async () => {
    if (!bill) return;
    if (!canMarkCurrentBillPaid) {
      toast.error('You do not have permission to record bill payments.');
      return;
    }
    try {
      if (!paymentForm.accountId) {
        toast.error('Please select an account');
        return;
      }

      const updatedPaid = bill.paidAmount + paymentForm.amount;
      
      // Determine if bill is fully paid
      const isFullyPaid = updatedPaid >= bill.total;
      const newStatus = isFullyPaid ? BillStatus.PAID : bill.status;
      
      // Compose ISO datetime from date and time
      const fullDatetime = buildLocalDateTime(paymentForm.date, paymentForm.time);
      if (!fullDatetime) {
        toast.error('Please enter a valid payment date and time');
        return;
      }
      const isoDatetime = fullDatetime.toISOString();
      const historyText = `Payment of ${formatCurrency(paymentForm.amount)} received by ${user.name} on ${fullDatetime.toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${fullDatetime.toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })}`;
      
      const updatedBill = { 
        ...bill, 
        paidAmount: updatedPaid,
        status: newStatus,
        history: { ...bill.history, paid: historyText },
        paidAt: isoDatetime
      };

      const expenseTxn: Transaction = {
        id: Math.random().toString(36).substr(2, 9),
        date: isoDatetime,
        type: 'Expense',
        category: db.settings.defaults.expenseCategoryId || 'expense_purchases',
        accountId: paymentForm.accountId,
        amount: paymentForm.amount,
        description: `Payment for Bill #${bill.billNumber}`,
        referenceId: bill.id,
        contactId: bill.vendorId,
        paymentMethod: db.settings.defaults.defaultPaymentMethod || 'Cash',
        createdBy: user.id
      };
      const createdTransaction = await createTransactionMutation.mutateAsync(expenseTxn as any);

      await updateMutation.mutateAsync({ id: id!, updates: updatedBill });

      setShowPaymentModal(false);
      if (createdTransaction.approvalStatus === 'pending') {
        toast.info('Bill payment was recorded, and the expense transaction is waiting for admin approval.');
      } else {
        toast.success('Payment recorded successfully');
      }
    } catch (err) {
      console.error('Failed to record payment:', err);
      toast.error('Failed to record payment');
    }
  };

  const openPayment = () => {
    if (!bill) return;
    if (!canMarkCurrentBillPaid) {
      toast.error('You do not have permission to record bill payments.');
      return;
    }
    setPaymentForm({
      date: getTodayDate(),
      time: new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false }),
      accountId: db.settings.defaults.defaultAccountId || '',
      amount: bill.total - bill.paidAmount
    });
    setShowPaymentModal(true);
  };

  const canShowActionsMenu =
    canEditCurrentBill
    || canCancelCurrentBill;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <LoadingOverlay isLoading={loading && !bill} message="Loading bill details..." />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => {
            const navState = getPreservedRouteState(location.state);
            if (navState.backMode === 'history' && window.history.length > 1) {
              navigate(-1);
              return;
            }

            if (navState.from) {
              navigate(navState.from);
              return;
            }

            navigate('/bills');
          }} className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 text-gray-500 transition-all">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          </button>
          <h2 className="text-md md:text-lg font-bold text-gray-900">#{bill.billNumber}</h2>
          <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${getStatusColor(bill.status)}`}>
            {bill.status}
          </span>
        </div>
        <div className="flex items-center gap-2 relative">
          <button onClick={() => handlePrintBill(id!, navigate)} className="hidden md:flex items-center gap-2 px-4 py-2 text-sm font-semibold border rounded-lg bg-white hover:bg-gray-50 transition-all">
            {ICONS.Print} Print Bill
          </button>
          {canShowActionsMenu && (
            <div className="relative">
              <button 
                onClick={() => setIsActionOpen(!isActionOpen)}
                className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold border rounded-lg ${theme.colors.primary[600]} text-white hover:${theme.colors.primary[700]} transition-all shadow-md`}
              >
                {ICONS.More} <span className="hidden md:inline">Actions</span>
              </button>
              {isActionOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsActionOpen(false)}></div>
                  <div className="absolute right-0 mt-2 w-48 bg-white border rounded-xl shadow-xl z-50 py-2">
                    <button onClick={() => { handlePrintBill(id!, navigate); setIsActionOpen(false); }} className="md:hidden w-full text-left px-4 py-2 text-sm hover:bg-gray-50">Print Bill</button>
                    <div className="md:hidden border-t my-1"></div>
                    {canCancelCurrentBill && <button disabled={bill.status === BillStatus.PAID || bill.status === BillStatus.ON_HOLD} onClick={() => { cancelBill(); setIsActionOpen(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-red-50 disabled:hover:bg-gray-50 flex items-center gap-2 text-red-600 font-bold disabled:text-gray-300 disabled:cursor-not-allowed">{ICONS.Close} Cancel Bill</button>}
                    {canEditCurrentBill && <button onClick={() => { navigate(`/bills/edit/${bill.id}`); setIsActionOpen(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-gray-700">{ICONS.Edit} Edit Bill</button>}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-3 sm:p-4 md:p-6 lg:p-8 space-y-6 sm:space-y-8">
            <div className="flex flex-row justify-between items-start gap-3 sm:gap-4">
              <div className="min-w-0">
                {(companySettings?.logo || db.settings.company.logo) && (
                  <img 
                    src={companySettings?.logo || db.settings.company.logo} 
                    className="rounded-lg object-cover mb-2 sm:mb-3 lg:mb-4 w-auto h-auto"
                    style={{ 
                      maxWidth: 'min(100px, 20%)',
                      maxHeight: 'auto'
                    }}
                  />
                )}
                <h1 className="text-sm sm:text-base lg:text-xl font-black text-blue-600 uppercase tracking-tighter break-words">{companySettings?.name || db.settings.company.name}</h1>
                <div className="mt-1 sm:mt-2 text-[9px] sm:text-[10px] lg:text-xs text-gray-400 font-medium space-y-0.5 sm:space-y-1">
                  <p className="break-words">{companySettings?.address || db.settings.company.address}</p>
                  <p className="text-[8px] sm:text-[9px] break-words">{companySettings?.phone || db.settings.company.phone} • {companySettings?.email || db.settings.company.email}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <h2 className="text-sm sm:text-2xl lg:text-3xl font-black text-gray-300 uppercase leading-none mb-1 sm:mb-2 break-words">{invoiceSettings?.title || db.settings.invoice.title}</h2>
                <div className="space-y-0.5 sm:space-y-1 lg:space-y-1.5 text-[9px] sm:text-sm">
                  <p className="text-[9px] sm:text-sm font-bold text-gray-900 break-words">Bill No: #{bill.billNumber}</p>
                  <p className="text-[9px] sm:text-sm text-gray-500">{bill.billDate}</p>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100 py-2 sm:py-3 lg:py-4">
              <p className="text-[8px] sm:text-[9px] lg:text-[10px] font-black text-gray-400 uppercase tracking-[0.15em] sm:tracking-[0.2em] mb-2 sm:mb-3 lg:mb-4">Bill From (Vendor)</p>
              <h3 className="text-sm sm:text-base lg:text-lg font-black text-gray-900 break-words">{vendor?.name}</h3>
              <p className="text-[10px] sm:text-xs lg:text-sm text-gray-500 leading-relaxed break-words">{vendor?.address}</p>
              <p className="text-[10px] sm:text-xs lg:text-sm font-bold text-cyan-600 mt-1 sm:mt-1.5 lg:mt-2 break-words">{vendor?.phone}</p>
            </div>

            <div className="overflow-x-auto -mx-3 sm:-mx-4 md:-mx-6 lg:-mx-10">
              <div className="px-3 sm:px-4 md:px-6 lg:px-10">
                <table className="w-full text-left text-[10px] sm:text-xs lg:text-sm">
                  <thead>
                    <tr className="border-b-2 border-gray-100">
                      <th className="py-2 sm:py-3 lg:py-4 font-black text-gray-400 uppercase">Description</th>
                      <th className="py-2 sm:py-3 lg:py-4 text-center font-black text-gray-400 uppercase whitespace-nowrap px-1">Cost</th>
                      <th className="py-2 sm:py-3 lg:py-4 text-center font-black text-gray-400 uppercase whitespace-nowrap px-1">Qty</th>
                      <th className="py-2 sm:py-3 lg:py-4 text-right font-black text-gray-400 uppercase whitespace-nowrap px-1">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {bill.items.map((item, idx) => {
                      const imageSrc = productImages[String(item.productId || '').trim()] || '';
                      return (
                        <tr key={idx} className="group">
                          <td className="py-3 sm:py-4 lg:py-6">
                            <div className="flex items-center gap-2 sm:gap-3 lg:gap-4 min-w-0">
                              {imageSrc ? (
                                <img src={imageSrc} className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 rounded-full object-cover border border-gray-100 shadow-sm flex-shrink-0" alt={item.productName} />
                              ) : (
                                <div className="w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 rounded-full border border-gray-100 shadow-sm bg-gray-50 text-gray-400 text-xs flex items-center justify-center flex-shrink-0">
                                  {(item.productName || '?').slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <span className="font-bold text-gray-900 text-[10px] sm:text-xs lg:text-base break-words">{item.productName}</span>
                            </div>
                          </td>
                          <td className="py-3 sm:py-4 lg:py-6 text-center text-gray-500 font-bold px-1 whitespace-nowrap">{formatCurrency(item.rate)}</td>
                          <td className="py-3 sm:py-4 lg:py-6 text-center text-gray-500 font-bold px-1 whitespace-nowrap">{item.quantity}</td>
                          <td className="py-3 sm:py-4 lg:py-6 text-right font-black text-gray-900 px-1 whitespace-nowrap">{formatCurrency(item.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

           <div className="flex flex-col items-end pt-2 sm:pt-3 lg:pt-6 px-0">
              <div className="w-full sm:w-full md:w-98 lg:max-w-xs space-y-2 sm:space-y-3 lg:space-y-4">
                <div className="flex justify-between text-[10px] sm:text-xs lg:text-sm gap-2">
                  <span className="text-gray-400 font-bold uppercase flex-shrink-0">Subtotal</span>
                  <span className="font-bold text-gray-900 flex-shrink-0">{formatCurrency(bill.subtotal)}</span>
                </div>
                <div className="flex justify-between text-[10px] sm:text-xs lg:text-sm gap-2">
                  <span className="text-gray-400 font-bold uppercase flex-shrink-0">Discount</span>
                  <span className="font-bold text-emerald-600 flex-shrink-0">-{formatCurrency(bill.discount)}</span>
                </div>
                <div className="flex justify-between text-[10px] sm:text-xs lg:text-sm gap-2">
                  <span className="text-gray-400 font-bold uppercase flex-shrink-0">Shipping</span>
                  <span className="font-bold text-gray-900 flex-shrink-0">{formatCurrency(bill.shipping)}</span>
                </div>
                <div className="flex justify-between items-center py-2 sm:py-3 lg:py-4 border-t-2 border-[#0f2f57] gap-2">
                  <span className="font-black text-gray-900 uppercase tracking-tighter text-xs sm:text-base lg:text-base flex-shrink-0">Total Payable</span>
                  <span className="font-black text-gray-900 text-xs sm:text-base lg:text-base flex-shrink-0">{formatCurrency(bill.total)}</span>
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Sidebar Payment & Lifecycle Sections */}
        <div className="space-y-6">
          {/* Payment Section */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden">
            <button
              type="button"
              className="w-full px-5 py-4 bg-gray-50 border-b flex justify-between items-center text-left"
              onClick={() => toggleSection('payment')}
              aria-expanded={isSectionExpanded('payment')}
            >
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest flex items-center gap-2">
                  Payment
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${getPaymentStatusBadgeColor(getPaymentStatus())}`}>
                    {getPaymentStatus()}
                  </span>
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <div className={`p-1 rounded-full ${theme.colors.primary[50]} ${theme.colors.primary.text}`}>{ICONS.Banking}</div>
                <div className={`transition-transform duration-200 ${isSectionExpanded('payment') ? 'rotate-90' : ''}`}>
                  {ICONS.ChevronRight}
                </div>
              </div>
            </button>
            {isSectionExpanded('payment') && (
              <div className="p-5 space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center py-2">
                    <span className="text-xs text-gray-500 font-medium">Total Amount</span>
                    <span className="font-bold text-gray-900">{formatCurrency(bill.total)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-t border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">Received</span>
                    <span className="font-bold text-emerald-600">{formatCurrency(bill.paidAmount)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-t border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">Due Amount</span>
                    <span className={`font-bold ${bill.total - bill.paidAmount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {formatCurrency(Math.max(bill.total - bill.paidAmount, 0))}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-t border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">Refunded</span>
                    <span className="font-bold text-orange-600">{formatCurrency(0)}</span>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <button
                    onClick={openPayment}
                    disabled={!canMarkCurrentBillPaid || bill.paidAmount >= bill.total}
                    className={`w-full py-2.5 ${theme.colors.primary[600]} hover:${theme.colors.primary[700]} text-white font-bold rounded-lg shadow-md transition-all active:scale-95 text-sm disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    Add Payment
                  </button>
                  <button
                    type="button"
                    className="w-full py-2.5 border border-orange-200 text-orange-600 hover:bg-orange-50 font-bold rounded-lg transition-all active:scale-95 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Issue Refund
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Progress Section */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden">
            <button
              type="button"
              className="w-full px-5 py-4 bg-gray-50 border-b flex justify-between items-center text-left"
              onClick={() => toggleSection('progress')}
              aria-expanded={isSectionExpanded('progress')}
            >
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">
                Progress ({billProgressPercent}%)
              </h3>
              <div className="flex items-center gap-2">
                <div className={`p-1 rounded-full ${bill.status !== BillStatus.ON_HOLD ? 'bg-white text-black' : 'bg-gray-200 text-gray-400'}`}>
                  {ICONS.Check}
                </div>
                <div className={`transition-transform duration-200 ${isSectionExpanded('progress') ? 'rotate-90' : ''}`}>
                  {ICONS.ChevronRight}
                </div>
              </div>
            </button>
            {isSectionExpanded('progress') && (
              <div className="p-4 space-y-3">
                <div>
                  <div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                    <span>Progress</span>
                    <span>{billProgressPercent}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${billProgressPercent}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-0.5">
                  {billProgressSteps.map((item, index) => {
                    const branchStatus = getFinalBranchStatus(bill);
                    const isBranchItem = item.label === 'Received' || item.label === 'Returned' || item.label === 'Cancelled';
                    const isUnavailableBranch = Boolean(branchStatus && isBranchItem && item.label !== branchStatus);
                    const isActive = index === billProgressIndex;
                    const isPast = !isBranchItem && index < billProgressIndex;
                    const isCompleted = isPast || (isActive && isBranchItem);

                    return (
                      <div
                        key={item.label}
                        className={`flex w-full items-center gap-2 rounded-lg px-3 py-1 text-left ${isActive ? 'bg-emerald-50' : ''}`}
                      >
                        <div className="flex h-5 w-5 items-center justify-center">
                          {isCompleted ? (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-200 text-emerald-800">
                              {ICONS.Check}
                            </span>
                          ) : isActive ? (
                            <span className="flex h-3.5 w-3.5 rounded-full bg-emerald-600 shadow-emerald-600/30 animate-pulse" />
                          ) : (
                            <span className="mx-auto h-2.5 w-2.5 rounded-full bg-gray-300" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={`text-sm font-semibold ${isUnavailableBranch ? 'text-gray-400 line-through' : isCompleted ? 'text-emerald-700' : isActive ? 'text-gray-900' : 'text-gray-500'}`}>
                            {getTimelineLabel(item, index)}
                            <span className={`text-xs font-medium ${isUnavailableBranch ? 'text-gray-400' : 'text-gray-500'}`}>{getStatusSuffix(item, index)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {getNextStatusTransitionCTA()}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Activity Timeline Section - Full Width */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 bg-gray-50 border-b">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">Activity Timeline</h3>
        </div>
        <div className="p-5 space-y-4">
          {bill.history?.created && (
            <div className="flex gap-3 pb-4 border-b border-gray-100">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-100">
                  {ICONS.Plus}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500 leading-relaxed font-medium">{bill.history.created}</p>
              </div>
            </div>
          )}
          
          {bill.history?.processing && (
            <div className="flex gap-3 pb-4 border-b border-gray-100">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-blue-100">
                  {ICONS.ChevronRight}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-700 leading-relaxed font-bold">{bill.history.processing}</p>
              </div>
            </div>
          )}

          {bill.history?.received && (
            <div className="flex gap-3 pb-4 border-b border-gray-100">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-emerald-100">
                  {ICONS.Check}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-emerald-700 leading-relaxed font-bold">{bill.history.received}</p>
              </div>
            </div>
          )}

          {bill.history?.returned && (
            <div className="flex gap-3 pb-4 border-b border-gray-100">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-orange-100">
                  {ICONS.Close}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-orange-700 leading-relaxed font-bold">{bill.history.returned}</p>
              </div>
            </div>
          )}

          {bill.history?.paid && (
            <div className="flex gap-3 pb-4 border-b border-gray-100">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-emerald-100">
                  {ICONS.Banking}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-emerald-700 leading-relaxed font-bold">{bill.history.paid}</p>
              </div>
            </div>
          )}

          {bill.history?.cancelled && (
            <div className="flex gap-3">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-red-100">
                  {ICONS.Close}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-red-700 leading-relaxed font-bold">{bill.history.cancelled}</p>
              </div>
            </div>
          )}

          {!bill.history?.created && !bill.history?.processing && !bill.history?.received && !bill.history?.paid && !bill.history?.cancelled && (
            <p className="text-xs text-gray-400 text-center py-4">No activity recorded yet</p>
          )}
        </div>
      </div>

      {/* Payment Modal */}
      <CommonPaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSubmit={handlePayment}
        accounts={accounts}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        isLoading={isPaymentLoading}
        title="Record Payment"
        buttonText="Add Payment"
      />

      <Modal
        isOpen={showCompleteModal}
        onClose={closeCompleteModal}
        title={`Complete bill #${bill.billNumber}`}
        size="md"
      >
        <div className="space-y-6">
          <p className="text-sm text-gray-600">Choose how to finalize this bill.</p>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Outcome</label>
            <select
              value={completionOutcome}
              onChange={(event) => setCompletionOutcome(event.target.value as 'Received' | 'Returned')}
              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#3c5a82]"
            >
              <option value="Received">Received</option>
              <option value="Returned">Returned</option>
            </select>
          </div>

          {completionOutcome === 'Returned' && (
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Return note</label>
              <textarea
                value={completionNote}
                onChange={(event) => setCompletionNote(event.target.value)}
                rows={4}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#3c5a82]"
                placeholder="Enter a note for the returned bill"
              />
            </div>
          )}

          <div className="flex gap-3 justify-end pt-4">
            <button
              type="button"
              onClick={closeCompleteModal}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={completeBill}
              className="rounded-lg bg-[#0f2f57] px-4 py-2 text-sm font-bold text-white hover:bg-[#112f60]"
            >
              {completionOutcome === 'Returned' ? 'Mark Returned' : 'Mark Received'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default BillDetails;

