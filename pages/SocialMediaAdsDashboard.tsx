import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BarChart3, MousePointerClick, TrendingDown, TrendingUp, Trophy } from 'lucide-react';
import { Card, FilterBar, StatCard } from '../components';
import { formatCurrency } from '../constants';
import { useMetaAds, useOrders } from '../src/hooks/useQueries';
import type { FilterRange } from '../components/FilterBar';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { theme } from '../theme';

type TrendPreset = '7d' | '30d' | 'custom';

const formatNumber = (value?: number | null) => new Intl.NumberFormat('en-BD').format(Number(value || 0));
const formatPercent = (value: number) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
const formatMetric = (value: number, digits: number = 2) => Number.isFinite(value) ? value.toFixed(digits) : '0.00';

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

const toRangeWindow = (filterRange: FilterRange, customDates: { from: string; to: string }) => {
  const today = new Date();
  const end = new Date(today);
  const start = new Date(today);

  if (filterRange === 'Custom') {
    const fromDate = customDates.from ? new Date(`${customDates.from}T00:00:00`) : new Date(today);
    const toDate = customDates.to ? new Date(`${customDates.to}T23:59:59`) : new Date(today);
    return { from: fromDate.toISOString().slice(0, 10), to: toDate.toISOString().slice(0, 10) };
  }

  if (filterRange === 'Today') {
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }

  if (filterRange === 'This Week') {
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }

  if (filterRange === 'This Month') {
    start.setDate(1);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }

  if (filterRange === 'This Year') {
    start.setMonth(0, 1);
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }

  return { from: '', to: '' };
};

const getPreviousWindow = (from: string, to: string) => {
  if (!from || !to) return { previousFrom: '', previousTo: '' };
  const startDate = new Date(`${from}T00:00:00`);
  const endDate = new Date(`${to}T23:59:59`);
  const duration = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);
  const previousEnd = new Date(startDate);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(startDate);
  previousStart.setDate(previousStart.getDate() - duration);
  return {
    previousFrom: previousStart.toISOString().slice(0, 10),
    previousTo: previousEnd.toISOString().slice(0, 10),
  };
};

const buildTrendSeries = (start: string, end: string, ads: Array<any>, orders: Array<any>) => {
  if (!start || !end) return [];
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T23:59:59`);
  const series: Array<{ day: string; spend: number; revenue: number; purchases: number }> = [];
  const cursor = new Date(startDate);

  while (cursor <= endDate) {
    const key = cursor.toISOString().slice(0, 10);
    const spend = ads.reduce((total, ad) => {
      const adDate = toDateOnly(ad.createdAt || ad.lastUpdatedAt || ad.updatedAt || '');
      return adDate === key ? total + Number(ad.spend || 0) : total;
    }, 0);
    const dayOrders = orders.filter((order) => {
      const orderDate = toDateOnly(order.orderDate || order.createdAt || order.history?.created || '');
      return Boolean(order.sourceAd) && orderDate === key;
    });
    const revenue = dayOrders.reduce((total, order) => total + Number(order.total || 0), 0);
    const purchases = dayOrders.length;
    series.push({ day: key, spend, revenue, purchases });
    cursor.setDate(cursor.getDate() + 1);
  }

  return series;
};

type RangePickerPopoverProps = {
  open: boolean;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  children: React.ReactNode;
};

const RangePickerPopover: React.FC<RangePickerPopoverProps> = ({ open, anchorRef, children }) => {
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || typeof window === 'undefined') {
      setPosition(null);
      return;
    }

    const updatePosition = () => {
      const button = anchorRef.current;
      if (!button) return;

      const rect = button.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(320, Math.max(280, viewportWidth - 32));
      const height = 190;

      let left = rect.right - width;
      if (left < 16) {
        left = 16;
      }
      if (left + width > viewportWidth - 16) {
        left = viewportWidth - width - 16;
      }

      let top = rect.bottom + 8;
      if (top + height > viewportHeight - 16) {
        top = rect.top - height - 8;
      }
      top = Math.max(16, top);

      setPosition({ top, left, width });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, open]);

  if (!open || !position) return null;

  return (
    <div
      className="fixed z-[70] rounded-2xl border border-gray-200 bg-white p-3 shadow-2xl"
      style={{ top: position.top, left: position.left, width: position.width, maxWidth: 'calc(100vw - 2rem)' }}
    >
      {children}
    </div>
  );
};

const SocialMediaAdsDashboard: React.FC = () => {
  const [filterRange, setFilterRange] = useState<FilterRange>('Today');
  const [customDates, setCustomDates] = useState({ from: '', to: '' });
  const [trendPreset, setTrendPreset] = useState<TrendPreset>('7d');
  const [trendCustomDates, setTrendCustomDates] = useState({ from: '', to: '' });
  const [trendCustomOpen, setTrendCustomOpen] = useState(false);
  const [roasPreset, setRoasPreset] = useState<TrendPreset>('7d');
  const [roasCustomDates, setRoasCustomDates] = useState({ from: '', to: '' });
  const [roasCustomOpen, setRoasCustomOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<string>('');
  const trendCustomButtonRef = useRef<HTMLButtonElement>(null);
  const roasCustomButtonRef = useRef<HTMLButtonElement>(null);

  const { from, to } = useMemo(() => toRangeWindow(filterRange, customDates), [filterRange, customDates]);
  const { data: metaAdsData, isPending: metaAdsPending } = useMetaAds({ from, to });
  const { data: orders = [], isPending: ordersPending } = useOrders();

  const ads = metaAdsData?.ads || [];
  const summary = metaAdsData?.summary || {};

  const filteredOrders = useMemo(() => {
    return (orders as Array<any>).filter((order) => {
      const orderDate = toDateOnly(order.orderDate || order.createdAt || order.history?.created || '');
      if (!orderDate) return false;
      if (!from && !to) return true;
      if (from && orderDate < from) return false;
      if (to && orderDate > to) return false;
      return true;
    });
  }, [orders, from, to]);

  const attributedOrders = useMemo(() => filteredOrders.filter((order) => Boolean(order.sourceAd)), [filteredOrders]);
  const spend = useMemo(() => ads.reduce((total: number, ad: any) => total + Number(ad.spend || 0), 0), [ads]);
  const revenue = useMemo(() => attributedOrders.reduce((total: number, order: any) => total + Number(order.total || 0), 0), [attributedOrders]);
  const purchases = attributedOrders.length;
  const leads = useMemo(() => ads.reduce((total: number, ad: any) => total + Number(ad.conversions || ad.results || 0), 0), [ads]);
  const linkClicks = useMemo(() => ads.reduce((total: number, ad: any) => total + Number(ad.clicks || 0), 0), [ads]);
  const impressions = useMemo(() => ads.reduce((total: number, ad: any) => total + Number(ad.impressions || 0), 0), [ads]);
  const ctr = impressions > 0 ? (linkClicks / impressions) * 100 : 0;

  const comparisonWindow = useMemo(() => getPreviousWindow(from, to), [from, to]);
  const previousSpend = useMemo(() => {
    if (!comparisonWindow.previousFrom || !comparisonWindow.previousTo) return 0;
    const previousAds = (metaAdsData?.ads || []).filter((ad: any) => {
      const adDate = toDateOnly(ad.createdAt || ad.lastUpdatedAt || ad.updatedAt || '');
      return adDate >= comparisonWindow.previousFrom && adDate <= comparisonWindow.previousTo;
    });
    return previousAds.reduce((total: number, ad: any) => total + Number(ad.spend || 0), 0);
  }, [comparisonWindow.previousFrom, comparisonWindow.previousTo, metaAdsData?.ads]);

  const previousRevenue = useMemo(() => {
    if (!comparisonWindow.previousFrom || !comparisonWindow.previousTo) return 0;
    return (orders as Array<any>).reduce((total, order) => {
      const orderDate = toDateOnly(order.orderDate || order.createdAt || order.history?.created || '');
      if (!orderDate || !order.sourceAd) return total;
      return orderDate >= comparisonWindow.previousFrom && orderDate <= comparisonWindow.previousTo ? total + Number(order.total || 0) : total;
    }, 0);
  }, [comparisonWindow.previousFrom, comparisonWindow.previousTo, orders]);

  const trendWindow = useMemo(() => {
    if (trendPreset === 'custom') {
      const start = trendCustomDates.from || '';
      const end = trendCustomDates.to || '';
      return { start, end };
    }
    const today = new Date();
    const end = today.toISOString().slice(0, 10);
    const start = new Date(today);
    start.setDate(start.getDate() - (trendPreset === '30d' ? 29 : 6));
    return { start: start.toISOString().slice(0, 10), end };
  }, [trendPreset, trendCustomDates]);

  const roasWindow = useMemo(() => {
    if (roasPreset === 'custom') {
      const start = roasCustomDates.from || '';
      const end = roasCustomDates.to || '';
      return { start, end };
    }
    const today = new Date();
    const end = today.toISOString().slice(0, 10);
    const start = new Date(today);
    start.setDate(start.getDate() - (roasPreset === '30d' ? 29 : 6));
    return { start: start.toISOString().slice(0, 10), end };
  }, [roasPreset, roasCustomDates]);

  const trendData = useMemo(() => buildTrendSeries(trendWindow.start, trendWindow.end, ads, attributedOrders), [trendWindow.start, trendWindow.end, ads, attributedOrders]);
  const roasTrendData = useMemo(() => {
    const series = buildTrendSeries(roasWindow.start, roasWindow.end, ads, attributedOrders);
    return series.map((point) => ({ ...point, roas: point.spend > 0 ? point.revenue / point.spend : 0 }));
  }, [roasWindow.start, roasWindow.end, ads, attributedOrders]);

  const adLookup = useMemo(() => {
    const lookup = new Map<string, any>();
    ads.forEach((ad: any) => {
      if (ad.id) lookup.set(ad.id, ad);
      if (ad.metaAdId && ad.metaAdId !== ad.id) lookup.set(ad.metaAdId, ad);
    });
    return lookup;
  }, [ads]);

  const campaignRows = useMemo(() => {
    const map = new Map<string, { campaign: string; spend: number; revenue: number; purchases: number; clicks: number; conversions: number }>();

    ads.forEach((ad: any) => {
      const campaign = String(ad.campaignName || 'Unassigned Campaign').trim() || 'Unassigned Campaign';
      const entry = map.get(campaign) || { campaign, spend: 0, revenue: 0, purchases: 0, clicks: 0, conversions: 0 };
      entry.spend += Number(ad.spend || 0);
      entry.clicks += Number(ad.clicks || 0);
      entry.conversions += Number(ad.conversions || ad.results || 0);
      map.set(campaign, entry);
    });

    attributedOrders.forEach((order: any) => {
      const ad = adLookup.get(order.sourceAd);
      const campaign = ad?.campaignName || 'Unassigned Campaign';
      const entry = map.get(campaign) || { campaign, spend: 0, revenue: 0, purchases: 0, clicks: 0, conversions: 0 };
      entry.revenue += Number(order.total || 0);
      entry.purchases += 1;
      map.set(campaign, entry);
    });

    return Array.from(map.values())
      .map((row) => ({ ...row, roas: row.spend > 0 ? row.revenue / row.spend : 0 }))
      .sort((left, right) => right.revenue - left.revenue);
  }, [ads, attributedOrders, adLookup]);

  const bestCampaigns = useMemo(() => campaignRows.slice(0, 5), [campaignRows]);
  const worstCampaigns = useMemo(() => [...campaignRows].sort((left, right) => {
    if (right.roas !== left.roas) return left.roas - right.roas;
    return right.spend - left.spend;
  }).slice(0, 5), [campaignRows]);

  const spendChange = previousSpend > 0 ? ((spend - previousSpend) / previousSpend) * 100 : 0;
  const revenueChange = previousRevenue > 0 ? ((revenue - previousRevenue) / previousRevenue) * 100 : 0;
  const roas = spend > 0 ? revenue / spend : 0;
  const cpa = purchases > 0 ? spend / purchases : 0;
  const cpc = linkClicks > 0 ? spend / linkClicks : 0;
  const deliveredOrders = useMemo(() => {
    return attributedOrders.filter((order: any) => String(order.status) === 'Completed');
  }, [attributedOrders]);
  const deliveredCount = deliveredOrders.length;
  const deliveredAmount = deliveredOrders.reduce((total: number, order: any) => total + Number(order.total || 0), 0);
  const spendSubtitle = previousSpend > 0 ? `${spendChange >= 0 ? '+' : ''}${formatMetric(spendChange, 1)}% vs Yesterday` : 'No previous data';
  const revenueSubtitle = `ROAS: ${formatMetric(roas, 2)}x`;
  const purchasesSubtitle = `CPA: ${formatCurrency(cpa)}`;
  const deliveredSubtitle = `Worth ${formatCurrency(deliveredAmount)}`;


  return (
    <div className="space-y-6">
      <FilterBar
        filterRange={filterRange}
        setFilterRange={setFilterRange}
        customDates={customDates}
        setCustomDates={setCustomDates}
        compact
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Spend" value={formatCurrency(spend)} icon={<BarChart3 size={18} />} variant="primary" subtitle={spendSubtitle} subtitleTone={spendChange >= 0 ? 'positive' : 'negative'} />
        <StatCard title="Revenue" value={formatCurrency(revenue)} icon={<TrendingUp size={18} />} variant="success" subtitle={revenueSubtitle} />
        <StatCard title="Purchases" value={formatNumber(purchases)} icon={<Trophy size={18} />} variant="info" subtitle={purchasesSubtitle} />
        <StatCard title="Delivered" value={formatNumber(deliveredCount)} icon={<Trophy size={18} />} variant="success" subtitle={deliveredSubtitle} />
        <StatCard title="Leads" value={formatNumber(leads)} icon={<MousePointerClick size={18} />} variant="warning" />
        <StatCard title="Link Clicks" value={formatNumber(linkClicks)} icon={<MousePointerClick size={18} />} variant="secondary"/>
        <StatCard title="Cost Per Order" value={formatCurrency(cpa)} icon={<BarChart3 size={18} />} variant="neutral"/>
        <StatCard title="CTR" value={`${formatMetric(ctr)}%`} icon={<BarChart3 size={18} />} variant="neutral" />
      </div>

      <div className="space-y-4">
        <div className="space-y-3">
          <Card elevated className="p-4 pt-5 pb-0">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Spend, revenue and purchases</p>
                <h2 className="mt-1 text-lg font-black text-gray-900">Performance trend</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['7d', '30d', 'custom'] as TrendPreset[]).map((preset) => {
                  const isCustom = preset === 'custom';
                  const isActive = trendPreset === preset;
                  return (
                    <div key={preset} className={isCustom ? 'relative' : undefined}>
                      <button
                        ref={isCustom ? trendCustomButtonRef : undefined}
                        type="button"
                        onClick={() => {
                          setTrendPreset(preset);
                          setTrendCustomOpen(isCustom ? !trendCustomOpen : false);
                        }}
                        className={`rounded-full px-3 py-2 text-xs font-bold ${isActive ? theme.buttons.primary : 'bg-gray-100 text-gray-600'}`}
                      >
                        {preset === '7d' ? 'Last 7 days' : preset === '30d' ? 'Last 30 days' : 'Custom'}
                      </button>
                      {isCustom && (
                        <RangePickerPopover open={trendPreset === 'custom' && trendCustomOpen} anchorRef={trendCustomButtonRef}>
                          <div className="space-y-3">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Custom range</p>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">From</label>
                                <input
                                  type="date"
                                  value={trendCustomDates.from}
                                  onChange={(event) => setTrendCustomDates((current) => ({ ...current, from: event.target.value }))}
                                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-700"
                                />
                              </div>
                              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">To</label>
                                <input
                                  type="date"
                                  value={trendCustomDates.to}
                                  onChange={(event) => setTrendCustomDates((current) => ({ ...current, to: event.target.value }))}
                                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-700"
                                />
                              </div>
                            </div>
                          </div>
                        </RangePickerPopover>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-5 h-96">
            {trendData.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm font-semibold text-gray-500">No trend data available for this window.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 20, right: 20, left: 0, bottom: 44 }}>
                  <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    height={48}
                    interval={0}
                    minTickGap={4}
                    tick={{ fontSize: 10, fill: '#6b7280' }}
                    angle={-45}
                    textAnchor="end"
                    tickFormatter={(val: string) => {
                      const d = new Date(String(val));
                      if (Number.isNaN(d.getTime())) return val;
                      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                    }}
                  />
                  <YAxis yAxisId="left" tickLine={false} axisLine={false} tickFormatter={(value) => `৳${Number(value / 1000).toFixed(0)}k`} />
                  <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} />
                  <Tooltip
                    labelFormatter={(label) => formatTooltipDate(String(label))}
                    formatter={(value: any, name?: string) => [name === 'purchases' ? formatNumber(value) : formatCurrency(Number(value)), name ?? '']}
                  />
                  <Legend wrapperStyle={{ marginBottom: 0, padding: 0 }} />
                  <Line yAxisId="left" type="monotone" dataKey="spend" name="Spend" stroke="#2563eb" strokeWidth={2} dot={false} />
                  <Line yAxisId="left" type="monotone" dataKey="revenue" name="Revenue" stroke="#16a34a" strokeWidth={2} dot={false} />
                  <Line yAxisId="right" type="monotone" dataKey="purchases" name="Purchases" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

        <div className="space-y-3">
          <Card elevated className="p-4 pt-5 pb-0">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="mt-1 text-lg font-black text-gray-900">ROAS trend</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {(['7d', '30d', 'custom'] as TrendPreset[]).map((preset) => {
                  const isCustom = preset === 'custom';
                  const isActive = roasPreset === preset;
                  return (
                    <div key={preset} className={isCustom ? 'relative' : undefined}>
                      <button
                        ref={isCustom ? roasCustomButtonRef : undefined}
                        type="button"
                        onClick={() => {
                          setRoasPreset(preset);
                          setRoasCustomOpen(isCustom ? !roasCustomOpen : false);
                        }}
                        className={`rounded-full px-3 py-2 text-xs font-bold ${isActive ? theme.buttons.primary : 'bg-gray-100 text-gray-600'}`}
                      >
                        {preset === '7d' ? 'Last 7 days' : preset === '30d' ? 'Last 30 days' : 'Custom'}
                      </button>
                      {isCustom && (
                        <RangePickerPopover open={roasPreset === 'custom' && roasCustomOpen} anchorRef={roasCustomButtonRef}>
                          <div className="space-y-3">
                            <div>
                              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Custom range</p>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">From</label>
                                <input
                                  type="date"
                                  value={roasCustomDates.from}
                                  onChange={(event) => setRoasCustomDates((current) => ({ ...current, from: event.target.value }))}
                                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-700"
                                />
                              </div>
                              <div className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">To</label>
                                <input
                                  type="date"
                                  value={roasCustomDates.to}
                                  onChange={(event) => setRoasCustomDates((current) => ({ ...current, to: event.target.value }))}
                                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-sm text-gray-700"
                                />
                              </div>
                            </div>
                          </div>
                        </RangePickerPopover>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-4 flex items-start justify-between gap-3">
            <p className="text-sm text-gray-500">Current ROAS is <span className="font-black text-gray-900">{formatMetric(roasTrendData[roasTrendData.length - 1]?.roas || 0, 2)}x</span> in the selected window.</p>
            {roas >= 2 ? <TrendingUp className="text-emerald-500" size={20} /> : <TrendingDown className="text-amber-600" size={20} />}
          </div>
          <div className="mt-4 h-56">
            {roasTrendData.length === 0 ? (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-sm font-semibold text-gray-500">No ROAS data available for this window.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={roasTrendData} margin={{ top: 16, right: 20, left: 0, bottom: 40 }}>
                  <CartesianGrid stroke="#f3f4f6" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="day"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={6}
                    height={48}
                    interval={0}
                    minTickGap={4}
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
                    formatter={(value: any, name?: string) => [formatMetric(Number(value), 2) + 'x', name ?? 'ROAS']}
                  />
                  <Line type="monotone" dataKey="roas" stroke="#16a34a" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>
    </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card elevated className="p-5">
          <div className="flex items-center gap-2">
            <Trophy size={16} className="text-amber-500" />
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Best campaigns</p>
          </div>
          <h2 className="mt-2 text-lg font-black text-gray-900">Top 5 by revenue</h2>
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
                  <tr key={campaign.campaign}>
                    <td className="px-3 py-3">
                      <button type="button" onClick={() => setSelectedCampaign(campaign.campaign)} className="font-bold text-blue-600 hover:text-blue-700">
                        {campaign.campaign}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-gray-700">{formatCurrency(campaign.spend)}</td>
                    <td className="px-3 py-3 text-gray-700">{formatCurrency(campaign.revenue)}</td>
                    <td className="px-3 py-3 text-gray-700">{formatMetric(campaign.roas, 2)}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card elevated className="p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Worst campaigns</p>
          </div>
          <h2 className="mt-2 text-lg font-black text-gray-900">High spend, low ROAS</h2>
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
                  <tr key={campaign.campaign}>
                    <td className="px-3 py-3 font-bold text-gray-900">{campaign.campaign}</td>
                    <td className="px-3 py-3 text-gray-700">{formatCurrency(campaign.spend)}</td>
                    <td className="px-3 py-3 text-gray-700">{formatCurrency(campaign.revenue)}</td>
                    <td className="px-3 py-3 text-gray-700">{formatMetric(campaign.roas, 2)}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedCampaign && <p className="mt-3 text-sm font-semibold text-gray-500">Focused campaign: {selectedCampaign}</p>}
        </Card>
      </div>

    </div>
  );
};

export default SocialMediaAdsDashboard;
