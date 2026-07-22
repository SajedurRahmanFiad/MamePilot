
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import PortalMenu from '../components/PortalMenu';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '../db';
import { Bill, BillStatus, hasAdminAccess, isEmployeeRole } from '../types';
import { formatCurrency, ICONS, getPaymentStatusLabel, getStatusColor } from '../constants';
import FilterBar, { FilterRange } from '../components/FilterBar';
import DynamicFilterBar from '../components/DynamicFilterBar';
import { Button, TableLoadingSkeleton } from '../components';
import { theme } from '../theme';
import { useBillsPage, useUsers, useSystemDefaults, useBillFilterOptions } from '../src/hooks/useQueries';
import Pagination from '../src/components/Pagination';
import { useCreateBill, useDeleteBill } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { DEFAULT_PAGE_SIZE, fetchBillById } from '../src/services/supabaseQueries';
import { useUrlSyncedSearchQuery } from '../src/hooks/useUrlSyncedSearchQuery';
import { buildHistoryBackState, getPositivePageParam } from '../src/utils/navigation';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { decodeDynamicTextFilterValue, encodeDynamicTextFilterValue, formatDate, formatDateTimeParts, getBillActivityDate, getDateTimeFilters, getTodayDate } from '../utils';

const PAYMENT_STATUS_OPTIONS = ['Paid', 'Partially Paid', 'Unpaid', 'Overpaid', 'Refunded'];

const getBillSettlementTotal = (bill: Bill): number => {
  const isVoidedBeforeReceipt = bill.status === BillStatus.CANCELLED
    || (bill.status === BillStatus.RETURNED && !String(bill.history?.return || '').trim());
  return isVoidedBeforeReceipt ? 0 : bill.total;
};

const Bills: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const toast = useToastNotifications();
  const user = db.currentUser;
  const { can, canAccessRecord } = useRolePermissions();
  const canCreateBills = can('bills.create');
  const {
    data: systemDefaults,
    isPending: systemDefaultsLoading,
    isError: systemDefaultsError,
  } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const canLoadBills = !systemDefaultsLoading || !!systemDefaults || systemDefaultsError;
  const [searchParams, setSearchParams] = useSearchParams();
  const currentSearchParams = searchParams.toString();
  const urlPage = getPositivePageParam(searchParams.get('page'));
  const urlFilterRange = (searchParams.get('range') as FilterRange | null) || 'All Time';
  const urlCustomDates = {
    from: searchParams.get('from') || '',
    to: searchParams.get('to') || '',
  };
  const urlStatusTab = (searchParams.get('status') as BillStatus | null) || 'All';
  const urlCreatedByFilter = searchParams.get('createdBy') || 'all';
  const urlCreatedByNotFilter = searchParams.get('createdByNot') || '';
  const urlBillStatusFilter = searchParams.get('billStatus') || 'all';
  const urlBillStatusNotFilter = searchParams.get('billStatusNot') || '';
  const urlPaymentStatusFilter = searchParams.get('paymentStatus') || 'all';
  const urlPaymentStatusNotFilter = searchParams.get('paymentStatusNot') || '';
  const urlBillIdFilter = searchParams.get('billId') || '';
  const urlBillIdNotFilter = searchParams.get('billIdNot') || '';
  const urlVendorNameFilter = searchParams.get('vendorName') || '';
  const urlVendorNameNotFilter = searchParams.get('vendorNameNot') || '';
  const urlVendorPhoneFilter = searchParams.get('vendorPhone') || '';
  const urlVendorPhoneNotFilter = searchParams.get('vendorPhoneNot') || '';
  const { searchQuery, setSearchQuery } = useUrlSyncedSearchQuery(searchParams.get('search') || '');
  const [syncedSearchParams, setSyncedSearchParams] = useState<string | null>(null);
  const shouldHydrateFromUrl = syncedSearchParams !== currentSearchParams;
  const [page, setPage] = useState<number>(urlPage);
  const [filterRange, setFilterRange] = useState<FilterRange>(urlFilterRange);
  const [customDates, setCustomDates] = useState(urlCustomDates);
  const [statusTab, setStatusTab] = useState<BillStatus | 'All'>(urlStatusTab);
  const [createdByFilter, setCreatedByFilter] = useState<string>(urlCreatedByFilter);
  const [createdByNotFilter, setCreatedByNotFilter] = useState<string>(urlCreatedByNotFilter);
  const [billIdFilter, setBillIdFilter] = useState('');
  const [billIdNotFilter, setBillIdNotFilter] = useState('');
  const [vendorNameFilter, setVendorNameFilter] = useState('');
  const [vendorNameNotFilter, setVendorNameNotFilter] = useState('');
  const [vendorPhoneFilter, setVendorPhoneFilter] = useState('');
  const [vendorPhoneNotFilter, setVendorPhoneNotFilter] = useState('');
  const [billStatusFilter, setBillStatusFilter] = useState('all');
  const [billStatusNotFilter, setBillStatusNotFilter] = useState('');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('all');
  const [paymentStatusNotFilter, setPaymentStatusNotFilter] = useState('');
  const previousSearchQueryRef = React.useRef(searchQuery);
  
  const { data: users = [] } = useUsers();

  useEffect(() => {
    if (!shouldHydrateFromUrl) return;

    setPage(urlPage);
    setFilterRange(urlFilterRange);
    setCustomDates(urlCustomDates);
    setStatusTab(urlStatusTab);
    setCreatedByFilter(urlCreatedByFilter);
    setCreatedByNotFilter(urlCreatedByNotFilter);
    setBillIdFilter(urlBillIdFilter);
    setBillIdNotFilter(urlBillIdNotFilter);
    setVendorNameFilter(urlVendorNameFilter);
    setVendorNameNotFilter(urlVendorNameNotFilter);
    setVendorPhoneFilter(urlVendorPhoneFilter);
    setVendorPhoneNotFilter(urlVendorPhoneNotFilter);
    setBillStatusFilter(urlBillStatusFilter);
    setBillStatusNotFilter(urlBillStatusNotFilter);
    setPaymentStatusFilter(urlPaymentStatusFilter);
    setPaymentStatusNotFilter(urlPaymentStatusNotFilter);
    setSyncedSearchParams(currentSearchParams);
  }, [
    shouldHydrateFromUrl,
    urlPage,
    urlFilterRange,
    urlCustomDates,
    urlStatusTab,
    urlCreatedByFilter,
    urlCreatedByNotFilter,
    urlBillIdFilter,
    urlBillIdNotFilter,
    urlVendorNameFilter,
    urlVendorNameNotFilter,
    urlVendorPhoneFilter,
    urlVendorPhoneNotFilter,
    urlBillStatusFilter,
    urlBillStatusNotFilter,
    urlPaymentStatusFilter,
    urlPaymentStatusNotFilter,
    currentSearchParams,
  ]);

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
  const effectiveFilterRange = shouldHydrateFromUrl ? urlFilterRange : filterRange;
  const effectiveCustomDates = shouldHydrateFromUrl ? urlCustomDates : customDates;
  const effectiveStatusTab = shouldHydrateFromUrl ? urlStatusTab : statusTab;
  const effectiveCreatedByFilter = shouldHydrateFromUrl ? urlCreatedByFilter : createdByFilter;
  const effectiveCreatedByNotFilter = shouldHydrateFromUrl ? urlCreatedByNotFilter : createdByNotFilter;
  const effectiveBillIdFilter = shouldHydrateFromUrl ? urlBillIdFilter : billIdFilter;
  const effectiveBillIdNotFilter = shouldHydrateFromUrl ? urlBillIdNotFilter : billIdNotFilter;
  const effectiveVendorNameFilter = shouldHydrateFromUrl ? urlVendorNameFilter : vendorNameFilter;
  const effectiveVendorNameNotFilter = shouldHydrateFromUrl ? urlVendorNameNotFilter : vendorNameNotFilter;
  const effectiveVendorPhoneFilter = shouldHydrateFromUrl ? urlVendorPhoneFilter : vendorPhoneFilter;
  const effectiveVendorPhoneNotFilter = shouldHydrateFromUrl ? urlVendorPhoneNotFilter : vendorPhoneNotFilter;
  const effectiveBillStatusFilter = shouldHydrateFromUrl ? urlBillStatusFilter : billStatusFilter;
  const effectiveBillStatusNotFilter = shouldHydrateFromUrl ? urlBillStatusNotFilter : billStatusNotFilter;
  const effectivePaymentStatusFilter = shouldHydrateFromUrl ? urlPaymentStatusFilter : paymentStatusFilter;
  const effectivePaymentStatusNotFilter = shouldHydrateFromUrl ? urlPaymentStatusNotFilter : paymentStatusNotFilter;

  const timeFilters = useMemo(
    () => getDateTimeFilters(effectiveFilterRange, effectiveCustomDates),
    [effectiveFilterRange, effectiveCustomDates]
  );

  const createdByIds = useMemo(() => {
    const requireMatch = (ids: string[]) => ids.length > 0 ? ids : ['__no_matching_creator__'];
    if (effectiveCreatedByFilter === 'all') return undefined;
    if (effectiveCreatedByFilter === 'admins') {
      return requireMatch(users.filter((u) => u.role === 'Admin').map((u) => u.id));
    }
    if (effectiveCreatedByFilter === 'employees') {
      return requireMatch(users.filter((u) => isEmployeeRole(u.role)).map((u) => u.id));
    }
    if (effectiveCreatedByFilter === 'developers') {
      return requireMatch(users.filter((u) => u.role === 'Developer').map((u) => u.id));
    }
    return [effectiveCreatedByFilter];
  }, [effectiveCreatedByFilter, users]);

  const createdByNotIds = useMemo(() => {
    if (!effectiveCreatedByNotFilter) return undefined;
    if (effectiveCreatedByNotFilter === 'admins') return users.filter((u) => u.role === 'Admin').map((u) => u.id);
    if (effectiveCreatedByNotFilter === 'employees') return users.filter((u) => isEmployeeRole(u.role)).map((u) => u.id);
    if (effectiveCreatedByNotFilter === 'developers') return users.filter((u) => u.role === 'Developer').map((u) => u.id);
    return [effectiveCreatedByNotFilter];
  }, [effectiveCreatedByNotFilter, users]);

  const handleRefreshBills = useCallback(() => {
    queryClient.refetchQueries({ queryKey: ['bills'], exact: false, type: 'active' });
  }, [queryClient]);

  const { data: billsPage, isFetching: billsLoading } = useBillsPage(effectivePage, pageSize, {
    status: effectiveStatusTab === 'All' ? undefined : effectiveStatusTab,
    from: timeFilters.from,
    to: timeFilters.to,
    search: searchQuery,
    createdByIds,
    createdByNotIds,
    billNumber: effectiveBillIdFilter || undefined,
    billNumberNot: effectiveBillIdNotFilter || undefined,
    vendorName: effectiveVendorNameFilter || undefined,
    vendorNameNot: effectiveVendorNameNotFilter || undefined,
    vendorPhone: effectiveVendorPhoneFilter || undefined,
    vendorPhoneNot: effectiveVendorPhoneNotFilter || undefined,
    billStatus: effectiveBillStatusFilter === 'all' ? undefined : effectiveBillStatusFilter,
    billStatusNot: effectiveBillStatusNotFilter || undefined,
    paymentStatus: effectivePaymentStatusFilter === 'all' ? undefined : effectivePaymentStatusFilter,
    paymentStatusNot: effectivePaymentStatusNotFilter || undefined,
  }, {
    enabled: canLoadBills,
  });
  const bills = billsPage?.data ?? [];
  const { data: billFilterOpts } = useBillFilterOptions();
  const billIdOptions = useMemo(
    () => billFilterOpts?.billNumbers || [],
    [billFilterOpts]
  );
  const vendorNameOptions = useMemo(
    () => billFilterOpts?.vendorNames || [],
    [billFilterOpts]
  );
  const vendorPhoneOptions = useMemo(
    () => billFilterOpts?.vendorPhones || [],
    [billFilterOpts]
  );

  const getFinalBillStatus = (bill: Bill) => {
    if (bill.status === BillStatus.RETURNED || bill.status === BillStatus.CANCELLED) return bill.status;
    const history = bill.history as Record<string, string | undefined> | undefined;
    if (history?.returned) return 'Returned';
    if (history?.cancelled) return 'Cancelled';
    if (bill.status === BillStatus.PAID || bill.status === BillStatus.RECEIVED) return 'Received';
    return bill.status;
  };

  const billStatusOptions = useMemo(() => {
    return ['On Hold', 'Processing', 'Received', 'Returned', 'Cancelled'];
  }, []);

  const billFilterDefinitions = useMemo(() => {
    const userOptions = [
      { value: 'admins', label: 'Admins' },
      { value: 'employees', label: 'Employees' },
      { value: 'developers', label: 'Developers' },
      ...users
        .slice()
        .sort((a, b) => a.role.localeCompare(b.role))
        .map((u) => ({ value: u.id, label: `${u.role}: ${u.name}` })),
    ];

    return [
      {
        type: 'Created by',
        operators: ['=', '≠'] as const,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return normalized
            ? userOptions.filter((option) => option.label.toLowerCase().includes(normalized))
            : userOptions;
        },
      },
      {
        type: 'Bill ID',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return billIdOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Vendor Name',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return vendorNameOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Vendor Phone',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return vendorPhoneOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Bill Status',
        operators: ['=', '≠'] as const,
        values: billStatusOptions,
      },
      {
        type: 'Payment Status',
        operators: ['=', '≠'] as const,
        values: PAYMENT_STATUS_OPTIONS,
      },
    ];
  }, [users, billIdOptions, vendorNameOptions, vendorPhoneOptions]);

  const initialFilters = useMemo(() => {
    const filters: Array<any> = [];
    const getCreatorFilterLabel = (value: string) => value === 'admins' ? 'Admins'
      : value === 'employees' ? 'Employees'
        : value === 'developers' ? 'Developers'
          : users.find((user) => user.id === value)?.name || value;
    const addTextFilter = (id: string, type: string, encoded: string, negative = false) => {
      if (!encoded) return;
      const { contains, value } = decodeDynamicTextFilterValue(encoded);
      filters.push({
        id,
        type,
        operator: contains ? (negative ? 'does not contain' : 'contains') : (negative ? '≠' : '='),
        value,
      });
    };
    if (effectiveCreatedByFilter !== 'all') filters.push({ id: 'created-by', type: 'Created by', operator: '=', value: effectiveCreatedByFilter, display: getCreatorFilterLabel(effectiveCreatedByFilter) });
    if (effectiveCreatedByNotFilter) filters.push({ id: 'created-by-not', type: 'Created by', operator: '≠', value: effectiveCreatedByNotFilter, display: getCreatorFilterLabel(effectiveCreatedByNotFilter) });
    addTextFilter('bill-id', 'Bill ID', effectiveBillIdFilter);
    addTextFilter('bill-id-not', 'Bill ID', effectiveBillIdNotFilter, true);
    addTextFilter('vendor-name', 'Vendor Name', effectiveVendorNameFilter);
    addTextFilter('vendor-name-not', 'Vendor Name', effectiveVendorNameNotFilter, true);
    addTextFilter('vendor-phone', 'Vendor Phone', effectiveVendorPhoneFilter);
    addTextFilter('vendor-phone-not', 'Vendor Phone', effectiveVendorPhoneNotFilter, true);
    if (effectiveBillStatusFilter !== 'all') filters.push({ id: 'bill-status', type: 'Bill Status', operator: '=', value: effectiveBillStatusFilter });
    if (effectiveBillStatusNotFilter) filters.push({ id: 'bill-status-not', type: 'Bill Status', operator: '≠', value: effectiveBillStatusNotFilter });
    if (effectivePaymentStatusFilter !== 'all') filters.push({ id: 'payment-status', type: 'Payment Status', operator: '=', value: effectivePaymentStatusFilter });
    if (effectivePaymentStatusNotFilter) filters.push({ id: 'payment-status-not', type: 'Payment Status', operator: '≠', value: effectivePaymentStatusNotFilter });
    return filters;
  }, [effectiveCreatedByFilter, effectiveCreatedByNotFilter, effectiveBillIdFilter, effectiveBillIdNotFilter, effectiveVendorNameFilter, effectiveVendorNameNotFilter, effectiveVendorPhoneFilter, effectiveVendorPhoneNotFilter, effectiveBillStatusFilter, effectiveBillStatusNotFilter, effectivePaymentStatusFilter, effectivePaymentStatusNotFilter, users]);

  const showBillsTableLoading = !canLoadBills || billsLoading;
  const total = billsPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (!shouldHydrateFromUrl) return;

    setPage(urlPage);
    setFilterRange(urlFilterRange);
    setCustomDates(urlCustomDates);
    setStatusTab(urlStatusTab);
    setCreatedByFilter(urlCreatedByFilter);
    setCreatedByNotFilter(urlCreatedByNotFilter);
    setBillIdFilter(urlBillIdFilter);
    setBillIdNotFilter(urlBillIdNotFilter);
    setVendorNameFilter(urlVendorNameFilter);
    setVendorNameNotFilter(urlVendorNameNotFilter);
    setVendorPhoneFilter(urlVendorPhoneFilter);
    setVendorPhoneNotFilter(urlVendorPhoneNotFilter);
    setBillStatusFilter(urlBillStatusFilter);
    setBillStatusNotFilter(urlBillStatusNotFilter);
    setPaymentStatusFilter(urlPaymentStatusFilter);
    setPaymentStatusNotFilter(urlPaymentStatusNotFilter);
    setSyncedSearchParams(currentSearchParams);
  }, [
    shouldHydrateFromUrl,
    urlPage,
    urlFilterRange,
    urlCustomDates,
    urlStatusTab,
    urlCreatedByFilter,
    urlCreatedByNotFilter,
    urlBillIdFilter,
    urlBillIdNotFilter,
    urlVendorNameFilter,
    urlVendorNameNotFilter,
    urlVendorPhoneFilter,
    urlVendorPhoneNotFilter,
    urlBillStatusFilter,
    urlBillStatusNotFilter,
    urlPaymentStatusFilter,
    urlPaymentStatusNotFilter,
    currentSearchParams,
  ]);

  useEffect(() => {
    if (shouldHydrateFromUrl) return;

    const params: Record<string, string> = {};
    if (effectivePage > 1) params.page = String(effectivePage);
    if (effectiveFilterRange !== 'All Time') params.range = effectiveFilterRange;
    if (effectiveCustomDates.from) params.from = effectiveCustomDates.from;
    if (effectiveCustomDates.to) params.to = effectiveCustomDates.to;
    if (effectiveStatusTab !== 'All') params.status = effectiveStatusTab;
    if (effectiveCreatedByFilter !== 'all') params.createdBy = effectiveCreatedByFilter;
    if (effectiveCreatedByNotFilter) params.createdByNot = effectiveCreatedByNotFilter;
    if (effectiveBillStatusFilter !== 'all') params.billStatus = effectiveBillStatusFilter;
    if (effectiveBillStatusNotFilter) params.billStatusNot = effectiveBillStatusNotFilter;
    if (effectivePaymentStatusFilter !== 'all') params.paymentStatus = effectivePaymentStatusFilter;
    if (effectivePaymentStatusNotFilter) params.paymentStatusNot = effectivePaymentStatusNotFilter;
    if (effectiveBillIdFilter) params.billId = effectiveBillIdFilter;
    if (effectiveBillIdNotFilter) params.billIdNot = effectiveBillIdNotFilter;
    if (effectiveVendorNameFilter) params.vendorName = effectiveVendorNameFilter;
    if (effectiveVendorNameNotFilter) params.vendorNameNot = effectiveVendorNameNotFilter;
    if (effectiveVendorPhoneFilter) params.vendorPhone = effectiveVendorPhoneFilter;
    if (effectiveVendorPhoneNotFilter) params.vendorPhoneNot = effectiveVendorPhoneNotFilter;
    if (searchQuery) params.search = searchQuery;

    if (new URLSearchParams(params).toString() !== currentSearchParams) {
      setSearchParams(params, { replace: true });
    }
  }, [
    shouldHydrateFromUrl,
    effectivePage,
    effectiveFilterRange,
    effectiveCustomDates.from,
    effectiveCustomDates.to,
    effectiveStatusTab,
    effectiveCreatedByFilter,
    effectiveCreatedByNotFilter,
    effectiveBillStatusFilter,
    effectiveBillStatusNotFilter,
    effectivePaymentStatusFilter,
    effectivePaymentStatusNotFilter,
    effectiveBillIdFilter,
    effectiveBillIdNotFilter,
    effectiveVendorNameFilter,
    effectiveVendorNameNotFilter,
    effectiveVendorPhoneFilter,
    effectiveVendorPhoneNotFilter,
    searchQuery,
    currentSearchParams,
    setSearchParams,
  ]);

  // Wrapper functions that reset page AND apply filter (atomic operation)
  const handleStatusTabChange = (newStatus: BillStatus | 'All') => {
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

  const handleCreatedByFilterChange = (filter: string) => {
    setPage(1);
    setCreatedByFilter(filter);
  };

  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [openActionsMenu, setOpenActionsMenu] = useState<string | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const createMutation = useCreateBill();
  const deleteMutation = useDeleteBill();

  // Create a Map for O(1) user lookups instead of O(n) array searching
  const userMap = useMemo(() => {
    return new Map(users.map(u => [u.id, u]));
  }, [users]);

  // Helper to get creator name from createdBy field or history
  const getCreatorName = (bill: Bill) => {
    // First try to lookup from createdBy database field using O(1) Map lookup
    if (bill.createdBy?.trim()) {
      const user = userMap.get(bill.createdBy);
      if (user?.name) return user.name;
    }
    
    // Fallback: extract from history for older records
    if (bill.history?.created) {
      // Bills history format: "Created by {name} on ..."
      const match = bill.history.created.match(/Created by\s+(.+?)\s+on/);
      if (match && match[1]) return match[1];
    }
    
    return null;
  };

  // Every dynamic filter is included in the server query so pagination and
  // total counts describe the same dataset as the visible rows.
  const filteredBills = bills;

  const handleDuplicate = async (bill: Bill) => {
    try {
      const sourceBill = await fetchBillById(bill.id);
      if (!sourceBill) {
        toast.error('Unable to load the source bill for duplication.');
        return;
      }

      const now = new Date();
      const { date: dateStr, time: timeStr } = formatDateTimeParts(now);
      
      const newBillData: Omit<Bill, 'id'> = {
        billNumber: `PUR-${Math.floor(1000 + Math.random() * 9000)}`,
        billDate: getTodayDate(),
        vendorId: sourceBill.vendorId,
        createdBy: user?.id || sourceBill.createdBy,
        status: BillStatus.ON_HOLD,
        items: sourceBill.items,
        subtotal: sourceBill.subtotal,
        discount: sourceBill.discount,
        shipping: sourceBill.shipping,
        total: sourceBill.total,
        paidAmount: 0,
        notes: sourceBill.notes,
        history: {
          created: `Created as duplicate on ${dateStr}, at ${timeStr}`
        }
      };

      await createMutation.mutateAsync(newBillData as any);
      // Cache updated deterministically by mutation hook
    } catch (error) {
      console.error('Failed to duplicate bill:', error);
      toast.error('Failed to duplicate bill');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Move this bill to the recycle bin? You can restore it later.')) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Bill moved to the recycle bin');
      // Cache updated deterministically by mutation hook
    } catch (error) {
      console.error('Failed to delete bill:', error);
      toast.error('Failed to delete bill');
    }
  };

  const canEditBill = (bill: Bill) =>
    canAccessRecord(bill.createdBy, 'bills.editOwn', 'bills.editAny');

  const canDeleteBill = (bill: Bill) =>
    canAccessRecord(bill.createdBy, 'bills.deleteOwn', 'bills.deleteAny');

  return (
    <div className="space-y-2 sm:space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div className="hidden sm:block">
            <FilterBar
              title="Bills"
              filterRange={effectiveFilterRange}
              setFilterRange={handleFilterRangeChange}
              customDates={effectiveCustomDates}
              setCustomDates={handleCustomDatesChange}
              compact={true}
              onRefresh={handleRefreshBills}
              isRefreshing={billsLoading}
            />
          </div>
        </div>
        {canCreateBills && (
          <Button
            onClick={() => navigate('/bills/new')}
            variant="primary"
            size="md"
            icon={ICONS.Plus}
          >
            New Bill
          </Button>
        )}
      </div>
      <div className="sm:hidden">
        <FilterBar
          title="Bills"
          filterRange={effectiveFilterRange}
          setFilterRange={handleFilterRangeChange}
          customDates={effectiveCustomDates}
          setCustomDates={handleCustomDatesChange}
          onRefresh={handleRefreshBills}
          isRefreshing={billsLoading}
        />
      </div>

      <DynamicFilterBar
        filterDefinitions={billFilterDefinitions}
        initialFilters={initialFilters}
        users={users}
        onApply={(appliedFilters) => {
          setPage(1);
          const encodeTextValue = (filter: { operator: string; value: string }) =>
            encodeDynamicTextFilterValue(filter.value, filter.operator.includes('contain'));

          const createdByFilter = appliedFilters.find((f) => f.type === 'Created by' && f.operator === '=');
          const createdByNotFilter = appliedFilters.find((f) => f.type === 'Created by' && f.operator === '≠');
          if (createdByFilter) {
            setCreatedByFilter(createdByFilter.value);
            setCreatedByNotFilter('');
          } else if (createdByNotFilter) {
            setCreatedByFilter('all');
            setCreatedByNotFilter(createdByNotFilter.value);
          } else {
            setCreatedByFilter('all');
            setCreatedByNotFilter('');
          }

          const billIdFilter = appliedFilters.find((f) => f.type === 'Bill ID' && (f.operator === '=' || f.operator === 'contains'));
          const billIdNotFilter = appliedFilters.find((f) => f.type === 'Bill ID' && (f.operator === '≠' || f.operator === 'does not contain'));
          const vendorNameFilter = appliedFilters.find((f) => f.type === 'Vendor Name' && (f.operator === '=' || f.operator === 'contains'));
          const vendorNameNotFilter = appliedFilters.find((f) => f.type === 'Vendor Name' && (f.operator === '≠' || f.operator === 'does not contain'));
          const vendorPhoneFilter = appliedFilters.find((f) => f.type === 'Vendor Phone' && (f.operator === '=' || f.operator === 'contains'));
          const vendorPhoneNotFilter = appliedFilters.find((f) => f.type === 'Vendor Phone' && (f.operator === '≠' || f.operator === 'does not contain'));
          const billStatusFilter = appliedFilters.find((f) => f.type === 'Bill Status' && f.operator === '=');
          const billStatusNotFilter = appliedFilters.find((f) => f.type === 'Bill Status' && f.operator === '≠');
          const paymentStatusFilter = appliedFilters.find((f) => f.type === 'Payment Status' && f.operator === '=');
          const paymentStatusNotFilter = appliedFilters.find((f) => f.type === 'Payment Status' && f.operator === '≠');

          setBillIdFilter(billIdFilter ? encodeTextValue(billIdFilter) : '');
          setBillIdNotFilter(billIdNotFilter ? encodeTextValue(billIdNotFilter) : '');
          setVendorNameFilter(vendorNameFilter ? encodeTextValue(vendorNameFilter) : '');
          setVendorNameNotFilter(vendorNameNotFilter ? encodeTextValue(vendorNameNotFilter) : '');
          setVendorPhoneFilter(vendorPhoneFilter ? encodeTextValue(vendorPhoneFilter) : '');
          setVendorPhoneNotFilter(vendorPhoneNotFilter ? encodeTextValue(vendorPhoneNotFilter) : '');
          setBillStatusFilter(billStatusFilter?.value ?? 'all');
          setBillStatusNotFilter(billStatusNotFilter?.value ?? '');
          setPaymentStatusFilter(paymentStatusFilter?.value ?? 'all');
          setPaymentStatusNotFilter(paymentStatusNotFilter?.value ?? '');
        }}
      />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-visible">
        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full whitespace-nowrap text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Bill Details</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Vendor</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Created By</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Status</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-right">Net Amount</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] sm:hidden">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {showBillsTableLoading ? (
                <TableLoadingSkeleton columns={5} rows={8} />
              ) : filteredBills.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-20 text-center text-gray-400 italic font-medium">No purchase bills found for this period.</td></tr>
              ) : filteredBills.map((bill) => {
                const canEditSelectedBill = canEditBill(bill);
                const canDeleteSelectedBill = canDeleteBill(bill);
                const hasRowActions = canEditSelectedBill || canDeleteSelectedBill;

                const settlementTotal = getBillSettlementTotal(bill);
                const paymentStatusLabel = getPaymentStatusLabel(bill.paidAmount, settlementTotal, bill.history);
                const isPartiallyPaid = paymentStatusLabel === 'Partially paid' || paymentStatusLabel === 'Partially Paid';
                const isUnpaid = paymentStatusLabel === 'Unpaid';
                const isRefunded = paymentStatusLabel === 'Refunded';
                const isOverpaid = paymentStatusLabel === 'Overpaid';
                const isFullyPaid = !isPartiallyPaid && !isUnpaid && !isRefunded && !isOverpaid && bill.paidAmount >= settlementTotal;
                const paidAmountTextColor = isPartiallyPaid ? 'text-amber-500' : (isRefunded || isOverpaid) ? 'text-orange-500' : isUnpaid ? 'text-red-500' : 'text-green-500';

                return (
                <tr 
                  key={bill.id} 
                  onMouseEnter={() => {
                    setHoveredRow(bill.id);
                    queryClient.prefetchQuery({
                      queryKey: ['bill', bill.id],
                      queryFn: () => fetchBillById(bill.id),
                      staleTime: 5 * 60 * 1000,
                    }).catch(() => {});
                  }} 
                  onMouseLeave={() => setHoveredRow(null)} 
                  onClick={() => navigate(`/bills/${bill.id}`, { state: buildHistoryBackState(location) })} 
                  className="group relative hover:bg-[#ebf4ff]/20 cursor-pointer transition-all"
                >
                  <td className="px-6 py-5">
                    <span className="whitespace-nowrap font-black text-gray-900">#{bill.billNumber}</span>
                    <p className="text-[10px] text-gray-400 font-bold mt-1 tracking-tight">{formatDate(getBillActivityDate(bill))}</p>
                  </td>
                  <td className="px-6 py-5">
                    <span className="text-sm font-bold text-gray-700">{bill.vendorName || 'Unknown Vendor'}</span>
                    <p className="text-[10px] text-gray-400 font-medium mt-0.5">{bill.vendorPhone || ''}</p>
                  </td>
                  <td className="px-6 py-5 text-xs font-bold text-gray-500">{bill.creatorName || getCreatorName(bill) || '—'}</td>
                  <td className="px-6 py-5">
                    <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${getStatusColor(bill.status)}`}>{bill.status}</span>
                  </td>
                  <td className="px-6 py-5 text-right">
                    <span className="font-black text-gray-900 text-base">{formatCurrency(bill.total)}</span>
                    {isOverpaid ? (
                      <p className={`text-[10px] font-black uppercase tracking-tighter mt-1 ${paidAmountTextColor}`}>
                        Overpaid · refund due {formatCurrency(Math.max(bill.paidAmount - settlementTotal, 0))}
                      </p>
                    ) : isRefunded ? (
                      <p className={`text-[10px] font-black uppercase tracking-tighter mt-1 ${paidAmountTextColor}`}>
                        Refunded
                      </p>
                    ) : isUnpaid ? (
                      <p className={`text-[10px] font-black uppercase tracking-tighter mt-1 ${paidAmountTextColor}`}>
                        Unpaid
                      </p>
                    ) : isFullyPaid ? (
                      <p className={`text-[10px] font-black uppercase tracking-tighter mt-1 ${paidAmountTextColor}`}>
                        Paid
                      </p>
                    ) : bill.paidAmount > 0 ? (
                      <p className={`text-[10px] font-black uppercase tracking-tighter mt-1 ${paidAmountTextColor}`}>
                        {`Paid: ${formatCurrency(bill.paidAmount)}`}
                      </p>
                    ) : null}
                  </td>

                  {/* Mobile Actions Dropdown */}
                  <td className="px-6 py-5 sm:hidden relative z-[999]" onClick={e => e.stopPropagation()}>
                    {hasRowActions && (
                      <div className="relative z-[999]">
                        <button
                          onClick={(e) => {
                            const target = e.currentTarget as HTMLElement;
                            if (openActionsMenu === bill.id) {
                              setOpenActionsMenu(null);
                              setAnchorEl(null);
                            } else {
                              setOpenActionsMenu(bill.id);
                              setAnchorEl(target);
                            }
                          }}
                          className="p-2 text-gray-400 hover:text-[#0f2f57] hover:bg-[#ebf4ff] rounded-lg transition-all"
                        >
                          {ICONS.More}
                        </button>
                        <PortalMenu anchorEl={anchorEl} open={openActionsMenu === bill.id} onClose={() => { setOpenActionsMenu(null); setAnchorEl(null); }}>
                          {canEditSelectedBill && <button onClick={() => { navigate(`/bills/edit/${bill.id}`); setOpenActionsMenu(null); setAnchorEl(null); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-gray-700">{ICONS.Edit} Edit</button>}
                          {canDeleteSelectedBill && (
                            <>
                              {canEditSelectedBill && <div className="border-t my-1"></div>}
                              <button onClick={() => { handleDelete(bill.id); setOpenActionsMenu(null); setAnchorEl(null); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-red-50 flex items-center gap-2 font-bold text-red-600">{ICONS.Delete} Delete</button>
                            </>
                          )}
                        </PortalMenu>
                      </div>
                    )}
                  </td>

                  {/* Desktop Hover Actions */}
                  {hoveredRow === bill.id && hasRowActions && (
                    <td className="absolute right-6 top-1/2 -translate-y-1/2 z-10 animate-in fade-in slide-in-from-right-2 duration-200 hidden sm:table-cell" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 bg-white p-1.5 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-[#ebf4ff]">
                        {canEditSelectedBill && <button onClick={() => navigate(`/bills/edit/${bill.id}`)} className="p-2.5 text-gray-400 hover:text-[#0f2f57] hover:bg-[#ebf4ff] rounded-xl transition-all" title="Edit">{ICONS.Edit}</button>}
                        {canDeleteSelectedBill && (
                          <>
                            {canEditSelectedBill && <div className="h-5 w-px bg-gray-100 mx-1"></div>}
                            <button onClick={() => handleDelete(bill.id)} className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all" title="Delete">{ICONS.Delete}</button>
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
      <Pagination page={effectivePage} totalPages={totalPages} onPageChange={(p) => setPage(p)} disabled={billsLoading} />
    </div>
  );
};

export default Bills;



