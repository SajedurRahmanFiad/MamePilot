
import React, { useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { db } from '../db';
import { BillStatus, Bill, type ProcessBillReturnPayload } from '../types';
import { formatCurrency, ICONS, getPaymentStatusBadgeColor, getPaymentStatusLabel, getStatusColor } from '../constants';
import { theme, resolveThemeColorPalette } from '../theme';
import { useAccounts, useBill, useCompanySettings, useInvoiceSettings, useProductImagesByIds, useUser, useVendor, useSystemDefaults, usePaymentMethods, useCategories } from '../src/hooks/useQueries';
import { useUpdateBill, useProcessBillReturn } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { LoadingOverlay, CommonPaymentModal, BillReturnModal } from '../components';
import { getPreservedRouteState } from '../src/utils/navigation';
import { handlePrintBill } from '../src/utils/printUtils';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { buildLocalDateTime, formatDate, formatDateTimeParts, getTodayDate } from '../utils';

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
  const { data: systemDefaults } = useSystemDefaults();
  const { data: paymentMethods = [] } = usePaymentMethods();
  const { data: categories = [] } = useCategories('Income');
  const themeColorHex = useMemo(() => {
    const tc = systemDefaults?.themeColor || db.settings.defaults?.themeColor || '#0f2f57';
    return resolveThemeColorPalette(tc).primary;
  }, [systemDefaults?.themeColor]);
  const invoiceLogoWidth = Math.max(0, Number(invoiceSettings?.logoWidth || db.settings.invoice.logoWidth));
  const invoiceLogoHeight = Math.max(0, Number(invoiceSettings?.logoHeight || db.settings.invoice.logoHeight));
  const invoiceLogoStyle = {
    '--details-logo-mobile-width': `${Math.round(invoiceLogoWidth * 0.6)}px`,
    '--details-logo-mobile-height': `${Math.round(invoiceLogoHeight * 0.6)}px`,
    '--details-logo-tablet-width': `${Math.round(invoiceLogoWidth * 0.8)}px`,
    '--details-logo-tablet-height': `${Math.round(invoiceLogoHeight * 0.8)}px`,
    '--details-logo-width': `${invoiceLogoWidth}px`,
    '--details-logo-height': `${invoiceLogoHeight}px`,
  } as React.CSSProperties;
  
  // Mutations
  const updateMutation = useUpdateBill();
  const processBillReturnMutation = useProcessBillReturn();
  const toast = useToastNotifications();
  const isPaymentLoading = updateMutation.isPending;
  
  const loading = billLoading;
  
  // Modal states
  const [isActionOpen, setIsActionOpen] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    date: getTodayDate(),
    time: new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false }),
    accountId: db.settings.defaults.defaultAccountId || '',
    amount: 0
  });
  const [refundForm, setRefundForm] = useState({
    date: getTodayDate(),
    time: new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false }),
    accountId: db.settings.defaults.defaultAccountId || '',
    amount: 0,
  });

  const [expandedSection, setExpandedSection] = useState<Record<string, boolean>>({
    progress: true,
    payment: false,
  });
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [completionOutcome, setCompletionOutcome] = useState<'Received' | 'Returned'>('Received');
  const [completionNote, setCompletionNote] = useState('');
  const [completionAccountId, setCompletionAccountId] = useState('');
  const [completionPaymentMethod, setCompletionPaymentMethod] = useState('');
  const [completionCategoryId, setCompletionCategoryId] = useState('');

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
    setCompletionAccountId(systemDefaults?.defaultAccountId || accounts[0]?.id || '');
    setCompletionPaymentMethod(systemDefaults?.defaultPaymentMethod || paymentMethods[0]?.name || '');
    setCompletionCategoryId(categories[0]?.id || '');
    setShowCompleteModal(true);
  };

  const closeCompleteModal = () => {
    setShowCompleteModal(false);
  };

  type BillTimelineLabel = 'Created' | 'Processing' | 'Received' | 'Exchanged' | 'Returned' | 'Cancelled';
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
      { label: 'Exchanged', historyKey: 'received', description: 'Bill has been received with exchanged items.' },
      { label: 'Returned', historyKey: null, description: 'Bill has been returned.' },
      { label: 'Cancelled', historyKey: 'cancelled', description: 'Bill has been cancelled.' },
    ],
    []
  );

  const hasExchangedItems = (b?: Bill | null) =>
    Boolean(b?.items?.some((item) => (item.exchangedQty ?? 0) > 0));

  const getBillProgressIndex = (currentBill?: Bill | null) => {
    if (!currentBill) return 0;
    const returnedHistory = (currentBill.history as Record<string, string | undefined>)?.returned;
    const cancelledHistory = (currentBill.history as Record<string, string | undefined>)?.cancelled;
    if (currentBill.status === BillStatus.RETURNED || returnedHistory) {
      return billProgressSteps.findIndex((item) => item.label === 'Returned');
    }
    if (currentBill.status === BillStatus.CANCELLED || cancelledHistory) {
      return billProgressSteps.findIndex((item) => item.label === 'Cancelled');
    }
    if (currentBill.status === BillStatus.PAID || currentBill.status === BillStatus.RECEIVED) {
      return billProgressSteps.findIndex((item) => item.label === (hasExchangedItems(currentBill) ? 'Exchanged' : 'Received'));
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
    if (activeBill.status === BillStatus.RETURNED || activeBill.status === BillStatus.CANCELLED || returnedHistory || cancelledHistory) return 100;
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
    if (currentBill.status === BillStatus.RETURNED || returnedHistory) return 'Returned' as BillTimelineLabel;
    if (currentBill.status === BillStatus.CANCELLED || cancelledHistory) return 'Cancelled' as BillTimelineLabel;
    if (currentBill.status === BillStatus.PAID || currentBill.status === BillStatus.RECEIVED) {
      return (hasExchangedItems(currentBill) ? 'Exchanged' : 'Received') as BillTimelineLabel;
    }
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
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const local = new Date(date);
    const isToday = local.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday = local.toDateString() === yesterday.toDateString();

    const { time } = formatDateTimeParts(local);

    if (isToday) return time;
    if (isYesterday) return `Yesterday, ${time}`;
    return `${formatDate(local)}, ${time}`;
  };

  const formatHistoryMoment = (value: Date | string) => {
    const { date, time } = formatDateTimeParts(value);
    return `${date}, at ${time}`;
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
        case 'Exchanged':
          return 'Received, Exchanged';
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
        case 'Exchanged':
          return 'Receive, Exchange';
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
        case 'Exchanged':
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
  const canProcessReturn = canAccessRecord(bill.createdBy, 'bills.processReturnOwn', 'bills.processReturnAny');
  const isVoidedBeforeReceipt = bill.status === BillStatus.CANCELLED
    || (bill.status === BillStatus.RETURNED && !String(bill.history?.return || '').trim());
  const settlementTotal = isVoidedBeforeReceipt ? 0 : bill.total;

  // Calculate payment status
  const getPaymentStatus = () => {
    return getPaymentStatusLabel(bill.paidAmount, settlementTotal, bill.history);
  };

  const appendBillHistory = (key: 'paid' | 'refund', eventText: string): Bill['history'] => {
    const existing = String(bill.history?.[key] || '').trim();
    return {
      ...bill.history,
      [key]: existing ? `${existing}\n${eventText}` : eventText,
    };
  };

  const updateStatus = async (newStatus: BillStatus, historyKey?: keyof Exclude<Bill['history'], undefined>, historyText?: string, extra?: Record<string, any>) => {
    if (!bill) return;
    try {
      const existingHistoryText = historyKey ? String(bill.history?.[historyKey] || '').trim() : '';
      const updates = {
        ...bill,
        ...extra,
        status: newStatus,
        history: historyKey
          ? { ...bill.history, [historyKey]: existingHistoryText && historyText ? `${existingHistoryText}\n${historyText}` : historyText }
          : bill.history
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
    const historyText = `Marked as processing by ${user.name}, on ${formatHistoryMoment(new Date())}`;
    await updateStatus(BillStatus.PROCESSING, 'processing', historyText);
  };

  const completeBill = async () => {
    if (!canMarkCurrentBillReceived) {
      toast.error('You do not have permission to complete bills.');
      return;
    }

    if (completionOutcome === 'Returned') {
      if (completionAccountId && !completionPaymentMethod) {
        toast.error('Please select a payment method');
        return;
      }
    }

    const historyText = `Marked as ${completionOutcome.toLowerCase()} by ${user.name}, on ${formatHistoryMoment(new Date())}`;
    const newStatus = completionOutcome === 'Returned' ? BillStatus.RETURNED : BillStatus.RECEIVED;
    const historyKey = completionOutcome === 'Returned' ? 'returned' : 'received';

    const extraUpdates: Record<string, any> = {};
    if (completionOutcome === 'Returned') {
      if (completionAccountId) extraUpdates.returnAccountId = completionAccountId;
      if (completionPaymentMethod) extraUpdates.returnPaymentMethod = completionPaymentMethod;
      if (completionCategoryId) extraUpdates.returnCategoryId = completionCategoryId;
      if (completionNote.trim()) extraUpdates.returnNote = completionNote.trim();
    }

    await updateStatus(newStatus, historyKey as keyof Exclude<Bill['history'], undefined>, historyText, extraUpdates);
    closeCompleteModal();
  };

  const cancelBill = async () => {
    if (!canCancelCurrentBill) {
      toast.error('You do not have permission to cancel bills.');
      return;
    }
    const historyText = `Reverted/cancelled by ${user.name}, on ${formatHistoryMoment(new Date())}`;
    await updateStatus(BillStatus.CANCELLED, 'cancelled', historyText);
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
      if (paymentForm.amount <= 0) {
        toast.error('Enter a payment amount greater than zero');
        return;
      }
      const remainingDue = Math.max(settlementTotal - bill.paidAmount, 0);
      if (paymentForm.amount > remainingDue) {
        toast.error(`Payment cannot exceed the remaining due of ${formatCurrency(remainingDue)}`);
        return;
      }
      
      // Compose ISO datetime from date and time
      const fullDatetime = buildLocalDateTime(paymentForm.date, paymentForm.time);
      if (!fullDatetime) {
        toast.error('Please enter a valid payment date and time');
        return;
      }
      const isoDatetime = fullDatetime.toISOString();
      const historyText = `Payment of ${formatCurrency(paymentForm.amount)} received by ${user.name} on ${formatHistoryMoment(fullDatetime)}`;
      
      const updatedBill: any = {
        history: appendBillHistory('paid', historyText),
        paymentAmount: paymentForm.amount,
        accountId: paymentForm.accountId,
        paymentMethod: db.settings.defaults.defaultPaymentMethod || 'Cash',
        transactionDate: isoDatetime,
      };

      await updateMutation.mutateAsync({ id: id!, updates: updatedBill });

      setShowPaymentModal(false);
      toast.success('Payment recorded successfully');
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
      amount: Math.max(settlementTotal - bill.paidAmount, 0)
    });
    setShowPaymentModal(true);
  };

  const openRefund = () => {
    if (!bill) return;
    const refundDue = Math.max(bill.paidAmount - settlementTotal, 0);
    if (refundDue <= 0) {
      toast.info('There is no vendor refund due on this bill.');
      return;
    }
    setRefundForm({
      date: getTodayDate(),
      time: new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false }),
      accountId: db.settings.defaults.defaultAccountId || '',
      amount: refundDue,
    });
    setShowRefundModal(true);
  };

  const handleRefund = async () => {
    if (!bill) return;
    const maxRefund = Math.max(bill.paidAmount - settlementTotal, 0);
    if (!refundForm.accountId) {
      toast.error('Please select the account that received the refund');
      return;
    }
    if (refundForm.amount <= 0 || refundForm.amount > maxRefund) {
      toast.error(`Refund must be between 0 and ${formatCurrency(maxRefund)}`);
      return;
    }
    const fullDatetime = buildLocalDateTime(refundForm.date, refundForm.time);
    if (!fullDatetime) {
      toast.error('Please enter a valid refund date and time');
      return;
    }
    const historyText = `Vendor refund of ${formatCurrency(refundForm.amount)} recorded by ${user.name} on ${formatHistoryMoment(fullDatetime)}`;
    try {
      await updateMutation.mutateAsync({
        id: id!,
        updates: {
          history: appendBillHistory('refund', historyText),
          refundAmount: refundForm.amount,
          accountId: refundForm.accountId,
          paymentMethod: db.settings.defaults.defaultPaymentMethod || 'Cash',
          transactionDate: fullDatetime.toISOString(),
        } as any,
      });
      setShowRefundModal(false);
      toast.success('Vendor refund recorded successfully');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record vendor refund');
    }
  };

  const handleProcessBillReturn = async (payload: ProcessBillReturnPayload) => {
    try {
      await processBillReturnMutation.mutateAsync(payload);
      setShowReturnModal(false);
      toast.success('Return processed successfully');
    } catch (err) {
      console.error('Failed to process return:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to process return');
    }
  };

  const canShowActionsMenu =
    canEditCurrentBill
    || canCancelCurrentBill
    || canProcessReturn;

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
                    {canProcessReturn && (bill.status === BillStatus.RECEIVED || bill.status === BillStatus.PAID) && (
                      <button onClick={() => { setShowReturnModal(true); setIsActionOpen(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-orange-50 flex items-center gap-2 font-bold text-orange-700">{ICONS.Return} Return to Vendor</button>
                    )}
                    {canCancelCurrentBill && <button disabled={bill.status !== BillStatus.PROCESSING} onClick={() => { cancelBill(); setIsActionOpen(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-red-50 disabled:hover:bg-gray-50 flex items-center gap-2 text-red-600 font-bold disabled:text-gray-300 disabled:cursor-not-allowed">{ICONS.Close} Cancel Bill</button>}
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
                    className="details-invoice-logo rounded-lg object-contain mb-2 sm:mb-3 lg:mb-4"
                    width={invoiceLogoWidth}
                    height={invoiceLogoHeight}
                    style={invoiceLogoStyle}
                    alt="Company Logo"
                  />
                )}
                <h1 className="text-sm sm:text-base lg:text-xl font-black uppercase tracking-tighter break-words" style={{ color: themeColorHex }}>{companySettings?.name || db.settings.company.name}</h1>
                <div className="mt-1 sm:mt-2 text-[9px] sm:text-[10px] lg:text-xs text-gray-400 font-medium space-y-0.5 sm:space-y-1">
                  <p className="break-words">{companySettings?.address || db.settings.company.address}</p>
                  <p className="text-[8px] sm:text-[9px] break-words">{companySettings?.phone || db.settings.company.phone} • {companySettings?.email || db.settings.company.email}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <h2 className="text-sm sm:text-2xl lg:text-3xl font-black text-gray-300 uppercase leading-none mb-1 sm:mb-2 break-words">{invoiceSettings?.title || db.settings.invoice.title}</h2>
                <div className="space-y-0.5 sm:space-y-1 lg:space-y-1.5 text-[9px] sm:text-sm">
                  <p className="text-[9px] sm:text-sm font-bold text-gray-900 break-words">Bill No: #{bill.billNumber}</p>
                  <p className="text-[9px] sm:text-sm text-gray-500">{formatDate(bill.billDate)}</p>
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
                      const returnedQty = item.returnedQty ?? 0;
                      const activeQty = Math.max(0, item.quantity - returnedQty);
                      const effectiveAmount = item.rate * activeQty;
                      const isFullyReturned = activeQty === 0;
                      return (
                        <tr key={idx} className={`group ${isFullyReturned ? 'opacity-50' : ''}`}>
                          <td className="py-3 sm:py-4 lg:py-6">
                            <div className="flex items-center gap-2 sm:gap-3 lg:gap-4 min-w-0">
                              {imageSrc ? (
                                <img src={imageSrc} className={`w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 rounded-full object-cover border border-gray-100 shadow-sm flex-shrink-0 ${isFullyReturned ? 'grayscale' : ''}`} alt={item.productName} />
                              ) : (
                                <div className={`w-8 h-8 sm:w-10 sm:h-10 lg:w-12 lg:h-12 rounded-full border border-gray-100 shadow-sm bg-gray-50 text-gray-400 text-xs flex items-center justify-center flex-shrink-0 ${isFullyReturned ? 'grayscale' : ''}`}>
                                  {(item.productName || '?').slice(0, 1).toUpperCase()}
                                </div>
                              )}
                              <div className="min-w-0">
                                <span className={`font-bold text-[10px] sm:text-xs lg:text-base break-words ${isFullyReturned ? 'line-through text-gray-400' : 'text-gray-900'}`}>{item.productName}</span>
                                {returnedQty > 0 && (
                                  <div className="mt-0.5">
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-orange-100 text-orange-700">
                                      Returned ×{returnedQty}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="py-3 sm:py-4 lg:py-6 text-center text-gray-500 font-bold px-1 whitespace-nowrap">{formatCurrency(item.rate)}</td>
                          <td className="py-3 sm:py-4 lg:py-6 text-center px-1 whitespace-nowrap">
                            <span className={`font-bold ${isFullyReturned ? 'line-through text-gray-400' : 'text-gray-500'}`}>{activeQty}</span>
                            {activeQty !== item.quantity && (
                              <span className="text-gray-300 text-[9px] ml-1">(of {item.quantity})</span>
                            )}
                          </td>
                          <td className="py-3 sm:py-4 lg:py-6 text-right px-1 whitespace-nowrap">
                            <span className={`font-black ${isFullyReturned ? 'line-through text-gray-400' : 'text-gray-900'}`}>{formatCurrency(effectiveAmount)}</span>
                          </td>
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
                    <span className={`font-bold ${settlementTotal - bill.paidAmount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {formatCurrency(Math.max(settlementTotal - bill.paidAmount, 0))}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-t border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">Vendor Refund Due</span>
                    <span className="font-bold text-orange-600">{formatCurrency(Math.max(bill.paidAmount - settlementTotal, 0))}</span>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <button
                    onClick={openPayment}
                    disabled={!canMarkCurrentBillPaid || bill.paidAmount >= settlementTotal || bill.status === BillStatus.RETURNED || bill.status === BillStatus.CANCELLED}
                    className={`w-full py-2.5 ${theme.colors.primary[600]} hover:${theme.colors.primary[700]} text-white font-bold rounded-lg shadow-md transition-all active:scale-95 text-sm disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    Add Payment
                  </button>
                  <button
                    type="button"
                    onClick={openRefund}
                    disabled={!canMarkCurrentBillPaid || bill.paidAmount <= settlementTotal}
                    className="w-full py-2.5 border border-orange-200 text-orange-600 hover:bg-orange-50 font-bold rounded-lg transition-all active:scale-95 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Record Vendor Refund
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
                    const isBranchItem = item.label === 'Received' || item.label === 'Exchanged' || item.label === 'Returned' || item.label === 'Cancelled';
                    const isUnavailableBranch = Boolean(branchStatus && isBranchItem && item.label !== branchStatus);
                    if (isUnavailableBranch) return null;
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

          {(bill.history as Record<string, string | undefined>)?.return && (
            <div className="flex gap-3 pb-4 border-b border-gray-100">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-orange-100">
                  {ICONS.Return}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-orange-700 leading-relaxed font-bold">{(bill.history as Record<string, string | undefined>)?.return}</p>
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

          {bill.history?.refund && (
            <div className="flex gap-3 pb-4 border-b border-gray-100">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-orange-100">
                  {ICONS.Return}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-orange-700 leading-relaxed font-bold">{bill.history.refund}</p>
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

      <CommonPaymentModal
        isOpen={showRefundModal}
        onClose={() => setShowRefundModal(false)}
        onSubmit={handleRefund}
        accounts={accounts}
        paymentForm={refundForm}
        setPaymentForm={setRefundForm}
        isLoading={isPaymentLoading}
        title="Record Vendor Refund"
        buttonText="Record Refund"
      />

      {showCompleteModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={closeCompleteModal}></div>
          <div className="relative z-[210] w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white p-10 animate-in zoom-in-95 duration-200" style={{ border: `1px solid ${themeColorHex}22` }}>
            <button
              type="button"
              onClick={closeCompleteModal}
              className="absolute right-6 top-6 rounded-full border border-gray-200 bg-white p-2 text-gray-500 transition hover:border-gray-300 hover:text-gray-900"
              aria-label="Close"
            >
              ×
            </button>
            <div className="mb-8">
              <h3 className="mt-2 text-2xl font-black text-gray-900">Complete bill #{bill.billNumber}</h3>
              <p className="mt-2 text-sm font-medium">
                <span className="font-black text-gray-500">
                  Total {formatCurrency(bill.total)}
                  {bill.paidAmount > 0 && ` · Paid ${formatCurrency(bill.paidAmount)}`}
                </span>
              </p>
            </div>

            <div className="space-y-6">
              <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                {(['Received', 'Returned'] as const).map((outcome) => (
                  <button
                    key={outcome}
                    type="button"
                    onClick={() => setCompletionOutcome(outcome)}
                    disabled={updateMutation.isPending}
                    className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-all ${
                      completionOutcome === outcome
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    } disabled:opacity-50`}
                  >
                    {outcome === 'Received' ? ICONS.Check : ICONS.Return}
                    <span className="hidden sm:inline">{outcome}</span>
                  </button>
                ))}
              </div>

              {completionOutcome === 'Returned' && (
                <>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Refund Into Account</label>
                      <select
                        value={completionAccountId}
                        onChange={(event) => setCompletionAccountId(event.target.value)}
                        disabled={updateMutation.isPending}
                        className="w-full rounded-lg border border-gray-100 bg-gray-50 px-6 py-3.5 font-bold outline-none focus:ring-2 disabled:opacity-50"
                        style={{ '--tw-ring-color': themeColorHex } as React.CSSProperties}
                      >
                        <option value="">Select account...</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name} ({formatCurrency(account.currentBalance)})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Payment Method</label>
                      <select
                        value={completionPaymentMethod}
                        onChange={(event) => setCompletionPaymentMethod(event.target.value)}
                        disabled={updateMutation.isPending}
                        className="w-full rounded-lg border border-gray-100 bg-gray-50 px-6 py-3.5 font-bold outline-none focus:ring-2 disabled:opacity-50"
                        style={{ '--tw-ring-color': themeColorHex } as React.CSSProperties}
                      >
                        <option value="">Select method...</option>
                        {paymentMethods.map((pm) => (
                          <option key={pm.id} value={pm.name}>{pm.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Income Category</label>
                    <select
                      value={completionCategoryId}
                      onChange={(event) => setCompletionCategoryId(event.target.value)}
                      disabled={updateMutation.isPending}
                      className="w-full rounded-lg border border-gray-100 bg-gray-50 px-6 py-3.5 font-bold outline-none focus:ring-2 disabled:opacity-50"
                      style={{ '--tw-ring-color': themeColorHex } as React.CSSProperties}
                    >
                      <option value="">Select category...</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Return note</label>
                    <textarea
                      value={completionNote}
                      onChange={(event) => setCompletionNote(event.target.value)}
                      rows={3}
                      placeholder="Enter a note for the returned bill..."
                      className="min-h-[80px] w-full rounded-lg border border-gray-100 bg-gray-50 px-6 py-4 font-medium outline-none focus:ring-2 disabled:opacity-50"
                      style={{ '--tw-ring-color': themeColorHex } as React.CSSProperties}
                    />
                  </div>
                </>
              )}

              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={closeCompleteModal}
                  disabled={updateMutation.isPending}
                  className="rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-bold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={completeBill}
                  disabled={updateMutation.isPending}
                  className="flex-1 rounded-lg px-5 py-2.5 text-sm font-bold text-white transition disabled:opacity-50"
                  style={{ backgroundColor: themeColorHex }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                >
                  {completionOutcome === 'Returned' ? 'Mark Returned' : 'Mark Received'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <BillReturnModal
        isOpen={showReturnModal}
        onClose={() => setShowReturnModal(false)}
        onSubmit={handleProcessBillReturn}
        bill={bill}
        isLoading={processBillReturnMutation.isPending}
      />
    </div>
  );
};

export default BillDetails;

