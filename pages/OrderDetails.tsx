
import React, { useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { db } from '../db';
import { OrderStatus, Order } from '../types';
import { formatCurrency, ICONS, getStatusColor } from '../constants';
import { Button, FraudCheckModal, OrderCompletionModal, type OrderCompletionFormState, SteadfastModal, CarryBeeModal, PaperflyModal } from '../components';
import { theme } from '../theme';
import { useAccounts, useOrder, useCustomer, useProductImagesByIds, useCompanySettings, useInvoiceSettings, useUser } from '../src/hooks/useQueries';
import { useUpdateOrder, useCreateOrder, useCompletePickedOrder } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useAuth } from '../src/contexts/AuthProvider';
import { LoadingOverlay } from '../components';
import { handlePrintOrder } from '../src/utils/printUtils';
import { getPreservedRouteState } from '../src/utils/navigation';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useCapabilities } from '../src/hooks/useCapabilities';
import {
  buildLocalDateTime,
  extractSteadfastTrackingFromHistory,
  getPaperflyReferenceNumber,
  getPreferredCourierFromHistory,
  getTodayDate,
  normalizePhoneSearchValue,
} from '../utils';
import { getOrderCompanyPage } from '../src/utils/companyPages';

const OrderDetails: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToastNotifications();
  const { user: authUser } = useAuth();
  const user = authUser || db.currentUser;
  const { can, canAccessRecord, isAdminAccessUser } = useRolePermissions();
  const { hasCapability } = useCapabilities(Boolean(user));
  const createCompletionForm = (activeOrder?: Order | null): OrderCompletionFormState => ({
    outcome: 'Delivered',
    date: getTodayDate(),
    time: new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false }),
    accountId: '',
    amount: activeOrder ? Math.max(activeOrder.total - activeOrder.paidAmount, 0) : 0,
    paymentMethod: '',
    categoryId: '',
    note: '',
  });
  
  // Query data
  const { data: order, isPending: orderLoading, error: orderError } = useOrder(id || '');
  const { data: customer } = useCustomer(order ? order.customerId : undefined);
  const { data: createdByUser } = useUser(order?.createdBy);
  const orderItemProductIds = useMemo(
    () => Array.from(new Set((order?.items || []).map((item) => String(item?.productId || '').trim()).filter(Boolean))),
    [order?.items]
  );
  const { data: productImages = {} } = useProductImagesByIds(orderItemProductIds);
  const { data: companySettings } = useCompanySettings();
  const { data: invoiceSettings } = useInvoiceSettings();
  const { data: accounts = [] } = useAccounts();
  
  // Mutations
  const updateMutation = useUpdateOrder();
  const createOrderMutation = useCreateOrder();
  const completePickedOrderMutation = useCompletePickedOrder();
  
  // Modal and form state
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [showSteadfast, setShowSteadfast] = useState(false);
  const [showCarryBee, setShowCarryBee] = useState(false);
  const [showPaperfly, setShowPaperfly] = useState(false);
  const [showFraudCheckModal, setShowFraudCheckModal] = useState(false);
  const [completionForm, setCompletionForm] = useState<OrderCompletionFormState>(createCompletionForm());
  const [isActionOpen, setIsActionOpen] = useState(false);
  
  // Get customer and created by user from query results
  // `customer` is obtained via `useCustomer` above
  const completionHistory = order?.history?.returned || order?.history?.completed || order?.history?.payment || '';
  const orderBranding = React.useMemo(
    () => getOrderCompanyPage(order, companySettings || db.settings.company),
    [companySettings, order],
  );
  const orderPhone = React.useMemo(
    () => String(customer?.phone || order?.customerPhone || '').trim(),
    [customer?.phone, order?.customerPhone],
  );
  const normalizedOrderPhone = normalizePhoneSearchValue(orderPhone);
  
  const loading = orderLoading;

  if (!user) return <div className="p-8 text-center text-gray-500">Loading order access...</div>;
  if (loading) return <div className="p-8 text-center text-gray-500">Loading order...</div>;
  if (orderError || !order) return <div className="p-8 text-center text-gray-500">{orderError?.message || 'Order not found.'}</div>;
  let canEditCurrentOrder = false;
  if (order.status === OrderStatus.ON_HOLD) {
    canEditCurrentOrder = can('orders.editAny') || (can('orders.editOwn') && order.createdBy === user?.id);
  } else if (order.status === OrderStatus.PICKED) {
    // Admins and Developers are allowed to edit picked orders
    canEditCurrentOrder = !!isAdminAccessUser;
  }
  const canMoveCurrentOrderToProcessing = canAccessRecord(
    order.createdBy,
    'orders.moveOnHoldToProcessingOwn',
    'orders.moveOnHoldToProcessingAny',
  );
  const canSendCurrentOrderToCourierPermission = canAccessRecord(
    order.createdBy,
    'orders.sendToCourierOwn',
    'orders.sendToCourierAny',
  );
  const canMoveCurrentOrderToPickedPermission = canAccessRecord(
    order.createdBy,
    'orders.moveToPickedOwn',
    'orders.moveToPickedAny',
  );
  const canMarkCurrentOrderCompleted = canAccessRecord(
    order.createdBy,
    'orders.markCompletedOwn',
    'orders.markCompletedAny',
  );
  const canMarkCurrentOrderReturned = canAccessRecord(
    order.createdBy,
    'orders.markReturnedOwn',
    'orders.markReturnedAny',
  );
  const canFinalizeOrders = canMarkCurrentOrderCompleted || canMarkCurrentOrderReturned;
  const canCancelCurrentOrder = canAccessRecord(order.createdBy, 'orders.cancelOwn', 'orders.cancelAny');
  const canUseFraudChecker = can('fraudChecker.check') && hasCapability('fraud_checker');
  const canUseCourierAutomation = hasCapability('courier_automation');
  const canRunFraudChecker = canUseFraudChecker && /^0\d{10}$/.test(normalizedOrderPhone);
  const courierHistoryLower = String(order.history?.courier || '').toLowerCase();
  const sentToSteadfast = courierHistoryLower.includes('steadfast') || !!order.steadfastConsignmentId;
  const sentToCarryBee = courierHistoryLower.includes('carrybee') || !!order.carrybeeConsignmentId;
  const sentToPaperfly = courierHistoryLower.includes('paperfly') || !!order.paperflyTrackingNumber;
  const sentToAnyCourier = sentToSteadfast || sentToCarryBee || sentToPaperfly;

  const updateStatus = async (newStatus: OrderStatus, historyKey?: keyof Order['history'], historyText?: string) => {
    if (!order) return;
    try {
      const updates: Partial<Order> = {
        status: newStatus,
      };

      if (historyKey) {
        updates.history = { ...order.history, [historyKey]: historyText };
      }

      await updateMutation.mutateAsync({ id: id!, updates });
      setIsActionOpen(false);
    } catch (err) {
      console.error('Failed to update order status:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to update order status');
    }
  };

  const markProcessing = async () => {
    if (!canMoveCurrentOrderToProcessing) {
      toast.error('You do not have permission to move orders to processing.');
      return;
    }
    const historyText = `Marked as processing by ${user.name}, on ${new Date().toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })}`;
    await updateStatus(OrderStatus.PROCESSING, 'processing', historyText);
  };

  const markPicked = async () => {
    if (!canMoveCurrentOrderToPickedPermission) {
      toast.error('You do not have permission to mark orders as picked.');
      return;
    }
    const historyText = `Marked as picked by courier, on ${new Date().toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })}`;
    await updateStatus(OrderStatus.PICKED, 'picked', historyText);
  };

  const handleCompletePickedOrder = async () => {
    if (!order) return;

    if (completionForm.outcome === 'Delivered' && !canMarkCurrentOrderCompleted) {
      toast.error('You do not have permission to mark orders as completed.');
      return;
    }
    if (completionForm.outcome === 'Returned' && !canMarkCurrentOrderReturned) {
      toast.error('You do not have permission to mark orders as returned.');
      return;
    }

    if (!completionForm.accountId) {
      toast.error('Please select an account');
      return;
    }
    if (completionForm.amount <= 0) {
      toast.error(completionForm.outcome === 'Returned' ? 'Please enter the return expense amount' : 'Please enter the received amount');
      return;
    }
    if (completionForm.outcome === 'Returned' && !completionForm.paymentMethod) {
      toast.error('Please select a payment method');
      return;
    }
    if (completionForm.outcome === 'Returned' && !completionForm.categoryId) {
      toast.error('Please select an expense category');
      return;
    }
    if (completionForm.outcome === 'Returned') {
      const selectedAccount = accounts.find((account) => account.id === completionForm.accountId);
      if (selectedAccount && selectedAccount.currentBalance < completionForm.amount) {
        toast.error(
          `${selectedAccount.name} does not have enough balance for this return. Available ${formatCurrency(selectedAccount.currentBalance)}, required ${formatCurrency(completionForm.amount)}.`
        );
        return;
      }
    }

    const fullDatetime = buildLocalDateTime(completionForm.date, completionForm.time);
    if (!fullDatetime) {
      toast.error('Please enter a valid date and time');
      return;
    }

    try {
      const updatedOrder = await completePickedOrderMutation.mutateAsync({
        orderId: order.id,
        outcome: completionForm.outcome,
        date: fullDatetime.toISOString(),
        accountId: completionForm.accountId,
        amount: completionForm.amount,
        paymentMethod: completionForm.outcome === 'Returned' ? completionForm.paymentMethod : undefined,
        categoryId: completionForm.outcome === 'Returned' ? completionForm.categoryId : undefined,
        note: completionForm.outcome === 'Returned' ? completionForm.note : undefined,
      });

      setShowCompletionModal(false);
      setCompletionForm(createCompletionForm());
      if ((updatedOrder.pendingTransactionCount || 0) > 0) {
        toast.info(
          `Order #${order.orderNumber} was finalized, and ${updatedOrder.pendingTransactionCount} transaction${updatedOrder.pendingTransactionCount === 1 ? '' : 's'} were sent for admin approval.`
        );
      } else {
        toast.success(
          completionForm.outcome === 'Returned'
            ? `Order #${order.orderNumber} marked as returned`
            : `Order #${order.orderNumber} marked as delivered`
        );
      }
    } catch (err) {
      console.error('Failed to finalize order:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to finalize order');
    }
  };

  const openCompletion = () => {
    setCompletionForm({
      ...createCompletionForm(order),
      outcome: canMarkCurrentOrderCompleted ? 'Delivered' : 'Returned',
    });
    setShowCompletionModal(true);
  };

  const handleOpenTracking = () => {
    const preferredCourier = getPreferredCourierFromHistory(order.history?.courier);
    const courierHistory = String(order.history?.courier || '').toLowerCase();
    const sentToSteadfast = courierHistory.includes('steadfast') || !!order.steadfastConsignmentId;
    const sentToCarryBee = courierHistory.includes('carrybee') || !!order.carrybeeConsignmentId;
    const sentToPaperfly = courierHistory.includes('paperfly') || !!order.paperflyTrackingNumber;
    const steadfastTracking = String(
      order.steadfastConsignmentId || extractSteadfastTrackingFromHistory(order.history?.courier) || ''
    ).trim();
    const carryBeeConsignment = String(order.carrybeeConsignmentId || '').trim();
    const paperflyReference = getPaperflyReferenceNumber(order);

    const closeTrackingMenu = () => setIsActionOpen(false);

    const openSteadfastTracking = (): boolean => {
      if (!sentToSteadfast || !steadfastTracking) return false;

      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(steadfastTracking).catch(() => undefined);
      }
      toast.success(`Steadfast tracking code copied: ${steadfastTracking}`);
      window.open('https://steadfast.com.bd/tracking', '_blank', 'noopener,noreferrer');
      closeTrackingMenu();
      return true;
    };

    const openCarryBeeTracking = (): boolean => {
      if (!sentToCarryBee || !carryBeeConsignment) return false;

      window.open(`https://merchant.carrybee.com/order-track/${encodeURIComponent(carryBeeConsignment)}`, '_blank', 'noopener,noreferrer');
      closeTrackingMenu();
      return true;
    };

    const openPaperflyTracking = (): boolean => {
      if (!sentToPaperfly || !paperflyReference) return false;

      window.open(`https://go.paperfly.com.bd/track/order/${encodeURIComponent(paperflyReference)}`, '_blank', 'noopener,noreferrer');
      closeTrackingMenu();
      return true;
    };

    if (preferredCourier === 'paperfly' && openPaperflyTracking()) return;
    if (preferredCourier === 'carrybee' && openCarryBeeTracking()) return;
    if (preferredCourier === 'steadfast' && openSteadfastTracking()) return;

    if (openPaperflyTracking()) return;
    if (openCarryBeeTracking()) return;
    if (openSteadfastTracking()) return;

    if (courierHistory.includes('steadfast')) {
      toast.warning('Steadfast tracking code is missing for this order');
      closeTrackingMenu();
      return;
    }

    if (courierHistory.includes('carrybee')) {
      toast.warning('CarryBee tracking code is missing for this order');
      closeTrackingMenu();
      return;
    }

    if (courierHistory.includes('paperfly')) {
      toast.warning('Paperfly reference number is missing for this order');
      closeTrackingMenu();
      return;
    }

    toast.warning('Tracking unavailable');
    closeTrackingMenu();
  };

  const handleDuplicate = async () => {
    if (!order) return;
    try {
      const duplicateOrder = { 
        orderNumber: db.settings.order.prefix + db.settings.order.nextNumber,
        orderDate: order.orderDate,
        customerId: order.customerId,
        pageId: order.pageId,
        pageSnapshot: order.pageSnapshot,
        createdBy: user.id,
        status: order.status,
        items: order.items,
        subtotal: order.subtotal,
        discount: order.discount,
        shipping: order.shipping,
        total: order.total,
        notes: order.notes,
        paidAmount: 0,
        history: { created: `${user.name} created this order as duplicate on ${new Date().toLocaleDateString('en-BD')}, at ${new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' })}` }
      };
      await createOrderMutation.mutateAsync(duplicateOrder as any);
      navigate('/orders');
    } catch (err) {
      toast.error('Failed to duplicate order: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const openFraudChecker = () => {
    if (!canRunFraudChecker) {
      toast.warning('This order does not have a valid 11-digit customer phone number.');
      setIsActionOpen(false);
      return;
    }

    setShowFraudCheckModal(true);
    setIsActionOpen(false);
  };

  const canSendCurrentOrderToCourier =
    canSendCurrentOrderToCourierPermission
    && canUseCourierAutomation
    && order.status !== OrderStatus.PICKED
    && order.status !== OrderStatus.COMPLETED
    && order.status !== OrderStatus.RETURNED
    && order.status !== OrderStatus.CANCELLED
    && order.status !== OrderStatus.ON_HOLD
    && !sentToAnyCourier;
  const canMarkCurrentOrderPicked = canMoveCurrentOrderToPickedPermission && order.status === OrderStatus.PROCESSING;
  const canFinalizeCurrentOrder = canFinalizeOrders && order.status === OrderStatus.PICKED;
  const canShowActionsMenu =
    canEditCurrentOrder
    || canFinalizeCurrentOrder
    || (sentToAnyCourier && canUseCourierAutomation)
    || canCancelCurrentOrder
    || canUseFraudChecker;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <LoadingOverlay isLoading={loading && !order} message="Loading order details..." />
      {/* Header with Top Action Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => {
            const navState = getPreservedRouteState(location.state);
            const refreshOrdersOnBack = !!navState.refreshOrdersOnBack;
            if (navState.backMode === 'history' && window.history.length > 1) {
              navigate(-1);
              return;
            }

            const from = navState.from;
            if (from) {
              navigate(from, { state: { refreshOrders: refreshOrdersOnBack } });
            } else {
              navigate('/orders', { state: { refreshOrders: true } });
            }
          }} className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 text-gray-500 transition-all">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          </button>
          <h2 className="text-md md:text-lg font-bold text-gray-900">{order.orderNumber}</h2>
          <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${getStatusColor(order.status)}`}>
            {order.status}
          </span>
          {canUseCourierAutomation && (order.status === OrderStatus.PROCESSING || order.status === OrderStatus.PICKED) && sentToSteadfast && (
            <img src="/uploads/steadfast.png" alt="Steadfast" className="w-6 h-6 rounded-full" />
          )}
          {canUseCourierAutomation && (order.status === OrderStatus.PROCESSING || order.status === OrderStatus.PICKED) && sentToCarryBee && (
            <img src="/uploads/carrybee.png" alt="CarryBee" className="w-6 h-6 rounded-full" />
          )}
          {canUseCourierAutomation && (order.status === OrderStatus.PROCESSING || order.status === OrderStatus.PICKED) && sentToPaperfly && (
            <img src="/uploads/paperfly.png" alt="Paperfly" className="w-6 h-6 rounded-full" />
          )}
        </div>
        
        <div className="flex items-center gap-2 relative">
          <button onClick={() => handlePrintOrder(id!, navigate)} className="hidden md:flex items-center gap-2 px-4 py-2 text-sm font-semibold border rounded-lg bg-white hover:bg-gray-50 transition-all shadow-sm">
            {ICONS.Print} Print
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
                  <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-100 rounded-xl shadow-2xl z-50 py-2 animate-in fade-in zoom-in duration-150 origin-top-right">
                    <button onClick={() => { handlePrintOrder(id!, navigate); setIsActionOpen(false); }} className="md:hidden w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-gray-700">
                      {ICONS.Print} Print
                    </button>
                    <div className="md:hidden border-t my-1"></div>
                    {canEditCurrentOrder && (
                      <button onClick={() => navigate(`/orders/edit/${order.id}`)} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-gray-700">
                        {ICONS.Edit} Edit Order
                      </button>
                    )}
                    {canFinalizeCurrentOrder && (
                      <button className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-gray-700" onClick={() => { openCompletion(); setIsActionOpen(false); }}>
                        {ICONS.Check} Finalize Order
                      </button>
                    )}
                    {canUseFraudChecker && (
                      <button
                        onClick={openFraudChecker}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold ${canRunFraudChecker ? 'text-gray-700' : 'cursor-not-allowed text-gray-300'}`}
                        disabled={!canRunFraudChecker}
                      >
                        {ICONS.FraudChecker} Check Courier History
                      </button>
                    )}
                    {sentToAnyCourier && canUseCourierAutomation && (
                      <button
                        className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-[#0f2f57]"
                        onClick={handleOpenTracking}
                      >
                        {ICONS.Courier} Tracking
                      </button>
                    )}
                    {canCancelCurrentOrder && (
                      <>
                        <div className="border-t my-1"></div>
                        <button onClick={() => updateStatus(OrderStatus.CANCELLED)} disabled={order.status === OrderStatus.COMPLETED} className="w-full text-left px-4 py-2.5 text-sm hover:bg-red-50 disabled:hover:bg-gray-50 flex items-center gap-2 text-red-500 font-bold disabled:text-gray-300 disabled:cursor-not-allowed">
                          {ICONS.Delete} Cancel Order
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
        {/* On-Screen Invoice Format */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden">
          <div className="p-3 sm:p-4 md:p-6 lg:p-10 space-y-3 sm:space-y-4 lg:space-y-5">
            <div className="flex flex-row justify-between items-start gap-3 sm:gap-4 lg:gap-6">
              <div className="flex-1 min-w-0">
                {(orderBranding?.logo || db.settings.company.logo) && (
                  <img 
                    src={orderBranding?.logo || db.settings.company.logo} 
                    className="rounded-lg object-cover mb-2 sm:mb-3 lg:mb-4 w-auto h-auto"
                    style={{ 
                      maxWidth: 'min(100px, 20%)',
                      maxHeight: 'auto'
                    }}
                  />
                )}
                <h1 className="text-sm sm:text-base lg:text-xl font-black text-blue-600 uppercase tracking-tighter break-words">{orderBranding?.name || db.settings.company.name}</h1>
                <div className="mt-1 sm:mt-2 text-[9px] sm:text-[10px] lg:text-xs text-gray-400 font-medium space-y-0.5 sm:space-y-1">
                  <p className="break-words">{orderBranding?.address || db.settings.company.address}</p>
                  <p className="text-[8px] sm:text-[9px] break-words">{orderBranding?.phone || db.settings.company.phone} • {orderBranding?.email || db.settings.company.email}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <h2 className="text-sm sm:text-2xl lg:text-3xl font-black text-gray-300 uppercase leading-none mb-1 sm:mb-2 break-words">{invoiceSettings?.title || db.settings.invoice.title}</h2>
                <div className="space-y-0.5 sm:space-y-1 lg:space-y-1.5 text-[9px] sm:text-sm">
                  <p className="text-[9px] sm:text-xs lg:text-sm font-bold text-gray-900"><span className="text-gray-400 font-medium">Order No:&nbsp;&nbsp;</span> <span className="break-all">{order.orderNumber}</span></p>
                  <p className="text-[9px] sm:text-xs lg:text-sm font-bold text-gray-900"><span className="text-gray-400 font-medium">Date:&nbsp;&nbsp;</span> {order.orderDate}</p>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100 py-2 sm:py-3 lg:py-4">
              <p className="text-[8px] sm:text-[9px] lg:text-[10px] font-black text-gray-400 uppercase tracking-[0.15em] sm:tracking-[0.2em] mb-2 sm:mb-3 lg:mb-4">Billed To</p>
              <h3 className="text-sm sm:text-base lg:text-lg font-black text-gray-900 break-words">{customer?.name}</h3>
              <p className="text-[10px] sm:text-xs lg:text-sm text-gray-500 leading-relaxed break-words">{customer?.address}</p>
              <p className="text-[10px] sm:text-xs lg:text-sm font-bold text-cyan-600 mt-1 sm:mt-1.5 lg:mt-2 break-words">{customer?.phone}</p>
            </div>

            <div className="overflow-x-auto -mx-3 sm:-mx-4 md:-mx-6 lg:-mx-10">
              <div className="px-3 sm:px-4 md:px-6 lg:px-10">
                <table className="w-full text-left text-[10px] sm:text-xs lg:text-sm">
                  <thead>
                    <tr className="border-b-2 border-gray-100">
                      <th className="py-2 sm:py-3 lg:py-4 font-black text-gray-400 uppercase">Item Description</th>
                      <th className="py-2 sm:py-3 lg:py-4 text-center font-black text-gray-400 uppercase whitespace-nowrap px-1">Rate</th>
                      <th className="py-2 sm:py-3 lg:py-4 text-center font-black text-gray-400 uppercase whitespace-nowrap px-1">Qty</th>
                      <th className="py-2 sm:py-3 lg:py-4 text-right font-black text-gray-400 uppercase whitespace-nowrap px-1">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {order.items.map((item, idx) => {
                      const fallbackItemImage =
                        typeof (item as any)?.productImage === 'string'
                          ? (item as any).productImage
                          : typeof (item as any)?.image === 'string'
                            ? (item as any).image
                            : '';
                      const imageSrc = fallbackItemImage || productImages[String(item.productId || '').trim()] || '';
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
                  <span className="font-bold text-gray-900 flex-shrink-0">{formatCurrency(order.subtotal)}</span>
                </div>
                {order.discount > 0 && (
                  <div className="flex justify-between text-[10px] sm:text-xs lg:text-sm gap-2">
                    <span className="text-gray-400 font-bold uppercase flex-shrink-0">Discount</span>
                    <span className="font-bold text-red-500 flex-shrink-0">-{formatCurrency(order.discount)}</span>
                  </div>
                )}
                {order.shipping > 0 && (
                  <div className="flex justify-between text-[10px] sm:text-xs lg:text-sm gap-2">
                    <span className="text-gray-400 font-bold uppercase flex-shrink-0">Shipping</span>
                    <span className="font-bold text-gray-900 flex-shrink-0">{formatCurrency(order.shipping)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center py-2 sm:py-3 lg:py-4 border-t-2 border-[#0f2f57] gap-2">
                  <span className="font-black text-gray-900 uppercase tracking-tighter text-[11px] sm:text-xs lg:text-sm flex-shrink-0">Net Total</span>
                  <span className="font-black text-sm sm:text-base lg:text-lg flex-shrink-0">{formatCurrency(order.total)}</span>
                </div>
              </div>
            </div>

            {order.notes && (
              <div className="bg-gray-50 p-3 sm:p-4 rounded-[10px] border border-gray-100">
                <p className="text-[8px] sm:text-[9px] lg:text-[10px] font-black text-gray-300 uppercase tracking-widest mb-1 sm:mb-2">Terms & Notes</p>
                <p className="text-[9px] sm:text-[10px] lg:text-xs text-gray-600 font-medium italic leading-relaxed">{order.notes}</p>
              </div>
            )}

          </div>
        </div>

        {/* Sidebar Lifecycle Dropdowns */}
        <div className="space-y-6">
          {/* Create Section */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 bg-gray-50 border-b flex justify-between items-center">
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">1. Creation</h3>
              <div className="p-1 bg-[#ebf4ff]0 text-white rounded-full">{ICONS.Plus}</div>
            </div>
            <div className="p-5">
              <p className="text-xs text-gray-500 leading-relaxed font-medium">
                {order.history.created || `Created by ${createdByUser?.name || 'Unknown'} on ${order.orderDate}`}
              </p>
            </div>
          </div>

          {/* Process Section */}
          {order.history?.processing || canMoveCurrentOrderToProcessing || canSendCurrentOrderToCourier || canUseFraudChecker ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 bg-gray-50 border-b flex justify-between items-center">
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">2. Processing</h3>
              <div className={`p-1 rounded-full ${order.history.processing ? 'bg-[#ebf4ff]0 text-white' : 'bg-gray-200 text-gray-400'}`}>
                {ICONS.ChevronRight}
              </div>
            </div>
            <div className="p-5 space-y-4">
                {canUseFraudChecker && (
                  <button
                    type="button"
                    onClick={openFraudChecker}
                    disabled={!canRunFraudChecker}
                    className={`w-full rounded-xl py-3 font-bold shadow-md transition-all active:scale-95 ${canRunFraudChecker ? 'bg-[#0f2f57] text-white hover:bg-[#0a1f38]' : 'cursor-not-allowed bg-gray-100 text-gray-400 shadow-none'}`}
                  >
                    Check Courier History
                  </button>
                )}
                {order.history.processing ? (
                  <p className="text-xs ${theme.colors.primary[600]} leading-relaxed font-bold bg-[#ebf4ff] p-3 rounded-xl">
                    {order.history.processing}
                  </p>
                ) : (
                  canMoveCurrentOrderToProcessing && (
                    <button 
                      disabled={order.status !== OrderStatus.ON_HOLD}
                      onClick={markProcessing}
                      className={`w-full py-3 ${theme.colors.secondary[600]} hover:${theme.colors.secondary[700]} disabled:bg-gray-100 disabled:text-gray-400 text-white font-bold rounded-xl shadow-md transition-all active:scale-95`}
                    >
                      Mark as Processing
                    </button>
                  )
                )}

                {canUseCourierAutomation && sentToAnyCourier ? (
                  <p className="text-xs text-gray-700 leading-relaxed font-bold bg-gray-50 p-3 rounded-xl">{order.history.courier}</p>
                ) : (
                  canSendCurrentOrderToCourier && (
                    <>
                      <button 
                        onClick={() => setShowSteadfast(true)}
                        className="w-full py-3 bg-[#0f2f57] hover:bg-[#0a1f38] text-white font-bold rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2"
                      >
                        <img src="/uploads/steadfast.png" alt="Steadfast" className="w-5 h-5 rounded-full" /> Add to Steadfast
                      </button>
                      <button 
                        onClick={() => setShowCarryBee(true)}
                        className="w-full py-3 bg-[#0f2f57] hover:bg-[#0a1f38] text-white font-bold rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2"
                      >
                        <img src="/uploads/carrybee.png" alt="CarryBee" className="w-5 h-5 rounded-full" /> Add to CarryBee
                      </button>
                      <button
                        onClick={() => setShowPaperfly(true)}
                        className="w-full py-3 bg-[#0f2f57] hover:bg-[#0a1f38] text-white font-bold rounded-xl shadow-md transition-all active:scale-95 flex items-center justify-center gap-2"
                      >
                        <img src="/uploads/paperfly.png" alt="Paperfly" className="w-5 h-5 rounded-full" /> Add to Paperfly
                      </button>
                    </>
                  )
                )}
            </div>
            </div>
          ) : null}

          {/* Picked Section */}
          {order.history.picked || canMoveCurrentOrderToPickedPermission ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 bg-gray-50 border-b flex justify-between items-center">
              <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">3. Courier Picked</h3>
              <div className={`p-1 rounded-full ${order.history.picked ? 'bg-[#ebf4ff]0 text-white' : 'bg-gray-200 text-gray-400'}`}>
                {ICONS.Courier}
              </div>
            </div>
            <div className="p-5">
                {order.history.picked ? (
                  <p className="text-xs text-purple-600 leading-relaxed font-bold bg-purple-50 p-3 rounded-xl">
                    {order.history.picked}
                  </p>
                ) : (
                  canMoveCurrentOrderToPickedPermission && (
                    <button 
                      disabled={!canMarkCurrentOrderPicked}
                      onClick={markPicked}
                      className="w-full py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-100 disabled:text-gray-400 text-white font-bold rounded-xl shadow-md transition-all active:scale-95"
                    >
                      Mark as Picked
                    </button>
                  )
                )}
            </div>
            </div>
          ) : null}

          {/* Completion Section */}
          {completionHistory || canFinalizeOrders ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-4 bg-gray-50 border-b flex justify-between items-center">
                <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">4. Completion</h3>
                <div className={`p-1 rounded-full ${order.status === OrderStatus.COMPLETED || order.status === OrderStatus.RETURNED ? 'bg-[#ebf4ff]0 text-white' : 'bg-gray-200 text-gray-400'}`}>
                  {ICONS.Check}
                </div>
              </div>
              <div className="p-5 space-y-3">
                {completionHistory ? (
                  <div className="space-y-2">
                    {order.history.completed && (
                      <p className="text-xs ${theme.colors.primary[600]} leading-relaxed font-bold bg-[#ebf4ff] p-3 rounded-xl">
                        {order.history.completed}
                      </p>
                    )}
                    {order.history.payment && (
                      <p className="text-xs text-emerald-600 leading-relaxed font-bold bg-emerald-50 p-3 rounded-xl">
                        {order.history.payment}
                      </p>
                    )}
                    {order.history.returned && (
                      <p className="text-xs text-orange-700 leading-relaxed font-bold bg-orange-50 p-3 rounded-xl">
                        {order.history.returned}
                      </p>
                    )}
                  </div>
                ) : (
                  canFinalizeOrders && (
                    <div className="space-y-4 text-center">
                      <div className="p-4 bg-gray-50 rounded-lg">
                        <p className="text-[10px] font-black text-gray-400 uppercase">Amount Due</p>
                        <p className="text-lg font-black text-gray-900">{formatCurrency(order.total - order.paidAmount)}</p>
                      </div>
                      <button 
                        onClick={openCompletion}
                        disabled={!canFinalizeCurrentOrder}
                        className={`w-full py-3 ${theme.colors.primary[600]} hover:${theme.colors.primary[700]} text-white font-bold rounded-xl shadow-md transition-all active:scale-95`}
                      >
                        Finalize Order
                      </button>
                      {order.status !== OrderStatus.PICKED && (
                        <p className="text-xs font-medium text-gray-400">
                          Picked orders can be finalized as delivered or returned from here.
                        </p>
                      )}
                    </div>
                  )
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <OrderCompletionModal
        isOpen={showCompletionModal}
        onClose={() => setShowCompletionModal(false)}
        onSubmit={handleCompletePickedOrder}
        order={order}
        form={completionForm}
        setForm={setCompletionForm}
        isLoading={completePickedOrderMutation.isPending}
        allowDeliveredOutcome={canMarkCurrentOrderCompleted}
        allowReturnedOutcome={canMarkCurrentOrderReturned}
      />

      {canUseCourierAutomation && (
        <>
          <SteadfastModal 
            isOpen={showSteadfast} 
            onClose={() => setShowSteadfast(false)}
            order={order}
            customer={customer}
          />
          <CarryBeeModal 
            isOpen={showCarryBee} 
            onClose={() => setShowCarryBee(false)}
            order={order}
            customer={customer}
          />
          <PaperflyModal
            isOpen={showPaperfly}
            onClose={() => setShowPaperfly(false)}
            order={order}
            customer={customer}
          />
        </>
      )}
      {canUseFraudChecker && (
        <FraudCheckModal
          isOpen={showFraudCheckModal}
          onClose={() => setShowFraudCheckModal(false)}
          phone={orderPhone}
          customerName={customer?.name || order.customerName || ''}
        />
      )}
    </div>
  );
};

export default OrderDetails;

