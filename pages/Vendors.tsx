
import React, { useState, useMemo, useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '../db';
import { Vendor } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { Button, Table, TableCell, IconButton } from '../components';
import DynamicFilterBar from '../components/DynamicFilterBar';
import Pagination from '../src/components/Pagination';
import { theme } from '../theme';
import { useVendorsPage, useSystemDefaults } from '../src/hooks/useQueries';
import { useDeleteVendor } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useUrlSyncedSearchQuery } from '../src/hooks/useUrlSyncedSearchQuery';
import { DEFAULT_PAGE_SIZE, fetchVendorById, getErrorMessage } from '../src/services/supabaseQueries';
import { buildHistoryBackState, getPositivePageParam } from '../src/utils/navigation';
import { useRolePermissions } from '../src/hooks/useRolePermissions';

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
    enabled: canLoadVendors,
  });
  const vendors = vendorsPage.data || [];
  const total = vendorsPage.count || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const deleteVendorMutation = useDeleteVendor();

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

  const filteredVendors = useMemo(() => {
    let filtered = vendors;

    if (nameFilter) {
      filtered = filtered.filter((v) => v.name?.toLowerCase().includes(nameFilter.toLowerCase()));
    }
    if (nameNotFilter) {
      filtered = filtered.filter((v) => !v.name?.toLowerCase().includes(nameNotFilter.toLowerCase()));
    }
    if (phoneFilter) {
      filtered = filtered.filter((v) => v.phone?.toLowerCase().includes(phoneFilter.toLowerCase()));
    }
    if (phoneNotFilter) {
      filtered = filtered.filter((v) => !v.phone?.toLowerCase().includes(phoneNotFilter.toLowerCase()));
    }
    if (addressFilter) {
      filtered = filtered.filter((v) => v.address?.toLowerCase().includes(addressFilter.toLowerCase()));
    }
    if (addressNotFilter) {
      filtered = filtered.filter((v) => !v.address?.toLowerCase().includes(addressNotFilter.toLowerCase()));
    }

    // Numeric filters
    if (purchasesFilter) {
      const val = Number(purchasesFilter.value);
      if (!isNaN(val)) {
        filtered = filtered.filter((v) => {
          switch (purchasesFilter.operator) {
            case '=': return v.totalPurchases === val;
            case '≠': return v.totalPurchases !== val;
            case '<': return v.totalPurchases < val;
            case '>': return v.totalPurchases > val;
            default: return true;
          }
        });
      }
    }
    if (payableFilter) {
      const val = Number(payableFilter.value);
      if (!isNaN(val)) {
        filtered = filtered.filter((v) => {
          switch (payableFilter.operator) {
            case '=': return v.dueAmount === val;
            case '≠': return v.dueAmount !== val;
            case '<': return v.dueAmount < val;
            case '>': return v.dueAmount > val;
            default: return true;
          }
        });
      }
    }

    return filtered;
  }, [vendors, nameFilter, nameNotFilter, phoneFilter, phoneNotFilter, addressFilter, addressNotFilter, purchasesFilter, payableFilter]);

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
        operators: ['=', '≠'] as const,
        allowCustomValue: true,
      },
      {
        type: 'Phone',
        operators: ['=', '≠'] as const,
        allowCustomValue: true,
      },
      {
        type: 'Address',
        operators: ['=', '≠'] as const,
        allowCustomValue: true,
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
  }, []);

  const initialFilters = useMemo(() => [], []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <DynamicFilterBar
            filterDefinitions={vendorFilterDefinitions}
            initialFilters={initialFilters}
            onApply={(appliedFilters) => {
              setPage(1);

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

              const purchasesFilter = appliedFilters.find((f) => f.type === 'Purchases');
              setPurchasesFilter(purchasesFilter ? { operator: purchasesFilter.operator, value: purchasesFilter.value } : null);

              const payableFilter = appliedFilters.find((f) => f.type === 'Payable');
              setPayableFilter(payableFilter ? { operator: payableFilter.operator, value: payableFilter.value } : null);
            }}
          />
        </div>
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
