import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BatchEvent } from '../types';
import { ICONS } from '../constants';
import { Button, Table, IconButton } from '../components';
import FilterBar, { FilterRange } from '../components/FilterBar';
import DynamicFilterBar from '../components/DynamicFilterBar';
import Pagination from '../src/components/Pagination';
import { theme } from '../theme';
import { useBatchesPage, useBatchEventTypes, useBatchEventsPage, useSystemDefaults, useUsersMini } from '../src/hooks/useQueries';
import { useDeleteBatchEvent } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { getPositivePageParam } from '../src/utils/navigation';
import { useResettablePage } from '../src/hooks/useResettablePage';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { buildLocalDateTime, getDateTimeFilters } from '../utils';

const BatchEventHistory: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToastNotifications();
  const { can } = useRolePermissions();
  const { hasSubCapability } = useCapabilities(true);

  const canDeleteEvents = can('batch_events.delete') && hasSubCapability('batch_management');

  const [searchParams, setSearchParams] = useSearchParams();
  const currentSearchParams = searchParams.toString();
  const urlPage = getPositivePageParam(searchParams.get('page'));
  const [syncedSearchParams, setSyncedSearchParams] = useState<string | null>(null);
  const shouldHydrateFromUrl = syncedSearchParams !== currentSearchParams;
  const [page, setPage] = useState<number>(urlPage);

  // Date range filtering
  const [filterRange, setFilterRange] = useState<FilterRange>('All Time');
  const [customDates, setCustomDates] = useState({ from: '', to: '' });
  const [includeTime, setIncludeTime] = useState(false);

  // Dynamic filtering
  const [batchFilter, setBatchFilter] = useState<string>('');
  const [batchNotFilter, setBatchNotFilter] = useState<string>('');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('');
  const [eventTypeNotFilter, setEventTypeNotFilter] = useState<string>('');
  const [populationChangeFilter, setPopulationChangeFilter] = useState<{ operator: string; value: string } | null>(null);
  const [expenseAmountFilter, setExpenseAmountFilter] = useState<{ operator: string; value: string } | null>(null);
  const [createdByFilter, setCreatedByFilter] = useState<string>('all');
  const [createdByNotFilter, setCreatedByNotFilter] = useState<string>('');

  const { data: systemDefaults, isPending: systemDefaultsLoading, isError: systemDefaultsError } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const canLoad = !systemDefaultsLoading || !!systemDefaults || systemDefaultsError;

  const { effectiveFilterRange, effectiveCustomDates, effectiveIncludeTime } = useMemo(() => {
    const range = filterRange === 'Custom' ? 'Custom' : filterRange;
    const from = range === 'Custom' ? customDates.from : null;
    const to = range === 'Custom' ? customDates.to : null;
    const time = range === 'Custom' ? includeTime : false;
    return { effectiveFilterRange: range, effectiveCustomDates: { from, to }, effectiveIncludeTime: time };
  }, [filterRange, customDates, includeTime]);

  const { dateFrom, dateTo } = useMemo(() => {
    if (effectiveFilterRange === 'Custom') {
      return {
        dateFrom: effectiveCustomDates.from || undefined,
        dateTo: effectiveCustomDates.to || undefined,
      };
    }
    const rangeFilters = getDateTimeFilters(effectiveFilterRange as FilterRange, { from: '', to: '' });
    return {
      dateFrom: rangeFilters.from || undefined,
      dateTo: rangeFilters.to || undefined,
    };
  }, [effectiveFilterRange, effectiveCustomDates]);

  // Compute created by IDs for filtering
  const createdByIds = useMemo(() => {
    if (createdByFilter === 'all') return undefined;
    return [createdByFilter];
  }, [createdByFilter]);
  const createdByNotIds = useMemo(() => {
    if (!createdByNotFilter) return undefined;
    return [createdByNotFilter];
  }, [createdByNotFilter]);

  const pageResetKey = useMemo(
    () => JSON.stringify({ batchFilter, batchNotFilter, eventTypeFilter, eventTypeNotFilter, populationChangeFilter, expenseAmountFilter, createdByFilter, createdByNotFilter, dateFrom, dateTo }),
    [batchFilter, batchNotFilter, eventTypeFilter, eventTypeNotFilter, populationChangeFilter, expenseAmountFilter, createdByFilter, createdByNotFilter, dateFrom, dateTo]
  );
  const pageFromStateOrUrl = shouldHydrateFromUrl ? urlPage : page;
  const effectivePage = useResettablePage(pageFromStateOrUrl, setPage, pageResetKey);

  const { data: eventsPage, isFetching } = useBatchEventsPage(effectivePage, pageSize, {
    batchId: batchFilter || undefined,
    eventTypeId: eventTypeFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  }, {
    batchNotIds: batchNotFilter ? [batchNotFilter] : undefined,
    eventTypeNotIds: eventTypeNotFilter ? [eventTypeNotFilter] : undefined,
    populationChange: populationChangeFilter || undefined,
    expenseAmount: expenseAmountFilter || undefined,
    createdByIds: createdByIds || undefined,
    createdByNotIds: createdByNotIds || undefined,
  });
  const { data: batchesData } = useBatchesPage(1, 10000);
  const { data: eventTypes = [] } = useBatchEventTypes();
  const { data: users = [] } = useUsersMini();

  const batches = batchesData?.data ?? [];
  const events = eventsPage?.data ?? [];
  const total = eventsPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const deleteEventMutation = useDeleteBatchEvent();

  const handleRefresh = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: ['batch-events'], exact: false, type: 'active' });
  }, [queryClient]);

  const handleFilterRangeChange = useCallback((range: FilterRange) => {
    setFilterRange(range);
    setPage(1);
  }, []);

  const handleCustomDatesChange = useCallback((dates: { from: string; to: string }) => {
    setCustomDates(dates);
    setPage(1);
  }, []);

  const handleIncludeTimeChange = useCallback((include: boolean) => {
    setIncludeTime(include);
    setPage(1);
  }, []);

  const batchEventFilterDefinitions = useMemo(() => {
    const batchOptions = batches.map(b => ({ value: b.id, label: b.name }));
    const eventTypeOptions = eventTypes.map(et => ({ value: et.id, label: et.name }));
    const userOptions = [
      { value: 'all', label: 'All Users' },
      ...users
        .slice()
        .sort((a, b) => a.role.localeCompare(b.role))
        .map((u) => ({ value: u.id, label: `${u.role}: ${u.name}` })),
    ];

    return [
      {
        type: 'Batch',
        operators: ['=', '≠'] as const,
        values: batchOptions,
        allowCustomValue: false,
      },
      {
        type: 'Event Type',
        operators: ['=', '≠'] as const,
        values: eventTypeOptions,
        allowCustomValue: false,
      },
      {
        type: 'Created by',
        operators: ['=', '≠'] as const,
        values: userOptions,
        allowCustomValue: false,
      },
      {
        type: 'Population Change',
        operators: ['=', '≠', '<', '>'] as const,
        valueType: 'number' as const,
        allowCustomValue: true,
      },
      {
        type: 'Expense Amount',
        operators: ['=', '≠', '<', '>'] as const,
        valueType: 'number' as const,
        allowCustomValue: true,
      },
    ];
  }, [batches, eventTypes, users]);

  const initialFilters = useMemo(() => {
    const filters = [];
    if (batchFilter) {
      const batch = batches.find(b => b.id === batchFilter);
      filters.push({ id: 'batch', type: 'Batch', operator: '=' as const, value: batchFilter, display: batch?.name || batchFilter });
    }
    if (batchNotFilter) {
      const batch = batches.find(b => b.id === batchNotFilter);
      filters.push({ id: 'batch-not', type: 'Batch', operator: '≠' as const, value: batchNotFilter, display: batch?.name || batchNotFilter });
    }
    if (eventTypeFilter) {
      const eventType = eventTypes.find(et => et.id === eventTypeFilter);
      filters.push({ id: 'event-type', type: 'Event Type', operator: '=' as const, value: eventTypeFilter, display: eventType?.name || eventTypeFilter });
    }
    if (eventTypeNotFilter) {
      const eventType = eventTypes.find(et => et.id === eventTypeNotFilter);
      filters.push({ id: 'event-type-not', type: 'Event Type', operator: '≠' as const, value: eventTypeNotFilter, display: eventType?.name || eventTypeNotFilter });
    }
    if (populationChangeFilter) {
      filters.push({ id: 'population-change', type: 'Population Change', operator: populationChangeFilter.operator as any, value: populationChangeFilter.value });
    }
    if (expenseAmountFilter) {
      filters.push({ id: 'expense-amount', type: 'Expense Amount', operator: expenseAmountFilter.operator as any, value: expenseAmountFilter.value });
    }
    if (createdByFilter && createdByFilter !== 'all') {
      const user = users.find(u => u.id === createdByFilter);
      const display = user ? `${user.role}: ${user.name}` : createdByFilter;
      filters.push({ id: 'created-by', type: 'Created by', operator: '=' as const, value: createdByFilter, display });
    }
    if (createdByNotFilter) {
      const user = users.find(u => u.id === createdByNotFilter);
      const display = user ? `${user.role}: ${user.name}` : createdByNotFilter;
      filters.push({ id: 'created-by-not', type: 'Created by', operator: '≠' as const, value: createdByNotFilter, display });
    }
    return filters;
  }, [batchFilter, batchNotFilter, eventTypeFilter, eventTypeNotFilter, populationChangeFilter, expenseAmountFilter, createdByFilter, createdByNotFilter, batches, eventTypes, users]);

  useEffect(() => {
    if (!shouldHydrateFromUrl) return;
    setPage(urlPage);
    setSyncedSearchParams(currentSearchParams);
  }, [shouldHydrateFromUrl, urlPage, currentSearchParams]);

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

  const handleDelete = async (eventId: string) => {
    if (!confirm('Delete this batch event?')) return;
    try {
      await deleteEventMutation.mutateAsync(eventId);
      toast.success('Batch event deleted');
    } catch (err) {
      console.error('Failed to delete batch event:', err);
      toast.error('Failed to delete batch event');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div className="hidden sm:block">
            <FilterBar
              title="Batch Events"
              filterRange={effectiveFilterRange as FilterRange}
              setFilterRange={handleFilterRangeChange}
              customDates={effectiveCustomDates}
              setCustomDates={handleCustomDatesChange}
              includeTime={effectiveIncludeTime}
              setIncludeTime={handleIncludeTimeChange}
              compact={true}
              onRefresh={handleRefresh}
              isRefreshing={isFetching}
            />
          </div>
        </div>
      </div>
      <div className="sm:hidden">
        <FilterBar
          title="Batch Events"
          filterRange={effectiveFilterRange as FilterRange}
          setFilterRange={handleFilterRangeChange}
          customDates={effectiveCustomDates}
          setCustomDates={handleCustomDatesChange}
          includeTime={effectiveIncludeTime}
          setIncludeTime={handleIncludeTimeChange}
          onRefresh={handleRefresh}
          isRefreshing={isFetching}
        />
      </div>

      <DynamicFilterBar
        filterDefinitions={batchEventFilterDefinitions}
        initialFilters={initialFilters}
        users={users}
        freeTextLabel="Batch Events"
        onApply={(appliedFilters) => {
          setPage(1);

          const batchFilter = appliedFilters.find((f) => f.type === 'Batch' && f.operator === '=');
          const batchNotFilter = appliedFilters.find((f) => f.type === 'Batch' && f.operator === '≠');
          setBatchFilter(batchFilter?.value ?? '');
          setBatchNotFilter(batchNotFilter?.value ?? '');

          const eventTypeFilter = appliedFilters.find((f) => f.type === 'Event Type' && f.operator === '=');
          const eventTypeNotFilter = appliedFilters.find((f) => f.type === 'Event Type' && f.operator === '≠');
          setEventTypeFilter(eventTypeFilter?.value ?? '');
          setEventTypeNotFilter(eventTypeNotFilter?.value ?? '');

          const populationChangeFilter = appliedFilters.find((f) => f.type === 'Population Change');
          setPopulationChangeFilter(populationChangeFilter ? { operator: populationChangeFilter.operator, value: populationChangeFilter.value } : null);

          const expenseAmountFilter = appliedFilters.find((f) => f.type === 'Expense Amount');
          setExpenseAmountFilter(expenseAmountFilter ? { operator: expenseAmountFilter.operator, value: expenseAmountFilter.value } : null);

          const createdByFilter = appliedFilters.find((f) => f.type === 'Created by' && f.operator === '=');
          const createdByNotFilter = appliedFilters.find((f) => f.type === 'Created by' && f.operator === '≠');
          setCreatedByFilter(createdByFilter?.value ?? 'all');
          setCreatedByNotFilter(createdByNotFilter?.value ?? '');
        }}
      />

      <Table
        columns={[
          {
            key: 'eventDate',
            label: 'Date',
            render: (eventDate: string) => (
              <span className="text-sm font-medium text-gray-700">
                {new Date(eventDate).toLocaleDateString()}
              </span>
            ),
          },
          {
            key: 'batchName',
            label: 'Batch',
            render: (batchName: string) => (
              <span className="font-bold text-gray-900">{batchName || '—'}</span>
            ),
          },
          {
            key: 'eventTypeName',
            label: 'Event Type',
            render: (eventTypeName: string) => (
              <span className="px-2.5 py-1 bg-[#ebf4ff] rounded-lg text-[10px] font-black uppercase tracking-widest">
                {eventTypeName || '—'}
              </span>
            ),
          },
          {
            key: 'populationChange',
            label: 'Pop. Change',
            align: 'right' as const,
            render: (populationChange: number) => (
              <span className={`font-black ${populationChange > 0 ? 'text-emerald-600' : populationChange < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                {populationChange > 0 ? '+' : ''}{populationChange}
              </span>
            ),
          },
          {
            key: 'populationAfter',
            label: 'Pop. After',
            align: 'right' as const,
            render: (populationAfter: number) => (
              <span className="font-bold text-gray-700">{populationAfter}</span>
            ),
          },
          {
            key: 'expenseAmount',
            label: 'Expense',
            align: 'right' as const,
            render: (expenseAmount: number) => (
              <span className="text-sm font-medium text-gray-700">
                {expenseAmount > 0 ? `৳${expenseAmount.toLocaleString()}` : '—'}
              </span>
            ),
          },
          {
            key: 'notes',
            label: 'Notes',
            render: (notes: string) => (
              <span className="text-sm text-gray-500 truncate max-w-[200px] block">{notes || '—'}</span>
            ),
          },
          ...(canDeleteEvents ? [{
            key: 'id',
            label: '',
            align: 'right' as const,
            render: (eventId: string) => (
              <IconButton
                icon={ICONS.Delete}
                variant="danger"
                title="Delete"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(eventId);
                }}
              />
            ),
          }] : []),
        ]}
        data={events}
        loading={!canLoad || isFetching}
        emptyMessage="No batch events found"
      />
      <Pagination page={effectivePage} totalPages={totalPages} onPageChange={(p) => setPage(p)} disabled={isFetching} />
    </div>
  );
};

export default BatchEventHistory;
