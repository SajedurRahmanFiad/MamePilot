
import React, { useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { db } from '../db';
import { BillStatus, Bill, Transaction } from '../types';
import { formatCurrency, ICONS, getStatusColor } from '../constants';
import { theme } from '../theme';
import { useAccounts, useBill, useCompanySettings, useInvoiceSettings, useProductImagesByIds, useUser, useVendor } from '../src/hooks/useQueries';
import { useUpdateBill, useCreateTransaction } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { LoadingOverlay, CommonPaymentModal } from '../components';
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

  const markReceived = async () => {
    if (!canMarkCurrentBillReceived) {
      toast.error('You do not have permission to mark bills as received.');
      return;
    }
    const historyText = `Marked as received by ${user.name}, on ${new Date().toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })}`;
    await updateStatus(BillStatus.RECEIVED, 'received', historyText);
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
    || canMoveCurrentBillToProcessing
    || canMarkCurrentBillReceived
    || canMarkCurrentBillPaid
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
                    {canMoveCurrentBillToProcessing && <button disabled={bill.status === BillStatus.PAID} onClick={() => { markProcessing(); setIsActionOpen(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 disabled:text-gray-300 disabled:cursor-not-allowed">Mark Processing</button>}
                    {canMarkCurrentBillReceived && <button disabled={bill.status === BillStatus.ON_HOLD || bill.status === BillStatus.PAID} onClick={() => { markReceived(); setIsActionOpen(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 disabled:text-gray-300 disabled:cursor-not-allowed">Mark Received</button>}
                    {canCancelCurrentBill && <button disabled={bill.status === BillStatus.PAID || bill.status === BillStatus.ON_HOLD} onClick={() => { cancelBill(); setIsActionOpen(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-red-50 text-red-600 font-bold disabled:text-gray-300 disabled:cursor-not-allowed">Cancel Bill</button>}
                    {canMarkCurrentBillPaid && <button onClick={() => { openPayment(); setIsActionOpen(false); }} disabled={bill.paidAmount >= bill.total} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 text-red-600 font-bold disabled:text-gray-300 disabled:cursor-not-allowed">Record Payment</button>}
                    {canEditCurrentBill && <button onClick={() => navigate(`/bills/edit/${bill.id}`)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50">Edit Bill</button>}
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
                {bill.discount > 0 && (
                  <div className="flex justify-between text-[10px] sm:text-xs lg:text-sm gap-2">
                    <span className="text-gray-400 font-bold uppercase flex-shrink-0">Discount</span>
                    <span className="font-bold text-red-500 flex-shrink-0">-{formatCurrency(bill.discount)}</span>
                  </div>
                )}
                {bill.shipping > 0 && (
                  <div className="flex justify-between text-[10px] sm:text-xs lg:text-sm gap-2">
                    <span className="text-gray-400 font-bold uppercase flex-shrink-0">Shipping</span>
                    <span className="font-bold text-gray-900 flex-shrink-0">{formatCurrency(bill.shipping)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2 sm:py-3 lg:py-4 border-t-2 border-[#0f2f57] gap-2">
                  <span className="font-black text-gray-900 uppercase tracking-tighter text-[11px] sm:text-xs lg:text-sm flex-shrink-0">Total Payable</span>
                  <span className="font-black text-sm sm:text-base lg:text-lg flex-shrink-0">{formatCurrency(bill.total)}</span>
                </div>
              </div>
            </div>

            {(invoiceSettings?.footer || db.settings.invoice.footer) && (
              <div className="bg-gray-50 p-4 rounded-[10px] border border-gray-100 print:bg-white print:p-3 print:rounded-lg print:border-gray-300">
                <p className="text-sm text-gray-500 font-medium leading-relaxed whitespace-pre-line print:text-gray-700">
                  {invoiceSettings?.footer || db.settings.invoice.footer}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar Payment & Lifecycle Sections */}
        <div className="space-y-6">
          {/* Payment Section */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 bg-gray-50 border-b flex justify-between items-center">
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest flex items-center gap-2">
                Payment
                <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-wider">
                  {getPaymentStatus()}
                </span>
              </h3>
              <div className="p-1 bg-[var(--primary-soft,#ebf4ff)] text-white rounded-full">{ICONS.Banking}</div>
            </div>
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
                  <span className="text-xs text-gray-500 font-medium">Refunded</span>
                  <span className="font-bold text-orange-600">{formatCurrency(0)}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-t border-gray-100">
                  <span className="text-xs text-gray-500 font-medium">Due Amount</span>
                  <span className={`font-bold ${bill.total - bill.paidAmount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {formatCurrency(Math.max(bill.total - bill.paidAmount, 0))}
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <button
                  onClick={openPayment}
                  disabled={!canMarkCurrentBillPaid || bill.paidAmount >= bill.total}
                  className={`w-full py-2.5 ${theme.colors.primary[600]} hover:${theme.colors.primary[700]} disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed text-white font-bold rounded-lg shadow-md transition-all active:scale-95 text-sm`}
                >
                  Add Payment
                </button>
                <button
                  className="w-full py-2.5 border border-orange-200 text-orange-600 hover:bg-orange-50 font-bold rounded-lg transition-all active:scale-95 text-sm"
                >
                  Issue Refund
                </button>
              </div>
            </div>
          </div>

          {/* Processing Section */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 bg-gray-50 border-b flex justify-between items-center">
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">Processing</h3>
              <div className={`p-1 rounded-full ${bill.status === BillStatus.PROCESSING ? 'bg-[var(--primary-soft,#ebf4ff)] text-white' : 'bg-gray-200 text-gray-400'}`}>
                {ICONS.ChevronRight}
              </div>
            </div>
            <div className="p-5">
              {bill.history?.processing ? (
                <p className="text-xs text-[var(--primary-color,#0f2f57)] leading-relaxed font-bold bg-[var(--primary-soft,#ebf4ff)] p-3 rounded-xl">
                  {bill.history.processing}
                </p>
              ) : (
                <button 
                  disabled={!canMoveCurrentBillToProcessing || bill.status === BillStatus.PAID}
                  onClick={markProcessing}
                  className={`w-full py-3 ${theme.colors.secondary[600]} hover:${theme.colors.secondary[700]} disabled:bg-gray-100 disabled:text-gray-400 text-white font-bold rounded-xl shadow-md transition-all active:scale-95`}
                >
                  Mark as Processing
                </button>
              )}
            </div>
          </div>

          {/* Received Section */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 bg-gray-50 border-b flex justify-between items-center">
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">Received</h3>
              <div className={`p-1 rounded-full ${bill.status === BillStatus.RECEIVED ? 'bg-green-100 text-green-600' : 'bg-gray-200 text-gray-400'}`}>
                {ICONS.ChevronRight}
              </div>
            </div>
            <div className="p-5">
              {bill.history?.received ? (
                <p className="text-xs text-green-600 leading-relaxed font-bold bg-green-50 p-3 rounded-xl">
                  {bill.history.received}
                </p>
              ) : (
                <button 
                  disabled={!canMarkCurrentBillReceived || bill.status === BillStatus.ON_HOLD || bill.status === BillStatus.PAID}
                  onClick={markReceived}
                  className={`w-full py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-100 disabled:text-gray-400 text-white font-bold rounded-xl shadow-md transition-all active:scale-95`}
                >
                  Mark as Received
                </button>
              )}
            </div>
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
    </div>
  );
};

export default BillDetails;

