
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
  | 'customers.view'
  | 'customers.create'
  | 'customers.edit'
  | 'customers.delete'
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
  | 'transactions.view'
  | 'transactions.create'
  | 'transactions.edit'
  | 'transactions.delete'
  | 'vendors.view'
  | 'vendors.create'
  | 'vendors.edit'
  | 'vendors.delete'
  | 'products.view'
  | 'products.create'
  | 'products.edit'
  | 'products.delete'
  | 'accounts.view'
  | 'accounts.create'
  | 'accounts.edit'
  | 'accounts.delete'
  | 'fraudChecker.check'
  | 'transfers.create'
  | 'reports.view'
  | 'wallet.view'
  | 'payroll.view'
  | 'recycleBin.view'
  | 'users.view'
  | 'undoer.view';

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
  RETURNED = 'Returned',
  CANCELLED = 'Cancelled'
}

export type OrderCompletionOutcome = 'Delivered' | 'Returned';

export enum BillStatus {
  ON_HOLD = 'On Hold',
  PROCESSING = 'Processing',
  RECEIVED = 'Received',
  PAID = 'Paid'
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
  deletedAt?: string;
  deletedBy?: string;
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
}

export interface Product {
  id: string;
  name: string;
  image: string;
  category: string;
  salePrice: number;
  purchasePrice: number;
  stock: number;
  createdBy?: string;
  deletedAt?: string;
  deletedBy?: string;
}

export interface OrderItem {
  productId: string;
  productName: string;
  rate: number;
  quantity: number;
  amount: number;
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
  fraudChecker: FraudCheckerSettings;
}

export interface MetaAdsSettings {
  appId: string;
  appSecret: string;
  redirectUri: string;
  loginConfigId: string;
  graphVersion: string;
  oauthScopes: string;
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
  | 'enterprise_ai_agent';

export type AppCapabilityMap = Record<AppCapabilityKey, boolean>;

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

export type AiMainProvider = 'anthropic' | 'openai' | 'google';

export interface AiProviderConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  organization?: string;
  project?: string;
}

export interface AgentSettings {
  enabled: boolean;
  mainProvider: AiMainProvider;
  anthropic: AiProviderConfig;
  openai: AiProviderConfig;
  google: AiProviderConfig;
  groq: AiProviderConfig;
  showReasoningSummaries: boolean;
  showToolActivity: boolean;
  maxReasoningSteps: number;
  maxToolCalls: number;
  queryRowLimit: number;
  queryTimeoutMs: number;
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
  countedOrderCount: number;
  unitAmount: number;
  estimatedAmount: number;
  paymentStatus: 'paid' | 'unpaid';
  paymentSnapshot?: PayrollPayment;
  liveAmountDelta?: number;
  liveOrderCountDelta?: number;
}

export type WalletEntryType = 'order_credit' | 'order_reversal' | 'payout';

export interface WalletSettings {
  unitAmount: number;
  countedStatuses: OrderStatus[];
}

export interface WalletBalanceCard {
  employeeId: string;
  employeeName: string;
  employeeRole: string;
  currentBalance: number;
  totalEarned: number;
  totalPaid: number;
  creditedOrders: number;
  lastActivityAt?: string;
}

export interface WalletBalanceSummary {
  totalBalance: number;
  totalEarned: number;
  totalPaid: number;
  employeesDue: number;
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
  paidAt: string;
  paidBy: string;
  paidByName?: string;
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

export interface NotificationDetailResponse {
  notification: AppNotification;
  recipients: NotificationRecipient[];
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
