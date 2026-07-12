
import React, { useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { db } from '../db';
import { OrderStatus, Order, type ProcessOrderReturnExchangePayload } from '../types';
import { formatCurrency, ICONS, getPaymentStatusBadgeColor, getPaymentStatusLabel, getStatusColor, getStatusDisplayName } from '../constants';
import { Button, Dialog, FraudCheckModal, OrderCompletionModal, CommonPaymentModal, type OrderCompletionFormState, SteadfastModal, CarryBeeModal, PaperflyModal, OrderReturnExchangeModal } from '../components';
import { theme } from '../theme';
import { useAccounts, useOrder, useCustomer, useProductImagesByIds, useCompanySettings, useInvoiceSettings, useUser, usePaymentMethods, useMetaAds, useCourierSettings } from '../src/hooks/useQueries';
import { useUpdateOrder, useCreateOrder, useCompletePickedOrder, useCheckFraudCourierHistory, useDeleteOrder, useCreateTransaction, useProcessOrderReturnExchange } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useAuth } from '../src/contexts/AuthProvider';
import { LoadingOverlay } from '../components';
import { handlePrintOrder } from '../src/utils/printUtils';
import { buildHistoryBackState, getPreservedRouteState } from '../src/utils/navigation';
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
    refundAmount: 0,
    refundAccountId: '',
    refundPaymentMethod: '',
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
  const { data: paymentMethods = [] } = usePaymentMethods();
  const { data: metaAdsData } = useMetaAds({}, true);
  const { data: courierSettings } = useCourierSettings();
  const sourceAdInfo = useMemo(() => {
    if (!order?.sourceAd || !metaAdsData?.ads) return null;
    const ads = Array.isArray(metaAdsData.ads) ? metaAdsData.ads : [];
    return ads.find((ad: any) => ad?.id === order.sourceAd) || null;
  }, [order?.sourceAd, metaAdsData?.ads]);
  
  // Mutations
  const updateMutation = useUpdateOrder();
  const createOrderMutation = useCreateOrder();
  const completePickedOrderMutation = useCompletePickedOrder();
  const deleteOrderMutation = useDeleteOrder();
  const createTransactionMutation = useCreateTransaction();
  const processReturnExchangeMutation = useProcessOrderReturnExchange();
  const [showDeleteOrderConfirmation, setShowDeleteOrderConfirmation] = useState(false);
  const [showReturnExchangeModal, setShowReturnExchangeModal] = useState(false);
  
  const handleDeleteOrder = () => {
    setShowDeleteOrderConfirmation(true);
  };

  const confirmDeleteOrder = async () => {
    if (!order) return;

    try {
      await deleteOrderMutation.mutateAsync(order.id);
      toast.success('Order moved to the recycle bin');
      navigate('/orders', { state: { refreshOrders: true } });
    } catch (err) {
      console.error('Failed to delete order:', err);
      toast.error('Failed to delete order: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  // Modal and form state
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [showSteadfast, setShowSteadfast] = useState(false);
  const [showCarryBee, setShowCarryBee] = useState(false);
  const [showPaperfly, setShowPaperfly] = useState(false);
  const [showFraudCheckModal, setShowFraudCheckModal] = useState(false);
  const [completionForm, setCompletionForm] = useState<OrderCompletionFormState>(createCompletionForm());
  const [isActionOpen, setIsActionOpen] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [showRefundModal, setShowRefundModal] = useState(false);
  const [showStatusTransitionModal, setShowStatusTransitionModal] = useState(false);
  const [showCourierSelectionModal, setShowCourierSelectionModal] = useState(false);
  const [isExchangeConsignment, setIsExchangeConsignment] = useState(false);
  const [courierHistoryData, setCourierHistoryData] = useState<any>(null);
  const courierHistoryMutation = useCheckFraudCourierHistory();
  const [showManualCourierModal, setShowManualCourierModal] = useState(false);
  const [manualCourierNote, setManualCourierNote] = useState('');
  const [isAssigningManualCourier, setIsAssigningManualCourier] = useState(false);
  type OrderStatusTransitionAction = 'confirm' | 'process' | 'assignCourier' | 'pick' | 'complete';
  type OrderStatusTransition = {
    action: OrderStatusTransitionAction;
    label: string;
    nextStatus: OrderStatus;
    historyKey?: keyof Order['history'];
    description: string;
    enabled: boolean;
  };
  type OrderTimelineLabel = 'Created' | 'Processing' | 'Courier assigned' | 'Picked up' | 'Delivered' | 'Exchanged' | 'Exchange pending' | 'Returned' | 'Cancelled';
  type OrderTimelineItem = {
    label: OrderTimelineLabel;
    historyKey: keyof Order['history'];
    description: string;
  };
  const [pendingStatusTransition, setPendingStatusTransition] = useState<OrderStatusTransition | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    date: getTodayDate(),
    time: new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false }),
    accountId: db.settings.defaults.defaultAccountId || '',
    amount: 0,
    paymentMethod: db.settings.defaults.defaultPaymentMethod || '',
  });
  const [refundForm, setRefundForm] = useState({
    date: getTodayDate(),
    time: new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false }),
    accountId: db.settings.defaults.defaultAccountId || '',
    amount: 0,
    paymentMethod: db.settings.defaults.defaultPaymentMethod || '',
  });
  const [expandedSection, setExpandedSection] = useState<Record<string, boolean>>({ status: true });

  const hasExchangedItems = (o?: Order | null) =>
    Boolean(o?.items?.some((item) => (item.exchangedQty ?? 0) > 0));

  const showExchangeTimeline = order?.status === OrderStatus.EXCHANGE_PENDING || hasExchangedItems(order);

  const timelineItems = React.useMemo<OrderTimelineItem[]>(
    () => {
      const items: OrderTimelineItem[] = [
        { label: 'Created', historyKey: 'created', description: 'Order created and held until processing begins.' },
        { label: 'Processing', historyKey: 'processing', description: 'Items are being prepared and packed for shipping.' },
        { label: 'Courier assigned', historyKey: 'courier', description: 'A courier has been assigned to this order.' },
        { label: 'Picked up', historyKey: 'picked', description: 'The courier has picked up the order.' },
        { label: 'Delivered', historyKey: 'completed', description: 'The order has been delivered to the customer.' },
      ];
      if (showExchangeTimeline) {
        items.push(
          { label: 'Exchanged', historyKey: 'completed', description: 'The order has been delivered with exchanged items.' },
          { label: 'Exchange pending', historyKey: 'exchangeCourier', description: 'Exchange items are being shipped to the customer.' },
        );
      }
      items.push(
        { label: 'Returned', historyKey: 'returned', description: 'The order has been returned.' },
        { label: 'Cancelled', historyKey: 'cancelled', description: 'The order has been cancelled and will not be fulfilled.' },
      );
      return items;
    },
    [showExchangeTimeline]
  );

  const getTimelineIndex = (order?: Order) => {
    if (!order) return 0;
    if (order.status === OrderStatus.CANCELLED) return timelineItems.length - 1;
    if (order.status === OrderStatus.RETURNED) return timelineItems.findIndex((item) => item.label === 'Returned');
    if (order.status === OrderStatus.EXCHANGE_PENDING) return timelineItems.findIndex((item) => item.label === 'Exchange pending');
    if (order.status === OrderStatus.COMPLETED) {
      return timelineItems.findIndex((item) => item.label === (hasExchangedItems(order) ? 'Exchanged' : 'Delivered'));
    }
    if (order.status === OrderStatus.PICKED) return timelineItems.findIndex((item) => item.label === 'Picked up');
    if (order.status === OrderStatus.COURIER_ASSIGNED) return timelineItems.findIndex((item) => item.label === 'Courier assigned');
    if (order.status === OrderStatus.PROCESSING) return timelineItems.findIndex((item) => item.label === 'Processing');
    return timelineItems.findIndex((item) => item.label === 'Created');
  };

  const parseHistoryTimestamp = (value?: string | null) => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const candidates: string[] = [raw];

    const onAtMatch = raw.match(/on\s+(.+?)(?:,\s*at\s*|\s+at\s+)(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|a\.m\.|p\.m\.))?)/i);
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

  const formatHistoryTextForTimeline = (value?: string | null) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parsed = parseHistoryTimestamp(line);
        if (!parsed) return line;

        const formattedDate = parsed.toLocaleDateString('en-BD', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
        const formattedTime = parsed.toLocaleTimeString('en-BD', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        });

        const onAtRegex = /(on\s+)(.+?)(,\s*at\s*)(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|a\.m\.|p\.m\.))?)/i;
        const match = line.match(onAtRegex);
        if (match && typeof match.index === 'number') {
          const prefix = line.slice(0, match.index);
          const suffix = line.slice(match.index + match[0].length);
          return `${prefix}${match[1]}${formattedDate}${match[3]}${formattedTime}${suffix}`;
        }

        if (/^\d{4}-\d{2}-\d{2}T/.test(line)) {
          return `${formattedDate}, at ${formattedTime}`;
        }

        return line;
      })
      .join('\n');
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

  const getStatusDisplayName = (status: OrderStatus) => status === OrderStatus.COMPLETED ? 'Delivered' : status;

  const getFinalBranchStatus = (status: OrderStatus): OrderTimelineLabel | null => {
    if (status === OrderStatus.COMPLETED) return hasExchangedItems(order) ? 'Exchanged' : 'Delivered';
    if (status === OrderStatus.EXCHANGE_PENDING) return 'Exchange pending';
    if (status === OrderStatus.RETURNED) return 'Returned';
    if (status === OrderStatus.CANCELLED) return 'Cancelled';
    return null;
  };

  const getTimelineLabel = (item: OrderTimelineItem, index: number) => {
    if (index === timelineIndex) {
      switch (item.label) {
        case 'Created':
          return 'Created';
        case 'Processing':
          return 'Processing';
        case 'Courier assigned':
        case 'Picked up':
          return item.label;
        case 'Delivered':
          return order?.status === OrderStatus.COMPLETED ? 'Delivered' : 'Delivering';
        case 'Exchanged':
          return 'Delivered, Exchanged';
        case 'Exchange pending':
          return 'Exchange pending';
        case 'Returned':
          return order?.status === OrderStatus.RETURNED ? 'Returned' : 'Returning';
        case 'Cancelled':
          return order?.status === OrderStatus.CANCELLED ? 'Cancelled' : 'Cancelling';
        default:
          return item.label;
      }
    }

    if (index < timelineIndex) {
      switch (item.label) {
        case 'Processing':
          return 'Processed';
        default:
          return item.label;
      }
    }

    if (index > timelineIndex) {
      switch (item.label) {
        case 'Processing':
          return 'Process';
        case 'Courier assigned':
          return 'Assign courier';
        case 'Picked up':
          return 'Pick up';
        case 'Delivered':
          return 'Deliver';
        case 'Exchanged':
          return 'Deliver, Exchange';
        case 'Exchange pending':
          return 'Ship exchange';
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

  const getStatusSuffix = (item: OrderTimelineItem, index: number) => {
    if (index > timelineIndex) {
      return '';
    }

    if (!order) return '';

    const isActiveBranchItem = index === timelineIndex && ['Delivered', 'Exchanged', 'Exchange pending', 'Returned', 'Cancelled'].includes(item.label);
    if (index === timelineIndex && !isActiveBranchItem) {
      return '';
    }

    const rawValue = (() => {
      switch (item.label) {
        case 'Created':
          return order.createdAt || order.history?.created;
        case 'Processing':
          return order.processedAt || order.history?.processing;
        case 'Courier assigned':
          return order.history?.courier;
        case 'Picked up':
          return order.history?.picked;
        case 'Delivered':
          return order.completedAt || order.history?.completed;
        case 'Exchanged':
          return order.completedAt || order.history?.completed;
        case 'Exchange pending':
          return order.history?.exchangeCourier || '';
        case 'Returned':
          return order.history?.returned;
        case 'Cancelled':
          return order.history?.cancelled;
        default:
          return item.historyKey ? order.history?.[item.historyKey] : '';
      }
    })();

    const parsed = parseHistoryTimestamp(rawValue);
    if (parsed) {
      return ` (${formatStatusTimestamp(parsed)})`;
    }

    return '';
  };

  const timelineIndex = React.useMemo(
    () => getTimelineIndex(order ?? undefined),
    [order]
  );

  const getOrderProgressPercent = (activeOrder?: Order | null) => {
    if (!activeOrder) return 0;
    if ([OrderStatus.COMPLETED, OrderStatus.EXCHANGE_PENDING, OrderStatus.RETURNED, OrderStatus.CANCELLED].includes(activeOrder.status)) {
      return 100;
    }
    const finalStepIndex = timelineItems.findIndex((item) => item.label === 'Delivered');
    const stepIndex = getTimelineIndex(activeOrder);
    return Math.round((stepIndex / Math.max(1, finalStepIndex)) * 100);
  };

  const orderProgressPercent = getOrderProgressPercent(order);

  const toggleSection = (section: string) => {
    setExpandedSection((current) => ({
      ...current,
      [section]: !current[section],
    }));
  };
  
  const isSectionExpanded = (section: string) => !!expandedSection[section];
  
  // Get customer and created by user from query results
  // `customer` is obtained via `useCustomer` above
  const activityTimelineEntries = React.useMemo(() => {
    if (!order) return [];

    const history = order.history || {};
    const defaultCreated = order.createdAt
      ? `Created by ${createdByUser?.name || order.createdBy} on ${new Date(order.createdAt).toLocaleDateString('en-BD', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}, at ${new Date(order.createdAt).toLocaleTimeString('en-BD', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })}`
      : '';

    // Build timeline entries, expanding multi-line payment history into separate events
    const baseEntries = [
      { key: 'created', label: 'Created', icon: ICONS.Plus, text: history.created || defaultCreated },
      { key: 'processing', label: 'Processing', icon: ICONS.ChevronRight, text: history.processing },
      { key: 'packed', label: 'Packed', icon: ICONS.ChevronRight, text: history.packed },
      { key: 'courier', label: 'Courier assigned', icon: ICONS.Courier, text: history.courier },
      { key: 'picked', label: 'Picked up', icon: ICONS.Check, text: history.picked },
      { key: 'completed', label: 'Delivered', icon: ICONS.Check, text: history.completed },
      { key: 'returned', label: 'Returned', icon: ICONS.Close, text: history.returned },
      { key: 'returnExchange', label: 'Return/Exchange', icon: ICONS.Return, text: history.returnExchange },
      { key: 'exchangeCourier', label: 'Exchange courier', icon: ICONS.Courier, text: history.exchangeCourier },
      { key: 'cancelled', label: 'Cancelled', icon: ICONS.Close, text: history.cancelled },
    ].filter((entry) => entry.text);

    const paymentLines = String(history.payment || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const paymentEntries = paymentLines.map((line, idx) => ({
      key: `payment-${idx}`,
      label: /refund/i.test(line) ? 'Refund' : 'Payment',
      icon: ICONS.Banking,
      text: line,
    }));

    const entries = [...baseEntries, ...paymentEntries]
      .map((entry) => ({
        ...entry,
        text: formatHistoryTextForTimeline(entry.text),
        parsedAt: parseHistoryTimestamp(entry.text),
      }))
      .sort((a, b) => {
        if (a.parsedAt && b.parsedAt) return a.parsedAt.getTime() - b.parsedAt.getTime();
        if (a.parsedAt) return -1;
        if (b.parsedAt) return 1;
        return 0;
      });

    return entries;
  }, [order, createdByUser]);

  const orderBranding = React.useMemo(
    () => getOrderCompanyPage(order ?? undefined, companySettings || db.settings.company),
    [companySettings, order],
  );
  const orderPhone = React.useMemo(
    () => String(customer?.phone || order?.customerPhone || '').trim(),
    [customer?.phone, order?.customerPhone],
  );
  const normalizedOrderPhone = normalizePhoneSearchValue(orderPhone);
  
  const courierHistoryLower = String(order?.history?.courier || '').toLowerCase();
  const sentToSteadfast = courierHistoryLower.includes('steadfast') || !!order?.steadfastConsignmentId;
  const sentToCarryBee = courierHistoryLower.includes('carrybee') || !!order?.carrybeeConsignmentId;
  const sentToPaperfly = courierHistoryLower.includes('paperfly') || !!order?.paperflyTrackingNumber;
  const sentToAnyCourier = sentToSteadfast || sentToCarryBee || sentToPaperfly;

  // Exchange consignment tracking
  const sentToExchangeCourier = Boolean(
    order?.exchangeSteadfastConsignmentId ||
    order?.exchangeCarrybeeConsignmentId ||
    order?.exchangePaperflyTrackingNumber ||
    order?.exchangeCourierHistory
  );

  const preferredCourier = getPreferredCourierFromHistory(order?.history?.courier);
  const isManualCourier = !preferredCourier && Boolean(order?.history?.courier);
  const courierDisplayName = preferredCourier === 'paperfly'
    ? 'Paperfly'
    : preferredCourier === 'carrybee'
      ? 'CarryBee'
      : preferredCourier === 'steadfast'
        ? 'Steadfast'
        : '';
  
  const isCourierConfigured = (courier: 'steadfast' | 'carrybee' | 'paperfly') => {
    if (!courierSettings) return false;
    if (courier === 'steadfast') {
      return !!(courierSettings.steadfast?.apiKey && courierSettings.steadfast?.secretKey);
    }
    if (courier === 'carrybee') {
      return !!(courierSettings.carryBee?.clientId && courierSettings.carryBee?.clientSecret);
    }
    if (courier === 'paperfly') {
      return !!(courierSettings.paperfly?.username && courierSettings.paperfly?.password);
    }
    return false;
  };
  
  const canUseFraudChecker = can('fraudChecker.check') && hasCapability('fraud_checker');
  const isFraudCheckerConfigured = Boolean(courierSettings?.fraudChecker?.apiKey?.trim());
  const canUseCourierAutomation = hasCapability('courier_automation');
  const isValidFraudPhone = /^0\d{10}$/.test(normalizedOrderPhone);
  const canRunFraudChecker = canUseFraudChecker && isFraudCheckerConfigured && isValidFraudPhone;
  const canMoveCurrentOrderToProcessing = order ? canAccessRecord(
    order.createdBy,
    'orders.moveOnHoldToProcessingOwn',
    'orders.moveOnHoldToProcessingAny',
  ) : false;
  const canSendCurrentOrderToCourierPermission = order ? canAccessRecord(
    order.createdBy,
    'orders.sendToCourierOwn',
    'orders.sendToCourierAny',
  ) : false;
  const canMoveCurrentOrderToPickedPermission = order ? canAccessRecord(
    order.createdBy,
    'orders.moveToPickedOwn',
    'orders.moveToPickedAny',
  ) : false;
  const canMarkCurrentOrderCompleted = order ? canAccessRecord(
    order.createdBy,
    'orders.markCompletedOwn',
    'orders.markCompletedAny',
  ) : false;
  const canMarkCurrentOrderReturned = order ? canAccessRecord(
    order.createdBy,
    'orders.markReturnedOwn',
    'orders.markReturnedAny',
  ) : false;
  const canFinalizeOrders = canMarkCurrentOrderCompleted || canMarkCurrentOrderReturned;
  const canCancelCurrentOrder = order ? canAccessRecord(order.createdBy, 'orders.cancelOwn', 'orders.cancelAny') : false;
  const canDeleteCurrentOrder = order ? canAccessRecord(order.createdBy, 'orders.deleteOwn', 'orders.deleteAny') : false;
  const canProcessReturnExchange = order ? canAccessRecord(order.createdBy, 'orders.processReturnExchangeOwn', 'orders.processReturnExchangeAny') : false;
  const canSendCurrentOrderToCourier =
    canSendCurrentOrderToCourierPermission
    && canUseCourierAutomation
    && order?.status !== OrderStatus.PICKED
    && order?.status !== OrderStatus.COMPLETED
    && order?.status !== OrderStatus.EXCHANGE_PENDING
    && order?.status !== OrderStatus.RETURNED
    && order?.status !== OrderStatus.CANCELLED
    && order?.status !== OrderStatus.ON_HOLD
    && !sentToAnyCourier;

  const canAssignExchangeCourier =
    canProcessReturnExchange
    && canUseCourierAutomation
    && order?.status === OrderStatus.EXCHANGE_PENDING
    && !sentToExchangeCourier;

  const statusTransition = useMemo<OrderStatusTransition | null>(() => {
    if (!order) return null;
    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.RETURNED || order.status === OrderStatus.COMPLETED) {
      return null;
    }

    if (order.status === OrderStatus.EXCHANGE_PENDING) {
      if (sentToExchangeCourier) return null; // already shipped
      return {
        action: 'assignCourier' as const,
        label: 'Ship exchange items',
        nextStatus: order.status,
        historyKey: 'exchangeCourier',
        description: 'Assign a courier to ship the replacement items to the customer.',
        enabled: canAssignExchangeCourier,
      };
    }

    const hasConfirmed = Boolean(order.paidAt || order.history?.payment);
    const hasProcessing = order.status === OrderStatus.PROCESSING || order.status === OrderStatus.COURIER_ASSIGNED || Boolean(order.history?.processing);

    // Prefer 'Start processing' for newly created or on-hold orders so the CTA reads
    // as expected in the UI (Created -> Start processing). This allows
    // users to move orders into processing even when there's no explicit
    // payment history recorded yet.
    const isEffectivelyCreated = order.status === OrderStatus.CREATED || order.status === OrderStatus.ON_HOLD;
    if (isEffectivelyCreated && !hasProcessing) {
      return {
        action: 'process' as const,
        label: 'Start processing',
        nextStatus: OrderStatus.PROCESSING,
        historyKey: 'processing',
        description: 'Move the order into processing and begin fulfillment.',
        enabled: canMoveCurrentOrderToProcessing,
      };
    }
    const hasPacked = Boolean(order.history?.packed);
    const hasCourierAssigned = order.status === OrderStatus.COURIER_ASSIGNED || Boolean(order.history?.courier);
    const hasPicked = Boolean(order.history?.picked) || order.status === OrderStatus.PICKED;

    if (!hasConfirmed && (order.status === OrderStatus.CREATED || order.status === OrderStatus.ON_HOLD)) {
      return {
        action: 'confirm' as const,
        label: 'Confirm',
        nextStatus: order.status,
        historyKey: 'payment',
        description: 'Confirm the order and mark payment as verified.',
        enabled: canMoveCurrentOrderToProcessing,
      };
    }

    if (!hasProcessing) {
      return {
        action: 'process' as const,
        label: 'Start processing',
        nextStatus: OrderStatus.PROCESSING,
        historyKey: 'processing',
        description: 'Move the order into processing and begin fulfillment.',
        enabled: canMoveCurrentOrderToProcessing,
      };
    }

    if (!hasCourierAssigned) {
      return {
        action: 'assignCourier' as const,
        label: 'Assign courier',
        nextStatus: order.status,
        historyKey: 'courier',
        description: 'Assign a courier for pickup and delivery.',
        enabled: canSendCurrentOrderToCourier,
      };
    }

    if (!hasPicked && (isManualCourier || !sentToAnyCourier)) {
      return {
        action: 'pick' as const,
        label: 'Mark picked by courier',
        nextStatus: OrderStatus.PICKED,
        historyKey: 'picked',
        description: 'Record when the courier picks up the order.',
        enabled: canMoveCurrentOrderToPickedPermission,
      };
    }

    return {
      action: 'complete' as const,
      label: 'Complete order',
      nextStatus: OrderStatus.COMPLETED,
      description: 'Complete the order by marking it delivered or returned.',
      enabled: canFinalizeOrders,
    };
  }, [order, canMoveCurrentOrderToProcessing, canSendCurrentOrderToCourier, canMoveCurrentOrderToPickedPermission, canFinalizeOrders]);

  // Calculate payment status
  const getPaymentStatus = () => {
    if (!order) return 'Unpaid';
    return getPaymentStatusLabel(order.paidAmount, order.total, order.history);
  };
  
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
      toast.success('Order status updated successfully');
    } catch (err) {
      console.error('Failed to update order status:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to update order status');
    }
  };

  const markConfirmed = async () => {
    if (!canMoveCurrentOrderToProcessing) {
      toast.error('You do not have permission to confirm this order.');
      return;
    }
    const historyText = `Confirmed by ${user.name}, on ${new Date().toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
    await updateStatus(order.status, 'payment', historyText);
  };

  const markProcessing = async () => {
    if (!canMoveCurrentOrderToProcessing) {
      toast.error('You do not have permission to move orders to processing.');
      return;
    }
    const historyText = `Marked as processing by ${user.name}, on ${new Date().toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
    await updateStatus(OrderStatus.PROCESSING, 'processing', historyText);
  };

  const markPacked = async () => {
    if (!canMoveCurrentOrderToProcessing) {
      toast.error('You do not have permission to mark this order packed.');
      return;
    }
    const historyText = `Marked as packed by ${user.name}, on ${new Date().toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
    await updateStatus(order.status, 'packed', historyText);
  };

  const assignCourier = async (details?: string) => {
    if (isExchangeConsignment) {
      // Exchange consignment — don't change status, write to exchangeCourier history
      const noteText = details ? ` ${details.trim()}` : '';
      const historyText = `Exchange courier assigned by ${user.name}, on ${new Date().toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: true })}.${noteText}`;
      await updateMutation.mutateAsync({
        id: order!.id,
        updates: {
          exchangeCourier: 'manual',
          exchangeCourierHistory: noteText.trim() || 'No details',
          history: { ...order!.history, exchangeCourier: historyText },
        },
      });
      return;
    }
    if (!canSendCurrentOrderToCourier) {
      toast.error('You do not have permission to assign a courier to this order.');
      return;
    }
    const noteText = details ? ` ${details.trim()}` : '';
    const historyText = `Courier assigned by ${user.name}, on ${new Date().toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: true })}.${noteText}`;
    await updateStatus(OrderStatus.COURIER_ASSIGNED, 'courier', historyText);
  };

  const loadCourierHistory = () => {
    if (!isFraudCheckerConfigured) {
      toast.warning('Fraud Checker API key is not configured. Enable it in Settings before checking courier history.');
      return;
    }

    if (!isValidFraudPhone) {
      toast.warning('Enter a valid 11-digit phone number starting with 0 to view courier history.');
      return;
    }

    courierHistoryMutation.mutate({ phone: normalizedOrderPhone });
  };

  const openCourierSelectionModal = () => {
    setShowCourierSelectionModal(true);
    if (canRunFraudChecker) {
      loadCourierHistory();
    }
  };

  const closeCourierSelectionModal = () => {
    setShowCourierSelectionModal(false);
    setIsExchangeConsignment(false);
  };

  const handleSelectCourierOption = (option: 'steadfast' | 'carrybee' | 'paperfly' | 'manual') => {
    setShowCourierSelectionModal(false);
    if (option === 'steadfast') {
      setShowSteadfast(true);
    } else if (option === 'carrybee') {
      setShowCarryBee(true);
    } else if (option === 'paperfly') {
      setShowPaperfly(true);
    } else {
      setShowManualCourierModal(true);
    }
  };

  const handleAssignManualCourier = async () => {
    if (!order) return;
    setIsAssigningManualCourier(true);
    try {
      await assignCourier(manualCourierNote.trim() || 'No details');
      setShowManualCourierModal(false);
      setManualCourierNote('');
      setIsExchangeConsignment(false);
      toast.success(isExchangeConsignment ? 'Exchange courier assigned successfully.' : 'Courier assigned successfully.');
    } catch (err) {
      console.error('Failed to assign courier manually:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to assign courier');
    } finally {
      setIsAssigningManualCourier(false);
    }
  };

  const markPicked = async () => {
    if (!canMoveCurrentOrderToPickedPermission) {
      toast.error('You do not have permission to mark orders as picked.');
      return;
    }
    const historyText = `Marked as picked by courier, on ${new Date().toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
    await updateStatus(OrderStatus.PICKED, 'picked', historyText);
  };

  const handleConfirmStatusTransition = async () => {
    if (!pendingStatusTransition) return;
    setShowStatusTransitionModal(false);
    setPendingStatusTransition(null);

    if (pendingStatusTransition.action === 'confirm') {
      await markConfirmed();
    } else if (pendingStatusTransition.action === 'process') {
      await markProcessing();
    } else if (pendingStatusTransition.action === 'assignCourier') {
      setShowCourierSelectionModal(true);
    } else if (pendingStatusTransition.action === 'pick') {
      await markPicked();
    } else if (pendingStatusTransition.action === 'complete') {
      setShowCompletionModal(true);
    }
  };

  const handleCancelStatusTransition = () => {
    setPendingStatusTransition(null);
    setShowStatusTransitionModal(false);
  };

  const getNextStatusTransitionCTA = () => {
    if (!statusTransition) return null;
    const transition = statusTransition;
    return (
      <div className="pt-4">
        <button
          type="button"
          disabled={!transition.enabled}
          onClick={() => {
            if (transition.action === 'assignCourier') {
              if (order?.status === OrderStatus.EXCHANGE_PENDING) {
                setIsExchangeConsignment(true);
              }
              setShowCourierSelectionModal(true);
              return;
            }
            if (transition.action === 'complete' && order?.status === OrderStatus.PICKED) {
              openCompletion();
              return;
            }
            setPendingStatusTransition(transition);
            setShowStatusTransitionModal(true);
          }}
          className={`w-full rounded-xl py-3 text-sm font-bold transition ${transition.enabled ? `${theme.colors.primary[600]} text-white hover:${theme.colors.primary[700]}` : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
        >
          {transition.label}
        </button>
      </div>
    );
  };

  const transitionModalMessage = pendingStatusTransition
    ? `Are you sure you want to ${pendingStatusTransition.label.toLowerCase()}?${pendingStatusTransition.nextStatus && order && pendingStatusTransition.nextStatus !== order.status ? `` : ''}`
    : '';

  const transitionModalConfirmText = pendingStatusTransition?.label || 'Confirm';

  const transitionModalTitle = pendingStatusTransition
    ? `Confirm ${pendingStatusTransition.label}`
    : 'Confirm status change';

  const transitionModalVariant = pendingStatusTransition?.action === 'complete' ? 'warning' : 'info';

  const transitionModalDescription = pendingStatusTransition?.description || 'This action will advance the order to the next stage.';

  const transitionModalFooterText = pendingStatusTransition?.description || '';

  const transitionModalMessageText = pendingStatusTransition?.description || 'This action will advance the order to the next stage.';

  const transitionModalBodyMessage = pendingStatusTransition
    ? `${pendingStatusTransition.description} ${transitionModalMessage}`
    : '';

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

    if (completionForm.outcome === 'Returned') {
      if (!completionForm.accountId) {
        toast.error('Please select an account');
        return;
      }
      if (completionForm.amount <= 0) {
        toast.error('Please enter the return expense amount');
        return;
      }
      if (!completionForm.paymentMethod) {
        toast.error('Please select a payment method');
        return;
      }
      if (!completionForm.categoryId) {
        toast.error('Please select an expense category');
        return;
      }
      const selectedAccount = accounts.find((account) => account.id === completionForm.accountId);
      if (selectedAccount && selectedAccount.currentBalance < completionForm.amount) {
        toast.error(
          `${selectedAccount.name} does not have enough balance for this return. Available ${formatCurrency(selectedAccount.currentBalance)}, required ${formatCurrency(completionForm.amount)}.`
        );
        return;
      }

      // Validate refund fields if a refund amount is entered
      if (completionForm.refundAmount > 0) {
        if (!completionForm.refundAccountId) {
          toast.error('Please select a refund account');
          return;
        }
        if (!completionForm.refundPaymentMethod) {
          toast.error('Please select a refund payment method');
          return;
        }
        if (completionForm.refundAmount > order.paidAmount) {
          toast.error(`Refund amount cannot exceed the amount already paid (${formatCurrency(order.paidAmount)})`);
          return;
        }
      }
    }

    const fullDatetime = buildLocalDateTime(completionForm.date, completionForm.time);
    if (!fullDatetime) {
      toast.error('Please enter a valid date and time');
      return;
    }

    try {
      const payload: any = {
        orderId: order.id,
        outcome: completionForm.outcome,
        date: fullDatetime.toISOString(),
      };
      if (completionForm.outcome === 'Returned') {
        payload.accountId = completionForm.accountId;
        payload.amount = completionForm.amount;
        payload.paymentMethod = completionForm.paymentMethod;
        payload.categoryId = completionForm.categoryId;
        payload.note = completionForm.note;
        if (completionForm.refundAmount > 0) {
          payload.refundAmount = completionForm.refundAmount;
          payload.refundAccountId = completionForm.refundAccountId;
          payload.refundPaymentMethod = completionForm.refundPaymentMethod;
        }
      }
      const updatedOrder = await completePickedOrderMutation.mutateAsync(payload);

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

  const openPayment = () => {
    if (!order) return;

    setPaymentForm({
      date: getTodayDate(),
      time: new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false }),
      accountId: db.settings.defaults.defaultAccountId || '',
      amount: Math.max(order.total - order.paidAmount, 0),
      paymentMethod: db.settings.defaults.defaultPaymentMethod || paymentMethods[0]?.name || '',
    });
    setShowPaymentModal(true);
  };

  const openRefund = () => {
    if (!order) return;

    setRefundForm({
      date: getTodayDate(),
      time: new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false }),
      accountId: db.settings.defaults.defaultAccountId || '',
      amount: Math.max(order.paidAmount, 0),
      paymentMethod: db.settings.defaults.defaultPaymentMethod || paymentMethods[0]?.name || '',
    });
    setShowRefundModal(true);
  };

  const appendHistoryEntry = (history: Partial<Order['history']> | undefined, eventText: string): Order['history'] => {
    const existingPaymentHistory = String(history?.payment || '').trim();
    const base = {
      created: String(history?.created || ''),
      courier: history?.courier,
      processing: history?.processing,
      packed: history?.packed,
      picked: history?.picked,
      completed: history?.completed,
      returned: history?.returned,
      cancelled: history?.cancelled,
    } as Order['history'];

    if (!existingPaymentHistory) {
      return { ...base, payment: eventText };
    }

    return { ...base, payment: `${existingPaymentHistory}\n${eventText}` };
  };

  const handleAddPayment = async () => {
    if (!order) return;

    if (!paymentForm.accountId) {
      toast.error('Please select an account');
      return;
    }
    if (paymentForm.amount <= 0) {
      toast.error('Please enter an amount to record payment');
      return;
    }

    try {
      const fullDatetime = buildLocalDateTime(paymentForm.date, paymentForm.time) || new Date();
      const isoDatetime = fullDatetime.toISOString();
      const selectedAccount = accounts.find((account) => account.id === paymentForm.accountId);
      const paymentMethod = paymentForm.paymentMethod || db.settings.defaults.defaultPaymentMethod || 'Cash';
      const historyText = `Payment of ${formatCurrency(paymentForm.amount)} received by ${user.name} via ${paymentMethod} in ${selectedAccount?.name || 'Unknown account'} on ${fullDatetime.toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${fullDatetime.toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: true })}`;

      // Create income transaction for this payment
      const incomeTxn = {
        date: isoDatetime,
        type: 'Income' as const,
        category: db.settings.defaults.incomeCategoryId || 'income_sales',
        accountId: paymentForm.accountId,
        amount: paymentForm.amount,
        description: `Payment for Order #${order.orderNumber}`,
        referenceId: order.id,
        contactId: order.customerId,
        paymentMethod,
        createdBy: user.id,
      };
      const createdTransaction = await createTransactionMutation.mutateAsync(incomeTxn as any);

      const updates: Partial<Order> = {
        paidAmount: order.paidAmount + paymentForm.amount,
        history: appendHistoryEntry(order.history, historyText) as any,
      };

      await updateMutation.mutateAsync({ id: id!, updates });
      setShowPaymentModal(false);
      if (createdTransaction?.approvalStatus === 'pending') {
        toast.info('Payment recorded, and the income transaction is waiting for admin approval.');
      } else {
        toast.success('Payment recorded successfully');
      }
    } catch (err) {
      console.error('Failed to record payment:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to record payment');
    }
  };

  const handleRefund = async () => {
    if (!order) return;

    if (!refundForm.accountId) {
      toast.error('Please select an account');
      return;
    }
    if (refundForm.amount <= 0) {
      toast.error('Please enter an amount to record refund');
      return;
    }
    if (refundForm.amount > order.paidAmount) {
      toast.error('Refund amount cannot be greater than the total amount received');
      return;
    }

    try {
      const fullDatetime = buildLocalDateTime(refundForm.date, refundForm.time) || new Date();
      const isoDatetime = fullDatetime.toISOString();
      const selectedAccount = accounts.find((account) => account.id === refundForm.accountId);
      const paymentMethod = refundForm.paymentMethod || db.settings.defaults.defaultPaymentMethod || 'Cash';
      const historyText = `Refund of ${formatCurrency(refundForm.amount)} issued by ${user.name} via ${paymentMethod} in ${selectedAccount?.name || 'Unknown account'} on ${fullDatetime.toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' })}, at ${fullDatetime.toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
      const updates: any = {
        paidAmount: Math.max(order.paidAmount - refundForm.amount, 0),
        paidAt: isoDatetime,
        history: appendHistoryEntry(order.history, historyText) as any,
        refundAmount: refundForm.amount,
        refundAccountId: refundForm.accountId,
        refundPaymentMethod: paymentMethod,
      };

      await updateMutation.mutateAsync({ id: id!, updates });
      setShowRefundModal(false);
      toast.success('Refund recorded successfully');
    } catch (err) {
      console.error('Failed to record refund:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to record refund');
    }
  };

  const openCompletion = () => {
    const baseForm = createCompletionForm(order);
    setCompletionForm({
      ...baseForm,
      outcome: canMarkCurrentOrderCompleted ? 'Delivered' : 'Returned',
      amount: !canMarkCurrentOrderCompleted && order ? order.shipping : baseForm.amount,
      refundAmount: order && order.paidAmount > 0 ? order.paidAmount : 0,
      refundAccountId: baseForm.accountId,
      refundPaymentMethod: baseForm.paymentMethod,
    });
    setShowCompletionModal(true);
  };

  const handleProcessReturnExchange = async (payload: ProcessOrderReturnExchangePayload) => {
    try {
      const updatedOrder = await processReturnExchangeMutation.mutateAsync(payload);
      setShowReturnExchangeModal(false);
      if ((updatedOrder.pendingTransactionCount || 0) > 0) {
        toast.info(
          `Return/exchange processed. ${updatedOrder.pendingTransactionCount} transaction${updatedOrder.pendingTransactionCount === 1 ? '' : 's'} sent for admin approval.`
        );
      } else {
        toast.success('Return/exchange processed successfully');
      }
    } catch (err) {
      console.error('Failed to process return/exchange:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to process return/exchange');
    }
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
        history: { created: `${user.name} created this order as duplicate on ${new Date().toLocaleDateString('en-BD')}, at ${new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: true })}` }
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

  const canMarkCurrentOrderPicked = canMoveCurrentOrderToPickedPermission && (order.status === OrderStatus.PROCESSING || order.status === OrderStatus.COURIER_ASSIGNED);
  const canFinalizeCurrentOrder = canFinalizeOrders && order.status === OrderStatus.PICKED;
  const canShowActionsMenu =
    canEditCurrentOrder
    || canFinalizeCurrentOrder
    || (sentToAnyCourier && canUseCourierAutomation)
    || canCancelCurrentOrder
    || canDeleteCurrentOrder
    || canUseFraudChecker
    || canProcessReturnExchange
    || canAssignExchangeCourier;

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
            {getStatusDisplayName(order.status)}
          </span>
          {canUseCourierAutomation && (order.status === OrderStatus.COURIER_ASSIGNED || order.status === OrderStatus.PICKED) && sentToSteadfast && (
            <img src="/uploads/steadfast.png" alt="Steadfast" className="w-6 h-6 rounded-full" />
          )}
          {canUseCourierAutomation && (order.status === OrderStatus.COURIER_ASSIGNED || order.status === OrderStatus.PICKED) && sentToCarryBee && (
            <img src="/uploads/carrybee.png" alt="CarryBee" className="w-6 h-6 rounded-full" />
          )}
          {canUseCourierAutomation && (order.status === OrderStatus.COURIER_ASSIGNED || order.status === OrderStatus.PICKED) && sentToPaperfly && (
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
                        {ICONS.Check} Complete Order
                      </button>
                    )}
                    {canProcessReturnExchange && order.status === OrderStatus.COMPLETED && (
                      <button className="w-full text-left px-4 py-2.5 text-sm hover:bg-orange-50 flex items-center gap-2 font-bold text-orange-700" onClick={() => { setShowReturnExchangeModal(true); setIsActionOpen(false); }}>
                        {ICONS.Return} Return / Exchange
                      </button>
                    )}
                    {canAssignExchangeCourier && (
                      <button className="w-full text-left px-4 py-2.5 text-sm hover:bg-amber-50 flex items-center gap-2 font-bold text-amber-700" onClick={() => { setIsExchangeConsignment(true); setShowCourierSelectionModal(true); setIsActionOpen(false); }}>
                        {ICONS.Courier} Ship exchange items
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
                          {ICONS.Close} Cancel Order
                        </button>
                      </>
                    )}
                    {canDeleteCurrentOrder && (
                      <>
                        <div className="border-t my-1"></div>
                        <button onClick={() => { handleDeleteOrder(); setIsActionOpen(false); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-red-50 flex items-center gap-2 text-red-600 font-bold">
                          {ICONS.Delete} Delete Order
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
                    className="rounded-lg object-contain mb-2 sm:mb-3 lg:mb-4"
                    width={invoiceSettings?.logoWidth || db.settings.invoice.logoWidth}
                    height={invoiceSettings?.logoHeight || db.settings.invoice.logoHeight}
                    style={{
                      width: invoiceSettings?.logoWidth || db.settings.invoice.logoWidth,
                      height: invoiceSettings?.logoHeight || db.settings.invoice.logoHeight,
                    }}
                    alt="Company Logo"
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
              <p className="text-[10px] sm:text-xs lg:text-sm font-bold text-gray-900 mt-1 sm:mt-1.5 lg:mt-2 break-words">{customer?.phone}</p>
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
                      const returnedQty = item.returnedQty ?? 0;
                      const exchangedQty = item.exchangedQty ?? 0;
                      const activeQty = Math.max(0, item.quantity - returnedQty - exchangedQty);
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
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  {returnedQty > 0 && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-orange-100 text-orange-700">
                                      Returned ×{returnedQty}
                                    </span>
                                  )}
                                  {exchangedQty > 0 && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold bg-blue-100 text-blue-700">
                                      Exchanged ×{exchangedQty}
                                    </span>
                                  )}
                                </div>
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
                  <span className="font-bold text-gray-900 flex-shrink-0">{formatCurrency(order.subtotal)}</span>
                </div>
                <div className="flex justify-between text-[10px] sm:text-xs lg:text-sm gap-2">
                  <span className="text-gray-400 font-bold uppercase flex-shrink-0">Discount</span>
                  <span className="font-bold text-emerald-600 flex-shrink-0">-{formatCurrency(order.discount)}</span>
                </div>
                <div className="flex justify-between text-[10px] sm:text-xs lg:text-sm gap-2">
                  <span className="text-gray-400 font-bold uppercase flex-shrink-0">Shipping</span>
                  <span className="font-bold text-gray-900 flex-shrink-0">{formatCurrency(order.shipping)}</span>
                </div>
                <div className="flex justify-between items-center py-2 sm:py-3 lg:py-4 border-t-2 border-[#0f2f57] gap-2">
                  <span className="font-black text-gray-900 uppercase tracking-tighter text-xs sm:text-base lg:text-base flex-shrink-0">Net Total</span>
                  <span className="font-black text-gray-900 text-xs sm:text-base lg:text-base flex-shrink-0">{formatCurrency(order.total)}</span>
                </div>
              </div>
            </div>

            {order.notes && (
              <div className="bg-gray-50 p-3 sm:p-4 rounded-[10px] border border-gray-100">
                <p className="text-[8px] sm:text-[9px] lg:text-[10px] font-black text-gray-300 uppercase tracking-widest mb-1 sm:mb-2">Terms & Notes</p>
                <p className="text-[9px] sm:text-[10px] lg:text-xs text-gray-600 font-medium italic leading-relaxed">{order.notes}</p>
              </div>
            )}

            {(invoiceSettings?.footer || db.settings.invoice.footer) && (
              <div className="bg-gray-50 p-3 sm:p-4 rounded-[10px] border border-gray-100">
                <p className="text-[9px] sm:text-[10px] lg:text-sm text-gray-500 font-medium leading-relaxed whitespace-pre-line">
                  {invoiceSettings?.footer || db.settings.invoice.footer}
                </p>
              </div>
            )}

          </div>
        </div>

        {/* Sidebar Payment Section */}
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
                    <span className="font-bold text-gray-900">{formatCurrency(order.total)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-t border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">Received</span>
                    <span className="font-bold text-emerald-600">{formatCurrency(order.paidAmount)}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-t border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">Due Amount</span>
                    <span className={`font-bold ${order.total - order.paidAmount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {formatCurrency(Math.max(order.total - order.paidAmount, 0))}
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
                    disabled={getPaymentStatus() === 'Refunded'}
                    className={`w-full py-2.5 ${theme.colors.primary[600]} hover:${theme.colors.primary[700]} text-white font-bold rounded-lg shadow-md transition-all active:scale-95 text-sm disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    Add Payment
                  </button>
                  <button
                    type="button"
                    onClick={openRefund}
                    disabled={order.paidAmount <= 0}
                    className="w-full py-2.5 border border-orange-200 text-orange-600 hover:bg-orange-50 font-bold rounded-lg transition-all active:scale-95 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Issue Refund
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Order Progress Section */}
          {order ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden">
              <button
                type="button"
                className="w-full px-5 py-4 bg-gray-50 border-b flex justify-between items-center text-left"
                onClick={() => toggleSection('status')}
                aria-expanded={isSectionExpanded('status')}
              >
                <h3 className="text-sm font-black text-black uppercase tracking-widest">
                  Order Progress ({orderProgressPercent}%)
                </h3>
                <div className="flex items-center gap-2">
                  <div className={`p-1 rounded-full ${order.status !== OrderStatus.ON_HOLD ? 'bg-white text-black' : 'bg-gray-200 text-gray-400'}`}>
                    {ICONS.Check}
                  </div>
                  <div className={`transition-transform duration-200 ${isSectionExpanded('status') ? 'rotate-90' : ''}`}>
                    {ICONS.ChevronRight}
                  </div>
                </div>
              </button>
              {isSectionExpanded('status') && (
                <div className="p-4 space-y-3">
                  <div>
                    <div className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
                      <span>Progress</span>
                      <span>{orderProgressPercent}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${orderProgressPercent}%` }}
                      />
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    {timelineItems.map((item, index) => {
                      const branchStatus = getFinalBranchStatus(order?.status ?? OrderStatus.CREATED);
                      const isBranchItem = item.label === 'Delivered' || item.label === 'Exchanged' || item.label === 'Exchange pending' || item.label === 'Returned' || item.label === 'Cancelled';
                      const isUnavailableBranch = Boolean(branchStatus && isBranchItem && item.label !== branchStatus);
                      if (isUnavailableBranch) return null;
                      const isActive = index === timelineIndex;
                      const isPast = !isBranchItem && index < timelineIndex;
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
          ) : null}

          {/* Metadata Section */}
          {order ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden">
              <button
                type="button"
                className="w-full px-5 py-4 bg-gray-50 border-b flex justify-between items-center text-left"
                onClick={() => toggleSection('metadata')}
                aria-expanded={isSectionExpanded('metadata')}
              >
                <h3 className="text-sm font-black text-black uppercase tracking-widest">Metadata</h3>
                <div className={`transition-transform duration-200 ${isSectionExpanded('metadata') ? 'rotate-90' : ''}`}>
                  {ICONS.ChevronRight}
                </div>
              </button>
              {isSectionExpanded('metadata') && (
                <div className="p-4 space-y-4">
                  {/* Ad Information */}
                  {sourceAdInfo ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/meta-ads/${sourceAdInfo.id}`, { state: buildHistoryBackState(location, { backLabel: order?.orderNumber || order?.id }) })}
                      className="w-full text-left bg-blue-50 border border-blue-100 rounded-lg p-3 transition hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                    >
                      <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-2">Source Ad</p>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-gray-900">{sourceAdInfo.name}</p>
                        <p className="text-xs text-gray-600">ID: {sourceAdInfo.id}</p>
                        {sourceAdInfo.platformName && (
                          <p className="text-xs text-gray-600">Platform: {sourceAdInfo.platformName}</p>
                        )}
                      </div>
                    </button>
                  ) : (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Source Ad</p>
                      <p className="text-sm text-gray-600">No source ad assigned</p>
                    </div>
                  )}
                  
                  {/* Courier History Button */}
                  {canUseFraudChecker && (
                    <>
                      <Button
                        type="button"
                        onClick={loadCourierHistory}
                        disabled={!canRunFraudChecker || courierHistoryMutation.isPending}
                        variant="ghost"
                        className="w-full justify-center rounded-lg border border-orange-100 bg-orange-50 text-orange-700 hover:bg-orange-100"
                        loading={courierHistoryMutation.isPending}
                      >
                        {courierHistoryMutation.isPending ? 'Loading Courier History...' : 'View Courier History'}
                      </Button>
                      {!isFraudCheckerConfigured ? (
                        <p className="text-xs text-amber-700 mt-2">Fraud Checker module is not available in your plan.</p>
                      ) : !isValidFraudPhone ? (
                        <p className="text-xs text-amber-700 mt-2">Enter a valid 11-digit phone number starting with 0 to view courier history.</p>
                      ) : null}
                    </>
                  )}
                  
                  {courierHistoryMutation.error ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                      {courierHistoryMutation.error.message}
                    </div>
                  ) : null}

                  {/* Courier History Display */}
                  {courierHistoryMutation.data?.summary && (
                    <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                      <p className="text-xs font-bold text-gray-600 uppercase tracking-widest">Courier Statistics</p>
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                          <p className="text-lg font-black text-gray-900">{courierHistoryMutation.data.summary.totalParcel}</p>
                          <p className="text-xs text-gray-600 mt-1">Total Orders</p>
                        </div>
                        <div>
                          <p className="text-lg font-black text-emerald-600">{courierHistoryMutation.data.summary.successParcel}</p>
                          <p className="text-xs text-gray-600 mt-1">Delivered</p>
                        </div>
                        <div>
                          <p className="text-lg font-black text-red-600">{courierHistoryMutation.data.summary.cancelledParcel}</p>
                          <p className="text-xs text-gray-600 mt-1">Cancelled</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : null}



        </div>
      </div>

      {/* Activity Timeline Section - Full Width */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden">
        <div className="px-5 py-4 bg-gray-50 border-b">
          <h3 className="text-sm font-black text-gray-900 uppercase tracking-widest">Activity Timeline</h3>
        </div>
        <div className="p-5 space-y-4">
          {activityTimelineEntries.length > 0 ? (
            activityTimelineEntries.map((entry) => (
              <div key={entry.key} className="flex gap-3 pb-4 border-b border-gray-100 last:border-b-0 last:pb-0 items-center">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-8 w-8 rounded-full bg-gray-100 text-gray-600">
                    {entry.icon}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-700 leading-relaxed font-medium">{entry.text}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-xs text-gray-400 text-center py-4">No activity recorded yet</p>
          )}
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

      <CommonPaymentModal
        isOpen={showPaymentModal}
        onClose={() => setShowPaymentModal(false)}
        onSubmit={handleAddPayment}
        accounts={accounts}
        paymentForm={paymentForm}
        setPaymentForm={setPaymentForm}
        paymentMethods={paymentMethods}
        isLoading={updateMutation.isPending}
        title="Add Payment"
        buttonText="Save Payment"
        hideDateTime
      />

      <CommonPaymentModal
        isOpen={showRefundModal}
        onClose={() => setShowRefundModal(false)}
        onSubmit={handleRefund}
        accounts={accounts}
        paymentForm={refundForm}
        setPaymentForm={setRefundForm}
        paymentMethods={paymentMethods}
        isLoading={updateMutation.isPending}
        title="Issue Refund"
        buttonText="Save Refund"
        hideDateTime
      />

      <Dialog
        isOpen={showStatusTransitionModal}
        onClose={handleCancelStatusTransition}
        onConfirm={handleConfirmStatusTransition}
        title={transitionModalTitle}
        message={transitionModalBodyMessage || 'Confirm this status change.'}
        confirmText={transitionModalConfirmText}
        cancelText="Cancel"
        variant={transitionModalVariant}
      />

      <Dialog
        isOpen={showDeleteOrderConfirmation}
        onClose={() => setShowDeleteOrderConfirmation(false)}
        onConfirm={async () => {
          await confirmDeleteOrder();
          setShowDeleteOrderConfirmation(false);
        }}
        title="Delete Order"
        message="Move this order to the recycle bin? You can restore it later."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      {showCourierSelectionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={closeCourierSelectionModal} />
          <div className="relative w-full max-w-lg rounded-3xl bg-white shadow-2xl overflow-hidden animate-in fade-in scale-in-100 duration-300 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Assign Courier</h2>
                <p className="text-sm text-gray-500">Choose a courier service or assign manually.</p>
              </div>
              <button onClick={closeCourierSelectionModal} className="text-gray-400 hover:text-gray-600 text-3xl leading-none flex-shrink-0">×</button>
            </div>
            
            {/* Courier History Section */}
            {courierHistoryMutation.data && (
              <div className="border-b border-gray-100 p-6 bg-gray-50">
                <h3 className="text-sm font-bold text-gray-700 uppercase tracking-widest mb-4">Customer Courier History</h3>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-black text-gray-900">{courierHistoryMutation.data.summary?.totalParcel || 0}</p>
                    <p className="text-xs text-gray-500 font-medium mt-1">Total Orders</p>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-emerald-600">{courierHistoryMutation.data.summary?.successParcel || 0}</p>
                    <p className="text-xs text-gray-500 font-medium mt-1">Delivered</p>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-red-600">{courierHistoryMutation.data.summary?.cancelledParcel || 0}</p>
                    <p className="text-xs text-gray-500 font-medium mt-1">Cancelled</p>
                  </div>
                </div>
              </div>
            )}
            
            <div className="space-y-4 p-6">
              {isCourierConfigured('steadfast') && (
                <Button
                  type="button"
                  onClick={() => handleSelectCourierOption('steadfast')}
                  variant="ghost"
                  size="md"
                  className="w-full justify-start gap-3 rounded-2xl border border-gray-200 bg-slate-50 px-5 py-4 text-left text-sm font-semibold text-slate-900 hover:bg-slate-100"
                >
                  <img src="/uploads/steadfast.png" alt="Steadfast" className="h-6 w-6 rounded-full" />
                  <span>Steadfast</span>
                </Button>
              )}
              {isCourierConfigured('carrybee') && (
                <Button
                  type="button"
                  onClick={() => handleSelectCourierOption('carrybee')}
                  variant="ghost"
                  size="md"
                  className="w-full justify-start gap-3 rounded-2xl border border-gray-200 bg-slate-50 px-5 py-4 text-left text-sm font-semibold text-slate-900 hover:bg-slate-100"
                >
                  <img src="/uploads/carrybee.png" alt="CarryBee" className="h-6 w-6 rounded-full" />
                  <span>CarryBee</span>
                </Button>
              )}
              {isCourierConfigured('paperfly') && (
                <Button
                  type="button"
                  onClick={() => handleSelectCourierOption('paperfly')}
                  variant="ghost"
                  size="md"
                  className="w-full justify-start gap-3 rounded-2xl border border-gray-200 bg-slate-50 px-5 py-4 text-left text-sm font-semibold text-slate-900 hover:bg-slate-100"
                >
                  <img src="/uploads/paperfly.png" alt="Paperfly" className="h-6 w-6 rounded-full" />
                  <span>Paperfly</span>
                </Button>
              )}
              <Button
                type="button"
                onClick={() => handleSelectCourierOption('manual')}
                variant="ghost"
                size="md"
                className="w-full justify-start gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 text-left text-sm font-semibold text-slate-900 hover:bg-gray-50"
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-slate-600">+</span>
                <span>Other / Manual courier assignment</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {showManualCourierModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/40" onClick={() => setShowManualCourierModal(false)} />
          <div className="relative w-full max-w-2xl rounded-3xl bg-white shadow-2xl overflow-hidden animate-in fade-in scale-in-100 duration-300">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Manual Courier Assignment</h2>
                <p className="text-sm text-gray-500">Add a note and assign the order to a courier manually.</p>
              </div>
              <button onClick={() => setShowManualCourierModal(false)} className="text-gray-400 hover:text-gray-600 text-3xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <label className="block text-sm font-semibold text-gray-700">Courier assignment details <span className="text-gray-400 font-normal">(optional)</span></label>
              <textarea
                value={manualCourierNote}
                onChange={(e) => setManualCourierNote(e.target.value)}
                rows={5}
                className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                placeholder="Enter courier name, pickup instructions, or booking reference"
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  onClick={() => setShowManualCourierModal(false)}
                  variant="ghost"
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleAssignManualCourier}
                  variant="primary"
                  className="w-full sm:w-auto"
                  loading={isAssigningManualCourier}
                  disabled={isAssigningManualCourier}
                >
                  {isAssigningManualCourier ? 'Assigning...' : 'Assign Courier'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {canUseCourierAutomation && (
        <>
          <SteadfastModal
            isOpen={showSteadfast}
            onClose={() => { setShowSteadfast(false); setIsExchangeConsignment(false); }}
            order={order}
            customer={customer}
            isExchangeConsignment={isExchangeConsignment}
          />
          <CarryBeeModal
            isOpen={showCarryBee}
            onClose={() => { setShowCarryBee(false); setIsExchangeConsignment(false); }}
            order={order}
            customer={customer}
            isExchangeConsignment={isExchangeConsignment}
          />
          <PaperflyModal
            isOpen={showPaperfly}
            onClose={() => { setShowPaperfly(false); setIsExchangeConsignment(false); }}
            order={order}
            customer={customer}
            isExchangeConsignment={isExchangeConsignment}
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

      <OrderReturnExchangeModal
        isOpen={showReturnExchangeModal}
        onClose={() => setShowReturnExchangeModal(false)}
        onSubmit={handleProcessReturnExchange}
        order={order}
        isLoading={processReturnExchangeMutation.isPending}
      />
    </div>
  );
};

export default OrderDetails;

