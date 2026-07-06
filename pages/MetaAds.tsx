import React, { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BarChart3, Clock3, MousePointerClick, RefreshCw, Search } from 'lucide-react';
import { Card, Button } from '../components';
import { formatCurrency, ICONS } from '../constants';
import { formatDate, formatDateTimeParts } from '../utils';
import { useMetaAd, useMetaAds } from '../src/hooks/useQueries';
import { useSyncMetaAds } from '../src/hooks/useMutations';
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
  const [filters, setFilters] = useState({
    businessId: '',
    adAccountId: '',
    campaignId: '',
    status: '',
    from: '',
    to: '',
    search: '',
  });
  const { data, isPending, error, refetch } = useMetaAds(filters);
  const syncMutation = useSyncMetaAds();

  const filterOptions = data?.filters || { businesses: [], adAccounts: [], campaigns: [], statuses: [] };
  const campaigns = useMemo(() => {
    const rows = filterOptions.campaigns || [];
    return rows.filter((campaign: any) => {
      if (filters.businessId && campaign.businessId !== filters.businessId) return false;
      if (filters.adAccountId && campaign.adAccountId !== filters.adAccountId) return false;
      return true;
    });
  }, [filterOptions.campaigns, filters.businessId, filters.adAccountId]);
  const adAccounts = useMemo(() => {
    const rows = filterOptions.adAccounts || [];
    return rows.filter((account: any) => !filters.businessId || account.businessId === filters.businessId);
  }, [filterOptions.adAccounts, filters.businessId]);

  const updateFilter = (key: keyof typeof filters, value: string) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === 'businessId' ? { adAccountId: '', campaignId: '' } : {}),
      ...(key === 'adAccountId' ? { campaignId: '' } : {}),
    }));
  };

  const handleSync = async () => {
    const toastId = toast.loading('Synchronizing Meta Ads...');
    try {
      await syncMutation.mutateAsync();
      toast.update(toastId, 'Meta Ads synchronized.', 'success');
      refetch();
    } catch (err) {
      toast.update(toastId, err instanceof Error ? err.message : 'Meta Ads sync failed.', 'error');
    }
  };

  const summary = data?.summary || {};
  const ads = data?.ads || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Social Media Ads</p>
          <h1 className="mt-2 text-2xl font-black text-gray-900">Meta Ads</h1>
        </div>
        <Button type="button" variant="outline" onClick={handleSync} loading={syncMutation.isPending} icon={<RefreshCw size={18} />}>
          Sync Meta
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-7">
        <MetricCard label="Businesses" value={summary.totalBusinesses ?? 0} icon={ICONS.Briefcase} />
        <MetricCard label="Ad Accounts" value={summary.totalAdAccounts ?? 0} icon={ICONS.Banking} />
        <MetricCard label="Campaigns" value={summary.totalCampaigns ?? 0} icon={<BarChart3 size={18} />} />
        <MetricCard label="Total Ads" value={summary.totalAds ?? 0} icon={ICONS.Bell} />
        <MetricCard label="Active Ads" value={summary.activeAds ?? 0} icon={ICONS.Check} />
        <MetricCard label="Inactive Ads" value={summary.inactiveAds ?? 0} icon={ICONS.Clock} />
        <MetricCard label="Spend" value={formatCurrency(summary.totalSpend ?? 0)} icon={ICONS.Reports} />
      </div>

      <Card elevated className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <select value={filters.businessId} onChange={(event) => updateFilter('businessId', event.target.value)} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-sm font-semibold text-gray-700">
            <option value="">All Businesses</option>
            {(filterOptions.businesses || []).map((business: any) => <option key={business.id} value={business.id}>{business.name}</option>)}
          </select>
          <select value={filters.adAccountId} onChange={(event) => updateFilter('adAccountId', event.target.value)} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-sm font-semibold text-gray-700">
            <option value="">All Ad Accounts</option>
            {adAccounts.map((account: any) => <option key={account.id} value={account.id}>{account.name}</option>)}
          </select>
          <select value={filters.campaignId} onChange={(event) => updateFilter('campaignId', event.target.value)} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-sm font-semibold text-gray-700">
            <option value="">All Campaigns</option>
            {campaigns.map((campaign: any) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
          </select>
          <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-sm font-semibold text-gray-700">
            <option value="">All Statuses</option>
            {(filterOptions.statuses || []).map((status: string) => <option key={status} value={status}>{prettyStatus(status)}</option>)}
          </select>
          <input type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-sm font-semibold text-gray-700" />
          <input type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-3 text-sm font-semibold text-gray-700" />
        </div>
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2">
          <Search size={18} className="text-gray-400" />
          <input
            type="search"
            value={filters.search}
            onChange={(event) => updateFilter('search', event.target.value)}
            placeholder="Search ad name"
            className="w-full bg-transparent py-2 text-sm font-semibold outline-none"
          />
        </div>
      </Card>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
          {error.message}
        </div>
      )}

      {isPending ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="h-72 animate-pulse rounded-xl border border-gray-100 bg-white" />
          ))}
        </div>
      ) : ads.length === 0 ? (
        <Card elevated className="p-8 text-center">
          <p className="text-sm font-semibold text-gray-500">No Meta ads found for the selected filters.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ads.map((ad: any) => (
            <button
              type="button"
              key={ad.id}
              onClick={() => navigate(`/meta-ads/${ad.id}`)}
              className="overflow-hidden rounded-xl border border-gray-100 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="aspect-[16/9] bg-gray-100">
                {ad.thumbnailUrl ? (
                  <img src={ad.thumbnailUrl} alt={ad.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-gray-300">{ICONS.Bell}</div>
                )}
              </div>
              <div className="space-y-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="line-clamp-2 text-base font-black text-gray-900">{ad.name}</h3>
                    <p className="mt-1 truncate text-xs font-bold text-gray-500">{ad.campaignName || 'No campaign'}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${statusBadgeClass(ad.status)}`}>
                    {prettyStatus(ad.status)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Field label="Ad Account" value={ad.adAccountName} />
                  <Field label="Business" value={ad.businessName} />
                  <Field label="Spend" value={formatCurrency(ad.spend)} />
                  <Field label="Reach" value={formatNumber(ad.reach)} />
                  <Field label="Impressions" value={formatNumber(ad.impressions)} />
                  <Field label="Updated" value={ad.lastUpdatedAt ? formatDate(ad.lastUpdatedAt) : '-'} />
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
