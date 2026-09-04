import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Batch, hasAdminAccess, isEmployeeRole } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { Button, Table, IconButton } from '../components';
import DynamicFilterBar from '../components/DynamicFilterBar';
import Pagination from '../src/components/Pagination';
import { theme } from '../theme';
import { useBatchesPage, useBatchCategories, useSystemDefaults, useUsersMini } from '../src/hooks/useQueries';
import { useDeleteBatch } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { buildHistoryBackState, getPositivePageParam } from '../src/utils/navigation';
import { formatAge } from '../src/utils/batchUtils';
import { useSearch } from '../src/contexts/SearchContext';
import { useResettablePage } from '../src/hooks/useResettablePage';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { decodeDynamicTextFilterValue, encodeDynamicTextFilterValue, safeDecodeURIComponent } from '../utils';
import BatchEventModal from '../components/BatchEventModal';

const Batches: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const toast = useToastNotifications();
  const { searchQuery, setSearchQuery } = useSearch();
  const { can } = useRolePermissions();
  const { hasSubCapability } = useCapabilities(true);

  const canCreateBatches = can('batches.create') && hasSubCapability('batch_management');
  const canEditBatches = can('batches.edit') && hasSubCapability('batch_management');
  const canDeleteBatches = can('batches.delete') && hasSubCapability('batch_management');

  const [searchParams, setSearchParams] = useSearchParams();
  const currentSearchParams = searchParams.toString();
  const urlPage = getPositivePageParam(searchParams.get('page'));
  const [syncedSearchParams, setSyncedSearchParams] = useState<string | null>(null);
  const shouldHydrateFromUrl = syncedSearchParams !== currentSearchParams;
  const [page, setPage] = useState<number>(urlPage);

  const { data: systemDefaults, isPending: systemDefaultsLoading, isError: systemDefaultsError } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const canLoadBatches = !systemDefaultsLoading || !!systemDefaults || systemDefaultsError;

  const { data: users = [] } = useUsersMini();
  const { data: batchCategories = [] } = useBatchCategories();

  const [createdByFilter, setCreatedByFilter] = useState<string>('all');
  const [createdByNotFilter, setCreatedByNotFilter] = useState<string>('');
  const [nameFilter, setNameFilter] = useState<string>('');
  const [nameNotFilter, setNameNotFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [categoryNotFilter, setCategoryNotFilter] = useState<string>('');
  const [skuFilter, setSkuFilter] = useState<string>('');
  const [skuNotFilter, setSkuNotFilter] = useState<string>('');
  const [populationFilter, setPopulationFilter] = useState<{ operator: string; value: string } | null>(null);
  const [salePriceFilter, setSalePriceFilter] = useState<{ operator: string; value: string } | null>(null);
  const [purchasePriceFilter, setPurchasePriceFilter] = useState<{ operator: string; value: string } | null>(null);
  const [averageAgeFilter, setAverageAgeFilter] = useState<{ operator: string; value: string } | null>(null);
  const [showEventModal, setShowEventModal] = useState(false);

  const createdByIds = useMemo(() => {
    const requireMatch = (ids: string[]) => ids.length > 0 ? ids : ['__no_matching_creator__'];
    if (createdByFilter === 'all') return undefined;
    if (createdByFilter === 'admins') return requireMatch(users.filter((u) => u.role === 'Admin').map((u) => u.id));
    if (createdByFilter === 'employees') return requireMatch(users.filter((u) => isEmployeeRole(u.role)).map((u) => u.id));
    if (createdByFilter === 'developers') return requireMatch(users.filter((u) => u.role === 'Developer').map((u) => u.id));
    return [createdByFilter];
  }, [createdByFilter, users]);
  const createdByNotIds = useMemo(() => {
    if (!createdByNotFilter) return undefined;
    if (createdByNotFilter === 'admins') return users.filter((u) => u.role === 'Admin').map((u) => u.id);
    if (createdByNotFilter === 'employees') return users.filter((u) => isEmployeeRole(u.role)).map((u) => u.id);
    if (createdByNotFilter === 'developers') return users.filter((u) => u.role === 'Developer').map((u) => u.id);
    return [createdByNotFilter];
  }, [createdByNotFilter, users]);

  const categoryOptions = useMemo(() => {
    return batchCategories.map(cat => cat.name);
  }, [batchCategories]);

  const handleRefresh = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: ['batches'], exact: false, type: 'active' });
  }, [queryClient]);

  const pageResetKey = useMemo(
    () => JSON.stringify({
      searchQuery,
      createdByFilter,
      createdByNotFilter,
      categoryFilter,
      categoryNotFilter,
      nameFilter,
      nameNotFilter,
      skuFilter,
      skuNotFilter,
      populationFilter,
      salePriceFilter,
      purchasePriceFilter,
      averageAgeFilter,
    }),
    [
      searchQuery,
      createdByFilter,
      createdByNotFilter,
      categoryFilter,
      categoryNotFilter,
      nameFilter,
      nameNotFilter,
      skuFilter,
      skuNotFilter,
      populationFilter,
      salePriceFilter,
      purchasePriceFilter,
      averageAgeFilter,
    ]
  );
  const pageFromStateOrUrl = shouldHydrateFromUrl ? urlPage : page;
  const effectivePage = useResettablePage(pageFromStateOrUrl, setPage, pageResetKey);

  const { data: batchesPage, isFetching } = useBatchesPage(
    effectivePage,
    pageSize,
    searchQuery,
    categoryFilter || undefined,
    {
      createdByIds,
      createdByNotIds,
      name: nameFilter || undefined,
      nameNot: nameNotFilter || undefined,
      categoryNot: categoryNotFilter || undefined,
      sku: skuFilter || undefined,
      skuNot: skuNotFilter || undefined,
      population: populationFilter || undefined,
      salePrice: salePriceFilter || undefined,
      purchasePrice: purchasePriceFilter || undefined,
      averageAge: averageAgeFilter || undefined,
    }
  );

  const batches = batchesPage?.data ?? [];
  const total = batchesPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const deleteBatchMutation = useDeleteBatch();

  const batchFilterDefinitions = useMemo(() => {
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
        type: 'Category',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return categoryOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Name',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
      },
      {
        type: 'SKU',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
      },
      {
        type: 'Population',
        operators: ['=', '≠', '<', '>'] as const,
        valueType: 'number' as const,
        allowCustomValue: true,
      },
      {
        type: 'Sale Price',
        operators: ['=', '≠', '<', '>'] as const,
        valueType: 'number' as const,
        allowCustomValue: true,
      },
      {
        type: 'Purchase Price',
        operators: ['=', '≠', '<', '>'] as const,
        valueType: 'number' as const,
        allowCustomValue: true,
      },
      {
        type: 'Avg Age',
        operators: ['=', '≠', '<', '>'] as const,
        valueType: 'number' as const,
        allowCustomValue: true,
      },
    ];
  }, [users, categoryOptions]);

  const initialFilters = useMemo(() => {
    const filters = [];
    const decodeText = (encoded: string, negative = false) => {
      const { contains, value } = decodeDynamicTextFilterValue(encoded);
      return { operator: contains ? (negative ? 'does not contain' : 'contains') : (negative ? '≠' : '='), value };
    };
    if (createdByFilter !== 'all') {
      const user = users.find((u) => u.id === createdByFilter);
      const display = createdByFilter === 'admins' ? 'Admins'
        : createdByFilter === 'employees' ? 'Employees'
        : createdByFilter === 'developers' ? 'Developers'
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
    if (categoryFilter) {
      filters.push({ id: 'category', type: 'Category', ...decodeText(categoryFilter) });
    }
    if (categoryNotFilter) {
      filters.push({ id: 'category-not', type: 'Category', ...decodeText(categoryNotFilter, true) });
    }
    if (nameFilter) {
      filters.push({ id: 'name', type: 'Name', ...decodeText(nameFilter) });
    }
    if (nameNotFilter) {
      filters.push({ id: 'name-not', type: 'Name', ...decodeText(nameNotFilter, true) });
    }
    if (skuFilter) {
      filters.push({ id: 'sku', type: 'SKU', ...decodeText(skuFilter) });
    }
    if (skuNotFilter) {
      filters.push({ id: 'sku-not', type: 'SKU', ...decodeText(skuNotFilter, true) });
    }
    if (populationFilter) {
      filters.push({ id: 'population', type: 'Population', operator: populationFilter.operator as any, value: populationFilter.value });
    }
    if (salePriceFilter) {
      filters.push({ id: 'sale-price', type: 'Sale Price', operator: salePriceFilter.operator as any, value: salePriceFilter.value });
    }
    if (purchasePriceFilter) {
      filters.push({ id: 'purchase-price', type: 'Purchase Price', operator: purchasePriceFilter.operator as any, value: purchasePriceFilter.value });
    }
    if (averageAgeFilter) {
      filters.push({ id: 'avg-age', type: 'Avg Age', operator: averageAgeFilter.operator as any, value: averageAgeFilter.value });
    }
    return filters;
  }, [createdByFilter, createdByNotFilter, categoryFilter, categoryNotFilter, nameFilter, nameNotFilter, skuFilter, skuNotFilter, populationFilter, salePriceFilter, purchasePriceFilter, averageAgeFilter, users]);

  // Hydrate pagination when the route is loaded directly or its query string changes.
  useEffect(() => {
    if (!shouldHydrateFromUrl) return;

    setPage(urlPage);
    setSyncedSearchParams(currentSearchParams);
  }, [shouldHydrateFromUrl, urlPage, currentSearchParams]);

  // Keep the current page reload-safe without discarding unrelated URL parameters.
  useEffect(() => {
    if (shouldHydrateFromUrl) return;

    const nextSearchParams = new URLSearchParams(currentSearchParams);
    if (effectivePage > 1) {
      nextSearchParams.set('page', String(effectivePage));
    } else {
      nextSearchParams.delete('page');
    }

    if (nextSearchParams.toString() !== currentSearchParams) {
      setSearchParams(nextSearchParams, { replace: true });
    }
  }, [shouldHydrateFromUrl, effectivePage, currentSearchParams, setSearchParams]);

  const handleDelete = async (batchId: string) => {
    if (!confirm('Move this batch to the recycle bin? You can restore it later.')) return;
    try {
      await deleteBatchMutation.mutateAsync(batchId);
      toast.success('Batch moved to the recycle bin');
    } catch (err) {
      console.error('Failed to delete batch:', err);
      toast.error('Failed to delete batch');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <DynamicFilterBar
            filterDefinitions={batchFilterDefinitions}
            initialFilters={initialFilters}
            users={users}
            freeTextLabel="Batches"
            rawSearchValue={searchQuery}
            onRawSearchChange={setSearchQuery}
            onApply={(appliedFilters) => {
              setPage(1);
              const encodeTextValue = (filter: { operator: string; value: string }) =>
                encodeDynamicTextFilterValue(filter.value, filter.operator.includes('contain'));

              const createdByFilter = appliedFilters.find((f) => f.type === 'Created by' && f.operator === '=');
              const createdByNotFilter = appliedFilters.find((f) => f.type === 'Created by' && f.operator === '≠');
              setCreatedByFilter(createdByFilter?.value ?? 'all');
              setCreatedByNotFilter(createdByNotFilter?.value ?? '');

              const categoryFilter = appliedFilters.find((f) => f.type === 'Category' && (f.operator === '=' || f.operator === 'contains'));
              const categoryNotFilter = appliedFilters.find((f) => f.type === 'Category' && (f.operator === '≠' || f.operator === 'does not contain'));
              setCategoryFilter(categoryFilter ? encodeTextValue(categoryFilter) : '');
              setCategoryNotFilter(categoryNotFilter ? encodeTextValue(categoryNotFilter) : '');

              const nameFilter = appliedFilters.find((f) => f.type === 'Name' && (f.operator === '=' || f.operator === 'contains'));
              const nameNotFilter = appliedFilters.find((f) => f.type === 'Name' && (f.operator === '≠' || f.operator === 'does not contain'));
              setNameFilter(nameFilter ? encodeTextValue(nameFilter) : '');
              setNameNotFilter(nameNotFilter ? encodeTextValue(nameNotFilter) : '');

              const skuFilter = appliedFilters.find((f) => f.type === 'SKU' && (f.operator === '=' || f.operator === 'contains'));
              const skuNotFilter = appliedFilters.find((f) => f.type === 'SKU' && (f.operator === '≠' || f.operator === 'does not contain'));
              setSkuFilter(skuFilter ? encodeTextValue(skuFilter) : '');
              setSkuNotFilter(skuNotFilter ? encodeTextValue(skuNotFilter) : '');

              const populationFilter = appliedFilters.find((f) => f.type === 'Population');
              setPopulationFilter(populationFilter ? { operator: populationFilter.operator, value: populationFilter.value } : null);

              const salePriceFilter = appliedFilters.find((f) => f.type === 'Sale Price');
              setSalePriceFilter(salePriceFilter ? { operator: salePriceFilter.operator, value: salePriceFilter.value } : null);

              const purchasePriceFilter = appliedFilters.find((f) => f.type === 'Purchase Price');
              setPurchasePriceFilter(purchasePriceFilter ? { operator: purchasePriceFilter.operator, value: purchasePriceFilter.value } : null);

              const averageAgeFilter = appliedFilters.find((f) => f.type === 'Avg Age');
              setAverageAgeFilter(averageAgeFilter ? { operator: averageAgeFilter.operator, value: averageAgeFilter.value } : null);
            }}
          />
        </div>
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold text-gray-500 bg-white border border-gray-100 shadow-sm hover:bg-gray-50 transition-all disabled:opacity-50"
          title="Refresh"
        >
          <svg className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          Refresh
        </button>
        <Button
          onClick={() => setShowEventModal(true)}
          variant="secondary"
          size="md"
        >
          Mark Event
        </Button>
        {canCreateBatches && (
          <Button
            onClick={() => navigate('/batches/new', { state: buildHistoryBackState(location) })}
            variant="primary"
            size="md"
            icon={ICONS.Plus}
          >
            Add Batch
          </Button>
        )}
      </div>

      <BatchEventModal
        isOpen={showEventModal}
        onClose={() => setShowEventModal(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['batches'] });
        }}
      />

      <Table
        columns={[
          {
            key: 'name',
            label: 'Batch',
            render: (_name, batch) => (
              <div>
                <p className="font-bold text-gray-900">{batch.name}</p>
                {batch.sku && <p className="mt-0.5 text-xs font-semibold text-gray-400">SKU: {safeDecodeURIComponent(batch.sku)}</p>}
              </div>
            ),
          },
          {
            key: 'categoryName',
            label: 'Category',
            render: (categoryName) => (
              <span className="px-2.5 py-1 bg-[#ebf4ff] rounded-lg text-[10px] font-black uppercase tracking-widest">
                {categoryName || '—'}
              </span>
            ),
          },
          {
            key: 'population',
            label: 'Population',
            align: 'right' as const,
            render: (population: number) => (
              <span className={`font-black ${population <= 0 ? 'text-red-600' : population <= 5 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {population}
              </span>
            ),
          },
          {
            key: 'averageAgeDays',
            label: 'Avg Age',
            render: (averageAgeDays: number) => (
              <span className="text-sm font-medium text-gray-700">{formatAge(averageAgeDays)}</span>
            ),
          },
          {
            key: 'purchasePrice',
            label: 'Purchase Price',
            render: (purchasePrice: number) => (
              <span className="text-sm font-bold">{formatCurrency(purchasePrice)}</span>
            ),
          },
          {
            key: 'salePrice',
            label: 'Sale Price',
            render: (salePrice: number) => (
              <span className="text-sm font-bold">{formatCurrency(salePrice)}</span>
            ),
          },
          ...(canEditBatches || canDeleteBatches ? [{
            key: 'id',
            label: 'Actions',
            align: 'right' as const,
            render: (batchId: string) => (
              <div className="justify-end flex items-center gap-2">
                {canEditBatches && (
                  <IconButton
                    icon={ICONS.Edit}
                    variant="primary"
                    title="Edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/batches/edit/${batchId}`, { state: buildHistoryBackState(location) });
                    }}
                  />
                )}
                {canDeleteBatches && (
                  <IconButton
                    icon={ICONS.Delete}
                    variant="danger"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(batchId);
                    }}
                  />
                )}
              </div>
            ),
          }] : []),
        ]}
        data={batches}
        loading={!canLoadBatches || isFetching}
        emptyMessage="No batches found"
      />
      <Pagination page={effectivePage} totalPages={totalPages} onPageChange={(p) => setPage(p)} disabled={isFetching} />
    </div>
  );
};

export default Batches;
