
import React, { useCallback, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Customer, hasAdminAccess } from '../types';
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
  const { data: customersPage, isFetching, error } = useCustomersPage(effectivePage, pageSize, searchQuery, {
    enabled: canLoadCustomers,
  });
  const handleRefreshCustomers = useCallback(() => {
    queryClient.refetchQueries({ queryKey: ['customers'], exact: false, type: 'active' });
  }, [queryClient]);
  const customers = customersPage?.data ?? [];
  const total = customersPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
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
        operators: ['=', '≠'] as const,
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
        operators: ['=', '≠'] as const,
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
        operators: ['=', '≠'] as const,
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
    if (createdByFilter !== 'all') {
      const user = users.find((u) => u.id === createdByFilter);
      const display = createdByFilter === 'admins' ? 'Admins'
        : createdByFilter === 'employees' ? 'Employees'
        : user ? `${user.role}: ${user.name}` : createdByFilter;
      filters.push({ id: 'created-by', type: 'Created by', operator: '=' as const, value: createdByFilter, display });
    }
    if (createdByNotFilter) {
      filters.push({ id: 'created-by-not', type: 'Created by', operator: '≠' as const, value: createdByNotFilter });
    }
    if (nameFilter) {
      filters.push({ id: 'name', type: 'Name', operator: '=' as const, value: nameFilter });
    }
    if (nameNotFilter) {
      filters.push({ id: 'name-not', type: 'Name', operator: '≠' as const, value: nameNotFilter });
    }
    if (phoneFilter) {
      filters.push({ id: 'phone', type: 'Phone', operator: '=' as const, value: phoneFilter });
    }
    if (phoneNotFilter) {
      filters.push({ id: 'phone-not', type: 'Phone', operator: '≠' as const, value: phoneNotFilter });
    }
    if (addressFilter) {
      filters.push({ id: 'address', type: 'Address', operator: '=' as const, value: addressFilter });
    }
    if (addressNotFilter) {
      filters.push({ id: 'address-not', type: 'Address', operator: '≠' as const, value: addressNotFilter });
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

  // Server-side search is applied via the paginated hook. Client-side filters for additional fields.
  const filteredCustomers = useMemo(() => {
    let filtered = customers;

    if (createdByFilter !== 'all') {
      const createdByIds = createdByFilter === 'admins'
        ? users.filter((u) => u.role === 'Admin').map((u) => u.id)
        : createdByFilter === 'employees'
          ? users.filter((u) => u.role === 'Employee').map((u) => u.id)
          : [createdByFilter];
      filtered = filtered.filter((c) => c.createdBy && createdByIds.includes(c.createdBy));
    }
    if (createdByNotFilter) {
      const notIds = createdByNotFilter === 'admins'
        ? users.filter((u) => u.role === 'Admin').map((u) => u.id)
        : createdByNotFilter === 'employees'
          ? users.filter((u) => u.role === 'Employee').map((u) => u.id)
          : [createdByNotFilter];
      filtered = filtered.filter((c) => !c.createdBy || !notIds.includes(c.createdBy));
    }
    if (nameFilter) {
      filtered = filtered.filter((c) => c.name?.toLowerCase().includes(nameFilter.toLowerCase()));
    }
    if (nameNotFilter) {
      filtered = filtered.filter((c) => !c.name?.toLowerCase().includes(nameNotFilter.toLowerCase()));
    }
    if (phoneFilter) {
      filtered = filtered.filter((c) => c.phone?.toLowerCase().includes(phoneFilter.toLowerCase()));
    }
    if (phoneNotFilter) {
      filtered = filtered.filter((c) => !c.phone?.toLowerCase().includes(phoneNotFilter.toLowerCase()));
    }
    if (addressFilter) {
      filtered = filtered.filter((c) => c.address?.toLowerCase().includes(addressFilter.toLowerCase()));
    }
    if (addressNotFilter) {
      filtered = filtered.filter((c) => !c.address?.toLowerCase().includes(addressNotFilter.toLowerCase()));
    }

    // Numeric filters
    if (totalOrdersFilter) {
      const val = Number(totalOrdersFilter.value);
      if (!isNaN(val)) {
        filtered = filtered.filter((c) => {
          switch (totalOrdersFilter.operator) {
            case '=': return c.totalOrders === val;
            case '≠': return c.totalOrders !== val;
            case '<': return c.totalOrders < val;
            case '>': return c.totalOrders > val;
            default: return true;
          }
        });
      }
    }
    if (dueAmountFilter) {
      const val = Number(dueAmountFilter.value);
      if (!isNaN(val)) {
        filtered = filtered.filter((c) => {
          switch (dueAmountFilter.operator) {
            case '=': return c.dueAmount === val;
            case '≠': return c.dueAmount !== val;
            case '<': return c.dueAmount < val;
            case '>': return c.dueAmount > val;
            default: return true;
          }
        });
      }
    }

    return filtered;
  }, [customers, createdByFilter, createdByNotFilter, nameFilter, nameNotFilter, phoneFilter, phoneNotFilter, addressFilter, addressNotFilter, totalOrdersFilter, dueAmountFilter, users]);

  const handleDelete = async (customerId: string) => {
    if (!confirm('Move this customer to the recycle bin? You can restore it later.')) return;

    // If this is an optimistic local-only item (temp id), remove it from the cache
    if (isTempId(customerId)) {
      queryClient.setQueryData(['customers'], (old: any[] | undefined) => {
        if (!old) return old;
        return old.filter(c => c.id !== customerId);
      });
      toast.success('Customer removed locally');
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
          
          const createdByFilter = appliedFilters.find((f) => f.type === 'Created by' && f.operator === '=');
          const createdByNotFilter = appliedFilters.find((f) => f.type === 'Created by' && f.operator === '≠');
          setCreatedByFilter(createdByFilter?.value ?? 'all');
          setCreatedByNotFilter(createdByNotFilter?.value ?? '');
          
          const nameFilter = appliedFilters.find((f) => f.type === 'Name' && f.operator === '=');
          const nameNotFilter = appliedFilters.find((f) => f.type === 'Name' && f.operator === '≠');
          setNameFilter(nameFilter?.value ?? '');
          setNameNotFilter(nameNotFilter?.value ?? '');
          
          const phoneFilter = appliedFilters.find((f) => f.type === 'Phone' && f.operator === '=');
          const phoneNotFilter = appliedFilters.find((f) => f.type === 'Phone' && f.operator === '≠');
          setPhoneFilter(phoneFilter?.value ?? '');
          setPhoneNotFilter(phoneNotFilter?.value ?? '');
          
          const addressFilter = appliedFilters.find((f) => f.type === 'Address' && f.operator === '=');
          const addressNotFilter = appliedFilters.find((f) => f.type === 'Address' && f.operator === '≠');
          setAddressFilter(addressFilter?.value ?? '');
          setAddressNotFilter(addressNotFilter?.value ?? '');
          
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


