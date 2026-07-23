
export enum UserRole {
  ADMIN = 'Admin',
  DEVELOPER = 'Developer',
  EMPLOYEE = 'Employee'
}

export type AppRole = UserRole | string;

export const isEmployeeRole = (r?: UserRole | string | null) => r === UserRole.EMPLOYEE;
export const isDeveloperRole = (r?: UserRole | string | null) => r === UserRole.DEVELOPER;
export const hasAdminAccess = (r?: UserRole | string | null) => r === UserRole.ADMIN || r === UserRole.DEVELOPER;

export type PermissionKey =
  | 'dashboard.viewAdmin'
  | 'dashboard.viewEmployee'
  | 'orders.view'
  | 'orders.create'
  | 'orders.editOwn'
  | 'orders.editAny'
  | 'orders.deleteOwn'
  | 'orders.deleteAny'
  | 'orders.cancelOwn'
  | 'orders.cancelAny'
  | 'orders.moveOnHoldToProcessingOwn'
  | 'orders.moveOnHoldToProcessingAny'
  | 'orders.sendToCourierOwn'
  | 'orders.sendToCourierAny'
  | 'orders.moveToPickedOwn'
  | 'orders.moveToPickedAny'
  | 'orders.markCompletedOwn'
  | 'orders.markCompletedAny'
  | 'orders.markReturnedOwn'
  | 'orders.markReturnedAny'
  | 'orders.print'
  | 'customers.view'
  | 'customers.create'
  | 'customers.edit'
  | 'customers.delete'
  | 'leads.view'
  | 'leads.create'
  | 'leads.edit'
  | 'leads.delete'
  | 'bills.view'
  | 'bills.create'
  | 'bills.editOwn'
  | 'bills.editAny'
  | 'bills.deleteOwn'
  | 'bills.deleteAny'
  | 'bills.cancelOwn'
  | 'bills.cancelAny'
  | 'bills.moveOnHoldToProcessingOwn'
  | 'bills.moveOnHoldToProcessingAny'
  | 'bills.markReceivedOwn'
  | 'bills.markReceivedAny'
  | 'bills.markPaidOwn'
  | 'bills.markPaidAny'
  | 'bills.print'
  | 'transactions.view'
  | 'transactions.create'
  | 'transactions.edit'
  | 'transactions.delete'
  | 'vendors.view'
  | 'vendors.create'
  | 'vendors.edit'
  | 'vendors.delete'
  | 'vendors.viewBills'
  | 'products.view'
  | 'products.create'
  | 'products.edit'
  | 'products.delete'
  | 'accounts.view'
  | 'accounts.create'
  | 'accounts.edit'
  | 'accounts.delete'
  | 'accounts.viewBalance'
  | 'fraudChecker.check'
  | 'fraudChecker.viewHistory'
  | 'transfers.create'
  | 'transfers.view'
  | 'reports.view'
  | 'reports.viewExpense'
  | 'reports.viewIncome'
  | 'reports.viewProfitLoss'
  | 'reports.viewCustomerSales'
  | 'reports.viewProductQuantity'
  | 'reports.viewUserActivity'
  | 'reports.export'
  | 'wallet.view'
  | 'wallet.viewAny'
  | 'payroll.view'
  | 'payroll.pay'
  | 'payroll.deletePayments'
  | 'orders.processReturnExchangeOwn'
  | 'orders.processReturnExchangeAny'
  | 'bills.processReturnOwn'
  | 'bills.processReturnAny'
  | 'recycleBin.view'
  | 'recycleBin.restore'
  | 'recycleBin.deletePermanent'
  | 'users.view'
  | 'users.create'
  | 'users.edit'
  | 'users.delete'
  | 'undoer.view'
  | 'undoer.execute'
  | 'marketing.view'
  | 'marketing.manageAds'
  | 'marketing.syncAds'
  | 'settings.view'
  | 'settings.editCompany'
  | 'settings.editOrderInvoice'
  | 'settings.editDefaults'
  | 'settings.editWallet'
  | 'settings.editCourier'
  | 'settings.editCategories'
  | 'settings.editPaymentMethods'
  | 'settings.managePermissions'
  | 'subscriptions.view';

export type RolePermissionMap = Record<PermissionKey, boolean>;

export interface PermissionDefinition {
  key: PermissionKey | 'allPrivileges';
  label: string;
  description: string;
  section: string;
  isVirtual?: boolean;
}

export interface PermissionRoleConfig {
  roleName: string;
  isCustom: boolean;
  permissions: RolePermissionMap;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface PermissionsSettings {
  roles: PermissionRoleConfig[];
}

export enum OrderStatus {
  CREATED = 'Created',
  ON_HOLD = 'On Hold',
  PROCESSING = 'Processing',
  COURIER_ASSIGNED = 'Courier assigned',
  PICKED = 'Picked',
  COMPLETED = 'Completed',
  EXCHANGE_PROCESSING = 'Exchange processing',
  EXCHANGE_PICKED = 'Exchange picked',
  EXCHANGE_DELIVERED = 'Exchange delivered',
  EXCHANGE_RETURNED = 'Exchange returned',
  EXCHANGE_CANCELLED = 'Exchange cancelled',
  RETURNED = 'Returned',
  CANCELLED = 'Cancelled'
}

export type ConfirmationStatus = 'confirmed' | 'cancelled' | 'on_hold' | 'waiting';
export type SurveyStatus = 'pending' | 'triggered' | 'initiated' | 'completed' | 'failed' | 'skipped';

export type OrderCompletionOutcome = 'Delivered' | 'Returned';

export enum BillStatus {
  ON_HOLD = 'On Hold',
  PROCESSING = 'Processing',
  RECEIVED = 'Received',
  /** @deprecated Payment is tracked by paidAmount; retained for legacy records. */
  PAID = 'Paid',
  RETURNED = 'Returned',
  CANCELLED = 'Cancelled'
}

export interface User {
  id: string;
  name: string;
  phone: string;
  role: string;
  image?: string;
  email?: string | null;
  address?: string | null;
  birthday?: string | null;
  nidPassportCopy?: string | null;
  gender?: string | null;
  bloodGroup?: string | null;
  nationality?: string | null;
  cv?: string | null;
  isCommissionBased?: boolean;
  compensationType?: 'commission' | 'fixed' | string;
  fixedSalary?: number | null;
  password?: string;
  createdAt?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  totalOrders: number;
  dueAmount: number;
  createdBy?: string;
  createdAt?: string;
  fraudCheckResult?: FraudCheckResult | null;
  fraudCheckPercentage?: number | null;
  fraudCheckPhone?: string | null;
  fraudCheckedAt?: string | null;
  deletedAt?: string;
  deletedBy?: string;
  smartInput?: string;
}

export interface Vendor {
  id: string;
  name: string;
  phone: string;
  address: string;
  totalPurchases: number;
  dueAmount: number;
  createdBy?: string;
  deletedAt?: string;
  deletedBy?: string;
  smartInput?: string;
}

export interface Product {
  id: string;
  name: string;
  image: string;
  category: string;
  unitId?: string;
  salePrice: number;
  purchasePrice: number;
  stock: number;
  dynamicPricing?: string;
  createdBy?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface DynamicPricingRule {
  id: string;
  operator: '=' | '<' | '>';
  quantity: number;
  action: 'discount' | 'setRate';
  amount: number;
}

export interface Unit {
  id: string;
  name: string;
  short_name: string;
  description?: string;
  is_fraction: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  rate: number;
  quantity: number;
  amount: number;
  // Dynamic pricing fields
  originalRate?: number;
  dynamicDiscount?: number;
  // Optional return/exchange tracking fields (populated after partial returns/exchanges)
  returnedQty?: number;
  exchangedQty?: number;
  exchangedWith?: Array<{ productId: string; productName: string; quantity: number; rate: number; amount: number }>;
  /** Exchange replacements do not inherit the discount from the original sale. */
  discountEligible?: boolean;
  /** Identifies a line that was added as an exchange replacement. */
  isExchangeReplacement?: boolean;
}

export type ReturnExchangeAction = 'partialReturn' | 'exchange';

export interface ReturnExchangeItemSelection {
  /** Stable source line in Order.items; productId alone is not unique. */
  lineIndex: number;
  productId: string;
  productName: string;
  originalQty: number;
  originalRate: number;
  action: 'return' | 'exchange' | 'keep';
  returnQty: number;
  // For exchange: replacement items
  replacementItems?: Array<{
    productId: string;
    productName: string;
    quantity: number;
    rate: number;
    amount: number;
    /** UI-only snapshot used to prevent selecting more than available stock. */
    availableStock?: number;
  }>;
}

export interface ProcessOrderReturnExchangePayload {
  orderId: string;
  returnAction: ReturnExchangeAction;
  items: ReturnExchangeItemSelection[];
  refundAmount: number;
  extraCollectionAmount: number;
  accountId: string;
  paymentMethod: string;
  note?: string;
  date: string;
}

export interface ProcessBillReturnPayload {
  billId: string;
  items: Array<{
    /** Stable source line in Bill.items; productId alone is not unique. */
    lineIndex: number;
    productId: string;
    productName: string;
    originalQty: number;
    returnQty: number;
    rate: number;
    amount: number;
  }>;
  refundAmount: number;
  accountId: string;
  paymentMethod: string;
  categoryId?: string;
  note?: string;
  date: string;
}

export interface CompanyPage {
  id: string;
  name: string;
  logo: string;
  phone: string;
  email: string;
  address: string;
  isGlobalBranding: boolean;
}

export interface CompanySettings {
  id?: string;
  name: string;
  logo: string;
  phone: string;
  email: string;
  address: string;
  pages: CompanyPage[];
}

export interface FraudCheckerSettings {
  apiKey: string;
}

export interface VoiceSurveySettings {
  enabled: boolean;
  delayMinutes: number;
  missedCallRetryMinutes: number;
  missedCallRetryCount: number;
  noKeyRetryMinutes: number;
  noKeyRetryCount: number;
  triggerStatuses: string[];
  workerHealth?: VoiceSurveyWorkerHealth;
}

export interface VoiceSurveyWorkerHealth {
  status: 'healthy' | 'stopped' | 'error' | 'configuration_error' | 'disabled';
  message: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastProcessedCount: number;
  pendingCount: number;
  overdueCount: number;
}

export interface WooCommerceStore {
  id: string;
  storeName: string;
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  webhookSecret: string;
  webhookBaseUrl: string;
  webhookId?: number | null;
  webhookUrl: string;
  companyPageId: string;
  enabled: boolean;
  lastSyncedAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncMessage?: string | null;
  ordersSynced: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface WooCommerceSyncResult {
  success: boolean;
  message: string;
  processed: number;
  imported: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export interface VoiceSurveyIntegrationSettings {
  apiToken: string;
  sender: string;
  templateName: string;
  webhookSecret: string;
  webhookUrl: string;
}

export interface CourierSettings {
  steadfast: { baseUrl: string; apiKey: string; secretKey: string };
  carryBee: { baseUrl: string; clientId: string; clientSecret: string; clientContext: string; storeId: string };
  paperfly: {
    baseUrl: string;
    username: string;
    password: string;
    paperflyKey: string;
    defaultShopName: string;
    maxWeightKg: number;
  };
  pathao: {
    baseUrl: string;
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
    storeId: string;
    defaultQuantity: number;
    defaultWeight: number;
    defaultDeliveryType: number;
    defaultItemType: number;
    accessToken: string;
    refreshToken: string;
    tokenExpiresAt: string;
  };
  fraudChecker: FraudCheckerSettings;
}

export interface MetaAdsSettings {
  appId: string;
  appSecret: string;
  redirectUri: string;
  loginConfigId: string;
  graphVersion: string;
  oauthScopes: string;
  /** Meta ad account currency (not the UI display currency — UI is always BDT). */
  displayCurrencyCode: string;
  /** 1 displayCurrencyCode = X BDT (used when exchangeRateMode is 'fixed') */
  displayCurrencyRateToBdt: number | null;
  /** Exchange rate mode: 'fixed' (manual rate) or 'vat_based' (real-time rate + VAT). */
  exchangeRateMode: 'fixed' | 'vat_based';
  /** VAT / tax percentage to add on top of the real-time market rate (only used when mode is 'vat_based'). */
  vatPercentage: number | null;
  /** Cached real-time market rate (before VAT) fetched from currency API. */
  realtimeRateCache: number | null;
  /** When the real-time rate cache was last refreshed. */
  realtimeRateUpdatedAt: string | null;
  /** The final resolved exchange rate (may differ from displayCurrencyRateToBdt when mode is 'vat_based'). */
  resolvedRateToBdt?: number | null;
}

export interface MarketingDashboardKpis {
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  metaConversions: number;
  purchases: number;
  bookedRevenue: number;
  deliveredCount: number;
  deliveredRevenue: number;
  cancelledCount: number;
  returnedCount: number;
  returnedRevenue: number;
  pipelineCount: number;
  pipelineValue: number;
  cpa: number;
  costPerDelivered: number;
  deliveryRate: number;
  returnRate: number;
}

export interface MarketingDashboardSeriesPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  bookedRevenue: number;
  deliveredRevenue: number;
  deliveredCount: number;
}

export interface MarketingDashboardCampaign {
  id: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  conversions: number;
  purchases: number;
  bookedRevenue: number;
  deliveredCount: number;
  deliveredRevenue: number;
  cancelledCount: number;
  returnedCount: number;
  currency: string | null;
  mixedCurrencies: boolean;
}

export interface MarketingDashboardAlert {
  severity: 'info' | 'warning' | 'danger';
  code: string;
  message: string;
}

export interface MarketingDashboardResponse {
  currency: {
    adsCode: string;
    rateToBdt: number | null;
    currencies: string[];
    mixedCurrencies: boolean;
    comparable: boolean;
    previousCurrencies?: string[];
    previousComparable?: boolean;
    exchangeRateMode?: string;
    vatPercentage?: number | null;
    realtimeRateCache?: number | null;
    realtimeRateUpdatedAt?: string | null;
  };
  period: { from: string; to: string; previousFrom: string; previousTo: string };
  kpis: MarketingDashboardKpis;
  previousKpis: MarketingDashboardKpis;
  series: MarketingDashboardSeriesPoint[];
  campaigns: MarketingDashboardCampaign[];
  pipeline: Array<{ status: string; count: number; value: number }>;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    orderDate: string;
    status: string;
    total: number;
    sourceAd: string;
    adName: string;
    campaignName: string;
  }>;
  alerts: MarketingDashboardAlert[];
  meta: {
    lastSyncedAt: string | null;
    stale: boolean;
    activeAds: number;
    activeCampaigns: number;
    hasDailyInsights: boolean;
    definitions?: Record<string, string>;
  };
}

export interface Order {
  id: string;
  orderNumber: string;
  orderDate: string;
  createdAt?: string;
  deletedAt?: string;
  deletedBy?: string;
  customerId: string;
  createdBy: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  notes?: string;
  sourceAd?: string;
  pageId?: string;
  pageSnapshot?: CompanyPage | null;
  carrybeeConsignmentId?: string;
  steadfastConsignmentId?: string;
  paperflyTrackingNumber?: string;
  pathaoConsignmentId?: string;
  // Exchange consignment fields — for shipping replacement items after an exchange
  exchangeCourier?: string; // 'steadfast' | 'carrybee' | 'paperfly' | 'pathao' | 'manual'
  exchangeSteadfastConsignmentId?: string;
  exchangeCarrybeeConsignmentId?: string;
  exchangePaperflyTrackingNumber?: string;
  exchangePathaoConsignmentId?: string;
  exchangeCourierHistory?: string; // manual courier note for exchange
  // Voice survey (auto-calling) fields
  surveyId?: string | null;
  surveyStatus?: SurveyStatus | null;
  surveyResponse?: string | null;
  surveyCallStatus?: string | null;
  confirmationStatus?: ConfirmationStatus | null;
  surveyRetryCount?: number;
  surveyNextRetryAt?: string | null;
  surveyTriggeredAt?: string | null;
  surveyLastRetryReason?: string | null;
  surveyLastRetryAt?: string | null;
  surveyEvents?: VoiceSurveyEvent[];
  history: {
    created: string;
    courier?: string;
    processing?: string;
    packed?: string;
    picked?: string;
    completed?: string;
    returned?: string;
    cancelled?: string;
    payment?: string;
    returnExchange?: string;
    exchangeCourier?: string; // history entry for exchange courier assignment
    exchangeProcessing?: string; // history entry for exchange processing start
    exchangePicked?: string; // history entry for exchange picked up by courier
    exchangeDelivered?: string; // history entry for exchange delivered
    exchangeReturned?: string; // history entry for exchange returned
    exchangeCancelled?: string; // history entry for exchange cancelled
  };
  paidAmount: number;
  processedAt?: string; // ISO timestamp when marked processing
  completedAt?: string; // ISO timestamp when marked completed
  paidAt?: string; // ISO timestamp when payment received
  // Relational fields: populated from joined customer and user data
  // Present when fetching paginated orders via orders_with_customer_creator view
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  creatorName?: string;
  pendingTransactionCount?: number;
  pendingTransactionIds?: string[];
}

export interface Bill {
  id: string;
  billNumber: string;
  billDate: string;
  createdAt?: string;
  deletedAt?: string;
  deletedBy?: string;
  vendorId: string;
  createdBy: string;
  status: BillStatus;
  items: OrderItem[];
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
  notes?: string;
  history?: {
    created?: string;
    processing?: string;
    received?: string;
    returned?: string;
    cancelled?: string;
    paid?: string;
    return?: string;
    refund?: string;
  };
  paidAmount: number;
  processedAt?: string; // ISO timestamp when marked processing
  receivedAt?: string; // ISO timestamp when marked received
  paidAt?: string; // ISO timestamp when payment received
  // Relational fields populated by joined paginated queries
  vendorName?: string;
  vendorPhone?: string;
  vendorAddress?: string;
  creatorName?: string;
}

export interface Account {
  id: string;
  name: string;
  type: 'Bank' | 'Cash';
  openingBalance: number;
  currentBalance: number;
}

export interface Transaction {
  id: string;
  date: string;
  type: 'Income' | 'Expense' | 'Transfer';
  category: string;
  createdAt?: string;
  deletedAt?: string;
  deletedBy?: string;
  accountId: string; // Used for Income/Expense or Source in Transfer
  toAccountId?: string; // Used for Transfer
  amount: number;
  description: string;
  referenceId?: string; // Order, Bill or custom Ref
  contactId?: string; // Customer or Vendor ID
  paymentMethod: string;
  attachmentName?: string;
  attachmentUrl?: string;
  createdBy: string; // User ID who created this transaction
  history?: {
    created?: string;
  };
  // Relational fields provided by joined queries
  accountName?: string;
  contactName?: string;
  contactType?: 'Customer' | 'Vendor' | null;
  creatorName?: string;
  approvalStatus?: 'approved' | 'pending' | 'declined';
  accountEffectApplied?: boolean;
  approvalRequestedAt?: string | null;
  approvedAt?: string | null;
  declinedAt?: string | null;
  approvalNote?: string | null;
}

export type UserActivityType = 'Order' | 'Bill' | 'Transaction';

export interface UserActivityPerformanceMetrics {
  totalActivities: number;
  activeDays: number;
  ordersCreated: number;
  completedOrders: number;
  processingOrders: number;
  pickedOrders: number;
  onHoldOrders: number;
  cancelledOrders: number;
  orderValue: number;
  completedOrderValue: number;
  orderPaidAmount: number;
  orderQuantity: number;
  uniqueCustomers: number;
  averageOrderValue: number;
  completionRate: number;
  collectionRate: number;
  billsCreated: number;
  billValue: number;
  billPaidAmount: number;
  uniqueVendors: number;
  billSettlementRate: number;
  transactionsCreated: number;
  incomeTransactions: number;
  incomeAmount: number;
  expenseTransactions: number;
  expenseAmount: number;
  transferTransactions: number;
  transferAmount: number;
  firstActivity?: string | null;
  lastActivity?: string | null;
}

export interface UserActivityPerformanceSummary {
  user: User;
  metrics: UserActivityPerformanceMetrics;
}

export interface UserActivityPerformanceLogEntry {
  id: string;
  type: UserActivityType;
  rawDate: string;
  reference: string;
  counterparty: string;
  details: string;
  quantity: number | null;
  amount: number | null;
  status: string;
}

export interface UserActivityPerformanceReportTotals {
  users: number;
  activeUsers: number;
  orders: number;
  bills: number;
  transactions: number;
  orderValue: number;
}

export interface UserActivityPerformanceReportPage {
  data: UserActivityPerformanceSummary[];
  count: number;
  totals: UserActivityPerformanceReportTotals;
}

export interface DashboardOrderMetrics {
  total: number;
  onHold: number;
  processing: number;
  picked: number;
  completed: number;
  returned: number;
  cancelled: number;
}

export interface DashboardCashFlowPoint {
  name: string;
  income: number;
  expense: number;
  profit: number;
}

export interface DashboardExpenseCategory {
  name: string;
  value: number;
}

export interface DashboardTopProduct {
  name: string;
  qty: number;
}

export interface DashboardTopCustomer {
  name: string;
  orders: number;
  amount: number;
}

export interface DashboardAdminSnapshot {
  totalSales: number;
  totalPurchases: number;
  otherExpenses: number;
  totalProfit: number;
  orderCounts: DashboardOrderMetrics;
  orderTotals: DashboardOrderMetrics;
  monthlyData: DashboardCashFlowPoint[];
  expenseByCategory: DashboardExpenseCategory[];
  topSoldProducts: DashboardTopProduct[];
  topCustomers: DashboardTopCustomer[];
}

export interface DashboardEmployeeStatusSnapshot {
  status: OrderStatus;
  label: string;
  value: number;
}

export interface DashboardEmployeeComparisonEntry {
  userId: string;
  name: string;
  role: string;
  orderCount: number;
  isCurrentUser: boolean;
}

export interface DashboardEmployeeSnapshot {
  myTotalCreated: number;
  myCreatedToday: number;
  myPendingOrders: number;
  walletBalance: number;
  employeeStatusSnapshot: DashboardEmployeeStatusSnapshot[];
  employeeComparisonRows: DashboardEmployeeComparisonEntry[];
}

export interface DashboardSnapshot {
  role: 'admin' | 'employee';
  admin?: DashboardAdminSnapshot;
  employee?: DashboardEmployeeSnapshot;
  refreshedAt: string;
}

export interface NamedValuePoint {
  name: string;
  value: number;
}

export interface IncomeSummaryTopCustomer {
  id: string;
  name: string;
  revenue: number;
}

export interface IncomeSummaryReport {
  totalRevenue: number;
  averageTransactionSize: number;
  revenueMix: NamedValuePoint[];
  topCustomers: IncomeSummaryTopCustomer[];
}

export interface ExpenseSummaryRecentExpense {
  id: string;
  date: string;
  categoryName: string;
  amount: number;
}

export interface ExpenseSummaryCsvRow {
  date: string;
  categoryName: string;
  contactName: string;
  accountName: string;
  amount: number;
  description: string;
}

export interface ExpenseSummaryReport {
  totalOutflow: number;
  byCategory: NamedValuePoint[];
  recentExpenses: ExpenseSummaryRecentExpense[];
}

export interface IncomeVsExpensePoint {
  name: string;
  label: string;
  income: number;
  expense: number;
  profit: number;
}

export interface IncomeVsExpenseMonthHighlight {
  label: string;
  amount: number;
}

export interface IncomeVsExpenseReport {
  chartData: IncomeVsExpensePoint[];
  totalIncome: number;
  totalExpense: number;
  averageProfit: number;
  highestRevenueMonth: IncomeVsExpenseMonthHighlight | null;
  lowestExpenseMonth: IncomeVsExpenseMonthHighlight | null;
}

export interface ProfitLossExpenseLine {
  categoryName: string;
  amount: number;
}

export interface ProfitLossReport {
  grossSales: number;
  costOfPurchases: number;
  grossProfit: number;
  expenses: ProfitLossExpenseLine[];
  totalOperatingExpenses: number;
  netProfit: number;
}

export interface ProductQuantitySoldRow {
  productName: string;
  quantity: number;
  revenue: number;
}

export interface ProductQuantitySoldReport {
  rows: ProductQuantitySoldRow[];
  totalQty: number;
}

export interface CustomerSalesReportRow {
  name: string;
  orders: number;
  quantity: number;
  amount: number;
}

export interface CustomerSalesReportData {
  rows: CustomerSalesReportRow[];
  totalAmount: number;
  totalOrders: number;
  totalQuantity: number;
}

export interface Settings {
  company: CompanySettings;
  order: {
    prefix: string;
    nextNumber: number;
  };
  invoice: {
    title: string;
    logoWidth: number;
    logoHeight: number;
    footer: string;
  };
  defaults: {
    defaultAccountId: string;
    defaultPaymentMethod: string;
    incomeCategoryId: string;
    expenseCategoryId: string;
    recordsPerPage: number;
    maxTransactionAmount?: number;
    whiteLabel: boolean;
    themeColor: string;
  };
  categories: {
    id: string;
    name: string;
    type: 'Income' | 'Expense' | 'Product' | 'Other';
    color: string;
    parentId?: string;
    isSystem?: boolean;
  }[];
  paymentMethods: {
    id: string;
    name: string;
    description: string;
  }[];
  courier: CourierSettings;
  payroll: {
    unitAmount: number;
    countedStatuses: OrderStatus[];
  };
  permissions?: PermissionsSettings;
}

export type AppCapabilityKey =
  | 'dashboard'
  | 'inventory'
  | 'sales'
  | 'recycle_bin_undoer'
  | 'purchases'
  | 'banking'
  | 'human_resources'
  | 'advanced_reports'
  | 'fraud_checker'
  | 'whitelabel'
  | 'custom_roles'
  | 'courier_automation'
  | 'marketing'
  | 'automatic_leads'
  | 'mamecx'
  | 'enterprise_ai_agent'
  | 'grow_your_business'
  | 'be_smart'
  | 'whatsapp'
  | 'messenger'
  | 'auto_calling'
  | 'woocommerce';

export type AppCapabilityMap = Record<AppCapabilityKey, boolean>;

export type SubCapabilityKey =
  | 'hr_management'
  | 'payroll'
  | 'accounts'
  | 'transactions'
  | 'transfer'
  | 'steadfast_courier'
  | 'carrybee_courier'
  | 'paperfly_courier'
  | 'pathao_courier'
  | 'recycle_bin'
  | 'undoer';

export type SubCapabilityMap = Partial<Record<SubCapabilityKey, boolean>>;

export interface LicenseTier {
  tierKey: string;
  tierName: string;
  monthlyPrice: number;
  yearlyPrice: number;
  capabilities: AppCapabilityKey[];
}

export interface CapabilitySettings {
  capabilities: AppCapabilityMap;
  tierKey?: string | null;
  planName?: string | null;
  licenseStatus: string;
  renewalDate?: string | null;
  overrideEnabled?: boolean;
  maintenanceEnabled?: boolean;
  availableTiers?: LicenseTier[];
  pricingMetadata?: {
    monthly?: number;
    yearly?: number;
    [key: string]: number | undefined;
  };
  lastSyncedAt?: string | null;
  lastSyncStatus?: string | null;
  lastSyncMessage?: string | null;
  syncGraceUntil?: string | null;
  licenseKey?: string;
  licenseApiUrl?: string;
  licenseOwnerToken?: string;
}

export interface PaymentGatewaySettings {
  piprapayBaseUrl: string;
  piprapayApiKey: string;
  piprapayMerchantId: string;
  piprapayIpnSecret: string;
  piprapayWebhookUrl: string;
  piprapayReturnUrl: string;
}

export interface AgentSettings {
  enabled: boolean;
  showReasoningSummaries: boolean;
  showToolActivity: boolean;
  maxReasoningSteps: number;
  maxToolCalls: number;
  queryRowLimit: number;
  queryTimeoutMs: number;
}

export interface BusinessGrowthSettings {
  recommendationCacheHours: number;
}

export type LlmProvider = 'google' | 'openai' | 'openrouter' | 'groq' | 'anthropic' | 'deepseek';
export type LlmFeatureKey = 'information_extraction' | 'mame_ai' | 'business_growth';

export interface LlmConfiguration {
  id: string;
  label: string;
  provider: LlmProvider;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  organization?: string;
  project?: string;
  siteUrl?: string;
  appName?: string;
  anthropicVersion?: string;
}

export interface MultimodalLlmConfiguration extends LlmConfiguration {
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  supportsVision?: boolean;
  supportsAudio?: boolean;
}

export interface LlmSettings {
  configurations: LlmConfiguration[];
  assignments: Record<LlmFeatureKey, string | null>;
  multimodalConfigurations: MultimodalLlmConfiguration[];
  multimodalAssignment: string | null;
}

export type LeadStatus = 'new' | 'active' | 'needs_reply' | 'qualified' | 'high_intent' | 'order_pending' | 'converted' | 'lost' | 'paused';

export interface LeadProfileField<T = string> {
  value: T;
  confidence?: number;
  sourceMessageIds?: string[];
  inferred?: boolean;
}

export interface LeadProfileJson {
  schemaVersion: number;
  identity?: {
    name?: LeadProfileField;
    phone?: LeadProfileField;
    address?: LeadProfileField;
    email?: LeadProfileField;
  };
  attribution?: Record<string, any>;
  interest?: Array<{ productId?: string; productName?: string; quantity?: number; confidence?: number }>;
  sales?: {
    stage?: string;
    orderProbability?: number;
    buyingSignals?: string[];
    objections?: string[];
    sentiment?: string;
    preferredTone?: string;
  };
  missingInformation?: string[];
  recommendation?: { shouldContinue?: boolean; priority?: string; nextAction?: string; reason?: string };
  orderConfirmation?: { status?: string; confidence?: number; evidenceMessageIds?: string[] };
  analysis?: { notices?: string[]; mediaSummary?: string; updatedAt?: string };
  [key: string]: any;
}

export interface Lead {
  id: string;
  sourceChannel: string;
  messengerContactId?: string | null;
  whatsappContactId?: string | null;
  assignedModelId?: string | null;
  status: LeadStatus | string;
  stage: string;
  score: number;
  orderProbability: number;
  profile: LeadProfileJson;
  lastAnalyzedMessageId?: string | null;
  lastMessageAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  suggestions?: LeadSuggestion[];
}

export interface LeadSuggestion {
  id: string;
  leadId: string;
  suggestionType: string;
  text: string;
  reason?: string;
  confidence: number;
  status: string;
  createdAt?: string | null;
}

export interface BeSmartSettings {
  smartCustomerAdding: boolean;
  smartVendorAdding: boolean;
}

export interface BusinessRecommendation {
  id: string;
  type: string;
  title: string;
  description: string;
  badgeColor: 'green' | 'yellow' | 'red';
  priority: number;
  productIds: string[];
  metadata: Record<string, any> | null;
  generatedAt: string;
  expiresAt: string | null;
}

export interface AgentConversation {
  id: string;
  title: string;
  status: string;
  userId: string;
  lastMessageAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AgentMessage {
  id: string;
  conversationId: string;
  runId?: string | null;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  reasoningSummary?: string | null;
  metadata?: Record<string, any> | null;
  createdAt?: string;
}

export interface AgentRunEvent {
  id: string;
  runId: string;
  eventType: string;
  sequenceNo: number;
  payload: Record<string, any>;
  createdAt?: string;
}

export interface AgentRunReceipt {
  conversationId: string;
  runId: string;
  streamToken: string;
}

export interface LocalUsageSummary {
  activeUsers: number;
  totalTransactions: number;
  totalOrders: number;
  totalBills: number;
  totalCustomers: number;
  totalProducts: number;
}

export interface FraudCheckCourierHistory {
  key: string;
  name: string;
  logo: string;
  totalParcel: number;
  successParcel: number;
  cancelledParcel: number;
  successRatio: number;
}

export interface FraudCheckSummary {
  totalParcel: number;
  successParcel: number;
  cancelledParcel: number;
  successRatio: number;
}

export interface FraudCheckReport {
  id: string;
  name: string;
  details: string;
  createdAt: string;
  courierLogo: string;
  courierName: string;
}

export interface FraudCheckResult {
  status: string;
  phone: string;
  couriers: FraudCheckCourierHistory[];
  summary: FraudCheckSummary;
  reports: FraudCheckReport[];
}

export interface WhatsAppSettings {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  verifyToken: string;
  appSecret: string;
  graphVersion: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating: string;
  webhookUrl: string;
  configured: boolean;
  webhookConfigured: boolean;
  welcomeMessage: string;
  getStartedEnabled: boolean;
  iceBreakers: string[];
  welcomeActive: boolean;
}

export interface WhatsAppContact {
  id: string;
  waId: string;
  phoneNumber: string;
  name: string;
  profileName: string;
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageType: string;
  lastMessageAt: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface WhatsAppMessage {
  id: string;
  waMessageId: string;
  contactId: string;
  direction: 'inbound' | 'outbound' | string;
  type: string;
  text: string;
  caption: string;
  mediaId: string;
  mediaUrl: string;
  mimeType: string;
  fileName: string;
  status: string;
  errorCode: string;
  errorMessage: string;
  messageAt: string | null;
  createdAt?: string | null;
}

export interface MessengerSettings {
  pageAccessToken: string;
  pageId: string;
  verifyToken: string;
  appSecret: string;
  graphVersion: string;
  pageName: string;
  pageUsername: string;
  pagePictureUrl: string;
  humanAgentEnabled: boolean;
  webhookUrl: string;
  configured: boolean;
  webhookConfigured: boolean;
  subscribed: boolean;
  subscribedFields: string[];
}

export interface MessengerProfileSettings {
  greeting: string;
  getStartedEnabled: boolean;
  iceBreakers: string[];
}

export interface MessengerContact {
  id: string;
  psid: string;
  name: string;
  firstName: string;
  lastName: string;
  profilePictureUrl: string;
  locale: string;
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageType: string;
  lastMessageAt: string | null;
  lastUserMessageAt: string | null;
  canReply: boolean;
  replyWindow: 'standard' | 'human_agent' | 'closed' | string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface MessengerMessage {
  id: string;
  mid: string;
  contactId: string;
  direction: 'inbound' | 'outbound' | string;
  type: string;
  text: string;
  attachmentUrl: string;
  attachmentId: string;
  attachments: Array<{ type: string; url: string; title?: string }>;
  mimeType: string;
  fileName: string;
  status: string;
  errorCode: string;
  errorMessage: string;
  replyToMid: string;
  reaction: string;
  reactionActor: string;
  quickReplies: Array<{ title: string; payload?: string; imageUrl?: string }>;
  messageAt: string | null;
  createdAt?: string | null;
}

export interface VoiceSurveyEvent {
  id: string;
  surveyId?: string | null;
  eventType: 'queued' | 'initiated' | 'result_received' | 'retry_scheduled' | 'retry_initiated' | 'failed' | 'cancelled' | string;
  callStatus?: string | null;
  response?: string | null;
  details?: string | null;
  createdAt: string;
}

export interface OrderSurveySnapshot {
  surveyId?: string | null;
  surveyStatus?: SurveyStatus | null;
  surveyResponse?: string | null;
  surveyCallStatus?: string | null;
  confirmationStatus?: ConfirmationStatus | null;
  surveyRetryCount: number;
  surveyNextRetryAt?: string | null;
  surveyTriggeredAt?: string | null;
  surveyLastRetryReason?: string | null;
  surveyLastRetryAt?: string | null;
  surveyEvents: VoiceSurveyEvent[];
}

export interface PayrollSettings {
  unitAmount: number;
  countedStatuses: OrderStatus[];
}

export interface PayrollPayment {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeRole?: string;
  periodStart: string;
  periodEnd: string;
  periodKind: 'month' | 'custom';
  periodLabel: string;
  unitAmountSnapshot: number;
  countedStatusesSnapshot: OrderStatus[];
  orderCountSnapshot: number;
  amountSnapshot: number;
  compensationType?: 'commission' | 'fixed' | string;
  isCommissionBased?: boolean;
  fixedSalarySnapshot?: number | null;
  baseAmountSnapshot?: number;
  bonusAmount?: number;
  deductionAmount?: number;
  netAmount?: number;
  walletPayoutId?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  paymentMethod?: string | null;
  transactionId?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  paidAt: string;
  paidBy: string;
  paidByName?: string;
  note?: string;
  createdAt?: string;
}

export interface PayrollSummaryRow {
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  isCommissionBased?: boolean;
  compensationType?: 'commission' | 'fixed' | string;
  fixedSalary?: number | null;
  countedOrderCount: number;
  unitAmount: number;
  estimatedAmount: number;
  baseAmount?: number;
  grossBaseAmount?: number;
  balancePeriodStart?: string | null;
  balancePeriodEnd?: string | null;
  paymentStatus: 'paid' | 'unpaid';
  paymentSnapshot?: PayrollPayment;
  paymentCount?: number;
  paidBaseAmount?: number;
  paidNetAmount?: number;
  paidBonusAmount?: number;
  paidDeductionAmount?: number;
  periodBaseAmount?: number;
  hasOutstandingTopUp?: boolean;
  hasBlockingPeriodOverlap?: boolean;
  liveAmountDelta?: number;
  liveOrderCountDelta?: number;
}

export type WalletEntryType =
  | 'order_credit'
  | 'order_reversal'
  | 'payroll_bonus'
  | 'payroll_deduction'
  | 'payout';

export interface WalletSettings {
  unitAmount: number;
  countedStatuses: OrderStatus[];
}

export interface WalletBalanceCard {
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  isCommissionBased: boolean;
  compensationType?: 'commission' | 'fixed' | string;
  fixedSalary: number | null;
  currentBalance: number;
  totalEarned: number;
  totalPaid: number;
  creditedOrders: number;
  balancePeriodStart?: string | null;
  balancePeriodEnd?: string | null;
  baseEarned?: number;
  basePaid?: number;
  totalBonuses?: number;
  totalDeductions?: number;
  carryAdjustment?: number;
  lastActivityAt?: string;
}

export interface WalletBalanceSummary {
  totalBalance: number;
  totalEarned: number;
  totalPaid: number;
  totalBaseEarned?: number;
  totalBasePaid?: number;
  totalBonuses?: number;
  totalDeductions?: number;
  totalCarryAdjustments?: number;
  employeesDue: number;
  fixedSalaryEmployees: number;
  totalFixedSalaryDue: number;
}

export interface WalletBalanceCardPage {
  data: WalletBalanceCard[];
  count: number;
  summary: WalletBalanceSummary;
}

export interface WalletActivityEntry {
  id: string;
  employeeId: string;
  employeeName?: string;
  employeeRole?: string;
  entryType: WalletEntryType;
  amountDelta: number;
  compensationType?: 'commission' | 'fixed' | string;
  baseAmountSnapshot?: number;
  bonusAmount?: number;
  deductionAmount?: number;
  payrollPaymentId?: string;
  walletPayoutId?: string;
  unitAmountSnapshot?: number;
  orderId?: string;
  orderNumber?: string;
  payoutId?: string;
  transactionId?: string;
  accountId?: string;
  accountName?: string;
  paymentMethod?: string;
  categoryId?: string;
  categoryName?: string;
  note?: string;
  createdAt: string;
  createdBy?: string;
  createdByName?: string;
  paidAt?: string;
  paidBy?: string;
  paidByName?: string;
}

export interface WalletPayout {
  id: string;
  employeeId: string;
  amount: number;
  accountId: string;
  paymentMethod: string;
  categoryId: string;
  transactionId: string;
  accountName?: string | null;
  categoryName?: string | null;
  payrollPaymentId?: string | null;
  compensationType?: 'commission' | 'fixed' | string;
  periodStart?: string | null;
  periodEnd?: string | null;
  periodKind?: 'month' | 'custom' | string;
  periodLabel?: string | null;
  baseAmount?: number;
  bonusAmount?: number;
  deductionAmount?: number;
  netAmount?: number;
  payrollPayment?: PayrollPayment;
  paidAt: string;
  paidBy: string;
  paidByName?: string;
  note?: string;
}

export interface EmployeeWalletPayoutPayload {
  employeeId: string;
  amount: number;
  accountId: string;
  paymentMethod: string;
  categoryId: string;
  paidAt: string;
  periodStart: string;
  periodEnd: string;
  periodKind?: 'month' | 'custom';
  periodLabel?: string;
  bonusAmount?: number;
  deductionAmount?: number;
  note?: string;
}

export interface CompletePickedOrderPayload {
  orderId: string;
  outcome: OrderCompletionOutcome;
  date: string;
  accountId?: string;
  amount?: number;
  paymentMethod?: string;
  categoryId?: string;
  note?: string;
}

export type NotificationActionKind = 'none' | 'link' | 'decision' | 'link_and_decision';
export type NotificationDecisionMode = 'record_only' | 'transaction_approval';
export type NotificationDecision = 'accepted' | 'declined';
export type NotificationDecisionScope = 'single_user' | 'all_users';
export type DeploymentScope = 'all' | 'include' | 'exclude';
export type NotificationDeploymentScope = DeploymentScope;

export interface NotificationActionConfig {
  kind: NotificationActionKind;
  linkLabel?: string;
  linkUrl?: string;
  acceptLabel?: string;
  declineLabel?: string;
  decisionMode?: NotificationDecisionMode;
  decisionScope?: NotificationDecisionScope;
  decisionContext?: {
    transactionId?: string;
  };
}

export interface AppNotification {
  id: string;
  subject: string;
  contentHtml: string;
  targetRoles: string[];
  targetDeployments?: string[] | null;
  deploymentScope?: NotificationDeploymentScope | null;
  startsAt?: string | null;
  endsAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  isActive: boolean;
  isSystemGenerated?: boolean;
  systemKey?: string | null;
  isRead?: boolean;
  readAt?: string | null;
  actionResult?: NotificationDecision | null;
  actedAt?: string | null;
  actionConfig: NotificationActionConfig;
  metadata?: Record<string, unknown> | null;
  body?: string;
  type?: string;
}

export interface NotificationListResponse {
  items: AppNotification[];
  unreadCount: number;
}

export interface NotificationListPageResponse {
  items: AppNotification[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface NotificationRecipient {
  userId: string;
  userName?: string | null;
  userRole?: string | null;
  isRead: boolean;
  readAt?: string | null;
  actionResult?: NotificationDecision | null;
  actedAt?: string | null;
}

export interface NotificationDeploymentRecipient extends NotificationRecipient {
  deploymentKey?: string | null;
  deploymentName?: string | null;
}

export interface NotificationDeployment {
  licenseKey: string;
  clientName: string;
  domain?: string | null;
}

export interface NotificationDetailResponse {
  notification: AppNotification;
  recipients: NotificationDeploymentRecipient[];
  deployments: NotificationDeployment[];
  summary: {
    recipientCount: number;
    readCount: number;
    actedCount: number;
    acceptedCount: number;
    declinedCount: number;
  };
}

export interface ServiceSubscriptionItem {
  id: string;
  name: string;
  description?: string | null;
  amount?: number;
  isOptional: boolean;
  isActive: boolean;
  displayOrder: number;
  systemKey?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ServiceSubscriptionMethod {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  displayOrder: number;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface ServiceSubscriptionPayment {
  id: string;
  billingVersion: number;
  localReference?: string | null;
  gatewayPaymentId?: string | null;
  gatewayName?: string | null;
  billingInterval?: string | null;
  invoiceUrl?: string | null;
  amount: number;
  baseAmount: number;
  tipAmount: number;
  paymentMethodId?: string | null;
  paymentMethodName: string;
  transactionId: string;
  submittedBy: string;
  submittedByName?: string | null;
  status: 'processing' | 'approved' | 'rejected';
  submittedAt: string;
  reactivateAt?: string | null;
  processedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type ServiceSubscriptionState = 'unconfigured' | 'active' | 'warning' | 'expired' | 'renewing';

export interface ServiceSubscriptionOverview {
  state: ServiceSubscriptionState;
  writeBlocked: boolean;
  canManageConfig: boolean;
  planName?: string | null;
  billingInterval?: string | null;
  subscriptionStatus?: string | null;
  currentPeriodEnd?: string | null;
  dueAt?: string | null;
  resetDayOfMonth?: number | null;
  warningDays: number;
  billingVersion: number;
  totalAmount: number;
  yearlyAmount?: number;
  pricingMetadata?: {
    monthly?: number;
    yearly?: number;
    [key: string]: number | undefined;
  };
  minimumPaymentAmount: number;
  nagadNumber?: string | null;
  items: ServiceSubscriptionItem[];
  methods: ServiceSubscriptionMethod[];
  currentPayment?: ServiceSubscriptionPayment | null;
  payments: ServiceSubscriptionPayment[];
}

export type TransactionApprovalDecision = 'approve' | 'decline';

export interface TransactionApprovalReviewResult {
  transactionId: string;
  decision: TransactionApprovalDecision;
  success: boolean;
}

export type RecycleBinEntityType =
  | 'customer'
  | 'order'
  | 'bill'
  | 'transaction'
  | 'user'
  | 'vendor'
  | 'product';

export interface RecycleBinItem {
  id: string;
  entityType: RecycleBinEntityType;
  title: string;
  description?: string;
  details: string[];
  deletedAt: string;
  deletedBy?: string;
  deletedByName?: string;
  createdAt?: string;
  createdBy?: string;
  createdByName?: string;
  status?: string;
  amount?: number;
}

export interface RecycleBinPage {
  data: RecycleBinItem[];
  count: number;
}
