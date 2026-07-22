import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { OrderStatus } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { StatCard } from '../components/Card';
import { FilterBar } from '../components';
import type { FilterRange } from '../utils';
import { useAuth } from '../src/contexts/AuthProvider';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { useDashboardSnapshot } from '../src/hooks/useQueries';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const roundDashboardValue = (value: number): number => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Math.round(numericValue);
};

const formatDashboardInteger = (value: number): string => {
  return roundDashboardValue(value).toLocaleString('en-BD');
};

const CASH_FLOW_LABELS: Record<string, string> = {
  income: 'Income',
  expense: 'Expense',
  profit: 'Profit',
};

const EXPENSE_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

const EMPLOYEE_STATUS_STYLES: Record<OrderStatus, { valueClass: string; barClass: string; trackClass: string }> = {
  [OrderStatus.CREATED]: {
    valueClass: 'text-gray-500',
    barClass: 'bg-gray-500',
    trackClass: 'bg-gray-100',
  },
  [OrderStatus.ON_HOLD]: {
    valueClass: 'text-amber-500',
    barClass: 'bg-amber-500',
    trackClass: 'bg-amber-100',
  },
  [OrderStatus.PROCESSING]: {
    valueClass: 'text-sky-500',
    barClass: 'bg-sky-500',
    trackClass: 'bg-sky-100',
  },
  [OrderStatus.COURIER_ASSIGNED]: {
    valueClass: 'text-blue-600',
    barClass: 'bg-blue-600',
    trackClass: 'bg-blue-100',
  },
  [OrderStatus.PICKED]: {
    valueClass: 'text-cyan-500',
    barClass: 'bg-cyan-500',
    trackClass: 'bg-cyan-100',
  },
  [OrderStatus.COMPLETED]: {
    valueClass: 'text-emerald-500',
    barClass: 'bg-emerald-500',
    trackClass: 'bg-emerald-100',
  },
  [OrderStatus.EXCHANGE_PROCESSING]: {
    valueClass: 'text-blue-500',
    barClass: 'bg-blue-500',
    trackClass: 'bg-blue-100',
  },
  [OrderStatus.EXCHANGE_PICKED]: {
    valueClass: 'text-purple-500',
    barClass: 'bg-purple-500',
    trackClass: 'bg-purple-100',
  },
  [OrderStatus.EXCHANGE_DELIVERED]: {
    valueClass: 'text-emerald-500',
    barClass: 'bg-emerald-500',
    trackClass: 'bg-emerald-100',
  },
  [OrderStatus.EXCHANGE_RETURNED]: {
    valueClass: 'text-orange-500',
    barClass: 'bg-orange-500',
    trackClass: 'bg-orange-100',
  },
  [OrderStatus.EXCHANGE_CANCELLED]: {
    valueClass: 'text-red-500',
    barClass: 'bg-red-500',
    trackClass: 'bg-red-100',
  },
  [OrderStatus.RETURNED]: {
    valueClass: 'text-orange-500',
    barClass: 'bg-orange-500',
    trackClass: 'bg-orange-100',
  },
  [OrderStatus.CANCELLED]: {
    valueClass: 'text-rose-500',
    barClass: 'bg-rose-500',
    trackClass: 'bg-rose-100',
  },
};

const EmployeeSummaryCard: React.FC<{
  title: string;
  value: string | number;
  hint: string;
  icon: React.ReactNode;
  cardClassName: string;
  iconClassName: string;
  onClick?: () => void;
}> = ({ title, value, hint, icon, cardClassName, iconClassName, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    className={`group w-full rounded-2xl px-5 py-5 text-left text-white shadow-[0_18px_40px_rgba(15,47,87,0.12)] transition focus:outline-none focus:ring-2 focus:ring-[#3c5a82] focus:ring-offset-2 ${onClick ? 'hover:-translate-y-0.5 hover:shadow-[0_22px_44px_rgba(15,47,87,0.18)]' : 'cursor-default'} ${cardClassName}`}
  >
    <div className="flex items-center gap-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/80">{title}</p>
        <p className="mt-1.5 truncate text-xl font-black leading-none">{value}</p>
      </div>
      {onClick && <span aria-hidden="true" className="text-white/60 transition-transform group-hover:translate-x-0.5">{ICONS.ChevronRight}</span>}
    </div>
    <p className="mt-4 text-xs font-semibold text-white/75">{hint}</p>
  </button>
);

const EmployeeStatusCard: React.FC<{
  title: string;
  value: number | string;
  total: number;
  valueClass: string;
  barClass: string;
  trackClass: string;
  onClick?: () => void;
}> = ({ title, value, total, valueClass, barClass, trackClass, onClick }) => {
  const numericValue = typeof value === 'number' ? value : 0;
  const width = total > 0 && numericValue > 0 ? Math.max((numericValue / total) * 100, 8) : 0;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`w-full rounded-[12px] border border-gray-100 bg-white px-4 py-4 text-left shadow-sm transition-all ${onClick ? 'hover:-translate-y-0.5 hover:border-[#c7dff5] hover:bg-[#f8fbff]' : 'cursor-default'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[16px] font-black text-gray-900">{title}</p>
        <p className={`text-lg font-black leading-none ${valueClass}`}>{value}</p>
      </div>
      <div className={`mt-5 h-3 overflow-hidden rounded-full ${trackClass}`}>
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${width}%` }} />
      </div>
    </button>
  );
};

const EmployeeComparisonRow: React.FC<{
  rank: number;
  name: string;
  role: string;
  orderCount: number;
  maxCount: number;
  isCurrentUser: boolean;
}> = ({ rank, name, role, orderCount, maxCount, isCurrentUser }) => {
  const width = maxCount > 0 && orderCount > 0 ? Math.max((orderCount / maxCount) * 100, 8) : 0;

  return (
    <div className={`rounded-[12px] border px-4 py-4 shadow-sm ${isCurrentUser ? 'border-[#c7dff5] bg-[#f8fbff]' : 'border-gray-100 bg-white'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${isCurrentUser ? 'bg-[#0f2f57] text-white' : 'bg-gray-100 text-gray-500'}`}>
            {rank}
          </span>
          <div className="min-w-0">
            <p className="truncate text-md font-black text-gray-900">{name}{isCurrentUser ? ' (You)' : ''}</p>
            <p className="mt-1 text-[10px] font-black uppercase text-gray-400">{role}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-black leading-none text-[#0f172a]">{orderCount}</p>
          <p className="mt-1 text-[10px] font-black uppercase text-gray-400">Orders</p>
        </div>
      </div>
      <div className="mt-5 h-3 overflow-hidden rounded-full bg-[#e8edf5]">
        <div className="h-full rounded-full bg-[#94a3b8]" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
};

const EmployeeInsight: React.FC<{
  label: string;
  value: string;
  detail: string;
  valueClassName?: string;
}> = ({ label, value, detail, valueClassName = 'text-gray-900' }) => (
  <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-4">
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.14em] text-gray-400">{label}</p>
        <p className="mt-1.5 text-xs font-medium text-gray-500">{detail}</p>
      </div>
      <p className={`shrink-0 text-lg font-black ${valueClassName}`}>{value}</p>
    </div>
  </div>
);

const SectionState: React.FC<{ text: string; minHeight?: string }> = ({ text, minHeight = 'min-h-[220px]' }) => (
  <div className={`flex items-center justify-center ${minHeight}`}>
    <p className="text-sm font-medium text-gray-400">{text}</p>
  </div>
);

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { can, canViewAdminDashboard, canViewEmployeeDashboard } = useRolePermissions();
  const { hasCapability, hasSubCapability } = useCapabilities(Boolean(user));
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [filterRange, setFilterRange] = useState<FilterRange>('All Time');
  const [customDates, setCustomDates] = useState({ from: '', to: '' });
  const [includeTime, setIncludeTime] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const canLoadDashboard = Boolean(user) && (canViewAdminDashboard || canViewEmployeeDashboard);
  const { data: snapshot, error } = useDashboardSnapshot(
    filterRange,
    customDates,
    { enabled: canLoadDashboard }
  );
  const canViewOrders = can('orders.view');
  const canViewWallet = can('wallet.view') && hasSubCapability('payroll');

  if (authLoading) {
    return <div className="p-8 text-center text-gray-500">Loading session...</div>;
  }

  if (!user) {
    return <div className="p-8 text-center text-gray-500">Not Authenticated</div>;
  }

  if (!canViewAdminDashboard && !canViewEmployeeDashboard) {
    return <div className="p-8 text-center text-gray-500">You do not have permission to view a dashboard.</div>;
  }

  const isAdmin = canViewAdminDashboard;
  const adminSnapshot = snapshot?.admin;
  const employeeSnapshot = snapshot?.employee;
  const inlinePlaceholder = error ? 'Failed to load' : 'Loading...';
  const sectionPlaceholder = error ? 'Failed to load data.' : 'Loading...';
  const expenseByCategory = (adminSnapshot?.expenseByCategory ?? []).map((entry, index) => ({
    ...entry,
    color: EXPENSE_COLORS[index % EXPENSE_COLORS.length],
  }));

  const handleOpenOrdersByStatus = (status: OrderStatus) => {
    const params = new URLSearchParams();
    params.set('status', status);
    if (filterRange !== 'All Time') params.set('range', filterRange);
    if (customDates.from) params.set('from', customDates.from);
    if (customDates.to) params.set('to', customDates.to);
    if (includeTime) params.set('includeTime', 'true');
    navigate(`/orders?${params.toString()}`);
  };

  const handleOpenMyOrders = (status?: OrderStatus, includeSelectedRange: boolean = true) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    params.set('createdBy', String(user.id));
    if (includeSelectedRange) {
      if (filterRange !== 'All Time') params.set('range', filterRange);
      if (customDates.from) params.set('from', customDates.from);
      if (customDates.to) params.set('to', customDates.to);
      if (includeTime) params.set('includeTime', 'true');
    }
    navigate(`/orders?${params.toString()}`);
  };
  const employeeComparisonRows = employeeSnapshot?.employeeComparisonRows ?? [];
  const employeeComparisonMax = Math.max(0, ...employeeComparisonRows.map((row) => row.orderCount));
  const employeeStatusTotal = employeeSnapshot?.employeeStatusSnapshot.reduce((sum, item) => sum + item.value, 0) ?? 0;
  const employeeStatusValue = (status: OrderStatus): number =>
    employeeSnapshot?.employeeStatusSnapshot.find((item) => item.status === status)?.value ?? 0;
  const employeeActiveOrders = employeeStatusValue(OrderStatus.ON_HOLD)
    + employeeStatusValue(OrderStatus.PROCESSING)
    + employeeStatusValue(OrderStatus.PICKED);
  const employeeCompletedOrders = employeeStatusValue(OrderStatus.COMPLETED);
  const employeeExceptionOrders = employeeStatusValue(OrderStatus.RETURNED) + employeeStatusValue(OrderStatus.CANCELLED);
  const employeeCompletionRate = employeeStatusTotal > 0
    ? Math.round((employeeCompletedOrders / employeeStatusTotal) * 100)
    : 0;
  const employeeExceptionRate = employeeStatusTotal > 0
    ? Math.round((employeeExceptionOrders / employeeStatusTotal) * 100)
    : 0;
  const rankedEmployeeRows = employeeComparisonRows.map((row, index) => ({ ...row, rank: index + 1 }));
  const currentEmployeeRow = rankedEmployeeRows.find((row) => row.isCurrentUser);
  const visibleEmployeeRows = rankedEmployeeRows.filter((row) => row.rank <= 5 || row.isCurrentUser);

  if (isAdmin) {
    return (
      <div className="space-y-6">
        {error && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
            Dashboard data could not be refreshed. Showing inline fallback text until the next retry succeeds.
          </div>
        )}

        <FilterBar
          filterRange={filterRange}
          setFilterRange={setFilterRange}
          customDates={customDates}
          setCustomDates={setCustomDates}
          includeTime={includeTime}
          setIncludeTime={setIncludeTime}
        />

        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
            <StatCard
              title="Total Sales"
              value={adminSnapshot ? formatCurrency(adminSnapshot.totalSales) : inlinePlaceholder}
              numericValue={adminSnapshot?.totalSales}
              showAbbreviated={!isMobile && adminSnapshot !== undefined && adminSnapshot.totalSales !== undefined}
              icon={ICONS.Sales}
              bgColor="bg-blue-600"
              textColor="text-white"
              iconBgColor="bg-blue-700"
            />
            {hasCapability('purchases') && (
              <StatCard
                title="Total Purchases"
                value={adminSnapshot ? formatCurrency(adminSnapshot.totalPurchases) : inlinePlaceholder}
                numericValue={adminSnapshot?.totalPurchases}
                showAbbreviated={!isMobile && adminSnapshot !== undefined && adminSnapshot.totalPurchases !== undefined}
                icon={ICONS.Briefcase}
                bgColor="bg-purple-600"
                textColor="text-white"
                iconBgColor="bg-purple-700"
              />
            )}
            {hasCapability('banking') && (
              <StatCard
                title="Other Expenses"
                value={adminSnapshot ? formatCurrency(adminSnapshot.otherExpenses) : inlinePlaceholder}
                numericValue={adminSnapshot?.otherExpenses}
                showAbbreviated={!isMobile && adminSnapshot !== undefined && adminSnapshot.otherExpenses !== undefined}
                icon={ICONS.Delete}
                bgColor="bg-amber-500"
                textColor="text-white"
                iconBgColor="bg-amber-600"
              />
            )}
            {hasCapability('purchases') && hasCapability('banking') && (
              <StatCard
                title="Total Profit"
                value={adminSnapshot ? formatCurrency(adminSnapshot.totalProfit) : inlinePlaceholder}
                numericValue={adminSnapshot?.totalProfit}
                showAbbreviated={!isMobile && adminSnapshot !== undefined && adminSnapshot.totalProfit !== undefined}
                icon={ICONS.Reports}
                isProfitCard={true}
                profitValue={adminSnapshot?.totalProfit}
              />
            )}
            <StatCard
              title="Total Orders"
              value={adminSnapshot ? adminSnapshot.orderCounts.total : inlinePlaceholder}
              icon={ICONS.Dashboard}
              bgColor="bg-indigo-700"
              textColor="text-white"
              iconBgColor="bg-indigo-800"
              subtotalAmount={adminSnapshot ? formatCurrency(adminSnapshot.orderTotals.total) : undefined}
              subtotalNumericValue={!isMobile ? adminSnapshot?.orderTotals.total : undefined}
            />

            <StatCard
              title="On Hold Orders"
              value={adminSnapshot ? adminSnapshot.orderCounts.onHold : inlinePlaceholder}
              icon={ICONS.More}
              bgColor="bg-orange-500"
              textColor="text-white"
              iconBgColor="bg-orange-600"
              subtotalAmount={adminSnapshot ? formatCurrency(adminSnapshot.orderTotals.onHold) : undefined}
              subtotalNumericValue={!isMobile ? adminSnapshot?.orderTotals.onHold : undefined}
              onClick={() => handleOpenOrdersByStatus(OrderStatus.ON_HOLD)}
            />
            <StatCard
              title="Processing Orders"
              value={adminSnapshot ? adminSnapshot.orderCounts.processing : inlinePlaceholder}
              icon={ICONS.More}
              bgColor="bg-sky-500"
              textColor="text-white"
              iconBgColor="bg-sky-600"
              subtotalAmount={adminSnapshot ? formatCurrency(adminSnapshot.orderTotals.processing) : undefined}
              subtotalNumericValue={!isMobile ? adminSnapshot?.orderTotals.processing : undefined}
              onClick={() => handleOpenOrdersByStatus(OrderStatus.PROCESSING)}
            />
            <StatCard
              title="Picked Orders"
              value={adminSnapshot ? adminSnapshot.orderCounts.picked : inlinePlaceholder}
              icon={ICONS.Courier}
              bgColor="bg-cyan-500"
              textColor="text-white"
              iconBgColor="bg-cyan-600"
              subtotalAmount={adminSnapshot ? formatCurrency(adminSnapshot.orderTotals.picked) : undefined}
              subtotalNumericValue={!isMobile ? adminSnapshot?.orderTotals.picked : undefined}
              onClick={() => handleOpenOrdersByStatus(OrderStatus.PICKED)}
            />
            <StatCard
              title="Delivered Orders"
              value={adminSnapshot ? adminSnapshot.orderCounts.completed : inlinePlaceholder}
              icon={ICONS.PlusCircle}
              bgColor="bg-teal-600"
              textColor="text-white"
              iconBgColor="bg-teal-700"
              subtotalAmount={adminSnapshot ? formatCurrency(adminSnapshot.orderTotals.completed) : undefined}
              subtotalNumericValue={!isMobile ? adminSnapshot?.orderTotals.completed : undefined}
              onClick={() => handleOpenOrdersByStatus(OrderStatus.COMPLETED)}
            />
            <StatCard
              title="Cancelled Orders"
              value={adminSnapshot ? adminSnapshot.orderCounts.cancelled : inlinePlaceholder}
              icon={ICONS.AlertCircle}
              bgColor="bg-red-500"
              textColor="text-white"
              iconBgColor="bg-red-600"
              subtotalAmount={adminSnapshot ? formatCurrency(adminSnapshot.orderTotals.cancelled) : undefined}
              subtotalNumericValue={!isMobile ? adminSnapshot?.orderTotals.cancelled : undefined}
              onClick={() => handleOpenOrdersByStatus(OrderStatus.CANCELLED)}
            />
          </div>
        </div>

        {hasCapability('banking') && (
        <div className="rounded-xl border border-gray-100 bg-white p-8 shadow-sm">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Cash Flow</h3>
            </div>
            <div className="flex gap-4">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-[#059669]"></div>
                <span className="text-xs font-bold uppercase text-gray-500">Income</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-red-500"></div>
                <span className="text-xs font-bold uppercase text-gray-500">Expense</span>
              </div>
            </div>
          </div>
          <div className="h-[250px]">
            {!adminSnapshot ? (
              <SectionState text={sectionPlaceholder} />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                {isMobile ? (
                  <ComposedChart data={adminSnapshot.monthlyData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 600, fill: '#94a3b8' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 600, fill: '#94a3b8' }} tickFormatter={(value) => formatDashboardInteger(Number(value))} />
                    <Tooltip
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                      cursor={{ fill: '#f8fafc' }}
                      formatter={(value: number | string | undefined, name: string | undefined) => [
                        formatCurrency(Math.abs(roundDashboardValue(Number(value || 0)))),
                        CASH_FLOW_LABELS[String(name || '')] || String(name || ''),
                      ]}
                    />
                    <Bar dataKey="income" fill="#059669" radius={[4, 4, 0, 0]} barSize={40} />
                    <Bar dataKey="expense" fill="#EF4444" radius={[4, 4, 0, 0]} barSize={40} />
                    <Line type="monotone" dataKey="profit" stroke="#8B5CF6" strokeWidth={4} dot={{ r: 6, fill: '#8B5CF6', strokeWidth: 2, stroke: '#fff' }} />
                  </ComposedChart>
                ) : (
                  <ComposedChart data={adminSnapshot.monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 600, fill: '#94a3b8' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 600, fill: '#94a3b8' }} tickFormatter={(value) => formatDashboardInteger(Number(value))} />
                    <Tooltip
                      contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                      cursor={{ fill: '#f8fafc' }}
                      formatter={(value: number | string | undefined, name: string | undefined) => [
                        formatCurrency(Math.abs(roundDashboardValue(Number(value || 0)))),
                        CASH_FLOW_LABELS[String(name || '')] || String(name || ''),
                      ]}
                    />
                    <Bar dataKey="income" fill="#059669" radius={[4, 4, 0, 0]} barSize={40} />
                    <Bar dataKey="expense" fill="#EF4444" radius={[4, 4, 0, 0]} barSize={40} />
                    <Line type="monotone" dataKey="profit" stroke="#8B5CF6" strokeWidth={4} dot={{ r: 6, fill: '#8B5CF6', strokeWidth: 2, stroke: '#fff' }} />
                  </ComposedChart>
                )}
              </ResponsiveContainer>
            )}
          </div>
        </div>
        )}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Top 5 Sold Products</h3>
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">By Qty</span>
            </div>
            {!adminSnapshot ? (
              <SectionState text={sectionPlaceholder} minHeight="min-h-[140px]" />
            ) : (
              <div className="space-y-3">
                {adminSnapshot.topSoldProducts.length === 0 ? (
                  <p className="text-sm italic text-gray-400">No completed sales in this period.</p>
                ) : (
                  adminSnapshot.topSoldProducts.map((product, index) => (
                    <div key={`${product.name}-${index}`} className="flex items-center justify-between border-b border-gray-50 pb-2 last:border-b-0 last:pb-0">
                      <span className="text-sm font-bold text-gray-900">{product.name}</span>
                      <span className="text-sm font-black text-emerald-600">{product.qty}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Top 5 Customers</h3>
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">By Sales</span>
            </div>
            {!adminSnapshot ? (
              <SectionState text={sectionPlaceholder} minHeight="min-h-[140px]" />
            ) : (
              <div className="space-y-3">
                {adminSnapshot.topCustomers.length === 0 ? (
                  <p className="text-sm italic text-gray-400">No completed sales in this period.</p>
                ) : (
                  adminSnapshot.topCustomers.map((customer, index) => (
                    <div key={`${customer.name}-${index}`} className="flex items-center justify-between border-b border-gray-50 pb-2 last:border-b-0 last:pb-0">
                      <div className="flex flex-col">
                        <span className="text-sm font-bold text-gray-900">{customer.name}</span>
                        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{customer.orders} orders</span>
                      </div>
                      <span className="text-sm font-black text-emerald-600">{formatCurrency(customer.amount)}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {hasCapability('purchases') && hasCapability('banking') && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-gray-100 bg-white p-8 shadow-sm">
            <div className="mb-8 flex items-center justify-between">
              <h3 className="text-xl font-bold text-gray-900">Profit & Loss Summary</h3>
            </div>
            <div className="space-y-6">
              <div className="flex items-center justify-between rounded-lg border border-gray-100 p-4">
                <span className="text-sm font-bold text-gray-600">Total Incomes</span>
                <span className="text-sm font-black text-gray-900">{adminSnapshot ? formatCurrency(adminSnapshot.totalSales) : inlinePlaceholder}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-gray-100 p-4">
                <span className="text-sm font-bold text-gray-600">Total Expenses</span>
                <span className="text-sm font-black text-gray-900">{adminSnapshot ? formatCurrency(adminSnapshot.totalPurchases + adminSnapshot.otherExpenses) : inlinePlaceholder}</span>
              </div>
              <div className={`flex items-center justify-between rounded-xl p-6 text-white shadow-xl ${adminSnapshot && adminSnapshot.totalProfit < 0 ? 'bg-red-600 shadow-red-600/20' : 'bg-emerald-600 shadow-emerald-600/20'}`}>
                <span className="text-sm font-black uppercase tracking-widest">Net Profit</span>
                <span className="text-sm font-black">{adminSnapshot ? formatCurrency(adminSnapshot.totalProfit) : inlinePlaceholder}</span>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-8 shadow-sm">
            <h3 className="mb-8 text-xl font-bold text-gray-900">Expenses by Category</h3>
            <div className="h-[300px]">
              {!adminSnapshot ? (
                <SectionState text={sectionPlaceholder} />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={expenseByCategory} innerRadius={0} outerRadius={100} dataKey="value">
                      {expenseByCategory.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(value: number | string | undefined) => formatCurrency(roundDashboardValue(Number(value || 0)))} />
                    {isMobile ? (
                      <Legend verticalAlign="bottom" align="center" layout="horizontal" wrapperStyle={{ paddingTop: '20px' }} />
                    ) : (
                      <Legend verticalAlign="middle" align="right" layout="vertical" />
                    )}
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
          Dashboard data could not be refreshed. Showing inline fallback text until the next retry succeeds.
        </div>
      )}

      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#0f2f57] via-[#163f70] to-[#25608f] px-6 py-6 text-white shadow-[0_20px_50px_rgba(15,47,87,0.2)] md:px-8 md:py-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-200">Employee workspace</p>
            <h1 className="mt-2 text-2xl font-black md:text-3xl">Welcome back, {user.name?.split(' ')[0] || 'there'}</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-blue-100">
              Track your order workload, understand your results, and open the records that need attention from one place.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {can('orders.create') && (
              <button
                type="button"
                onClick={() => navigate('/orders/new')}
                className="rounded-xl bg-white px-4 py-2.5 text-sm font-black text-[#0f2f57] shadow-sm transition hover:bg-blue-50"
              >
                Create order
              </button>
            )}
            {canViewOrders && (
              <button
                type="button"
                onClick={() => handleOpenMyOrders()}
                className="rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-black text-white transition hover:bg-white/20"
              >
                View my orders
              </button>
            )}
            {canViewWallet && (
              <button
                type="button"
                onClick={() => navigate('/wallet')}
                className="rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-black text-white transition hover:bg-white/20"
              >
                Open wallet
              </button>
            )}
          </div>
        </div>
      </section>

      <FilterBar
        filterRange={filterRange}
        setFilterRange={setFilterRange}
        customDates={customDates}
        setCustomDates={setCustomDates}
        includeTime={includeTime}
        setIncludeTime={setIncludeTime}
      />

      <section className={`grid gap-4 sm:grid-cols-2 ${canViewWallet ? 'xl:grid-cols-4' : 'xl:grid-cols-3'}`}>
        <EmployeeSummaryCard
          title="All-time orders"
          value={employeeSnapshot ? employeeSnapshot.myTotalCreated : inlinePlaceholder}
          hint="Every order you have created"
          icon={ICONS.Sales}
          cardClassName="bg-gradient-to-br from-[#2d5fe6] to-[#366ae8]"
          iconClassName="bg-[#2452cb]"
          onClick={canViewOrders ? () => handleOpenMyOrders(undefined, false) : undefined}
        />
        <EmployeeSummaryCard
          title="Created today"
          value={employeeSnapshot ? employeeSnapshot.myCreatedToday : inlinePlaceholder}
          hint="Your output since midnight"
          icon={ICONS.Dashboard}
          cardClassName="bg-gradient-to-br from-[#159b96] to-[#2bbdb2]"
          iconClassName="bg-[#0f817c]"
          onClick={canViewOrders ? () => {
            const params = new URLSearchParams({ createdBy: String(user.id), range: 'Today' });
            navigate(`/orders?${params.toString()}`);
          } : undefined}
        />
        <EmployeeSummaryCard
          title="Active in this view"
          value={employeeSnapshot ? employeeActiveOrders : inlinePlaceholder}
          hint="On hold, processing, or picked"
          icon={ICONS.Clock}
          cardClassName="bg-gradient-to-br from-[#ef6c00] to-[#f59e0b]"
          iconClassName="bg-[#d65f00]"
          onClick={canViewOrders ? () => handleOpenMyOrders() : undefined}
        />
        {canViewWallet && (
          <EmployeeSummaryCard
            title="Available balance"
            value={employeeSnapshot ? formatCurrency(Math.max(0, employeeSnapshot.walletBalance)) : inlinePlaceholder}
            hint="Open your private wallet details"
            icon={ICONS.Payroll}
            cardClassName="bg-gradient-to-br from-[#07854a] to-[#22b76b]"
            iconClassName="bg-[#086c3f]"
            onClick={() => navigate('/wallet')}
          />
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm md:p-7">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-xl font-black text-gray-900">My Orders by Status</h3>
              <p className="mt-1.5 text-sm font-medium text-gray-500">A clickable breakdown for the selected date range.</p>
            </div>
            <div className="rounded-full bg-[#eef5fb] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#0f2f57]">
              {employeeSnapshot ? `${employeeStatusTotal.toLocaleString('en-BD')} tracked orders` : inlinePlaceholder}
            </div>
          </div>

          {!employeeSnapshot ? (
            <SectionState text={sectionPlaceholder} minHeight="min-h-[180px]" />
          ) : (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {employeeSnapshot.employeeStatusSnapshot.map((entry) => {
                const styles = EMPLOYEE_STATUS_STYLES[entry.status];
                return (
                  <EmployeeStatusCard
                    key={entry.status}
                    title={entry.label}
                    value={entry.value}
                    total={Math.max(employeeStatusTotal, 1)}
                    valueClass={styles.valueClass}
                    barClass={styles.barClass}
                    trackClass={styles.trackClass}
                    onClick={canViewOrders ? () => handleOpenMyOrders(entry.status) : undefined}
                  />
                );
              })}
            </div>
          )}
        </section>

        <aside className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm md:p-7">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Performance overview</p>
          <h3 className="mt-2 text-xl font-black text-gray-900">Understand this view</h3>
          <p className="mt-1.5 text-sm font-medium leading-6 text-gray-500">
            These indicators use the same date filter as the status cards.
          </p>
          <div className="mt-6 space-y-3">
            <EmployeeInsight
              label="Completion rate"
              value={employeeSnapshot ? `${employeeCompletionRate}%` : inlinePlaceholder}
              detail={`${employeeCompletedOrders.toLocaleString('en-BD')} delivered orders`}
              valueClassName="text-emerald-600"
            />
            <EmployeeInsight
              label="Active workflow"
              value={employeeSnapshot ? employeeActiveOrders.toLocaleString('en-BD') : inlinePlaceholder}
              detail="Orders still moving through fulfilment"
              valueClassName="text-sky-600"
            />
            <EmployeeInsight
              label="Exception rate"
              value={employeeSnapshot ? `${employeeExceptionRate}%` : inlinePlaceholder}
              detail={`${employeeExceptionOrders.toLocaleString('en-BD')} returned or cancelled`}
              valueClassName={employeeExceptionRate > 20 ? 'text-rose-600' : 'text-amber-600'}
            />
            <EmployeeInsight
              label="Today"
              value={employeeSnapshot ? employeeSnapshot.myCreatedToday.toLocaleString('en-BD') : inlinePlaceholder}
              detail="Orders created since midnight"
              valueClassName="text-[#0f2f57]"
            />
          </div>
        </aside>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm md:p-7">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Team context</p>
            <h3 className="mt-2 text-xl font-black text-gray-900">Order activity</h3>
            <p className="mt-1.5 text-sm font-medium text-gray-500">Top performers plus your position for the selected date range.</p>
          </div>
          {currentEmployeeRow && (
            <div className="rounded-xl border border-[#d6e3f0] bg-[#f8fbff] px-4 py-3 text-sm font-bold text-[#0f2f57]">
              Your position: <span className="font-black">#{currentEmployeeRow.rank} of {rankedEmployeeRows.length}</span>
            </div>
          )}
        </div>

        {!employeeSnapshot ? (
          <SectionState text={sectionPlaceholder} minHeight="min-h-[180px]" />
        ) : employeeComparisonRows.length === 0 ? (
          <div className="mt-6 rounded-[22px] border border-dashed border-gray-200 bg-gray-50 px-6 py-14 text-center text-xs font-medium text-gray-400">
            No employee order activity matched the selected date range.
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {visibleEmployeeRows.map((entry) => (
              <EmployeeComparisonRow
                key={entry.userId}
                rank={entry.rank}
                name={entry.name}
                role={entry.role}
                orderCount={entry.orderCount}
                maxCount={employeeComparisonMax}
                isCurrentUser={entry.isCurrentUser}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default Dashboard;
