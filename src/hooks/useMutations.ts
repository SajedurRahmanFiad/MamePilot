import { useMutation, UseMutationResult, useQueryClient } from '@tanstack/react-query';
import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  createNotification,
  createOrder,
  completePickedOrder,
  revertOrderStatus,
  updateOrder,
  deleteOrder,
  createBill,
  updateBill,
  deleteBill,
  processOrderReturnExchange,
  processBillReturn,
  createAccount,
  updateAccount,
  deleteAccount,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  markNotificationRead,
  respondToNotification,
  reviewTransactionApproval,
  saveServiceSubscriptionSettings,
  submitServiceSubscriptionPayment,
  createUser,
  updateUser,
  deleteUser,
  createVendor,
  updateVendor,
  deleteVendor,
  createProduct,
  updateProduct,
  deleteProduct,
  createCategory,
  updateCategory,
  deleteCategory,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  createUnit,
  updateUnit,
  deleteUnit,
  updateCompanySettings,
  updateOrderSettings,
  createVendor,
  updateVendor,
  deleteVendor,
  createProduct,
  updateProduct,
  deleteProduct,
  createCategory,
  updateCategory,
  deleteCategory,
  createPaymentMethod,
  updatePaymentMethod,
  deletePaymentMethod,
  createUnit,
  updateUnit,
  deleteUnit,
  updateCompanySettings,
  updateOrderSettings,
  updateInvoiceSettings,
  updateSystemDefaults,
  updateCapabilitySettings,
  setMaintenanceStatus,
  syncLicenseCapabilities,
  createOrUpdateCentralLicense,
  updateCentralLicenseOverride,
  resetCentralLicenseOverride,
  updatePaymentGatewaySettings,
  registerWebhookWithCentral,
  unregisterWebhookFromCentral,
  updateAgentSettings,
  updateBusinessGrowthSettings,
  updateLlmSettings,
  updateBeSmartSettings,
  refreshBusinessRecommendations,
  initiatePipraPayCheckout,
  beginMetaAdsOAuth,
  syncMetaAds,
  updateMetaAdsSettings,
  updateCourierSettings,
  checkFraudCourierHistory,
  updatePermissionsSettings,
  updateVoiceSurveySettings,
  updateVoiceSurveyIntegrationSettings,
  triggerSurveyCall,
  retrySurveyCall,
  cancelSurveyCall,
  updateDeveloperNotes,
  initiateRechargeCheckout,
  updateEmailSettings,
  updatePayrollSettings,
  markPayrollPaid,
  updateWalletSettings,
  payEmployeeWallet,
  deleteEmployeeWalletPayout,
  batchUpdateSettings,
  restoreDeletedItem,
  permanentlyDeleteDeletedItem,
  updateWhatsAppSettings,
  updateWhatsAppWelcomeExperience,
  testWhatsAppConnection,
  createWhatsAppConversation,
  markWhatsAppConversationRead,
  sendWhatsAppMessage,
  sendWhatsAppMediaMessage,
  sendWhatsAppTemplate,
  updateMessengerSettings,
  testMessengerConnection,
  subscribeMessengerPage,
  updateMessengerProfile,
  markMessengerConversationRead,
  sendMessengerMessage,
  sendMessengerMediaMessage,
  sendMessengerQuickReplies,
  sendMessengerCard,
  sendMessengerReaction,
  sendMessengerSenderAction,
  type MaintenanceStatus,
  type MaintenanceUpdatePayload,
} from '../services/supabaseQueries';
import { DEFAULT_PAGE_SIZE } from '../services/supabaseQueries';
import type {
  Customer,
  Order,
  Bill,
  Account,
  Transaction,
  User,
  Vendor,
  Product,
  CompanySettings,
  OrderStatus,
  PermissionsSettings,
  PayrollPayment,
  PayrollSettings,
  ServiceSubscriptionOverview,
  TransactionApprovalDecision,
  TransactionApprovalReviewResult,
  EmployeeWalletPayoutPayload,
  WalletPayout,
  WalletSettings,
  RecycleBinEntityType,
  CompletePickedOrderPayload,
  FraudCheckResult,
  CapabilitySettings,
  PaymentGatewaySettings,
  AppCapabilityMap,
  AgentSettings,
  MetaAdsSettings,
  ProcessOrderReturnExchangePayload,
  ProcessBillReturnPayload,
  VoiceSurveySettings,
  VoiceSurveyIntegrationSettings,
  WhatsAppSettings,
  WhatsAppContact,
  WhatsAppMessage,
  MessengerSettings,
  MessengerProfileSettings,
  MessengerMessage,
  LlmSettings,
  BeSmartSettings,
} from '../../types';

const NOTIFICATIONS_UPDATED_STORAGE_KEY = 'app:notifications-updated-at';
let notificationsBroadcastChannel: BroadcastChannel | null = null;

function broadcastNotificationsUpdated(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const timestamp = String(Date.now());
  window.dispatchEvent(new CustomEvent('app:notifications-updated', { detail: { timestamp } }));

  try {
    window.localStorage.setItem(NOTIFICATIONS_UPDATED_STORAGE_KEY, timestamp);
  } catch (error) {
    console.warn('[notifications] Failed to persist update timestamp:', error);
  }

  if (typeof BroadcastChannel === 'undefined') {
    return;
  }

  if (notificationsBroadcastChannel === null) {
    notificationsBroadcastChannel = new BroadcastChannel('app-notifications');
  }

  notificationsBroadcastChannel.postMessage({ type: 'updated', timestamp });
}
import { generateTempId, registerRealId, isTempId } from '../utils/optimisticIdMap';

// Helper: parse react-query page keys which follow the pattern ['resource', page, pageSize, filters?]
function parsePageKey(k: any[]): { page: number; pageSize: number; filters: any } {
  let page = 1;
  let pageSize = DEFAULT_PAGE_SIZE;
  let filters: any = undefined;

  for (let i = 1; i < k.length; i++) {
    const v = k[i];
    if (typeof v === 'number' && Number.isInteger(v)) {
      if (page === 1) {
        page = v;
      } else if (pageSize === DEFAULT_PAGE_SIZE) {
        pageSize = v;
      }
    } else {
      filters = v;
      break;
    }
  }
  return { page, pageSize, filters };
}

function parseComparableDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw) return null;
  const ymd = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getResourceDateValue(resource: string, row: any): any {
  if (resource === 'orders') return row.orderDate || row.order_date || row.createdAt || row.created_at || null;
  if (resource === 'bills') return row.billDate || row.bill_date || row.createdAt || row.created_at || null;
  if (resource === 'transactions') return row.date || row.createdAt || row.created_at || null;
  return row.createdAt || row.created_at || row.date || null;
}

// Helper: determine whether a row belongs to a paginated filter set for known resources
function matchesFiltersForResource(resource: string, row: any, filters: any): boolean {
  if (!filters) return true;
  try {
    // Generic checks: status, from/to dates, createdBy/created_by
    if (filters.status && filters.status !== 'All') {
      if ((row.status || row.status === '') && row.status !== filters.status) return false;
    }
    const rowDate = parseComparableDate(getResourceDateValue(resource, row));
    if (filters.from) {
      const fromD = parseComparableDate(filters.from);
      if (fromD && (!rowDate || rowDate < fromD)) return false;
    }
    if (filters.to) {
      const toD = parseComparableDate(filters.to);
      if (toD && (!rowDate || rowDate > toD)) return false;
    }
    if (filters.createdByIds && Array.isArray(filters.createdByIds) && filters.createdByIds.length > 0) {
      const cb = row.createdBy || row.created_by;
      if (!cb || !filters.createdByIds.includes(cb)) return false;
    }

    // Resource-specific heuristics
    if (resource === 'bills') {
      if (filters.vendorId && (row.vendorId || row.vendor_id) && (row.vendorId || row.vendor_id) !== filters.vendorId) return false;
    }
    if (resource === 'transactions') {
      if (filters.accountId && (row.accountId || row.account_id) && (row.accountId || row.account_id) !== filters.accountId) return false;
      if (filters.contactId && (row.contactId || row.contact_id) && (row.contactId || row.contact_id) !== filters.contactId) return false;
      if (filters.type && (row.type || row.type === '') && row.type !== filters.type) return false;
    }

    return true;
  } catch (e) {
    return false;
  }
}

// Helper: invalidate all cached pages for a resource (including paginated keys)
function invalidateDashboardQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['dashboard'], exact: false });
}

function invalidateResourceQueries(queryClient: ReturnType<typeof useQueryClient>, resource: string) {
  queryClient.invalidateQueries({ queryKey: [resource], exact: false });
  invalidateDashboardQueries(queryClient);
}

function invalidateRecycleBin(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['recycle-bin'], exact: false });
}

function invalidateEntityAfterRecycleBinAction(
  queryClient: ReturnType<typeof useQueryClient>,
  entityType: RecycleBinEntityType
) {
  invalidateRecycleBin(queryClient);

  if (entityType === 'customer') {
    invalidateResourceQueries(queryClient, 'customers');
    queryClient.invalidateQueries({ queryKey: ['customer'] });
    return;
  }

  if (entityType === 'order') {
    invalidateResourceQueries(queryClient, 'orders');
    queryClient.invalidateQueries({ queryKey: ['order'] });
    queryClient.invalidateQueries({ queryKey: ['customers'] });
    queryClient.invalidateQueries({ queryKey: ['ordersByCustomerId'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['employeeOrderCounts'] });
    queryClient.invalidateQueries({ queryKey: ['payroll'] });
    queryClient.invalidateQueries({ queryKey: ['wallet'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['accounts'] });
    return;
  }

  if (entityType === 'bill') {
    invalidateResourceQueries(queryClient, 'bills');
    queryClient.invalidateQueries({ queryKey: ['bill'] });
    queryClient.invalidateQueries({ queryKey: ['vendors'] });
    queryClient.invalidateQueries({ queryKey: ['billsByVendorId'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['accounts'] });
    return;
  }

  if (entityType === 'transaction') {
    invalidateResourceQueries(queryClient, 'transactions');
    queryClient.invalidateQueries({ queryKey: ['transaction'] });
    queryClient.invalidateQueries({ queryKey: ['accounts'] });
    return;
  }

  if (entityType === 'user') {
    invalidateResourceQueries(queryClient, 'users');
    queryClient.invalidateQueries({ queryKey: ['user'] });
    queryClient.invalidateQueries({ queryKey: ['wallet'] });
    queryClient.invalidateQueries({ queryKey: ['payroll'] });
    return;
  }

  if (entityType === 'vendor') {
    invalidateResourceQueries(queryClient, 'vendors');
    queryClient.invalidateQueries({ queryKey: ['vendor'] });
    return;
  }

  if (entityType === 'product') {
    invalidateResourceQueries(queryClient, 'products');
    queryClient.invalidateQueries({ queryKey: ['product'] });
  }
}

// ========== CUSTOMERS ==========

export function useCreateCustomer(): UseMutationResult<Customer, Error, Partial<Customer>, unknown> {
  const queryClient = useQueryClient();
  const patchCustomerPages = (newCust: Customer) => {
    // Update page 1 if cached
    const page1 = queryClient.getQueryData<any>(['customers', 1]);
    if (page1 && Array.isArray(page1.data)) {
      const { pageSize: sz } = parsePageKey(['customers', 1]);
      queryClient.setQueryData(['customers', 1], { ...page1, data: [newCust, ...page1.data].slice(0, sz), count: (page1.count || 0) + 1 });
    } else {
      // no-op fallback: do not invalidate entire page; creation is handled deterministically elsewhere
    }
  };
  return useMutation({
    mutationFn: createCustomer,
    onMutate: async (newCustomer) => {
      // Cancel outgoing queries to prevent race conditions
      await queryClient.cancelQueries({ queryKey: ['customers'] });
      
      // Snapshot previous data
      const previousCustomers = queryClient.getQueryData<Customer[]>(['customers']);
      
      // Optimistically add to list with stable temp ID
      if (previousCustomers) {
        const tempId = generateTempId('customer');
        const optimisticCustomer = {
          ...newCustomer,
          id: tempId,
        } as Customer;
        queryClient.setQueryData(['customers'], [...previousCustomers, optimisticCustomer]);

        // Also patch paginated page 1 if present so components reading ['customers', 1] update immediately
        const custPage1 = queryClient.getQueryData<any>(['customers', 1]);
        if (custPage1 && Array.isArray(custPage1.data)) {
          const { pageSize: sz } = parsePageKey(['customers', 1]);
          queryClient.setQueryData(['customers', 1], { ...custPage1, data: [optimisticCustomer, ...custPage1.data].slice(0, sz), count: (custPage1.count || 0) + 1 });
        }

        return { previousCustomers, tempId, optimisticCustomer };
      }
      return { previousCustomers };
    },
    onError: (err, newCustomer, context) => {
      // Rollback on error
      if (context?.previousCustomers) {
        queryClient.setQueryData(['customers'], context.previousCustomers);
      }
    },
    onSuccess: async (data: Customer, _variables, context) => {
      // Register tempId mapping if present
      try {
        if (context?.tempId) registerRealId(context.tempId, data.id);
      } catch (e) {}

      // Update detail cache
      queryClient.setQueryData(['customer', data.id], data);

      // Replace optimistic entries in non-paginated list
      try {
        const prev = queryClient.getQueryData<Customer[]>(['customers']) || [];
        const cleaned = (prev || []).filter(c => !isTempId(String(c.id)));
        if (!cleaned.some(c => c.id === data.id)) {
          queryClient.setQueryData(['customers'], [data, ...cleaned]);
        } else {
          queryClient.setQueryData(['customers'], cleaned.map(c => c.id === data.id ? data : c));
        }
      } catch (e) {}

      // Deterministically patch cached first pages for customers respecting filters (no invalidation)
      const pages = queryClient.getQueriesData({ queryKey: ['customers'] });
      pages.forEach(([key, value]) => {
        try {
          const k = key as any[];
          const { page: pageNum, pageSize: sz, filters } = parsePageKey(k);
          if (pageNum !== 1) return;
          if (value && (value as any).data && Array.isArray((value as any).data)) {
            const matches = (() => {
              if (!filters) return true;
              if (filters.search) {
                const q = String(filters.search).trim().toLowerCase();
                if (q) {
                  const v = String(data.name || '') + ' ' + String(data.phone || '') + ' ' + String(data.address || '');
                  if (!v.toLowerCase().includes(q)) return false;
                }
              }
              return true;
            })();
            if (matches) {
              queryClient.setQueryData(key as any, { ...(value as any), data: [data, ...((value as any).data)].slice(0, sz || DEFAULT_PAGE_SIZE), count: (value as any).count ? (value as any).count + 1 : 1 });
            }
          }
        } catch (e) {}
      });

      // Ensure paginated tables refetch if key shapes didn't match optimistic patch
      invalidateResourceQueries(queryClient, 'customers');
    },
  });
}

export function useUpdateCustomer(): UseMutationResult<Customer, Error, { id: string; updates: Partial<Customer> }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => updateCustomer(id, updates),
    onMutate: async ({ id, updates }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['customers'] });
      await queryClient.cancelQueries({ queryKey: ['customer', id] });
      
      // Snapshot previous data
      const previousCustomers = queryClient.getQueryData<Customer[]>(['customers']);
      const previousCustomer = queryClient.getQueryData<Customer>(['customer', id]);
      
      // Optimistically update list
      if (previousCustomers) {
        queryClient.setQueryData(['customers'], 
          previousCustomers.map(c => c.id === id ? { ...c, ...updates } : c)
        );
      }
      
      // Optimistically update detail view
      if (previousCustomer) {
        queryClient.setQueryData(['customer', id], { ...previousCustomer, ...updates });
      }
      
      return { previousCustomers, previousCustomer };
    },
    onError: (err, variables, context) => {
      // Rollback on error
      if (context?.previousCustomers) {
        queryClient.setQueryData(['customers'], context.previousCustomers);
      }
      if (context?.previousCustomer) {
        queryClient.setQueryData(['customer', variables.id], context.previousCustomer);
      }
    },
    onSuccess: (data) => {
      // Patch paginated customer pages in-place to avoid full refetch
      const pages = queryClient.getQueriesData({ queryKey: ['customers'] });
      pages.forEach(([key, value]) => {
        try {
          if (value && (value as any).data && Array.isArray((value as any).data)) {
            queryClient.setQueryData(key as any, { ...(value as any), data: (value as any).data.map((c: any) => c.id === data.id ? data : c) });
          }
        } catch (e) {
          // ignore per-page patch errors
        }
      });
      queryClient.setQueryData(['customer', data.id], data);
    },
  });
}

export function useDeleteCustomer(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCustomer,
    onMutate: async (id) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['customers'] });
      
      // Snapshot previous data
      const previousCustomers = queryClient.getQueryData<Customer[]>(['customers']);
      
      // Optimistically remove from list
      if (previousCustomers) {
        queryClient.setQueryData(['customers'], previousCustomers.filter(c => c.id !== id));
      }
      
      return { previousCustomers };
    },
    onError: (err, id, context) => {
      // Rollback on error
      if (context?.previousCustomers) {
        queryClient.setQueryData(['customers'], context.previousCustomers);
      }
    },
    onSuccess: (_data, id) => {
      // Remove deleted customer from paginated caches and try to maintain page size by pulling from next cached page
      const pages = queryClient.getQueriesData({ queryKey: ['customers'] });
      const pageMap = new Map<string, any>();
      pages.forEach(([key, value]) => {
        const k = key as any[];
        const { page: pageNum, pageSize: sz, filters } = parsePageKey(k);
        // Skip non-paginated queries
        if (typeof pageNum !== 'number' || !Number.isInteger(pageNum)) return;
        pageMap.set(JSON.stringify([pageNum, sz, filters]), { key: k, value, pageSize: sz });
      });

      const keys = Array.from(pageMap.keys()).sort((a, b) => JSON.parse(a)[0] - JSON.parse(b)[0]);
      for (const mapKey of keys) {
        const entry = pageMap.get(mapKey);
        if (!entry) continue;
        const { key: k, value, pageSize: sz } = entry;
        try {
          if (value && value.data && Array.isArray(value.data)) {
            const filtered = value.data.filter((c: any) => c.id !== id);
            const pageNum = (parsePageKey(k)).page as number;
            const filters = (parsePageKey(k)).filters;
            const nextKey = JSON.stringify([pageNum + 1, sz, filters]);
            const nextEntry = pageMap.get(nextKey);
            if (nextEntry && nextEntry.value && Array.isArray(nextEntry.value.data) && nextEntry.value.data.length > 0) {
              const shiftItem = nextEntry.value.data[0];
              nextEntry.value.data = nextEntry.value.data.slice(1);
              filtered.push(shiftItem);
              queryClient.setQueryData(nextEntry.key as any, { ...(nextEntry.value), data: nextEntry.value.data, count: Math.max(0, (nextEntry.value.count || 1) - 1) });
            }
            queryClient.setQueryData(k as any, { ...(value), data: filtered, count: Math.max(0, (value.count || 1) - 1) });
          }
        } catch (e) {}
      }

      // Ensure paginated customer tables refetch if key shapes didn't match optimistic patch
      invalidateResourceQueries(queryClient, 'customers');
      invalidateRecycleBin(queryClient);
    },
  });
}

// ========== ORDERS ==========

export function useCreateOrder(): UseMutationResult<Order, Error, Omit<Order, 'id'>, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (order) => createOrder(order),
    onMutate: async (newOrder) => {
      // Cancel outgoing queries to prevent race conditions
      await queryClient.cancelQueries({ queryKey: ['orders'] });
      await queryClient.cancelQueries({ queryKey: ['orders-search'] });
      
      // Get the current orders list
      const previousOrders = queryClient.getQueryData<Order[]>(['orders']) || [];
      
      // Create optimistic order with stable temp ID
      const tempId = generateTempId('order');
      const optimisticOrder: Order = {
        ...newOrder,
        id: tempId,
        paidAmount: newOrder.paidAmount || 0,
      } as Order;
      
      // Optimistically add to the top of the list (newest first)
      queryClient.setQueryData(['orders'], [optimisticOrder, ...previousOrders]);

      // Also patch paginated page 1 if cached so components using ['orders', 1] show the optimistic order immediately
      const ordersPage1 = queryClient.getQueryData<any>(['orders', 1]);
      if (ordersPage1 && Array.isArray(ordersPage1.data)) {
        const { pageSize: sz } = parsePageKey(['orders', 1]);
        queryClient.setQueryData(['orders', 1], { ...ordersPage1, data: [optimisticOrder, ...ordersPage1.data].slice(0, sz), count: (ordersPage1.count || 0) + 1 });
      }
      
      return { previousOrders, optimisticOrder, tempId };
    },
    onError: (err, newOrder, context) => {
      // Rollback to previous data on error
      if (context?.previousOrders) {
        queryClient.setQueryData(['orders'], context.previousOrders);
      }
    },
    onSuccess: async (data, variables, context) => {
      // Register the mapping of temp ID → real ID
      if (context?.tempId) {
        registerRealId(context.tempId, data.id);
      }

      // Cache the newly created order for immediate access in details view
      queryClient.setQueryData(['order', data.id], data);

      // Patch cached BROWSING pages (no search term in key)
      const browsingPages = queryClient.getQueriesData({ queryKey: ['orders'] });
      browsingPages.forEach(([key, value]) => {
        try {
          const k = key as any[];
          const { page: pageNum, pageSize: sz, filters } = parsePageKey(k);
          // Only modify first page entries
          if (pageNum !== 1) return;
          if (value && (value as any).data && Array.isArray((value as any).data)) {
            const matchesFilters = matchesFiltersForResource('orders', data, filters);

            if (matchesFilters) {
              queryClient.setQueryData(key as any, { ...(value as any), data: [data, ...((value as any).data)].slice(0, sz || DEFAULT_PAGE_SIZE), count: (value as any).count ? (value as any).count + 1 : 1 });
            }
          }
        } catch (e) {
          // ignore per-page patch errors
        }
      });

      // Invalidate ALL search pages since the new order might match any search term
      // We don't deterministically patch search results because the order might not match the search filter
      queryClient.invalidateQueries({
        queryKey: ['orders-search'],
        exact: false,
      });

      // Best-effort: increment nextNumber in settings locally for optimistic UI
      try {
        const currentSettings = queryClient.getQueryData<{ prefix: string; nextNumber: number }>(['settings', 'order']);
        if (currentSettings) {
          // Extract numeric part from created order number and use next value
          const match = (data.orderNumber || '').match(/(\d+)$/);
          if (match) {
            const createdNum = parseInt(match[1], 10);
            const nextNum = Math.max(createdNum + 1, currentSettings.nextNumber);
            queryClient.setQueryData(['settings', 'order'], { ...currentSettings, nextNumber: nextNum });
          } else {
            // Fallback: just increment
            queryClient.setQueryData(['settings', 'order'], { ...currentSettings, nextNumber: currentSettings.nextNumber + 1 });
          }
        }
      } catch (err) {
        console.error('Failed to locally update order settings:', err);
      }

      // Ensure paginated order tables refetch if key shapes didn't match optimistic patch
      invalidateResourceQueries(queryClient, 'orders');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['ordersByCustomerId'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['employeeOrderCounts'] });
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
}

export function useUpdateOrder(): UseMutationResult<Order, Error, { id: string; updates: Partial<Order> }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => updateOrder(id, updates),
    onMutate: async ({ id, updates }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['orders'] });
      await queryClient.cancelQueries({ queryKey: ['orders-search'] });
      await queryClient.cancelQueries({ queryKey: ['order', id] });
      await queryClient.cancelQueries({ queryKey: ['ordersByCustomerId'] });
      
      // Snapshot previous data
      const previousOrders = queryClient.getQueryData<Order[]>(['orders']);
      const previousOrder = queryClient.getQueryData<Order>(['order', id]);
      
      // Update all related query caches
      if (previousOrders) {
        queryClient.setQueryData(['orders'], 
          previousOrders.map(o => o.id === id ? { ...o, ...updates } : o)
        );
      }
      
      if (previousOrder) {
        queryClient.setQueryData(['order', id], { ...previousOrder, ...updates });
      }
      
      // Update customer-specific orders if cached
      if (previousOrder?.customerId) {
        const customerOrders = queryClient.getQueryData<Order[]>(['ordersByCustomerId', previousOrder.customerId]);
        if (customerOrders) {
          queryClient.setQueryData(
            ['ordersByCustomerId', previousOrder.customerId],
            customerOrders.map(o => o.id === id ? { ...o, ...updates } : o)
          );
        }
      }
      
      return { previousOrders, previousOrder };
    },
    onError: (err, variables, context) => {
      if (context?.previousOrders) {
        queryClient.setQueryData(['orders'], context.previousOrders);
      }
      if (context?.previousOrder) {
        queryClient.setQueryData(['order', variables.id], context.previousOrder);
      }
    },
    onSuccess: (data, variables) => {
      // Update any cached BROWSING paginated order pages in-place to avoid full refetch
      const browsingPages = queryClient.getQueriesData({ queryKey: ['orders'] });
      browsingPages.forEach(([key, value]) => {
        try {
          if (value && (value as any).data && Array.isArray((value as any).data)) {
            queryClient.setQueryData(key as any, { ...(value as any), data: (value as any).data.map((o: any) => o.id === data.id ? data : o) });
          }
        } catch (e) {
          // ignore per-page patch errors
        }
      });

      // Invalidate ALL search pages since the updated order might have matched/unmatched search filters
      queryClient.invalidateQueries({
        queryKey: ['orders-search'],
        exact: false,
      });

      // Update detail cache deterministically
      queryClient.setQueryData(['order', data.id], data);

      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['ordersByCustomerId'] });
      queryClient.invalidateQueries({ queryKey: ['employeeOrderCounts'] });
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      invalidateDashboardQueries(queryClient);

      // Stock can change when status/items change
      if (variables?.updates?.status !== undefined || variables?.updates?.items !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['products'], exact: false });
      }
    },
  });
}

export function useCompletePickedOrder(): UseMutationResult<Order, Error, CompletePickedOrderPayload, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: completePickedOrder,
    onSuccess: (data) => {
      queryClient.setQueryData(['order', data.id], data);
      queryClient.invalidateQueries({ queryKey: ['orders'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['customers'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['ordersByCustomerId'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['transactions'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['accounts'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['products'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['employeeOrderCounts'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['payroll'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['wallet'], exact: false });
      invalidateDashboardQueries(queryClient);
    },
  });
}

export function useProcessOrderReturnExchange(): UseMutationResult<Order, Error, ProcessOrderReturnExchangePayload, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: processOrderReturnExchange,
    onSuccess: (data) => {
      queryClient.setQueryData(['order', data.id], data);
      queryClient.invalidateQueries({ queryKey: ['orders'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['customers'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['ordersByCustomerId'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['transactions'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['accounts'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['products'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['employeeOrderCounts'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['payroll'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['wallet'], exact: false });
      invalidateDashboardQueries(queryClient);
    },
  });
}

export function useDeleteOrder(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteOrder,
    onMutate: async (id) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['orders'] });
      await queryClient.cancelQueries({ queryKey: ['orders-search'] });
      
      // Snapshot previous data
      const previousOrders = queryClient.getQueryData<Order[]>(['orders']);
      
      // Optimistically remove
      if (previousOrders) {
        queryClient.setQueryData(['orders'], previousOrders.filter(o => o.id !== id));
      }
      
      return { previousOrders };
    },
    onError: (err, id, context) => {
      if (context?.previousOrders) {
        queryClient.setQueryData(['orders'], context.previousOrders);
      }
    },
    onSuccess: (_data, id) => {
      // Remove deleted order from any cached BROWSING paginated pages and try to maintain page size by pulling from next cached page
      const pages = queryClient.getQueriesData({ queryKey: ['orders'] });
      // Build a map of pages by page number + pageSize + filters so we can pull from next page
      const pageMap = new Map<string, any>();
      pages.forEach(([key, value]) => {
        const k = key as any[];
        const { page: pageNum, pageSize: sz, filters } = parsePageKey(k);
        // Skip non-paginated queries
        if (typeof pageNum !== 'number' || !Number.isInteger(pageNum)) return;
        const mapKey = JSON.stringify([pageNum, sz, filters]);
        pageMap.set(mapKey, { key: k, value, pageSize: sz });
      });

      // Iterate pages in ascending page number order to remove and pull
      const keys = Array.from(pageMap.keys()).sort((a, b) => {
        const pa = JSON.parse(a)[0] as number;
        const pb = JSON.parse(b)[0] as number;
        return pa - pb;
      });

      for (const mapKey of keys) {
        const entry = pageMap.get(mapKey);
        if (!entry) continue;
        const { key: k, value, pageSize: sz } = entry;
        try {
          if (value && value.data && Array.isArray(value.data)) {
            // Remove the deleted id
            const filtered = value.data.filter((o: any) => o.id !== id);
            // If we have a next page cached, and filtered length < page size, try to pull first from next
            const pageNum = (parsePageKey(k)).page as number;
            const filters = (parsePageKey(k)).filters;
            const nextKey = JSON.stringify([pageNum + 1, sz, filters]);
            const nextEntry = pageMap.get(nextKey);
            if (nextEntry && nextEntry.value && Array.isArray(nextEntry.value.data) && nextEntry.value.data.length > 0) {
              const shiftItem = nextEntry.value.data[0];
              // remove from next
              nextEntry.value.data = nextEntry.value.data.slice(1);
              // append to current page to maintain page size
              filtered.push(shiftItem);
              // write back next page
              queryClient.setQueryData(nextEntry.key as any, { ...(nextEntry.value), data: nextEntry.value.data, count: Math.max(0, (nextEntry.value.count || 1) - 1) });
            }

            // write current page
            queryClient.setQueryData(k as any, { ...(value), data: filtered, count: Math.max(0, (value.count || 1) - 1) });
          }
        } catch (e) {
          // ignore per-page patch errors
        }
      }

      // Invalidate ALL search pages since the deleted order might have been in any search result
      queryClient.invalidateQueries({
        queryKey: ['orders-search'],
        exact: false,
      });

      // Ensure paginated order tables refetch if key shapes didn't match optimistic patch
      invalidateResourceQueries(queryClient, 'orders');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['ordersByCustomerId'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['employeeOrderCounts'] });
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      invalidateRecycleBin(queryClient);
    },
  });
}

// ========== BILLS ==========

export function useCreateBill(): UseMutationResult<Bill, Error, Omit<Bill, 'id'>, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createBill,
    onMutate: async (newBill) => {
      // Cancel outgoing queries to prevent race conditions
      await queryClient.cancelQueries({ queryKey: ['bills'] });
      
      // Get the current bills list
      const previousBills = queryClient.getQueryData<Bill[]>(['bills']) || [];
      
      // Create optimistic bill with temp ID (will be replaced after server response)
      const optimisticBill: Bill = {
        ...newBill,
        id: `temp-${Date.now()}`, // Temporary ID for optimistic update
        paidAmount: newBill.paidAmount || 0,
      } as Bill;
      
      // Optimistically add to the top of the list (newest first)
      queryClient.setQueryData(['bills'], [optimisticBill, ...previousBills]);

      // Also patch paginated page 1 if cached so components using ['bills', 1] show it instantly
      const billsPage1 = queryClient.getQueryData<any>(['bills', 1]);
      if (billsPage1 && Array.isArray(billsPage1.data)) {
        const { pageSize: sz } = parsePageKey(['bills', 1]);
        queryClient.setQueryData(['bills', 1], { ...billsPage1, data: [optimisticBill, ...billsPage1.data].slice(0, sz), count: (billsPage1.count || 0) + 1 });
      }
      
      return { previousBills, optimisticBill };
    },
    onError: (err, newBill, context) => {
      // Rollback to previous data on error
      if (context?.previousBills) {
        queryClient.setQueryData(['bills'], context.previousBills);
      }
    },
    onSuccess: async (data, _variables, context) => {
      // Register temp id mapping and cache the newly created bill for immediate access in details view
      try {
        if ((context as any)?.optimisticBill?.id) {
          registerRealId((context as any).optimisticBill.id, data.id);
        }
      } catch (e) {}
      queryClient.setQueryData(['bill', data.id], data);

      // Clean optimistic temp entries from non-paginated bills list
      try {
        const prev = queryClient.getQueryData<Bill[]>(['bills']) || [];
        const cleaned = (prev || []).filter(b => !String(b.id).startsWith('temp-'));
        if (!cleaned.some(b => b.id === data.id)) queryClient.setQueryData(['bills'], [data, ...cleaned]);
        else queryClient.setQueryData(['bills'], cleaned.map(b => b.id === data.id ? data : b));
      } catch (e) {}

      // Deterministically patch cached first pages for bills (no invalidation)
      const pages = queryClient.getQueriesData({ queryKey: ['bills'] });
      pages.forEach(([key, value]) => {
        try {
          const k = key as any[];
          const { page: pageNum, pageSize: sz, filters } = parsePageKey(k);
          if (pageNum !== 1) return;
          if (value && (value as any).data && Array.isArray((value as any).data)) {
            const matches = matchesFiltersForResource('bills', data, filters);
            if (!matches) return;
            queryClient.setQueryData(key as any, { ...(value as any), data: [data, ...((value as any).data)].slice(0, sz || DEFAULT_PAGE_SIZE), count: (value as any).count ? (value as any).count + 1 : 1 });
          }
        } catch (e) {}
      });

      // Ensure paginated bill tables refetch if key shapes didn't match optimistic patch
      invalidateResourceQueries(queryClient, 'bills');
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['billsByVendorId'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useUpdateBill(): UseMutationResult<Bill, Error, { id: string; updates: Partial<Bill> }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => updateBill(id, updates),
    onMutate: async ({ id, updates }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['bills'] });
      await queryClient.cancelQueries({ queryKey: ['bill', id] });
      
      // Snapshot previous data
      const previousBills = queryClient.getQueryData<Bill[]>(['bills']);
      const previousBill = queryClient.getQueryData<Bill>(['bill', id]);
      
      // Update optimistically
      if (previousBills) {
        queryClient.setQueryData(['bills'], 
          previousBills.map(b => b.id === id ? { ...b, ...updates } : b)
        );
      }
      
      if (previousBill) {
        queryClient.setQueryData(['bill', id], { ...previousBill, ...updates });
      }
      
      return { previousBills, previousBill };
    },
    onError: (err, variables, context) => {
      if (context?.previousBills) {
        queryClient.setQueryData(['bills'], context.previousBills);
      }
      if (context?.previousBill) {
        queryClient.setQueryData(['bill', variables.id], context.previousBill);
      }
    },
    onSuccess: (data, variables) => {
      // Update any cached paginated bills pages in-place to avoid full refetch
      const pages = queryClient.getQueriesData({ queryKey: ['bills'] });
      pages.forEach(([key, value]) => {
        try {
          if (value && (value as any).data && Array.isArray((value as any).data)) {
            queryClient.setQueryData(key as any, { ...(value as any), data: (value as any).data.map((b: any) => b.id === data.id ? data : b) });
          }
        } catch (e) {
          // ignore per-page patch errors
        }
      });
      queryClient.invalidateQueries({ queryKey: ['bill', data.id] });
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['billsByVendorId'] });
      invalidateDashboardQueries(queryClient);

      // Stock can change when status/items change
      if (variables?.updates?.status !== undefined || variables?.updates?.items !== undefined) {
        queryClient.invalidateQueries({ queryKey: ['products'], exact: false });
      }
    },
  });
}

export function useDeleteBill(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteBill,
    onMutate: async (id) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['bills'] });
      
      // Snapshot previous data
      const previousBills = queryClient.getQueryData<Bill[]>(['bills']);
      
      // Optimistically remove
      if (previousBills) {
        queryClient.setQueryData(['bills'], previousBills.filter(b => b.id !== id));
      }
      
      return { previousBills };
    },
    onError: (err, id, context) => {
      if (context?.previousBills) {
        queryClient.setQueryData(['bills'], context.previousBills);
      }
    },
    onSuccess: (_data, id) => {
      // Remove deleted bill from paginated caches and try to maintain page size by pulling from next cached page
      const pages = queryClient.getQueriesData({ queryKey: ['bills'] });
      const pageMap = new Map<string, any>();
      pages.forEach(([key, value]) => {
        const k = key as any[];
        const { page: pageNum, pageSize: sz, filters } = parsePageKey(k);
        // Skip non-paginated queries
        if (typeof pageNum !== 'number' || !Number.isInteger(pageNum)) return;
        pageMap.set(JSON.stringify([pageNum, sz, filters]), { key: k, value, pageSize: sz });
      });

      const keys = Array.from(pageMap.keys()).sort((a, b) => JSON.parse(a)[0] - JSON.parse(b)[0]);
      for (const mapKey of keys) {
        const entry = pageMap.get(mapKey);
        if (!entry) continue;
        const { key: k, value, pageSize: sz } = entry;
        try {
          if (value && value.data && Array.isArray(value.data)) {
            const filtered = value.data.filter((b: any) => b.id !== id);
            const pageNum = (parsePageKey(k)).page as number;
            const filters = (parsePageKey(k)).filters;
            const nextKey = JSON.stringify([pageNum + 1, sz, filters]);
            const nextEntry = pageMap.get(nextKey);
            if (nextEntry && nextEntry.value && Array.isArray(nextEntry.value.data) && nextEntry.value.data.length > 0) {
              const shiftItem = nextEntry.value.data[0];
              nextEntry.value.data = nextEntry.value.data.slice(1);
              filtered.push(shiftItem);
              queryClient.setQueryData(nextEntry.key as any, { ...(nextEntry.value), data: nextEntry.value.data, count: Math.max(0, (nextEntry.value.count || 1) - 1) });
            }
            queryClient.setQueryData(k as any, { ...(value), data: filtered, count: Math.max(0, (value.count || 1) - 1) });
          }
        } catch (e) {}
      }

      // Ensure paginated bill tables refetch if key shapes didn't match optimistic patch
      invalidateResourceQueries(queryClient, 'bills');
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
      queryClient.invalidateQueries({ queryKey: ['billsByVendorId'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      invalidateRecycleBin(queryClient);
    },
  });
}

export function useProcessBillReturn(): UseMutationResult<Bill, Error, ProcessBillReturnPayload, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: processBillReturn,
    onSuccess: (data) => {
      queryClient.setQueryData(['bill', data.id], data);
      queryClient.invalidateQueries({ queryKey: ['bills'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['vendors'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['billsByVendorId'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['transactions'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['accounts'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['products'], exact: false });
      invalidateDashboardQueries(queryClient);
    },
  });
}

// ========== ACCOUNTS ==========

export function useCreateAccount(): UseMutationResult<Account, Error, Partial<Account>, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAccount,
    onMutate: async (newAccount) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['accounts'] });
      
      // Snapshot previous data
      const previousAccounts = queryClient.getQueryData<Account[]>(['accounts']);
      
      // Optimistically add to list
      if (previousAccounts) {
        const optimisticAccount = {
          ...newAccount,
          id: `temp-${Date.now()}`,
        } as Account;
        queryClient.setQueryData(['accounts'], [...previousAccounts, optimisticAccount]);
      }
      
      return { previousAccounts };
    },
    onError: (err, newAccount, context) => {
      if (context?.previousAccounts) {
        queryClient.setQueryData(['accounts'], context.previousAccounts);
      }
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

export function useUpdateAccount(): UseMutationResult<Account, Error, { id: string; updates: Partial<Account> }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => updateAccount(id, updates),
    onMutate: async ({ id, updates }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['accounts'] });
      await queryClient.cancelQueries({ queryKey: ['account', id] });
      
      // Snapshot previous data
      const previousAccounts = queryClient.getQueryData<Account[]>(['accounts']);
      const previousAccount = queryClient.getQueryData<Account>(['account', id]);
      
      // Update optimistically
      if (previousAccounts) {
        queryClient.setQueryData(['accounts'], 
          previousAccounts.map(a => a.id === id ? { ...a, ...updates } : a)
        );
      }
      
      if (previousAccount) {
        queryClient.setQueryData(['account', id], { ...previousAccount, ...updates });
      }
      
      return { previousAccounts, previousAccount };
    },
    onError: (err, variables, context) => {
      if (context?.previousAccounts) {
        queryClient.setQueryData(['accounts'], context.previousAccounts);
      }
      if (context?.previousAccount) {
        queryClient.setQueryData(['account', variables.id], context.previousAccount);
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      queryClient.invalidateQueries({ queryKey: ['account', data.id] });
    },
  });
}

export function useDeleteAccount(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAccount,
    onMutate: async (id) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['accounts'] });
      
      // Snapshot previous data
      const previousAccounts = queryClient.getQueryData<Account[]>(['accounts']);
      
      // Optimistically remove
      if (previousAccounts) {
        queryClient.setQueryData(['accounts'], previousAccounts.filter(a => a.id !== id));
      }
      
      return { previousAccounts };
    },
    onError: (err, id, context) => {
      if (context?.previousAccounts) {
        queryClient.setQueryData(['accounts'], context.previousAccounts);
      }
    },
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

// ========== TRANSACTIONS ==========

export function useCreateTransaction(): UseMutationResult<Transaction, Error, Partial<Transaction>, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTransaction,
    onMutate: async (newTransaction) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['transactions'] });
      await queryClient.cancelQueries({ queryKey: ['orders'] });
      
      // Snapshot previous data
      const previousTransactions = queryClient.getQueryData<Transaction[]>(['transactions']);
      const previousOrders = queryClient.getQueryData<Order[]>(['orders']);
      
      // Optimistically add transaction
      if (previousTransactions) {
        const optimisticTransaction = {
          ...newTransaction,
          id: `temp-${Date.now()}`,
        } as Transaction;
        queryClient.setQueryData(['transactions'], [...previousTransactions, optimisticTransaction]);

        // Also patch paginated page 1 for transactions so lists update immediately
        const txPage1 = queryClient.getQueryData<any>(['transactions', 1]);
        if (txPage1 && Array.isArray(txPage1.data)) {
          const { pageSize: sz } = parsePageKey(['transactions', 1]);
          queryClient.setQueryData(['transactions', 1], { ...txPage1, data: [optimisticTransaction, ...txPage1.data].slice(0, sz), count: (txPage1.count || 0) + 1 });
        }
      }
      
      return { previousTransactions, previousOrders };
    },
    onError: (err, newTransaction, context) => {
      if (context?.previousTransactions) {
        queryClient.setQueryData(['transactions'], context.previousTransactions);
      }
      if (context?.previousOrders) {
        queryClient.setQueryData(['orders'], context.previousOrders);
      }
    },
    onSuccess: (data) => {
      // Patch paginated transaction pages (add to page 1) when possible, only if the row matches page filters
      const pages = queryClient.getQueriesData({ queryKey: ['transactions'] });
      pages.forEach(([key, value]) => {
        try {
          const k = key as any[];
          const { page: pageNum, pageSize: sz, filters } = parsePageKey(k);
          if (pageNum !== 1) return;
          if (value && (value as any).data && Array.isArray((value as any).data)) {
            const matches = matchesFiltersForResource('transactions', data, filters);
            if (!matches) return;
            const newData = [data, ...((value as any).data)].slice(0, sz);
            queryClient.setQueryData(key as any, { ...(value as any), data: newData, count: (value as any).count ? (value as any).count + 1 : 1 });
          }
        } catch (e) {
          // ignore per-page patch errors
        }
      });
      // Ensure paginated transaction tables refetch if key shapes didn't match optimistic patch
      invalidateResourceQueries(queryClient, 'transactions');
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      invalidateRecycleBin(queryClient);
    },
  });
}

export function useUpdateTransaction(): UseMutationResult<Transaction, Error, { id: string; updates: Partial<Transaction> }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => updateTransaction(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: ['transactions'] });
      await queryClient.cancelQueries({ queryKey: ['transaction', id] });

      const previousTransactions = queryClient.getQueryData<Transaction[]>(['transactions']);
      const previousTransaction = queryClient.getQueryData<Transaction>(['transaction', id]);

      if (previousTransactions) {
        queryClient.setQueryData(
          ['transactions'],
          previousTransactions.map((transaction) => (
            transaction.id === id ? { ...transaction, ...updates } : transaction
          ))
        );
      }

      if (previousTransaction) {
        queryClient.setQueryData(['transaction', id], { ...previousTransaction, ...updates });
      }

      return { previousTransactions, previousTransaction };
    },
    onError: (_err, variables, context) => {
      if (context?.previousTransactions) {
        queryClient.setQueryData(['transactions'], context.previousTransactions);
      }
      if (context?.previousTransaction) {
        queryClient.setQueryData(['transaction', variables.id], context.previousTransaction);
      }
    },
    onSuccess: (data) => {
      try {
        const previous = queryClient.getQueryData<Transaction[]>(['transactions']) || [];
        queryClient.setQueryData(
          ['transactions'],
          previous.map((transaction) => (transaction.id === data.id ? data : transaction))
        );
      } catch (e) {}

      const pages = queryClient.getQueriesData({ queryKey: ['transactions'] });
      pages.forEach(([key, value]) => {
        try {
          if (value && (value as any).data && Array.isArray((value as any).data)) {
            queryClient.setQueryData(key as any, {
              ...(value as any),
              data: (value as any).data.map((transaction: any) => (
                transaction.id === data.id ? data : transaction
              )),
            });
          }
        } catch (e) {}
      });

      queryClient.setQueryData(['transaction', data.id], data);
      invalidateResourceQueries(queryClient, 'transactions');
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

export function useDeleteTransaction(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTransaction,
    onMutate: async (id) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['transactions'] });
      
      // Snapshot previous data
      const previousTransactions = queryClient.getQueryData<Transaction[]>(['transactions']);
      
      // Optimistically remove
      if (previousTransactions) {
        queryClient.setQueryData(['transactions'], previousTransactions.filter(t => t.id !== id));
      }
      
      return { previousTransactions };
    },
    onError: (err, id, context) => {
      if (context?.previousTransactions) {
        queryClient.setQueryData(['transactions'], context.previousTransactions);
      }
    },
    onSuccess: (_data, id) => {
      // Remove deleted transaction from paginated caches and maintain page sizes
      const pages = queryClient.getQueriesData({ queryKey: ['transactions'] });
      const pageMap = new Map<string, any>();
      pages.forEach(([key, value]) => {
        const k = key as any[];
        const { page: pageNum, pageSize: sz, filters } = parsePageKey(k);
        if (typeof pageNum !== 'number' || !Number.isInteger(pageNum)) return;
        pageMap.set(JSON.stringify([pageNum, sz, filters]), { key: k, value, pageSize: sz });
      });
      const keys = Array.from(pageMap.keys()).sort((a, b) => JSON.parse(a)[0] - JSON.parse(b)[0]);
      for (const mapKey of keys) {
        const entry = pageMap.get(mapKey);
        if (!entry) continue;
        const { key: k, value, pageSize: sz } = entry;
        try {
          if (value && value.data && Array.isArray(value.data)) {
            const filtered = value.data.filter((t: any) => t.id !== id);
            const { page: pageNum, filters } = parsePageKey(k);
            const nextKey = JSON.stringify([pageNum + 1, sz, filters]);
            const nextEntry = pageMap.get(nextKey);
            if (nextEntry && nextEntry.value && Array.isArray(nextEntry.value.data) && nextEntry.value.data.length > 0) {
              const shiftItem = nextEntry.value.data[0];
              nextEntry.value.data = nextEntry.value.data.slice(1);
              filtered.push(shiftItem);
              queryClient.setQueryData(nextEntry.key as any, { ...(nextEntry.value), data: nextEntry.value.data, count: Math.max(0, (nextEntry.value.count || 1) - 1) });
            }
            queryClient.setQueryData(k as any, { ...(value), data: filtered, count: Math.max(0, (value.count || 1) - 1) });
          }
        } catch (e) {}
      }

      // Ensure paginated transaction tables refetch if key shapes didn't match optimistic patch
      invalidateResourceQueries(queryClient, 'transactions');
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      invalidateRecycleBin(queryClient);
    },
  });
}

// ========== USERS ==========

export function useCreateUser(): UseMutationResult<User, Error, Partial<User>, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createUser,
    onMutate: async (newUser) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['users'] });
      
      // Snapshot previous data
      const previousUsers = queryClient.getQueryData<User[]>(['users']);
      
      // Optimistically add to list
      if (previousUsers) {
        const optimisticUser = {
          ...newUser,
          id: `temp-${Date.now()}`,
        } as User;
        queryClient.setQueryData(['users'], [...previousUsers, optimisticUser]);
      }
      
      return { previousUsers };
    },
    onError: (err, newUser, context) => {
      if (context?.previousUsers) {
        queryClient.setQueryData(['users'], context.previousUsers);
      }
    },
    onSuccess: (data) => {
      // If backend returned user row, cache detail and patch first pages deterministically
      try {
        if (data?.id) queryClient.setQueryData(['user', data.id], data);
      } catch (e) {}
      // Clean optimistic temp entries from non-paginated users list
      try {
        const prev = queryClient.getQueryData<User[]>(['users']) || [];
        const cleaned = (prev || []).filter(u => !String(u.id).startsWith('temp-'));
        if (!cleaned.some(u => u.id === data.id)) queryClient.setQueryData(['users'], [data, ...cleaned]);
        else queryClient.setQueryData(['users'], cleaned.map(u => u.id === data.id ? data : u));
      } catch (e) {}

      const pages = queryClient.getQueriesData({ queryKey: ['users'] });
      pages.forEach(([key, value]) => {
        try {
          const k = key as any[];
          const { page: pageNum, pageSize: sz, filters } = parsePageKey(k);
          if (pageNum !== 1) return;
          if (value && (value as any).data && Array.isArray((value as any).data)) {
            queryClient.setQueryData(key as any, { ...(value as any), data: [data, ...((value as any).data)].slice(0, sz || DEFAULT_PAGE_SIZE), count: (value as any).count ? (value as any).count + 1 : 1 });
          }
        } catch (e) {}
      });

      // Ensure paginated user tables refetch if key shapes didn't match optimistic patch
      invalidateResourceQueries(queryClient, 'users');
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      invalidateRecycleBin(queryClient);
    },
  });
}

export function useUpdateUser(): UseMutationResult<User, Error, { id: string; updates: Partial<User> }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => updateUser(id, updates),
    onMutate: async ({ id, updates }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['users'] });
      await queryClient.cancelQueries({ queryKey: ['user', id] });
      await queryClient.cancelQueries({ queryKey: ['userByPhone'] });
      
      // Snapshot previous data
      const previousUsers = queryClient.getQueryData<User[]>(['users']);
      const previousUser = queryClient.getQueryData<User>(['user', id]);
      
      // Update optimistically
      if (previousUsers) {
        queryClient.setQueryData(['users'], 
          previousUsers.map(u => u.id === id ? { ...u, ...updates } : u)
        );
      }
      
      if (previousUser) {
        queryClient.setQueryData(['user', id], { ...previousUser, ...updates });
      }
      
      return { previousUsers, previousUser };
    },
    onError: (err, variables, context) => {
      if (context?.previousUsers) {
        queryClient.setQueryData(['users'], context.previousUsers);
      }
      if (context?.previousUser) {
        queryClient.setQueryData(['user', variables.id], context.previousUser);
      }
    },
    onSuccess: (data) => {
      // Patch paginated user pages in-place and update detail cache
      const pages = queryClient.getQueriesData({ queryKey: ['users'] });
      pages.forEach(([key, value]) => {
        try {
          if (value && (value as any).data && Array.isArray((value as any).data)) {
            queryClient.setQueryData(key as any, { ...(value as any), data: (value as any).data.map((u: any) => u.id === data.id ? data : u) });
          }
        } catch (e) {}
      });
      queryClient.setQueryData(['user', data.id], data);
    },
  });
}

export function useDeleteUser(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteUser,
    onMutate: async (id) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['users'] });
      
      // Snapshot previous data
      const previousUsers = queryClient.getQueryData<User[]>(['users']);
      
      // Optimistically remove
      if (previousUsers) {
        queryClient.setQueryData(['users'], previousUsers.filter(u => u.id !== id));
      }
      
      return { previousUsers };
    },
    onError: (err, id, context) => {
      if (context?.previousUsers) {
        queryClient.setQueryData(['users'], context.previousUsers);
      }
    },
    onSuccess: (_data, id) => {
      // Remove user from paginated caches similar to other deletes
      const pages = queryClient.getQueriesData({ queryKey: ['users'] });
      const pageMap = new Map<string, any>();
      pages.forEach(([key, value]) => {
        const k = key as any[];
        const { page: pageNum, pageSize: sz, filters } = parsePageKey(k);
        // Skip non-paginated queries
        if (typeof pageNum !== 'number' || !Number.isInteger(pageNum)) return;
        pageMap.set(JSON.stringify([pageNum, sz, filters]), { key: k, value, pageSize: sz });
      });
      const keys = Array.from(pageMap.keys()).sort((a, b) => JSON.parse(a)[0] - JSON.parse(b)[0]);
      for (const mapKey of keys) {
        const entry = pageMap.get(mapKey);
        if (!entry) continue;
        const { key: k, value } = entry;
        try {
          if (value && value.data && Array.isArray(value.data)) {
            const filtered = value.data.filter((u: any) => u.id !== id);
            queryClient.setQueryData(k as any, { ...(value), data: filtered, count: Math.max(0, (value.count || 1) - 1) });
          }
        } catch (e) {}
      }

      // Ensure paginated user tables refetch if key shapes didn't match optimistic patch
      invalidateResourceQueries(queryClient, 'users');
    },
  });
}

// ========== VENDORS ==========

export function useCreateVendor(): UseMutationResult<Vendor, Error, Partial<Vendor>, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createVendor,
    onMutate: async (newVendor) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['vendors'] });
      
      // Snapshot previous data
      const previousVendors = queryClient.getQueryData<Vendor[]>(['vendors']);
      
      // Optimistically add to list
      if (previousVendors) {
        const optimisticVendor = {
          ...newVendor,
          id: `temp-${Date.now()}`,
        } as Vendor;
        queryClient.setQueryData(['vendors'], [...previousVendors, optimisticVendor]);

        // Also patch paginated page 1 cache if present so vendor lists update immediately
        const vendorsPage1 = queryClient.getQueryData<any>(['vendors', 1]);
        if (vendorsPage1 && Array.isArray(vendorsPage1.data)) {
          const { pageSize: sz } = parsePageKey(['vendors', 1]);
          queryClient.setQueryData(['vendors', 1], { ...vendorsPage1, data: [optimisticVendor, ...vendorsPage1.data].slice(0, sz), count: (vendorsPage1.count || 0) + 1 });
        }
      }
      
      return { previousVendors };
    },
    onError: (err, newVendor, context) => {
      if (context?.previousVendors) {
        queryClient.setQueryData(['vendors'], context.previousVendors);
      }
    },
    onSuccess: (data) => {
      // Ensure root vendors cache is updated: replace any optimistic entries and dedupe
      try {
        const previous = queryClient.getQueryData<Vendor[]>(['vendors']);
        if (previous) {
          const cleaned = (previous || []).filter(v => !(v.id && String(v.id).startsWith('temp-')));
          if (!cleaned.some(v => v.id === data.id)) {
            queryClient.setQueryData(['vendors'], [data, ...cleaned]);
          } else {
            queryClient.setQueryData(['vendors'], cleaned.map(v => v.id === data.id ? data : v));
          }
        }
      } catch (e) {
        // ignore
      }

      // Deterministically patch paginated vendor first pages (no invalidation)
      const pages = queryClient.getQueriesData({ queryKey: ['vendors'] });
      pages.forEach(([key, value]) => {
        try {
          const k = key as any[];
          const { page: pageNum, pageSize: sz } = parsePageKey(k);
          if (pageNum !== 1) return;
          if (value && (value as any).data && Array.isArray((value as any).data)) {
            queryClient.setQueryData(key as any, { ...(value as any), data: [data, ...((value as any).data)].slice(0, sz), count: (value as any).count ? (value as any).count + 1 : 1 });
          }
        } catch (e) {}
      });

      // Ensure paginated vendor tables refetch if key shapes didn't match optimistic patch
      invalidateResourceQueries(queryClient, 'vendors');
      invalidateRecycleBin(queryClient);
    },
  });
}

export function useUpdateVendor(): UseMutationResult<Vendor, Error, { id: string; updates: Partial<Vendor> }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => updateVendor(id, updates),
    onMutate: async ({ id, updates }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['vendors'] });
      await queryClient.cancelQueries({ queryKey: ['vendor', id] });
      
      // Snapshot previous data
      const previousVendors = queryClient.getQueryData<Vendor[]>(['vendors']);
      const previousVendor = queryClient.getQueryData<Vendor>(['vendor', id]);
      
      // Update optimistically
      if (previousVendors) {
        queryClient.setQueryData(['vendors'], 
          previousVendors.map(v => v.id === id ? { ...v, ...updates } : v)
        );
      }
      
      if (previousVendor) {
        queryClient.setQueryData(['vendor', id], { ...previousVendor, ...updates });
      }
      
      return { previousVendors, previousVendor };
    },
    onError: (err, variables, context) => {
      if (context?.previousVendors) {
        queryClient.setQueryData(['vendors'], context.previousVendors);
      }
      if (context?.previousVendor) {
        queryClient.setQueryData(['vendor', variables.id], context.previousVendor);
      }
    },
    onSuccess: (data) => {
      // Patch any paginated vendor pages in-place
      const pages = queryClient.getQueriesData({ queryKey: ['vendors'] });
      pages.forEach(([key, value]) => {
        try {
          if (value && (value as any).data && Array.isArray((value as any).data)) {
            queryClient.setQueryData(key as any, { ...(value as any), data: (value as any).data.map((v: any) => v.id === data.id ? data : v) });
          }
        } catch (e) {}
      });
      queryClient.setQueryData(['vendor', data.id], data);
    },
  });
}

export function useDeleteVendor(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteVendor,
    onMutate: async (id) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['vendors'] });
      
      // Snapshot previous data
      const previousVendors = queryClient.getQueryData<Vendor[]>(['vendors']);
      
      // Optimistically remove
      if (previousVendors) {
        queryClient.setQueryData(['vendors'], previousVendors.filter(v => v.id !== id));
      }
      
      return { previousVendors };
    },
    onError: (err, id, context) => {
      if (context?.previousVendors) {
        queryClient.setQueryData(['vendors'], context.previousVendors);
      }
    },
    onSuccess: (_data, id) => {
      // Remove deleted vendor from paginated caches and maintain page sizes
      const pages = queryClient.getQueriesData({ queryKey: ['vendors'] });
      const pageMap = new Map<string, any>();
      pages.forEach(([key, value]) => {
        const k = key as any[];
        const { page: pageNum, pageSize: sz, filters } = parsePageKey(k);
        if (typeof pageNum !== 'number' || !Number.isInteger(pageNum)) return;
        pageMap.set(JSON.stringify([pageNum, sz, filters]), { key: k, value, pageSize: sz });
      });
      const keys = Array.from(pageMap.keys()).sort((a, b) => JSON.parse(a)[0] - JSON.parse(b)[0]);
      for (const mapKey of keys) {
        const entry = pageMap.get(mapKey);
        if (!entry) continue;
        const { key: k, value, pageSize: sz } = entry;
        try {
          if (value && value.data && Array.isArray(value.data)) {
            const filtered = value.data.filter((v: any) => v.id !== id);
            const { page: pageNum, filters } = parsePageKey(k);
            const nextKey = JSON.stringify([pageNum + 1, sz, filters]);
            const nextEntry = pageMap.get(nextKey);
            if (nextEntry && nextEntry.value && Array.isArray(nextEntry.value.data) && nextEntry.value.data.length > 0) {
              const shiftItem = nextEntry.value.data[0];
              nextEntry.value.data = nextEntry.value.data.slice(1);
              filtered.push(shiftItem);
              queryClient.setQueryData(nextEntry.key as any, { ...(nextEntry.value), data: nextEntry.value.data, count: Math.max(0, (nextEntry.value.count || 1) - 1) });
            }
            queryClient.setQueryData(k as any, { ...(value), data: filtered, count: Math.max(0, (value.count || 1) - 1) });
          }
        } catch (e) {}
      }

      // Ensure paginated vendor tables refetch if key shapes didn't match optimistic patch
      invalidateResourceQueries(queryClient, 'vendors');
    },
  });
}

// ========== PRODUCTS ==========

export function useCreateProduct(): UseMutationResult<Product, Error, Partial<Product>, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createProduct,
    onMutate: async (newProduct) => {
      // Cancel outgoing queries to prevent race conditions
      await queryClient.cancelQueries({ queryKey: ['products'] });
      
      // Get the current products list
      const previousProducts = queryClient.getQueryData<Product[]>(['products']) || [];
      
      // Create optimistic product with temp ID (will be replaced after server response)
      const optimisticProduct: Product = {
        ...newProduct,
        id: `temp-${Date.now()}`,
      } as Product;
      
      // Optimistically add to the top of the list (newest first)
      queryClient.setQueryData(['products'], [optimisticProduct, ...previousProducts]);
      
      return { previousProducts, optimisticProduct };
    },
    onError: (err, newProduct, context) => {
      // Rollback to previous data on error
      if (context?.previousProducts) {
        queryClient.setQueryData(['products'], context.previousProducts);
      }
    },
    onSuccess: async (data) => {
      // Cache the newly created product and patch paginated product pages
      queryClient.setQueryData(['product', data.id], data);

      // Patch any paginated product pages to include the new product at the top
      const pages = queryClient.getQueriesData({ queryKey: ['products'] });
      pages.forEach(([key, value]) => {
        try {
          if (value && (value as any).data && Array.isArray((value as any).data)) {
            const { pageSize: sz } = parsePageKey(key as any);
            const newData = [data, ...((value as any).data)].slice(0, sz);
            queryClient.setQueryData(key as any, { ...(value as any), data: newData, count: (value as any).count ? (value as any).count + 1 : 1 });
          }
        } catch (e) {
          // ignore per-page patch errors
        }
      });

      // Also update the non-paginated products list if present (cleanup temp entries)
      const prev = queryClient.getQueryData<Product[]>(['products']) || [];
      const cleaned = (prev || []).filter(p => !String(p.id).startsWith('temp-'));
      queryClient.setQueryData(['products'], [data, ...cleaned]);

      // Ensure paginated product tables refetch if key shapes didn't match optimistic patch
      invalidateResourceQueries(queryClient, 'products');
      invalidateRecycleBin(queryClient);
    },
  });
}

export function useUpdateProduct(): UseMutationResult<Product, Error, { id: string; updates: Partial<Product> }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => updateProduct(id, updates),
    onMutate: async ({ id, updates }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['products'] });
      await queryClient.cancelQueries({ queryKey: ['product', id] });
      
      // Snapshot previous data
      const previousProducts = queryClient.getQueryData<Product[]>(['products']);
      const previousProduct = queryClient.getQueryData<Product>(['product', id]);
      
      // Update optimistically
      if (previousProducts) {
        queryClient.setQueryData(['products'], 
          previousProducts.map(p => p.id === id ? { ...p, ...updates } : p)
        );
      }
      
      if (previousProduct) {
        queryClient.setQueryData(['product', id], { ...previousProduct, ...updates });
      }
      
      return { previousProducts, previousProduct };
    },
    onError: (err, variables, context) => {
      if (context?.previousProducts) {
        queryClient.setQueryData(['products'], context.previousProducts);
      }
      if (context?.previousProduct) {
        queryClient.setQueryData(['product', variables.id], context.previousProduct);
      }
    },
    onSuccess: (data) => {
      // Patch any paginated product pages in-place
      const pages = queryClient.getQueriesData({ queryKey: ['products'] });
      pages.forEach(([key, value]) => {
        try {
          if (value && (value as any).data && Array.isArray((value as any).data)) {
            queryClient.setQueryData(key as any, { ...(value as any), data: (value as any).data.map((p: any) => p.id === data.id ? data : p) });
          }
        } catch (e) {}
      });
      queryClient.setQueryData(['product', data.id], data);
      // Invalidate lightweight product caches so OrderForm picks up changes (e.g. dynamic pricing)
      queryClient.invalidateQueries({ queryKey: ['productsMini'] });
      queryClient.invalidateQueries({ queryKey: ['productsSearch'] });
    },
  });
}

export function useDeleteProduct(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProduct,
    onMutate: async (id) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['products'] });
      
      // Snapshot previous data
      const previousProducts = queryClient.getQueryData<Product[]>(['products']);
      
      // Optimistically remove
      if (previousProducts) {
        queryClient.setQueryData(['products'], previousProducts.filter(p => p.id !== id));
      }
      
      return { previousProducts };
    },
    onError: (err, id, context) => {
      if (context?.previousProducts) {
        queryClient.setQueryData(['products'], context.previousProducts);
      }
    },
    onSuccess: (_data, id) => {
      // Remove deleted product from paginated caches and maintain page sizes
      const pages = queryClient.getQueriesData({ queryKey: ['products'] });
      const pageMap = new Map<string, any>();
      pages.forEach(([key, value]) => {
        const k = key as any[];
        const { page: pageNum, pageSize: sz, filters } = parsePageKey(k);
        if (typeof pageNum !== 'number' || !Number.isInteger(pageNum)) return;
        pageMap.set(JSON.stringify([pageNum, sz, filters]), { key: k, value, pageSize: sz });
      });
      const keys = Array.from(pageMap.keys()).sort((a, b) => JSON.parse(a)[0] - JSON.parse(b)[0]);
      for (const mapKey of keys) {
        const entry = pageMap.get(mapKey);
        if (!entry) continue;
        const { key: k, value, pageSize: sz } = entry;
        try {
          if (value && value.data && Array.isArray(value.data)) {
            const filtered = value.data.filter((p: any) => p.id !== id);
            const { page: pageNum, filters } = parsePageKey(k);
            const nextKey = JSON.stringify([pageNum + 1, sz, filters]);
            const nextEntry = pageMap.get(nextKey);
            if (nextEntry && nextEntry.value && Array.isArray(nextEntry.value.data) && nextEntry.value.data.length > 0) {
              const shiftItem = nextEntry.value.data[0];
              nextEntry.value.data = nextEntry.value.data.slice(1);
              filtered.push(shiftItem);
              queryClient.setQueryData(nextEntry.key as any, { ...(nextEntry.value), data: nextEntry.value.data, count: Math.max(0, (nextEntry.value.count || 1) - 1) });
            }
            queryClient.setQueryData(k as any, { ...(value), data: filtered, count: Math.max(0, (value.count || 1) - 1) });
          }
        } catch (e) {}
      }

      // Ensure paginated product tables refetch if key shapes didn't match optimistic patch
      invalidateResourceQueries(queryClient, 'products');
    },
  });
}

// ========== RECYCLE BIN ==========

export function useRestoreDeletedItem(): UseMutationResult<void, Error, { entityType: RecycleBinEntityType; id: string }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: restoreDeletedItem,
    onSuccess: (_data, variables) => {
      invalidateEntityAfterRecycleBinAction(queryClient, variables.entityType);
    },
  });
}

export function usePermanentlyDeleteDeletedItem(): UseMutationResult<void, Error, { entityType: RecycleBinEntityType; id: string }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: permanentlyDeleteDeletedItem,
    onSuccess: (_data, variables) => {
      invalidateEntityAfterRecycleBinAction(queryClient, variables.entityType);
    },
  });
}

// ========== CATEGORIES ==========

export function useCreateCategory(): UseMutationResult<any, Error, any, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createCategory,
    onMutate: async (newCategory) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['categories'] });
      
      // Snapshot previous data
      const previousCategories = queryClient.getQueryData<any[]>(['categories']);
      
      // Optimistically add to list
      if (previousCategories) {
        const optimisticCategory = {
          ...newCategory,
          id: `temp-${Date.now()}`,
        };
        queryClient.setQueryData(['categories'], [...previousCategories, optimisticCategory]);
      }
      
      return { previousCategories };
    },
    onError: (err, newCategory, context) => {
      if (context?.previousCategories) {
        queryClient.setQueryData(['categories'], context.previousCategories);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

export function useUpdateCategory(): UseMutationResult<any, Error, { id: string; updates: any }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => updateCategory(id, updates),
    onMutate: async ({ id, updates }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['categories'] });
      await queryClient.cancelQueries({ queryKey: ['category', id] });
      
      // Snapshot previous data
      const previousCategories = queryClient.getQueryData<any[]>(['categories']);
      const previousCategory = queryClient.getQueryData<any>(['category', id]);
      
      // Update optimistically
      if (previousCategories) {
        queryClient.setQueryData(['categories'], 
          previousCategories.map(c => c.id === id ? { ...c, ...updates } : c)
        );
      }
      
      if (previousCategory) {
        queryClient.setQueryData(['category', id], { ...previousCategory, ...updates });
      }
      
      return { previousCategories, previousCategory };
    },
    onError: (err, variables, context) => {
      if (context?.previousCategories) {
        queryClient.setQueryData(['categories'], context.previousCategories);
      }
      if (context?.previousCategory) {
        queryClient.setQueryData(['category', variables.id], context.previousCategory);
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['category', data.id] });
    },
  });
}

export function useDeleteCategory(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteCategory,
    onMutate: async (id) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['categories'] });
      
      // Snapshot previous data
      const previousCategories = queryClient.getQueryData<any[]>(['categories']);
      
      // Optimistically remove
      if (previousCategories) {
        queryClient.setQueryData(['categories'], previousCategories.filter(c => c.id !== id));
      }
      
      return { previousCategories };
    },
    onError: (err, id, context) => {
      if (context?.previousCategories) {
        queryClient.setQueryData(['categories'], context.previousCategories);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

// ========== PAYMENT METHODS ==========

export function useCreatePaymentMethod(): UseMutationResult<any, Error, any, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createPaymentMethod,
    onMutate: async (newMethod) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['paymentMethods'] });
      
      // Snapshot previous data
      const previousMethods = queryClient.getQueryData<any[]>(['paymentMethods']);
      
      // Optimistically add to list
      if (previousMethods) {
        const optimisticMethod = {
          ...newMethod,
          id: `temp-${Date.now()}`,
        };
        queryClient.setQueryData(['paymentMethods'], [...previousMethods, optimisticMethod]);
      }
      
      return { previousMethods };
    },
    onError: (err, newMethod, context) => {
      if (context?.previousMethods) {
        queryClient.setQueryData(['paymentMethods'], context.previousMethods);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentMethods'] });
    },
  });
}

export function useUpdatePaymentMethod(): UseMutationResult<any, Error, { id: string; updates: any }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => updatePaymentMethod(id, updates),
    onMutate: async ({ id, updates }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['paymentMethods'] });
      await queryClient.cancelQueries({ queryKey: ['paymentMethod', id] });
      
      // Snapshot previous data
      const previousMethods = queryClient.getQueryData<any[]>(['paymentMethods']);
      const previousMethod = queryClient.getQueryData<any>(['paymentMethod', id]);
      
      // Update optimistically
      if (previousMethods) {
        queryClient.setQueryData(['paymentMethods'], 
          previousMethods.map(m => m.id === id ? { ...m, ...updates } : m)
        );
      }
      
      if (previousMethod) {
        queryClient.setQueryData(['paymentMethod', id], { ...previousMethod, ...updates });
      }
      
      return { previousMethods, previousMethod };
    },
    onError: (err, variables, context) => {
      if (context?.previousMethods) {
        queryClient.setQueryData(['paymentMethods'], context.previousMethods);
      }
      if (context?.previousMethod) {
        queryClient.setQueryData(['paymentMethod', variables.id], context.previousMethod);
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['paymentMethods'] });
      queryClient.invalidateQueries({ queryKey: ['paymentMethod', data.id] });
    },
  });
}

export function useDeletePaymentMethod(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deletePaymentMethod,
    onMutate: async (id) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['paymentMethods'] });
      
      // Snapshot previous data
      const previousMethods = queryClient.getQueryData<any[]>(['paymentMethods']);
      
      // Optimistically remove
      if (previousMethods) {
        queryClient.setQueryData(['paymentMethods'], previousMethods.filter(m => m.id !== id));
      }
      
      return { previousMethods };
    },
    onError: (err, id, context) => {
      if (context?.previousMethods) {
        queryClient.setQueryData(['paymentMethods'], context.previousMethods);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paymentMethods'] });
    },
  });
}

// ========== UNITS ==========

export function useCreateUnit(): UseMutationResult<any, Error, any, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createUnit,
    onMutate: async (newUnit) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['units'] });
      
      // Snapshot previous data
      const previousUnits = queryClient.getQueryData<any[]>(['units']);
      
      // Optimistically add to list
      if (previousUnits) {
        const optimisticUnit = {
          ...newUnit,
          id: `temp-${Date.now()}`,
        };
        queryClient.setQueryData(['units'], [...previousUnits, optimisticUnit]);
      }
      
      return { previousUnits };
    },
    onError: (err, newUnit, context) => {
      if (context?.previousUnits) {
        queryClient.setQueryData(['units'], context.previousUnits);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['units'] });
    },
  });
}

export function useUpdateUnit(): UseMutationResult<any, Error, { id: string; updates: any }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, updates }) => updateUnit(id, updates),
    onMutate: async ({ id, updates }) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['units'] });
      await queryClient.cancelQueries({ queryKey: ['unit', id] });
      
      // Snapshot previous data
      const previousUnits = queryClient.getQueryData<any[]>(['units']);
      const previousUnit = queryClient.getQueryData<any>(['unit', id]);
      
      // Update optimistically
      if (previousUnits) {
        queryClient.setQueryData(['units'], 
          previousUnits.map(u => u.id === id ? { ...u, ...updates } : u)
        );
      }
      
      if (previousUnit) {
        queryClient.setQueryData(['unit', id], { ...previousUnit, ...updates });
      }
      
      return { previousUnits, previousUnit };
    },
    onError: (err, variables, context) => {
      if (context?.previousUnits) {
        queryClient.setQueryData(['units'], context.previousUnits);
      }
      if (context?.previousUnit) {
        queryClient.setQueryData(['unit', variables.id], context.previousUnit);
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['units'] });
      queryClient.invalidateQueries({ queryKey: ['unit', data.id] });
    },
  });
}

export function useDeleteUnit(): UseMutationResult<void, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteUnit,
    onMutate: async (id) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['units'] });
      
      // Snapshot previous data
      const previousUnits = queryClient.getQueryData<any[]>(['units']);
      
      // Optimistically remove
      if (previousUnits) {
        queryClient.setQueryData(['units'], previousUnits.filter(u => u.id !== id));
      }
      
      return { previousUnits };
    },
    onError: (err, id, context) => {
      if (context?.previousUnits) {
        queryClient.setQueryData(['units'], context.previousUnits);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['units'] });
    },
  });
}

// ========== SETTINGS ==========

export function useUpdateCompanySettings(): UseMutationResult<CompanySettings, Error, Partial<CompanySettings>, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateCompanySettings,
    onMutate: async (newSettings) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['settings', 'company'] });
      
      // Snapshot previous data
      const previousSettings = queryClient.getQueryData<any>(['settings', 'company']);
      
      // Optimistically update
      queryClient.setQueryData(['settings', 'company'], { ...previousSettings, ...newSettings });
      
      return { previousSettings };
    },
    onError: (err, newSettings, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings', 'company'], context.previousSettings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'company'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'global-branding'] });
    },
  });
}

export function useUpdateOrderSettings(): UseMutationResult<any, Error, any, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateOrderSettings,
    onMutate: async (newSettings) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['settings', 'order'] });
      
      // Snapshot previous data
      const previousSettings = queryClient.getQueryData<any>(['settings', 'order']);
      
      // Optimistically update
      queryClient.setQueryData(['settings', 'order'], { ...previousSettings, ...newSettings });
      
      return { previousSettings };
    },
    onError: (err, newSettings, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings', 'order'], context.previousSettings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'order'] });
    },
  });
}

export function useUpdateInvoiceSettings(): UseMutationResult<any, Error, any, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateInvoiceSettings,
    onMutate: async (newSettings) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['settings', 'invoice'] });
      
      // Snapshot previous data
      const previousSettings = queryClient.getQueryData<any>(['settings', 'invoice']);
      
      // Optimistically update
      queryClient.setQueryData(['settings', 'invoice'], { ...previousSettings, ...newSettings });
      
      return { previousSettings };
    },
    onError: (err, newSettings, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings', 'invoice'], context.previousSettings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'invoice'] });
    },
  });
}

export function useUpdateSystemDefaults(): UseMutationResult<any, Error, any, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateSystemDefaults,
    onMutate: async (newSettings) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['settings', 'defaults'] });
      
      // Snapshot previous data
      const previousSettings = queryClient.getQueryData<any>(['settings', 'defaults']);
      
      // Optimistically update
      queryClient.setQueryData(['settings', 'defaults'], { ...previousSettings, ...newSettings });
      
      return { previousSettings };
    },
    onError: (err, newSettings, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings', 'defaults'], context.previousSettings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'defaults'] });
    },
  });
}

export function useUpdateCapabilitySettings(): UseMutationResult<CapabilitySettings, Error, Partial<CapabilitySettings>, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateCapabilitySettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'capabilities'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'defaults'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance-status'] });
    },
  });
}

export function useSetMaintenanceStatus(): UseMutationResult<MaintenanceStatus, Error, MaintenanceUpdatePayload, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setMaintenanceStatus,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance-status'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'capabilities'] });
    },
  });
}

export function useSyncLicenseCapabilities(): UseMutationResult<CapabilitySettings, Error, { licenseKey?: string; licenseApiUrl?: string } | undefined, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: syncLicenseCapabilities,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'capabilities'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'defaults'] });
      queryClient.invalidateQueries({ queryKey: ['service-subscription'], exact: false });
    },
  });
}

export function useCreateOrUpdateCentralLicense(): UseMutationResult<
  CapabilitySettings,
  Error,
  { licenseApiUrl?: string; licenseOwnerToken?: string; licenseKey?: string; tierKey: string; clientName?: string; domain?: string; status?: string; renewalDate?: string | null; pricingMetadata?: { monthly?: number; yearly?: number; [key: string]: number | undefined } },
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createOrUpdateCentralLicense,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'capabilities'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'defaults'] });
      queryClient.invalidateQueries({ queryKey: ['service-subscription'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['central-license-tiers'], exact: false });
    },
  });
}

export function useUpdateCentralLicenseOverride(): UseMutationResult<
  CapabilitySettings,
  Error,
  { licenseApiUrl?: string; licenseOwnerToken?: string; licenseKey?: string; capabilities: AppCapabilityMap; pricingMetadata?: { monthly?: number; yearly?: number; [key: string]: number | undefined } },
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateCentralLicenseOverride,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'capabilities'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'defaults'] });
      queryClient.invalidateQueries({ queryKey: ['service-subscription'], exact: false });
    },
  });
}

export function useResetCentralLicenseOverride(): UseMutationResult<
  CapabilitySettings,
  Error,
  { licenseApiUrl?: string; licenseOwnerToken?: string; licenseKey?: string } | undefined,
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: resetCentralLicenseOverride,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'capabilities'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'defaults'] });
      queryClient.invalidateQueries({ queryKey: ['service-subscription'], exact: false });
    },
  });
}


export function useRegisterWebhookWithCentral(): UseMutationResult<
  { success: boolean; message: string; webhookUrl?: string },
  Error,
  { webhookUrl?: string } | undefined,
  unknown
> {
  return useMutation({
    mutationFn: registerWebhookWithCentral,
  });
}

export function useUnregisterWebhookFromCentral(): UseMutationResult<
  { success: boolean; message: string },
  Error,
  void,
  unknown
> {
  return useMutation({
    mutationFn: () => unregisterWebhookFromCentral(),
  });
}

export function useUpdatePaymentGatewaySettings(): UseMutationResult<PaymentGatewaySettings, Error, PaymentGatewaySettings, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePaymentGatewaySettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'payment-gateway'] });
    },
  });
}

export function useInitiatePipraPayCheckout(): UseMutationResult<
  { checkoutUrl: string; localReference: string; gatewayPaymentId?: string | null },
  Error,
  { interval: 'monthly' | 'yearly'; amount: number },
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: initiatePipraPayCheckout,
  });
}

export function useUpdateCourierSettings(): UseMutationResult<any, Error, any, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateCourierSettings,
    onMutate: async (newSettings) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['settings', 'courier'] });
      
      // Snapshot previous data
      const previousSettings = queryClient.getQueryData<any>(['settings', 'courier']);
      
      // Optimistically update
      queryClient.setQueryData(['settings', 'courier'], { ...previousSettings, ...newSettings });
      
      return { previousSettings };
    },
    onError: (err, newSettings, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings', 'courier'], context.previousSettings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'courier'] });
    },
  });
}

export function useUpdateMetaAdsSettings(): UseMutationResult<MetaAdsSettings, Error, MetaAdsSettings, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateMetaAdsSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta-ads'], exact: false });
    },
  });
}

export function useBeginMetaAdsOAuth(): UseMutationResult<{ authUrl: string; state: string }, Error, { redirectAfter?: string } | undefined, unknown> {
  return useMutation({
    mutationFn: beginMetaAdsOAuth,
  });
}

export function useSyncMetaAds(): UseMutationResult<any, Error, void, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => syncMetaAds(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meta-ads'], exact: false });
    },
  });
}

// ========== VOICE SURVEY ==========

export function useUpdateVoiceSurveySettings(): UseMutationResult<VoiceSurveySettings, Error, Partial<VoiceSurveySettings>, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateVoiceSurveySettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'voice-survey'] });
    },
  });
}

export function useTriggerSurveyCall(): UseMutationResult<any, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => triggerSurveyCall(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'], exact: false });
    },
  });
}

export function useRetrySurveyCall(): UseMutationResult<any, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => retrySurveyCall(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'], exact: false });
    },
  });
}

export function useCancelSurveyCall(): UseMutationResult<any, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orderId: string) => cancelSurveyCall(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['orders'], exact: false });
    },
  });
}

export function useUpdateDeveloperNotes(): UseMutationResult<any, Error, { content: string }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { content: string }) => updateDeveloperNotes(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['developer', 'notes'] });
    },
  });
}

export function useInitiateRechargeCheckout(): UseMutationResult<any, Error, { amount: number }, unknown> {
  return useMutation({
    mutationFn: (payload: { amount: number }) => initiateRechargeCheckout(payload),
  });
}

export function useUpdateEmailSettings(): UseMutationResult<any, Error, { recipientEmail?: string; smtpHost?: string; smtpPort?: number; smtpUsername?: string; smtpPassword?: string; smtpEncryption?: 'tls' | 'ssl' | 'none'; senderEmail?: string; senderName?: string }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload) => updateEmailSettings(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['developer', 'email-settings'] });
    },
  });
}

export function useUpdatePermissionsSettings(): UseMutationResult<
  PermissionsSettings,
  Error,
  PermissionsSettings,
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePermissionsSettings,
    onMutate: async (newSettings) => {
      await queryClient.cancelQueries({ queryKey: ['settings', 'permissions'] });

      const previousSettings = queryClient.getQueryData<PermissionsSettings>(['settings', 'permissions']);
      queryClient.setQueryData(['settings', 'permissions'], newSettings);

      return { previousSettings };
    },
    onError: (_err, _newSettings, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings', 'permissions'], context.previousSettings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'permissions'] });
    },
  });
}

export function useUpdatePayrollSettings(): UseMutationResult<
  PayrollSettings,
  Error,
  Partial<PayrollSettings>,
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePayrollSettings,
    onMutate: async (newSettings) => {
      await queryClient.cancelQueries({ queryKey: ['settings', 'payroll'] });

      const previousSettings = queryClient.getQueryData<PayrollSettings>(['settings', 'payroll']);
      queryClient.setQueryData(['settings', 'payroll'], { ...previousSettings, ...newSettings });

      return { previousSettings };
    },
    onError: (_err, _newSettings, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings', 'payroll'], context.previousSettings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'payroll'] });
      invalidateDashboardQueries(queryClient);
    },
  });
}

export function useMarkPayrollPaid(): UseMutationResult<
  PayrollPayment,
  Error,
  {
    employeeId: string;
    periodStart: string;
    periodEnd: string;
    periodKind: 'month' | 'custom';
    periodLabel: string;
    unitAmountSnapshot: number;
    countedStatusesSnapshot: OrderStatus[];
    orderCountSnapshot: number;
    amountSnapshot: number;
    note?: string;
  },
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markPayrollPaid,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      invalidateDashboardQueries(queryClient);
    },
  });
}

export function useUpdateWalletSettings(): UseMutationResult<
  WalletSettings,
  Error,
  Partial<WalletSettings>,
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateWalletSettings,
    onMutate: async (newSettings) => {
      await queryClient.cancelQueries({ queryKey: ['settings', 'wallet'] });

      const previousSettings = queryClient.getQueryData<WalletSettings>(['settings', 'wallet']);
      queryClient.setQueryData(['settings', 'wallet'], { ...previousSettings, ...newSettings });

      return { previousSettings };
    },
    onError: (_err, _newSettings, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings', 'wallet'], context.previousSettings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'wallet'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      invalidateDashboardQueries(queryClient);
    },
  });
}

export function usePayEmployeeWallet(): UseMutationResult<
  WalletPayout,
  Error,
  EmployeeWalletPayoutPayload,
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: payEmployeeWallet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      invalidateDashboardQueries(queryClient);
    },
  });
}

export function useDeleteEmployeeWalletPayout(): UseMutationResult<
  { success: boolean },
  Error,
  { id: string },
  unknown
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => deleteEmployeeWalletPayout(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      invalidateDashboardQueries(queryClient);
    },
  });
}

export function useCheckFraudCourierHistory(): UseMutationResult<FraudCheckResult, Error, { phone: string; customerId?: string }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ phone, customerId }) => checkFraudCourierHistory(phone, customerId),
    onSuccess: (_result, variables) => {
      if (variables.customerId) {
        queryClient.invalidateQueries({ queryKey: ['customer', variables.customerId] });
      }
    },
  });
}

export function useUpdateWhatsAppSettings(): UseMutationResult<WhatsAppSettings, Error, Partial<WhatsAppSettings>, unknown> {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: updateWhatsAppSettings, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['whatsapp'] }) });
}

export function useUpdateWhatsAppWelcomeExperience(): UseMutationResult<WhatsAppSettings, Error, Pick<WhatsAppSettings, 'welcomeMessage' | 'getStartedEnabled' | 'iceBreakers'>, unknown> {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: updateWhatsAppWelcomeExperience, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['whatsapp'] }) });
}

export function useTestWhatsAppConnection(): UseMutationResult<{ ok: boolean; phoneNumberId: string; displayPhoneNumber: string; verifiedName: string; qualityRating: string }, Error, void, unknown> {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: () => testWhatsAppConnection(), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['whatsapp', 'settings'] }) });
}

export function useCreateWhatsAppConversation(): UseMutationResult<WhatsAppContact, Error, { phoneNumber: string; name?: string }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: createWhatsAppConversation, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['whatsapp', 'contacts'] }) });
}

export function useMarkWhatsAppConversationRead(): UseMutationResult<{ ok: boolean; contactId: string }, Error, string, unknown> {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: markWhatsAppConversationRead, onSuccess: (_data, contactId) => { queryClient.invalidateQueries({ queryKey: ['whatsapp', 'contacts'] }); queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages', contactId] }); } });
}

export function useSendWhatsAppMessage(): UseMutationResult<WhatsAppMessage, Error, { contactId: string; text: string }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: sendWhatsAppMessage, onSuccess: (_data, variables) => { queryClient.invalidateQueries({ queryKey: ['whatsapp', 'contacts'] }); queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages', variables.contactId] }); } });
}

export function useSendWhatsAppMediaMessage(): UseMutationResult<WhatsAppMessage, Error, { contactId: string; dataUrl: string; fileName: string; mimeType: string; caption?: string }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: sendWhatsAppMediaMessage, onSuccess: (_data, variables) => { queryClient.invalidateQueries({ queryKey: ['whatsapp', 'contacts'] }); queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages', variables.contactId] }); } });
}

export function useSendWhatsAppTemplate(): UseMutationResult<WhatsAppMessage, Error, { contactId: string; templateName: string; languageCode: string; components?: any[] }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: sendWhatsAppTemplate, onSuccess: (_data, variables) => { queryClient.invalidateQueries({ queryKey: ['whatsapp', 'contacts'] }); queryClient.invalidateQueries({ queryKey: ['whatsapp', 'messages', variables.contactId] }); } });
}

const invalidateMessengerConversation = (queryClient: ReturnType<typeof useQueryClient>, contactId?: string) => {
  queryClient.invalidateQueries({ queryKey: ['messenger', 'contacts'] });
  if (contactId) queryClient.invalidateQueries({ queryKey: ['messenger', 'messages', contactId] });
};

export function useUpdateMessengerSettings(): UseMutationResult<MessengerSettings, Error, Partial<MessengerSettings>, unknown> {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: updateMessengerSettings, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['messenger'] }) });
}

export function useTestMessengerConnection() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: () => testMessengerConnection(), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['messenger', 'settings'] }) });
}

export function useSubscribeMessengerPage() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: () => subscribeMessengerPage(), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['messenger', 'settings'] }) });
}

export function useUpdateMessengerProfile(): UseMutationResult<MessengerProfileSettings, Error, MessengerProfileSettings, unknown> {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: updateMessengerProfile, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['messenger', 'profile'] }) });
}

export function useMarkMessengerConversationRead() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: markMessengerConversationRead, onSuccess: (_data, contactId) => invalidateMessengerConversation(queryClient, contactId) });
}

export function useSendMessengerSenderAction() {
  return useMutation({ mutationFn: sendMessengerSenderAction });
}

export function useSendMessengerMessage(): UseMutationResult<MessengerMessage, Error, { contactId: string; text: string; replyToMid?: string }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: sendMessengerMessage, onSuccess: (_data, variables) => invalidateMessengerConversation(queryClient, variables.contactId) });
}

export function useSendMessengerMediaMessage() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: sendMessengerMediaMessage, onSuccess: (_data, variables) => invalidateMessengerConversation(queryClient, variables.contactId) });
}

export function useSendMessengerQuickReplies() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: sendMessengerQuickReplies, onSuccess: (_data, variables) => invalidateMessengerConversation(queryClient, variables.contactId) });
}

export function useSendMessengerCard() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: sendMessengerCard, onSuccess: (_data, variables) => invalidateMessengerConversation(queryClient, variables.contactId) });
}

export function useSendMessengerReaction() {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: sendMessengerReaction, onSuccess: (_data, variables) => invalidateMessengerConversation(queryClient, variables.contactId) });
}

export function useCreateNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createNotification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'], exact: false, refetchInactive: true });
      broadcastNotificationsUpdated();
    },
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'], exact: false, refetchInactive: true });
      broadcastNotificationsUpdated();
    },
  });
}

export function useRespondToNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: respondToNotification,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'], exact: false, refetchInactive: true });
      broadcastNotificationsUpdated();
    },
  });
}

export function useReviewTransactionApproval(): UseMutationResult<
  TransactionApprovalReviewResult,
  Error,
  { transactionId: string; decision: TransactionApprovalDecision; notificationId?: string },
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: reviewTransactionApproval,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transactions'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['transaction'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['accounts'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['notifications'], exact: false });
      invalidateDashboardQueries(queryClient);
      broadcastNotificationsUpdated();
    },
  });
}

export function useSaveServiceSubscriptionSettings(): UseMutationResult<
  ServiceSubscriptionOverview,
  Error,
  Parameters<typeof saveServiceSubscriptionSettings>[0],
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: saveServiceSubscriptionSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-subscription'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['notifications'], exact: false });
      broadcastNotificationsUpdated();
    },
  });
}

export function useSubmitServiceSubscriptionPayment(): UseMutationResult<
  ServiceSubscriptionOverview,
  Error,
  Parameters<typeof submitServiceSubscriptionPayment>[0],
  unknown
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: submitServiceSubscriptionPayment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-subscription'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['notifications'], exact: false });
      broadcastNotificationsUpdated();
    },
  });
}

// ========== BATCH SETTINGS ==========

/**
 * Batch update all 5 settings tables in a single mutation instead of 5 separate ones.
 * Provides optimistic updates for all 5 settings caches simultaneously.
 * 
 * Reduces network latency from 2-4s (5 individual mutations) to ~500ms (1 batch).
 */
export function useBatchUpdateSettings(): UseMutationResult<any, Error, any, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: batchUpdateSettings,
    onMutate: async (updates) => {
      // Cancel all settings queries to prevent race conditions
      await queryClient.cancelQueries({ queryKey: ['settings'] });
      
      // Snapshot all previous settings
      const previousCompany = queryClient.getQueryData<any>(['settings', 'company']);
      const previousOrder = queryClient.getQueryData<any>(['settings', 'order']);
      const previousInvoice = queryClient.getQueryData<any>(['settings', 'invoice']);
      const previousDefaults = queryClient.getQueryData<any>(['settings', 'defaults']);
      const previousCourier = queryClient.getQueryData<any>(['settings', 'courier']);
      const previousPermissions = queryClient.getQueryData<any>(['settings', 'permissions']);
      const previousPayroll = queryClient.getQueryData<any>(['settings', 'payroll']);
      const previousWallet = queryClient.getQueryData<any>(['settings', 'wallet']);
      
      // Optimistically update all settings caches
      if (updates.company && previousCompany) {
        queryClient.setQueryData(['settings', 'company'], { ...previousCompany, ...updates.company });
      }
      if (updates.order && previousOrder) {
        queryClient.setQueryData(['settings', 'order'], { ...previousOrder, ...updates.order });
      }
      if (updates.invoice && previousInvoice) {
        queryClient.setQueryData(['settings', 'invoice'], { ...previousInvoice, ...updates.invoice });
      }
      if (updates.defaults && previousDefaults) {
        queryClient.setQueryData(['settings', 'defaults'], { ...previousDefaults, ...updates.defaults });
      }
      if (updates.courier && previousCourier) {
        queryClient.setQueryData(['settings', 'courier'], { ...previousCourier, ...updates.courier });
      }
      if (updates.permissions) {
        queryClient.setQueryData(['settings', 'permissions'], updates.permissions);
      }
      if (updates.payroll && previousPayroll) {
        queryClient.setQueryData(['settings', 'payroll'], { ...previousPayroll, ...updates.payroll });
      }
      if (updates.wallet && previousWallet) {
        queryClient.setQueryData(['settings', 'wallet'], { ...previousWallet, ...updates.wallet });
      }
      
      return {
        previousCompany,
        previousOrder,
        previousInvoice,
        previousDefaults,
        previousCourier,
        previousPermissions,
        previousPayroll,
        previousWallet,
      };
    },
    onError: (err, updates, context) => {
      // Rollback all settings on error
      if (context?.previousCompany) {
        queryClient.setQueryData(['settings', 'company'], context.previousCompany);
      }
      if (context?.previousOrder) {
        queryClient.setQueryData(['settings', 'order'], context.previousOrder);
      }
      if (context?.previousInvoice) {
        queryClient.setQueryData(['settings', 'invoice'], context.previousInvoice);
      }
      if (context?.previousDefaults) {
        queryClient.setQueryData(['settings', 'defaults'], context.previousDefaults);
      }
      if (context?.previousCourier) {
        queryClient.setQueryData(['settings', 'courier'], context.previousCourier);
      }
      if (context?.previousPermissions) {
        queryClient.setQueryData(['settings', 'permissions'], context.previousPermissions);
      }
      if (context?.previousPayroll) {
        queryClient.setQueryData(['settings', 'payroll'], context.previousPayroll);
      }
      if (context?.previousWallet) {
        queryClient.setQueryData(['settings', 'wallet'], context.previousWallet);
      }
    },
    onSuccess: (data) => {
      // Directly update caches with server response to avoid stale optimistic data
      if (data?.company) queryClient.setQueryData(['settings', 'company'], data.company);
      if (data?.order) queryClient.setQueryData(['settings', 'order'], data.order);
      if (data?.invoice) queryClient.setQueryData(['settings', 'invoice'], data.invoice);
      if (data?.defaults) queryClient.setQueryData(['settings', 'defaults'], data.defaults);
      if (data?.courier) queryClient.setQueryData(['settings', 'courier'], data.courier);
      if (data?.permissions) queryClient.setQueryData(['settings', 'permissions'], data.permissions);
      if (data?.wallet) queryClient.setQueryData(['settings', 'wallet'], data.wallet);
      // Also invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'global-branding'] });
      queryClient.invalidateQueries({ queryKey: ['wallet'] });
    },
  });
}

// ========== UNDOER (ORDER STATUS REVERT) ==========

export function useRevertOrderStatus(): UseMutationResult<Order, Error, { orderId: string; targetStatus: string }, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { orderId: string; targetStatus: string }) =>
      revertOrderStatus(payload),
    onSuccess: (data) => {
      queryClient.setQueryData(['order', data.id], data);
      invalidateResourceQueries(queryClient, 'orders');
      queryClient.invalidateQueries({ queryKey: ['orders-search'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['customers'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['ordersByCustomerId'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['transactions'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['accounts'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['products'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['employeeOrderCounts'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['payroll'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['wallet'], exact: false });
      invalidateRecycleBin(queryClient);
      invalidateDashboardQueries(queryClient);
    },
  });
}

export function useUpdateAgentSettings(): UseMutationResult<AgentSettings, Error, AgentSettings, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAgentSettings,
    onMutate: async (newSettings) => {
      // Cancel outgoing queries
      await queryClient.cancelQueries({ queryKey: ['settings', 'agent'] });
      
      // Snapshot previous data
      const previousSettings = queryClient.getQueryData<AgentSettings>(['settings', 'agent']);
      
      // Optimistically update
      queryClient.setQueryData(['settings', 'agent'], newSettings);
      
      return { previousSettings };
    },
    onError: (err, newSettings, context) => {
      if (context?.previousSettings) {
        queryClient.setQueryData(['settings', 'agent'], context.previousSettings);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'agent'] });
    },
  });
}

export function useUpdateBusinessGrowthSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateBusinessGrowthSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'business-growth'] });
    },
  });
}

export function useRefreshBusinessRecommendations() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: refreshBusinessRecommendations,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['business-recommendations'] });
    },
  });
}

export function useUpdateLlmSettings(): UseMutationResult<LlmSettings, Error, LlmSettings, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateLlmSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(['settings', 'llms'], settings);
      queryClient.invalidateQueries({ queryKey: ['settings', 'llms'] });
    },
  });
}

export function useUpdateBeSmartSettings(): UseMutationResult<BeSmartSettings, Error, BeSmartSettings, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateBeSmartSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(['settings', 'be-smart'], settings);
      queryClient.invalidateQueries({ queryKey: ['settings', 'be-smart'] });
    },
  });
}

export function useUpdateVoiceSurveyIntegrationSettings(): UseMutationResult<VoiceSurveyIntegrationSettings, Error, Partial<VoiceSurveyIntegrationSettings>, unknown> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateVoiceSurveyIntegrationSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings', 'voice-survey-integration'] });
    },
  });
}
