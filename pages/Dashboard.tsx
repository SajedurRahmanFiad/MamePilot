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
  icon: React.ReactNode;
  cardClassName: string;
  iconClassName: string;
}> = ({ title, value, icon, cardClassName, iconClassName }) => (
  <div className={`rounded-[12px] px-4 py-4 text-white shadow-[0_18px_40px_rgba(15,47,87,0.12)] ${cardClassName}`}>
    <div className="flex items-center gap-4">
      <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${iconClassName}`}>
        {icon}
      </div>
      <div>
        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-white/80">{title}</p>
        <p className="mt-1 text-lg font-black leading-none">{value}</p>
      </div>
    </div>
  </div>
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
      className="w-full rounded-[12px] border border-gray-100 bg-white px-4 py-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#c7dff5] hover:bg-[#f8fbff]"
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
  name: string;
  role: string;
  orderCount: number;
  maxCount: number;
  isCurrentUser: boolean;
}> = ({ name, role, orderCount, maxCount, isCurrentUser }) => {
  const width = maxCount > 0 && orderCount > 0 ? Math.max((orderCount / maxCount) * 100, 8) : 0;

  return (
    <div className={`rounded-[12px] border px-4 py-4 shadow-sm ${isCurrentUser ? 'border-[#c7dff5] bg-[#f8fbff]' : 'border-gray-100 bg-white'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-md font-black text-gray-900">{name}</p>
          <p className="mt-1 text-[10px] font-black uppercase text-gray-400">{role}</p>
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

const SectionState: React.FC<{ text: string; minHeight?: string }> = ({ text, minHeight = 'min-h-[220px]' }) => (
  <div className={`flex items-center justify-center ${minHeight}`}>
    <p className="text-sm font-medium text-gray-400">{text}</p>
  </div>
);

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { canViewAdminDashboard, canViewEmployeeDashboard } = useRolePermissions();
  const { hasCapability } = useCapabilities(Boolean(user));
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [filterRange, setFilterRange] = useState<FilterRange>('All Time');
  const [customDates, setCustomDates] = useState({ from: '', to: '' });
  const [includeTime, setIncludeTime] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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
  const { data: snapshot, error } = useDashboardSnapshot(filterRange, customDates);
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
  const employeeComparisonRows = employeeSnapshot?.employeeComparisonRows ?? [];
  const employeeComparisonMax = Math.max(0, ...employeeComparisonRows.map((row) => row.orderCount));

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

      <FilterBar
        filterRange={filterRange}
        setFilterRange={setFilterRange}
        customDates={customDates}
        setCustomDates={setCustomDates}
        includeTime={includeTime}
        setIncludeTime={setIncludeTime}
      />

      <section className="rounded-[16px] border border-gray-100 bg-white p-5 shadow-sm md:p-8">
        <div className="grid gap-4 xl:grid-cols-4">
          <EmployeeSummaryCard
            title="Total Created"
            value={employeeSnapshot ? employeeSnapshot.myTotalCreated : inlinePlaceholder}
            icon={ICONS.Sales}
            cardClassName="bg-gradient-to-r from-[#2d5fe6] to-[#366ae8]"
            iconClassName="bg-[#2452cb]"
          />
          <EmployeeSummaryCard
            title="Created Today"
            value={employeeSnapshot ? employeeSnapshot.myCreatedToday : inlinePlaceholder}
            icon={ICONS.Dashboard}
            cardClassName="bg-gradient-to-r from-[#1fa9a2] to-[#2bbdb2]"
            iconClassName="bg-[#14948d]"
          />
          <EmployeeSummaryCard
            title="On Hold"
            value={employeeSnapshot ? employeeSnapshot.myPendingOrders : inlinePlaceholder}
            icon={ICONS.More}
            cardClassName="bg-gradient-to-r from-[#ff7a11] to-[#ff7a11]"
            iconClassName="bg-[#ef6800]"
          />
          {hasCapability('human_resources') && (
          <EmployeeSummaryCard
            title="Wallet Balance"
            value={employeeSnapshot ? formatCurrency(employeeSnapshot.walletBalance) : inlinePlaceholder}
            icon={ICONS.Payroll}
            cardClassName="bg-gradient-to-r from-[#119f57] to-[#43cf7f]"
            iconClassName="bg-[#0d7f46]"
          />
          )}
        </div>

        <div className="mt-8 border-t border-gray-100 pt-8">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-xl font-black text-gray-900">My Orders by Status</h3>
              <p className="mt-1.5 text-xs font-medium text-gray-400">Based on the selected date range</p>
            </div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Quick Status Snapshot</p>
          </div>

          {!employeeSnapshot ? (
            <SectionState text={sectionPlaceholder} minHeight="min-h-[180px]" />
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              {employeeSnapshot.employeeStatusSnapshot.map((entry) => {
                const styles = EMPLOYEE_STATUS_STYLES[entry.status];
                return (
                  <EmployeeStatusCard
                    key={entry.status}
                    title={entry.label}
                    value={entry.value}
                    total={Math.max(
                      employeeSnapshot.employeeStatusSnapshot.reduce((sum, item) => sum + item.value, 0),
                      1
                    )}
                    valueClass={styles.valueClass}
                    barClass={styles.barClass}
                    trackClass={styles.trackClass}
                    onClick={() => {
                      const params = new URLSearchParams();
                      params.set('status', entry.status);
                      params.set('createdBy', String(user.id));
                      if (filterRange !== 'All Time') params.set('range', filterRange);
                      if (customDates.from) params.set('from', customDates.from);
                      if (customDates.to) params.set('to', customDates.to);
                      if (includeTime) params.set('includeTime', 'true');
                      navigate(`/orders?${params.toString()}`);
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[16px] border border-gray-100 bg-white p-5 shadow-sm md:p-8">
        <div>
          <h3 className="text-xl font-black text-gray-900">Order Comparison</h3>
          <p className="mt-1 text-xs font-medium text-gray-400">Orders created by all employees in the selected date range</p>
        </div>

        {!employeeSnapshot ? (
          <SectionState text={sectionPlaceholder} minHeight="min-h-[180px]" />
        ) : employeeComparisonRows.length === 0 ? (
          <div className="mt-6 rounded-[22px] border border-dashed border-gray-200 bg-gray-50 px-6 py-14 text-center text-xs font-medium text-gray-400">
            No employee order activity matched the selected date range.
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            {employeeComparisonRows.map((entry) => (
              <EmployeeComparisonRow
                key={entry.userId}
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
