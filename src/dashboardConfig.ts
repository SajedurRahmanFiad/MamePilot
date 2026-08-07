import type {
  AppCapabilityKey,
  DashboardConfiguration,
  DashboardItemSetting,
  DashboardSettings,
} from '../types';

export const ADMIN_DEFAULT_DASHBOARD_ID = 'admin-default';
export const EMPLOYEE_DEFAULT_DASHBOARD_ID = 'employee-default';

export type DashboardDataScope = 'admin' | 'employee';

export interface DashboardItemDefinition {
  key: string;
  label: string;
  description: string;
  scope: DashboardDataScope;
  defaultFor: Array<'admin' | 'employee'>;
  requiredCapabilities?: AppCapabilityKey[];
  requiredSubCapabilities?: string[];
  width?: 'full' | 'half' | 'twoThirds' | 'oneThird';
}

export const DASHBOARD_KPI_DEFINITIONS: DashboardItemDefinition[] = [
  { key: 'admin.totalSales', label: 'Total Sales', description: 'Sales value for the selected date range.', scope: 'admin', defaultFor: ['admin'] },
  { key: 'admin.totalPurchases', label: 'Total Purchases', description: 'Purchase value for the selected date range.', scope: 'admin', defaultFor: ['admin'], requiredCapabilities: ['purchases'] },
  { key: 'admin.otherExpenses', label: 'Other Expenses', description: 'Non-purchase expenses for the selected date range.', scope: 'admin', defaultFor: ['admin'], requiredCapabilities: ['banking'] },
  { key: 'admin.totalProfit', label: 'Total Profit', description: 'Sales minus purchases and other expenses.', scope: 'admin', defaultFor: ['admin'], requiredCapabilities: ['purchases', 'banking'] },
  { key: 'admin.totalOrders', label: 'Total Orders', description: 'All orders and their total value.', scope: 'admin', defaultFor: ['admin'] },
  { key: 'admin.onHoldOrders', label: 'On Hold Orders', description: 'Orders currently on hold.', scope: 'admin', defaultFor: ['admin'] },
  { key: 'admin.processingOrders', label: 'Processing Orders', description: 'Orders currently being processed.', scope: 'admin', defaultFor: ['admin'] },
  { key: 'admin.pickedOrders', label: 'Picked Orders', description: 'Orders picked by a courier.', scope: 'admin', defaultFor: ['admin'] },
  { key: 'admin.deliveredOrders', label: 'Delivered Orders', description: 'Completed and delivered orders.', scope: 'admin', defaultFor: ['admin'] },
  { key: 'admin.returnedOrders', label: 'Returned Orders', description: 'Returned orders and their total value.', scope: 'admin', defaultFor: [] },
  { key: 'admin.cancelledOrders', label: 'Cancelled Orders', description: 'Cancelled orders and their total value.', scope: 'admin', defaultFor: ['admin'] },
  { key: 'employee.allTimeOrders', label: 'All-time Orders', description: 'Every order created by the signed-in user.', scope: 'employee', defaultFor: ['employee'] },
  { key: 'employee.createdToday', label: 'Created Today', description: 'Orders created by the signed-in user today.', scope: 'employee', defaultFor: ['employee'] },
  { key: 'employee.activeOrders', label: 'Active in This View', description: 'On hold, processing, and picked orders.', scope: 'employee', defaultFor: ['employee'] },
  { key: 'employee.availableBalance', label: 'Available Balance', description: 'The signed-in employee wallet balance.', scope: 'employee', defaultFor: ['employee'], requiredCapabilities: ['human_resources'], requiredSubCapabilities: ['payroll'] },
];

export const DASHBOARD_WIDGET_DEFINITIONS: DashboardItemDefinition[] = [
  { key: 'admin.cashFlow', label: 'Cash Flow', description: 'Monthly income, expense, and profit chart.', scope: 'admin', defaultFor: ['admin'], requiredCapabilities: ['banking'], width: 'full' },
  { key: 'admin.topSoldProducts', label: 'Top 5 Sold Products', description: 'Best-selling products by quantity.', scope: 'admin', defaultFor: ['admin'], width: 'half' },
  { key: 'admin.topCustomers', label: 'Top 5 Customers', description: 'Highest-value customers by completed sales.', scope: 'admin', defaultFor: ['admin'], width: 'half' },
  { key: 'admin.profitLoss', label: 'Profit & Loss Summary', description: 'Income, expense, and net profit summary.', scope: 'admin', defaultFor: ['admin'], requiredCapabilities: ['purchases', 'banking'], width: 'half' },
  { key: 'admin.expensesByCategory', label: 'Expenses by Category', description: 'Expense distribution chart by category.', scope: 'admin', defaultFor: ['admin'], requiredCapabilities: ['purchases', 'banking'], width: 'half' },
  { key: 'employee.ordersByStatus', label: 'My Orders by Status', description: 'Clickable status breakdown for the signed-in user.', scope: 'employee', defaultFor: ['employee'], width: 'twoThirds' },
  { key: 'employee.performanceOverview', label: 'Performance Overview', description: 'Completion, active workflow, exception, and daily indicators.', scope: 'employee', defaultFor: ['employee'], width: 'oneThird' },
  { key: 'employee.orderActivity', label: 'Order Activity', description: 'Team ranking and the signed-in employee position.', scope: 'employee', defaultFor: ['employee'], width: 'full' },
];

const normalizeItemSettings = (
  raw: DashboardItemSetting[] | undefined,
  definitions: DashboardItemDefinition[],
  systemKey?: 'admin' | 'employee' | null,
): DashboardItemSetting[] => {
  const definitionKeys = new Set(definitions.map((definition) => definition.key));
  const seen = new Set<string>();
  const normalized: DashboardItemSetting[] = [];

  for (const item of raw || []) {
    const key = String(item?.key || '');
    if (!definitionKeys.has(key) || seen.has(key)) continue;
    seen.add(key);
    normalized.push({ key, enabled: Boolean(item.enabled) });
  }

  for (const definition of definitions) {
    if (seen.has(definition.key)) continue;
    normalized.push({
      key: definition.key,
      enabled: Boolean(systemKey && definition.defaultFor.includes(systemKey)),
    });
  }

  return normalized;
};

export const createDefaultDashboard = (systemKey: 'admin' | 'employee'): DashboardConfiguration => ({
  id: systemKey === 'admin' ? ADMIN_DEFAULT_DASHBOARD_ID : EMPLOYEE_DEFAULT_DASHBOARD_ID,
  name: systemKey === 'admin' ? 'Admin Dashboard (Default)' : 'Employee Dashboard (Default)',
  isSystem: true,
  systemKey,
  kpiCards: normalizeItemSettings([], DASHBOARD_KPI_DEFINITIONS, systemKey),
  widgets: normalizeItemSettings([], DASHBOARD_WIDGET_DEFINITIONS, systemKey),
  createdAt: null,
  updatedAt: null,
});

export const normalizeDashboardConfiguration = (value: Partial<DashboardConfiguration>): DashboardConfiguration => {
  const systemKey = value.systemKey === 'admin' || value.id === ADMIN_DEFAULT_DASHBOARD_ID
    ? 'admin'
    : value.systemKey === 'employee' || value.id === EMPLOYEE_DEFAULT_DASHBOARD_ID
      ? 'employee'
      : null;
  return {
    id: String(value.id || ''),
    name: systemKey === 'admin'
      ? 'Admin Dashboard (Default)'
      : systemKey === 'employee'
        ? 'Employee Dashboard (Default)'
        : String(value.name || '').trim(),
    isSystem: Boolean(systemKey),
    systemKey,
    kpiCards: normalizeItemSettings(value.kpiCards, DASHBOARD_KPI_DEFINITIONS, systemKey),
    widgets: normalizeItemSettings(value.widgets, DASHBOARD_WIDGET_DEFINITIONS, systemKey),
    createdAt: value.createdAt ?? null,
    updatedAt: value.updatedAt ?? null,
  };
};

export const normalizeDashboardSettings = (value?: Partial<DashboardSettings> | null): DashboardSettings => {
  const byId = new Map<string, DashboardConfiguration>();
  byId.set(ADMIN_DEFAULT_DASHBOARD_ID, createDefaultDashboard('admin'));
  byId.set(EMPLOYEE_DEFAULT_DASHBOARD_ID, createDefaultDashboard('employee'));

  for (const candidate of value?.dashboards || []) {
    const normalized = normalizeDashboardConfiguration(candidate);
    if (!normalized.id || !normalized.name) continue;
    byId.set(normalized.id, normalized);
  }

  return { dashboards: Array.from(byId.values()) };
};

export const cloneDashboardSettings = (value?: Partial<DashboardSettings> | null): DashboardSettings => ({
  dashboards: normalizeDashboardSettings(value).dashboards.map((dashboard) => ({
    ...dashboard,
    kpiCards: dashboard.kpiCards.map((item) => ({ ...item })),
    widgets: dashboard.widgets.map((item) => ({ ...item })),
  })),
});

export const dashboardHasScope = (dashboard: DashboardConfiguration, scope: DashboardDataScope): boolean => {
  const definitionByKey = new Map(
    [...DASHBOARD_KPI_DEFINITIONS, ...DASHBOARD_WIDGET_DEFINITIONS].map((definition) => [definition.key, definition]),
  );
  return [...dashboard.kpiCards, ...dashboard.widgets].some((item) => item.enabled && definitionByKey.get(item.key)?.scope === scope);
};

export const dashboardItemIsAvailable = (
  definition: DashboardItemDefinition,
  hasCapability: (key: AppCapabilityKey) => boolean,
  hasSubCapability: (key: string) => boolean,
): boolean => (definition.requiredCapabilities || []).every(hasCapability)
  && (definition.requiredSubCapabilities || []).every(hasSubCapability);
