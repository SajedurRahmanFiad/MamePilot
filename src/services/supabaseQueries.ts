/// <reference types="vite/client" />
import type {
  Account,
  AppNotification,
  Bill,
  CompanySettings,
  NotificationListResponse,
  NotificationListPageResponse,
  NotificationDetailResponse,
  Customer,
  CustomerSalesReportData,
  Order,
  PayrollPayment,
  PayrollSettings,
  PayrollSummaryRow,
  Product,
  DashboardSnapshot,
  ExpenseSummaryCsvRow,
  ExpenseSummaryReport,
  IncomeSummaryReport,
  IncomeVsExpenseReport,
  PermissionsSettings,
  ProductQuantitySoldReport,
  ProfitLossReport,
  RecycleBinPage,
  RecycleBinEntityType,
  RecycleBinItem,
  Transaction,
  UserActivityPerformanceLogEntry,
  UserActivityPerformanceReportPage,
  User,
  Vendor,
  ServiceSubscriptionOverview,
  TransactionApprovalReviewResult,
  TransactionApprovalDecision,
  WalletActivityEntry,
  WalletBalanceCard,
  WalletBalanceCardPage,
  WalletEntryType,
  WalletPayout,
  WalletSettings,
  CompletePickedOrderPayload,
  CourierSettings,
  FraudCheckResult,
} from '../../types';
import { apiAction, type ApiActionOptions } from './apiClient';

export const DEFAULT_PAGE_SIZE = 25;

const call = <T>(action: string, payload?: unknown, options?: ApiActionOptions) => apiAction<T>(action, payload, options);
const remove = async (action: string, idOrPayload: string | Record<string, unknown>) => {
  await call(action, typeof idOrPayload === 'string' ? { id: idOrPayload } : idOrPayload);
};

export function getErrorMessage(err: any): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  if (err.message) return err.message;
  if (err.details) return err.details;
  if (err.hint) return err.hint;
  return JSON.stringify(err);
}

export async function fetchCustomers() { return call<Customer[]>('fetchCustomers'); }
export async function fetchCustomerById(id: string) { return call<Customer | null>('fetchCustomerById', { id }); }
export async function createCustomer(customer: Omit<Customer, 'id'>) { return call<Customer>('createCustomer', customer); }
export async function updateCustomer(id: string, updates: Partial<Customer>) { return call<Customer>('updateCustomer', { id, updates }); }
export async function deleteCustomer(id: string) { await remove('deleteCustomer', id); }
export async function fetchCustomersPage(page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE, search?: string) {
  return call<{ data: Customer[]; count: number }>('fetchCustomersPage', { page, pageSize, search });
}
export async function fetchCustomersMini() { return call<Array<{ id: string; name: string; phone?: string }>>('fetchCustomersMini'); }

export async function fetchOrders() { return call<Order[]>('fetchOrders'); }
export async function fetchOrderSearchPreview(search: string, limit: number = 10) {
  return call<Array<{ id: string; orderNumber: string; customerName?: string; customerPhone?: string }>>('fetchOrderSearchPreview', { search, limit });
}
export async function fetchDashboardSnapshot(params?: { filterRange?: string; customDates?: { from?: string; to?: string } }) {
  return call<DashboardSnapshot>('fetchDashboardSnapshot', params || {});
}
export async function fetchIncomeSummaryReport() {
  return call<IncomeSummaryReport>('fetchIncomeSummaryReport');
}
export async function fetchExpenseSummaryReport() {
  return call<ExpenseSummaryReport>('fetchExpenseSummaryReport');
}
export async function fetchExpenseSummaryCsv() {
  return call<ExpenseSummaryCsvRow[]>('fetchExpenseSummaryCsv');
}
export async function fetchIncomeVsExpenseReport() {
  return call<IncomeVsExpenseReport>('fetchIncomeVsExpenseReport');
}
export async function fetchProfitLossReport(params?: { filterRange?: string; customDates?: { from?: string; to?: string } }) {
  return call<ProfitLossReport>('fetchProfitLossReport', params || {});
}
export async function fetchProductQuantitySoldReport(params?: { filterRange?: string; customDates?: { from?: string; to?: string }; search?: string }) {
  return call<ProductQuantitySoldReport>('fetchProductQuantitySoldReport', params || {});
}
export async function fetchCustomerSalesReport(params?: { filterRange?: string; customDates?: { from?: string; to?: string }; search?: string }) {
  return call<CustomerSalesReportData>('fetchCustomerSalesReport', params || {});
}
export async function fetchOrdersPage(page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE, filters?: { status?: string; from?: string; to?: string; search?: string; createdByIds?: string[] }) {
  return call<{ data: Order[]; count: number }>('fetchOrdersPage', { page, pageSize, filters });
}
export async function fetchOrderById(id: string) { return call<Order | null>('fetchOrderById', { id }); }
export async function fetchOrdersByCustomerId(customerId: string) { return call<Order[]>('fetchOrdersByCustomerId', { customerId }); }
export async function fetchEmployeeOrderCounts(createdByIds: string[], filters?: { from?: string; to?: string }) {
  return call<Array<{ userId: string; orderCount: number }>>('fetchEmployeeOrderCounts', { createdByIds, filters });
}
export async function getNextOrderNumber(): Promise<string> { return call<string>('getNextOrderNumber'); }
export async function createOrder(order: Omit<Order, 'id'>) { return call<Order>('createOrder', order); }
export async function updateOrder(id: string, updates: Partial<Order>) { return call<Order | null>('updateOrder', { id, updates }); }
export async function deleteOrder(id: string) { await remove('deleteOrder', id); }
export async function completePickedOrder(payload: CompletePickedOrderPayload) { return call<Order>('completePickedOrder', payload); }
export async function fetchOrderByNumber(orderNumber: string) { return call<Order | null>('fetchOrderByNumber', { orderNumber }); }
export async function revertOrderStatus(payload: { orderId: string; targetStatus: string }) { return call<Order>('revertOrderStatus', payload); }

export async function fetchAccounts() { return call<Account[]>('fetchAccounts'); }
export async function fetchAccountById(id: string) { return call<Account | null>('fetchAccountById', { id }); }
export async function createAccount(account: Omit<Account, 'id'>) { return call<Account>('createAccount', account); }
export async function updateAccount(id: string, updates: Partial<Account>) { return call<Account>('updateAccount', { id, updates }); }
export async function deleteAccount(id: string) { await remove('deleteAccount', id); }

export async function fetchTransactions() { return call<Transaction[]>('fetchTransactions'); }
export async function fetchTransactionsPage(page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE, filters?: { type?: string; category?: string; from?: string; to?: string; search?: string; createdByIds?: string[] }) {
  return call<{ data: Transaction[]; count: number }>('fetchTransactionsPage', { page, pageSize, filters });
}
export async function fetchTransactionById(id: string) { return call<Transaction | null>('fetchTransactionById', { id }); }
export async function createTransaction(transaction: Omit<Transaction, 'id'>) { return call<Transaction>('createTransaction', transaction); }
export async function updateTransaction(id: string, updates: Partial<Transaction>) { return call<Transaction>('updateTransaction', { id, updates }); }
export async function deleteTransaction(id: string) { await remove('deleteTransaction', id); }

export async function fetchUsers() { return call<User[]>('fetchUsers'); }
export async function fetchUsersPage(page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE, filters?: { search?: string; role?: string }) {
  return call<{ data: User[]; count: number; roles: string[] }>('fetchUsersPage', { page, pageSize, ...(filters || {}) });
}
export async function fetchUsersMini() { return call<Array<{ id: string; name: string }>>('fetchUsersMini'); }
export async function fetchUserByPhone(phone: string) { return call<User | null>('fetchUserByPhone', { phone }); }
export async function fetchUserById(id: string) { return call<User | null>('fetchUserById', { id }); }
export async function fetchBootstrapSession(options?: ApiActionOptions) {
  return call<{ user: User; permissions: PermissionsSettings }>('bootstrapSession', {}, options);
}
export async function fetchUserActivityPerformanceReportPage(
  page: number = 1,
  pageSize: number = 10,
  params?: { search?: string; roleFilter?: string; filterRange?: string; customDates?: { from?: string; to?: string }; onlyActive?: boolean }
) {
  return call<UserActivityPerformanceReportPage>('fetchUserActivityPerformanceReportPage', { page, pageSize, ...(params || {}) });
}
export async function fetchUserActivityPerformanceLog(params: { userId: string; filterRange?: string; customDates?: { from?: string; to?: string } }) {
  return call<UserActivityPerformanceLogEntry[]>('fetchUserActivityPerformanceLog', params);
}
export async function loginUser(phone: string, password: string) {
  return call<{ user: User | null; token?: string | null; error?: string | null }>('loginUser', { phone, password });
}
export async function createUser(user: Omit<User, 'id'> & { password?: string }) { return call<User>('createUser', user); }
export async function updateUser(id: string, updates: Partial<User>) { return call<User>('updateUser', { id, updates }); }
export async function deleteUser(id: string) { await remove('deleteUser', id); }

export async function fetchVendorsPage(page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE, search?: string) {
  return call<{ data: Vendor[]; count: number }>('fetchVendorsPage', { page, pageSize, search });
}
export async function fetchBillsPage(page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE, filters?: { status?: string; from?: string; to?: string; search?: string; createdByIds?: string[] }) {
  return call<{ data: Bill[]; count: number }>('fetchBillsPage', { page, pageSize, filters });
}
export async function fetchBills() { return call<Bill[]>('fetchBills'); }
export async function fetchBillsByVendorId(vendorId: string) { return call<Bill[]>('fetchBillsByVendorId', { vendorId }); }
export async function fetchBillById(id: string) { return call<Bill | null>('fetchBillById', { id }); }
export async function getNextBillNumber(): Promise<string> { return call<string>('getNextBillNumber'); }
export async function createBill(bill: Omit<Bill, 'id'>) { return call<Bill>('createBill', bill); }
export async function updateBill(id: string, updates: Partial<Bill>) { return call<Bill>('updateBill', { id, updates }); }
export async function deleteBill(id: string) { await remove('deleteBill', id); }

export async function fetchVendors() { return call<Vendor[]>('fetchVendors'); }
export async function fetchVendorById(id: string) { return call<Vendor | null>('fetchVendorById', { id }); }
export async function createVendor(vendor: Omit<Vendor, 'id'>) { return call<Vendor>('createVendor', vendor); }
export async function updateVendor(id: string, updates: Partial<Vendor>) { return call<Vendor>('updateVendor', { id, updates }); }
export async function deleteVendor(id: string) { await remove('deleteVendor', id); }

export async function fetchProducts(category?: string) { return call<Product[]>('fetchProducts', { category }); }
export async function fetchProductById(id: string) { return call<Product | null>('fetchProductById', { id }); }
export async function fetchProductImagesByIds(productIds: string[]) { return call<Array<{ id: string; image: string }>>('fetchProductImagesByIds', { productIds }); }
export async function fetchProductsPage(page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE, search?: string, category?: string, createdByIds?: string[]) {
  return call<{ data: Product[]; count: number }>('fetchProductsPage', { page, pageSize, search, category, createdByIds });
}
export async function fetchProductsMini() { return call<Product[]>('fetchProductsMini'); }
export async function fetchProductsSearch(q: string, limit: number = 50) { return call<Product[]>('fetchProductsSearch', { q, limit }); }
export async function createProduct(product: Omit<Product, 'id'>) { return call<Product>('createProduct', product); }
export async function updateProduct(id: string, updates: Partial<Product>) { return call<Product>('updateProduct', { id, updates }); }
export async function deleteProduct(id: string) { await remove('deleteProduct', id); }

export async function fetchRecycleBinItems(): Promise<RecycleBinItem[]> { return call<RecycleBinItem[]>('fetchRecycleBinItems'); }
export async function fetchRecycleBinPage(page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE, params?: { search?: string; entityType?: string }): Promise<RecycleBinPage> {
  return call<RecycleBinPage>('fetchRecycleBinPage', { page, pageSize, ...(params || {}) });
}
export async function restoreDeletedItem(target: { entityType: RecycleBinEntityType; id: string }): Promise<void> { await call('restoreDeletedItem', target); }
export async function permanentlyDeleteDeletedItem(target: { entityType: RecycleBinEntityType; id: string }): Promise<void> { await call('permanentlyDeleteDeletedItem', target); }

export async function fetchCategories(type?: string) { return call<any[]>('fetchCategories', { type }); }
export async function fetchCategoriesById(id: string) { return call<any | null>('fetchCategoriesById', { id }); }
export async function createCategory(category: { name: string; type: 'Income' | 'Expense' | 'Product' | 'Other'; color?: string; parentId?: string; }) { return call<any>('createCategory', category); }
export async function updateCategory(id: string, updates: Partial<{ name: string; type: string; color: string; parentId: string; }>) { return call<any>('updateCategory', { id, updates }); }
export async function deleteCategory(id: string) { await remove('deleteCategory', id); }

export async function fetchPaymentMethods(activeOnly: boolean = true) { return call<any[]>('fetchPaymentMethods', { activeOnly }); }
export async function fetchPaymentMethodById(id: string) { return call<any | null>('fetchPaymentMethodById', { id }); }
export async function createPaymentMethod(method: { name: string; description?: string; }) { return call<any>('createPaymentMethod', method); }
export async function updatePaymentMethod(id: string, updates: Partial<{ name: string; description: string; }>) { return call<any>('updatePaymentMethod', { id, updates }); }
export async function deletePaymentMethod(id: string) { await remove('deletePaymentMethod', id); }

export async function fetchUnits() { return call<any[]>('fetchUnits'); }
export async function fetchUnitById(id: string) { return call<any | null>('fetchUnitById', { id }); }
export async function createUnit(unit: { name: string; shortName: string; description?: string; }) { return call<any>('createUnit', unit); }
export async function updateUnit(id: string, updates: Partial<{ name: string; shortName: string; description: string; }>) { return call<any>('updateUnit', { id, updates }); }
export async function deleteUnit(id: string) { await remove('deleteUnit', id); }

export async function fetchCompanySettings() { return call<CompanySettings>('fetchCompanySettings'); }
export async function updateCompanySettings(updates: Partial<CompanySettings>) { return call<CompanySettings>('updateCompanySettings', updates); }
export async function fetchOrderSettings() { return call<any>('fetchOrderSettings'); }
export async function updateOrderSettings(updates: { prefix?: string; nextNumber?: number; }) { return call<any>('updateOrderSettings', updates); }
export async function fetchInvoiceSettings() { return call<any>('fetchInvoiceSettings'); }
export async function updateInvoiceSettings(updates: { title?: string; logoWidth?: number; logoHeight?: number; footer?: string; }) { return call<any>('updateInvoiceSettings', updates); }
export async function fetchSystemDefaults(): Promise<{ defaultAccountId: string; defaultPaymentMethod: string; incomeCategoryId: string; expenseCategoryId: string; recordsPerPage: number; maxTransactionAmount: number; whiteLabel: boolean; }> { return call<any>('fetchSystemDefaults'); }
export async function updateSystemDefaults(updates: { defaultAccountId?: string; defaultPaymentMethod?: string; incomeCategoryId?: string; expenseCategoryId?: string; recordsPerPage?: number; maxTransactionAmount?: number; whiteLabel?: boolean; }) { return call<any>('updateSystemDefaults', updates); }
export async function fetchCourierSettings(): Promise<CourierSettings> { return call<CourierSettings>('fetchCourierSettings'); }
export async function updateCourierSettings(updates: {
  steadfast?: { baseUrl?: string; apiKey?: string; secretKey?: string };
  carryBee?: { baseUrl?: string; clientId?: string; clientSecret?: string; clientContext?: string; storeId?: string };
  paperfly?: { baseUrl?: string; username?: string; password?: string; paperflyKey?: string; defaultShopName?: string; maxWeightKg?: number };
  fraudChecker?: { apiKey?: string };
}): Promise<CourierSettings> { return call<CourierSettings>('updateCourierSettings', updates); }
export async function checkFraudCourierHistory(phone: string): Promise<FraudCheckResult> {
  return call<FraudCheckResult>('checkFraudCourierHistory', { phone }, { timeoutMs: 30000 });
}
export async function fetchPermissionsSettings(): Promise<PermissionsSettings> { return call<PermissionsSettings>('fetchPermissionsSettings'); }
export async function updatePermissionsSettings(updates: PermissionsSettings): Promise<PermissionsSettings> {
  return call<PermissionsSettings>('updatePermissionsSettings', updates);
}

export async function fetchPayrollSettings(): Promise<PayrollSettings> { return call<PayrollSettings>('fetchPayrollSettings'); }
export async function updatePayrollSettings(updates: Partial<PayrollSettings>): Promise<PayrollSettings> { return call<PayrollSettings>('updatePayrollSettings', updates); }
export async function fetchPayrollEmployees(): Promise<User[]> { return call<User[]>('fetchPayrollEmployees'); }
export async function fetchPayrollHistory(params?: { periodStart?: string; periodEnd?: string; employeeId?: string; currentUser?: Pick<User, 'id' | 'role'> | null; }): Promise<PayrollPayment[]> {
  return call<PayrollPayment[]>('fetchPayrollHistory', params || {});
}
export async function fetchPayrollSummaries(params: { periodStart: string; periodEnd: string; employeeId?: string; currentUser?: Pick<User, 'id' | 'role' | 'name'> | null; }): Promise<PayrollSummaryRow[]> {
  return call<PayrollSummaryRow[]>('fetchPayrollSummaries', params);
}
export async function markPayrollPaid(payload: { employeeId: string; periodStart: string; periodEnd: string; periodKind: 'month' | 'custom'; periodLabel: string; unitAmountSnapshot: number; countedStatusesSnapshot: any[]; orderCountSnapshot: number; amountSnapshot: number; note?: string; }): Promise<PayrollPayment> {
  return call<PayrollPayment>('markPayrollPaid', payload);
}

export async function fetchWalletSettings(): Promise<WalletSettings> { return call<WalletSettings>('fetchWalletSettings'); }
export async function updateWalletSettings(updates: Partial<WalletSettings>): Promise<WalletSettings> { return call<WalletSettings>('updateWalletSettings', updates); }
export async function fetchEmployeeWalletCards(params?: { currentUser?: Pick<User, 'id' | 'role'> | null; }): Promise<WalletBalanceCard[]> { return call<WalletBalanceCard[]>('fetchEmployeeWalletCards', params || {}); }
export async function fetchEmployeeWalletCardsPage(page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE, params?: { search?: string; currentUser?: Pick<User, 'id' | 'role'> | null; }): Promise<WalletBalanceCardPage> {
  return call<WalletBalanceCardPage>('fetchEmployeeWalletCardsPage', { page, pageSize, ...(params || {}) });
}
export async function fetchMyWallet(params?: { currentUser?: Pick<User, 'id' | 'role' | 'name'> | null; }): Promise<WalletBalanceCard | null> { return call<WalletBalanceCard | null>('fetchMyWallet', params || {}); }
export async function fetchWalletActivity(params?: { employeeId?: string; currentUser?: Pick<User, 'id' | 'role'> | null; entryTypes?: WalletEntryType[]; }): Promise<WalletActivityEntry[]> {
  return call<WalletActivityEntry[]>('fetchWalletActivity', params || {});
}
export async function fetchWalletActivityPage(page: number = 1, pageSize: number = DEFAULT_PAGE_SIZE, params?: { employeeId?: string; currentUser?: Pick<User, 'id' | 'role'> | null; entryTypes?: WalletEntryType[]; }): Promise<{ data: WalletActivityEntry[]; count: number }> {
  return call<{ data: WalletActivityEntry[]; count: number }>('fetchWalletActivityPage', { page, pageSize, ...(params || {}) });
}
export async function payEmployeeWallet(payload: { employeeId: string; amount: number; accountId: string; paymentMethod: string; categoryId: string; paidAt: string; note?: string; }): Promise<WalletPayout> {
  return call<WalletPayout>('payEmployeeWallet', payload);
}
export async function deleteEmployeeWalletPayout(id: string): Promise<{ success: boolean }> {
  return call<{ success: boolean }>('deleteEmployeeWalletPayout', { id });
}

export async function fetchCarryBeeStores(params: { baseUrl: string; clientId: string; clientSecret: string; clientContext: string; }) { return call<Array<{ id: string; name: string }>>('fetchCarryBeeStores', params); }
export async function fetchCarryBeeCities(params: { baseUrl: string; clientId: string; clientSecret: string; clientContext: string; }) { return call<Array<{ id: string; name: string }>>('fetchCarryBeeCities', params); }
export async function fetchCarryBeeZones(params: { baseUrl: string; clientId: string; clientSecret: string; clientContext: string; cityId: string; }) { return call<Array<{ id: string; name: string }>>('fetchCarryBeeZones', params); }
export async function fetchCarryBeeAreas(params: { baseUrl: string; clientId: string; clientSecret: string; clientContext: string; cityId: string; zoneId: string; }) { return call<Array<{ id: string; name: string }>>('fetchCarryBeeAreas', params); }
export async function submitCarryBeeOrder(params: { baseUrl: string; clientId: string; clientSecret: string; clientContext: string; storeId: string; deliveryType: number; productType: number; recipientPhone: string; recipientName: string; recipientAddress: string; cityId: string; zoneId: string; areaId?: string; itemWeight: number; collectableAmount: number; }): Promise<any> { return call<any>('submitCarryBeeOrder', params); }
export async function fetchCarryBeeOrderDetails(params: { baseUrl: string; clientId: string; clientSecret: string; clientContext: string; consignmentId: string; }): Promise<{ data?: any; error?: string }> { return call<{ data?: any; error?: string }>('fetchCarryBeeOrderDetails', params); }
export async function syncCarryBeeTransferStatuses(params?: { mode?: 'incremental' | 'backfill'; limit?: number; orderId?: string; cursorCreatedAt?: string; }): Promise<{ checked: number; updated: number; hasMore?: boolean; nextCursorCreatedAt?: string | null; statusCounts?: Record<string, number>; errors?: Array<{ orderId?: string; orderNumber?: string; error?: string }>; updatedOrders?: Array<{ orderId?: string; orderNumber?: string; rawStatus?: string }>; }> {
  return call('syncCarryBeeTransferStatuses', params || {});
}
export async function submitSteadfastOrder(params: { baseUrl: string; apiKey: string; secretKey: string; invoice: string; recipientName: string; recipientPhone: string; recipientAddress: string; codAmount: number; }): Promise<any> { return call<any>('submitSteadfastOrder', params); }
export async function fetchSteadfastStatusByTrackingCode(params: { baseUrl: string; apiKey: string; secretKey: string; trackingCode: string; }): Promise<{ data?: any; error?: string }> { return call<{ data?: any; error?: string }>('fetchSteadfastStatusByTrackingCode', params); }
export async function submitPaperflyOrder(params: { baseUrl: string; username: string; password: string; paperflyKey: string; merchantOrderReference: string; storeName: string; productBrief: string; packagePrice: number | string; maxWeightKg: number | string; customerName: string; customerAddress: string; customerPhone: string; }): Promise<any> { return call<any>('submitPaperflyOrder', params); }
export async function fetchPaperflyOrderTracking(params: { baseUrl: string; username: string; password: string; paperflyKey: string; referenceNumber: string; }): Promise<{ data?: any; error?: string }> { return call<{ data?: any; error?: string }>('fetchPaperflyOrderTracking', params); }
export async function syncPaperflyOrderStatuses(): Promise<{ checked: number; updated: number }> { return call<{ checked: number; updated: number }>('syncPaperflyOrderStatuses'); }
export async function syncSteadfastDeliveryStatuses(): Promise<{ checked: number; updated: number }> { return call<{ checked: number; updated: number }>('syncSteadfastDeliveryStatuses'); }

export async function fetchMyNotifications(): Promise<NotificationListResponse> {
  return call<NotificationListResponse>('fetchMyNotifications');
}

export async function fetchMyNotificationsPaginated(page: number = 1, pageSize: number = 10): Promise<NotificationListPageResponse> {
  return call<NotificationListPageResponse>('fetchMyNotificationsPaginated', { page, pageSize });
}

export async function fetchAllNotifications(): Promise<AppNotification[]> {
  return call<AppNotification[]>('fetchAllNotifications');
}

export async function fetchNotificationHistoryPage(page: number = 1, pageSize: number = 12): Promise<NotificationListPageResponse> {
  return call<NotificationListPageResponse>('fetchNotificationHistoryPage', { page, pageSize });
}

export async function fetchNotificationById(id: string): Promise<NotificationDetailResponse | null> {
  return call<NotificationDetailResponse | null>('fetchNotificationById', { id });
}

export async function createNotification(payload: {
  subject: string;
  contentHtml: string;
  targetRoles: string[];
  startsAt?: string | null;
  actionConfig?: {
    kind?: 'none' | 'link' | 'decision' | 'link_and_decision';
    linkLabel?: string;
    linkUrl?: string;
    acceptLabel?: string;
    declineLabel?: string;
    decisionMode?: 'record_only' | 'transaction_approval';
    decisionScope?: 'single_user' | 'all_users';
  };
}): Promise<AppNotification> {
  return call<AppNotification>('createNotification', payload);
}

export async function markNotificationRead(payload: {
  notificationId?: string;
  notificationIds?: string[];
}): Promise<{ success: boolean }> {
  return call<{ success: boolean }>('markNotificationRead', payload);
}

export async function respondToNotification(payload: {
  notificationId: string;
  decision: 'accepted' | 'declined';
}): Promise<{ success: boolean }> {
  return call<{ success: boolean }>('respondToNotification', payload);
}

export async function reviewTransactionApproval(payload: {
  transactionId: string;
  decision: TransactionApprovalDecision;
  notificationId?: string;
}): Promise<TransactionApprovalReviewResult> {
  return call<TransactionApprovalReviewResult>('reviewTransactionApproval', payload);
}

export async function fetchServiceSubscriptionOverview(): Promise<ServiceSubscriptionOverview> {
  return call<ServiceSubscriptionOverview>('fetchServiceSubscriptionOverview');
}

export async function saveServiceSubscriptionSettings(payload: {
  dueAt?: string | null;
  resetDayOfMonth?: number | null;
  warningDays?: number;
  totalAmount?: number;
  nagadNumber?: string | null;
  items?: Array<{
    id?: string;
    name: string;
    description?: string | null;
    amount?: number;
    isOptional?: boolean;
    isActive?: boolean;
    displayOrder?: number;
    systemKey?: string | null;
  }>;
  methods?: Array<{
    id?: string;
    name: string;
    description?: string | null;
    isActive?: boolean;
    displayOrder?: number;
  }>;
}): Promise<ServiceSubscriptionOverview> {
  return call<ServiceSubscriptionOverview>('saveServiceSubscriptionSettings', payload);
}

export async function submitServiceSubscriptionPayment(payload: {
  amount: number;
  paymentMethodId: string;
  transactionId: string;
}): Promise<ServiceSubscriptionOverview> {
  return call<ServiceSubscriptionOverview>('submitServiceSubscriptionPayment', payload);
}

export async function batchUpdateSettings(updates: { company?: Partial<CompanySettings>; order?: { prefix?: string; nextNumber?: number; }; invoice?: { title?: string; logoWidth?: number; logoHeight?: number; footer?: string; }; defaults?: { defaultAccountId?: string; defaultPaymentMethod?: string; incomeCategoryId?: string; expenseCategoryId?: string; recordsPerPage?: number; maxTransactionAmount?: number; whiteLabel?: boolean; }; courier?: { steadfast?: { baseUrl?: string; apiKey?: string; secretKey?: string }; carryBee?: { baseUrl?: string; clientId?: string; clientSecret?: string; clientContext?: string; storeId?: string }; paperfly?: { baseUrl?: string; username?: string; password?: string; paperflyKey?: string; defaultShopName?: string; maxWeightKg?: number }; fraudChecker?: { apiKey?: string }; }; permissions?: PermissionsSettings; payroll?: { unitAmount?: number; countedStatuses?: any[]; }; wallet?: { unitAmount?: number; countedStatuses?: any[]; }; }) {
  const { permissions, ...batchEligibleUpdates } = updates;
  const hasBatchEligibleUpdates = Object.keys(batchEligibleUpdates).length > 0;
  const batchResult = hasBatchEligibleUpdates
    ? await call<any>('batchUpdateSettings', { updates: batchEligibleUpdates })
    : {};

  if (permissions) {
    batchResult.permissions = await updatePermissionsSettings(permissions);
  }

  return batchResult;
}
