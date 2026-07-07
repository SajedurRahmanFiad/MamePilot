import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BarChart3, MousePointerClick, RefreshCw } from 'lucide-react';
import { Card, Button } from '../components';
import DynamicFilterBar from '../components/DynamicFilterBar';
import FilterBar, { type FilterRange } from '../components/FilterBar';
import { formatCurrency, ICONS } from '../constants';
import { formatDate, formatDateTimeParts } from '../utils';
import { useMetaAd, useMetaAds, useMetaAdsSyncCache } from '../src/hooks/useQueries';
import { useToastNotifications } from '../src/contexts/ToastContext';

const statusBadgeClass = (status?: string | null): string => {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'ACTIVE') return 'bg-emerald-100 text-emerald-700';
  if (normalized === 'PAUSED') return 'bg-amber-100 text-amber-700';
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

const MetricCard: React.FC<{ label: string; value: string | number; hint?: string; icon?: React.ReactNode }> = ({ label, value, hint, icon }) => (
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

const Field: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
    <div className="mt-1 break-words text-sm font-bold text-gray-900">{value || '-'}</div>
  </div>
);


const MetaAdsList: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToastNotifications();
  const [queryFilters, setQueryFilters] = useState({
    businessId: '',
    businessOperator: '=',
    adAccountId: '',
    adAccountOperator: '=',
    campaignId: '',
    campaignOperator: '=',
    status: '',
    statusOperator: '=',
    from: '',
    to: '',
    search: '',
    searchOperator: 'contains',
  });
  const [dynamicFilters, setDynamicFilters] = useState<any[]>([]);
  const [filterRange, setFilterRange] = useState<FilterRange>('All Time');
  const [customDates, setCustomDates] = useState({ from: '', to: '' });
  const { data, isPending, error, refetch } = useMetaAds(queryFilters);
  const { refetch: refetchSyncCache, isFetching: isFetchingSyncCache } = useMetaAdsSyncCache(false);

  const filterOptions = data?.filters || { businesses: [], adAccounts: [], campaigns: [], statuses: [] };
  const ads = useMemo(() => data?.ads || [], [data?.ads]);
  const selectedBusinessId = useMemo(() => dynamicFilters.find((filter) => filter.type === 'Business')?.value || '', [dynamicFilters]);
  const selectedAdAccountId = useMemo(() => dynamicFilters.find((filter) => filter.type === 'Ad Account')?.value || '', [dynamicFilters]);

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
    const adNames = Array.from(new Set((ads || []).map((ad: any) => String(ad.name || '').trim()).filter(Boolean))).map((name) => ({ value: name, label: name }));

    return [
      { type: 'Business', operators: ['=', '≠'] as const, values: businesses, defaultOperator: '=' as const },
      { type: 'Ad Account', operators: ['=', '≠'] as const, values: accounts, defaultOperator: '=' as const },
      { type: 'Campaign', operators: ['=', '≠'] as const, values: campaignOptions, defaultOperator: '=' as const },
      { type: 'Status', operators: ['=', '≠'] as const, values: statuses, defaultOperator: '=' as const },
      { type: 'Ad Name', operators: ['=', '≠', 'contains'] as const, values: adNames, defaultOperator: 'contains' as const, allowCustomValue: true },
    ];
  }, [adAccounts, campaigns, filterOptions.businesses, filterOptions.statuses, ads]);

  const applyDynamicFilters = (nextFilters: any[]) => {
    const normalizedFilters = nextFilters.filter((filter) => ['Business', 'Ad Account', 'Campaign', 'Status', 'Ad Name'].includes(filter.type));
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

  const applyDateRange = (nextRange: FilterRange, nextCustomDates: { from: string; to: string }) => {
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const yearStart = new Date(today.getFullYear(), 0, 1);

    const buildBoundary = (date: Date) => date.toISOString().slice(0, 10);

    let from = '';
    let to = '';

    if (nextRange === 'Today') {
      from = todayIso;
      to = todayIso;
    } else if (nextRange === 'This Week') {
      from = buildBoundary(weekStart);
      to = todayIso;
    } else if (nextRange === 'This Month') {
      from = buildBoundary(monthStart);
      to = todayIso;
    } else if (nextRange === 'This Year') {
      from = buildBoundary(yearStart);
      to = todayIso;
    } else if (nextRange === 'Custom') {
      from = nextCustomDates.from;
      to = nextCustomDates.to;
    }

    setQueryFilters((current) => ({ ...current, from, to }));
  };

  const handleFilterRangeChange = (nextRange: FilterRange) => {
    setFilterRange(nextRange);
    applyDateRange(nextRange, customDates);
  };

  const handleCustomDatesChange = (nextCustomDates: { from: string; to: string }) => {
    setCustomDates(nextCustomDates);
    applyDateRange(filterRange, nextCustomDates);
  };

  const handleSync = async () => {
    const toastId = toast.loading('Refreshing cached Meta Ads data...');
    try {
      await refetchSyncCache();
      toast.update(toastId, 'Meta Ads data refreshed from cache.', 'success');
      refetch();
    } catch (err) {
      toast.update(toastId, err instanceof Error ? err.message : 'Failed to refresh Meta Ads data.', 'error');
    }
  };

  const summary = data?.summary || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex-1">
          <FilterBar
            filterRange={filterRange}
            setFilterRange={handleFilterRangeChange}
            customDates={customDates}
            setCustomDates={handleCustomDatesChange}
            compact
          />
        </div>
        <Button type="button" variant="outline" onClick={handleSync} loading={isFetchingSyncCache} icon={<RefreshCw size={18} />}>
          Sync Meta
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
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Active Campaigns" value={summary.activeCampaigns ?? 0} icon={<BarChart3 size={18} />} />
        <MetricCard label="Active Ad Sets" value={summary.activeAdSets ?? 0} icon={ICONS.Banking} />
        <MetricCard label="Active Ads" value={summary.activeAds ?? 0} icon={ICONS.Check} />
        <MetricCard label="Today's Spend" value={formatCurrency(summary.todaySpend ?? 0)} icon={ICONS.Reports} />
        <MetricCard label="Current ROAS" value={summary.currentRoas == null ? '-' : Number(summary.currentRoas).toFixed(2)} />
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
          {error.message}
        </div>
      )}

      {isPending ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-60 animate-pulse rounded-xl border border-gray-100 bg-white" />
          ))}
        </div>
      ) : ads.length === 0 ? (
        <Card elevated className="p-8 text-center">
          <p className="text-sm font-semibold text-gray-500">No Meta ads found for the selected filters.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {ads.map((ad: any) => (
            <button
              type="button"
              key={ad.id}
              onClick={() => navigate(`/meta-ads/${ad.id}`)}
              className="group overflow-hidden rounded-xl border border-gray-100 bg-white text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
            >
              <div className="relative aspect-[16/9] bg-gray-100">
                {ad.thumbnailUrl ? (
                  <img src={ad.thumbnailUrl} alt={ad.name} className="h-full w-full object-cover" />
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
                <div className="mt-2.5 grid grid-cols-3 gap-2 border-t border-gray-100 pt-2.5 text-center">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Impressions</p>
                    <p className="text-sm font-bold text-gray-900">{formatNumber(ad.metrics?.impressions ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Clicks</p>
                    <p className="text-sm font-bold text-gray-900">{formatNumber(ad.metrics?.clicks ?? 0)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">CTR</p>
                    <p className="text-sm font-bold text-gray-900">{Number(ad.metrics?.ctr ?? 0).toFixed(2)}%</p>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const MetaAdDetails: React.FC<{ id: string }> = ({ id }) => {
  const navigate = useNavigate();
  const { data: ad, isPending, error } = useMetaAd(id);

  if (isPending) {
    return <div className="min-h-[40vh] rounded-xl border border-gray-100 bg-white p-8 text-center text-sm font-semibold text-gray-500">Loading ad details...</div>;
  }

  if (error || !ad) {
    return (
      <Card elevated className="p-8 text-center">
        <p className="text-sm font-semibold text-red-600">{error?.message || 'Meta ad not found.'}</p>
        <Button type="button" variant="outline" className="mt-4" onClick={() => navigate('/meta-ads')}>Back to Meta Ads</Button>
      </Card>
    );
  }

  const updated = formatDateTimeParts(ad.updatedAt || ad.lastSyncedAt);
  const metrics = ad.metrics || {};
  const creative = ad.creative || {};
  const rawMetrics = Object.entries(metrics.raw || {}).filter(([, value]) => Array.isArray(value) || (value !== null && typeof value === 'object'));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <button type="button" onClick={() => navigate('/meta-ads')} className="text-sm font-bold text-gray-500 hover:text-gray-900">Back to Meta Ads</button>
          <h1 className="mt-2 text-2xl font-black text-gray-900">{ad.name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${statusBadgeClass(ad.status)}`}>{prettyStatus(ad.status)}</span>
            <span className="text-xs font-semibold text-gray-500">Updated {updated.date || '-'} {updated.time}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Spend" value={formatCurrency(metrics.spend || 0)} icon={ICONS.Reports} />
        <MetricCard label="Reach" value={formatNumber(metrics.reach)} icon={ICONS.Users} />
        <MetricCard label="Impressions" value={formatNumber(metrics.impressions)} icon={<BarChart3 size={18} />} />
        <MetricCard label="Clicks" value={formatNumber(metrics.clicks)} icon={<MousePointerClick size={18} />} />
        <MetricCard label="CTR" value={`${Number(metrics.ctr || 0).toFixed(2)}%`} />
        <MetricCard label="CPC" value={formatCurrency(metrics.cpc || 0)} />
        <MetricCard label="CPM" value={formatCurrency(metrics.cpm || 0)} />
        <MetricCard label="ROAS" value={metrics.roas == null ? '-' : Number(metrics.roas).toFixed(2)} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card elevated className="p-5">
          <h2 className="text-lg font-black text-gray-900">Ad Information</h2>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field label="Ad ID" value={ad.metaAdId} />
            <Field label="Campaign" value={`${ad.campaignName || '-'}${ad.campaignId ? ` (${ad.campaignId})` : ''}`} />
            <Field label="Ad Set" value={`${ad.adSetName || '-'}${ad.adSetId ? ` (${ad.adSetId})` : ''}`} />
            <Field label="Ad Account" value={`${ad.adAccountName || '-'}${ad.adAccountId ? ` (${ad.adAccountId})` : ''}`} />
            <Field label="Business" value={`${ad.businessName || '-'}${ad.businessId ? ` (${ad.businessId})` : ''}`} />
            <Field label="Objective" value={ad.objective} />
            <Field label="Daily Budget" value={ad.budget?.dailyBudget == null ? '-' : formatCurrency(ad.budget.dailyBudget)} />
            <Field label="Lifetime Budget" value={ad.budget?.lifetimeBudget == null ? '-' : formatCurrency(ad.budget.lifetimeBudget)} />
            <Field label="Created" value={ad.createdAt ? formatDate(ad.createdAt) : '-'} />
            <Field label="Start" value={ad.startAt ? formatDate(ad.startAt) : '-'} />
            <Field label="End" value={ad.endAt ? formatDate(ad.endAt) : '-'} />
            <Field label="Last Synced" value={ad.lastSyncedAt ? formatDate(ad.lastSyncedAt) : '-'} />
          </div>
        </Card>

        <Card elevated className="overflow-hidden">
          <div className="aspect-[16/9] bg-gray-100">
            {(creative.imageUrl || creative.thumbnailUrl) ? (
              <img src={creative.imageUrl || creative.thumbnailUrl} alt={ad.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-300">{ICONS.Bell}</div>
            )}
          </div>
          <div className="space-y-3 p-5">
            <h2 className="text-lg font-black text-gray-900">Creative</h2>
            <Field label="Primary Text" value={creative.primaryText} />
            <Field label="Headline" value={creative.headline} />
            <Field label="Description" value={creative.description} />
            <Field label="CTA" value={creative.callToAction} />
            <Field label="Video" value={creative.videoUrl} />
          </div>
        </Card>
      </div>

      <Card elevated className="p-5">
        <h2 className="text-lg font-black text-gray-900">Additional Performance Metrics</h2>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Conversions" value={metrics.conversions == null ? '-' : formatNumber(metrics.conversions)} />
          <Field label="Results" value={metrics.results == null ? '-' : formatNumber(metrics.results)} />
          <Field label="Placements" value={JSON.stringify(ad.placements || {})} />
        </div>
        {rawMetrics.length > 0 && (
          <pre className="mt-4 max-h-80 overflow-auto rounded-xl bg-gray-950 p-4 text-xs font-semibold text-gray-100">
            {JSON.stringify(metrics.raw, null, 2)}
          </pre>
        )}
      </Card>
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
