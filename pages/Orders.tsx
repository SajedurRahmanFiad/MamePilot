
import React, { useState, useMemo, useEffect, useRef } from 'react';
import PortalMenu from '../components/PortalMenu';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Order, OrderStatus, hasAdminAccess, isEmployeeRole } from '../types';
import { formatCurrency, ICONS, getPaymentStatusBadgeColor, getPaymentStatusLabel, getStatusColor, getStatusDisplayName } from '../constants';
import FilterBar, { FilterRange } from '../components/FilterBar';
import DynamicFilterBar from '../components/DynamicFilterBar';
import { Button, TableLoadingSkeleton, OrderCompletionModal, type OrderCompletionFormState, SteadfastModal, CarryBeeModal, PaperflyModal } from '../components';
import { theme } from '../theme';
import { useAuth } from '../src/contexts/AuthProvider';
import { useAccounts, useOrdersPage, useUsers, useOrderSettings, useSystemDefaults, useCompanySettings } from '../src/hooks/useQueries';
import Pagination from '../src/components/Pagination';
import { useCompletePickedOrder, useCreateOrder } from '../src/hooks/useMutations';
import { DEFAULT_PAGE_SIZE, fetchOrderById } from '../src/services/supabaseQueries';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useUrlSyncedSearchQuery } from '../src/hooks/useUrlSyncedSearchQuery';
import { handlePrintOrder } from '../src/utils/printUtils';
import { buildHistoryBackState, getPositivePageParam } from '../src/utils/navigation';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import {
  buildLocalDateTime,
  extractSteadfastTrackingFromHistory,
  formatDate,
  getDateTimeFilters,
  getOrderActivityDate,
  getPaperflyReferenceNumber,
  getPreferredCourierFromHistory,
  getTodayDate,
} from '../utils';

const normalizeCourierFilterValue = (value: string | null | undefined): string => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '';
  if (normalized.includes('steadfast')) return 'steadfast';
  if (normalized.includes('carrybee')) return 'carrybee';
  if (normalized.includes('paperfly')) return 'paperfly';
  if (normalized.includes('manual') || normalized.includes('other')) return 'manual';
  return normalized;
};

const getCourierFilterLabel = (value: string | null | undefined): string => {
  switch (normalizeCourierFilterValue(value)) {
    case 'steadfast':
      return 'SteadFast';
    case 'carrybee':
      return 'CarryBee';
    case 'paperfly':
      return 'Paperfly';
    case 'manual':
      return 'Manual/Other';
    default:
      return String(value || '').trim() || 'Manual/Other';
  }
};

const Orders: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const toast = useToastNotifications();
  const { user, isLoading: authLoading } = useAuth();
  const isEmployee = isEmployeeRole(user?.role);
  const { can, canAccessRecord } = useRolePermissions();
  const canCreateOrders = can('orders.create');
  const createCompletionForm = (order?: Order | null): OrderCompletionFormState => ({
    outcome: 'Delivered',
    date: getTodayDate(),
    time: new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false }),
    accountId: '',
    amount: order ? Math.max(order.total - order.paidAmount, 0) : 0,
    paymentMethod: '',
    categoryId: '',
    note: '',
  });

  const {
    data: systemDefaults,
    isPending: systemDefaultsLoading,
    isError: systemDefaultsError,
  } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const canLoadOrders = !systemDefaultsLoading || !!systemDefaults || systemDefaultsError;

  const [searchParams, setSearchParams] = useSearchParams();
  const currentSearchParams = searchParams.toString();
  const urlPage = getPositivePageParam(searchParams.get('page'));
  const urlStatusTab = (searchParams.get('status') as OrderStatus | null) || 'All';
  const urlStatusNot = searchParams.get('statusNot') || '';
  const urlPaymentStatus = searchParams.get('paymentStatus') || '';
  const urlPaymentStatusNot = searchParams.get('paymentStatusNot') || '';
  const urlOrderNumber = searchParams.get('orderNumber') || '';
  const urlOrderNumberNot = searchParams.get('orderNumberNot') || '';
  const urlCustomerName = searchParams.get('customerName') || '';
  const urlCustomerNameNot = searchParams.get('customerNameNot') || '';
  const urlCustomerPhone = searchParams.get('customerPhone') || '';
  const urlCustomerPhoneNot = searchParams.get('customerPhoneNot') || '';
  const urlCompany = searchParams.get('company') || '';
  const urlCompanyNot = searchParams.get('companyNot') || '';
  const urlCourier = searchParams.get('courier') || '';
  const urlCourierNot = searchParams.get('courierNot') || '';
  const urlFilterRange = (searchParams.get('range') as FilterRange | null) || 'All Time';
  const urlCreatedByFilter = searchParams.get('createdBy') || 'all';
  const urlCreatedByNot = searchParams.get('createdByNot') || '';
  const urlCustomDates = {
    from: searchParams.get('from') || '',
    to: searchParams.get('to') || '',
  };
  const urlIncludeTime = searchParams.get('includeTime') === 'true';
  const { searchQuery } = useUrlSyncedSearchQuery(searchParams.get('search') || '');
  const [syncedSearchParams, setSyncedSearchParams] = useState<string | null>(null);
  const shouldHydrateFromUrl = syncedSearchParams !== currentSearchParams;

  const [filterRange, setFilterRange] = useState<FilterRange>(urlFilterRange);
  const [customDates, setCustomDates] = useState(urlCustomDates);
  const [includeTime, setIncludeTime] = useState<boolean>(urlIncludeTime);
  const [statusTab, setStatusTab] = useState<OrderStatus | 'All'>(urlStatusTab);
  const [statusNot, setStatusNot] = useState<string>(urlStatusNot);
  const [paymentStatus, setPaymentStatus] = useState<string>(urlPaymentStatus);
  const [paymentStatusNot, setPaymentStatusNot] = useState<string>(urlPaymentStatusNot);
  const [orderNumber, setOrderNumber] = useState<string>(urlOrderNumber);
  const [orderNumberNot, setOrderNumberNot] = useState<string>(urlOrderNumberNot);
  const [customerName, setCustomerName] = useState<string>(urlCustomerName);
  const [customerNameNot, setCustomerNameNot] = useState<string>(urlCustomerNameNot);
  const [customerPhone, setCustomerPhone] = useState<string>(urlCustomerPhone);
  const [customerPhoneNot, setCustomerPhoneNot] = useState<string>(urlCustomerPhoneNot);
  const [company, setCompany] = useState<string>(urlCompany);
  const [companyNot, setCompanyNot] = useState<string>(urlCompanyNot);
  const [courier, setCourier] = useState<string>(urlCourier);
  const [courierNot, setCourierNot] = useState<string>(urlCourierNot);
  const [createdByFilter, setCreatedByFilter] = useState<string>(urlCreatedByFilter);
  const [createdByNot, setCreatedByNot] = useState<string>(urlCreatedByNot);
  const [page, setPage] = useState<number>(urlPage);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [openActionsMenu, setOpenActionsMenu] = useState<string | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const previousSearchQueryRef = React.useRef(searchQuery);

  const [completionOrder, setCompletionOrder] = useState<Order | null>(null);
  const [showSteadfast, setShowSteadfast] = useState<string | null>(null);
  const [showCarryBee, setShowCarryBee] = useState<string | null>(null);
  const [showPaperfly, setShowPaperfly] = useState<string | null>(null);
  const [completionForm, setCompletionForm] = useState<OrderCompletionFormState>(createCompletionForm());

  const { data: users = [] } = useUsers();
  const { data: accounts = [] } = useAccounts();

  useEffect(() => {
    if (!shouldHydrateFromUrl) return;

    setPage(urlPage);
    setStatusTab(urlStatusTab);
    setStatusNot(urlStatusNot);
    setPaymentStatus(urlPaymentStatus);
    setPaymentStatusNot(urlPaymentStatusNot);
    setOrderNumber(urlOrderNumber);
    setOrderNumberNot(urlOrderNumberNot);
    setCustomerName(urlCustomerName);
    setCustomerNameNot(urlCustomerNameNot);
    setCustomerPhone(urlCustomerPhone);
    setCustomerPhoneNot(urlCustomerPhoneNot);
    setCompany(urlCompany);
    setCompanyNot(urlCompanyNot);
    setCourier(urlCourier);
    setCourierNot(urlCourierNot);
    setCreatedByFilter(urlCreatedByFilter);
    setCreatedByNot(urlCreatedByNot);
    setFilterRange(urlFilterRange);
    setCustomDates(urlCustomDates);
    setIncludeTime(urlIncludeTime);
    setSyncedSearchParams(currentSearchParams);
  }, [
    shouldHydrateFromUrl,
    urlPage,
    urlStatusTab,
    urlStatusNot,
    urlPaymentStatus,
    urlPaymentStatusNot,
    urlOrderNumber,
    urlOrderNumberNot,
    urlCustomerName,
    urlCustomerNameNot,
    urlCustomerPhone,
    urlCustomerPhoneNot,
    urlCreatedByFilter,
    urlCreatedByNot,
    urlFilterRange,
    urlCustomDates,
    urlIncludeTime,
    currentSearchParams,
  ]);

  // Force-refresh orders list when returning from OrderDetails after creating a new order.
  useEffect(() => {
    const navState = (location.state as any) || {};
    if (!navState.refreshOrders) return;

    queryClient.refetchQueries({ queryKey: ['orders'], exact: false, type: 'active' });
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, queryClient, navigate]);

  useEffect(() => {
    if (shouldHydrateFromUrl) {
      previousSearchQueryRef.current = searchQuery;
      return;
    }

    if (previousSearchQueryRef.current !== searchQuery) {
      setPage(1);
      previousSearchQueryRef.current = searchQuery;
    }
  }, [searchQuery, shouldHydrateFromUrl]);

  const effectivePage = shouldHydrateFromUrl ? urlPage : page;
  const effectiveStatusTab = shouldHydrateFromUrl ? urlStatusTab : statusTab;
  const effectiveStatusNot = shouldHydrateFromUrl ? urlStatusNot : statusNot;
  const effectivePaymentStatus = shouldHydrateFromUrl ? urlPaymentStatus : paymentStatus;
  const effectivePaymentStatusNot = shouldHydrateFromUrl ? urlPaymentStatusNot : paymentStatusNot;
  const effectiveOrderNumber = shouldHydrateFromUrl ? urlOrderNumber : orderNumber;
  const effectiveOrderNumberNot = shouldHydrateFromUrl ? urlOrderNumberNot : orderNumberNot;
  const effectiveCustomerName = shouldHydrateFromUrl ? urlCustomerName : customerName;
  const effectiveCustomerNameNot = shouldHydrateFromUrl ? urlCustomerNameNot : customerNameNot;
  const effectiveCustomerPhone = shouldHydrateFromUrl ? urlCustomerPhone : customerPhone;
  const effectiveCustomerPhoneNot = shouldHydrateFromUrl ? urlCustomerPhoneNot : customerPhoneNot;
  const effectiveCompany = shouldHydrateFromUrl ? urlCompany : company;
  const effectiveCompanyNot = shouldHydrateFromUrl ? urlCompanyNot : companyNot;
  const effectiveCourier = shouldHydrateFromUrl ? urlCourier : courier;
  const effectiveCourierNot = shouldHydrateFromUrl ? urlCourierNot : courierNot;
  const effectiveCreatedByFilter = shouldHydrateFromUrl ? urlCreatedByFilter : createdByFilter;
  const effectiveCreatedByNot = shouldHydrateFromUrl ? urlCreatedByNot : createdByNot;
  const effectiveFilterRange = shouldHydrateFromUrl ? urlFilterRange : filterRange;
  const effectiveCustomDates = shouldHydrateFromUrl ? urlCustomDates : customDates;
  const effectiveIncludeTime = shouldHydrateFromUrl ? urlIncludeTime : includeTime;

  // Compute server-side created_at range based on selected filter
  const timeFilters = useMemo(() => {
    return getDateTimeFilters(effectiveFilterRange, effectiveCustomDates);
  }, [effectiveFilterRange, effectiveCustomDates]);

  // Compute createdByIds based on createdByFilter
  const createdByIds = useMemo(() => {
    if (effectiveCreatedByFilter === 'all') return undefined;
    if (effectiveCreatedByFilter === 'admins') {
      return users.filter((u) => u.role === 'Admin').map((u) => u.id);
    }
    if (effectiveCreatedByFilter === 'employees') {
      return users.filter((u) => isEmployeeRole(u.role)).map((u) => u.id);
    }
    if (effectiveCreatedByFilter === 'developers') {
      return users.filter((u) => u.role === 'Developer').map((u) => u.id);
    }
    return [effectiveCreatedByFilter];
  }, [effectiveCreatedByFilter, users]);

  const normalizedEffectiveCourier = useMemo(() => normalizeCourierFilterValue(effectiveCourier), [effectiveCourier]);
  const normalizedEffectiveCourierNot = useMemo(() => normalizeCourierFilterValue(effectiveCourierNot), [effectiveCourierNot]);

  const { data: ordersPage, isFetching: ordersLoading } = useOrdersPage(effectivePage, pageSize, {
    status: effectiveStatusTab === 'All' ? undefined : effectiveStatusTab,
    statusNot: effectiveStatusNot || undefined,
    paymentStatus: effectivePaymentStatus || undefined,
    paymentStatusNot: effectivePaymentStatusNot || undefined,
    orderNumber: effectiveOrderNumber || undefined,
    orderNumberNot: effectiveOrderNumberNot || undefined,
    customerName: effectiveCustomerName || undefined,
    customerNameNot: effectiveCustomerNameNot || undefined,
    customerPhone: effectiveCustomerPhone || undefined,
    customerPhoneNot: effectiveCustomerPhoneNot || undefined,
    company: effectiveCompany || undefined,
    companyNot: effectiveCompanyNot || undefined,
    courier: normalizedEffectiveCourier || undefined,
    courierNot: normalizedEffectiveCourierNot || undefined,
    from: timeFilters.from,
    to: timeFilters.to,
    search: searchQuery,
    createdByIds,
    createdByNot: effectiveCreatedByNot || undefined,
  }, {
    enabled: canLoadOrders,
  });
  const orders = ordersPage?.data ?? [];

  const { data: companySettings } = useCompanySettings();

  const freeTextMetadataValues = useMemo(() => {
    return Array.from(
      new Set(
        orders.flatMap((order) => [
          order.id,
          order.orderNumber,
          order.customerName || '',
          order.customerPhone || '',
          order.customerAddress || '',
          order.creatorName || '',
        ]).filter((value) => typeof value === 'string' && value.trim() !== '')
      )
    );
  }, [orders]);

  const companyNames = useMemo(() => {
    const fromOrders = orders.map(o => String(o.pageSnapshot?.name || '').trim()).filter(Boolean);
    const fromSettings = (companySettings?.pages || []).map(p => String(p.name || '').trim()).filter(Boolean);
    const globalName = String(companySettings?.name || '').trim();
    return Array.from(new Set([...fromSettings, globalName, ...fromOrders].filter(Boolean)));
  }, [orders, companySettings]);

  const orderNumberOptions = useMemo(() => {
    return Array.from(new Set(orders.map((order) => String(order.orderNumber || '').trim()).filter(Boolean)));
  }, [orders]);

  const courierNames = useMemo(() => {
    const names = new Set<string>(['SteadFast', 'CarryBee', 'Paperfly', 'Manual/Other']);
    orders.forEach((o) => {
      const raw = String(o.history?.courier || '').trim();
      const historyText = raw.toLowerCase();
      if (o.carrybeeConsignmentId || historyText.includes('carrybee')) names.add('CarryBee');
      if (o.paperflyTrackingNumber || historyText.includes('paperfly')) names.add('Paperfly');
      if (o.steadfastConsignmentId || historyText.includes('steadfast')) names.add('SteadFast');
      const pref = getPreferredCourierFromHistory(o.history?.courier);
      if (pref === 'paperfly') names.add('Paperfly');
      if (pref === 'carrybee') names.add('CarryBee');
      if (pref === 'steadfast') names.add('SteadFast');
      if (raw && !historyText.includes('steadfast') && !historyText.includes('carrybee') && !historyText.includes('paperfly')) {
        names.add('Manual/Other');
      }
    });
    return Array.from(names);
  }, [orders]);
  const showOrdersTableLoading = !canLoadOrders || ordersLoading;
  const totalOrdersCount = ordersPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalOrdersCount / pageSize));

  const { data: orderSettings } = useOrderSettings();

  // Track location to detect browser back navigation
  const previousLocationRef = useRef<string>(location.pathname + location.search);
  const [isNavigatingViaHistory, setIsNavigatingViaHistory] = useState(false);

  useEffect(() => {
    const currentLocation = location.pathname + location.search;
    const prevLocation = previousLocationRef.current;

    // Detect back navigation: same pathname but different search params
    if (
      location.pathname === prevLocation.split('?')[0] &&
      currentLocation !== prevLocation &&
      location.search !== ''
    ) {
      setIsNavigatingViaHistory(true);
      const timer = setTimeout(() => setIsNavigatingViaHistory(false), 0);
      previousLocationRef.current = currentLocation;
      return () => clearTimeout(timer);
    }

    previousLocationRef.current = currentLocation;
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (shouldHydrateFromUrl || isNavigatingViaHistory) return;

    const params: Record<string, string> = {};
    if (effectivePage && effectivePage > 1) params.page = String(effectivePage);
    if (effectiveStatusTab && effectiveStatusTab !== 'All') params.status = String(effectiveStatusTab);
    if (effectiveStatusNot) params.statusNot = String(effectiveStatusNot);
    if (effectivePaymentStatus) params.paymentStatus = String(effectivePaymentStatus);
    if (effectivePaymentStatusNot) params.paymentStatusNot = String(effectivePaymentStatusNot);
    if (effectiveOrderNumber) params.orderNumber = effectiveOrderNumber;
    if (effectiveOrderNumberNot) params.orderNumberNot = effectiveOrderNumberNot;
    if (effectiveCustomerName) params.customerName = effectiveCustomerName;
    if (effectiveCustomerNameNot) params.customerNameNot = effectiveCustomerNameNot;
    if (effectiveCustomerPhone) params.customerPhone = effectiveCustomerPhone;
    if (effectiveCustomerPhoneNot) params.customerPhoneNot = effectiveCustomerPhoneNot;
    if (effectiveCompany) params.company = effectiveCompany;
    if (effectiveCompanyNot) params.companyNot = effectiveCompanyNot;
    if (effectiveCourier) params.courier = effectiveCourier;
    if (effectiveCourierNot) params.courierNot = effectiveCourierNot;
    if (effectiveFilterRange && effectiveFilterRange !== 'All Time') params.range = effectiveFilterRange;
    if (effectiveCustomDates.from) params.from = effectiveCustomDates.from;
    if (effectiveCustomDates.to) params.to = effectiveCustomDates.to;
    if (effectiveIncludeTime) params.includeTime = 'true';
    if (effectiveCreatedByFilter && effectiveCreatedByFilter !== 'all') params.createdBy = effectiveCreatedByFilter;
    if (effectiveCreatedByNot) params.createdByNot = effectiveCreatedByNot;
    if (searchQuery) params.search = searchQuery;

    if (new URLSearchParams(params).toString() !== currentSearchParams) {
      setSearchParams(params, { replace: true });
    }
  }, [
    shouldHydrateFromUrl,
    isNavigatingViaHistory,
    currentSearchParams,
    effectivePage,
    effectiveStatusTab,
    effectiveStatusNot,
    effectivePaymentStatus,
    effectivePaymentStatusNot,
    effectiveOrderNumber,
    effectiveOrderNumberNot,
    effectiveCustomerName,
    effectiveCustomerNameNot,
    effectiveCustomerPhone,
    effectiveCustomerPhoneNot,
    effectiveCompany,
    effectiveCompanyNot,
    effectiveCourier,
    effectiveCourierNot,
    effectiveFilterRange,
    effectiveCustomDates.from,
    effectiveCustomDates.to,
    effectiveIncludeTime,
    effectiveCreatedByFilter,
    effectiveCreatedByNot,
    searchQuery,
    setSearchParams,
  ]);

  // Wrapper functions that reset page AND apply filter (atomic operation)
  const handleStatusTabChange = (newStatus: OrderStatus | 'All') => {
    setPage(1);
    setStatusTab(newStatus);
  };

  const handleFilterRangeChange = (range: FilterRange) => {
    setPage(1);
    setFilterRange(range);
    // Clear customDates when switching away from 'Custom' to prevent stale date values
    if (range !== 'Custom') {
      setCustomDates({ from: '', to: '' });
    }
  };

  const handleCustomDatesChange = (dates: { from: string; to: string }) => {
    setPage(1);
    setCustomDates(dates);
  };

  const handleIncludeTimeChange = (include: boolean) => {
    setPage(1);
    setIncludeTime(include);
  };

  const handleCreatedByFilterChange = (filter: string) => {
    setPage(1);
    setCreatedByFilter(filter);
  };

  const createOrderMutation = useCreateOrder();
  const completePickedOrderMutation = useCompletePickedOrder();

  // Create a Map for O(1) user lookups instead of O(n) array searching
  const userMap = useMemo(() => {
    return new Map(users.map(u => [u.id, u]));
  }, [users]);


  // creatorName is delivered alongside the order via the joined query
  const getCreatorName = (order: Order) => order.creatorName || '';

  // orders already filtered/paginated by the server based on active filters
  const displayedOrders = orders;

  const handleDuplicate = async (order: Order) => {
    if (!orderSettings) {
      toast.error('Unable to generate new order number. Please try again.');
      return;
    }

    try {
      const sourceOrder = await fetchOrderById(order.id);
      if (!sourceOrder) {
        toast.error('Unable to load the source order for duplication.');
        return;
      }

      const newOrderNumber = `${orderSettings.prefix}${orderSettings.nextNumber}`;
      const newOrder: Omit<Order, 'id'> = {
        orderNumber: newOrderNumber,
        orderDate: getTodayDate(),
        customerId: sourceOrder.customerId,
        pageId: sourceOrder.pageId,
        pageSnapshot: sourceOrder.pageSnapshot,
        createdBy: user?.id || sourceOrder.createdBy,
        status: OrderStatus.ON_HOLD,
        items: sourceOrder.items,
        subtotal: sourceOrder.subtotal,
        discount: sourceOrder.discount,
        shipping: sourceOrder.shipping,
        total: sourceOrder.total,
        paidAmount: 0,
        history: sourceOrder.history,
        notes: sourceOrder.notes,
      };

      await createOrderMutation.mutateAsync(newOrder);
      // New orders appear on page 1 (newest-first) - cache is updated deterministically by the mutation hook
      toast.success('Order duplicated successfully');
    } catch (err) {
      console.error('Failed to duplicate order', err);
      toast.error('Failed to duplicate order: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const canEditOrder = (order: Order) => {
    if (order.status === OrderStatus.ON_HOLD) {
      if (can('orders.editAny')) return true;
      return can('orders.editOwn') && order.createdBy === user?.id;
    }

    // Allow Admin/Developer to edit picked orders
    if (order.status === OrderStatus.PICKED && hasAdminAccess(user?.role)) return true;

    return false;
  };

  const canDeliverOrder = (order: Order) =>
    canAccessRecord(order.createdBy, 'orders.markCompletedOwn', 'orders.markCompletedAny');

  const canReturnOrder = (order: Order) =>
    canAccessRecord(order.createdBy, 'orders.markReturnedOwn', 'orders.markReturnedAny');

  const openCompletionModal = (order: Order) => {
    setCompletionForm({
      ...createCompletionForm(order),
      outcome: canDeliverOrder(order) ? 'Delivered' : 'Returned',
    });
    setCompletionOrder(order);
  };

  const handleCompletePickedOrder = async () => {
    if (!completionOrder) return;

    try {
      const canMarkCompletionOrderDelivered = canDeliverOrder(completionOrder);
      const canMarkCompletionOrderReturned = canReturnOrder(completionOrder);

      if (completionForm.outcome === 'Delivered' && !canMarkCompletionOrderDelivered) {
        toast.error('You do not have permission to mark orders as completed.');
        return;
      }
      if (completionForm.outcome === 'Returned' && !canMarkCompletionOrderReturned) {
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
      }

      const fullDatetime = buildLocalDateTime(completionForm.date, completionForm.time);
      if (!fullDatetime) {
        toast.error('Please enter a valid date and time');
        return;
      }
      const payload: any = {
        orderId: completionOrder.id,
        outcome: completionForm.outcome,
        date: fullDatetime.toISOString(),
      };
      if (completionForm.outcome === 'Returned') {
        payload.accountId = completionForm.accountId;
        payload.amount = completionForm.amount;
        payload.paymentMethod = completionForm.paymentMethod;
        payload.categoryId = completionForm.categoryId;
        payload.note = completionForm.note;
      }
      const updatedOrder = await completePickedOrderMutation.mutateAsync(payload);

      setCompletionOrder(null);
      setCompletionForm(createCompletionForm());
      if ((updatedOrder.pendingTransactionCount || 0) > 0) {
        toast.info(
          `Order #${completionOrder.orderNumber} was finalized, and ${updatedOrder.pendingTransactionCount} transaction${updatedOrder.pendingTransactionCount === 1 ? '' : 's'} were sent for admin approval.`
        );
      } else {
        toast.success(
          completionForm.outcome === 'Returned'
            ? `Order #${completionOrder.orderNumber} marked as returned`
            : `Order #${completionOrder.orderNumber} marked as delivered`
        );
      }
    } catch (err) {
      console.error('Failed to finalize order:', err);
      toast.error('Failed to finalize order: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  const handleOpenTracking = (order: Order) => {
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

    const openSteadfastTracking = (): boolean => {
      if (!sentToSteadfast || !steadfastTracking) return false;

      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(steadfastTracking).catch(() => undefined);
      }
      toast.success(`Steadfast tracking code copied: ${steadfastTracking}`);
      window.open('https://steadfast.com.bd/tracking', '_blank', 'noopener,noreferrer');
      return true;
    };

    const openCarryBeeTracking = (): boolean => {
      if (!sentToCarryBee || !carryBeeConsignment) return false;

      window.open(`https://merchant.carrybee.com/order-track/${encodeURIComponent(carryBeeConsignment)}`, '_blank', 'noopener,noreferrer');
      return true;
    };

    const openPaperflyTracking = (): boolean => {
      if (!sentToPaperfly || !paperflyReference) return false;

      window.open(`https://go.paperfly.com.bd/track/order/${encodeURIComponent(paperflyReference)}`, '_blank', 'noopener,noreferrer');
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
      return;
    }

    if (courierHistory.includes('carrybee')) {
      toast.warning('CarryBee tracking code is missing for this order');
      return;
    }

    if (courierHistory.includes('paperfly')) {
      toast.warning('Paperfly reference number is missing for this order');
      return;
    }

    toast.warning('Tracking unavailable');
  };

  const canSendOrderToCourier = (order: Order, sentToAnyCourier: boolean) => (
    canAccessRecord(order.createdBy, 'orders.sendToCourierOwn', 'orders.sendToCourierAny')
      && order.status !== OrderStatus.PICKED
      && order.status !== OrderStatus.COMPLETED
      && order.status !== OrderStatus.RETURNED
      && order.status !== OrderStatus.CANCELLED
      && order.status !== OrderStatus.ON_HOLD
      && !sentToAnyCourier
  );

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div>
            <h2 className="md:text-2xl text-xl font-black text-gray-900 tracking-tight">Orders</h2>
          </div>
          <div className="hidden sm:block">
            <FilterBar 
              title="Orders"
              filterRange={effectiveFilterRange}
              setFilterRange={handleFilterRangeChange}
              customDates={effectiveCustomDates}
              setCustomDates={handleCustomDatesChange}
              includeTime={effectiveIncludeTime}
              setIncludeTime={handleIncludeTimeChange}
              compact={true}
            />
          </div>
        </div>
        {canCreateOrders && (
          <Button
            onClick={() => navigate('/orders/new')}
            variant="primary"
            size="md"
            icon={ICONS.Plus}
          >
            New Order
          </Button>
        )}
      </div>
      <div className="sm:hidden">
        <FilterBar 
          title="Orders"
          filterRange={effectiveFilterRange}
          setFilterRange={handleFilterRangeChange}
          customDates={effectiveCustomDates}
          setCustomDates={handleCustomDatesChange}
          includeTime={effectiveIncludeTime}
          setIncludeTime={handleIncludeTimeChange}
        />
      </div>
      {/* Pagination controls moved below the table to match other pages */}

      {/* Created By row removed per request */}

      <div className="mt-4">
        <DynamicFilterBar
          users={users}
          customers={Array.from(new Map(orders.map(o => [o.customerId || o.id, { id: o.customerId || o.id, name: o.customerName || '', phone: o.customerPhone || '' }])).values())}
          orderNumberOptions={orderNumberOptions}
          suggestionValues={freeTextMetadataValues}
          companies={companyNames}
          couriers={courierNames}
          freeTextLabel="Orders"
          onApply={(appliedFilters) => {
            // Apply filters: map known types to query params, others to search
            const params: Record<string, string> = {};
            // keep existing pagination reset
            setPage(1);

            const statusFilter = appliedFilters.find(f => f.type === 'Order Status');
            if (statusFilter) {
              if (statusFilter.operator === '≠') {
                // Exclude this status on the server
                setStatusTab('All');
                setStatusNot(statusFilter.value);
                params.statusNot = statusFilter.value;
              } else {
                setStatusTab(statusFilter.value as OrderStatus | 'All');
                setStatusNot('');
                params.status = statusFilter.value;
              }
            } else {
              setStatusTab('All');
              setStatusNot('');
            }

                const paymentFilter = appliedFilters.find(f => f.type === 'Payment Status');
                if (paymentFilter) {
                  if (paymentFilter.operator === '≠') {
                    setPaymentStatus('');
                    setPaymentStatusNot(paymentFilter.value);
                    params.paymentStatusNot = paymentFilter.value;
                  } else {
                    setPaymentStatus(paymentFilter.value);
                    setPaymentStatusNot('');
                    params.paymentStatus = paymentFilter.value;
                  }
                } else {
                  setPaymentStatus('');
                  setPaymentStatusNot('');
                }

            const createdByFilter = appliedFilters.find(f => f.type === 'Created by' && f.operator === '=');
            const createdByNotFilter = appliedFilters.find(f => f.type === 'Created by' && f.operator === '≠');
            if (createdByFilter) {
              setCreatedByFilter(createdByFilter.value);
              setCreatedByNot('');
              params.createdBy = createdByFilter.value;
            } else if (createdByNotFilter) {
              setCreatedByFilter('all');
              setCreatedByNot(createdByNotFilter.value);
              params.createdByNot = createdByNotFilter.value;
            } else {
              setCreatedByFilter('all');
              setCreatedByNot('');
            }

            const orderIdFilter = appliedFilters.find(f => f.type === 'Order ID' && f.operator === '=');
            const orderIdNotFilter = appliedFilters.find(f => f.type === 'Order ID' && f.operator === '≠');
            if (orderIdFilter) {
              setOrderNumber(orderIdFilter.value);
              setOrderNumberNot('');
              params.orderNumber = orderIdFilter.value;
            } else if (orderIdNotFilter) {
              setOrderNumber('');
              setOrderNumberNot(orderIdNotFilter.value);
              params.orderNumberNot = orderIdNotFilter.value;
            } else {
              setOrderNumber('');
              setOrderNumberNot('');
            }

            const customerNameFilter = appliedFilters.find(f => f.type === 'Customer Name' && f.operator === '=');
            const customerNameNotFilter = appliedFilters.find(f => f.type === 'Customer Name' && f.operator === '≠');
            if (customerNameFilter) {
              setCustomerName(customerNameFilter.value);
              setCustomerNameNot('');
              params.customerName = customerNameFilter.value;
            } else if (customerNameNotFilter) {
              setCustomerName('');
              setCustomerNameNot(customerNameNotFilter.value);
              params.customerNameNot = customerNameNotFilter.value;
            } else {
              setCustomerName('');
              setCustomerNameNot('');
            }

            const customerPhoneFilter = appliedFilters.find(f => f.type === 'Customer Phone' && f.operator === '=');
            const customerPhoneNotFilter = appliedFilters.find(f => f.type === 'Customer Phone' && f.operator === '≠');
            if (customerPhoneFilter) {
              setCustomerPhone(customerPhoneFilter.value);
              setCustomerPhoneNot('');
              params.customerPhone = customerPhoneFilter.value;
            } else if (customerPhoneNotFilter) {
              setCustomerPhone('');
              setCustomerPhoneNot(customerPhoneNotFilter.value);
              params.customerPhoneNot = customerPhoneNotFilter.value;
            } else {
              setCustomerPhone('');
              setCustomerPhoneNot('');
            }

            const companyFilter = appliedFilters.find(f => f.type === 'Company' && f.operator === '=');
            const companyNotFilter = appliedFilters.find(f => f.type === 'Company' && f.operator === '≠');
            if (companyFilter) {
              setCompany(companyFilter.value);
              setCompanyNot('');
              params.company = companyFilter.value;
            } else if (companyNotFilter) {
              setCompany('');
              setCompanyNot(companyNotFilter.value);
              params.companyNot = companyNotFilter.value;
            } else {
              setCompany('');
              setCompanyNot('');
            }

            const courierFilter = appliedFilters.find(f => f.type === 'Assigned courier' && f.operator === '=');
            const courierNotFilter = appliedFilters.find(f => f.type === 'Assigned courier' && f.operator === '≠');
            if (courierFilter) {
              const normalizedCourier = normalizeCourierFilterValue(courierFilter.value);
              setCourier(normalizedCourier);
              setCourierNot('');
              params.courier = normalizedCourier;
            } else if (courierNotFilter) {
              const normalizedCourierNot = normalizeCourierFilterValue(courierNotFilter.value);
              setCourier('');
              setCourierNot(normalizedCourierNot);
              params.courierNot = normalizedCourierNot;
            } else {
              setCourier('');
              setCourierNot('');
            }

            // other filters => search string
            const searchTerms = appliedFilters
              .filter(f => f.type === 'Free Text' || !['Order Status', 'Payment Status', 'Created by', 'Order ID', 'Customer Name', 'Customer Phone', 'Company', 'Assigned courier'].includes(f.type))
              .map(f => f.value);
            if (searchTerms.length > 0) params.search = searchTerms.join(' ');

            // also preserve existing range and from/to/includeTime if set
            if (filterRange && filterRange !== 'All Time') params.range = filterRange;
            if (customDates.from) params.from = customDates.from;
            if (customDates.to) params.to = customDates.to;
            if (includeTime) params.includeTime = 'true';

            setSearchParams(params, { replace: true });
          }}
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-visible">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Order Details</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Customer</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Created By</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Status</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-right">Net Amount</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] sm:hidden">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {showOrdersTableLoading ? (
                <TableLoadingSkeleton columns={5} rows={8} />
              ) : displayedOrders.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-20 text-center text-gray-400 italic font-medium">No sales orders found for this period.</td></tr>
              ) : displayedOrders.map((order) => {
                const custName = order.customerName ?? 'Unknown';
                const courierHistory = String(order.history?.courier || '').toLowerCase();
                const sentToSteadfast = courierHistory.includes('steadfast') || !!order.steadfastConsignmentId;
                const sentToCarryBee = courierHistory.includes('carrybee') || !!order.carrybeeConsignmentId;
                const sentToPaperfly = courierHistory.includes('paperfly') || !!order.paperflyTrackingNumber;
                const sentToAnyCourier = sentToSteadfast || sentToCarryBee || sentToPaperfly;
                const canEditSelectedOrder = canEditOrder(order);
                const canFinalizeSelectedOrder =
                  order.status === OrderStatus.PICKED && (canDeliverOrder(order) || canReturnOrder(order));
                const canSendSelectedOrderToCourier = canSendOrderToCourier(order, sentToAnyCourier);
                const canTrackSelectedOrder = sentToAnyCourier;
                const hasRowActions =
                  canEditSelectedOrder
                  || canFinalizeSelectedOrder
                  || canSendSelectedOrderToCourier
                  || canTrackSelectedOrder;
                const paymentStatusLabel = getPaymentStatusLabel(order.paidAmount, order.total);
                const paymentStatusBadge = getPaymentStatusBadgeColor(paymentStatusLabel);
                return (
                <tr 
                  key={order.id} 
                  onMouseEnter={() => {
                    setHoveredRow(order.id);
                    queryClient.prefetchQuery({
                      queryKey: ['order', order.id],
                      queryFn: () => fetchOrderById(order.id),
                      staleTime: 5 * 60 * 1000,
                    }).catch(() => {});
                  }} 
                  onMouseLeave={() => setHoveredRow(null)} 
                  onClick={() => navigate(`/orders/${order.id}`, { state: buildHistoryBackState(location) })} 
                  className="group relative hover:bg-[#ebf4ff]/20 cursor-pointer transition-all"
                >
                    <td className="px-6 py-5">
                      <span className="font-black text-gray-900">#{order.orderNumber}</span>
                      <p className="text-[10px] text-gray-400 font-bold mt-1 tracking-tight">{formatDate(getOrderActivityDate(order))}</p>
                    </td>
                    <td className="px-6 py-5">
                      <span className="text-sm font-bold text-gray-700">{custName}</span>
                      <p className="text-[10px] text-gray-400 font-medium mt-0.5">{order.customerPhone || ''}</p>
                    </td>
                    <td className="px-6 py-5 text-xs font-bold text-gray-500">{getCreatorName(order) || '—'}</td>
                    <td className="px-6 py-5">
                      <div className="flex flex-col gap-2">
                        <span className={`inline-flex max-w-fit px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${getStatusColor(order.status)}`}>{getStatusDisplayName(order.status)}</span>
                        <span className={`inline-flex max-w-fit px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${paymentStatusBadge}`}>
                          {paymentStatusLabel}
                        </span>
                      </div>
                      {(order.status === OrderStatus.PROCESSING || order.status === OrderStatus.PICKED) && sentToSteadfast && (
                        <img src="/uploads/steadfast.png" alt="Steadfast" className="inline-block w-5 h-5 rounded-full ml-2 mt-2" />
                      )}
                      {(order.status === OrderStatus.PROCESSING || order.status === OrderStatus.PICKED) && sentToCarryBee && (
                        <img src="/uploads/carrybee.png" alt="CarryBee" className="inline-block w-5 h-5 rounded-full ml-2 mt-2" />
                      )}
                      {(order.status === OrderStatus.PROCESSING || order.status === OrderStatus.PICKED) && sentToPaperfly && (
                        <img src="/uploads/paperfly.png" alt="Paperfly" className="inline-block w-5 h-5 rounded-full ml-2 mt-2" />
                      )}
                    </td>
                    <td className="px-6 py-5 text-right">
                      <span className="font-black text-gray-900 text-base">{formatCurrency(order.total)}</span>
                      {order.paidAmount > 0 && (
                        <p className={`text-[10px] font-black uppercase tracking-tighter mt-1 text-green-500`}>
                          {`Paid: ${formatCurrency(order.paidAmount)}`}
                        </p>
                      )}
                    </td>

                    {/* Mobile Actions Dropdown */}
                    <td className="px-6 py-5 sm:hidden relative z-[999]" onClick={e => e.stopPropagation()}>
                      {hasRowActions && (
                        <div className="relative z-[999]">
                          <button 
                            onClick={(e) => {
                              const target = e.currentTarget as HTMLElement;
                              if (openActionsMenu === order.id) {
                                setOpenActionsMenu(null);
                                setAnchorEl(null);
                              } else {
                                setOpenActionsMenu(order.id);
                                setAnchorEl(target);
                              }
                            }}
                            className="p-2 text-gray-400 hover:text-[#0f2f57] hover:bg-[#ebf4ff] rounded-lg transition-all"
                          >
                            {ICONS.More}
                          </button>
                          <PortalMenu anchorEl={anchorEl} open={openActionsMenu === order.id} onClose={() => { setOpenActionsMenu(null); setAnchorEl(null); }}>
                            <>
                              {canEditSelectedOrder && (
                                <button onClick={() => { navigate(`/orders/edit/${order.id}`); setOpenActionsMenu(null); setAnchorEl(null); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-gray-700">{ICONS.Edit} Edit</button>
                              )}
                              {canFinalizeSelectedOrder && (
                                <button onClick={() => { openCompletionModal(order); setOpenActionsMenu(null); setAnchorEl(null); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-gray-700">{ICONS.Check} Finalize Order</button>
                              )}
                              {(canEditSelectedOrder || canFinalizeSelectedOrder) && (canTrackSelectedOrder || canSendSelectedOrderToCourier) && (
                                <div className="border-t my-1"></div>
                              )}
                              {canTrackSelectedOrder && (
                                <button
                                  onClick={() => { handleOpenTracking(order); setOpenActionsMenu(null); setAnchorEl(null); }}
                                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-[#0f2f57]"
                                >
                                  {ICONS.Courier} Tracking
                                </button>
                              )}
                              {canSendSelectedOrderToCourier && (
                                <>
                                  {canTrackSelectedOrder && <div className="border-t my-1"></div>}
                                  <button onClick={() => { setShowSteadfast(order.id); setOpenActionsMenu(null); setAnchorEl(null); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-[#0f2f57]"><img src="../uploads/steadfast.png" alt="Steadfast" className="w-5 h-5 rounded-full"/> <span>Add to Steadfast</span></button>
                                  <button onClick={() => { setShowCarryBee(order.id); setOpenActionsMenu(null); setAnchorEl(null); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-[#0f2f57]"><img src="../uploads/carrybee.png" alt="CarryBee" className="w-5 h-5 rounded-full"/> <span>Add to CarryBee</span></button>
                                  <button onClick={() => { setShowPaperfly(order.id); setOpenActionsMenu(null); setAnchorEl(null); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-[#0f2f57]"><img src="/uploads/paperfly.png" alt="Paperfly" className="w-5 h-5 rounded-full"/> <span>Add to Paperfly</span></button>
                                </>
                              )}
                            </>
                          </PortalMenu>
                        </div>
                      )}
                    </td>

                    {/* Desktop Hover Actions */}
                    {hoveredRow === order.id && hasRowActions && (
                      <td className="absolute right-6 top-1/2 -translate-y-1/2 z-10 animate-in fade-in slide-in-from-right-2 duration-200 hidden sm:table-cell" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1.5 bg-white p-1.5 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-[#ebf4ff]">
                          {canEditSelectedOrder && (
                            <button onClick={() => navigate(`/orders/edit/${order.id}`)} className="p-2.5 text-gray-400 hover:text-[#0f2f57] hover:bg-[#ebf4ff] rounded-xl transition-all" title="Edit">{ICONS.Edit}</button>
                          )}
                          {canFinalizeSelectedOrder && (
                            <button onClick={() => openCompletionModal(order)} className="p-2.5 text-gray-400 hover:text-[#0f2f57] hover:bg-[#ebf4ff] rounded-xl transition-all" title="Finalize">{ICONS.Check}</button>
                          )}
                          {canTrackSelectedOrder && (
                            <button onClick={() => handleOpenTracking(order)} className="p-2.5 text-[#0f2f57] hover:bg-[#ebf4ff] rounded-xl transition-all" title="Tracking">{ICONS.Courier}</button>
                          )}
                          {canSendSelectedOrderToCourier && (
                            <>
                              <div className="h-5 w-px bg-gray-100 mx-1"></div>
                              <button onClick={() => setShowSteadfast(order.id)} className="px-1 py-1 text-[9px] font-black hover:bg-[#ebf4ff] rounded-lg" title="Send to Steadfast"><img src="/uploads/steadfast.png" alt="Steadfast" className="w-6 h-6 rounded-full"/></button>
                              <button onClick={() => setShowCarryBee(order.id)} className="px-1 py-1 text-[9px] font-black hover:bg-orange-50 rounded-lg" title="Send to CarryBee"><img src="/uploads/carrybee.png" alt="CarryBee" className="w-6 h-6 rounded-full"/></button>
                              <button onClick={() => setShowPaperfly(order.id)} className="px-1 py-1 text-[9px] font-black hover:bg-[#ebf4ff] rounded-lg" title="Send to Paperfly"><img src="/uploads/paperfly.png" alt="Paperfly" className="w-6 h-6 rounded-full"/></button>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {`Showing ${Math.min((effectivePage - 1) * pageSize + 1, totalOrdersCount || 0)} - ${Math.min(effectivePage * pageSize, totalOrdersCount || 0)} of ${totalOrdersCount} orders`}
          </div>
          <Pagination
            page={effectivePage}
            totalPages={totalPages}
            pageSize={pageSize}
            onPageChange={(p) => setPage(p)}
            disabled={ordersLoading}
          />
        </div>
      <OrderCompletionModal
        isOpen={!!completionOrder}
        onClose={() => setCompletionOrder(null)}
        onSubmit={handleCompletePickedOrder}
        order={completionOrder}
        form={completionForm}
        setForm={setCompletionForm}
        isLoading={completePickedOrderMutation.isPending}
        allowDeliveredOutcome={completionOrder ? canDeliverOrder(completionOrder) : false}
        allowReturnedOutcome={completionOrder ? canReturnOrder(completionOrder) : false}
      />

      <SteadfastModal 
        isOpen={!!showSteadfast} 
        onClose={() => setShowSteadfast(null)}
        order={showSteadfast ? orders.find(o => o.id === showSteadfast) : null}
        customer={
          showSteadfast
            ? (() => {
                const o = orders.find(o => o.id === showSteadfast);
                return o
                  ? { id: o.customerId, name: o.customerName || '', phone: o.customerPhone || '', address: o.customerAddress || '', totalOrders: 0, dueAmount: 0 }
                  : null;
              })()
            : null
        }
      />
      <CarryBeeModal 
        isOpen={!!showCarryBee} 
        onClose={() => setShowCarryBee(null)}
        order={showCarryBee ? orders.find(o => o.id === showCarryBee) : null}
        customer={
          showCarryBee
            ? (() => {
                const o = orders.find(o => o.id === showCarryBee);
                return o
                  ? { id: o.customerId, name: o.customerName || '', phone: o.customerPhone || '', address: o.customerAddress || '', totalOrders: 0, dueAmount: 0 }
                  : null;
              })()
            : null
        }
      />
      <PaperflyModal
        isOpen={!!showPaperfly}
        onClose={() => setShowPaperfly(null)}
        order={showPaperfly ? orders.find(o => o.id === showPaperfly) : null}
        customer={
          showPaperfly
            ? (() => {
                const o = orders.find(o => o.id === showPaperfly);
                return o
                  ? { id: o.customerId, name: o.customerName || '', phone: o.customerPhone || '', address: o.customerAddress || '', totalOrders: 0, dueAmount: 0 }
                  : null;
              })()
            : null
        }
      />
    </div>
  );
};

export default Orders;

