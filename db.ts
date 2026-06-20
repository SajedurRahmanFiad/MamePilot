
import { User, UserRole, Order, OrderStatus, Bill, BillStatus, Customer, Vendor, Product, Account, Transaction, Settings } from './types';
import { normalizeCompanySettings } from './src/utils/companyPages';
import { clonePermissionsSettings, DEFAULT_ROLE_PERMISSION_SETTINGS } from './src/utils/permissions';

// Default Settings (Only for UI, all data comes from the API)
const defaultSettings: Settings = {
  company: normalizeCompanySettings({
    name: 'Mame Pilot',
    logo: '/uploads/Avatar.png',
    phone: '',
    email: '',
    address: '',
  }),
  order: { prefix: 'BDH-', nextNumber: 1 },
  invoice: { title: 'Tax Invoice', logoWidth: 60, logoHeight: 60, footer: 'Thank you for choosing Mame Pilot!' },
  defaults: {
    defaultAccountId: '',
    defaultPaymentMethod: 'Cash',
    incomeCategoryId: '',
    expenseCategoryId: '',
    recordsPerPage: 20,
    maxTransactionAmount: 0,
    whiteLabel: false,
  },
  categories: [],
  paymentMethods: [],
  courier: {
    steadfast: { baseUrl: '', apiKey: '', secretKey: '' },
    carryBee: { baseUrl: '', clientId: '', clientSecret: '', clientContext: '', storeId: '' },
    paperfly: { baseUrl: '', username: '', password: '', paperflyKey: '', defaultShopName: '', maxWeightKg: 0.3 },
    fraudChecker: { apiKey: '' },
  },
  payroll: {
    unitAmount: 0,
    countedStatuses: [
      OrderStatus.ON_HOLD,
      OrderStatus.PROCESSING,
      OrderStatus.PICKED,
      OrderStatus.COMPLETED,
      OrderStatus.CANCELLED,
    ],
  },
  permissions: clonePermissionsSettings(DEFAULT_ROLE_PERMISSION_SETTINGS),
};

// Helper to get from local storage, NO fallback to initial data
const getFromStorage = <T,>(key: string): T | null => {
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : null;
};

// Global State - ONLY settings are restored from localStorage.
// currentUser stays in memory so auth always comes from the live session bootstrap path.
const _storedSettings = getFromStorage<Settings>('settings');
const mergedSettings: Settings = _storedSettings
  ? {
      ...defaultSettings,
      ..._storedSettings,
      company: normalizeCompanySettings({ ...defaultSettings.company, ...(_storedSettings as any).company }),
      order: { ...defaultSettings.order, ...(_storedSettings as any).order },
      invoice: { ...defaultSettings.invoice, ...(_storedSettings as any).invoice },
      defaults: {
        ...defaultSettings.defaults,
        ...(_storedSettings as any).defaults,
        defaultAccountId:
          (_storedSettings as any).defaults?.defaultAccountId ??
          (_storedSettings as any).defaults?.accountId ??
          defaultSettings.defaults.defaultAccountId,
        defaultPaymentMethod:
          (_storedSettings as any).defaults?.defaultPaymentMethod ??
          (_storedSettings as any).defaults?.paymentMethod ??
          defaultSettings.defaults.defaultPaymentMethod,
      },
      categories: Array.isArray((_storedSettings as any).categories) ? (_storedSettings as any).categories : defaultSettings.categories,
      paymentMethods: Array.isArray((_storedSettings as any).paymentMethods) ? (_storedSettings as any).paymentMethods : defaultSettings.paymentMethods,
      courier: {
        steadfast: { ...defaultSettings.courier.steadfast, ...(_storedSettings as any).courier?.steadfast },
        carryBee: { ...defaultSettings.courier.carryBee, ...(_storedSettings as any).courier?.carryBee },
        paperfly: { ...defaultSettings.courier.paperfly, ...(_storedSettings as any).courier?.paperfly },
        fraudChecker: { ...defaultSettings.courier.fraudChecker, ...(_storedSettings as any).courier?.fraudChecker },
      },
      payroll: { ...defaultSettings.payroll, ...(_storedSettings as any).payroll },
      permissions: clonePermissionsSettings((_storedSettings as any).permissions || defaultSettings.permissions),
    }
  : defaultSettings;

export const db = {
  // Keep only currentUser and settings (for context)
  // ALL other data MUST come from the API via React Query
  users: [],       // DEPRECATED - Do not use. Fetch via useUsers()
  customers: [],   // DEPRECATED - Do not use. Fetch via useCustomers()
  vendors: [],     // DEPRECATED - Do not use. Fetch via useVendors()
  products: [],    // DEPRECATED - Do not use. Fetch via useProducts()
  orders: [],      // DEPRECATED - Do not use. Fetch via useOrders()
  bills: [],       // DEPRECATED - Do not use. Fetch via useBills()
  accounts: [],    // DEPRECATED - Do not use. Fetch via useAccounts()
  transactions: [], // DEPRECATED - Do not use. Fetch via useTransactions()
  
  currentUser: null as User | null,
  settings: mergedSettings,
};

export const saveDb = () => {
  // Only save settings to localStorage to avoid stale session fallbacks
  // and quota exceeded errors. User/session state stays in memory only.
  try {
    localStorage.setItem('settings', JSON.stringify(db.settings));
  } catch (err) {
    console.warn('[DB] localStorage write failed:', err);
  }
};
