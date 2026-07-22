
import React, { useMemo, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '../db';
import { OrderStatus, Order, type ProcessOrderReturnExchangePayload, type ConfirmationStatus } from '../types';
import { formatCurrency, ICONS, getPaymentStatusBadgeColor, getPaymentStatusLabel, getStatusColor, getStatusDisplayName } from '../constants';
import { Button, Dialog, FraudCheckModal, OrderCompletionModal, CommonPaymentModal, type OrderCompletionFormState, SteadfastModal, CarryBeeModal, PaperflyModal, PathaoModal, OrderReturnExchangeModal, ConfirmationStatusDot } from '../components';
import { theme, resolveThemeColorPalette } from '../theme';
import { useAccounts, useOrder, useOrderSurveyStatus, useCustomer, useProductImagesByIds, useCompanySettings, useInvoiceSettings, useUser, usePaymentMethods, useMetaAds, useCourierSettings, useSystemDefaults } from '../src/hooks/useQueries';
import { useUpdateOrder, useCreateOrder, useCompletePickedOrder, useCheckFraudCourierHistory, useDeleteOrder, useProcessOrderReturnExchange, useTriggerSurveyCall, useRetrySurveyCall, useCancelSurveyCall } from '../src/hooks/useMutations';
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
  formatDate,
  formatDateTime,
  formatDateTimeParts,
  getPaperflyReferenceNumber,
  getPreferredCourierFromHistory,
  getTodayDate,
  normalizePhoneSearchValue,
} from '../utils';
import { getOrderCompanyPage } from '../src/utils/companyPages';

const OrderDetails: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const { data: storedOrder, isPending: orderLoading, error: orderError } = useOrder(id || '');
  const hasSurvey = Boolean(storedOrder?.surveyStatus || storedOrder?.surveyEvents?.length);
  const { data: liveSurvey } = useOrderSurveyStatus(id || '', hasSurvey);
  const order = useMemo(() => (
    storedOrder && liveSurvey ? { ...storedOrder, ...liveSurvey } : storedOrder
  ), [storedOrder, liveSurvey]);
  const { data: customer } = useCustomer(order ? order.customerId : undefined);
  const { data: createdByUser } = useUser(order?.createdBy);
  const orderItemProductIds = useMemo(
    () => Array.from(new Set((order?.items || []).map((item) => String(item?.productId || '').trim()).filter(Boolean))),
    [order?.items]
  );
  const { data: productImages = {} } = useProductImagesByIds(orderItemProductIds);
  const { data: companySettings } = useCompanySettings();
  const { data: invoiceSettings } = useInvoiceSettings();
  const { data: systemDefaults } = useSystemDefaults();
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
  const processReturnExchangeMutation = useProcessOrderReturnExchange();
  const triggerSurveyCallMutation = useTriggerSurveyCall();
  const retrySurveyCallMutation = useRetrySurveyCall();
  const cancelSurveyCallMutation = useCancelSurveyCall();
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
      toast.error(err instanceof Error ? err.message : 'Could not delete the order. Please try again.');
    }
  };

  // Modal and form state
  const [showCompletionModal, setShowCompletionModal] = useState(false);
  const [showSteadfast, setShowSteadfast] = useState(false);
  const [showCarryBee, setShowCarryBee] = useState(false);
  const [showPaperfly, setShowPaperfly] = useState(false);
  const [showPathao, setShowPathao] = useState(false);
  const [showFraudCheckModal, setShowFraudCheckModal] = useState(false);
  const [showSurveyIndicatorTooltip, setShowSurveyIndicatorTooltip] = useState(false);
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

  const isBusinessGrowthEnabled = hasCapability('grow_your_business');
  const currentCustomerPhone = normalizePhoneSearchValue(customer?.phone || order?.customerPhone || '');
  const storedFraudPhone = normalizePhoneSearchValue(customer?.fraudCheckPhone || '');
  const storedFraudResult = customer?.fraudCheckResult && (!storedFraudPhone || storedFraudPhone === currentCustomerPhone)
    ? customer.fraudCheckResult
    : null;
  const activeFraudResult = courierHistoryMutation.data || storedFraudResult;
  const fraudPercentage = courierHistoryMutation.data?.summary?.successRatio
    ?? (storedFraudResult ? (customer?.fraudCheckPercentage ?? storedFraudResult.summary.successRatio) : null);

  React.useEffect(() => {
    if (!isBusinessGrowthEnabled || !order?.customerId) return;
    const orderCreatedAt = order.createdAt ? new Date(order.createdAt).getTime() : 0;
    const checkedAt = customer?.fraudCheckedAt ? new Date(customer.fraudCheckedAt).getTime() : 0;
    if (checkedAt >= orderCreatedAt && checkedAt > 0) return;

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      queryClient.invalidateQueries({ queryKey: ['customer', order.customerId] });
      if (attempts >= 10) window.clearInterval(timer);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [isBusinessGrowthEnabled, order?.customerId, order?.createdAt, customer?.fraudCheckedAt, queryClient]);
  const [isAssigningManualCourier, setIsAssigningManualCourier] = useState(false);
  type OrderStatusTransitionAction = 'confirm' | 'process' | 'assignCourier' | 'pick' | 'complete' | 'exchangePick';
  type OrderStatusTransition = {
    action: OrderStatusTransitionAction;
    label: string;
    nextStatus: OrderStatus;
    historyKey?: keyof Order['history'];
    description: string;
    enabled: boolean;
  };
  type OrderTimelineLabel = 'Created' | 'Processing' | 'Courier assigned' | 'Picked up' | 'Delivered' | 'Exchanged' | 'Exchange processing' | 'Exchange picked' | 'Exchange delivered' | 'Exchange returned' | 'Exchange cancelled' | 'Returned' | 'Cancelled';
  type OrderTimelineItem = {
    label: OrderTimelineLabel;
    historyKey: keyof Order['history'];
    description: string;
  };
  type ActivityTimelineEntry = {
    key: string;
    label: string;
    icon: React.ReactNode;
    text: string;
    parsedAt: Date | null;
    children?: ActivityTimelineEntry[];
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
  const [expandedSection, setExpandedSection] = useState<Record<string, boolean>>({
    status: true,
    survey: true,
    activitySurvey: false,
  });

  const hasExchangedItems = (o?: Order | null) =>
    Boolean(o?.items?.some((item) => (item.exchangedQty ?? 0) > 0));

  const showExchangeTimeline = [OrderStatus.EXCHANGE_PROCESSING, OrderStatus.EXCHANGE_PICKED, OrderStatus.EXCHANGE_DELIVERED, OrderStatus.EXCHANGE_RETURNED, OrderStatus.EXCHANGE_CANCELLED].includes(order?.status as OrderStatus) || hasExchangedItems(order);

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
          { label: 'Exchange processing', historyKey: 'exchangeProcessing', description: 'Exchange initiated and processing.' },
          { label: 'Exchange picked', historyKey: 'exchangePicked', description: 'Exchange items picked up by courier.' },
          { label: 'Exchange delivered', historyKey: 'exchangeDelivered', description: 'Exchange items delivered to the customer.' },
          { label: 'Exchange returned', historyKey: 'exchangeReturned', description: 'The exchange order has been returned.' },
          { label: 'Exchange cancelled', historyKey: 'exchangeCancelled', description: 'The exchange has been cancelled.' },
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
    if (order.status === OrderStatus.EXCHANGE_CANCELLED) return timelineItems.findIndex((item) => item.label === 'Exchange cancelled');
    if (order.status === OrderStatus.EXCHANGE_PROCESSING) return timelineItems.findIndex((item) => item.label === 'Exchange processing');
    if (order.status === OrderStatus.EXCHANGE_PICKED) return timelineItems.findIndex((item) => item.label === 'Exchange picked');
    if (order.status === OrderStatus.EXCHANGE_DELIVERED) return timelineItems.findIndex((item) => item.label === 'Exchange delivered');
    if (order.status === OrderStatus.EXCHANGE_RETURNED) return timelineItems.findIndex((item) => item.label === 'Exchange returned');
    if (order.status === OrderStatus.COMPLETED) {
      return timelineItems.findIndex((item) => item.label === (hasExchangedItems(order) ? 'Exchange delivered' : 'Delivered'));
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

        const { date: formattedDate, time: formattedTime } = formatDateTimeParts(parsed);

        const onAtRegex = /(on\s+)(.+?)(,\s*at\s*)(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|a\.m\.|p\.m\.))?)/i;
        const match = line.match(onAtRegex);
        if (match && typeof match.index === 'number') {
          const prefix = line.slice(0, match.index);
          const suffix = line.slice(match.index + match[0].length);
          return `${prefix}${match[1]}${formattedDate}${match[3]}${formattedTime}${suffix}`;
        }

        const isoTimestampRegex = /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/;
        if (isoTimestampRegex.test(line)) {
          return line.replace(isoTimestampRegex, `${formattedDate}, at ${formattedTime}`);
        }

        return line;
      })
      .join('\n');
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

  const getStatusDisplayName = (status: OrderStatus) => {
    if (status === OrderStatus.COMPLETED) return hasExchangedItems(order) ? 'Exchange Delivered' : 'Delivered';
    if (status === OrderStatus.EXCHANGE_DELIVERED) return 'Exchange Delivered';
    return status;
  };

  const getFinalBranchStatus = (status: OrderStatus): OrderTimelineLabel | null => {
    if (status === OrderStatus.COMPLETED) return hasExchangedItems(order) ? 'Exchange delivered' : 'Delivered';
    if (status === OrderStatus.EXCHANGE_PROCESSING) return 'Exchange processing';
    if (status === OrderStatus.EXCHANGE_PICKED) return 'Exchange picked';
    if (status === OrderStatus.EXCHANGE_DELIVERED) return 'Exchange delivered';
    if (status === OrderStatus.EXCHANGE_RETURNED) return 'Exchange returned';
    if (status === OrderStatus.EXCHANGE_CANCELLED) return 'Exchange cancelled';
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
        case 'Exchange processing':
          return 'Exchange processing';
        case 'Exchange picked':
          return 'Exchange picked';
        case 'Exchange delivered':
          return 'Exchange delivered';
        case 'Exchange returned':
          return order?.status === OrderStatus.EXCHANGE_RETURNED ? 'Exchange returned' : 'Returning exchange';
        case 'Exchange cancelled':
          return order?.status === OrderStatus.EXCHANGE_CANCELLED ? 'Exchange cancelled' : 'Cancelling exchange';
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
        case 'Exchange processing':
          return 'Assign courier for exchange';
        case 'Exchange picked':
          return 'Pick exchange';
        case 'Exchange delivered':
          return 'Deliver exchange';
        case 'Exchange returned':
          return 'Return exchange';
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

    const isActiveBranchItem = index === timelineIndex && ['Delivered', 'Exchanged', 'Exchange processing', 'Exchange picked', 'Exchange delivered', 'Exchange returned', 'Exchange cancelled', 'Returned', 'Cancelled'].includes(item.label);
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
        case 'Exchange processing':
          return order.history?.exchangeProcessing || order.history?.exchangeCourier || '';
        case 'Exchange picked':
          return order.history?.exchangePicked || '';
        case 'Exchange delivered':
          return order.history?.exchangeDelivered || order.completedAt || order.history?.completed || '';
        case 'Exchange returned':
          return order.history?.exchangeReturned || '';
        case 'Exchange cancelled':
          return order.history?.exchangeCancelled || '';
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
    if ([OrderStatus.COMPLETED, OrderStatus.RETURNED, OrderStatus.CANCELLED, OrderStatus.EXCHANGE_RETURNED].includes(activeOrder.status)) {
      return 100;
    }
    const finalStepLabel = showExchangeTimeline ? 'Exchange delivered' : 'Delivered';
    const finalStepIndex = timelineItems.findIndex((item) => item.label === finalStepLabel);
    const stepIndex = getTimelineIndex(activeOrder);
    return Math.min(100, Math.round((stepIndex / Math.max(1, finalStepIndex)) * 100));
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
  const activityTimelineEntries = React.useMemo<ActivityTimelineEntry[]>(() => {
    if (!order) return [];

    const history: Partial<Order['history']> = order.history || {};
    const defaultCreated = order.createdAt
      ? `Created by ${createdByUser?.name || order.createdBy} on ${formatHistoryMoment(order.createdAt)}`
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
      { key: 'exchangeProcessing', label: 'Exchange processing', icon: ICONS.ChevronRight, text: history.exchangeProcessing },
      { key: 'exchangePicked', label: 'Exchange picked', icon: ICONS.Check, text: history.exchangePicked },
      { key: 'exchangeDelivered', label: 'Exchange delivered', icon: ICONS.Check, text: history.exchangeDelivered },
      { key: 'exchangeReturned', label: 'Exchange returned', icon: ICONS.Close, text: history.exchangeReturned },
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

    const surveyEvents = order.surveyEvents || [];
    const firstQueuedIndex = surveyEvents.findIndex((event) => event.eventType === 'queued');
    const queuedEvent = firstQueuedIndex >= 0 ? surveyEvents[firstQueuedIndex] : null;
    const parentTimestamp = queuedEvent?.createdAt || order.surveyTriggeredAt || surveyEvents[0]?.createdAt;
    const parentEventDate = parentTimestamp ? new Date(parentTimestamp) : null;
    const parentParsedAt = parentEventDate && !Number.isNaN(parentEventDate.getTime())
      ? parentEventDate
      : null;

    const surveyChildren = surveyEvents
      .filter((_, index) => firstQueuedIndex < 0 || index !== firstQueuedIndex)
      .map<ActivityTimelineEntry>((event) => {
        const eventDate = event.createdAt ? new Date(event.createdAt) : null;
        const parsedAt = eventDate && !Number.isNaN(eventDate.getTime()) ? eventDate : null;
        const eventTimestamp = parsedAt ? formatDateTime(parsedAt) : '';
        const labels: Record<string, string> = {
          queued: 'Survey queued again',
          initiated: 'Call started',
          result_received: 'Customer response',
          retry_scheduled: 'Retry scheduled',
          retry_initiated: 'Retry started',
          failed: 'Call could not be completed',
          cancelled: 'Survey cancelled',
        };

        let message = 'Automatic survey updated.';
        if (event.eventType === 'queued') {
          message = 'A new automatic survey attempt was queued.';
        } else if (event.eventType === 'initiated') {
          message = 'The automatic survey call started.';
        } else if (event.eventType === 'result_received') {
          if (event.callStatus === 'not_answered') {
            message = 'The customer did not answer.';
          } else if (event.response === '1') {
            message = 'The customer confirmed the order.';
          } else if (event.response === '2') {
            message = 'The customer cancelled the order.';
          } else if (event.response) {
            message = 'The customer requested a follow-up.';
          } else {
            message = 'The call result was received.';
          }
        } else if (event.eventType === 'retry_scheduled') {
          const scheduledMatch = String(event.details || '').match(/Retry scheduled for\s+(.+?)\.?$/i);
          const scheduledAt = scheduledMatch?.[1] ? new Date(scheduledMatch[1]) : null;
          message = scheduledAt && !Number.isNaN(scheduledAt.getTime())
            ? `Next attempt: ${formatDateTime(scheduledAt)}`
            : 'Another attempt was scheduled.';
        } else if (event.eventType === 'retry_initiated') {
          message = 'Another automatic survey call started.';
        } else if (event.eventType === 'failed') {
          message = 'The automatic survey could not be completed.';
        } else if (event.eventType === 'cancelled') {
          message = 'The automatic survey was cancelled.';
        }

        return {
          key: `survey-${event.id}`,
          label: labels[event.eventType] || 'Survey update',
          icon: event.eventType === 'failed' || event.eventType === 'cancelled' ? ICONS.Close : ICONS.Bell,
          text: event.eventType === 'retry_scheduled' || !eventTimestamp
            ? message
            : `${message} · ${eventTimestamp}`,
          parsedAt,
        };
      });

    const surveyGroup: ActivityTimelineEntry | null = surveyEvents.length > 0 || order.surveyTriggeredAt
      ? {
          key: 'automatic-survey',
          label: 'Automatic survey queued',
          icon: ICONS.Bell,
          text: parentParsedAt && !Number.isNaN(parentParsedAt.getTime())
            ? `Queued ${formatDateTime(parentParsedAt)}`
            : 'The automatic survey was queued.',
          parsedAt: parentParsedAt && !Number.isNaN(parentParsedAt.getTime()) ? parentParsedAt : null,
          children: surveyChildren,
        }
      : null;

    const entries: ActivityTimelineEntry[] = [...baseEntries, ...paymentEntries]
      .map((entry) => ({
        ...entry,
        text: formatHistoryTextForTimeline(entry.text),
        parsedAt: parseHistoryTimestamp(entry.text),
      }));

    if (surveyGroup) entries.push(surveyGroup);
    entries.sort((a, b) => {
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
  const sentToPathao = courierHistoryLower.includes('pathao') || !!order?.pathaoConsignmentId;
  const sentToAnyCourier = sentToSteadfast || sentToCarryBee || sentToPaperfly || sentToPathao;

  // Exchange consignment tracking
  const sentToExchangeCourier = Boolean(
    order?.exchangeSteadfastConsignmentId ||
    order?.exchangeCarrybeeConsignmentId ||
    order?.exchangePaperflyTrackingNumber ||
    order?.exchangePathaoConsignmentId ||
    order?.exchangeCourierHistory ||
    order?.history?.exchangeCourier
  );

  const preferredCourier = getPreferredCourierFromHistory(order?.history?.courier);
  const courierDisplayName = preferredCourier === 'paperfly'
    ? 'Paperfly'
    : preferredCourier === 'carrybee'
      ? 'CarryBee'
      : preferredCourier === 'pathao'
        ? 'Pathao'
        : preferredCourier === 'steadfast'
          ? 'Steadfast'
          : '';
  
  const isCourierConfigured = (courier: 'steadfast' | 'carrybee' | 'paperfly' | 'pathao') => {
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
    if (courier === 'pathao') {
      return !!(courierSettings.pathao?.baseUrl && courierSettings.pathao?.clientId && courierSettings.pathao?.storeId);
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
    && order?.status !== OrderStatus.EXCHANGE_PROCESSING
    && order?.status !== OrderStatus.EXCHANGE_PICKED
    && order?.status !== OrderStatus.EXCHANGE_DELIVERED
    && order?.status !== OrderStatus.EXCHANGE_RETURNED
    && order?.status !== OrderStatus.EXCHANGE_CANCELLED
    && order?.status !== OrderStatus.RETURNED
    && order?.status !== OrderStatus.CANCELLED
    && order?.status !== OrderStatus.ON_HOLD
    && !sentToAnyCourier;

  const canAssignExchangeCourier =
    canProcessReturnExchange
    && canUseCourierAutomation
    && order?.status === OrderStatus.EXCHANGE_PROCESSING
    && !sentToExchangeCourier;

  const statusTransition = useMemo<OrderStatusTransition | null>(() => {
    if (!order) return null;
    if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.RETURNED || order.status === OrderStatus.COMPLETED || order.status === OrderStatus.EXCHANGE_RETURNED || order.status === OrderStatus.EXCHANGE_CANCELLED) {
      return null;
    }

    if (order.status === OrderStatus.EXCHANGE_PROCESSING) {
      if (sentToExchangeCourier) {
        return {
          action: 'exchangePick' as const,
          label: 'Mark exchange picked',
          nextStatus: OrderStatus.EXCHANGE_PICKED,
          historyKey: 'exchangePicked',
          description: 'Mark that the exchange items have been picked up by the courier.',
          enabled: canFinalizeOrders,
        };
      }
      return {
        action: 'assignCourier' as const,
        label: 'Assign courier for exchange',
        nextStatus: order.status,
        historyKey: 'exchangeCourier',
        description: 'Assign a courier to ship the replacement items to the customer.',
        enabled: canAssignExchangeCourier,
      };
    }

    if (order.status === OrderStatus.EXCHANGE_PICKED) {
      return {
        action: 'complete' as const,
        label: 'Complete order',
        nextStatus: OrderStatus.COMPLETED,
        description: 'Complete the order by marking the exchange as delivered.',
        enabled: canFinalizeOrders,
      };
    }

    if (order.status === OrderStatus.EXCHANGE_DELIVERED) {
      return {
        action: 'complete' as const,
        label: 'Complete order',
        nextStatus: OrderStatus.COMPLETED,
        description: 'Finalize the order after exchange delivery.',
        enabled: canFinalizeOrders,
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

    // Courier-assigned orders always require the Picked step before manual
    // completion, even when a supported courier is also updating the order
    // automatically in the background.
    if (order.status === OrderStatus.COURIER_ASSIGNED || !hasPicked) {
      return {
        action: 'pick' as const,
        label: 'Mark order as picked',
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
  }, [order, canMoveCurrentOrderToProcessing, canSendCurrentOrderToCourier, canMoveCurrentOrderToPickedPermission, canFinalizeOrders, sentToExchangeCourier, canAssignExchangeCourier]);

  // Calculate payment status
  const settlementTotal = order?.status === OrderStatus.CANCELLED ? 0 : (order?.total ?? 0);
  const getPaymentStatus = () => {
    if (!order) return 'Unpaid';
    return getPaymentStatusLabel(order.paidAmount, settlementTotal, order.history);
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
    const historyText = `Confirmed by ${user.name}, on ${formatHistoryMoment(new Date())}`;
    await updateStatus(order.status, 'payment', historyText);
  };

  const markProcessing = async () => {
    if (!canMoveCurrentOrderToProcessing) {
      toast.error('You do not have permission to move orders to processing.');
      return;
    }
    const historyText = `Marked as processing by ${user.name}, on ${formatHistoryMoment(new Date())}`;
    await updateStatus(OrderStatus.PROCESSING, 'processing', historyText);
  };

  const markPacked = async () => {
    if (!canMoveCurrentOrderToProcessing) {
      toast.error('You do not have permission to mark this order packed.');
      return;
    }
    const historyText = `Marked as packed by ${user.name}, on ${formatHistoryMoment(new Date())}`;
    await updateStatus(order.status, 'packed', historyText);
  };

  const assignCourier = async (details?: string) => {
    if (isExchangeConsignment) {
      // Exchange consignment — don't change status, write to exchangeCourier history
      const noteText = details ? ` ${details.trim()}` : '';
      const historyText = `Exchange courier assigned by ${user.name}, on ${formatHistoryMoment(new Date())}.${noteText}`;
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
    const historyText = `Courier assigned by ${user.name}, on ${formatHistoryMoment(new Date())}.${noteText}`;
    await updateStatus(OrderStatus.COURIER_ASSIGNED, 'courier', historyText);
  };

  const loadCourierHistory = () => {
    if (!isFraudCheckerConfigured) {
      toast.warning('Courier history is not available yet. Ask an administrator to enable it in Settings.');
      return;
    }

    if (!isValidFraudPhone) {
      toast.warning('Enter a valid 11-digit phone number starting with 0 to view courier history.');
      return;
    }

    courierHistoryMutation.mutate({ phone: normalizedOrderPhone, customerId: order?.customerId });
  };

  const openCourierSelectionModal = () => {
    setShowCourierSelectionModal(true);
  };

  const closeCourierSelectionModal = () => {
    setShowCourierSelectionModal(false);
    setIsExchangeConsignment(false);
  };

  const handleSelectCourierOption = (option: 'steadfast' | 'carrybee' | 'paperfly' | 'pathao' | 'manual') => {
    setShowCourierSelectionModal(false);
    if (option === 'steadfast') {
      setShowSteadfast(true);
    } else if (option === 'carrybee') {
      setShowCarryBee(true);
    } else if (option === 'paperfly') {
      setShowPaperfly(true);
    } else if (option === 'pathao') {
      setShowPathao(true);
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
    const historyText = `Marked as picked by courier, on ${formatHistoryMoment(new Date())}`;
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
    } else if (pendingStatusTransition.action === 'exchangePick') {
      const historyText = `Exchange picked up by courier, on ${formatHistoryMoment(new Date())}`;
      await updateStatus(OrderStatus.EXCHANGE_PICKED, 'exchangePicked', historyText);
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
              if (order?.status === OrderStatus.EXCHANGE_PROCESSING) {
                setIsExchangeConsignment(true);
              }
              setShowCourierSelectionModal(true);
              return;
            }
            if (transition.action === 'complete' && (order?.status === OrderStatus.PICKED || order?.status === OrderStatus.EXCHANGE_PICKED || order?.status === OrderStatus.EXCHANGE_DELIVERED)) {
              openCompletion();
              return;
            }
            if (transition.action === 'exchangePick') {
              setPendingStatusTransition(transition);
              setShowStatusTransitionModal(true);
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
      if (completionForm.amount < 0) {
        toast.error('Return expense cannot be negative');
        return;
      }
      if (completionForm.amount > 0) {
        if (!completionForm.accountId || !completionForm.paymentMethod || !completionForm.categoryId) {
          toast.error('Select an account, payment method, and expense category for the return expense');
          return;
        }
        const selectedAccount = accounts.find((account) => account.id === completionForm.accountId);
        if (selectedAccount && selectedAccount.currentBalance < completionForm.amount) {
          toast.error(
            `${selectedAccount.name} does not have enough balance for this return. Available ${formatCurrency(selectedAccount.currentBalance)}, required ${formatCurrency(completionForm.amount)}.`
          );
          return;
        }
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
      amount: Math.max(settlementTotal - order.paidAmount, 0),
      paymentMethod: db.settings.defaults.defaultPaymentMethod || paymentMethods[0]?.name || '',
    });
    setShowPaymentModal(true);
  };

  const openRefund = () => {
    if (!order) return;

    const refundDue = Math.max(order.paidAmount - settlementTotal, 0);

    setRefundForm({
      date: getTodayDate(),
      time: new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false }),
      accountId: db.settings.defaults.defaultAccountId || '',
      amount: refundDue > 0 ? refundDue : Math.max(order.paidAmount, 0),
      paymentMethod: db.settings.defaults.defaultPaymentMethod || paymentMethods[0]?.name || '',
    });
    setShowRefundModal(true);
  };

  const appendHistoryEntry = (history: Partial<Order['history']> | undefined, eventText: string): Order['history'] => {
    const existingPaymentHistory = String(history?.payment || '').trim();
    const base = { ...(history || {}), created: String(history?.created || '') } as Order['history'];

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
    const remainingDue = Math.max(settlementTotal - order.paidAmount, 0);
    if (paymentForm.amount > remainingDue) {
      toast.error(`Payment cannot exceed the remaining due of ${formatCurrency(remainingDue)}`);
      return;
    }

    try {
      const fullDatetime = buildLocalDateTime(paymentForm.date, paymentForm.time) || new Date();
      const isoDatetime = fullDatetime.toISOString();
      const selectedAccount = accounts.find((account) => account.id === paymentForm.accountId);
      const paymentMethod = paymentForm.paymentMethod || db.settings.defaults.defaultPaymentMethod || 'Cash';
      const historyText = `Payment of ${formatCurrency(paymentForm.amount)} received by ${user.name} via ${paymentMethod} in ${selectedAccount?.name || 'Unknown account'} on ${formatHistoryMoment(fullDatetime)}`;

      const updates: any = {
        history: appendHistoryEntry(order.history, historyText) as any,
        paymentAmount: paymentForm.amount,
        paymentAccountId: paymentForm.accountId,
        paymentMethod,
        paymentDate: isoDatetime,
      };

      await updateMutation.mutateAsync({ id: id!, updates });
      setShowPaymentModal(false);
      toast.success('Payment recorded successfully');
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
      const historyText = `Refund of ${formatCurrency(refundForm.amount)} issued by ${user.name} via ${paymentMethod} in ${selectedAccount?.name || 'Unknown account'} on ${formatHistoryMoment(fullDatetime)}`;
      const updates: any = {
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
    const sentToPathao = courierHistory.includes('pathao') || !!order.pathaoConsignmentId;
    const steadfastTracking = String(
      order.steadfastConsignmentId || extractSteadfastTrackingFromHistory(order.history?.courier) || ''
    ).trim();
    const carryBeeConsignment = String(order.carrybeeConsignmentId || '').trim();
    const paperflyReference = getPaperflyReferenceNumber(order);
    const pathaoConsignment = String(order.pathaoConsignmentId || '').trim();

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

    const openPathaoTracking = (): boolean => {
      if (!sentToPathao || !pathaoConsignment) return false;

      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(pathaoConsignment).catch(() => undefined);
      }
      toast.success(`Pathao consignment ID copied: ${pathaoConsignment}`);
      closeTrackingMenu();
      return true;
    };

    if (preferredCourier === 'pathao' && openPathaoTracking()) return;
    if (preferredCourier === 'paperfly' && openPaperflyTracking()) return;
    if (preferredCourier === 'carrybee' && openCarryBeeTracking()) return;
    if (preferredCourier === 'steadfast' && openSteadfastTracking()) return;

    if (openPathaoTracking()) return;
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

    if (courierHistory.includes('pathao')) {
      toast.warning('Pathao consignment ID is missing for this order');
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
        history: { created: `${user.name} created this order as duplicate on ${formatHistoryMoment(new Date())}` }
      };
      await createOrderMutation.mutateAsync(duplicateOrder as any);
      navigate('/orders');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not duplicate the order. Please try again.');
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
  const canFinalizeCurrentOrder = canFinalizeOrders && (order.status === OrderStatus.PICKED || order.status === OrderStatus.EXCHANGE_PICKED);
  const canShowActionsMenu =
    canEditCurrentOrder
    || canFinalizeCurrentOrder
    || (sentToAnyCourier && canUseCourierAutomation)
    || canCancelCurrentOrder
    || canDeleteCurrentOrder
    || canUseFraudChecker
    || canProcessReturnExchange
    || canAssignExchangeCourier;

  const customerTrust = (() => {
    if (fraudPercentage === null) return null;
    if (fraudPercentage >= 90) {
      return { label: 'Trusted Customer', message: 'Safe to send', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
    }
    if (fraudPercentage >= 70) {
      return { label: 'Standard Customer', message: 'Send with normal checks', className: 'bg-blue-100 text-blue-700 border-blue-200' };
    }
    if (fraudPercentage >= 40) {
      return { label: 'Moderate Risk', message: 'Confirm before sending', className: 'bg-amber-100 text-amber-700 border-amber-200' };
    }
    return { label: 'High Risk', message: 'Do not send without verification', className: 'bg-rose-100 text-rose-700 border-rose-200' };
  })();

  const latestSurveyEvent = order.surveyEvents?.[order.surveyEvents.length - 1];
  const surveyIndicator = (() => {
    if (!order.surveyStatus && !latestSurveyEvent) return null;
    const isAwaiting = ['queued', 'initiated', 'retry_initiated'].includes(latestSurveyEvent?.eventType || '')
      || ['pending', 'triggered', 'initiated'].includes(order.surveyStatus || '');
    if (isAwaiting && latestSurveyEvent?.eventType !== 'retry_scheduled') {
      return { loading: true, className: 'border-blue-600 border-t-transparent', text: 'Waiting for the voice survey result.' };
    }

    const response = latestSurveyEvent?.response || order.surveyResponse;
    const callStatus = latestSurveyEvent?.callStatus || order.surveyCallStatus;
    if (response === '1' || order.confirmationStatus === 'confirmed') {
      return { loading: false, className: 'bg-emerald-500', text: 'Customer pressed 1 and confirmed the order.' };
    }
    if (response === '2' || order.confirmationStatus === 'cancelled') {
      return { loading: false, className: 'bg-red-500', text: 'Customer pressed 2 and cancelled the order.' };
    }
    if ((response && !['1', '2'].includes(response)) || order.confirmationStatus === 'on_hold') {
      return { loading: false, className: 'bg-amber-400', text: `Customer pressed ${response || '3'} and requested follow-up.` };
    }
    if (callStatus === 'not_answered' || latestSurveyEvent?.eventType === 'retry_scheduled' || order.confirmationStatus === 'waiting') {
      return { loading: false, className: 'bg-black', text: callStatus === 'not_answered' ? 'Customer did not pick up.' : 'Customer answered without selecting an option.' };
    }
    return { loading: false, className: 'bg-gray-400', text: 'Voice survey is not complete.' };
  })();

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
          {surveyIndicator ? (
            <button
              type="button"
              className="group relative flex h-7 w-7 items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-blue-300"
              aria-label={surveyIndicator.text}
              onClick={() => setShowSurveyIndicatorTooltip((visible) => !visible)}
              onBlur={() => setShowSurveyIndicatorTooltip(false)}
            >
              <span className={surveyIndicator.loading
                ? `h-4 w-4 animate-spin rounded-full border-2 ${surveyIndicator.className}`
                : `h-3.5 w-3.5 rounded-full shadow-sm ring-2 ring-white ${surveyIndicator.className}`}
              />
              <span className={`${showSurveyIndicatorTooltip ? 'block' : 'hidden'} absolute left-1/2 top-full z-30 mt-2 w-56 -translate-x-1/2 rounded-lg bg-gray-950 px-3 py-2 text-center text-xs font-medium normal-case tracking-normal text-white shadow-xl group-hover:block`}>
                {surveyIndicator.text}
              </span>
            </button>
          ) : null}
          {canUseCourierAutomation && ([OrderStatus.COURIER_ASSIGNED, OrderStatus.PICKED, OrderStatus.EXCHANGE_PICKED, OrderStatus.EXCHANGE_DELIVERED].includes(order.status)) && sentToSteadfast && (
            <img src="/uploads/steadfast.png" alt="Steadfast" className="w-6 h-6 rounded-full" />
          )}
          {canUseCourierAutomation && ([OrderStatus.COURIER_ASSIGNED, OrderStatus.PICKED, OrderStatus.EXCHANGE_PICKED, OrderStatus.EXCHANGE_DELIVERED].includes(order.status)) && sentToCarryBee && (
            <img src="/uploads/carrybee.png" alt="CarryBee" className="w-6 h-6 rounded-full" />
          )}
          {canUseCourierAutomation && ([OrderStatus.COURIER_ASSIGNED, OrderStatus.PICKED, OrderStatus.EXCHANGE_PICKED, OrderStatus.EXCHANGE_DELIVERED].includes(order.status)) && sentToPaperfly && (
            <img src="/uploads/paperfly.png" alt="Paperfly" className="w-6 h-6 rounded-full" />
          )}
          {canUseCourierAutomation && ([OrderStatus.COURIER_ASSIGNED, OrderStatus.PICKED, OrderStatus.EXCHANGE_PICKED, OrderStatus.EXCHANGE_DELIVERED].includes(order.status)) && sentToPathao && (
            <img src="/uploads/pathao.png" alt="Pathao" className="w-6 h-6 rounded-full" />
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
                    {canProcessReturnExchange && (order.status === OrderStatus.COMPLETED || order.status === OrderStatus.EXCHANGE_DELIVERED) && (
                      <button className="w-full text-left px-4 py-2.5 text-sm hover:bg-orange-50 flex items-center gap-2 font-bold text-orange-700" onClick={() => { setShowReturnExchangeModal(true); setIsActionOpen(false); }}>
                        {ICONS.Return} Return / Exchange
                      </button>
                    )}
                    {canAssignExchangeCourier && (
                      <button className="w-full text-left px-4 py-2.5 text-sm hover:bg-amber-50 flex items-center gap-2 font-bold text-amber-700" onClick={() => { setIsExchangeConsignment(true); setShowCourierSelectionModal(true); setIsActionOpen(false); }}>
                        {ICONS.Courier} Assign courier for exchange
                      </button>
                    )}
                    {canUseFraudChecker && (
                      <button
                        onClick={openFraudChecker}
                        className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold ${canRunFraudChecker ? 'text-gray-700' : 'cursor-not-allowed text-gray-300'}`}
                        disabled={!canRunFraudChecker}
                      >
                        {ICONS.FraudChecker} Customer Trust Details
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

      {isBusinessGrowthEnabled && customerTrust ? (
        <div className={`flex flex-col gap-1 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${customerTrust.className}`}>
          <p className="text-sm font-black">{customerTrust.label} · {Math.round(fraudPercentage)}% delivered</p>
          <p className="text-sm font-bold">{customerTrust.message}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 lg:gap-8">
        {/* On-Screen Invoice Format */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-xl border border-gray-100 overflow-hidden">
          <div className="p-3 sm:p-4 md:p-6 lg:p-10 space-y-3 sm:space-y-4 lg:space-y-5">
            <div className="flex flex-row justify-between items-start gap-3 sm:gap-4 lg:gap-6">
              <div className="flex-1 min-w-0">
                {(orderBranding?.logo || db.settings.company.logo) && (
                  <img 
                    src={orderBranding?.logo || db.settings.company.logo} 
                    className="details-invoice-logo rounded-lg object-contain mb-2 sm:mb-3 lg:mb-4"
                    width={invoiceLogoWidth}
                    height={invoiceLogoHeight}
                    style={invoiceLogoStyle}
                    alt="Company Logo"
                  />
                )}
                <h1 className="text-sm sm:text-base lg:text-xl font-black uppercase tracking-tighter break-words" style={{ color: themeColorHex }}>{orderBranding?.name || db.settings.company.name}</h1>
                <div className="mt-1 sm:mt-2 text-[9px] sm:text-[10px] lg:text-xs text-gray-400 font-medium space-y-0.5 sm:space-y-1">
                  <p className="break-words">{orderBranding?.address || db.settings.company.address}</p>
                  <p className="text-[8px] sm:text-[9px] break-words">{orderBranding?.phone || db.settings.company.phone} • {orderBranding?.email || db.settings.company.email}</p>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <h2 className="text-sm sm:text-2xl lg:text-3xl font-black text-gray-300 uppercase leading-none mb-1 sm:mb-2 break-words">{invoiceSettings?.title || db.settings.invoice.title}</h2>
                <div className="space-y-0.5 sm:space-y-1 lg:space-y-1.5 text-[9px] sm:text-sm">
                  <p className="text-[9px] sm:text-xs lg:text-sm font-bold text-gray-900"><span className="text-gray-400 font-medium">Order No:&nbsp;&nbsp;</span> <span className="break-all">{order.orderNumber}</span></p>
                  <p className="text-[9px] sm:text-xs lg:text-sm font-bold text-gray-900"><span className="text-gray-400 font-medium">Date:&nbsp;&nbsp;</span> {formatDate(order.orderDate)}</p>
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
                    <span className={`font-bold ${settlementTotal - order.paidAmount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {formatCurrency(Math.max(settlementTotal - order.paidAmount, 0))}
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-t border-gray-100">
                    <span className="text-xs text-gray-500 font-medium">Customer Refund Due</span>
                    <span className="font-bold text-orange-600">{formatCurrency(Math.max(order.paidAmount - settlementTotal, 0))}</span>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <button
                    onClick={openPayment}
                    disabled={order.paidAmount >= settlementTotal || order.status === OrderStatus.CANCELLED}
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
                      const isExchangeStep = ['Exchange processing', 'Exchange picked', 'Exchange delivered', 'Exchange returned'].includes(item.label);
                      const isInExchangeFlow = [OrderStatus.EXCHANGE_PROCESSING, OrderStatus.EXCHANGE_PICKED, OrderStatus.EXCHANGE_DELIVERED, OrderStatus.EXCHANGE_RETURNED].includes(order?.status as OrderStatus);
                      const isBranchItem = (item.label === 'Exchange processing' || item.label === 'Exchange picked' || item.label === 'Exchange delivered' || item.label === 'Exchange returned' || item.label === 'Exchange cancelled' || item.label === 'Exchanged' || item.label === 'Returned' || item.label === 'Cancelled')
                        || (item.label === 'Delivered' && !showExchangeTimeline);
                      const isUnavailableBranch = Boolean(branchStatus && isBranchItem && item.label !== branchStatus)
                        && !(isInExchangeFlow && isExchangeStep);
                      if (isUnavailableBranch) return null;
                      const isActive = index === timelineIndex;
                      const isPast = (!isBranchItem || (isExchangeStep && isInExchangeFlow && index < timelineIndex)) && index < timelineIndex;
                      const isInProgressExchange = isActive && isBranchItem && (item.label === 'Exchange processing' || item.label === 'Exchange picked');
                      const isCompleted = isPast || (isActive && isBranchItem && !isInProgressExchange);

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

          {/* Automatic Survey Section */}
          {order.surveyStatus && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-lg overflow-hidden">
              <button
                type="button"
                className="w-full px-5 py-4 bg-gray-50 border-b flex justify-between items-center gap-3 text-left"
                onClick={() => toggleSection('survey')}
                aria-expanded={isSectionExpanded('survey')}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="text-sm font-black text-black uppercase tracking-widest">Automatic Survey</h3>
                  {order.confirmationStatus ? (
                    <ConfirmationStatusDot status={order.confirmationStatus} size="md" showLabel />
                  ) : (
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">In progress</span>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <div className={`p-1 rounded-full ${theme.colors.primary[50]} ${theme.colors.primary.text}`}>{ICONS.Bell}</div>
                  <div className={`transition-transform duration-200 ${isSectionExpanded('survey') ? 'rotate-90' : ''}`}>
                    {ICONS.ChevronRight}
                  </div>
                </div>
              </button>

              {isSectionExpanded('survey') && (
                <div className="p-5">
                  {order.confirmationStatus === 'confirmed' && (
                    <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-4">
                      <p className="text-sm font-bold text-emerald-800">Confirmed by customer</p>
                      <p className="mt-1 text-xs text-emerald-700">The customer pressed 1. This order is ready to process.</p>
                    </div>
                  )}
                  {order.confirmationStatus === 'cancelled' && (
                    <div className="rounded-xl bg-red-50 border border-red-100 p-4">
                      <p className="text-sm font-bold text-red-800">Cancelled by customer</p>
                      <p className="mt-1 text-xs text-red-700">The customer pressed 2. Do not dispatch this parcel.</p>
                    </div>
                  )}
                  {order.confirmationStatus === 'on_hold' && (
                    <div className="rounded-xl bg-amber-50 border border-amber-100 p-4">
                      <p className="text-sm font-bold text-amber-800">Follow-up required</p>
                      <p className="mt-1 text-xs text-amber-700">The customer pressed {order.surveyResponse || '3'}. Contact them before dispatch.</p>
                    </div>
                  )}
                  {(!order.confirmationStatus || order.confirmationStatus === 'waiting') && (
                    <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
                      <p className="text-sm font-bold text-gray-700">{order.surveyCallStatus === 'not_answered' ? 'Customer did not pick up' : 'Waiting for the call result'}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        {order.surveyNextRetryAt ? `Retry scheduled for ${formatDateTime(order.surveyNextRetryAt)}.` : 'The status will update automatically.'}
                      </p>
                      {order.surveyRetryCount > 0 ? <p className="mt-1 text-xs font-semibold text-gray-500">Retry attempt {order.surveyRetryCount}</p> : null}
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap gap-2">
                    {!order.surveyStatus || order.surveyStatus === 'skipped' || order.surveyStatus === 'failed' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            await triggerSurveyCallMutation.mutateAsync(order.id);
                            toast.success('Survey call started.');
                            queryClient.invalidateQueries({ queryKey: ['order', order.id] });
                          } catch {
                            toast.error('Could not start the survey call. Ask a developer if the problem continues.');
                          }
                        }}
                        loading={triggerSurveyCallMutation.isPending}
                      >
                        Trigger Call
                      </Button>
                    ) : null}
                    {order.surveyStatus === 'completed' && order.confirmationStatus === 'waiting' ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            await retrySurveyCallMutation.mutateAsync(order.id);
                            toast.success('Survey call started again.');
                            queryClient.invalidateQueries({ queryKey: ['order', order.id] });
                          } catch {
                            toast.error('Could not start the survey call again. Ask a developer if the problem continues.');
                          }
                        }}
                        loading={retrySurveyCallMutation.isPending}
                      >
                        Retry Call
                      </Button>
                    ) : null}
                    {order.surveyStatus && !['completed', 'skipped', 'failed'].includes(order.surveyStatus) ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            await cancelSurveyCallMutation.mutateAsync(order.id);
                            toast.success('Survey call cancelled.');
                            queryClient.invalidateQueries({ queryKey: ['order', order.id] });
                          } catch {
                            toast.error('Could not cancel the survey call. Please try again.');
                          }
                        }}
                        loading={cancelSurveyCallMutation.isPending}
                      >
                        Cancel Survey
                      </Button>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          )}

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

                  {/* Courier Info */}
                  {sentToAnyCourier && (
                    <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
                      <p className="text-xs font-bold text-blue-600 uppercase tracking-widest mb-2">Courier Info</p>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-gray-900">{courierDisplayName || 'Manual'}</p>
                        {order.steadfastConsignmentId && (
                          <p className="text-xs text-gray-600">Steadfast Consignment ID: <span className="font-bold text-gray-900">{order.steadfastConsignmentId}</span></p>
                        )}
                        {order.carrybeeConsignmentId && (
                          <p className="text-xs text-gray-600">CarryBee Consignment ID: <span className="font-bold text-gray-900">{order.carrybeeConsignmentId}</span></p>
                        )}
                        {order.paperflyTrackingNumber && (
                          <p className="text-xs text-gray-600">Paperfly Tracking: <span className="font-bold text-gray-900">{order.paperflyTrackingNumber}</span></p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Exchange Courier Info */}
                  {sentToExchangeCourier && (
                    <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                      <p className="text-xs font-bold text-amber-600 uppercase tracking-widest mb-2">Exchange Courier Info</p>
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-gray-900 capitalize">{order.exchangeCourier || 'Manual'}</p>
                        {order.exchangeSteadfastConsignmentId && (
                          <p className="text-xs text-gray-600">Steadfast Consignment ID: <span className="font-bold text-gray-900">{order.exchangeSteadfastConsignmentId}</span></p>
                        )}
                        {order.exchangeCarrybeeConsignmentId && (
                          <p className="text-xs text-gray-600">CarryBee Consignment ID: <span className="font-bold text-gray-900">{order.exchangeCarrybeeConsignmentId}</span></p>
                        )}
                        {order.exchangePaperflyTrackingNumber && (
                          <p className="text-xs text-gray-600">Paperfly Tracking: <span className="font-bold text-gray-900">{order.exchangePaperflyTrackingNumber}</span></p>
                        )}
                      </div>
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
                  {activeFraudResult?.summary && (
                    <div className="border border-gray-200 rounded-lg p-3 space-y-2">
                      <p className="text-xs font-bold text-gray-600 uppercase tracking-widest">Courier Statistics</p>
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                          <p className="text-lg font-black text-gray-900">{activeFraudResult.summary.totalParcel}</p>
                          <p className="text-xs text-gray-600 mt-1">Total Orders</p>
                        </div>
                        <div>
                          <p className="text-lg font-black text-emerald-600">{activeFraudResult.summary.successParcel}</p>
                          <p className="text-xs text-gray-600 mt-1">Delivered</p>
                        </div>
                        <div>
                          <p className="text-lg font-black text-red-600">{activeFraudResult.summary.cancelledParcel}</p>
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
            activityTimelineEntries.map((entry) => entry.children ? (
              <div key={entry.key} className="border-b border-gray-100 pb-4 last:border-b-0 last:pb-0">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl text-left transition-colors hover:bg-gray-50"
                  onClick={() => toggleSection('activitySurvey')}
                  aria-expanded={isSectionExpanded('activitySurvey')}
                >
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-700">
                    {entry.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-gray-500">{entry.label}</p>
                    <p className="text-xs font-medium leading-relaxed text-gray-700">{entry.text}</p>
                  </div>
                  <div className={`flex-shrink-0 text-gray-400 transition-transform duration-200 ${isSectionExpanded('activitySurvey') ? 'rotate-90' : ''}`}>
                    {ICONS.ChevronRight}
                  </div>
                </button>
                {isSectionExpanded('activitySurvey') && (
                  <div className="ml-4 mt-4 space-y-4 border-l-2 border-blue-100 pl-6">
                    {entry.children.map((child) => (
                      <div key={child.key} className="relative flex items-center gap-3">
                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                          {child.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-gray-400">{child.label}</p>
                          <p className="text-xs font-medium leading-relaxed text-gray-700">{child.text}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div key={entry.key} className="relative flex items-center gap-3 border-b border-gray-100 pb-4 last:border-b-0 last:pb-0">
                <div className="flex-shrink-0">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                    {entry.icon}
                  </div>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-gray-400">{entry.label}</p>
                  <p className="text-xs font-medium leading-relaxed text-gray-700">{entry.text}</p>
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
            {activeFraudResult && (
              <div className="border-b border-gray-100 p-6 bg-gray-50">
                <h3 className="text-sm font-bold text-gray-700 uppercase tracking-widest mb-4">Customer Courier History</h3>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-black text-gray-900">{activeFraudResult.summary?.totalParcel || 0}</p>
                    <p className="text-xs text-gray-500 font-medium mt-1">Total Orders</p>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-emerald-600">{activeFraudResult.summary?.successParcel || 0}</p>
                    <p className="text-xs text-gray-500 font-medium mt-1">Delivered</p>
                  </div>
                  <div>
                    <p className="text-2xl font-black text-red-600">{activeFraudResult.summary?.cancelledParcel || 0}</p>
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
              {isCourierConfigured('pathao') && (
                <Button
                  type="button"
                  onClick={() => handleSelectCourierOption('pathao')}
                  variant="ghost"
                  size="md"
                  className="w-full justify-start gap-3 rounded-2xl border border-gray-200 bg-slate-50 px-5 py-4 text-left text-sm font-semibold text-slate-900 hover:bg-slate-100"
                >
                  <img src="/uploads/pathao.png" alt="Pathao" className="h-6 w-6 rounded-full" />
                  <span>Pathao</span>
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
          <PathaoModal
            isOpen={showPathao}
            onClose={() => { setShowPathao(false); setIsExchangeConsignment(false); }}
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
          result={storedFraudResult}
          checkedAt={customer?.fraudCheckedAt}
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

