
import React, { useCallback, useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '../db';
import { Vendor } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { Button, Table, TableCell, IconButton } from '../components';
import DynamicFilterBar from '../components/DynamicFilterBar';
import Pagination from '../src/components/Pagination';
import { theme } from '../theme';
import { useVendorsPage, useSystemDefaults, useVendorFilterOptions } from '../src/hooks/useQueries';
import { useDeleteVendor } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useUrlSyncedSearchQuery } from '../src/hooks/useUrlSyncedSearchQuery';
import { DEFAULT_PAGE_SIZE, fetchVendorById, getErrorMessage } from '../src/services/supabaseQueries';
import { buildHistoryBackState, getPositivePageParam } from '../src/utils/navigation';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { decodeDynamicTextFilterValue, encodeDynamicTextFilterValue } from '../utils';

const Vendors: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const toast = useToastNotifications();
  const { canCreateVendors, canEditVendors, canDeleteVendors } = useRolePermissions();
  const {
    data: systemDefaults,
    isPending: systemDefaultsLoading,
    isError: systemDefaultsError,
  } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const canLoadVendors = !systemDefaultsLoading || !!systemDefaults || systemDefaultsError;
  const [searchParams, setSearchParams] = useSearchParams();
  const currentSearchParams = searchParams.toString();
  const urlPage = getPositivePageParam(searchParams.get('page'));
  const { searchQuery } = useUrlSyncedSearchQuery(searchParams.get('search') || '');
  const [syncedSearchParams, setSyncedSearchParams] = React.useState<string | null>(null);
  const shouldHydrateFromUrl = syncedSearchParams !== currentSearchParams;
  const [page, setPage] = React.useState<number>(urlPage);
  const [nameFilter, setNameFilter] = useState<string>('');
  const [nameNotFilter, setNameNotFilter] = useState<string>('');
  const [phoneFilter, setPhoneFilter] = useState<string>('');
  const [phoneNotFilter, setPhoneNotFilter] = useState<string>('');
  const [addressFilter, setAddressFilter] = useState<string>('');
  const [addressNotFilter, setAddressNotFilter] = useState<string>('');
  const [purchasesFilter, setPurchasesFilter] = useState<{ operator: string; value: string } | null>(null);
  const [payableFilter, setPayableFilter] = useState<{ operator: string; value: string } | null>(null);
  const previousSearchQueryRef = React.useRef(searchQuery);
  const effectivePage = shouldHydrateFromUrl ? urlPage : page;
  const { data: vendorsPage = { data: [], count: 0 }, isFetching } = useVendorsPage(effectivePage, pageSize, searchQuery, {
    name: nameFilter || undefined,
    nameNot: nameNotFilter || undefined,
    phone: phoneFilter || undefined,
    phoneNot: phoneNotFilter || undefined,
    address: addressFilter || undefined,
    addressNot: addressNotFilter || undefined,
    purchases: purchasesFilter || undefined,
    payable: payableFilter || undefined,
  }, { enabled: canLoadVendors });
  const handleRefreshVendors = useCallback(() => {
    queryClient.refetchQueries({ queryKey: ['vendors'], exact: false, type: 'active' });
  }, [queryClient]);
  const vendors = vendorsPage.data || [];
  const total = vendorsPage.count || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const deleteVendorMutation = useDeleteVendor();
  const { data: vendorFilterOpts } = useVendorFilterOptions();
  const vendorNameOptions = useMemo(() => vendorFilterOpts?.names || [], [vendorFilterOpts]);
  const vendorPhoneOptions = useMemo(() => vendorFilterOpts?.phones || [], [vendorFilterOpts]);
  const vendorAddressOptions = useMemo(() => vendorFilterOpts?.addresses || [], [vendorFilterOpts]);

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
    if (shouldHydrateFromUrl) return;

    const params: Record<string, string> = {};
    if (effectivePage > 1) params.page = String(effectivePage);
    if (searchQuery) params.search = searchQuery;

    if (new URLSearchParams(params).toString() !== currentSearchParams) {
      setSearchParams(params, { replace: true });
    }
  }, [shouldHydrateFromUrl, effectivePage, searchQuery, currentSearchParams, setSearchParams]);

  const filteredVendors = vendors;

  const handleDelete = async (vendorId: string) => {
    if (!confirm('Move this vendor to the recycle bin? You can restore it later.')) return;
    try {
      await deleteVendorMutation.mutateAsync(vendorId);
      // Cache updated deterministically by mutation hook
      toast.success('Vendor moved to the recycle bin');
    } catch (err) {
      console.error('Failed to delete vendor:', err);
      const msg = getErrorMessage(err);
      if (msg.includes('fk_bills_vendor') || msg.toLowerCase().includes('bills')) {
        toast.error('Cannot delete vendor: this vendor is referenced by one or more bills. Delete or reassign those bills first.');
      } else {
        toast.error(`Failed to delete vendor: ${msg}`);
      }
    }
  };

  const vendorFilterDefinitions = useMemo(() => {
    return [
      {
        type: 'Name',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
        values: vendorNameOptions,
      },
      {
        type: 'Phone',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
        values: vendorPhoneOptions,
      },
      {
        type: 'Address',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
        values: vendorAddressOptions,
      },
      {
        type: 'Purchases',
        operators: ['=', '≠', '<', '>'] as const,
        valueType: 'number' as const,
        allowCustomValue: true,
      },
      {
        type: 'Payable',
        operators: ['=', '≠', '<', '>'] as const,
        valueType: 'number' as const,
        allowCustomValue: true,
      },
    ];
  }, [vendorNameOptions, vendorPhoneOptions, vendorAddressOptions]);

  const initialFilters = useMemo(() => {
    const filters: any[] = [];
    const addText = (id: string, type: string, encoded: string, negative = false) => {
      if (!encoded) return;
      const { contains, value } = decodeDynamicTextFilterValue(encoded);
      filters.push({ id, type, operator: contains ? (negative ? 'does not contain' : 'contains') : (negative ? '≠' : '='), value });
    };
    addText('name', 'Name', nameFilter);
    addText('name-not', 'Name', nameNotFilter, true);
    addText('phone', 'Phone', phoneFilter);
    addText('phone-not', 'Phone', phoneNotFilter, true);
    addText('address', 'Address', addressFilter);
    addText('address-not', 'Address', addressNotFilter, true);
    if (purchasesFilter) filters.push({ id: 'purchases', type: 'Purchases', ...purchasesFilter });
    if (payableFilter) filters.push({ id: 'payable', type: 'Payable', ...payableFilter });
    return filters;
  }, [nameFilter, nameNotFilter, phoneFilter, phoneNotFilter, addressFilter, addressNotFilter, purchasesFilter, payableFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <DynamicFilterBar
            filterDefinitions={vendorFilterDefinitions}
            initialFilters={initialFilters}
            onApply={(appliedFilters) => {
              setPage(1);
              const encodeTextValue = (filter: { operator: string; value: string }) => encodeDynamicTextFilterValue(filter.value, filter.operator.includes('contain'));

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

              const purchasesFilter = appliedFilters.find((f) => f.type === 'Purchases');
              setPurchasesFilter(purchasesFilter ? { operator: purchasesFilter.operator, value: purchasesFilter.value } : null);

              const payableFilter = appliedFilters.find((f) => f.type === 'Payable');
              setPayableFilter(payableFilter ? { operator: payableFilter.operator, value: payableFilter.value } : null);
            }}
          />
        </div>
        <button
          onClick={handleRefreshVendors}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold text-gray-500 bg-white border border-gray-100 shadow-sm hover:bg-gray-50 transition-all disabled:opacity-50"
          title="Refresh"
        >
          <svg className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          Refresh
        </button>
        {canCreateVendors && (
          <Button
            onClick={() => navigate('/vendors/new')}
            variant="primary"
            size="md"
            icon={ICONS.Plus}
          >
            New Vendor
          </Button>
        )}
      </div>
      <Table
        columns={[
          {
            key: 'name',
            label: 'Vendor Name',
            render: (_, vendor) => (
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-400 text-white flex items-center justify-center font-bold">
                  {vendor.name.charAt(0)}
                </div>
                <div>
                  <span className="font-bold text-gray-900 block">{vendor.name}</span>
                  <p className="text-xs text-gray-400 truncate max-w-[200px]">{vendor.address}</p>
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
            key: 'totalPurchases',
            label: 'Purchases',
            align: 'center',
            render: (count) => (
              <span className="px-2 py-1 bg-gray-100 rounded-lg text-xs font-bold text-gray-600">
                {count}
              </span>
            ),
          },
          {
            key: 'dueAmount',
            label: 'Balance Payable',
            align: 'right',
            render: (amount) => (
              <span className={`font-bold ${amount > 0 ? 'text-red-500' : 'text-green-500'}`}>
                {formatCurrency(amount)}
              </span>
            ),
          },
          {
            key: 'id',
            label: 'Actions',
            align: 'right',
            render: (vendorId) => (
              <div className="justify-end flex items-center gap-2">
                {canEditVendors && (
                  <IconButton
                    icon={ICONS.Edit}
                    variant="primary"
                    title="Edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/vendors/edit/${vendorId}`);
                    }}
                  />
                )}
                {canDeleteVendors && (
                  <IconButton
                    icon={ICONS.Delete}
                    variant="danger"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(vendorId);
                    }}
                  />
                )}
              </div>
            ),
          },
        ]}
        data={filteredVendors}
        loading={!canLoadVendors || isFetching}
        onRowHover={(vendor) => {
          queryClient.prefetchQuery({
            queryKey: ['vendor', vendor.id],
            queryFn: () => fetchVendorById(vendor.id),
            staleTime: 5 * 60 * 1000,
          }).catch(() => {});
        }}
        onRowClick={(vendor) => navigate(`/vendors/${vendor.id}`, { state: buildHistoryBackState(location) })}
        emptyMessage="No vendors found"
      />
      <Pagination page={effectivePage} totalPages={totalPages} onPageChange={(p) => setPage(p)} disabled={isFetching} />
    </div>
  );
};

export default Vendors;
