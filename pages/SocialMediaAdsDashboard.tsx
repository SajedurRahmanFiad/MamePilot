import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BarChart3,
  Info,
  MousePointerClick,
  Package,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Trophy,
  Truck,
} from 'lucide-react';
import { Card, FilterBar, MetaAdsMoney, StatCard } from '../components';
import type { FilterRange } from '../components/FilterBar';
import { getStatusDisplayName } from '../constants';
import { useMarketingDashboard, useMetaAdsSyncStatus } from '../src/hooks/useQueries';
import { useSyncMetaAds } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import {
  convertAdsAmountToBdt,
  CURRENCY_SYMBOLS,
  formatMetaAdsCurrency,
} from '../src/utils/metaAdsCurrency';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { theme } from '../theme';

const MARKETING_RANGES: FilterRange[] = [
  'Today',
  'Last 7 days',
  'Last 30 days',
  'This Week',
  'This Month',
  'Custom',
];

const formatNumber = (value?: number | null) =>
  new Intl.NumberFormat('en-BD').format(Number(value || 0));
const formatMetric = (value: number, digits: number = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : '0.00';
const formatPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;

const toDateOnly = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const getDaySuffix = (day: number) => {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th';
  if (day % 10 === 1) return 'st';
  if (day % 10 === 2) return 'nd';
  if (day % 10 === 3) return 'rd';
  return 'th';
};

const formatTooltipDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const day = date.getDate();
  const month = date.toLocaleString(undefined, { month: 'long' });
  const year = date.getFullYear();
  return `${day}${getDaySuffix(day)} ${month}, ${year}`;
};

// Use local date (not UTC) so "Today" matches the user's calendar,
// which aligns with the ad account's timezone for most users
const toLocalDate = (date: Date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const toRangeWindow = (filterRange: FilterRange, customDates: { from: string; to: string }) => {
  const today = new Date();
  const end = new Date(today);
  const start = new Date(today);

  if (filterRange === 'Custom') {
    return { from: customDates.from || toLocalDate(today), to: customDates.to || toLocalDate(today) };
  }

  if (filterRange === 'Today') {
    return { from: toLocalDate(start), to: toLocalDate(end) };
  }

  if (filterRange === 'Last 7 days') {
    start.setDate(start.getDate() - 6);
    return { from: toLocalDate(start), to: toLocalDate(end) };
  }

  if (filterRange === 'Last 30 days') {
    start.setDate(start.getDate() - 29);
    return { from: toLocalDate(start), to: toLocalDate(end) };
  }

  if (filterRange === 'This Week') {
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    return { from: toLocalDate(start), to: toLocalDate(end) };
  }

  if (filterRange === 'This Month') {
    start.setDate(1);
    return { from: toLocalDate(start), to: toLocalDate(end) };
  }

  if (filterRange === 'This Year') {
    start.setMonth(0, 1);
    return { from: toLocalDate(start), to: toLocalDate(end) };
  }

  // Fallback: last 7 days
  start.setDate(start.getDate() - 6);
  return { from: toLocalDate(start), to: toLocalDate(end) };
};

const pctChange = (current: number, previous: number) =>
  previous > 0 ? ((current - previous) / previous) * 100 : 0;

const SocialMediaAdsDashboard: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToastNotifications();
  const [filterRange, setFilterRange] = useState<FilterRange>('Last 7 days');
  const [customDates, setCustomDates] = useState({ from: '', to: '' });

  const { from, to } = useMemo(() => toRangeWindow(filterRange, customDates), [filterRange, customDates]);
  const { data, isPending, isFetching, error, refetch } = useMarketingDashboard({ from, to });

  // Sync Meta Ads mutation and status polling
  const syncMutation = useSyncMetaAds();
  const { data: syncStatus, refetch: refetchSyncStatus } = useMetaAdsSyncStatus();
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Restore cooldown from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('meta-ads-sync-cooldown-until');
    if (stored) {
      const remaining = Math.max(0, Math.floor((Number(stored) - Date.now()) / 1000));
      if (remaining > 0) setCooldownRemaining(remaining);
    }
  }, []);

  // Countdown timer for sync cooldown
  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    cooldownTimerRef.current = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) {
          if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
          cooldownTimerRef.current = null;
          localStorage.removeItem('meta-ads-sync-cooldown-until');
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

  const applyCooldown = useCallback((seconds: number) => {
    setCooldownRemaining(seconds);
    localStorage.setItem('meta-ads-sync-cooldown-until', String(Date.now() + seconds * 1000));
  }, []);

  // Track last synced time so we can detect when a background sync completes
  const lastSyncedAtRef = useRef<string | null>(syncStatus?.lastSyncedAt ?? null);

  // When sync status changes (background sync completed), refetch dashboard data automatically
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
    const toastId = toast.loading('Starting Meta Ads sync...');
    try {
      const result = await syncMutation.mutateAsync();
      if (result?.ok === false && result?.cooldownRemainingSeconds > 0) {
        applyCooldown(result.cooldownRemainingSeconds);
        toast.update(toastId, 'Sync rate-limited. Please wait ' + result.cooldownRemainingSeconds + 's.', 'error');
      } else if (result?.started) {
        applyCooldown(120);
        toast.update(toastId, 'Sync started. Data will refresh automatically when ready.', 'success');
      } else {
        applyCooldown(120);
        toast.update(toastId, 'Meta Ads synced successfully.', 'success');
        await queryClient.invalidateQueries({ queryKey: ['meta-ads'], exact: false });
        await refetch();
        await refetchSyncStatus();
      }
    } catch (err) {
      toast.update(toastId, err instanceof Error ? err.message : 'Failed to sync Meta Ads.', 'error');
    }
  }, [cooldownRemaining, syncMutation, toast, refetch, refetchSyncStatus, applyCooldown, queryClient]);

  const adsCode = data?.currency?.adsCode || 'BDT';
  const rateToBdt = data?.currency?.rateToBdt ?? null;

  const toBdt = (adsAmount: number) => convertAdsAmountToBdt(adsAmount, adsCode, rateToBdt);
  const spendBdt = toBdt(data?.kpis?.spend ?? 0);
  const prevSpendBdt = toBdt(data?.previousKpis?.spend ?? 0);
  const bookedRevenue = data?.kpis?.bookedRevenue ?? 0;
  const prevBooked = data?.previousKpis?.bookedRevenue ?? 0;
  const realizedRevenue = data?.kpis?.deliveredRevenue ?? 0;
  const prevRealized = data?.previousKpis?.deliveredRevenue ?? 0;

  const bookedRoas = spendBdt != null && spendBdt > 0 ? bookedRevenue / spendBdt : 0;
  const realizedRoas = spendBdt != null && spendBdt > 0 ? realizedRevenue / spendBdt : 0;
  const prevBookedRoas =
    prevSpendBdt != null && prevSpendBdt > 0 ? prevBooked / prevSpendBdt : 0;
  const cpaBdt =
    spendBdt != null && (data?.kpis?.purchases ?? 0) > 0
      ? spendBdt / (data?.kpis?.purchases ?? 1)
      : 0;
  const costPerDeliveredBdt =
    spendBdt != null && (data?.kpis?.deliveredCount ?? 0) > 0
      ? spendBdt / (data?.kpis?.deliveredCount ?? 1)
      : 0;
  const cpcBdt = toBdt(data?.kpis?.cpc ?? 0);
  const cpmBdt = toBdt(data?.kpis?.cpm ?? 0);

  const spendChange = pctChange(spendBdt ?? 0, prevSpendBdt ?? 0);
  const revenueChange = pctChange(bookedRevenue, prevBooked);
  const comparisonLabel =
    filterRange === 'Today'
      ? 'Yesterday'
      : filterRange === 'Last 7 days'
        ? 'Prev 7 days'
        : filterRange === 'Last 30 days'
          ? 'Prev 30 days'
          : filterRange === 'This Week'
            ? 'Last Week'
            : filterRange === 'This Month'
              ? 'Last Month'
              : 'Previous Period';

  const chartData = useMemo(() => {
    return (data?.series || []).map((point) => {
      const daySpendBdt = convertAdsAmountToBdt(point.spend, adsCode, rateToBdt) ?? 0;
      return {
        ...point,
        day: point.date,
        spendBdt: daySpendBdt,
        bookedRoas: daySpendBdt > 0 ? point.bookedRevenue / daySpendBdt : 0,
        realizedRoas: daySpendBdt > 0 ? point.deliveredRevenue / daySpendBdt : 0,
      };
    });
  }, [data?.series, adsCode, rateToBdt]);

  const campaigns = useMemo(() => {
    return (data?.campaigns || []).map((row) => {
      const rowSpendBdt = convertAdsAmountToBdt(row.spend, adsCode, rateToBdt) ?? 0;
      return {
        ...row,
        spendBdt: rowSpendBdt,
        bookedRoas: rowSpendBdt > 0 ? row.bookedRevenue / rowSpendBdt : 0,
        realizedRoas: rowSpendBdt > 0 ? row.deliveredRevenue / rowSpendBdt : 0,
        ctr: row.impressions > 0 ? (row.clicks / row.impressions) * 100 : 0,
        cpaBdt: row.purchases > 0 && rowSpendBdt > 0 ? rowSpendBdt / row.purchases : 0,
        deliveryRate:
          row.purchases - row.cancelledCount > 0
            ? (row.deliveredCount / (row.purchases - row.cancelledCount)) * 100
            : 0,
      };
    });
  }, [data?.campaigns, adsCode, rateToBdt]);

  const bestCampaigns = useMemo(
    () => [...campaigns].sort((a, b) => b.bookedRevenue - a.bookedRevenue).slice(0, 5),
    [campaigns]
  );
  const worstCampaigns = useMemo(() => {
    const minSpendBdt = 1; // ignore near-zero spend noise
    return [...campaigns]
      .filter((c) => c.spendBdt >= minSpendBdt)
      .sort((a, b) => a.bookedRoas - b.bookedRoas || b.spendBdt - a.spendBdt)
      .slice(0, 5);
  }, [campaigns]);

  const pipelineChartData = useMemo(() => {
    const k = data?.kpis;
    if (!k) return [];
    return [
      { stage: 'Placed', count: k.purchases, value: k.bookedRevenue },
      { stage: 'In pipeline', count: k.pipelineCount, value: k.pipelineValue },
      { stage: 'Delivered', count: k.deliveredCount, value: k.deliveredRevenue },
      { stage: 'Returned', count: k.returnedCount, value: k.returnedRevenue },
      { stage: 'Cancelled', count: k.cancelledCount, value: 0 },
    ];
  }, [data?.kpis]);

  const moneyTooltipFormatter = (value: number, dataKey?: string) => {
    const key = String(dataKey || '');
    if (key === 'purchases' || key === 'deliveredCount' || key === 'count') {
      return [formatNumber(value), key === 'purchases' ? 'Purchases' : key];
    }
    if (key === 'bookedRoas' || key === 'realizedRoas') {
      return [`${formatMetric(Number(value), 2)}x`, key === 'bookedRoas' ? 'Booked ROAS' : 'Realized ROAS'];
    }
    return [formatMetaAdsCurrency(Number(value), 'BDT'), key];
  };

  if (error) {
    return (
      <div className="rounded-2xl border border-red-100 bg-red-50 p-6 text-sm font-semibold text-red-700">
        Failed to load marketing dashboard: {error.message}
        <button type="button" onClick={() => refetch()} className="ml-3 underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <FilterBar
            filterRange={filterRange}
            setFilterRange={setFilterRange}
            customDates={customDates}
            setCustomDates={setCustomDates}
            compact
            ranges={MARKETING_RANGES}
          />
          <p className="max-w-3xl text-xs font-medium text-gray-500">
            Money is shown in <span className="font-bold text-gray-700">৳ BDT</span>
            {adsCode !== 'BDT' ? (
              <>
                {' '}
                — hover amounts for <span className="font-bold text-gray-700">{adsCode}</span> (ads currency).
              </>
            ) : null}{' '}
            Purchases &amp; revenue come from app orders with a source ad. ROAS needs multi-day windows;
            same-day is directional only because delivery lags spend.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.meta?.stale && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-[11px] font-bold text-amber-700">
              <AlertTriangle size={12} /> Data may be stale
            </span>
          )}
          {data?.meta?.lastSyncedAt && (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-[11px] font-bold text-gray-600">
              <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
              Synced {new Date(data.meta.lastSyncedAt).toLocaleString()}
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-bold text-blue-700">
            {data?.meta?.activeAds ?? 0} active ads · {data?.meta?.activeCampaigns ?? 0} campaigns
          </span>
          <button
            type="button"
            onClick={handleSync}
            disabled={cooldownRemaining > 0 || syncMutation.isPending}
            className={`rounded-full px-3 py-2 text-xs font-bold ${theme.buttons.primary} ${cooldownRemaining > 0 || syncMutation.isPending ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            {syncMutation.isPending ? (
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw size={12} className="animate-spin" />
                Syncing…
              </span>
            ) : cooldownRemaining > 0 ? (
              `Cooldown ${Math.floor(cooldownRemaining / 60)}:${String(cooldownRemaining % 60).padStart(2, '0')}`
            ) : (
              'Sync Meta'
            )}
          </button>
        </div>
      </div>

      {(data?.alerts?.length ?? 0) > 0 && (
        <div className="space-y-2">
          {data!.alerts.map((alert) => (
            <div
              key={alert.code}
              className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${
                alert.severity === 'danger'
                  ? 'border-red-100 bg-red-50 text-red-800'
                  : alert.severity === 'warning'
                    ? 'border-amber-100 bg-amber-50 text-amber-900'
                    : 'border-sky-100 bg-sky-50 text-sky-900'
              }`}
            >
              {alert.severity === 'info' ? <Info size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
              <span>{alert.message}</span>
            </div>
          ))}
        </div>
      )}

      {isPending && !data ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center text-sm font-semibold text-gray-500">
          Loading marketing metrics…
        </div>
      ) : (
        <>
          {/* Money & efficiency */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Ad Spend"
              value={
                <MetaAdsMoney amount={data?.kpis?.spend ?? 0} nativeCode={adsCode} unit="ads" />
              }
              icon={<BarChart3 size={18} />}
              variant="primary"
              subtitle={
                prevSpendBdt != null && prevSpendBdt > 0
                  ? `${formatPercent(spendChange)} vs ${comparisonLabel}`
                  : 'No previous data'
              }
              subtitleTone={spendChange >= 0 ? 'positive' : 'negative'}
            />
            <StatCard
              title="Booked Revenue"
              value={<MetaAdsMoney amount={bookedRevenue} unit="bdt" nativeCode={adsCode} />}
              icon={<TrendingUp size={18} />}
              variant="success"
              subtitle={`Orders placed · ${formatPercent(revenueChange)} vs ${comparisonLabel}`}
              subtitleTone={revenueChange >= 0 ? 'positive' : 'negative'}
            />
            <StatCard
              title="Booked ROAS"
              value={`${formatMetric(bookedRoas, 2)}x`}
              icon={bookedRoas >= 2 ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
              variant={bookedRoas >= 1 ? 'success' : 'warning'}
              subtitle={`Prev ${formatMetric(prevBookedRoas, 2)}x · orders / spend`}
            />
            <StatCard
              title="Realized Revenue"
              value={<MetaAdsMoney amount={realizedRevenue} unit="bdt" nativeCode={adsCode} />}
              icon={<Package size={18} />}
              variant="info"
              subtitle={`${formatNumber(data?.kpis?.deliveredCount)} delivered · ROAS ${formatMetric(realizedRoas, 2)}x`}
            />
            <StatCard
              title="Realized ROAS"
              value={`${formatMetric(realizedRoas, 2)}x`}
              icon={<Trophy size={18} />}
              variant="neutral"
              subtitle="Delivered value ÷ spend (matures over time)"
            />
            <StatCard
              title="Cost / Order"
              value={<MetaAdsMoney amount={cpaBdt} unit="bdt" nativeCode={adsCode} />}
              icon={<BarChart3 size={18} />}
              variant="neutral"
              subtitle={`${formatNumber(data?.kpis?.purchases)} purchases`}
            />
            <StatCard
              title="Cost / Delivered"
              value={<MetaAdsMoney amount={costPerDeliveredBdt} unit="bdt" nativeCode={adsCode} />}
              icon={<Truck size={18} />}
              variant="neutral"
              subtitle={`Delivery rate ${formatMetric(data?.kpis?.deliveryRate ?? 0, 1)}%`}
            />
            <StatCard
              title="Pipeline"
              value={formatNumber(data?.kpis?.pipelineCount)}
              icon={<Package size={18} />}
              variant="warning"
              subtitle={
                <>
                  Worth <MetaAdsMoney amount={data?.kpis?.pipelineValue ?? 0} unit="bdt" nativeCode={adsCode} /> open
                </>
              }
            />
          </div>

          {/* Volume & Meta engagement */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Purchases"
              value={formatNumber(data?.kpis?.purchases)}
              icon={<Trophy size={18} />}
              variant="info"
              subtitle={`${formatNumber(data?.kpis?.returnedCount)} returned · ${formatNumber(data?.kpis?.cancelledCount)} cancelled`}
            />
            <StatCard
              title="Link Clicks"
              value={formatNumber(data?.kpis?.clicks)}
              icon={<MousePointerClick size={18} />}
              variant="secondary"
              subtitle={`CTR ${formatMetric(data?.kpis?.ctr ?? 0)}%`}
            />
            <StatCard
              title="Impressions"
              value={formatNumber(data?.kpis?.impressions)}
              icon={<BarChart3 size={18} />}
              variant="neutral"
              subtitle={
                cpmBdt != null ? (
                  <>
                    CPM <MetaAdsMoney amount={data?.kpis?.cpm ?? 0} nativeCode={adsCode} unit="ads" />
                  </>
                ) : (
                  'CPM n/a'
                )
              }
            />
            <StatCard
              title="CPC"
              value={
                cpcBdt != null ? (
                  <MetaAdsMoney amount={data?.kpis?.cpc ?? 0} nativeCode={adsCode} unit="ads" />
                ) : (
                  '—'
                )
              }
              icon={<MousePointerClick size={18} />}
              variant="neutral"
              subtitle={`Meta results ${formatNumber(data?.kpis?.metaConversions)} (pixel/leads)`}
            />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card elevated className="p-4 pt-5 pb-0">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">
                Spend, booked revenue & purchases
              </p>
              <h2 className="mt-1 text-lg font-black text-gray-900">Performance trend</h2>
              <div className="mt-5 h-80">
                {chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm font-semibold text-gray-500">
                    No trend data for this window.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 16, right: 12, left: 0, bottom: 36 }}>
                      <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="day"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        height={48}
                        interval="preserveStartEnd"
                        minTickGap={12}
                        tick={{ fontSize: 10, fill: '#6b7280' }}
                        angle={-45}
                        textAnchor="end"
                        tickFormatter={(val: string) => {
                          const d = new Date(String(val));
                          if (Number.isNaN(d.getTime())) return val;
                          return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                        }}
                      />
                      <YAxis
                        yAxisId="left"
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${CURRENCY_SYMBOLS.BDT}${Number(value / 1000).toFixed(0)}k`}
                      />
                      <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} />
                      <Tooltip
                        labelFormatter={(label) => formatTooltipDate(String(label))}
                        formatter={(value: any, _name: any, item: any) =>
                          moneyTooltipFormatter(Number(value), item?.dataKey)
                        }
                      />
                      <Legend />
                      <Line yAxisId="left" type="monotone" dataKey="spendBdt" name="Spend" stroke="#2563eb" strokeWidth={2} dot={false} />
                      <Line yAxisId="left" type="monotone" dataKey="bookedRevenue" name="Booked revenue" stroke="#16a34a" strokeWidth={2} dot={false} />
                      <Line yAxisId="left" type="monotone" dataKey="deliveredRevenue" name="Realized revenue" stroke="#0d9488" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                      <Bar yAxisId="right" dataKey="purchases" name="Purchases" fill="#f59e0b" opacity={0.55} />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card elevated className="p-4 pt-5 pb-0">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Lag-aware efficiency</p>
              <h2 className="mt-1 text-lg font-black text-gray-900">ROAS trend</h2>
              <p className="mt-2 text-sm text-gray-500">
                Booked {formatMetric(bookedRoas, 2)}x · Realized {formatMetric(realizedRoas, 2)}x in this window.
                Realized rises as pipeline orders deliver.
              </p>
              <div className="mt-4 h-72">
                {chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm font-semibold text-gray-500">
                    No ROAS data for this window.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 16, right: 12, left: 0, bottom: 36 }}>
                      <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="day"
                        tickLine={false}
                        axisLine={false}
                        tickMargin={6}
                        height={48}
                        interval="preserveStartEnd"
                        minTickGap={12}
                        tick={{ fontSize: 10, fill: '#6b7280' }}
                        angle={-45}
                        textAnchor="end"
                        tickFormatter={(val: string) => {
                          const d = new Date(String(val));
                          if (Number.isNaN(d.getTime())) return val;
                          return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                        }}
                      />
                      <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => `${Number(value).toFixed(1)}x`} />
                      <Tooltip
                        labelFormatter={(label) => formatTooltipDate(String(label))}
                        formatter={(value: any, _name: any, item: any) =>
                          moneyTooltipFormatter(Number(value), item?.dataKey)
                        }
                      />
                      <Legend />
                      <Line type="monotone" dataKey="bookedRoas" name="Booked ROAS" stroke="#16a34a" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="realizedRoas" name="Realized ROAS" stroke="#2563eb" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card elevated className="p-4 pt-5">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Fulfillment funnel</p>
              <h2 className="mt-1 text-lg font-black text-gray-900">Ad order pipeline</h2>
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={pipelineChartData} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
                    <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" />
                    <XAxis type="number" tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="stage" width={90} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value: any, _name: any, item: any) =>
                        moneyTooltipFormatter(Number(value), item?.dataKey)
                      }
                    />
                    <Legend />
                    <Bar dataKey="count" name="Orders" fill="#3b82f6" radius={[0, 6, 6, 0]} />
                    <Bar dataKey="value" name="Value (৳)" fill="#86efac" radius={[0, 6, 6, 0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              {(data?.pipeline?.length ?? 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {data!.pipeline.map((row) => (
                    <span key={row.status} className="rounded-full bg-gray-100 px-3 py-1 text-[11px] font-bold text-gray-600">
                      {getStatusDisplayName(row.status)}: {row.count}
                    </span>
                  ))}
                </div>
              )}
            </Card>

            <Card elevated className="p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Attribution</p>
              <h2 className="mt-1 text-lg font-black text-gray-900">Recent ad orders</h2>
              <div className="mt-4 overflow-hidden rounded-xl border border-gray-100">
                <table className="min-w-full divide-y divide-gray-100 text-left text-sm">
                  <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                    <tr>
                      <th className="px-3 py-3">Order</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-3 py-3">Campaign / Ad</th>
                      <th className="px-3 py-3">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {(data?.recentOrders || []).length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-sm font-semibold text-gray-500">
                          No attributed orders yet. Set a source ad when creating orders.
                        </td>
                      </tr>
                    ) : (
                      data!.recentOrders.map((order) => (
                        <tr key={order.id} className="hover:bg-gray-50">
                          <td className="px-3 py-3">
                            <button
                              type="button"
                              onClick={() => navigate(`/orders/${order.id}`)}
                              className="font-bold text-blue-600 hover:text-blue-700"
                            >
                              {order.orderNumber}
                            </button>
                            <p className="text-[11px] text-gray-400">{toDateOnly(order.orderDate)}</p>
                          </td>
                          <td className="px-3 py-3 text-gray-700">{getStatusDisplayName(order.status)}</td>
                          <td className="px-3 py-3 text-gray-700">
                            <p className="font-semibold">{order.campaignName || '—'}</p>
                            <p className="text-[11px] text-gray-400">{order.adName || order.sourceAd}</p>
                          </td>
                          <td className="px-3 py-3">
                            <MetaAdsMoney amount={order.total} unit="bdt" nativeCode={adsCode} />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>

          {/* Campaign tables */}
          <Card elevated className="p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">By campaign</p>
                <h2 className="mt-1 text-lg font-black text-gray-900">Campaign performance</h2>
              </div>
              <button
                type="button"
                onClick={() => navigate('/meta-ads')}
                className="text-xs font-bold text-blue-600 hover:text-blue-700"
              >
                Open Meta Ads →
              </button>
            </div>
            <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
              <table className="min-w-full divide-y divide-gray-100 text-left text-sm">
                <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                  <tr>
                    <th className="px-3 py-3">Campaign</th>
                    <th className="px-3 py-3">Spend</th>
                    <th className="px-3 py-3">Purchases</th>
                    <th className="px-3 py-3">Booked rev</th>
                    <th className="px-3 py-3">Realized</th>
                    <th className="px-3 py-3">Booked ROAS</th>
                    <th className="px-3 py-3">Realized ROAS</th>
                    <th className="px-3 py-3">CTR</th>
                    <th className="px-3 py-3">Delivery %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {campaigns.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-sm font-semibold text-gray-500">
                        No campaign data for this range. Sync Meta Ads to load daily spend.
                      </td>
                    </tr>
                  ) : (
                    campaigns.map((campaign) => (
                      <tr key={`${campaign.id}-${campaign.name}`}>
                        <td className="px-3 py-3 font-bold text-gray-900">{campaign.name}</td>
                        <td className="px-3 py-3">
                          <MetaAdsMoney amount={campaign.spend} nativeCode={adsCode} unit="ads" />
                        </td>
                        <td className="px-3 py-3 text-gray-700">{formatNumber(campaign.purchases)}</td>
                        <td className="px-3 py-3">
                          <MetaAdsMoney amount={campaign.bookedRevenue} unit="bdt" nativeCode={adsCode} />
                        </td>
                        <td className="px-3 py-3">
                          <MetaAdsMoney amount={campaign.deliveredRevenue} unit="bdt" nativeCode={adsCode} />
                        </td>
                        <td className="px-3 py-3 text-gray-700">{formatMetric(campaign.bookedRoas, 2)}x</td>
                        <td className="px-3 py-3 text-gray-700">{formatMetric(campaign.realizedRoas, 2)}x</td>
                        <td className="px-3 py-3 text-gray-700">{formatMetric(campaign.ctr)}%</td>
                        <td className="px-3 py-3 text-gray-700">{formatMetric(campaign.deliveryRate, 1)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card elevated className="p-5">
              <div className="flex items-center gap-2">
                <Trophy size={16} className="text-amber-500" />
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Best campaigns</p>
              </div>
              <h2 className="mt-2 text-lg font-black text-gray-900">Top 5 by booked revenue</h2>
              <div className="mt-4 overflow-hidden rounded-xl border border-gray-100">
                <table className="min-w-full divide-y divide-gray-100 text-left text-sm">
                  <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                    <tr>
                      <th className="px-3 py-3">Campaign</th>
                      <th className="px-3 py-3">Spend</th>
                      <th className="px-3 py-3">Revenue</th>
                      <th className="px-3 py-3">ROAS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {bestCampaigns.map((campaign) => (
                      <tr key={`best-${campaign.id}-${campaign.name}`}>
                        <td className="px-3 py-3 font-bold text-gray-900">{campaign.name}</td>
                        <td className="px-3 py-3">
                          <MetaAdsMoney amount={campaign.spend} nativeCode={adsCode} unit="ads" />
                        </td>
                        <td className="px-3 py-3">
                          <MetaAdsMoney amount={campaign.bookedRevenue} unit="bdt" nativeCode={adsCode} />
                        </td>
                        <td className="px-3 py-3 text-gray-700">{formatMetric(campaign.bookedRoas, 2)}x</td>
                      </tr>
                    ))}
                    {bestCampaigns.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-sm font-semibold text-gray-500">
                          No campaigns yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card elevated className="p-5">
              <div className="flex items-center gap-2">
                <AlertTriangle size={16} className="text-red-500" />
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Worst campaigns</p>
              </div>
              <h2 className="mt-2 text-lg font-black text-gray-900">High spend, low booked ROAS</h2>
              <div className="mt-4 overflow-hidden rounded-xl border border-gray-100">
                <table className="min-w-full divide-y divide-gray-100 text-left text-sm">
                  <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-widest text-gray-400">
                    <tr>
                      <th className="px-3 py-3">Campaign</th>
                      <th className="px-3 py-3">Spend</th>
                      <th className="px-3 py-3">Revenue</th>
                      <th className="px-3 py-3">ROAS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {worstCampaigns.map((campaign) => (
                      <tr key={`worst-${campaign.id}-${campaign.name}`}>
                        <td className="px-3 py-3 font-bold text-gray-900">{campaign.name}</td>
                        <td className="px-3 py-3">
                          <MetaAdsMoney amount={campaign.spend} nativeCode={adsCode} unit="ads" />
                        </td>
                        <td className="px-3 py-3">
                          <MetaAdsMoney amount={campaign.bookedRevenue} unit="bdt" nativeCode={adsCode} />
                        </td>
                        <td className="px-3 py-3 text-gray-700">{formatMetric(campaign.bookedRoas, 2)}x</td>
                      </tr>
                    ))}
                    {worstCampaigns.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-sm font-semibold text-gray-500">
                          No qualifying campaigns (min spend filter).
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
};

export default SocialMediaAdsDashboard;
