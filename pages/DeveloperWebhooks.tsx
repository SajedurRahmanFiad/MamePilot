import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CourierWebhookEvent } from '../types';
import { ICONS } from '../constants';
import { Table, Modal, LoadingOverlay, Button } from '../components';
import FilterBar, { FilterRange } from '../components/FilterBar';
import DynamicFilterBar, { CombinedFilter } from '../components/DynamicFilterBar';
import Pagination from '../src/components/Pagination';
import { theme } from '../theme';
import { useWebhookEventsPage, useWebhookEventDetail, useSystemDefaults } from '../src/hooks/useQueries';
import { useSetWebhookSavingEnabled } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { getPositivePageParam } from '../src/utils/navigation';
import { useResettablePage } from '../src/hooks/useResettablePage';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { formatDateTime as formatUtcDateTime, getDateTimeFilters } from '../utils';

const PROVIDER_LABELS: Record<string, string> = {
  carrybee: 'CarryBee',
  paperfly: 'Paperfly',
  steadfast: 'SteadFast',
  pathao: 'Pathao',
};

const PROVIDER_COLORS: Record<string, string> = {
  carrybee: 'bg-violet-100 text-violet-700',
  paperfly: 'bg-sky-100 text-sky-700',
  steadfast: 'bg-emerald-100 text-emerald-700',
  pathao: 'bg-amber-100 text-amber-700',
};

const STATUS_COLORS: Record<string, string> = {
  processed: 'bg-emerald-100 text-emerald-700',
  received: 'bg-blue-100 text-blue-700',
  unmatched: 'bg-amber-100 text-amber-700',
};

const providerLabel = (provider: string): string => PROVIDER_LABELS[String(provider).toLowerCase()] || provider;
const providerColor = (provider: string): string => PROVIDER_COLORS[String(provider).toLowerCase()] || 'bg-gray-100 text-gray-700';
const statusColor = (status: string): string => STATUS_COLORS[String(status).toLowerCase()] || 'bg-gray-100 text-gray-700';

const DeveloperWebhooks: React.FC = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToastNotifications();

  const [searchParams, setSearchParams] = useSearchParams();
  const currentSearchParams = searchParams.toString();
  const urlPage = getPositivePageParam(searchParams.get('page'));
  const [syncedSearchParams, setSyncedSearchParams] = useState<string | null>(null);
  const shouldHydrateFromUrl = syncedSearchParams !== currentSearchParams;
  const [page, setPage] = useState<number>(urlPage);

  const [filterRange, setFilterRange] = useState<FilterRange>('All Time');
  const [customDates, setCustomDates] = useState({ from: '', to: '' });
  const [includeTime, setIncludeTime] = useState(false);

  const [providerFilter, setProviderFilter] = useState<string>('');
  const [providerNotFilter, setProviderNotFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [statusNotFilter, setStatusNotFilter] = useState<string>('');
  const [eventNameFilter, setEventNameFilter] = useState<{ operator: string; value: string } | null>(null);
  const [consignmentFilter, setConsignmentFilter] = useState<{ operator: string; value: string } | null>(null);
  const [referenceFilter, setReferenceFilter] = useState<{ operator: string; value: string } | null>(null);
  const [orderFilter, setOrderFilter] = useState<{ operator: string; value: string } | null>(null);
  const [receivedOnFilter, setReceivedOnFilter] = useState<string>('');
  const [receivedBeforeFilter, setReceivedBeforeFilter] = useState<string>('');
  const [receivedAfterFilter, setReceivedAfterFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

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

  const pageResetKey = useMemo(
    () => JSON.stringify({
      providerFilter, providerNotFilter, statusFilter, statusNotFilter,
      eventNameFilter, consignmentFilter, referenceFilter, orderFilter,
      receivedOnFilter, receivedBeforeFilter, receivedAfterFilter, dateFrom, dateTo, searchQuery,
    }),
    [providerFilter, providerNotFilter, statusFilter, statusNotFilter, eventNameFilter, consignmentFilter, referenceFilter, orderFilter, receivedOnFilter, receivedBeforeFilter, receivedAfterFilter, dateFrom, dateTo, searchQuery]
  );
  const pageFromStateOrUrl = shouldHydrateFromUrl ? urlPage : page;
  const effectivePage = useResettablePage(pageFromStateOrUrl, setPage, pageResetKey);

  const { data: eventsPage, isFetching } = useWebhookEventsPage(effectivePage, pageSize, {
    provider: providerFilter || undefined,
    processingStatus: statusFilter || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    search: searchQuery || undefined,
  }, {
    providerNot: providerNotFilter || undefined,
    processingStatusNot: statusNotFilter || undefined,
    eventName: eventNameFilter || undefined,
    consignmentId: consignmentFilter || undefined,
    merchantReference: referenceFilter || undefined,
    orderId: orderFilter || undefined,
    receivedOn: receivedOnFilter || undefined,
    receivedBefore: receivedBeforeFilter || undefined,
    receivedAfter: receivedAfterFilter || undefined,
  });

  const { data: detail } = useWebhookEventDetail(selectedEventId);
  const setSavingEnabledMutation = useSetWebhookSavingEnabled();

  const events = eventsPage?.data ?? [];
  const total = eventsPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const savingEnabled = eventsPage?.savingEnabled ?? true;
  const filterOptions = eventsPage?.options;

  const filterDefinitions = useMemo(() => {
    const providers = (filterOptions?.providers ?? []).map((value) => ({ value, label: providerLabel(value) }));
    const eventNames = (filterOptions?.eventNames ?? []).map((value) => ({ value, label: value }));
    return [
      {
        type: 'Provider',
        operators: ['=', '≠'] as const,
        values: providers,
        allowCustomValue: false,
      },
      {
        type: 'Event Name',
        operators: ['contains', 'does not contain'] as const,
        values: eventNames,
        allowCustomValue: true,
      },
      {
        type: 'Processing Status',
        operators: ['=', '≠'] as const,
        values: (filterOptions?.processingStatuses ?? ['received', 'processed', 'unmatched']).map((value) => ({ value, label: value })),
        allowCustomValue: false,
      },
      {
        type: 'Order',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
      },
      {
        type: 'Consignment',
        operators: ['contains', 'does not contain'] as const,
        allowCustomValue: true,
      },
      {
        type: 'Merchant Reference',
        operators: ['contains', 'does not contain'] as const,
        allowCustomValue: true,
      },
      {
        type: 'Received',
        operators: ['on', 'before', 'after'] as const,
        valueType: 'date' as const,
      },
    ];
  }, [filterOptions]);

  const initialFilters = useMemo<CombinedFilter[]>(() => {
    const filters: CombinedFilter[] = [];
    if (providerFilter) filters.push({ id: 'provider', type: 'Provider', operator: '=', value: providerFilter, display: providerLabel(providerFilter) });
    if (providerNotFilter) filters.push({ id: 'provider-not', type: 'Provider', operator: '≠', value: providerNotFilter, display: providerLabel(providerNotFilter) });
    if (statusFilter) filters.push({ id: 'status', type: 'Processing Status', operator: '=', value: statusFilter });
    if (statusNotFilter) filters.push({ id: 'status-not', type: 'Processing Status', operator: '≠', value: statusNotFilter });
    if (eventNameFilter) filters.push({ id: 'event-name', type: 'Event Name', operator: eventNameFilter.operator as any, value: eventNameFilter.value });
    if (consignmentFilter) filters.push({ id: 'consignment', type: 'Consignment', operator: consignmentFilter.operator as any, value: consignmentFilter.value });
    if (referenceFilter) filters.push({ id: 'merchant-reference', type: 'Merchant Reference', operator: referenceFilter.operator as any, value: referenceFilter.value });
    if (orderFilter) filters.push({ id: 'order', type: 'Order', operator: orderFilter.operator as any, value: orderFilter.value });
    if (receivedOnFilter) filters.push({ id: 'received-on', type: 'Received', operator: 'on', value: receivedOnFilter });
    if (receivedBeforeFilter) filters.push({ id: 'received-before', type: 'Received', operator: 'before', value: receivedBeforeFilter });
    if (receivedAfterFilter) filters.push({ id: 'received-after', type: 'Received', operator: 'after', value: receivedAfterFilter });
    return filters;
  }, [providerFilter, providerNotFilter, statusFilter, statusNotFilter, eventNameFilter, consignmentFilter, referenceFilter, orderFilter, receivedOnFilter, receivedBeforeFilter, receivedAfterFilter]);

  const handleApplyFilters = useCallback((appliedFilters: CombinedFilter[]) => {
    setPage(1);
    const byType = (type: string, operator?: string) => appliedFilters.find((f) => f.type === type && (!operator || f.operator === operator));
    setProviderFilter(byType('Provider', '=')?.value ?? '');
    setProviderNotFilter(byType('Provider', '≠')?.value ?? '');
    setStatusFilter(byType('Processing Status', '=')?.value ?? '');
    setStatusNotFilter(byType('Processing Status', '≠')?.value ?? '');
    const eventName = byType('Event Name');
    setEventNameFilter(eventName ? { operator: eventName.operator, value: eventName.value } : null);
    const consignment = byType('Consignment');
    setConsignmentFilter(consignment ? { operator: consignment.operator, value: consignment.value } : null);
    const reference = byType('Merchant Reference');
    setReferenceFilter(reference ? { operator: reference.operator, value: reference.value } : null);
    const order = byType('Order');
    setOrderFilter(order ? { operator: order.operator, value: order.value } : null);
    setReceivedOnFilter(byType('Received', 'on')?.value ?? '');
    setReceivedBeforeFilter(byType('Received', 'before')?.value ?? '');
    setReceivedAfterFilter(byType('Received', 'after')?.value ?? '');
  }, []);

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

  const handleFilterRangeChange = useCallback((range: FilterRange) => { setFilterRange(range); setPage(1); }, []);
  const handleCustomDatesChange = useCallback((dates: { from: string; to: string }) => { setCustomDates(dates); setPage(1); }, []);
  const handleIncludeTimeChange = useCallback((include: boolean) => { setIncludeTime(include); setPage(1); }, []);
  const handleRefresh = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: ['webhook-events'], exact: false, type: 'active' });
  }, [queryClient]);

  const handleToggleSaving = async (enabled: boolean) => {
    try {
      await setSavingEnabledMutation.mutateAsync({ enabled });
      toast.success(enabled ? 'Webhook saving enabled.' : 'Webhook saving disabled. New events will not be stored.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update webhook saving.');
    }
  };

  const formatDateTime = (value: string | null | undefined): string => {
    const formatted = formatUtcDateTime(value);
    return formatted ? formatted : '—';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 w-full sm:w-auto">
          <div className="hidden sm:block">
            <FilterBar
              title="Webhooks"
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
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
          <input
            id="save-webhook-events-toggle"
            type="checkbox"
            checked={savingEnabled}
            disabled={setSavingEnabledMutation.isPending}
            onChange={(e) => handleToggleSaving(e.target.checked)}
            className="h-4 w-4 accent-blue-600"
          />
          <label htmlFor="save-webhook-events-toggle" className="text-sm font-bold text-gray-800 cursor-pointer select-none">
            Save webhook events
          </label>
          <span className="text-xs text-gray-400">
            {savingEnabled ? 'New webhooks are being stored.' : 'New webhooks will not be stored.'}
          </span>
        </div>
      </div>
      <div className="sm:hidden">
        <FilterBar
          title="Webhooks"
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
        filterDefinitions={filterDefinitions}
        initialFilters={initialFilters}
        freeTextLabel="Webhooks"
        rawSearchValue={searchQuery}
        onRawSearchChange={(value) => { setSearchQuery(value); setPage(1); }}
        onApply={handleApplyFilters}
      />

      <Table
        columns={[
          {
            key: 'receivedAt',
            label: 'Received At',
            render: (receivedAt: string) => (
              <span className="text-sm font-medium text-gray-700">{formatDateTime(receivedAt)}</span>
            ),
          },
          {
            key: 'provider',
            label: 'Provider',
            render: (provider: string) => (
              <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${providerColor(provider)}`}>
                {providerLabel(provider)}
              </span>
            ),
          },
          {
            key: 'eventName',
            label: 'Event',
            render: (eventName: string) => (
              <span className="font-mono text-xs font-bold text-gray-900">{eventName || '—'}</span>
            ),
          },
          {
            key: 'orderNumber',
            label: 'Order',
            render: (_value: string, item: CourierWebhookEvent) => {
              if (!item.orderNumber) {
                return (
                  <span className="text-sm text-gray-400">Unmatched</span>
                );
              }
              return (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/orders/${item.orderId}`);
                  }}
                  className="text-sm font-bold text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {item.orderNumber}
                </button>
              );
            },
          },
          {
            key: 'consignmentId',
            label: 'Consignment',
            render: (consignmentId: string) => (
              <span className="text-sm text-gray-600">{consignmentId ? <span className="font-mono">{consignmentId}</span> : '—'}</span>
            ),
          },
          {
            key: 'processingStatus',
            label: 'Processing',
            render: (processingStatus: string, item: CourierWebhookEvent) => (
              <div title={item.processingMessage || processingStatus}>
                <span className={`px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest ${statusColor(processingStatus)}`}>
                  {processingStatus}
                </span>
              </div>
            ),
          },
          {
            key: 'eventAt',
            label: 'Event At',
            render: (eventAt: string | null) => (
              <span className="text-sm text-gray-500">{formatDateTime(eventAt)}</span>
            ),
          },
        ]}
        data={events}
        loading={!canLoad || isFetching}
        emptyMessage="No webhook events stored yet"
        onRowClick={(item: CourierWebhookEvent) => setSelectedEventId(item.id)}
      />
      <Pagination page={effectivePage} totalPages={totalPages} onPageChange={(p) => setPage(p)} disabled={isFetching} />

      <Modal
        isOpen={!!selectedEventId}
        onClose={() => setSelectedEventId(null)}
        title={selectedEventId ? `Webhook Event — ${providerLabel(detail?.event?.provider ?? '')} / ${detail?.event?.eventName ?? ''}` : 'Webhook Event'}
        size="xl"
        contentClassName="max-h-[72vh] overflow-y-auto p-6"
      >
        {detail ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Event ID</div>
                <div className="mt-1 font-mono text-xs break-all">{detail.event.id}</div>
              </div>
              {detail.order && (
                <Link to={`/orders/${detail.order.id}`} onClick={() => setSelectedEventId(null)} className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 hover:bg-blue-50">
                  <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Order</div>
                  <div className="mt-1 font-bold text-blue-700">{detail.order.orderNumber}</div>
                  <div className="text-xs text-gray-500">{detail.order.status} · ৳{(detail.order.total).toLocaleString()} · Paid ৳{(detail.order.paidAmount).toLocaleString()}</div>
                </Link>
              )}
              {!detail.order && (
                <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3">
                  <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Order</div>
                  <div className="mt-1 text-sm font-bold text-amber-700">No order matched</div>
                </div>
              )}
              <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Status</div>
                <div className="mt-1 text-sm font-bold">
                  <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest ${statusColor(detail.event.processingStatus)}`}>
                    {detail.event.processingStatus}
                  </span>
                  {detail.event.processingMessage && <span className="mt-1 block text-xs font-normal text-gray-500">{detail.event.processingMessage}</span>}
                </div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Consignment</div>
                <div className="mt-1 font-mono text-xs">{detail.event.consignmentId || '—'}</div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Merchant Reference</div>
                <div className="mt-1 font-mono text-xs">{detail.event.merchantReference || '—'}</div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Times</div>
                <div className="mt-1 text-xs text-gray-600">Received: {formatDateTime(detail.event.receivedAt)}</div>
                <div className="text-xs text-gray-600">Event: {formatDateTime(detail.event.eventAt)}</div>
                {detail.event.processedAt && <div className="text-xs text-gray-600">Processed: {formatDateTime(detail.event.processedAt)}</div>}
              </div>
            </div>

            {detail.charges.length > 0 && (
              <div className="rounded-xl border border-gray-100 bg-white p-4">
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-2">Linked Courier Charges</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead>
                      <tr className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">
                        <th className="py-1 pr-3">Provider</th>
                        <th className="py-1 pr-3">Consignment</th>
                        <th className="py-1 pr-3 text-right">COD Fee</th>
                        <th className="py-1 pr-3 text-right">Delivery Fee</th>
                        <th className="py-1 pr-3 text-right">Total</th>
                        <th className="py-1 pr-3 text-right">Collected</th>
                        <th className="py-1">Expense</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {detail.charges.map((charge, index) => (
                        <tr key={index}>
                          <td className="py-1.5 pr-3 font-bold">{providerLabel(charge.provider)}</td>
                          <td className="py-1.5 pr-3 font-mono text-xs">{charge.consignmentId || '—'}</td>
                          <td className="py-1.5 pr-3 text-right">{charge.codFee.toLocaleString()}</td>
                          <td className="py-1.5 pr-3 text-right">{charge.deliveryFee.toLocaleString()}</td>
                          <td className="py-1.5 pr-3 text-right font-bold">{charge.totalCharge.toLocaleString()}</td>
                          <td className="py-1.5 pr-3 text-right">{charge.collectedAmount.toLocaleString()}</td>
                          <td className="py-1.5">
                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest ${charge.expenseStatus === 'recorded' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                              {charge.expenseStatus}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Raw JSON Payload</div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(JSON.stringify(detail.event.payload, null, 2));
                    toast.success('Payload copied to clipboard.');
                  }}
                >
                  Copy
                </Button>
              </div>
              <pre className="max-h-[48vh] overflow-auto rounded-xl border border-gray-100 bg-gray-900 p-4 text-xs leading-relaxed text-emerald-200 font-mono whitespace-pre">
                {JSON.stringify(detail.event.payload, null, 2)}
              </pre>
            </div>
          </div>
        ) : (
          <LoadingOverlay isLoading={true} message="Loading webhook event..." />
        )}
      </Modal>
    </div>
  );
};

export default DeveloperWebhooks;