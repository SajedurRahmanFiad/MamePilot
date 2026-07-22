import { theme } from '../theme';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, BarChart3, MousePointerClick, RefreshCw, Users, TrendingUp, Monitor, LayoutGrid, Image as ImageIcon, FileJson, Calendar } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { Card, Button, MetaAdsMoney } from '../components';
import DynamicFilterBar from '../components/DynamicFilterBar';
import FilterBar, { type FilterRange } from '../components/FilterBar';
import { ICONS } from '../constants';
import { formatDate, formatDateTime, formatDateTimeParts } from '../utils';
import { useQueryClient } from '@tanstack/react-query';
import { useMetaAd, useMetaAds, useMetaAdsSyncStatus, useMetaAdsSettings, useMetaAdInsightsDaily, useMetaAdInsightsDemographics, useMetaAdInsightsPlacements, useMetaAdInsightsDevices } from '../src/hooks/useQueries';
import { useSyncMetaAds } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { getPreservedRouteState } from '../src/utils/navigation';
import { formatMetaAdsCurrency } from '../src/utils/metaAdsCurrency';

const statusBadgeClass = (status?: string | null): string => {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'ACTIVE') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'PAUSED' || normalized === 'CAMPAIGN_PAUSED' || normalized === 'ADSET_PAUSED') return 'bg-amber-100 text-amber-700';
  if (normalized === 'ARCHIVED' || normalized === 'DELETED') return 'bg-gray-200 text-gray-700';
  if (normalized === 'IN_PROCESS') return 'bg-sky-100 text-sky-700';
  if (normalized === 'WITH_ISSUES' || normalized === 'DISAPPROVED') return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-600';
};

const prettyStatus = (status?: string | null): string => {
  const raw = String(status || 'Unknown').replace(/_/g, ' ').toLowerCase();
  return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
};

const formatNumber = (value?: number | string | null): string =>
  new Intl.NumberFormat('en-BD').format(Number(value || 0));

const getDateRange = (range: FilterRange, customDates: { from: string; to: string }): { from: string; to: string } => {
  const today = new Date();
  const end = new Date(today);
  const start = new Date(today);
  const formatDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  if (range === 'Today') {
    return { from: formatDate(start), to: formatDate(end) };
  }

  if (range === 'Last 7 days') {
    start.setDate(start.getDate() - 6);
    return { from: formatDate(start), to: formatDate(end) };
  }

  if (range === 'Last 30 days') {
    start.setDate(start.getDate() - 29);
    return { from: formatDate(start), to: formatDate(end) };
  }

  if (range === 'This Week') {
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    return { from: formatDate(start), to: formatDate(end) };
  }

  if (range === 'This Month') {
    start.setDate(1);
    return { from: formatDate(start), to: formatDate(end) };
  }

  if (range === 'This Year') {
    start.setMonth(0, 1);
    return { from: formatDate(start), to: formatDate(end) };
  }

  if (range === 'Custom') {
    const fallback = formatDate(today);
    const from = customDates.from || customDates.to || fallback;
    const to = customDates.to || customDates.from || fallback;
    return from <= to ? { from, to } : { from: to, to: from };
  }

  return { from: '', to: '' };
};

const filterByDateRange = (items: any[], range: { from: string; to: string }): any[] => {
  if (!range.from && !range.to) return items;
  return items.filter((item: any) => {
    const date = String(item.date || item.insight_date || '');
    if (!date) return false;
    if (range.from && date < range.from) return false;
    if (range.to && date > range.to) return false;
    return true;
  });
};

const MetricCard: React.FC<{ label: string; value: React.ReactNode; hint?: React.ReactNode; icon?: React.ReactNode }> = ({ label, value, hint, icon }) => (
  <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
        <p className="mt-2 text-xl font-black text-gray-900">{value}</p>
      </div>
      {icon && <div className="rounded-lg bg-gray-50 p-2 text-gray-500">{icon}</div>}
    </div>
    {hint && <p className="mt-2 text-xs font-semibold text-gray-500">{hint}</p>}
  </div>
);

const Field: React.FC<{ label: string; value?: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
    <div className="mt-1 break-words text-sm font-bold text-gray-900">{value || '-'}</div>
  </div>
);



const CompactMetric: React.FC<{ label: string; value?: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <div className="relative rounded-lg border border-gray-100 bg-gray-50/80 px-3 py-2">
    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
    <div className="mt-1 overflow-visible text-sm font-bold text-gray-900">{value || '-'}</div>
    {hint && <p className="mt-0.5 text-[10px] text-gray-400">{hint}</p>}
  </div>
);
const MetaAdsList: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToastNotifications();
  const restoredListState = (location.state as any)?.metaAdsListState || {};
  const [queryFilters, setQueryFilters] = useState({
    businessId: '',
    businessOperator: '=',
    adAccountId: '',
    adAccountOperator: '=',
    campaignId: '',
    campaignOperator: '=',
    status: '',
    statusOperator: '=',
    search: '',
    searchOperator: 'contains',
    ...getDateRange('Last 7 days', { from: '', to: '' }),
    ...(restoredListState.queryFilters || {}),
  });
  const [dynamicFilters, setDynamicFilters] = useState<any[]>(restoredListState.dynamicFilters || []);
  const [filterRange, setFilterRange] = useState<FilterRange>(restoredListState.filterRange || 'Last 7 days');
  const [customDates, setCustomDates] = useState(restoredListState.customDates || { from: '', to: '' });
  const { data: metaAdsSettings, isPending: settingsPending } = useMetaAdsSettings();
  const isMetaAdsConfigured = Boolean(metaAdsSettings?.appId);
  const { data, isPending, error, refetch } = useMetaAds(queryFilters, isMetaAdsConfigured);
  const { data: syncStatus, refetch: refetchSyncStatus } = useMetaAdsSyncStatus(true);
  const syncMutation = useSyncMetaAds();
  const queryClient = useQueryClient();
  const COOLDOWN_KEY = 'meta-ads-sync-cooldown-until';
  const [cooldownRemaining, setCooldownRemaining] = useState(() => {
    const saved = localStorage.getItem(COOLDOWN_KEY);
    if (saved) {
      const remaining = Math.ceil((Number(saved) - Date.now()) / 1000);
      return remaining > 0 ? remaining : 0;
    }
    return 0;
  });
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyCooldown = useCallback((seconds: number) => {
    setCooldownRemaining(seconds);
    localStorage.setItem(COOLDOWN_KEY, String(Date.now() + seconds * 1000));
  }, []);

  // Sync cooldown countdown timer
  useEffect(() => {
    const serverCooldown = syncStatus?.cooldownRemainingSeconds ?? 0;
    if (serverCooldown > 0 && cooldownRemaining === 0) {
      applyCooldown(serverCooldown);
    }
  }, [syncStatus?.cooldownRemainingSeconds]);

  useEffect(() => {
    if (cooldownRemaining <= 0) {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
      return;
    }
    cooldownTimerRef.current = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          cooldownTimerRef.current = null;
          localStorage.removeItem(COOLDOWN_KEY);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    };
  }, [cooldownRemaining]);

  // Auto-refresh: poll database every 2 minutes (backend auto-syncs Meta API when data is stale)
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
      refetchSyncStatus();
    }, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refetch, refetchSyncStatus]);
  const filterOptions = data?.filters || { businesses: [], adAccounts: [], campaigns: [], statuses: [] };

  const ads = useMemo(() => data?.ads || [], [data?.ads]);
  const selectedBusinessId = useMemo(() => {
    const filter = dynamicFilters.find((item) => item.type === 'Business');
    return filter?.operator === '=' ? filter.value : '';
  }, [dynamicFilters]);
  const selectedAdAccountId = useMemo(() => {
    const filter = dynamicFilters.find((item) => item.type === 'Ad Account');
    return filter?.operator === '=' ? filter.value : '';
  }, [dynamicFilters]);

  const adAccounts = useMemo(() => {
    const rows = filterOptions.adAccounts || [];
    return rows.filter((account: any) => !selectedBusinessId || account.businessId === selectedBusinessId);
  }, [filterOptions.adAccounts, selectedBusinessId]);

  const campaigns = useMemo(() => {
    const rows = filterOptions.campaigns || [];
    return rows.filter((campaign: any) => {
      if (selectedBusinessId && campaign.businessId !== selectedBusinessId) return false;
      if (selectedAdAccountId && campaign.adAccountId !== selectedAdAccountId) return false;
      return true;
    });
  }, [filterOptions.campaigns, selectedBusinessId, selectedAdAccountId]);

  const filterDefinitions = useMemo(() => {
    const businesses = (filterOptions.businesses || []).map((business: any) => ({ value: String(business.id), label: String(business.name) }));
    const accounts = (adAccounts || []).map((account: any) => ({ value: String(account.id), label: String(account.name) }));
    const campaignOptions = (campaigns || []).map((campaign: any) => ({ value: String(campaign.id), label: String(campaign.name) }));
    const statuses = (filterOptions.statuses || []).map((status: string) => ({ value: String(status), label: prettyStatus(status) }));
    const adNames = Array.from(new Set<string>((ads || []).map((ad: any) => String(ad.name || '').trim()).filter(Boolean))).map((name) => ({ value: name, label: name }));

    return [
      { type: 'Business', operators: ['=', '≠'] as const, values: businesses, defaultOperator: '=' as const },
      { type: 'Ad Account', operators: ['=', '≠'] as const, values: accounts, defaultOperator: '=' as const },
      { type: 'Campaign', operators: ['=', '≠'] as const, values: campaignOptions, defaultOperator: '=' as const },
      { type: 'Status', operators: ['=', '≠'] as const, values: statuses, defaultOperator: '=' as const },
      { type: 'Ad Name', operators: ['=', '≠', 'contains', 'does not contain'] as const, values: adNames, defaultOperator: 'contains' as const, allowCustomValue: true },
    ];
  }, [adAccounts, campaigns, filterOptions.businesses, filterOptions.statuses, ads]);

  const applyDynamicFilters = (nextFilters: any[]) => {
    let normalizedFilters = nextFilters.filter((filter) => ['Business', 'Ad Account', 'Campaign', 'Status', 'Ad Name'].includes(filter.type));
    const nextBusinessFilter = normalizedFilters.find((filter) => filter.type === 'Business');
    const positiveBusinessId = nextBusinessFilter?.operator === '=' ? String(nextBusinessFilter.value) : '';
    if (positiveBusinessId) {
      const allowedAccountIds = new Set(
        (filterOptions.adAccounts || [])
          .filter((account: any) => String(account.businessId) === positiveBusinessId)
          .map((account: any) => String(account.id))
      );
      normalizedFilters = normalizedFilters.filter((filter) => filter.type !== 'Ad Account' || allowedAccountIds.has(String(filter.value)));
    }
    const nextAdAccountFilter = normalizedFilters.find((filter) => filter.type === 'Ad Account');
    const positiveAdAccountId = nextAdAccountFilter?.operator === '=' ? String(nextAdAccountFilter.value) : '';
    if (positiveBusinessId || positiveAdAccountId) {
      const allowedCampaignIds = new Set(
        (filterOptions.campaigns || [])
          .filter((campaign: any) => (!positiveBusinessId || String(campaign.businessId) === positiveBusinessId)
            && (!positiveAdAccountId || String(campaign.adAccountId) === positiveAdAccountId))
          .map((campaign: any) => String(campaign.id))
      );
      normalizedFilters = normalizedFilters.filter((filter) => filter.type !== 'Campaign' || allowedCampaignIds.has(String(filter.value)));
    }
    const businessFilter = normalizedFilters.find((filter) => filter.type === 'Business');
    const adAccountFilter = normalizedFilters.find((filter) => filter.type === 'Ad Account');
    const campaignFilter = normalizedFilters.find((filter) => filter.type === 'Campaign');
    const statusFilter = normalizedFilters.find((filter) => filter.type === 'Status');
    const adNameFilter = normalizedFilters.find((filter) => filter.type === 'Ad Name');

    setDynamicFilters(normalizedFilters);
    setQueryFilters((current) => ({
      ...current,
      businessId: businessFilter?.value || '',
      businessOperator: businessFilter?.operator || '=',
      adAccountId: adAccountFilter?.value || '',
      adAccountOperator: adAccountFilter?.operator || '=',
      campaignId: campaignFilter?.value || '',
      campaignOperator: campaignFilter?.operator || '=',
      status: statusFilter?.value || '',
      statusOperator: statusFilter?.operator || '=',
      search: adNameFilter?.value || '',
      searchOperator: adNameFilter?.operator || 'contains',
    }));
  };

  const applyDateRange = useCallback((nextRange: FilterRange, nextCustomDates: { from: string; to: string }) => {
    setQueryFilters((current) => ({ ...current, ...getDateRange(nextRange, nextCustomDates) }));
  }, []);

  const handleFilterRangeChange = (nextRange: FilterRange) => {
    setFilterRange(nextRange);
    if (nextRange === 'Custom' && !customDates.from && !customDates.to) {
      const todayRange = getDateRange('Today', customDates);
      setCustomDates(todayRange);
      applyDateRange(nextRange, todayRange);
      return;
    }
    applyDateRange(nextRange, customDates);
  };

  const handleCustomDatesChange = (nextCustomDates: { from: string; to: string }) => {
    setCustomDates(nextCustomDates);
    applyDateRange(filterRange, nextCustomDates);
  };

  // Track last synced time so we can detect when a background sync completes
  const lastSyncedAtRef = useRef<string | null>(syncStatus?.lastSyncedAt ?? null);

  // When sync status changes (background sync completed), refetch ad data automatically
  useEffect(() => {
    const currentLastSynced = syncStatus?.lastSyncedAt ?? null;
    if (currentLastSynced && currentLastSynced !== lastSyncedAtRef.current) {
      lastSyncedAtRef.current = currentLastSynced;
      refetch();
      queryClient.invalidateQueries({ queryKey: ['meta-ads'], exact: false });
    }
  }, [syncStatus?.lastSyncedAt, refetch, queryClient]);

  const handleSync = useCallback(async () => {
    if (cooldownRemaining > 0 || syncMutation.isPending) return;
    const toastId = toast.loading('Refreshing Meta Ads...');
    try {
      const result = await syncMutation.mutateAsync();
      if (result?.ok === false && result?.cooldownRemainingSeconds > 0) {
        applyCooldown(result.cooldownRemainingSeconds);
        toast.update(toastId, 'Please wait ' + result.cooldownRemainingSeconds + ' seconds before refreshing again.', 'error');
      } else if (result?.started) {
        // Background sync started — don't await completion, just apply cooldown and poll
        applyCooldown(120);
        toast.update(toastId, 'Your latest Meta Ads results will appear here shortly.', 'success');
      } else {
        // Synchronous fallback completed
        applyCooldown(120);
        toast.update(toastId, 'Meta Ads results are up to date.', 'success');
        await queryClient.invalidateQueries({ queryKey: ['meta-ads'], exact: false });
        await refetch();
        await refetchSyncStatus();
      }
    } catch (err) {
      toast.update(toastId, err instanceof Error ? err.message : 'Could not refresh Meta Ads results. Please try again.', 'error');
    }
  }, [cooldownRemaining, syncMutation, toast, refetch, refetchSyncStatus, applyCooldown, queryClient]);

  const summary = data?.summary || {};
  const summaryCurrency = String(summary.currency || metaAdsSettings?.displayCurrencyCode || 'BDT').toUpperCase();
  const mixedCurrencies = Boolean(summary.mixedCurrencies);
  const metricWindowLabel = summary.metricsWindow === 'lifetime' ? 'lifetime' : 'selected date range';
  const lastSyncedLabel = syncStatus?.lastSyncedAt ? formatDateTime(syncStatus.lastSyncedAt) : null;

  if (settingsPending && !metaAdsSettings) {
    return <div className="h-64 animate-pulse rounded-xl border border-gray-100 bg-white" aria-label="Loading Meta Ads settings" />;
  }

  if (!isMetaAdsConfigured) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50">
            <svg className="h-7 w-7 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M3 8.25h3.75M3 12h3.75m-3.75 3.75h3.75m4.5-10.5h5.25m-5.25 3.75h5.25m-5.25 3.75h5.25M3.75 6H20.25M3.75 18H20.25" /></svg>
          </div>
          <h2 className="text-lg font-black text-gray-900">Meta Ads Not Configured</h2>
          <p className="mt-2 text-sm text-gray-500">Set up your Meta App ID and credentials in Settings before using Meta Ads.</p>
          <button onClick={() => navigate('/settings?tab=meta-ads')} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#0f2f57] px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white hover:bg-[#143b6d] transition-colors">
            Go to Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex-1">
          <FilterBar
            filterRange={filterRange}
            setFilterRange={handleFilterRangeChange}
            customDates={customDates}
            setCustomDates={handleCustomDatesChange}
            compact
            ranges={['All Time', 'Today', 'Last 7 days', 'Last 30 days', 'Custom']}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] font-semibold text-gray-500">
            <span>{isPending && !data ? 'Loading ads…' : `${formatNumber(summary.totalAds ?? ads.length)} matching ads`}</span>
            <span aria-hidden="true">·</span>
            <span>Cards show {metricWindowLabel} metrics</span>
            {lastSyncedLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span>Synced {lastSyncedLabel}</span>
              </>
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={handleSync}
          loading={syncMutation.isPending}
          disabled={cooldownRemaining > 0}
          icon={<RefreshCw size={18} className={cooldownRemaining > 0 ? 'animate-spin' : ''} />}
        >
          {cooldownRemaining > 0 ? `Cooldown ${Math.floor(cooldownRemaining / 60)}:${String(cooldownRemaining % 60).padStart(2, '0')} ` : 'Sync Meta'}
        </Button>
      </div>

      <div className="min-w-0 flex-1">
        <DynamicFilterBar
          filterDefinitions={filterDefinitions}
          initialFilters={dynamicFilters}
          freeTextLabel="Ad Name"
          onApply={applyDynamicFilters}
          className="w-full"
        />
      </div>

      {mixedCurrencies && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span>
            Matching ads use multiple currencies ({(summary.currencies || []).join(', ')}). Combined spend and ROAS are hidden; filter to one ad account for comparable money metrics.
          </span>
        </div>
      )}
      {isPending && !data ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5" aria-label="Loading Meta Ads summary">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-xl border border-gray-100 bg-white" />
          ))}
        </div>
      ) : error && !data ? null : (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Active Campaigns" value={summary.activeCampaigns ?? 0} icon={<BarChart3 size={18} />} hint="Active campaigns in the filtered ad set" />
        <MetricCard label="Active Ad Sets" value={summary.activeAdSets ?? 0} icon={ICONS.Banking} hint="Active ad sets in the filtered ad set" />
        <MetricCard label="Active Ads" value={summary.activeAds ?? 0} icon={ICONS.Check} hint="Matching ads currently active" />
        <MetricCard
          label={summary.metricsWindow === 'lifetime' ? 'Lifetime Spend' : 'Range Spend'}
          value={mixedCurrencies ? '—' : <MetaAdsMoney amount={summary.filteredSpend ?? 0} nativeCode={summaryCurrency} />}
          icon={ICONS.Reports}
          hint={summary.metricsWindow === 'lifetime' ? 'Lifetime total reported by Meta' : 'Spend inside the selected date range'}
        />
        <MetricCard
          label={summary.metricsWindow === 'lifetime' ? 'Lifetime Purchase ROAS' : 'Range Purchase ROAS'}
          value={summary.currentRoas == null ? '—' : `${Number(summary.currentRoas).toFixed(2)}x`}
          hint={mixedCurrencies
            ? 'Unavailable across mixed currencies'
            : Number(summary.filteredSpend || 0) <= 0
              ? 'No spend in this period'
              : summary.currentRoas == null
                ? 'Unavailable until purchase-value insights are synced'
                : 'Purchase value ÷ spend; spend-weighted, not an ad average'}
        />
      </div>
      )}

      {error && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
          <span>{error.message}</span>
          <button type="button" onClick={() => refetch()} className="shrink-0 underline">Retry</button>
        </div>
      )}

      {isPending ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-60 animate-pulse rounded-xl border border-gray-100 bg-white" />
          ))}
        </div>
      ) : error && ads.length === 0 ? null : ads.length === 0 ? (
        <Card elevated className="p-8 text-center">
          <p className="text-sm font-semibold text-gray-500">No Meta ads found for the selected filters.</p>
          <p className="mt-1 text-xs text-gray-400">Try All Time, clear a filter, or sync Meta to refresh daily insights.</p>
        </Card>
      ) : (
        <>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {ads.map((ad: any) => (
            <button
              type="button"
              key={ad.id}
              onClick={() => navigate(`/meta-ads/${ad.id}`, {
                state: {
                  from: '/meta-ads',
                  backLabel: 'Meta Ads',
                  metaAdsListState: { queryFilters, dynamicFilters, filterRange, customDates },
                },
              })}
              className="group overflow-hidden rounded-xl border border-gray-100 bg-white text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
            >
              <div className="relative aspect-[16/9] bg-gray-100">
                {ad.imageUrl || ad.thumbnailUrl ? (
                  <img src={ad.imageUrl || ad.thumbnailUrl} alt={ad.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-gray-300">{ICONS.Bell}</div>
                )}
                <span className={`absolute top-2 right-2 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${statusBadgeClass(ad.status)}`}>
                  {prettyStatus(ad.status)}
                </span>
              </div>
              <div className="p-3">
                <h3 className="line-clamp-1 text-sm font-bold text-gray-900">{ad.name}</h3>
                <p className="mt-0.5 line-clamp-1 text-xs text-gray-500">{ad.campaignName || 'No campaign'}</p>
                {ad.objective && (
                  <div className="mt-2 inline-flex flex-wrap gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-700">
                      {prettyStatus(ad.objective)}
                    </span>
                  </div>
                )}
                <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-gray-100 pt-2.5 text-center sm:grid-cols-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Spend</p>
                    <p className="text-sm font-bold text-gray-900"><MetaAdsMoney amount={ad.spend ?? 0} nativeCode={ad.adAccountCurrency} compact /></p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Impressions</p>
                    <p className="text-sm font-bold text-gray-900">{formatNumber(ad.impressions ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Clicks</p>
                    <p className="text-sm font-bold text-gray-900">{formatNumber(ad.clicks ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400" title="Click-Through Rate">CTR</p>
                    <p className="text-sm font-bold text-gray-900">{Number(ad.ctr ?? 0).toFixed(2)}%</p>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
        {(summary.totalAds ?? 0) > ads.length && (
          <p className="text-center text-xs font-semibold text-amber-700">
            Showing the first {formatNumber(ads.length)} of {formatNumber(summary.totalAds)} matching ads. Narrow the filters to see a specific ad.
          </p>
        )}
        </>
      )}
    </div>
  );
};


type AdDetailsTab = 'overview' | 'audience' | 'placements' | 'trends' | 'creative' | 'raw';

const TabButton: React.FC<{ label: string; active: boolean; onClick: () => void; icon?: React.ReactNode }> = ({ label, active, onClick, icon }) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold ${theme.transitions.colors} ${
      active
        ? `${theme.colors.primary[600]} text-white ${theme.colors.primary.shadow}`
        : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700'
    }`}
  >
    {icon}
    {label}
  </button>
);

const MetaAdDetails: React.FC<{ id: string }> = ({ id }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = getPreservedRouteState(location.state);
  const backLabel = navState.backLabel ? `Back to ${navState.backLabel}` : 'Back to Meta Ads';
  const backLink = navState.from || '/meta-ads';
  const handleBack = () => navigate(backLink, { state: location.state });
  const { data: ad, isPending, error } = useMetaAd(id);
  const [activeTab, setActiveTab] = useState<AdDetailsTab>('overview');
  const [filterRange, setFilterRange] = useState<FilterRange>('All Time');
  const [customDates, setCustomDates] = useState({ from: '', to: '' });

  const { data: dailyData, isPending: dailyPending } = useMetaAdInsightsDaily(id);
  const { data: demographicsData } = useMetaAdInsightsDemographics(id, activeTab === 'audience');
  const { data: placementsData } = useMetaAdInsightsPlacements(id, activeTab === 'placements');
  const { data: devicesData } = useMetaAdInsightsDevices(id, activeTab === 'placements');

  const dailyInsights: any[] = dailyData?.data || [];
  const demographicsInsights: any[] = demographicsData?.data || [];
  const placementsInsights: any[] = placementsData?.data || [];
  const devicesInsights: any[] = devicesData?.data || [];

  const detailDateRange = getDateRange(filterRange, customDates);
  const isDateFiltered = Boolean(detailDateRange.from || detailDateRange.to);
  const filteredDailyInsights = useMemo(() => filterByDateRange(dailyInsights, detailDateRange), [dailyInsights, detailDateRange.from, detailDateRange.to]);

  const metrics = ad?.metrics || {};

  // Compute KPIs from filtered daily insights when a date range is active
  const filteredMetrics = useMemo(() => {
    if (!isDateFiltered) return null;
    const agg = { spend: 0, impressions: 0, clicks: 0, reach: 0, conversions: 0, purchaseValue: 0 };
    let purchaseMetricRows = 0;
    filteredDailyInsights.forEach((row: any) => {
      agg.spend += row.spend || 0;
      agg.impressions += row.impressions || 0;
      agg.clicks += row.clicks || 0;
      agg.reach += row.reach || 0;
      agg.conversions += row.conversions || 0;
      if (Object.prototype.hasOwnProperty.call(row, 'purchaseValue')) {
        agg.purchaseValue += Number(row.purchaseValue || 0);
        purchaseMetricRows += 1;
      } else if (row.roas != null) {
        agg.purchaseValue += Number(row.spend || 0) * Number(row.roas || 0);
        purchaseMetricRows += 1;
      }
    });
    const ctr = agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0;
    const roas = agg.spend > 0 && purchaseMetricRows === filteredDailyInsights.length
      ? agg.purchaseValue / agg.spend
      : null;
    return { ...agg, ctr, roas, results: null, reachIsSummed: true };
  }, [isDateFiltered, filteredDailyInsights]);

  const displayMetrics = filteredMetrics || metrics;
  const dateMetricsLoading = isDateFiltered && dailyPending;

  const dailyError: string | undefined = dailyData?.error;
  const demographicsError: string | undefined = demographicsData?.error;
  const placementsError: string | undefined = placementsData?.error;
  const devicesError: string | undefined = devicesData?.error;

  if (isPending) {
    return <div className="min-h-[40vh] rounded-xl border border-gray-100 bg-white p-8 text-center text-sm font-semibold text-gray-500">Loading ad details...</div>;
  }

  if (error || !ad) {
    return (
      <Card elevated className="p-8 text-center">
        <p className="text-sm font-semibold text-red-600">{error?.message || 'Meta ad not found.'}</p>
        <Button type="button" variant="outline" className="mt-4" onClick={handleBack}>{backLabel}</Button>
      </Card>
    );
  }

  const updated = formatDateTimeParts(ad.updatedAt || ad.lastSyncedAt);
  const creative = ad.creative || {};
  const rawMetrics = Object.entries(metrics.raw || {}).filter(([, value]) => Array.isArray(value) || (value !== null && typeof value === 'object'));

  const handleFilterRangeChange = (nextRange: FilterRange) => {
    setFilterRange(nextRange);
    if (nextRange === 'Custom' && !customDates.from && !customDates.to) {
      setCustomDates(getDateRange('Today', customDates));
    }
  };

  const handleCustomDatesChange = (nextCustomDates: { from: string; to: string }) => {
    setCustomDates(nextCustomDates);
  };

  const ageGroups: Record<string, { impressions: number; clicks: number; spend: number; conversions: number }> = {};
  const genderTotals: Record<string, { impressions: number; clicks: number; spend: number }> = {};
  demographicsInsights.forEach((row: any) => {
    const age = row.age || 'Unknown';
    if (!ageGroups[age]) ageGroups[age] = { impressions: 0, clicks: 0, spend: 0, conversions: 0 };
    ageGroups[age].impressions += row.impressions || 0;
    ageGroups[age].clicks += row.clicks || 0;
    ageGroups[age].spend += row.spend || 0;
    ageGroups[age].conversions += row.conversions || 0;
    const gender = row.gender || 'Unknown';
    if (!genderTotals[gender]) genderTotals[gender] = { impressions: 0, clicks: 0, spend: 0 };
    genderTotals[gender].impressions += row.impressions || 0;
    genderTotals[gender].clicks += row.clicks || 0;
    genderTotals[gender].spend += row.spend || 0;
  });
  const ageChartData = Object.entries(ageGroups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([age, d]) => ({ age, ...d }));

  const platformTotals: Record<string, { impressions: number; clicks: number; spend: number }> = {};
  placementsInsights.forEach((row: any) => {
    const platform = row.platform || 'Unknown';
    if (!platformTotals[platform]) platformTotals[platform] = { impressions: 0, clicks: 0, spend: 0 };
    platformTotals[platform].impressions += row.impressions || 0;
    platformTotals[platform].clicks += row.clicks || 0;
    platformTotals[platform].spend += row.spend || 0;
  });
  const platformChartData = Object.entries(platformTotals).map(([platform, d]) => ({ platform, ...d }));

  const tabItems: { key: AdDetailsTab; label: string; icon?: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <BarChart3 size={14} /> },
    { key: 'audience', label: 'Audience', icon: <Users size={14} /> },
    { key: 'placements', label: 'Placements', icon: <LayoutGrid size={14} /> },
    { key: 'trends', label: 'Trends', icon: <TrendingUp size={14} /> },
    { key: 'creative', label: 'Creative', icon: <ImageIcon size={14} /> },
    { key: 'raw', label: 'Raw Data', icon: <FileJson size={14} /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-semibold text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900"
        >
          <ArrowLeft size={16} />
          {backLabel}
        </button>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-black text-gray-900">{ad.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${statusBadgeClass(ad.status)}`}>{prettyStatus(ad.status)}</span>
              {ad.campaignName && <span className="text-xs font-semibold text-gray-500">{ad.campaignName}</span>}
              {ad.adAccountCurrency && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">{ad.adAccountCurrency}</span>}
            </div>
          </div>
          <p className="text-xs text-gray-400">Last synced {updated.date || '-'} at {updated.time}</p>
        </div>
      </div>

      <Card elevated className="p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-2">
            <Calendar size={17} className="mt-0.5 shrink-0 text-blue-600" />
            <div>
              <p className="text-sm font-black text-gray-900">Performance period</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Applies to the KPI cards and Trends. Audience and placement breakdowns remain lifetime views. Daily history covers the latest 90 days.
              </p>
            </div>
          </div>
          <FilterBar
            filterRange={filterRange}
            setFilterRange={handleFilterRangeChange}
            customDates={customDates}
            setCustomDates={handleCustomDatesChange}
            compact
            ranges={['All Time', 'Today', 'Last 7 days', 'Last 30 days', 'Custom']}
          />
        </div>
      </Card>

      {isDateFiltered && !dailyPending && filteredDailyInsights.length === 0 && (
        <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-800">
          No daily insights were found in this period. Range metrics are shown as zero or unavailable—not replaced with lifetime totals.
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label={isDateFiltered ? 'Range Spend' : 'Lifetime Spend'} value={dateMetricsLoading ? '…' : <MetaAdsMoney amount={displayMetrics.spend || 0} nativeCode={ad.adAccountCurrency} />} icon={ICONS.Reports} hint={isDateFiltered ? 'Spend in selected period' : 'Lifetime spend reported by Meta'} />
        <MetricCard label="Impressions" value={dateMetricsLoading ? '…' : formatNumber(displayMetrics.impressions)} icon={<BarChart3 size={18} />} hint={isDateFiltered ? 'Impressions in selected period' : 'Times your ad was shown'} />
        <MetricCard label="Clicks" value={dateMetricsLoading ? '…' : formatNumber(displayMetrics.clicks)} icon={<MousePointerClick size={18} />} hint="All clicks reported by Meta" />
        <MetricCard label="CTR" value={dateMetricsLoading ? '…' : `${Number(displayMetrics.ctr || 0).toFixed(2)}%`} hint="Clicks ÷ impressions" />
        <MetricCard label="Purchase ROAS" value={dateMetricsLoading ? '…' : displayMetrics.roas == null ? '—' : `${Number(displayMetrics.roas).toFixed(2)}x`} hint="Meta purchase value ÷ spend" />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-gray-100 pb-3">
        {tabItems.map((tab) => (
          <TabButton key={tab.key} label={tab.label} active={activeTab === tab.key} onClick={() => setActiveTab(tab.key)} icon={tab.icon} />
        ))}
      </div>

      {/* OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <Card elevated className="p-5">
              <h2 className="text-lg font-black text-gray-900">Ad Details</h2>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Campaign" value={ad.campaignName || '-'} />
                <Field label="Ad Set" value={ad.adSetName || '-'} />
                <Field label="Objective" value={ad.objective ? prettyStatus(ad.objective) : '-'} />
                <Field label="Ad Account" value={ad.adAccountName || '-'} />
                <Field label="Daily Budget" value={ad.budget?.dailyBudget == null ? '-' : <MetaAdsMoney amount={ad.budget.dailyBudget} nativeCode={ad.adAccountCurrency} />} />
                <Field label="Lifetime Budget" value={ad.budget?.lifetimeBudget == null ? '-' : <MetaAdsMoney amount={ad.budget.lifetimeBudget} nativeCode={ad.adAccountCurrency} />} />
                <Field label="Start Date" value={ad.startAt ? formatDate(ad.startAt) : '-'} />
                <Field label="End Date" value={ad.endAt ? formatDate(ad.endAt) : '-'} />
                <Field label="Created" value={ad.createdAt ? formatDate(ad.createdAt) : '-'} />
                <Field label="Business" value={ad.businessName || '-'} />
              </div>
            </Card>
            <Card elevated className="overflow-hidden">
              {(creative.imageUrl || creative.thumbnailUrl) ? (
                <div className="aspect-[16/9] bg-gray-100">
                  <img src={creative.imageUrl || creative.thumbnailUrl} alt={ad.name} className="h-full w-full object-cover" />
                </div>
              ) : creative.videoUrl ? (
                <div className="aspect-[16/9] bg-gray-100">
                  <video src={creative.videoUrl} controls className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="flex aspect-[16/9] items-center justify-center bg-gray-100 text-gray-300">{ICONS.Bell}</div>
              )}
              <div className="space-y-3 p-5">
                <h2 className="text-lg font-black text-gray-900">Creative Preview</h2>
                {creative.primaryText && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Primary Text</p>
                    <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap overflow-hidden text-ellipsis line-clamp-3">{creative.primaryText}</p>
                    {creative.primaryText.length > 240 && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('creative')}
                        className="mt-2 text-sm font-bold text-blue-600 hover:text-blue-800"
                      >
                        ... See More
                      </button>
                    )}
                  </div>
                )}
                {creative.headline && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Headline</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">{creative.headline}</p>
                  </div>
                )}
                {creative.description && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Description</p>
                    <p className="mt-1 text-sm text-gray-600">{creative.description}</p>
                  </div>
                )}
                {creative.callToAction && (
                  <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                    {creative.callToAction}
                  </div>
                )}
              </div>
            </Card>
          </div>
          <Card elevated className="p-5">
            <h2 className="text-lg font-black text-gray-900">More Metrics</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <CompactMetric
                label={displayMetrics.reachIsSummed ? 'Daily Reach Total' : 'Reach'}
                value={dateMetricsLoading ? '…' : formatNumber(displayMetrics.reach)}
                hint={displayMetrics.reachIsSummed ? 'Daily reach added together; people may repeat across days' : 'People reached for this lifetime ad insight'}
              />
              <CompactMetric label="CPC" value={dateMetricsLoading ? '…' : displayMetrics.clicks > 0 ? <MetaAdsMoney amount={displayMetrics.spend / displayMetrics.clicks} nativeCode={ad.adAccountCurrency} /> : '—'} hint="Spend ÷ clicks" />
              <CompactMetric label="CPM" value={dateMetricsLoading ? '…' : displayMetrics.impressions > 0 ? <MetaAdsMoney amount={(displayMetrics.spend / displayMetrics.impressions) * 1000} nativeCode={ad.adAccountCurrency} /> : '—'} hint="Spend per 1,000 impressions" />
              <CompactMetric label="Conversions" value={dateMetricsLoading || displayMetrics.conversions == null ? '—' : formatNumber(displayMetrics.conversions)} hint="Prioritized purchase or lead action reported by Meta" />
              <CompactMetric label="Reported Result" value={isDateFiltered || displayMetrics.results == null ? '—' : formatNumber(displayMetrics.results)} hint={isDateFiltered ? 'Not available from daily range insights' : 'Prioritized action stored from Meta'} />
            </div>
            {ad.placements && Object.keys(ad.placements).length > 0 && (
              <div className="mt-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Placements</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {Object.entries(ad.placements).map(([key, value]) => (
                    <span key={key} className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">
                      {typeof value === 'string' ? value : key}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* AUDIENCE */}
      {activeTab === 'audience' && (
        <div className="space-y-6">
          {demographicsInsights.length === 0 ? (
            <Card elevated className="p-8 text-center">
              <Users size={32} className="mx-auto text-gray-300" />
              <p className="mt-3 text-sm font-semibold text-gray-500">No demographic data available yet.</p>
              {demographicsError ? (
                <p className="mt-1 text-xs text-red-400">Failed to load: {demographicsError}</p>
              ) : (
                <p className="mt-1 text-xs text-gray-400">Demographics are populated when Meta Ads insights are synced. Try syncing from Settings.</p>
              )}
            </Card>
          ) : (
            <>
              <Card elevated className="p-5">
                <h2 className="text-lg font-black text-gray-900">Age Group Performance</h2>
                <div className="mt-4 overflow-hidden rounded-xl border border-gray-100">
                  <table className="min-w-full divide-y divide-gray-100 text-left text-sm">
                    <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                      <tr>
                        <th className="px-3 py-3">Age Group</th>
                        <th className="px-3 py-3 text-right">Impressions</th>
                        <th className="px-3 py-3 text-right">Clicks</th>
                        <th className="px-3 py-3 text-right">Spend</th>
                        <th className="px-3 py-3 text-right">Conversions</th>
                        <th className="px-3 py-3 text-right" title="Click-Through Rate">CTR</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {ageChartData.map((row) => (
                        <tr key={row.age}>
                          <td className="px-3 py-2.5 font-bold text-gray-900">{row.age}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700">{formatNumber(row.impressions)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700">{formatNumber(row.clicks)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700"><MetaAdsMoney amount={row.spend} nativeCode={ad.adAccountCurrency} /></td>
                          <td className="px-3 py-2.5 text-right text-gray-700">{formatNumber(row.conversions)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700">{row.impressions > 0 ? ((row.clicks / row.impressions) * 100).toFixed(2) : '0.00'}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card elevated className="p-5">
                <h2 className="text-lg font-black text-gray-900">Gender Breakdown</h2>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(genderTotals).map(([gender, data]) => (
                    <div key={gender} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                      <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{prettyStatus(gender)}</p>
                      <p className="mt-2 text-xl font-black text-gray-900">{formatNumber(data.impressions)} impressions</p>
                      <p className="mt-1 text-sm text-gray-600">{formatNumber(data.clicks)} clicks</p>
                      <p className="mt-0.5 text-sm text-gray-600"><MetaAdsMoney amount={data.spend} nativeCode={ad.adAccountCurrency} /> spent</p>
                    </div>
                  ))}
                </div>
              </Card>
              {ageChartData.length > 0 && (
                <Card elevated className="p-5">
                  <h2 className="text-lg font-black text-gray-900">Impressions by Age Group</h2>
                  <div className="mt-4" style={{ height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={ageChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="age" tick={{ fontSize: 11, fill: '#6b7280' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} tickFormatter={(v: number) => Number(v / 1000).toFixed(0) + 'k'} />
                        <Tooltip formatter={(value: any, name?: string) => [formatNumber(Number(value)), prettyStatus(String(name || ''))]} />
                        <Legend />
                        <Bar dataKey="impressions" name="Impressions" fill="#2563eb" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="clicks" name="Clicks" fill="#16a34a" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* PLACEMENTS */}
      {activeTab === 'placements' && (
        <div className="space-y-6">
          {placementsInsights.length === 0 && devicesInsights.length === 0 ? (
            <Card elevated className="p-8 text-center">
              <LayoutGrid size={32} className="mx-auto text-gray-300" />
              <p className="mt-3 text-sm font-semibold text-gray-500">No placement data available yet.</p>
              {(placementsError || devicesError) ? (
                <p className="mt-1 text-xs text-red-400">Failed to load: {placementsError || devicesError}</p>
              ) : (
                <p className="mt-1 text-xs text-gray-400">Placement data is populated when Meta Ads insights are synced.</p>
              )}
            </Card>
          ) : (
            <>
              {platformChartData.length > 0 && (
                <Card elevated className="p-5">
                  <h2 className="text-lg font-black text-gray-900">Platform Performance</h2>
                  <div className="mt-4 overflow-hidden rounded-xl border border-gray-100">
                    <table className="min-w-full divide-y divide-gray-100 text-left text-sm">
                      <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                        <tr>
                          <th className="px-3 py-3">Platform</th>
                          <th className="px-3 py-3 text-right">Impressions</th>
                          <th className="px-3 py-3 text-right">Clicks</th>
                          <th className="px-3 py-3 text-right">Spend</th>
                          <th className="px-3 py-3 text-right" title="Click-Through Rate">CTR</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {platformChartData.map((row) => (
                          <tr key={row.platform}>
                            <td className="px-3 py-2.5 font-bold text-gray-900">{prettyStatus(row.platform)}</td>
                            <td className="px-3 py-2.5 text-right text-gray-700">{formatNumber(row.impressions)}</td>
                            <td className="px-3 py-2.5 text-right text-gray-700">{formatNumber(row.clicks)}</td>
                            <td className="px-3 py-2.5 text-right text-gray-700"><MetaAdsMoney amount={row.spend} nativeCode={ad.adAccountCurrency} /></td>
                            <td className="px-3 py-2.5 text-right text-gray-700">{row.impressions > 0 ? ((row.clicks / row.impressions) * 100).toFixed(2) : '0.00'}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
              {placementsInsights.length > 0 && (
                <Card elevated className="p-5">
                  <h2 className="text-lg font-black text-gray-900">Placement Breakdown</h2>
                  <div className="mt-4 overflow-hidden rounded-xl border border-gray-100">
                    <table className="min-w-full divide-y divide-gray-100 text-left text-sm">
                      <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                        <tr>
                          <th className="px-3 py-3">Platform</th>
                          <th className="px-3 py-3">Position</th>
                          <th className="px-3 py-3 text-right">Impressions</th>
                          <th className="px-3 py-3 text-right">Clicks</th>
                          <th className="px-3 py-3 text-right">Spend</th>
                          <th className="px-3 py-3 text-right" title="Click-Through Rate">CTR</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white">
                        {placementsInsights.map((row: any, i: number) => (
                          <tr key={i}>
                            <td className="px-3 py-2.5 font-bold text-gray-900">{prettyStatus(row.platform)}</td>
                            <td className="px-3 py-2.5 text-gray-600">{prettyStatus(row.position)}</td>
                            <td className="px-3 py-2.5 text-right text-gray-700">{formatNumber(row.impressions)}</td>
                            <td className="px-3 py-2.5 text-right text-gray-700">{formatNumber(row.clicks)}</td>
                            <td className="px-3 py-2.5 text-right text-gray-700"><MetaAdsMoney amount={row.spend} nativeCode={ad.adAccountCurrency} /></td>
                            <td className="px-3 py-2.5 text-right text-gray-700">{Number(row.ctr || 0).toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}
              {devicesInsights.length > 0 && (
                <Card elevated className="p-5">
                  <h2 className="text-lg font-black text-gray-900">Device Breakdown</h2>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {devicesInsights.map((row: any, i: number) => (
                      <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                        <div className="flex items-center gap-2">
                          <Monitor size={16} className="text-gray-400" />
                          <p className="text-sm font-bold text-gray-900">{prettyStatus(row.device)}</p>
                        </div>
                        <p className="mt-2 text-xl font-black text-gray-900">{formatNumber(row.impressions)}</p>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">impressions</p>
                        <p className="mt-1 text-sm text-gray-600">{formatNumber(row.clicks)} clicks</p>
                        <p className="text-sm text-gray-600"><MetaAdsMoney amount={row.spend} nativeCode={ad.adAccountCurrency} /> spent</p>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* TRENDS */}
      {activeTab === 'trends' && (
        <div className="space-y-6">
          {filteredDailyInsights.length === 0 ? (
            <Card elevated className="p-8 text-center">
              <TrendingUp size={32} className="mx-auto text-gray-300" />
              <p className="mt-3 text-sm font-semibold text-gray-500">No daily trend data available yet.</p>
              {dailyError ? (
                <p className="mt-1 text-xs text-red-400">Failed to load: {dailyError}</p>
              ) : (
                <p className="mt-1 text-xs text-gray-400">Daily trends are populated when Meta Ads insights are synced.</p>
              )}
            </Card>
          ) : (
            <>
              <Card elevated className="p-4 pt-5 pb-0">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Over time</p>
                  <h2 className="mt-1 text-lg font-black text-gray-900">Spend &amp; Engagement</h2>
                </div>
                <div className="mt-4" style={{ height: 300 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={filteredDailyInsights} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(val: string) => formatDate(val)} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(v: number) => Number(v / 1000).toFixed(0) + 'k'} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <Tooltip labelFormatter={(label: any) => formatDate(String(label))} formatter={(value: any, name?: string) => { if (name === 'impressions' || name === 'clicks' || name === 'reach') return [formatNumber(Number(value)), prettyStatus(String(name || ''))]; return [formatMetaAdsCurrency(Number(value), ad.adAccountCurrency || 'USD'), prettyStatus(String(name || ''))]; }} />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="spend" name="Spend" stroke="#2563eb" strokeWidth={2} dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="impressions" name="Impressions" stroke="#16a34a" strokeWidth={2} dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="clicks" name="Clicks" stroke="#f59e0b" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card elevated className="p-4 pt-5 pb-0">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Efficiency</p>
                  <h2 className="mt-1 text-lg font-black text-gray-900">CTR &amp; CPC Over Time</h2>
                </div>
                <div className="mt-4" style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={filteredDailyInsights} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(val: string) => formatDate(val)} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={(v: number) => v + '%'} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <Tooltip labelFormatter={(label: any) => formatDate(String(label))} formatter={(value: any, name?: string) => { if (name === 'ctr') return [`${Number(value).toFixed(2)}%`, 'CTR (Click-Through Rate)']; if (name === 'cpc') return [formatMetaAdsCurrency(Number(value), ad.adAccountCurrency || 'USD'), 'CPC (Cost Per Click)']; return [formatMetaAdsCurrency(Number(value), ad.adAccountCurrency || 'USD'), prettyStatus(String(name || ''))]; }} />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="ctr" name="CTR" stroke="#8b5cf6" strokeWidth={2} dot={false} />
                      <Line yAxisId="right" type="monotone" dataKey="cpc" name="CPC" stroke="#ef4444" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </>
          )}
        </div>
      )}

      {/* CREATIVE */}
      {activeTab === 'creative' && (
        <div className="space-y-6">
          <Card elevated className="overflow-hidden">
            {(creative.imageUrl || creative.thumbnailUrl) ? (
              <div className="aspect-[16/9] bg-gray-100">
                <img src={creative.imageUrl || creative.thumbnailUrl} alt={ad.name} className="h-full w-full object-cover" />
              </div>
            ) : creative.videoUrl ? (
              <div className="aspect-[16/9] bg-gray-100">
                <video src={creative.videoUrl} controls className="h-full w-full object-cover" />
              </div>
            ) : (
              <div className="flex aspect-[16/9] items-center justify-center bg-gray-100 text-gray-300"><ImageIcon size={48} /></div>
            )}
            <div className="space-y-4 p-5">
              <h2 className="text-lg font-black text-gray-900">Creative Details</h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {creative.primaryText && (
                  <div className="sm:col-span-2">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Primary Text</p>
                    <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">{creative.primaryText}</p>
                  </div>
                )}
                {creative.headline && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Headline</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">{creative.headline}</p>
                  </div>
                )}
                {creative.description && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Description</p>
                    <p className="mt-1 text-sm text-gray-600">{creative.description}</p>
                  </div>
                )}
                {creative.callToAction && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Call to Action</p>
                    <div className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">{creative.callToAction}</div>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* RAW DATA */}
      {activeTab === 'raw' && (
        <div className="space-y-6">
          <Card elevated className="p-5">
            <h2 className="text-lg font-black text-gray-900">Insights Summary (JSON)</h2>
            <pre className="mt-4 max-h-96 overflow-auto rounded-xl bg-gray-950 p-4 text-xs font-semibold text-gray-100">{JSON.stringify(metrics.raw, null, 2)}</pre>
          </Card>
          {ad.raw && Object.keys(ad.raw).length > 0 && (
            <Card elevated className="p-5">
              <h2 className="text-lg font-black text-gray-900">Full Ad Object (JSON)</h2>
              <pre className="mt-4 max-h-96 overflow-auto rounded-xl bg-gray-950 p-4 text-xs font-semibold text-gray-100">{JSON.stringify(ad.raw, null, 2)}</pre>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

const MetaAds: React.FC = () => {
  const params = useParams();
  if (params.id) {
    return <MetaAdDetails id={params.id} />;
  }
  return <MetaAdsList />;
};

export default MetaAds;
