
import React, { useCallback, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Customer, hasAdminAccess, isEmployeeRole } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { Button, Table, TableCell, IconButton, TableLoadingSkeleton } from '../components';
import DynamicFilterBar from '../components/DynamicFilterBar';
import FilterBar, { FilterRange } from '../components/FilterBar';
import Pagination from '../src/components/Pagination';
import { theme } from '../theme';
import { useCustomersPage, useSystemDefaults, useUsers, useCustomerFilterOptions } from '../src/hooks/useQueries';
import { useDeleteCustomer } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useAuth } from '../src/contexts/AuthProvider';
import { useUrlSyncedSearchQuery } from '../src/hooks/useUrlSyncedSearchQuery';
import { DEFAULT_PAGE_SIZE, fetchCustomerById, getErrorMessage } from '../src/services/supabaseQueries';
import { useMemo, useEffect } from 'react';
import { isTempId } from '../src/utils/optimisticIdMap';
import { buildHistoryBackState, getPositivePageParam } from '../src/utils/navigation';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { decodeDynamicTextFilterValue, encodeDynamicTextFilterValue } from '../utils';

const Customers: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const toast = useToastNotifications();
  const { user } = useAuth();
  const {
    data: systemDefaults,
    isPending: systemDefaultsLoading,
    isError: systemDefaultsError,
  } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const canLoadCustomers = !systemDefaultsLoading || !!systemDefaults || systemDefaultsError;
  const [searchParams, setSearchParams] = useSearchParams();
  const currentSearchParams = searchParams.toString();
  const urlPage = getPositivePageParam(searchParams.get('page'));
  const { searchQuery } = useUrlSyncedSearchQuery(searchParams.get('search') || '');
  const [syncedSearchParams, setSyncedSearchParams] = React.useState<string | null>(null);
  const shouldHydrateFromUrl = syncedSearchParams !== currentSearchParams;
  const [page, setPage] = React.useState<number>(urlPage);
  const previousSearchQueryRef = React.useRef(searchQuery);
  const effectivePage = shouldHydrateFromUrl ? urlPage : page;
  const { data: users = [] } = useUsers();
  const handleRefreshCustomers = useCallback(() => {
    queryClient.refetchQueries({ queryKey: ['customers'], exact: false, type: 'active' });
  }, [queryClient]);
  const deleteCustomerMutation = useDeleteCustomer();
  const { data: customerFilterOpts } = useCustomerFilterOptions();
  const isAdmin = hasAdminAccess(user?.role);
  const { can } = useRolePermissions();
  const canCreateCustomers = can('customers.create');
  const canEditCustomers = can('customers.edit');
  const canDeleteCustomers = can('customers.delete');

  const [createdByFilter, setCreatedByFilter] = React.useState<string>('all');
  const [createdByNotFilter, setCreatedByNotFilter] = React.useState<string>('');
  const [nameFilter, setNameFilter] = React.useState<string>('');
  const [nameNotFilter, setNameNotFilter] = React.useState<string>('');
  const [phoneFilter, setPhoneFilter] = React.useState<string>('');
  const [phoneNotFilter, setPhoneNotFilter] = React.useState<string>('');
  const [addressFilter, setAddressFilter] = React.useState<string>('');
  const [addressNotFilter, setAddressNotFilter] = React.useState<string>('');
  const [totalOrdersFilter, setTotalOrdersFilter] = React.useState<{ operator: string; value: string } | null>(null);
  const [dueAmountFilter, setDueAmountFilter] = React.useState<{ operator: string; value: string } | null>(null);
  const includedCreatorIds = useMemo(() => {
    const requireMatch = (ids: string[]) => ids.length > 0 ? ids : ['__no_matching_creator__'];
    if (createdByFilter === 'all') return undefined;
    if (createdByFilter === 'admins') return requireMatch(users.filter((u) => u.role === 'Admin').map((u) => u.id));
    if (createdByFilter === 'employees') return requireMatch(users.filter((u) => isEmployeeRole(u.role)).map((u) => u.id));
    if (createdByFilter === 'developers') return requireMatch(users.filter((u) => u.role === 'Developer').map((u) => u.id));
    return [createdByFilter];
  }, [createdByFilter, users]);
  const excludedCreatorIds = useMemo(() => {
    if (!createdByNotFilter) return undefined;
    if (createdByNotFilter === 'admins') return users.filter((u) => u.role === 'Admin').map((u) => u.id);
    if (createdByNotFilter === 'employees') return users.filter((u) => isEmployeeRole(u.role)).map((u) => u.id);
    if (createdByNotFilter === 'developers') return users.filter((u) => u.role === 'Developer').map((u) => u.id);
    return [createdByNotFilter];
  }, [createdByNotFilter, users]);
  const { data: customersPage, isFetching, error } = useCustomersPage(effectivePage, pageSize, searchQuery, {
    createdByIds: includedCreatorIds,
    createdByNotIds: excludedCreatorIds,
    name: nameFilter || undefined,
    nameNot: nameNotFilter || undefined,
    phone: phoneFilter || undefined,
    phoneNot: phoneNotFilter || undefined,
    address: addressFilter || undefined,
    addressNot: addressNotFilter || undefined,
    totalOrders: totalOrdersFilter || undefined,
    dueAmount: dueAmountFilter || undefined,
  }, { enabled: canLoadCustomers });
  const customers = customersPage?.data ?? [];
  const total = customersPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const nameOptions = useMemo(() => {
    return customerFilterOpts?.names || [];
  }, [customerFilterOpts]);

  const phoneOptions = useMemo(() => {
    return customerFilterOpts?.phones || [];
  }, [customerFilterOpts]);

  const addressOptions = useMemo(() => {
    return customerFilterOpts?.addresses || [];
  }, [customerFilterOpts]);

  const customerFilterDefinitions = useMemo(() => {
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
        type: 'Name',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return nameOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Phone',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return phoneOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Address',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return addressOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Total Orders',
        operators: ['=', '≠', '<', '>'] as const,
        valueType: 'number' as const,
        allowCustomValue: true,
      },
      {
        type: 'Due Amount',
        operators: ['=', '≠', '<', '>'] as const,
        valueType: 'number' as const,
        allowCustomValue: true,
      },
    ];
  }, [users, nameOptions, phoneOptions, addressOptions]);

  const initialFilters = useMemo(() => {
    const filters = [];
    const decodeText = (encoded: string, negative = false) => {
      const { contains, value } = decodeDynamicTextFilterValue(encoded);
      return {
        operator: contains ? (negative ? 'does not contain' : 'contains') : (negative ? '≠' : '='),
        value,
      };
    };
    if (createdByFilter !== 'all') {
      const user = users.find((u) => u.id === createdByFilter);
      const display = createdByFilter === 'admins' ? 'Admins'
        : createdByFilter === 'employees' ? 'Employees'
        : user ? `${user.role}: ${user.name}` : createdByFilter;
      filters.push({ id: 'created-by', type: 'Created by', operator: '=' as const, value: createdByFilter, display });
    }
    if (createdByNotFilter) {
      const user = users.find((u) => u.id === createdByNotFilter);
      const display = createdByNotFilter === 'admins' ? 'Admins'
        : createdByNotFilter === 'employees' ? 'Employees'
          : createdByNotFilter === 'developers' ? 'Developers'
            : user ? `${user.role}: ${user.name}` : createdByNotFilter;
      filters.push({ id: 'created-by-not', type: 'Created by', operator: '≠' as const, value: createdByNotFilter, display });
    }
    if (nameFilter) {
      filters.push({ id: 'name', type: 'Name', ...decodeText(nameFilter) });
    }
    if (nameNotFilter) {
      filters.push({ id: 'name-not', type: 'Name', ...decodeText(nameNotFilter, true) });
    }
    if (phoneFilter) {
      filters.push({ id: 'phone', type: 'Phone', ...decodeText(phoneFilter) });
    }
    if (phoneNotFilter) {
      filters.push({ id: 'phone-not', type: 'Phone', ...decodeText(phoneNotFilter, true) });
    }
    if (addressFilter) {
      filters.push({ id: 'address', type: 'Address', ...decodeText(addressFilter) });
    }
    if (addressNotFilter) {
      filters.push({ id: 'address-not', type: 'Address', ...decodeText(addressNotFilter, true) });
    }
    if (totalOrdersFilter) {
      filters.push({ id: 'total-orders', type: 'Total Orders', operator: totalOrdersFilter.operator as any, value: totalOrdersFilter.value });
    }
    if (dueAmountFilter) {
      filters.push({ id: 'due-amount', type: 'Due Amount', operator: dueAmountFilter.operator as any, value: dueAmountFilter.value });
    }
    return filters;
  }, [createdByFilter, createdByNotFilter, nameFilter, nameNotFilter, phoneFilter, phoneNotFilter, addressFilter, addressNotFilter, totalOrdersFilter, dueAmountFilter, users]);

  // Track location to detect browser back navigation
  const previousLocationRef = useRef<string>(location.pathname + location.search);
  const [isNavigatingViaHistory, setIsNavigatingViaHistory] = React.useState(false);

  React.useEffect(() => {
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
    if (!shouldHydrateFromUrl) return;

    setPage(urlPage);
    setSyncedSearchParams(currentSearchParams);
  }, [shouldHydrateFromUrl, urlPage, currentSearchParams]);

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

  useEffect(() => {
    if (shouldHydrateFromUrl || isNavigatingViaHistory) return;

    const params: Record<string, string> = {};
    if (effectivePage > 1) params.page = String(effectivePage);
    if (searchQuery) params.search = searchQuery;

    if (new URLSearchParams(params).toString() !== currentSearchParams) {
      setSearchParams(params, { replace: true });
    }
  }, [shouldHydrateFromUrl, isNavigatingViaHistory, effectivePage, searchQuery, currentSearchParams, setSearchParams]);

  const filteredCustomers = customers;

  const handleDelete = async (customerId: string) => {
    if (!confirm('Move this customer to the recycle bin? You can restore it later.')) return;

    // If this is an optimistic local-only item (temp id), remove it from the cache
    if (isTempId(customerId)) {
      queryClient.setQueryData(['customers'], (old: any[] | undefined) => {
        if (!old) return old;
        return old.filter(c => c.id !== customerId);
      });
      toast.success('Customer removed from this list.');
      return;
    }

    try {
      await deleteCustomerMutation.mutateAsync(customerId);
      toast.success('Customer moved to the recycle bin');
    } catch (err) {
      console.error('Failed to delete customer:', err);
      const msg = getErrorMessage(err);
      if (msg.includes('fk_orders_customer') || msg.toLowerCase().includes('orders')) {
        toast.error('Cannot delete customer: this customer is referenced by one or more orders. Delete or reassign those orders first.');
      } else {
        toast.error(`Failed to delete customer: ${msg}`);
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <DynamicFilterBar
          filterDefinitions={customerFilterDefinitions}
          initialFilters={initialFilters}
          users={users}
          onApply={(appliedFilters) => {
          setPage(1);
          const encodeTextValue = (filter: { operator: string; value: string }) =>
            encodeDynamicTextFilterValue(filter.value, filter.operator.includes('contain'));
          
          const createdByFilter = appliedFilters.find((f) => f.type === 'Created by' && f.operator === '=');
          const createdByNotFilter = appliedFilters.find((f) => f.type === 'Created by' && f.operator === '≠');
          setCreatedByFilter(createdByFilter?.value ?? 'all');
          setCreatedByNotFilter(createdByNotFilter?.value ?? '');
          
          const nameFilter = appliedFilters.find((f) => f.type === 'Name' && (f.operator === '=' || f.operator === 'contains'));
          const nameNotFilter = appliedFilters.find((f) => f.type === 'Name' && (f.operator === '≠' || f.operator === 'does not contain'));
          setNameFilter(nameFilter ? encodeTextValue(nameFilter) : '');
          setNameNotFilter(nameNotFilter ? encodeTextValue(nameNotFilter) : '');
          
          const phoneFilter = appliedFilters.find((f) => f.type === 'Phone' && (f.operator === '=' || f.operator === 'contains'));
          const phoneNotFilter = appliedFilters.find((f) => f.type === 'Phone' && (f.operator === '≠' || f.operator === 'does not contain'));
          setPhoneFilter(phoneFilter ? encodeTextValue(phoneFilter) : '');
          setPhoneNotFilter(phoneNotFilter ? encodeTextValue(phoneNotFilter) : '');
          
          const addressFilter = appliedFilters.find((f) => f.type === 'Address' && (f.operator === '=' || f.operator === 'contains'));
          const addressNotFilter = appliedFilters.find((f) => f.type === 'Address' && (f.operator === '≠' || f.operator === 'does not contain'));
          setAddressFilter(addressFilter ? encodeTextValue(addressFilter) : '');
          setAddressNotFilter(addressNotFilter ? encodeTextValue(addressNotFilter) : '');
          
          const totalOrdersFilter = appliedFilters.find((f) => f.type === 'Total Orders');
          setTotalOrdersFilter(totalOrdersFilter ? { operator: totalOrdersFilter.operator, value: totalOrdersFilter.value } : null);
          
          const dueAmountFilter = appliedFilters.find((f) => f.type === 'Due Amount');
          setDueAmountFilter(dueAmountFilter ? { operator: dueAmountFilter.operator, value: dueAmountFilter.value } : null);
          }}
          />
        </div>
        <button
          onClick={handleRefreshCustomers}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold text-gray-500 bg-white border border-gray-100 shadow-sm hover:bg-gray-50 transition-all disabled:opacity-50"
          title="Refresh"
        >
          <svg className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          Refresh
        </button>
        {canCreateCustomers && (
          <Button
            onClick={() => navigate('/customers/new')}
            variant="primary"
            size="md"
            icon={ICONS.Plus}
          >
            New Customer
          </Button>
        )}
      </div>
      {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800"><strong>Error loading customers:</strong> {error instanceof Error ? error.message : String(error)}</p>
            </div>
          )}

      <Table
        columns={[
          {
            key: 'name',
            label: 'Customer Name',
            render: (_, customer) => (
              <div className="flex items-center gap-3">
                <img
                  src="/uploads/Empty_avatar.png"
                  alt={customer.name}
                  className="w-10 h-10 rounded-full object-cover border"
                />
                <div>
                  <span className="font-bold text-gray-900 block">{customer.name}</span>
                  <p className="text-xs text-gray-400 truncate max-w-[200px]">{customer.address}</p>
                </div>
              </div>
            ),
          },
          {
            key: 'phone',
            label: 'Contact',
            render: (phone) => <span className="text-sm font-medium text-gray-700">{phone}</span>,
          },
          {
            key: 'totalOrders',
            label: 'Total Orders',
            align: 'center' as const,
            render: (count) => (
              <span className="px-2 py-1 bg-gray-100 rounded-lg text-xs font-bold text-gray-600">
                {count}
              </span>
            ),
          },
          {
            key: 'dueAmount',
            label: 'Due Amount',
            align: 'right' as const,
            render: (amount) => (
              <span className={`font-bold ${amount > 0 ? 'text-red-500' : 'text-green-500'}`}>
                {formatCurrency(amount)}
              </span>
            ),
          },
          ...(canEditCustomers || canDeleteCustomers
            ? [{
                key: 'id',
                label: 'Actions',
                align: 'right' as const,
                render: (customerId: string) => (
                  <div className="justify-end flex items-center gap-2">
                    {canEditCustomers && (
                      <IconButton
                        icon={ICONS.Edit}
                        variant="primary"
                        title="Edit"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/customers/edit/${customerId}`);
                        }}
                      />
                    )}
                    {canDeleteCustomers && (
                      <IconButton
                        icon={ICONS.Delete}
                        variant="danger"
                        title="Delete"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(customerId);
                        }}
                      />
                    )}
                  </div>
                ),
              }]
            : []),
        ]}
        data={filteredCustomers}
        loading={!canLoadCustomers || isFetching}
        onRowHover={(customer) => {
          queryClient.prefetchQuery({
            queryKey: ['customer', customer.id],
            queryFn: () => fetchCustomerById(customer.id),
            staleTime: 5 * 60 * 1000,
          }).catch(() => {});
        }}
        onRowClick={(customer) => navigate(`/customers/${customer.id}`, { state: buildHistoryBackState(location) })}
        emptyMessage="No customers found"
      />
      <Pagination page={effectivePage} totalPages={totalPages} onPageChange={(p) => setPage(p)} disabled={isFetching} />
    </div>
  );
};

export default Customers;


