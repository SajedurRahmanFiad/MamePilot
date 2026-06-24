
import React, { useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Customer, hasAdminAccess } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { Button, Table, TableCell, IconButton, TableLoadingSkeleton } from '../components';
import FilterBar, { FilterRange } from '../components/FilterBar';
import Pagination from '../src/components/Pagination';
import { theme } from '../theme';
import { useCustomersPage, useSystemDefaults } from '../src/hooks/useQueries';
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
  const { data: customersPage, isFetching, error } = useCustomersPage(effectivePage, pageSize, searchQuery, {
    enabled: canLoadCustomers,
  });
  const customers = customersPage?.data ?? [];
  const total = customersPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const deleteCustomerMutation = useDeleteCustomer();
  const isAdmin = hasAdminAccess(user?.role);
  const { can } = useRolePermissions();
  const canCreateCustomers = can('customers.create');
  const canEditCustomers = can('customers.edit');
  const canDeleteCustomers = can('customers.delete');

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

  // Server-side search is applied via the paginated hook. Keep client-side memo only for derived formatting.
  const filteredCustomers = customers;

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="md:text-2xl text-xl font-bold text-gray-900">Customers</h2>
        </div>
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

      {/* (No Created By filter for customers) */}
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


