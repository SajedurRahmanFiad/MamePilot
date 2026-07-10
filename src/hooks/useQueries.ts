import { useQuery, UseQueryResult, UseQueryOptions } from '@tanstack/react-query';
import {
  fetchAllNotifications,
  fetchDeployments,
  fetchNotificationById,
  fetchNotificationHistoryPage,
  fetchCustomers,
  fetchCustomersPage,
  fetchCustomerById,
  fetchOrders,
  fetchOrderSearchPreview,
  fetchDashboardSnapshot,
  fetchIncomeSummaryReport,
  fetchExpenseSummaryReport,
  fetchExpenseSummaryCsv,
  fetchIncomeVsExpenseReport,
  fetchProfitLossReport,
  fetchProductQuantitySoldReport,
  fetchCustomerSalesReport,
  fetchOrdersPage,
  fetchOrderById,
  fetchOrdersByCustomerId,
  fetchEmployeeOrderCounts,
  fetchTransactionsPage,
  fetchProductsPage,
  fetchBills,
  fetchBillsByVendorId,
  fetchBillsPage,
  fetchBillById,
  fetchAccounts,
  fetchAccountById,
  fetchTransactions,
  fetchTransactionById,
  fetchUsers,
  fetchUsersPage,
  fetchUserActivityPerformanceLog,
  fetchUserActivityPerformanceReportPage,
  fetchUserById,
  fetchUserByPhone,
  fetchVendors,
  fetchVendorsPage,
  fetchVendorById,
  fetchProducts,
  fetchProductById,
  fetchProductImagesByIds,
  fetchCategories,
  fetchCategoriesById,
  fetchMyNotifications,
  fetchMyNotificationsPaginated,
  fetchPaymentMethods,
  fetchPaymentMethodById,
  fetchUnits,
  fetchUnitById,
  fetchCompanySettings,
  fetchOrderSettings,
  fetchInvoiceSettings,
  fetchSystemDefaults,
  fetchCapabilitySettings,
  fetchMaintenanceStatus,
  fetchCentralLicenseTiers,
  fetchLocalUsageSummary,
  fetchPaymentGatewaySettings,
  fetchAgentSettings,
  fetchCourierSettings,
  fetchMetaAdById,
  fetchMetaAds,
  fetchMetaAdsSettings,
  fetchMetaAdsConnectionStatus,
  fetchMetaAdsSyncCache,
  fetchMetaAdsSyncStatus,
  fetchMetaAdInsightsDaily,
  fetchMetaAdInsightsDemographics,
  fetchMetaAdInsightsPlacements,
  fetchMetaAdInsightsDevices,
  fetchPermissionsSettings,
  fetchPayrollSettings,
  fetchPayrollEmployees,
  fetchPayrollHistory,
  fetchPayrollSummaries,
  fetchWalletSettings,
  fetchEmployeeWalletCards,
  fetchEmployeeWalletCardsPage,
  fetchMyWallet,
  fetchWalletActivity,
  fetchWalletActivityPage,
  fetchServiceSubscriptionOverview,
  fetchRecycleBinItems,
  fetchRecycleBinPage,
  fetchBusinessGrowthSettings,
  fetchBusinessRecommendations,
} from '../services/supabaseQueries';
import { DEFAULT_PAGE_SIZE } from '../services/supabaseQueries';
import { useNetwork } from '../contexts/NetworkProvider';
import { usePageVisibility } from './usePageVisibility';
import type {
  Customer,
  Order,
  AppNotification,
  Bill,
  Account,
  Transaction,
  User,
  Vendor,
  Product,
  CompanySettings,
  CourierSettings,
  CapabilitySettings,
  CustomerSalesReportData,
  DashboardSnapshot,
  ExpenseSummaryCsvRow,
  ExpenseSummaryReport,
  IncomeSummaryReport,
  IncomeVsExpenseReport,
  PermissionsSettings,
  PayrollPayment,
  PayrollSettings,
  PayrollSummaryRow,
  ProductQuantitySoldReport,
  ProfitLossReport,
  RecycleBinPage,
  NotificationListResponse,
  NotificationListPageResponse,
  NotificationDetailResponse,
  ServiceSubscriptionOverview,
  WalletActivityEntry,
  UserActivityPerformanceLogEntry,
  MetaAdsSettings,
  UserActivityPerformanceReportPage,
  WalletEntryType,
  WalletBalanceCard,
  WalletBalanceCardPage,
  WalletSettings,
  RecycleBinItem,
  LocalUsageSummary,
  PaymentGatewaySettings,
  AgentSettings,
  LicenseTier,
} from '../../types';
import { db } from '../../db';
import { hasAdminAccess } from '../../types';

// ========== CUSTOMERS ==========

export function useCustomers(): UseQueryResult<Customer[], Error> {
  return useQuery({
    queryKey: ['customers'],
    queryFn: fetchCustomers,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCustomersPage(
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
  search?: string,
  options?: { enabled?: boolean },
): UseQueryResult<{ data: Customer[]; count: number }, Error> {
  return useQuery({
    queryKey: ['customers', page, pageSize, search],
    queryFn: () => fetchCustomersPage(page, pageSize, search),
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useCustomer(id: string | undefined): UseQueryResult<Customer | null, Error> {
  return useQuery({
    queryKey: ['customer', id],
    queryFn: () => fetchCustomerById(id || ''),
    enabled: !!id && !(id || '').startsWith('temp-'),
    staleTime: 5 * 60 * 1000,
  });
}

// ========== ORDERS ==========

export function useOrders(): UseQueryResult<Order[], Error> {
  return useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    staleTime: 5 * 60 * 1000,
  });
}

export function useDashboardSnapshot(
  filterRange: string = 'All Time',
  customDates: { from: string; to: string } = { from: '', to: '' }
): UseQueryResult<DashboardSnapshot, Error> {
  const normalizedCustomDates = {
    from: String(customDates?.from || ''),
    to: String(customDates?.to || ''),
  };

  return useQuery({
    queryKey: ['dashboard', filterRange, normalizedCustomDates.from, normalizedCustomDates.to],
    queryFn: () =>
      fetchDashboardSnapshot({
        filterRange,
        customDates: normalizedCustomDates,
      }),
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 1,
  });
}

export function useIncomeSummaryReport(
  options?: { enabled?: boolean }
): UseQueryResult<IncomeSummaryReport, Error> {
  return useQuery({
    queryKey: ['reports', 'income-summary'],
    queryFn: fetchIncomeSummaryReport,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });
}

export function useExpenseSummaryReport(
  options?: { enabled?: boolean }
): UseQueryResult<ExpenseSummaryReport, Error> {
  return useQuery({
    queryKey: ['reports', 'expense-summary'],
    queryFn: fetchExpenseSummaryReport,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });
}

export function useExpenseSummaryCsv(
  options?: { enabled?: boolean }
): UseQueryResult<ExpenseSummaryCsvRow[], Error> {
  return useQuery({
    queryKey: ['reports', 'expense-summary', 'csv'],
    queryFn: fetchExpenseSummaryCsv,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });
}

export function useIncomeVsExpenseReport(
  options?: { enabled?: boolean }
): UseQueryResult<IncomeVsExpenseReport, Error> {
  return useQuery({
    queryKey: ['reports', 'income-vs-expense'],
    queryFn: fetchIncomeVsExpenseReport,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });
}

export function useProfitLossReport(
  filterRange: string = 'This Year',
  customDates: { from: string; to: string } = { from: '', to: '' },
  options?: { enabled?: boolean }
): UseQueryResult<ProfitLossReport, Error> {
  const normalizedCustomDates = {
    from: String(customDates?.from || ''),
    to: String(customDates?.to || ''),
  };

  return useQuery({
    queryKey: ['reports', 'profit-loss', filterRange, normalizedCustomDates.from, normalizedCustomDates.to],
    queryFn: () =>
      fetchProfitLossReport({
        filterRange,
        customDates: normalizedCustomDates,
      }),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });
}

export function useProductQuantitySoldReport(
  filterRange: string = 'All Time',
  customDates: { from: string; to: string } = { from: '', to: '' },
  search: string = '',
  options?: { enabled?: boolean }
): UseQueryResult<ProductQuantitySoldReport, Error> {
  const normalizedCustomDates = {
    from: String(customDates?.from || ''),
    to: String(customDates?.to || ''),
  };
  const normalizedSearch = String(search || '').trim();

  return useQuery({
    queryKey: ['reports', 'product-quantity-sold', filterRange, normalizedCustomDates.from, normalizedCustomDates.to, normalizedSearch],
    queryFn: () =>
      fetchProductQuantitySoldReport({
        filterRange,
        customDates: normalizedCustomDates,
        search: normalizedSearch,
      }),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });
}

export function useCustomerSalesReportData(
  filterRange: string = 'All Time',
  customDates: { from: string; to: string } = { from: '', to: '' },
  search: string = '',
  options?: { enabled?: boolean }
): UseQueryResult<CustomerSalesReportData, Error> {
  const normalizedCustomDates = {
    from: String(customDates?.from || ''),
    to: String(customDates?.to || ''),
  };
  const normalizedSearch = String(search || '').trim();

  return useQuery({
    queryKey: ['reports', 'customer-sales', filterRange, normalizedCustomDates.from, normalizedCustomDates.to, normalizedSearch],
    queryFn: () =>
      fetchCustomerSalesReport({
        filterRange,
        customDates: normalizedCustomDates,
        search: normalizedSearch,
      }),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: false,
    enabled: options?.enabled ?? true,
  });
}

export function useOrderSearchPreview(
  search: string,
  limit: number = 10,
  options?: { enabled?: boolean }
): UseQueryResult<Array<{ id: string; orderNumber: string; customerName?: string; customerPhone?: string }>, Error> {
  const normalizedSearch = String(search || '').trim();

  return useQuery({
    queryKey: ['orders', 'search-preview', normalizedSearch, limit],
    queryFn: () => fetchOrderSearchPreview(normalizedSearch, limit),
    enabled: (options?.enabled ?? true) && normalizedSearch.length > 0,
    staleTime: 30 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

// Paginated orders hook
export function useOrdersPage(
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
  filters?: { status?: string; statusNot?: string; paymentStatus?: string; paymentStatusNot?: string; orderNumber?: string; orderNumberNot?: string; customerName?: string; customerNameNot?: string; customerPhone?: string; customerPhoneNot?: string; company?: string; companyNot?: string; courier?: string; courierNot?: string; sourceAd?: string; sourceAdNot?: string; from?: string; to?: string; search?: string; createdByIds?: string[]; createdByNot?: string },
  options?: { enabled?: boolean }
): UseQueryResult<{ data: Order[]; count: number }, Error> {
  return useQuery({
    queryKey: ['orders', page, pageSize, filters],
    queryFn: () => fetchOrdersPage(page, pageSize, filters),
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useOrder(id: string | undefined): UseQueryResult<Order | null, Error> {
  return useQuery({
    queryKey: ['order', id],
    queryFn: () => fetchOrderById(id || ''),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

export function useOrdersByCustomerId(customerId: string | undefined): UseQueryResult<Order[], Error> {
  return useQuery({
    queryKey: ['ordersByCustomerId', customerId],
    queryFn: () => fetchOrdersByCustomerId(customerId || ''),
    enabled: !!customerId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useEmployeeOrderCounts(
  createdByIds: string[],
  filters?: { from?: string; to?: string }
): UseQueryResult<Array<{ userId: string; orderCount: number }>, Error> {
  const normalizedIds = Array.from(new Set((createdByIds || []).map((id) => String(id || '').trim()).filter(Boolean))).sort();
  return useQuery({
    queryKey: ['employeeOrderCounts', ...normalizedIds, filters?.from, filters?.to],
    queryFn: () => fetchEmployeeOrderCounts(normalizedIds, filters),
    enabled: normalizedIds.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: 'always',
  });
}

// ========== BILLS ==========

export function useBills(): UseQueryResult<Bill[], Error> {
  return useQuery({
    queryKey: ['bills'],
    queryFn: fetchBills,
    staleTime: 5 * 60 * 1000,
  });
}

export function useBillsPage(
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
  filters?: { status?: string; from?: string; to?: string; search?: string; createdByIds?: string[] },
  options?: { enabled?: boolean }
): UseQueryResult<{ data: Bill[]; count: number }, Error> {
  return useQuery({
    queryKey: ['bills', page, pageSize, filters],
    queryFn: () => fetchBillsPage(page, pageSize, filters),
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useBillsByVendorId(vendorId: string | undefined): UseQueryResult<Bill[], Error> {
  return useQuery({
    queryKey: ['billsByVendorId', vendorId],
    queryFn: () => fetchBillsByVendorId(vendorId || ''),
    enabled: !!vendorId,
    staleTime: 5 * 60 * 1000,
    refetchOnMount: false,
  });
}

export function useBill(id: string | undefined): UseQueryResult<Bill | null, Error> {
  return useQuery({
    queryKey: ['bill', id],
    queryFn: () => fetchBillById(id || ''),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

// ========== ACCOUNTS ==========

export function useAccounts(options?: { enabled?: boolean }): UseQueryResult<Account[], Error> {
  return useQuery({
    queryKey: ['accounts'],
    queryFn: fetchAccounts,
    staleTime: 15 * 60 * 1000, // 15 minutes for master accounts cache (prefetched on auth)
    enabled: options?.enabled ?? true,
  });
}

export function useAccount(id: string | undefined): UseQueryResult<Account | null, Error> {
  return useQuery({
    queryKey: ['account', id],
    queryFn: () => fetchAccountById(id || ''),
    enabled: !!id,
    staleTime: 15 * 60 * 1000,
  });
}

// ========== TRANSACTIONS ==========

export function useTransactions(): UseQueryResult<Transaction[], Error> {
  return useQuery({
    queryKey: ['transactions'],
    queryFn: fetchTransactions,
    staleTime: 5 * 60 * 1000,
  });
}

// Paginated transactions hook
export function useTransactionsPage(
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
  filters?: { type?: string; category?: string; from?: string; to?: string; search?: string; createdByIds?: string[] },
  options?: { enabled?: boolean }
): UseQueryResult<{ data: Transaction[]; count: number }, Error> {
  return useQuery({
    queryKey: ['transactions', page, pageSize, filters],
    queryFn: () => fetchTransactionsPage(page, pageSize, filters),
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useTransaction(id: string | undefined): UseQueryResult<Transaction | null, Error> {
  return useQuery({
    queryKey: ['transaction', id],
    queryFn: () => fetchTransactionById(id || ''),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

// ========== USERS ==========

export function useUsers(): UseQueryResult<User[], Error> {
  return useQuery({
    queryKey: ['users'],
    queryFn: fetchUsers,
    staleTime: 5 * 60 * 1000, // 5 minutes - matches bills/orders cache, creator names stay fresh without refetch on every mutation
    refetchOnMount: 'always', // Always refetch to get latest user fields
  });
}

export function useUsersPage(
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
  filters?: { search?: string; role?: string },
  options?: { enabled?: boolean }
): UseQueryResult<{ data: User[]; count: number; roles: string[] }, Error> {
  return useQuery({
    queryKey: ['users', page, pageSize, filters],
    queryFn: () => fetchUsersPage(page, pageSize, filters),
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useUserActivityPerformanceReportPage(
  page: number = 1,
  pageSize: number = 10,
  filters?: { search?: string; roleFilter?: string; filterRange?: string; customDates?: { from?: string; to?: string }; onlyActive?: boolean },
  options?: { enabled?: boolean }
): UseQueryResult<UserActivityPerformanceReportPage, Error> {
  const normalizedFilters = {
    search: String(filters?.search || '').trim(),
    roleFilter: String(filters?.roleFilter || 'All Users'),
    filterRange: String(filters?.filterRange || 'All Time'),
    customDates: {
      from: String(filters?.customDates?.from || ''),
      to: String(filters?.customDates?.to || ''),
    },
    onlyActive: Boolean(filters?.onlyActive),
  };

  return useQuery({
    queryKey: ['reports', 'user-activity-performance', page, pageSize, normalizedFilters],
    queryFn: () => fetchUserActivityPerformanceReportPage(page, pageSize, normalizedFilters),
    placeholderData: (previousData) => previousData,
    staleTime: 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useUserActivityPerformanceLog(
  userId: string | undefined,
  filters?: { filterRange?: string; customDates?: { from?: string; to?: string } },
  options?: { enabled?: boolean }
): UseQueryResult<UserActivityPerformanceLogEntry[], Error> {
  const normalizedUserId = String(userId || '').trim();
  const normalizedFilters = {
    filterRange: String(filters?.filterRange || 'All Time'),
    customDates: {
      from: String(filters?.customDates?.from || ''),
      to: String(filters?.customDates?.to || ''),
    },
  };

  return useQuery({
    queryKey: ['reports', 'user-activity-performance', 'log', normalizedUserId, normalizedFilters],
    queryFn: () => fetchUserActivityPerformanceLog({ userId: normalizedUserId, ...normalizedFilters }),
    enabled: (options?.enabled ?? true) && normalizedUserId !== '',
    staleTime: 60 * 1000,
  });
}

export function useUser(id: string | undefined): UseQueryResult<User | null, Error> {
  return useQuery({
    queryKey: ['user', id],
    queryFn: () => fetchUserById(id || ''),
    enabled: !!id,
    staleTime: 10 * 1000, // 10 seconds - shorter for user details to ensure fresh password
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function useUserByPhone(phone: string | undefined): UseQueryResult<User | null, Error> {
  return useQuery({
    queryKey: ['userByPhone', phone],
    queryFn: () => fetchUserByPhone(phone || ''),
    enabled: !!phone,
    staleTime: 30 * 60 * 1000,
  });
}

// ========== VENDORS ==========

export function useVendors(): UseQueryResult<Vendor[], Error> {
  return useQuery({
    queryKey: ['vendors'],
    queryFn: fetchVendors,
    staleTime: 5 * 60 * 1000,
  });
}

export function useVendorsPage(
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
  search?: string,
  options?: { enabled?: boolean }
): UseQueryResult<{ data: Vendor[]; count: number }, Error> {
  return useQuery({
    queryKey: ['vendors', page, pageSize, search],
    queryFn: () => fetchVendorsPage(page, pageSize, search),
    placeholderData: (previousData) => previousData,
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useVendor(id: string | undefined): UseQueryResult<Vendor | null, Error> {
  return useQuery({
    queryKey: ['vendor', id],
    queryFn: () => fetchVendorById(id || ''),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}

// ========== PRODUCTS ==========

export function useProducts(category?: string): UseQueryResult<Product[], Error> {
  return useQuery({
    // Canonical key for non-paginated products list. Category is passed
    // to the fetcher but kept out of the root cache key to avoid
    // duplicate cache entries like ['products'] vs ['products', undefined].
    queryKey: ['products'],
    queryFn: () => fetchProducts(category),
    staleTime: 15 * 60 * 1000, // 15 minutes for master product cache (prefetched on auth)
  });
}

export function useProductsPage(
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
  search?: string,
  category?: string,
  createdByIds?: string[],
  queryOptions?: { enabled?: boolean }
): UseQueryResult<{ data: Product[]; count: number }, Error> {
  const options: UseQueryOptions<
    { data: Product[]; count: number },
    Error,
    { data: Product[]; count: number },
    (string | number | boolean | undefined)[]
  > & { keepPreviousData?: boolean } = {
    queryKey: ['products', page, pageSize, category, search, ...(createdByIds || [])],
    queryFn: () => fetchProductsPage(page, pageSize, search, category, createdByIds),
    placeholderData: (previousData) => previousData as any,
    staleTime: 15 * 60 * 1000,
    keepPreviousData: true,
    refetchOnWindowFocus: false,
    enabled: queryOptions?.enabled ?? true,
  };

  return useQuery(options);
}

export function useProduct(id: string | undefined): UseQueryResult<Product | null, Error> {
  return useQuery({
    queryKey: ['product', id],
    queryFn: () => fetchProductById(id || ''),
    enabled: !!id,
    staleTime: 15 * 60 * 1000, // Keep single-product cache consistent with products master cache
  });
}

// ========== RECYCLE BIN ==========

export function useRecycleBin(): UseQueryResult<RecycleBinItem[], Error> {
  return useQuery({
    queryKey: ['recycle-bin'],
    queryFn: fetchRecycleBinItems,
    staleTime: 60 * 1000,
    refetchOnMount: false,
  });
}

export function useRecycleBinPage(
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
  options?: {
    search?: string;
    entityType?: string;
    enabled?: boolean;
  }
): UseQueryResult<RecycleBinPage, Error> {
  const normalizedSearch = String(options?.search || '').trim();
  const normalizedEntityType = String(options?.entityType || 'all');

  return useQuery({
    queryKey: ['recycle-bin', 'page', page, pageSize, normalizedSearch, normalizedEntityType],
    queryFn: () =>
      fetchRecycleBinPage(page, pageSize, {
        search: normalizedSearch,
        entityType: normalizedEntityType,
      }),
    enabled: options?.enabled ?? true,
    placeholderData: (previousData) => previousData,
    staleTime: 60 * 1000,
    refetchOnMount: false,
  });
}

export function useProductImagesByIds(
  productIds: string[] | undefined
): UseQueryResult<Record<string, string>, Error> {
  const ids = Array.from(
    new Set((productIds || []).map((id) => String(id || '').trim()).filter(Boolean))
  ).sort();

  return useQuery({
    queryKey: ['product-images', ...ids],
    queryFn: async () => {
      const rows = await fetchProductImagesByIds(ids);
      return rows.reduce((acc, row) => {
        acc[row.id] = row.image || '';
        return acc;
      }, {} as Record<string, string>);
    },
    enabled: ids.length > 0,
    staleTime: 15 * 60 * 1000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

// ========== CATEGORIES ==========

export function useCategories(type?: string, options?: { enabled?: boolean }): UseQueryResult<any[], Error> {
  return useQuery({
    queryKey: ['categories', type],
    queryFn: () => fetchCategories(type),
    staleTime: 60 * 60 * 1000, // 60 minutes for categories
    enabled: options?.enabled ?? true,
  });
}

export function useCategory(id: string | undefined): UseQueryResult<any | null, Error> {
  return useQuery({
    queryKey: ['category', id],
    queryFn: () => fetchCategoriesById(id || ''),
    enabled: !!id,
    staleTime: 60 * 60 * 1000,
  });
}

// ========== PAYMENT METHODS ==========

export function usePaymentMethods(activeOnly?: boolean, options?: { enabled?: boolean }): UseQueryResult<any[], Error> {
  return useQuery({
    queryKey: ['paymentMethods', activeOnly],
    queryFn: () => fetchPaymentMethods(activeOnly),
    staleTime: 60 * 60 * 1000, // 60 minutes for payment methods
    enabled: options?.enabled ?? true,
  });
}

export function usePaymentMethod(id: string | undefined): UseQueryResult<any | null, Error> {
  return useQuery({
    queryKey: ['paymentMethod', id],
    queryFn: () => fetchPaymentMethodById(id || ''),
    enabled: !!id,
    staleTime: 60 * 60 * 1000,
  });
}

// ========== UNITS ==========

export function useUnits(): UseQueryResult<any[], Error> {
  return useQuery({
    queryKey: ['units'],
    queryFn: fetchUnits,
    staleTime: 60 * 60 * 1000, // 60 minutes for units
  });
}

export function useUnit(id: string | undefined): UseQueryResult<any | null, Error> {
  return useQuery({
    queryKey: ['unit', id],
    queryFn: () => fetchUnitById(id || ''),
    enabled: !!id,
    staleTime: 60 * 60 * 1000,
  });
}

// ========== SETTINGS ==========

export function useCompanySettings(): UseQueryResult<CompanySettings, Error> {
  return useQuery({
    queryKey: ['settings', 'company'],
    queryFn: fetchCompanySettings,
    staleTime: 60 * 60 * 1000, // 60 minutes for settings
  });
}

export function useOrderSettings(): UseQueryResult<any, Error> {
  return useQuery({
    queryKey: ['settings', 'order'],
    queryFn: fetchOrderSettings,
    staleTime: 60 * 60 * 1000,
  });
}

export function useInvoiceSettings(): UseQueryResult<any, Error> {
  return useQuery({
    queryKey: ['settings', 'invoice'],
    queryFn: fetchInvoiceSettings,
    staleTime: 60 * 60 * 1000,
  });
}

export function useSystemDefaults(): UseQueryResult<any, Error> {
  return useQuery({
    queryKey: ['settings', 'defaults'],
    queryFn: fetchSystemDefaults,
    staleTime: 60 * 60 * 1000,
  });
}

export function useCapabilitySettings(enabled: boolean = true): UseQueryResult<CapabilitySettings, Error> {
  return useQuery({
    queryKey: ['settings', 'capabilities'],
    queryFn: fetchCapabilitySettings,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

export function useMaintenanceStatus(enabled: boolean = true): UseQueryResult<{ maintenanceEnabled: boolean }, Error> {
  return useQuery({
    queryKey: ['maintenance-status'],
    queryFn: fetchMaintenanceStatus,
    staleTime: 5000,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function useCentralLicenseTiers(
  payload?: { licenseApiUrl?: string; licenseOwnerToken?: string },
  enabled: boolean = true
): UseQueryResult<{ tiers: LicenseTier[] }, Error> {
  return useQuery({
    queryKey: ['central-license-tiers', payload?.licenseApiUrl],
    queryFn: () => fetchCentralLicenseTiers(payload),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
}

export function usePaymentGatewaySettings(enabled: boolean = true): UseQueryResult<PaymentGatewaySettings, Error> {
  return useQuery({
    queryKey: ['settings', 'payment-gateway'],
    queryFn: fetchPaymentGatewaySettings,
    staleTime: 60 * 60 * 1000,
    enabled,
  });
}

export function useAgentSettings(enabled: boolean = true): UseQueryResult<AgentSettings, Error> {
  return useQuery({
    queryKey: ['settings', 'agent'],
    queryFn: fetchAgentSettings,
    staleTime: 60 * 60 * 1000,
    enabled,
  });
}

export function useBusinessGrowthSettings(enabled: boolean = true) {
  return useQuery({
    queryKey: ['settings', 'business-growth'],
    queryFn: fetchBusinessGrowthSettings,
    staleTime: 60 * 60 * 1000,
    enabled,
  });
}

export function useBusinessRecommendations(enabled: boolean = true) {
  return useQuery({
    queryKey: ['business-recommendations'],
    queryFn: fetchBusinessRecommendations,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

export function useLocalUsageSummary(enabled: boolean = true): UseQueryResult<LocalUsageSummary, Error> {
  return useQuery({
    queryKey: ['local-usage-summary'],
    queryFn: fetchLocalUsageSummary,
    staleTime: 2 * 60 * 1000,
    enabled,
  });
}

export function useMyNotifications(enabled: boolean = true): UseQueryResult<NotificationListResponse, Error> {
  const currentUser = db.currentUser ?? null;
  const { isOnline } = useNetwork();
  const canPoll = enabled && !!currentUser?.id && isOnline;

  return useQuery({
    queryKey: ['notifications', 'me', currentUser?.id, currentUser?.role],
    queryFn: fetchMyNotifications,
    staleTime: 30 * 1000,
    refetchInterval: canPoll ? 30 * 1000 : false,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    enabled: enabled && !!currentUser?.id,
  });
}

export function useMyNotificationsPaginated(
  page: number = 1,
  pageSize: number = 10,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    refetchInterval?: number | false;
    refetchIntervalInBackground?: boolean;
    refetchOnWindowFocus?: boolean;
    refetchOnReconnect?: boolean;
    refetchOnMount?: boolean | 'always';
  }
): UseQueryResult<NotificationListPageResponse, Error> {
  const currentUser = db.currentUser ?? null;
  const { isOnline } = useNetwork();
  const effectiveRefetchInterval = isOnline ? (options?.refetchInterval ?? false) : false;

  return useQuery({
    queryKey: ['notifications', 'me', 'paginated', page, pageSize, currentUser?.id, currentUser?.role],
    queryFn: () => fetchMyNotificationsPaginated(page, pageSize),
    placeholderData: (previousData) => previousData,
    staleTime: options?.staleTime ?? 5 * 60 * 1000,
    refetchInterval: effectiveRefetchInterval,
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? true,
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? false,
    refetchOnReconnect: options?.refetchOnReconnect ?? true,
    refetchOnMount: options?.refetchOnMount ?? true,
    enabled: (options?.enabled ?? true) && !!currentUser?.id,
  });
}

export function useAllNotifications(enabled: boolean = true): UseQueryResult<AppNotification[], Error> {
  const currentUser = db.currentUser ?? null;
  const { isOnline } = useNetwork();
  const isPageVisible = usePageVisibility();
  const canPoll = enabled && !!currentUser?.id && isOnline && isPageVisible;

  return useQuery({
    queryKey: ['notifications', 'all', currentUser?.id, currentUser?.role],
    queryFn: fetchAllNotifications,
    staleTime: 30 * 1000,
    refetchInterval: canPoll ? 30 * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
    enabled: enabled && !!currentUser?.id,
  });
}

export function useNotificationHistoryPage(
  page: number = 1,
  pageSize: number = 12,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    refetchOnWindowFocus?: boolean;
    refetchOnReconnect?: boolean;
    refetchOnMount?: boolean | 'always';
  }
): UseQueryResult<NotificationListPageResponse, Error> {
  const currentUser = db.currentUser ?? null;

  return useQuery({
    queryKey: ['notifications', 'history', page, pageSize, currentUser?.id, currentUser?.role],
    queryFn: () => fetchNotificationHistoryPage(page, pageSize),
    placeholderData: (previousData) => previousData,
    staleTime: options?.staleTime ?? 30 * 1000,
    refetchOnWindowFocus: options?.refetchOnWindowFocus ?? true,
    refetchOnReconnect: options?.refetchOnReconnect ?? true,
    refetchOnMount: options?.refetchOnMount ?? true,
    enabled: (options?.enabled ?? true) && !!currentUser?.id,
  });
}

export function useNotificationById(id: string | undefined, enabled: boolean = true): UseQueryResult<NotificationDetailResponse | null, Error> {
  const currentUser = db.currentUser ?? null;

  return useQuery({
    queryKey: ['notification', id, currentUser?.id, currentUser?.role],
    queryFn: () => fetchNotificationById(id || ''),
    enabled: enabled && !!currentUser?.id && !!id,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

export function useDeployments(enabled: boolean = true): UseQueryResult<Array<{ licenseKey: string; clientName: string; domain?: string | null; tierKey?: string }>, Error> {
  const currentUser = db.currentUser ?? null;

  return useQuery({
    queryKey: ['deployments', currentUser?.id],
    queryFn: () => fetchDeployments(),
    enabled: enabled && !!currentUser?.id,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  });
}

export function useServiceSubscriptionOverview(enabled: boolean = true): UseQueryResult<ServiceSubscriptionOverview, Error> {
  const currentUser = db.currentUser ?? null;
  const { isOnline } = useNetwork();
  const isPageVisible = usePageVisibility();
  const isAdminAccessUser = hasAdminAccess(currentUser?.role);
  const refetchInterval = isAdminAccessUser ? 2 * 60 * 1000 : false;
  const canPoll = enabled && !!currentUser?.id && isOnline && isPageVisible && refetchInterval !== false;

  return useQuery({
    queryKey: ['service-subscription', currentUser?.id, currentUser?.role],
    queryFn: fetchServiceSubscriptionOverview,
    staleTime: isAdminAccessUser ? 2 * 60 * 1000 : 10 * 60 * 1000,
    refetchInterval: canPoll ? refetchInterval : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: isAdminAccessUser,
    refetchOnReconnect: true,
    refetchOnMount: true,
    enabled: enabled && !!currentUser?.id,
  });
}

export function useCourierSettings(): UseQueryResult<CourierSettings, Error> {
  return useQuery({
    queryKey: ['settings', 'courier'],
    queryFn: fetchCourierSettings,
    staleTime: 60 * 60 * 1000,
  });
}

export function useMetaAdsConnectionStatus(enabled: boolean = true): UseQueryResult<any, Error> {
  return useQuery({
    queryKey: ['meta-ads', 'connection-status'],
    queryFn: fetchMetaAdsConnectionStatus,
    staleTime: 60 * 1000,
    enabled,
  });
}

export function useMetaAdsSettings(enabled: boolean = true): UseQueryResult<MetaAdsSettings, Error> {
  return useQuery({
    queryKey: ['meta-ads', 'settings'],
    queryFn: fetchMetaAdsSettings,
    staleTime: 60 * 1000,
    enabled,
  });
}

export function useMetaAds(
  filters?: {
    businessId?: string;
    businessOperator?: string;
    adAccountId?: string;
    adAccountOperator?: string;
    campaignId?: string;
    campaignOperator?: string;
    status?: string;
    statusOperator?: string;
    from?: string;
    to?: string;
    search?: string;
    searchOperator?: string;
  },
  enabled: boolean = true
): UseQueryResult<any, Error> {
  const normalizedFilters = {
    businessId: String(filters?.businessId || ''),
    businessOperator: String(filters?.businessOperator || '='),
    adAccountId: String(filters?.adAccountId || ''),
    adAccountOperator: String(filters?.adAccountOperator || '='),
    campaignId: String(filters?.campaignId || ''),
    campaignOperator: String(filters?.campaignOperator || '='),
    status: String(filters?.status || ''),
    statusOperator: String(filters?.statusOperator || '='),
    from: String(filters?.from || ''),
    to: String(filters?.to || ''),
    search: String(filters?.search || '').trim(),
    searchOperator: String(filters?.searchOperator || 'contains'),
  };

  return useQuery({
    queryKey: ['meta-ads', 'list', normalizedFilters],
    queryFn: () => fetchMetaAds(normalizedFilters),
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    enabled,
  });
}

export function useMetaAd(id: string | undefined, enabled: boolean = true): UseQueryResult<any | null, Error> {
  return useQuery({
    queryKey: ['meta-ads', 'detail', id],
    queryFn: () => fetchMetaAdById(id || ''),
    enabled: enabled && !!id,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  });
}

export function useMetaAdsSyncCache(enabled: boolean = true): UseQueryResult<any, Error> {
  return useQuery({
    queryKey: ['meta-ads', 'sync-cache'],
    queryFn: fetchMetaAdsSyncCache,
    staleTime: 10 * 1000,
    enabled,
  });
}

export function useMetaAdsSyncStatus(enabled: boolean = true): UseQueryResult<{ lastSyncedAt: string | null; lastManualSyncAt: string | null; syncDurationMs: number | null; cooldownRemainingSeconds: number }, Error> {
  return useQuery({
    queryKey: ['meta-ads', 'sync-status'],
    queryFn: fetchMetaAdsSyncStatus,
    staleTime: 5 * 1000,
    refetchInterval: 10 * 1000,
    enabled,
  });
}

export function usePermissionsSettings(enabled: boolean = true): UseQueryResult<PermissionsSettings, Error> {
  return useQuery({
    queryKey: ['settings', 'permissions'],
    queryFn: fetchPermissionsSettings,
    staleTime: 60 * 60 * 1000,
    enabled,
  });
}

export function usePayrollSettings(): UseQueryResult<PayrollSettings, Error> {
  return useQuery({
    queryKey: ['settings', 'payroll'],
    queryFn: fetchPayrollSettings,
    staleTime: 60 * 60 * 1000,
  });
}

export function usePayrollEmployees(enabled: boolean = true): UseQueryResult<User[], Error> {
  return useQuery({
    queryKey: ['payroll', 'employees'],
    queryFn: fetchPayrollEmployees,
    staleTime: 15 * 60 * 1000,
    enabled,
  });
}

export function usePayrollSummaries(
  periodStart: string | undefined,
  periodEnd: string | undefined,
  employeeId?: string
): UseQueryResult<PayrollSummaryRow[], Error> {
  const currentUser = db.currentUser ?? null;

  return useQuery({
    queryKey: ['payroll', 'summaries', periodStart, periodEnd, employeeId, currentUser?.id, currentUser?.role],
    queryFn: () =>
      fetchPayrollSummaries({
        periodStart: periodStart || '',
        periodEnd: periodEnd || '',
        employeeId,
        currentUser,
      }),
    enabled: !!currentUser?.id && !!periodStart && !!periodEnd,
    staleTime: 60 * 1000,
    refetchOnMount: false,
  });
}

export function usePayrollHistory(
  periodStart?: string,
  periodEnd?: string,
  employeeId?: string,
  enabled: boolean = true
): UseQueryResult<PayrollPayment[], Error> {
  const currentUser = db.currentUser ?? null;

  return useQuery({
    queryKey: ['payroll', 'history', periodStart, periodEnd, employeeId, currentUser?.id, currentUser?.role],
    queryFn: () =>
      fetchPayrollHistory({
        periodStart,
        periodEnd,
        employeeId,
        currentUser,
      }),
    enabled: enabled && !!currentUser?.id,
    staleTime: 60 * 1000,
    refetchOnMount: false,
  });
}

export function useWalletSettings(): UseQueryResult<WalletSettings, Error> {
  return useQuery({
    queryKey: ['settings', 'wallet'],
    queryFn: fetchWalletSettings,
    staleTime: 60 * 60 * 1000,
  });
}

export function useEmployeeWalletCards(
  enabled: boolean = true
): UseQueryResult<WalletBalanceCard[], Error> {
  const currentUser = db.currentUser ?? null;

  return useQuery({
    queryKey: ['wallet', 'cards', currentUser?.id, currentUser?.role],
    queryFn: () =>
      fetchEmployeeWalletCards({
        currentUser,
      }),
    enabled: enabled && !!currentUser?.id,
    staleTime: 60 * 1000,
    refetchOnMount: false,
  });
}

export function useEmployeeWalletCardsPage(
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
  options?: {
    search?: string;
    enabled?: boolean;
  }
): UseQueryResult<WalletBalanceCardPage, Error> {
  const currentUser = db.currentUser ?? null;
  const normalizedSearch = String(options?.search || '').trim();

  return useQuery({
    queryKey: ['wallet', 'cards', 'page', page, pageSize, normalizedSearch, currentUser?.id, currentUser?.role],
    queryFn: () =>
      fetchEmployeeWalletCardsPage(page, pageSize, {
        search: normalizedSearch,
        currentUser,
      }),
    enabled: (options?.enabled ?? true) && !!currentUser?.id,
    placeholderData: (previousData) => previousData,
    staleTime: 60 * 1000,
    refetchOnMount: false,
  });
}

export function useMyWallet(enabled: boolean = true): UseQueryResult<WalletBalanceCard | null, Error> {
  const currentUser = db.currentUser ?? null;

  return useQuery({
    queryKey: ['wallet', 'me', currentUser?.id, currentUser?.role],
    queryFn: () =>
      fetchMyWallet({
        currentUser,
      }),
    enabled: enabled && !!currentUser?.id,
    staleTime: 60 * 1000,
    refetchOnMount: false,
  });
}

export function useWalletActivity(
  employeeId?: string,
  enabled: boolean = true,
  entryTypes?: WalletEntryType[]
): UseQueryResult<WalletActivityEntry[], Error> {
  const currentUser = db.currentUser ?? null;

  return useQuery({
    queryKey: ['wallet', 'activity', employeeId, currentUser?.id, currentUser?.role, entryTypes?.join(',') || 'all'],
    queryFn: () =>
      fetchWalletActivity({
        employeeId,
        currentUser,
        entryTypes,
      }),
    enabled: enabled && !!currentUser?.id,
    staleTime: 60 * 1000,
    refetchOnMount: false,
  });
}

export function useWalletActivityPage(
  page: number = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
  options?: {
    employeeId?: string;
    enabled?: boolean;
    entryTypes?: WalletEntryType[];
  }
): UseQueryResult<{ data: WalletActivityEntry[]; count: number }, Error> {
  const currentUser = db.currentUser ?? null;

  return useQuery({
    queryKey: [
      'wallet',
      'activity',
      'page',
      page,
      pageSize,
      options?.employeeId,
      currentUser?.id,
      currentUser?.role,
      options?.entryTypes?.join(',') || 'all',
    ],
    queryFn: () =>
      fetchWalletActivityPage(page, pageSize, {
        employeeId: options?.employeeId,
        currentUser,
        entryTypes: options?.entryTypes,
      }),
    enabled: (options?.enabled ?? true) && !!currentUser?.id,
    placeholderData: (previousData) => previousData,
    staleTime: 60 * 1000,
    refetchOnMount: false,
  });
}

// ========== META ADS INSIGHTS ==========

export function useMetaAdInsightsDaily(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['meta-ads', 'insights', 'daily', id],
    queryFn: () => fetchMetaAdInsightsDaily(id || ''),
    enabled: !!id && enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMetaAdInsightsDemographics(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['meta-ads', 'insights', 'demographics', id],
    queryFn: () => fetchMetaAdInsightsDemographics(id || ''),
    enabled: !!id && enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMetaAdInsightsPlacements(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['meta-ads', 'insights', 'placements', id],
    queryFn: () => fetchMetaAdInsightsPlacements(id || ''),
    enabled: !!id && enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMetaAdInsightsDevices(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ['meta-ads', 'insights', 'devices', id],
    queryFn: () => fetchMetaAdInsightsDevices(id || ''),
    enabled: !!id && enabled,
    staleTime: 5 * 60 * 1000,
  });
}