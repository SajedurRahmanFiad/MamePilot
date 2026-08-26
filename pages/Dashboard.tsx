import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasAdminAccess, OrderStatus } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { StatCard } from '../components/Card';
import { FilterBar } from '../components';
import type { FilterRange } from '../utils';
import { useAuth } from '../src/contexts/AuthProvider';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { useDashboardSettings, useDashboardSnapshot, useSystemDefaults } from '../src/hooks/useQueries';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import {
  ADMIN_DEFAULT_DASHBOARD_ID,
  DASHBOARD_KPI_DEFINITIONS,
  DASHBOARD_WIDGET_DEFINITIONS,
  EMPLOYEE_DEFAULT_DASHBOARD_ID,
  dashboardHasScope,
  dashboardItemIsAvailable,
  getDefaultWidgetWidthPercent,
  normalizeDashboardSettings,
} from '../src/dashboardConfig';
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
  return Number.isFinite(numericValue) ? Math.round(numericValue) : 0;
};

const formatDashboardInteger = (value: number): string => roundDashboardValue(value).toLocaleString('en-BD');
const CASH_FLOW_LABELS: Record<string, string> = { income: 'Income', expense: 'Expense', profit: 'Profit' };
const EXPENSE_COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

const EMPLOYEE_STATUS_STYLES: Record<OrderStatus, { valueClass: string; barClass: string; trackClass: string }> = {
  [OrderStatus.CREATED]: { valueClass: 'text-gray-500', barClass: 'bg-gray-500', trackClass: 'bg-gray-100' },
  [OrderStatus.ON_HOLD]: { valueClass: 'text-amber-500', barClass: 'bg-amber-500', trackClass: 'bg-amber-100' },
  [OrderStatus.PROCESSING]: { valueClass: 'text-sky-500', barClass: 'bg-sky-500', trackClass: 'bg-sky-100' },
  [OrderStatus.COURIER_ASSIGNED]: { valueClass: 'text-blue-600', barClass: 'bg-blue-600', trackClass: 'bg-blue-100' },
  [OrderStatus.PICKED]: { valueClass: 'text-cyan-500', barClass: 'bg-cyan-500', trackClass: 'bg-cyan-100' },
  [OrderStatus.COMPLETED]: { valueClass: 'text-emerald-500', barClass: 'bg-emerald-500', trackClass: 'bg-emerald-100' },
  [OrderStatus.PARTIALLY_DELIVERED]: { valueClass: 'text-amber-500', barClass: 'bg-amber-500', trackClass: 'bg-amber-100' },
  [OrderStatus.PENDING_PARTIAL]: { valueClass: 'text-orange-500', barClass: 'bg-orange-500', trackClass: 'bg-orange-100' },
  [OrderStatus.PENDING_DELIVERED]: { valueClass: 'text-amber-500', barClass: 'bg-amber-500', trackClass: 'bg-amber-100' },
  [OrderStatus.EXCHANGE_PROCESSING]: { valueClass: 'text-blue-500', barClass: 'bg-blue-500', trackClass: 'bg-blue-100' },
  [OrderStatus.EXCHANGE_PICKED]: { valueClass: 'text-purple-500', barClass: 'bg-purple-500', trackClass: 'bg-purple-100' },
  [OrderStatus.EXCHANGE_DELIVERED]: { valueClass: 'text-emerald-500', barClass: 'bg-emerald-500', trackClass: 'bg-emerald-100' },
  [OrderStatus.EXCHANGE_RETURNED]: { valueClass: 'text-orange-500', barClass: 'bg-orange-500', trackClass: 'bg-orange-100' },
  [OrderStatus.EXCHANGE_CANCELLED]: { valueClass: 'text-red-500', barClass: 'bg-red-500', trackClass: 'bg-red-100' },
  [OrderStatus.RETURNED]: { valueClass: 'text-orange-500', barClass: 'bg-orange-500', trackClass: 'bg-orange-100' },
  [OrderStatus.CANCELLED]: { valueClass: 'text-rose-500', barClass: 'bg-rose-500', trackClass: 'bg-rose-100' },
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
  <button type="button" onClick={onClick} disabled={!onClick} className={`group w-full rounded-2xl px-5 py-5 text-left text-white shadow-[0_18px_40px_rgba(15,47,87,0.12)] transition focus:outline-none focus:ring-2 focus:ring-[#3c5a82] focus:ring-offset-2 ${onClick ? 'hover:-translate-y-0.5 hover:shadow-[0_22px_44px_rgba(15,47,87,0.18)]' : 'cursor-default'} ${cardClassName}`}>
    <div className="flex items-center gap-4">
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${iconClassName}`}>{icon}</div>
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
  value: number;
  total: number;
  valueClass: string;
  barClass: string;
  trackClass: string;
  onClick?: () => void;
}> = ({ title, value, total, valueClass, barClass, trackClass, onClick }) => {
  const width = total > 0 && value > 0 ? Math.max((value / total) * 100, 8) : 0;
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className={`w-full rounded-[12px] border border-gray-100 bg-white px-4 py-4 text-left shadow-sm transition-all ${onClick ? 'hover:-translate-y-0.5 hover:border-[#c7dff5] hover:bg-[#f8fbff]' : 'cursor-default'}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[16px] font-black text-gray-900">{title}</p>
        <p className={`text-lg font-black leading-none ${valueClass}`}>{value}</p>
      </div>
      <div className={`mt-5 h-3 overflow-hidden rounded-full ${trackClass}`}><div className={`h-full rounded-full ${barClass}`} style={{ width: `${width}%` }} /></div>
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
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${isCurrentUser ? 'bg-[#0f2f57] text-white' : 'bg-gray-100 text-gray-500'}`}>{rank}</span>
          <div className="min-w-0"><p className="truncate text-md font-black text-gray-900">{name}{isCurrentUser ? ' (You)' : ''}</p><p className="mt-1 text-[10px] font-black uppercase text-gray-400">{role}</p></div>
        </div>
        <div className="text-right"><p className="text-lg font-black leading-none text-[#0f172a]">{orderCount}</p><p className="mt-1 text-[10px] font-black uppercase text-gray-400">Orders</p></div>
      </div>
      <div className="mt-5 h-3 overflow-hidden rounded-full bg-[#e8edf5]"><div className="h-full rounded-full bg-[#94a3b8]" style={{ width: `${width}%` }} /></div>
    </div>
  );
};

const EmployeeInsight: React.FC<{ label: string; value: string; detail: string; valueClassName?: string }> = ({ label, value, detail, valueClassName = 'text-gray-900' }) => (
  <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-4">
    <div className="flex items-start justify-between gap-4">
      <div><p className="text-xs font-black uppercase tracking-[0.14em] text-gray-400">{label}</p><p className="mt-1.5 text-xs font-medium text-gray-500">{detail}</p></div>
      <p className={`shrink-0 text-lg font-black ${valueClassName}`}>{value}</p>
    </div>
  </div>
);

const SectionState: React.FC<{ text: string; minHeight?: string }> = ({ text, minHeight = 'min-h-[220px]' }) => <div className={`flex items-center justify-center ${minHeight}`}><p className="text-sm font-medium text-gray-400">{text}</p></div>;

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { can, canViewAdminDashboard, canViewEmployeeDashboard, permissionsSettings, role } = useRolePermissions();
  const { hasCapability, hasSubCapability } = useCapabilities(Boolean(user));
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isDesktop, setIsDesktop] = useState(window.innerWidth >= 1024);
  const [filterRange, setFilterRange] = useState<FilterRange>('All Time');
  const [customDates, setCustomDates] = useState({ from: '', to: '' });
  const [includeTime, setIncludeTime] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
      setIsDesktop(window.innerWidth >= 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const canLoadDashboard = Boolean(user) && (canViewAdminDashboard || canViewEmployeeDashboard);
  const { data: dashboardSettingsData } = useDashboardSettings(canLoadDashboard);
  const { data: systemDefaults } = useSystemDefaults();
  const dashboardSettings = useMemo(() => normalizeDashboardSettings(dashboardSettingsData), [dashboardSettingsData]);
  const assignedDashboardId = permissionsSettings?.roles.find((candidate) => candidate.roleName === role)?.dashboardId
    || (hasAdminAccess(user?.role) || canViewAdminDashboard ? ADMIN_DEFAULT_DASHBOARD_ID : EMPLOYEE_DEFAULT_DASHBOARD_ID);
  const dashboard = dashboardSettings.dashboards.find((candidate) => candidate.id === assignedDashboardId)
    || dashboardSettings.dashboards.find((candidate) => candidate.id === (canViewAdminDashboard ? ADMIN_DEFAULT_DASHBOARD_ID : EMPLOYEE_DEFAULT_DASHBOARD_ID))
    || dashboardSettings.dashboards[0];
  const { data: snapshot, error } = useDashboardSnapshot(filterRange, customDates, { enabled: canLoadDashboard });
  const canViewOrders = can('orders.view');
  const canViewWallet = can('wallet.view') && hasSubCapability('payroll');

  if (authLoading) return <div className="p-8 text-center text-gray-500">Loading session...</div>;
  if (!user) return <div className="p-8 text-center text-gray-500">Not Authenticated</div>;
  if (!canLoadDashboard || !dashboard) return <div className="p-8 text-center text-gray-500">You do not have permission to view a dashboard.</div>;

  const adminSnapshot = snapshot?.admin;
  const employeeSnapshot = snapshot?.employee;
  const inlinePlaceholder = error ? 'Failed to load' : 'Loading...';
  const sectionPlaceholder = error ? 'Failed to load data.' : 'Loading...';
  const expenseByCategory = (adminSnapshot?.expenseByCategory ?? []).map((entry, index) => ({ ...entry, color: EXPENSE_COLORS[index % EXPENSE_COLORS.length] }));

  const handleOpenOrdersByStatus = (status: OrderStatus | string) => {
    const params = new URLSearchParams({ status });
    if (filterRange !== 'All Time') params.set('range', filterRange);
    if (customDates.from) params.set('from', customDates.from);
    if (customDates.to) params.set('to', customDates.to);
    if (includeTime) params.set('includeTime', 'true');
    navigate(`/orders?${params.toString()}`);
  };
  const handleOpenOrdersByPaymentStatus = (paymentStatus: string) => {
    const params = new URLSearchParams({ paymentStatus });
    if (filterRange !== 'All Time') params.set('range', filterRange);
    if (customDates.from) params.set('from', customDates.from);
    if (customDates.to) params.set('to', customDates.to);
    if (includeTime) params.set('includeTime', 'true');
    navigate(`/orders?${params.toString()}`);
  };
  const handleOpenMyOrders = (status?: OrderStatus, includeSelectedRange = true) => {
    const params = new URLSearchParams({ createdBy: String(user.id) });
    if (status) params.set('status', status);
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
  const employeeStatusValue = (status: OrderStatus): number => employeeSnapshot?.employeeStatusSnapshot.find((item) => item.status === status)?.value ?? 0;
  const employeeActiveOrders = employeeStatusValue(OrderStatus.ON_HOLD) + employeeStatusValue(OrderStatus.PROCESSING) + employeeStatusValue(OrderStatus.PICKED);
  const employeeCompletedOrders = employeeStatusValue(OrderStatus.COMPLETED);
  const employeeExceptionOrders = employeeStatusValue(OrderStatus.RETURNED) + employeeStatusValue(OrderStatus.CANCELLED);
  const employeeCompletionRate = employeeStatusTotal > 0 ? Math.round((employeeCompletedOrders / employeeStatusTotal) * 100) : 0;
  const employeeExceptionRate = employeeStatusTotal > 0 ? Math.round((employeeExceptionOrders / employeeStatusTotal) * 100) : 0;
  const rankedEmployeeRows = employeeComparisonRows.map((row, index) => ({ ...row, rank: index + 1 }));
  const currentEmployeeRow = rankedEmployeeRows.find((row) => row.isCurrentUser);
  const visibleEmployeeRows = rankedEmployeeRows.filter((row) => row.rank <= 5 || row.isCurrentUser);

  const definitionAvailable = (definition: (typeof DASHBOARD_KPI_DEFINITIONS)[number]) => dashboardItemIsAvailable(
    definition,
    hasCapability,
    (key) => hasSubCapability(key as any),
  ) || (
    ['admin.totalPurchases', 'admin.totalProfit'].includes(definition.key)
    && !hasCapability('purchases')
    && Boolean(systemDefaults?.calculateCogsFromPurchasePrice)
  );
  const kpiDefinitionByKey = new Map(DASHBOARD_KPI_DEFINITIONS.map((definition) => [definition.key, definition]));
  const widgetDefinitionByKey = new Map(DASHBOARD_WIDGET_DEFINITIONS.map((definition) => [definition.key, definition]));
  const enabledKpis = dashboard.kpiCards.filter((item) => item.enabled
    && definitionAvailable(kpiDefinitionByKey.get(item.key)!)
    && (item.key !== 'employee.availableBalance' || canViewWallet));
  const enabledWidgets = dashboard.widgets.filter((item) => item.enabled && definitionAvailable(widgetDefinitionByKey.get(item.key)!));
  const showEmployeeWorkspace = dashboardHasScope(dashboard, 'employee');

  const renderKpi = (key: string): React.ReactNode => {
    const orderCard = (title: string, countKey: keyof NonNullable<typeof adminSnapshot>['orderCounts'], status: OrderStatus | string, bgColor: string, iconBgColor: string, icon: React.ReactNode) => (
      <StatCard title={title} value={adminSnapshot ? adminSnapshot.orderCounts[countKey] : inlinePlaceholder} icon={icon} bgColor={bgColor} textColor="text-white" iconBgColor={iconBgColor} subtotalAmount={adminSnapshot ? formatCurrency(adminSnapshot.orderTotals[countKey]) : undefined} subtotalNumericValue={!isMobile ? adminSnapshot?.orderTotals[countKey] : undefined} onClick={canViewOrders ? () => handleOpenOrdersByStatus(status) : undefined} />
    );
    const paymentCard = (title: string, countKey: keyof NonNullable<typeof adminSnapshot>['paymentCounts'], paymentStatus: string, bgColor: string, iconBgColor: string, icon: React.ReactNode) => (
      <StatCard title={title} value={adminSnapshot ? adminSnapshot.paymentCounts[countKey] : inlinePlaceholder} icon={icon} bgColor={bgColor} textColor="text-white" iconBgColor={iconBgColor} subtotalAmount={adminSnapshot ? formatCurrency(adminSnapshot.paymentTotals[countKey]) : undefined} subtotalNumericValue={!isMobile ? adminSnapshot?.paymentTotals[countKey] : undefined} onClick={canViewOrders ? () => handleOpenOrdersByPaymentStatus(paymentStatus) : undefined} />
    );
    switch (key) {
      case 'admin.totalSales': return <StatCard title="Total Sales" value={adminSnapshot ? formatCurrency(adminSnapshot.totalSales) : inlinePlaceholder} numericValue={adminSnapshot?.totalSales} showAbbreviated={!isMobile && adminSnapshot !== undefined} icon={ICONS.Sales} bgColor="bg-blue-600" textColor="text-white" iconBgColor="bg-blue-700" />;
      case 'admin.totalPurchases': return <StatCard title="Total Purchases" value={adminSnapshot ? formatCurrency(adminSnapshot.totalPurchases) : inlinePlaceholder} numericValue={adminSnapshot?.totalPurchases} showAbbreviated={!isMobile && adminSnapshot !== undefined} icon={ICONS.Briefcase} bgColor="bg-purple-600" textColor="text-white" iconBgColor="bg-purple-700" />;
      case 'admin.otherExpenses': return <StatCard title="Other Expenses" value={adminSnapshot ? formatCurrency(adminSnapshot.otherExpenses) : inlinePlaceholder} numericValue={adminSnapshot?.otherExpenses} showAbbreviated={!isMobile && adminSnapshot !== undefined} icon={ICONS.Delete} bgColor="bg-amber-500" textColor="text-white" iconBgColor="bg-amber-600" />;
      case 'admin.totalProfit': return <StatCard title="Total Profit" value={adminSnapshot ? formatCurrency(adminSnapshot.totalProfit) : inlinePlaceholder} numericValue={adminSnapshot?.totalProfit} showAbbreviated={!isMobile && adminSnapshot !== undefined} icon={ICONS.Reports} isProfitCard profitValue={adminSnapshot?.totalProfit} />;
      case 'admin.totalOrders': return <StatCard title="Total Orders" value={adminSnapshot ? adminSnapshot.orderCounts.total : inlinePlaceholder} icon={ICONS.Dashboard} bgColor="bg-indigo-700" textColor="text-white" iconBgColor="bg-indigo-800" subtotalAmount={adminSnapshot ? formatCurrency(adminSnapshot.orderTotals.total) : undefined} subtotalNumericValue={!isMobile ? adminSnapshot?.orderTotals.total : undefined} />;
      case 'admin.onHoldOrders': return orderCard('On Hold Orders', 'onHold', OrderStatus.ON_HOLD, 'bg-orange-500', 'bg-orange-600', ICONS.More);
      case 'admin.processingOrders': return orderCard('Processing Orders', 'processing', OrderStatus.PROCESSING, 'bg-sky-500', 'bg-sky-600', ICONS.More);
      case 'admin.courierAssignedOrders': return orderCard('Courier Assigned Orders', 'courierAssigned', OrderStatus.COURIER_ASSIGNED, 'bg-blue-600', 'bg-blue-700', ICONS.Courier);
      case 'admin.pickedOrders': return orderCard('Picked Orders', 'picked', OrderStatus.PICKED, 'bg-cyan-500', 'bg-cyan-600', ICONS.Courier);
      case 'admin.deliveredOrders': return orderCard('Delivered Orders', 'completed', OrderStatus.COMPLETED, 'bg-teal-600', 'bg-teal-700', ICONS.PlusCircle);
      case 'admin.partiallyDeliveredOrders': return orderCard('Partially Delivered Orders', 'partiallyDelivered', `${OrderStatus.PARTIALLY_DELIVERED},${OrderStatus.PENDING_PARTIAL}`, 'bg-amber-500', 'bg-amber-600', ICONS.Clock);
      case 'admin.exchangedOrders': return <StatCard title="Exchanged Orders" value={adminSnapshot ? adminSnapshot.orderCounts.exchangeTotal : inlinePlaceholder} icon={ICONS.Transfer} bgColor="bg-violet-700" textColor="text-white" iconBgColor="bg-violet-800" subtotalAmount={adminSnapshot ? formatCurrency(adminSnapshot.orderTotals.exchangeTotal) : undefined} subtotalNumericValue={!isMobile ? adminSnapshot?.orderTotals.exchangeTotal : undefined} />;
      case 'admin.exchangeProcessingOrders': return orderCard('Exchange Processing Orders', 'exchangeProcessing', OrderStatus.EXCHANGE_PROCESSING, 'bg-indigo-500', 'bg-indigo-600', ICONS.Transfer);
      case 'admin.exchangePickedOrders': return orderCard('Exchange Picked Orders', 'exchangePicked', OrderStatus.EXCHANGE_PICKED, 'bg-purple-500', 'bg-purple-600', ICONS.Courier);
      case 'admin.exchangeDeliveredOrders': return orderCard('Exchange Delivered Orders', 'exchangeDelivered', OrderStatus.EXCHANGE_DELIVERED, 'bg-emerald-600', 'bg-emerald-700', ICONS.PlusCircle);
      case 'admin.exchangeReturnedOrders': return orderCard('Exchange Returned Orders', 'exchangeReturned', OrderStatus.EXCHANGE_RETURNED, 'bg-orange-600', 'bg-orange-700', ICONS.Transfer);
      case 'admin.exchangeCancelledOrders': return orderCard('Exchange Cancelled Orders', 'exchangeCancelled', OrderStatus.EXCHANGE_CANCELLED, 'bg-rose-600', 'bg-rose-700', ICONS.AlertCircle);
      case 'admin.returnedOrders': return orderCard('Returned Orders', 'returned', OrderStatus.RETURNED, 'bg-orange-600', 'bg-orange-700', ICONS.Transfer);
      case 'admin.cancelledOrders': return orderCard('Cancelled Orders', 'cancelled', OrderStatus.CANCELLED, 'bg-red-500', 'bg-red-600', ICONS.AlertCircle);
      case 'admin.paidOrders': return paymentCard('Paid Orders', 'paid', 'Paid', 'bg-emerald-600', 'bg-emerald-700', ICONS.PlusCircle);
      case 'admin.partiallyPaidOrders': return paymentCard('Partially Paid Orders', 'partiallyPaid', 'Partially Paid', 'bg-amber-500', 'bg-amber-600', ICONS.Clock);
      case 'admin.unpaidOrders': return paymentCard('Unpaid Orders', 'unpaid', 'Unpaid', 'bg-red-600', 'bg-red-700', ICONS.AlertCircle);
      case 'admin.overpaidOrders': return paymentCard('Overpaid Orders', 'overpaid', 'Overpaid', 'bg-green-700', 'bg-green-800', ICONS.Sales);
      case 'admin.refundedOrders': return paymentCard('Refunded Orders', 'refunded', 'Refunded', 'bg-orange-700', 'bg-orange-800', ICONS.Transfer);
      case 'employee.allTimeOrders': return <EmployeeSummaryCard title="All-time orders" value={employeeSnapshot ? employeeSnapshot.myTotalCreated : inlinePlaceholder} hint="Every order you have created" icon={ICONS.Sales} cardClassName="bg-gradient-to-br from-[#2d5fe6] to-[#366ae8]" iconClassName="bg-[#2452cb]" onClick={canViewOrders ? () => handleOpenMyOrders(undefined, false) : undefined} />;
      case 'employee.createdToday': return <EmployeeSummaryCard title="Created today" value={employeeSnapshot ? employeeSnapshot.myCreatedToday : inlinePlaceholder} hint="Your output since midnight" icon={ICONS.Dashboard} cardClassName="bg-gradient-to-br from-[#159b96] to-[#2bbdb2]" iconClassName="bg-[#0f817c]" onClick={canViewOrders ? () => navigate(`/orders?${new URLSearchParams({ createdBy: String(user.id), range: 'Today' })}`) : undefined} />;
      case 'employee.activeOrders': return <EmployeeSummaryCard title="Active in this view" value={employeeSnapshot ? employeeActiveOrders : inlinePlaceholder} hint="On hold, processing, or picked" icon={ICONS.Clock} cardClassName="bg-gradient-to-br from-[#ef6c00] to-[#f59e0b]" iconClassName="bg-[#d65f00]" onClick={canViewOrders ? () => handleOpenMyOrders() : undefined} />;
      case 'employee.availableBalance': return <EmployeeSummaryCard title="Available balance" value={employeeSnapshot ? formatCurrency(Math.max(0, employeeSnapshot.walletBalance)) : inlinePlaceholder} hint="Open your private wallet details" icon={ICONS.Payroll} cardClassName="bg-gradient-to-br from-[#07854a] to-[#22b76b]" iconClassName="bg-[#086c3f]" onClick={canViewWallet ? () => navigate('/wallet') : undefined} />;
      default: return null;
    }
  };

  const renderWidget = (key: string): React.ReactNode => {
    switch (key) {
      case 'admin.cashFlow': return (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm md:p-8">
          <div className="mb-8 flex items-center justify-between"><h3 className="text-xl font-bold text-gray-900">Cash Flow</h3><div className="flex gap-4"><span className="flex items-center gap-2 text-xs font-bold uppercase text-gray-500"><i className="h-3 w-3 rounded-full bg-[#059669]" />Income</span><span className="flex items-center gap-2 text-xs font-bold uppercase text-gray-500"><i className="h-3 w-3 rounded-full bg-red-500" />Expense</span><span className="flex items-center gap-2 text-xs font-bold uppercase text-gray-500"><i className="h-3 w-3 rounded-full bg-[#8B5CF6]" />Profit</span></div></div>
          <div className="h-[250px]">{!adminSnapshot ? <SectionState text={sectionPlaceholder} /> : <ResponsiveContainer width="100%" height="100%"><ComposedChart data={adminSnapshot.monthlyData} margin={isMobile ? { top: 10, right: 0, left: -20, bottom: 0 } : undefined}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" /><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 600, fill: '#94a3b8' }} /><YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 600, fill: '#94a3b8' }} tickFormatter={(value) => formatDashboardInteger(Number(value))} /><Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }} cursor={{ fill: '#f8fafc' }} formatter={((value: any, name: any) => [formatCurrency(Math.abs(roundDashboardValue(Number(value || 0)))), CASH_FLOW_LABELS[String(name || '')] || String(name || '')]) as any} /><Bar dataKey="income" fill="#059669" radius={[4, 4, 0, 0]} barSize={40} /><Bar dataKey="expense" fill="#EF4444" radius={[4, 4, 0, 0]} barSize={40} /><Line type="monotone" dataKey="profit" stroke="#8B5CF6" strokeWidth={4} dot={{ r: 6, fill: '#8B5CF6', strokeWidth: 2, stroke: '#fff' }} /></ComposedChart></ResponsiveContainer>}</div>
        </div>
      );
      case 'admin.topSoldProducts': return (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm"><div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold text-gray-900">Top 5 Sold Products</h3><span className="text-[10px] font-black uppercase tracking-widest text-gray-400">By Qty</span></div>{!adminSnapshot ? <SectionState text={sectionPlaceholder} minHeight="min-h-[140px]" /> : <div className="space-y-3">{adminSnapshot.topSoldProducts.length === 0 ? <p className="text-sm italic text-gray-400">No completed sales in this period.</p> : adminSnapshot.topSoldProducts.map((product, index) => <div key={`${product.name}-${index}`} className="flex items-center justify-between border-b border-gray-50 pb-2 last:border-b-0"><div className="flex min-w-0 items-center gap-3">{product.image ? <img src={product.image} alt={product.name} className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-[10px] font-black text-gray-400">{product.name.charAt(0).toUpperCase()}</div>}<span className="truncate text-sm font-bold text-gray-900">{product.name}</span></div><span className="text-sm font-black text-emerald-600">{product.qty}</span></div>)}</div>}</div>
      );
      case 'admin.topSoldBatches': return (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm"><div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold text-gray-900">Top 5 Sold Batches</h3><span className="text-[10px] font-black uppercase tracking-widest text-gray-400">By Qty</span></div>{!adminSnapshot ? <SectionState text={sectionPlaceholder} minHeight="min-h-[140px]" /> : <div className="space-y-3">{adminSnapshot.topSoldBatches.length === 0 ? <p className="text-sm italic text-gray-400">No batch sales in this period.</p> : adminSnapshot.topSoldBatches.map((batch, index) => <div key={`${batch.name}-${index}`} className="flex items-center justify-between border-b border-gray-50 pb-2 last:border-b-0"><div className="flex min-w-0 items-center gap-3">{batch.image ? <img src={batch.image} alt={batch.name} className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-[10px] font-black text-emerald-600">{batch.name.charAt(0).toUpperCase()}</div>}<span className="truncate text-sm font-bold text-gray-900">{batch.name}</span></div><span className="text-sm font-black text-emerald-600">{batch.qty}</span></div>)}</div>}</div>
      );
      case 'admin.lowStockProducts': return (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm"><div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold text-gray-900">Low Stock Products</h3><span className="text-[10px] font-black uppercase tracking-widest text-gray-400">At or Below {adminSnapshot ? adminSnapshot.lowStockThreshold : '—'}</span></div>{!adminSnapshot ? <SectionState text={sectionPlaceholder} minHeight="min-h-[140px]" /> : <div className="space-y-3">{adminSnapshot.lowStockProducts.length === 0 ? <p className="text-sm italic text-gray-400">No products below the threshold.</p> : adminSnapshot.lowStockProducts.map((item, index) => <div key={`${item.name}-${index}`} className="flex items-center justify-between border-b border-gray-50 pb-2 last:border-b-0"><div className="flex min-w-0 items-center gap-3">{item.image ? <img src={item.image} alt={item.name} className="h-9 w-9 shrink-0 rounded-lg object-cover" /> : <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-[10px] font-black text-gray-400">{item.name.charAt(0).toUpperCase()}</div>}<span className="min-w-0"><span className="block truncate text-sm font-bold text-gray-900">{item.name}</span><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{item.itemType === 'batch' ? 'Batch' : 'Product'}</span></span></div><span className="text-sm font-black text-rose-600">{item.stock} left</span></div>)}</div>}</div>
      );
      case 'admin.topCustomers': return (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm"><div className="mb-4 flex items-center justify-between"><h3 className="text-lg font-bold text-gray-900">Top 5 Customers</h3><span className="text-[10px] font-black uppercase tracking-widest text-gray-400">By Sales</span></div>{!adminSnapshot ? <SectionState text={sectionPlaceholder} minHeight="min-h-[140px]" /> : <div className="space-y-3">{adminSnapshot.topCustomers.length === 0 ? <p className="text-sm italic text-gray-400">No completed sales in this period.</p> : adminSnapshot.topCustomers.map((customer, index) => <div key={`${customer.name}-${index}`} className="flex items-center justify-between border-b border-gray-50 pb-2 last:border-b-0"><div className="flex min-w-0 items-center gap-3"><img src={customer.image || '/uploads/Empty_avatar.png'} alt={customer.name} className="h-9 w-9 shrink-0 rounded-full object-cover" /><div className="min-w-0"><span className="block truncate text-sm font-bold text-gray-900">{customer.name}</span><span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{customer.orders} orders</span></div></div><span className="text-sm font-black text-emerald-600">{formatCurrency(customer.amount)}</span></div>)}</div>}</div>
      );
      case 'admin.profitLoss': return (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm md:p-8"><h3 className="mb-8 text-xl font-bold text-gray-900">Profit & Loss Summary</h3><div className="space-y-6"><div className="flex items-center justify-between rounded-lg border border-gray-100 p-4"><span className="text-sm font-bold text-gray-600">Total Incomes</span><span className="text-sm font-black text-gray-900">{adminSnapshot ? formatCurrency(adminSnapshot.totalSales) : inlinePlaceholder}</span></div><div className="flex items-center justify-between rounded-lg border border-gray-100 p-4"><span className="text-sm font-bold text-gray-600">Total Expenses</span><span className="text-sm font-black text-gray-900">{adminSnapshot ? formatCurrency(adminSnapshot.totalPurchases + adminSnapshot.otherExpenses) : inlinePlaceholder}</span></div><div className={`flex items-center justify-between rounded-xl p-6 text-white shadow-xl ${adminSnapshot && adminSnapshot.totalProfit < 0 ? 'bg-red-600' : 'bg-emerald-600'}`}><span className="text-sm font-black uppercase tracking-widest">Net Profit</span><span className="text-sm font-black">{adminSnapshot ? formatCurrency(adminSnapshot.totalProfit) : inlinePlaceholder}</span></div></div></div>
      );
      case 'admin.expensesByCategory': return (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm md:p-8"><h3 className="mb-8 text-xl font-bold text-gray-900">Expenses by Category</h3><div className="h-[300px]">{!adminSnapshot ? <SectionState text={sectionPlaceholder} /> : <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={expenseByCategory} innerRadius={0} outerRadius={100} dataKey="value">{expenseByCategory.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}</Pie><Tooltip formatter={((value: any) => formatCurrency(roundDashboardValue(Number(value || 0)))) as any} /><Legend verticalAlign={isMobile ? 'bottom' : 'middle'} align={isMobile ? 'center' : 'right'} layout={isMobile ? 'horizontal' : 'vertical'} /></PieChart></ResponsiveContainer>}</div></div>
      );
      case 'admin.actionRequired': return (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm md:p-8">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h3 className="text-xl font-bold text-gray-900">Action Required</h3>
              <p className="mt-1 text-sm font-medium text-gray-500">Orders awaiting partial delivery or delivery confirmation.</p>
            </div>
            {canViewOrders && (
              <button type="button" onClick={() => navigate('/orders?status=pending_partial')} className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-black text-gray-700 hover:bg-gray-50">View all</button>
            )}
          </div>
          {!adminSnapshot ? (
            <SectionState text={sectionPlaceholder} minHeight="min-h-[140px]" />
          ) : adminSnapshot.actionRequiredOrders.length === 0 ? (
            <p className="text-sm italic text-gray-400">No orders awaiting action.</p>
          ) : (
            <div className="space-y-3">
              {adminSnapshot.actionRequiredOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between border-b border-gray-50 pb-3 last:border-b-0">
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-bold text-gray-900">#{order.orderNumber}</span>
                    <span className="text-xs font-medium text-gray-500">{order.customerName || 'Unknown customer'}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-black text-amber-600">{formatCurrency(order.partialCodAmount)}</span>
                    {canViewOrders && (
                      <button type="button" onClick={() => navigate(`/orders/${order.id}`)} className="rounded-lg bg-emerald-500 p-1.5 text-white hover:bg-emerald-600" title="Complete order">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
      case 'employee.ordersByStatus': return (
        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm md:p-7"><div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h3 className="text-xl font-black text-gray-900">My Orders by Status</h3><p className="mt-1.5 text-sm font-medium text-gray-500">A clickable breakdown for the selected date range.</p></div><div className="rounded-full bg-[#eef5fb] px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.16em] text-[#0f2f57]">{employeeSnapshot ? `${employeeStatusTotal.toLocaleString('en-BD')} tracked orders` : inlinePlaceholder}</div></div>{!employeeSnapshot ? <SectionState text={sectionPlaceholder} minHeight="min-h-[180px]" /> : <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{employeeSnapshot.employeeStatusSnapshot.map((entry) => { const styles = EMPLOYEE_STATUS_STYLES[entry.status]; return <EmployeeStatusCard key={entry.status} title={entry.label} value={entry.value} total={Math.max(employeeStatusTotal, 1)} {...styles} onClick={canViewOrders ? () => handleOpenMyOrders(entry.status) : undefined} />; })}</div>}</section>
      );
      case 'employee.performanceOverview': return (
        <aside className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm md:p-7"><p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Performance overview</p><h3 className="mt-2 text-xl font-black text-gray-900">Understand this view</h3><p className="mt-1.5 text-sm font-medium leading-6 text-gray-500">These indicators use the same date filter as the status cards.</p><div className="mt-6 space-y-3"><EmployeeInsight label="Completion rate" value={employeeSnapshot ? `${employeeCompletionRate}%` : inlinePlaceholder} detail={`${employeeCompletedOrders.toLocaleString('en-BD')} delivered orders`} valueClassName="text-emerald-600" /><EmployeeInsight label="Active workflow" value={employeeSnapshot ? employeeActiveOrders.toLocaleString('en-BD') : inlinePlaceholder} detail="Orders still moving through fulfilment" valueClassName="text-sky-600" /><EmployeeInsight label="Exception rate" value={employeeSnapshot ? `${employeeExceptionRate}%` : inlinePlaceholder} detail={`${employeeExceptionOrders.toLocaleString('en-BD')} returned or cancelled`} valueClassName={employeeExceptionRate > 20 ? 'text-rose-600' : 'text-amber-600'} /><EmployeeInsight label="Today" value={employeeSnapshot ? employeeSnapshot.myCreatedToday.toLocaleString('en-BD') : inlinePlaceholder} detail="Orders created since midnight" valueClassName="text-[#0f2f57]" /></div></aside>
      );
      case 'employee.orderActivity': return (
        <section className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm md:p-7"><div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Team context</p><h3 className="mt-2 text-xl font-black text-gray-900">Order activity</h3><p className="mt-1.5 text-sm font-medium text-gray-500">Top performers plus your position for the selected date range.</p></div>{currentEmployeeRow && <div className="rounded-xl border border-[#d6e3f0] bg-[#f8fbff] px-4 py-3 text-sm font-bold text-[#0f2f57]">Your position: <span className="font-black">#{currentEmployeeRow.rank} of {rankedEmployeeRows.length}</span></div>}</div>{!employeeSnapshot ? <SectionState text={sectionPlaceholder} minHeight="min-h-[180px]" /> : employeeComparisonRows.length === 0 ? <div className="mt-6 rounded-[22px] border border-dashed border-gray-200 bg-gray-50 px-6 py-14 text-center text-xs font-medium text-gray-400">No employee order activity matched the selected date range.</div> : <div className="mt-6 space-y-4">{visibleEmployeeRows.map((entry) => <EmployeeComparisonRow key={entry.userId} rank={entry.rank} name={entry.name} role={entry.role} orderCount={entry.orderCount} maxCount={employeeComparisonMax} isCurrentUser={entry.isCurrentUser} />)}</div>}</section>
      );
      default: return null;
    }
  };

  const getWidgetWidthStyle = (setting: { key: string; widthPercent?: number }): React.CSSProperties => {
    if (!isDesktop) return {};
    const percent = setting.widthPercent ?? getDefaultWidgetWidthPercent(setting.key);
    return { flex: `0 0 calc(${percent}% - 1.5rem)`, minWidth: 0 };
  };

  return (
    <div className="space-y-6">
      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">Dashboard data could not be refreshed. Showing inline fallback text until the next retry succeeds.</div>}

      {showEmployeeWorkspace && (
        <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#0f2f57] via-[#163f70] to-[#25608f] px-6 py-6 text-white shadow-[0_20px_50px_rgba(15,47,87,0.2)] md:px-8 md:py-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-200">Employee workspace</p><h1 className="mt-2 text-2xl font-black md:text-3xl">Welcome back, {user.name?.split(' ')[0] || 'there'}</h1><p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-blue-100">Track your order workload, understand your results, and open the records that need attention from one place.</p></div><div className="flex flex-wrap gap-3">{can('orders.create') && <button type="button" onClick={() => navigate('/orders/new')} className="rounded-xl bg-white px-4 py-2.5 text-sm font-black text-[#0f2f57] shadow-sm hover:bg-blue-50">Create order</button>}{canViewOrders && <button type="button" onClick={() => handleOpenMyOrders()} className="rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-black text-white hover:bg-white/20">View my orders</button>}{canViewWallet && <button type="button" onClick={() => navigate('/wallet')} className="rounded-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-black text-white hover:bg-white/20">Open wallet</button>}</div></div>
        </section>
      )}

      <FilterBar filterRange={filterRange} setFilterRange={setFilterRange} customDates={customDates} setCustomDates={setCustomDates} includeTime={includeTime} setIncludeTime={setIncludeTime} />

      {enabledKpis.length > 0 && <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">{enabledKpis.map((item) => <React.Fragment key={item.key}>{renderKpi(item.key)}</React.Fragment>)}</section>}
      {enabledWidgets.length > 0 && <section className="flex flex-wrap gap-6">{enabledWidgets.map((item) => <div key={item.key} style={getWidgetWidthStyle(item)}>{renderWidget(item.key)}</div>)}</section>}
      {enabledKpis.length === 0 && enabledWidgets.length === 0 && <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-8 py-16 text-center"><h2 className="text-xl font-black text-gray-900">This dashboard is empty</h2><p className="mt-2 text-sm font-medium text-gray-500">An administrator can enable KPI cards and widgets from Settings → Dashboard.</p></div>}
    </div>
  );
};

export default Dashboard;
