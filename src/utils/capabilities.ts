import type { AppCapabilityKey, AppCapabilityMap, SubCapabilityKey, SubCapabilityMap } from '../../types';

export const CAPABILITY_LABELS: Record<AppCapabilityKey, string> = {
  dashboard: 'Dashboard',
  inventory: 'Inventory',
  sales: 'Sales & Customer Management',
  recycle_bin_undoer: 'Recovery & Undo',
  purchases: 'Purchases & Vendor Management',
  banking: 'Banking & Cash Flow',
  human_resources: 'Human Resources & Payroll',
  advanced_reports: 'Advanced Reports & Insights',
  fraud_checker: 'Fraud Protection',
  whitelabel: 'White-label & Branding',
  custom_roles: 'Custom Roles & Permissions',
  courier_automation: 'Courier Automation',
  marketing: 'Marketing & Ad Management',
  automatic_leads: 'Automatic Lead & Customer Management',
  mamecx: 'MameCX',
  enterprise_ai_agent: 'Mame AI',
  grow_your_business: 'Grow Your Business',
  be_smart: 'Be smart',
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  auto_calling: 'Auto Calling (Voice Survey)',
  woocommerce: 'WooCommerce Order Sync',
  shopify: 'Shopify Order Sync',
  recurring_transactions: 'Recurring Transactions',
};

export const CAPABILITY_DESCRIPTIONS: Record<AppCapabilityKey, string> = {
  dashboard: 'Central hub showing revenue, expenses, profit charts, order stats, and employee performance comparisons with date range filtering.',
  inventory: 'Product catalog management — create, edit, and search products with pricing, stock quantities, categories, and images. Includes batch management for living products (birds, livestock) with population tracking, age monitoring, and event logging.',
  sales: 'Full sales pipeline — create and manage orders with line items, discounts, shipping, and track customer profiles with order history.',
  recycle_bin_undoer: 'Restore soft-deleted records (orders, customers, products) or revert an order to a previous status via timeline history.',
  purchases: 'Vendor and bill management — create purchase orders, track incoming stock, manage vendor contacts and payment records.',
  banking: 'Financial account management — track bank accounts, record income and expense transactions, and transfer funds between accounts.',
  human_resources: 'Employee management — HR dashboard with attendance, employee profiles, role assignment, salary processing, and per-order payroll calculations.',
  advanced_reports: 'Analytics hub with expense, income, profit & loss, product sales, customer sales, and employee performance reports with charts.',
  fraud_checker: 'Check courier delivery history for any phone number to identify patterns of refused deliveries or fraudulent customers.',
  whitelabel: 'Replace Mame Pilot branding with your own company logo, name, and favicon across the app and login page.',
  custom_roles: 'Define custom roles with granular permission toggles across orders, customers, inventory, banking, reports, and settings.',
  courier_automation: 'Configure and dispatch shipments directly from orders via Steadfast, CarryBee, Paperfly, or Pathao with tracking IDs.',
  marketing: 'Connect Meta Ads account to view campaign performance — spend, impressions, clicks, conversions, and ROAS with demographic breakdowns.',
  automatic_leads: 'Leads auto-captured from WhatsApp and Messenger conversations with AI scoring, stage tracking, and conversation history.',
  mamecx: 'Customer experience suite for feedback collection, support management, and customer engagement. Coming soon.',
  enterprise_ai_agent: 'Floating AI assistant on every page — ask business questions, get insights, and execute multi-step actions via chat.',
  grow_your_business: 'AI-generated business recommendations for restocking, pricing, ad spend, and product opportunities with actionable cards.',
  be_smart: 'AI-powered smart forms — paste unstructured text (name, phone, address) and let the system extract structured customer or vendor fields automatically.',
  whatsapp: 'Full WhatsApp Business chat interface — send and receive messages, manage conversations, view lead intelligence alongside chats.',
  messenger: 'Facebook Messenger chat interface — message customers, send images and files, manage quick replies, with lead insights on the side.',
  auto_calling: 'Automated voice calls to customers for order confirmation and follow-up, with call history, success rates, and prepaid balance.',
  woocommerce: 'Connect WooCommerce stores to sync orders automatically, manage webhooks, and test connection health from Settings.',
  shopify: 'Connect Shopify stores to sync orders automatically, manage webhooks, and test connection health from Settings.',
  recurring_transactions: 'Schedule income and expense transactions to be created automatically on daily, weekly, monthly, or yearly intervals.',
};

export const DEFAULT_CAPABILITIES: AppCapabilityMap = {
  dashboard: true,
  inventory: true,
  sales: true,
  recycle_bin_undoer: false,
  purchases: false,
  banking: false,
  human_resources: false,
  advanced_reports: false,
  fraud_checker: false,
  whitelabel: false,
  custom_roles: false,
  courier_automation: false,
  marketing: false,
  automatic_leads: false,
  mamecx: false,
  enterprise_ai_agent: false,
  grow_your_business: false,
  be_smart: false,
  whatsapp: false,
  messenger: false,
  auto_calling: false,
  woocommerce: false,
  shopify: false,
  recurring_transactions: false,
};

export const CAPABILITY_KEYS = Object.keys(DEFAULT_CAPABILITIES) as AppCapabilityKey[];

// ===== Sub-capability definitions =====

export interface SubCapabilityDefinition {
  key: SubCapabilityKey;
  label: string;
  parentKey: AppCapabilityKey;
}

export const SUB_CAPABILITY_LABELS: Record<SubCapabilityKey, string> = {
  hr_management: 'Human Resource',
  payroll: 'Payroll',
  accounts: 'Accounts',
  transactions: 'Transactions',
  transfer: 'Transfer',
  steadfast_courier: 'Steadfast',
  carrybee_courier: 'CarryBee',
  paperfly_courier: 'Paperfly',
  pathao_courier: 'Pathao',
  recycle_bin: 'Recycle Bin',
  undoer: 'Undoer',
  batch_management: 'Batch Management',
};

export const SUB_CAPABILITY_PARENT_MAP: Record<SubCapabilityKey, AppCapabilityKey> = {
  hr_management: 'human_resources',
  payroll: 'human_resources',
  accounts: 'banking',
  transactions: 'banking',
  transfer: 'banking',
  steadfast_courier: 'courier_automation',
  carrybee_courier: 'courier_automation',
  paperfly_courier: 'courier_automation',
  pathao_courier: 'courier_automation',
  recycle_bin: 'recycle_bin_undoer',
  undoer: 'recycle_bin_undoer',
  batch_management: 'inventory',
};

export const PARENT_SUB_CAPABILITIES: Partial<Record<AppCapabilityKey, SubCapabilityKey[]>> = {
  human_resources: ['hr_management', 'payroll'],
  banking: ['accounts', 'transactions', 'transfer'],
  courier_automation: ['steadfast_courier', 'carrybee_courier', 'paperfly_courier', 'pathao_courier'],
  recycle_bin_undoer: ['recycle_bin', 'undoer'],
  inventory: ['batch_management'],
};

export const SUB_CAPABILITY_KEYS = Object.keys(SUB_CAPABILITY_LABELS) as SubCapabilityKey[];

export function getSubCapabilities(parentKey: AppCapabilityKey): SubCapabilityKey[] {
  return PARENT_SUB_CAPABILITIES[parentKey] || [];
}

export function normalizeSubCapabilities(
  value: SubCapabilityMap | undefined | null,
  parentCapabilities: AppCapabilityMap,
): SubCapabilityMap {
  const result: SubCapabilityMap = {};
  for (const subKey of SUB_CAPABILITY_KEYS) {
    const parentKey = SUB_CAPABILITY_PARENT_MAP[subKey];
    const parentEnabled = Boolean(parentCapabilities[parentKey]);
    // If parent is off, sub is always off. If parent is on, default sub to on unless explicitly set to false.
    if (!parentEnabled) {
      result[subKey] = false;
    } else {
      result[subKey] = typeof value?.[subKey] === 'boolean' ? Boolean(value[subKey]) : true;
    }
  }
  return result;
}

export function resolveSubCapability(
  subKey: SubCapabilityKey,
  capabilities: AppCapabilityMap,
  subCapabilities?: SubCapabilityMap,
): boolean {
  const parentKey = SUB_CAPABILITY_PARENT_MAP[subKey];
  if (!Boolean(capabilities[parentKey])) return false;
  if (!subCapabilities || typeof subCapabilities[subKey] !== 'boolean') return true;
  return Boolean(subCapabilities[subKey]);
}

export function normalizeCapabilities(value: Partial<AppCapabilityMap> | undefined | null): AppCapabilityMap {
  return CAPABILITY_KEYS.reduce((accumulator, key) => {
    accumulator[key] = typeof value?.[key] === 'boolean' ? Boolean(value[key]) : DEFAULT_CAPABILITIES[key];
    return accumulator;
  }, {} as AppCapabilityMap);
}

export const ROUTE_CAPABILITY_RULES: Array<{ pattern: RegExp; capability: AppCapabilityKey }> = [
  { pattern: /^\/dashboard(?:\/|$)/, capability: 'dashboard' },
  { pattern: /^\/products(?:\/|$)|^\/batches(?:\/|$)|^\/batch-event-history(?:\/|$)/, capability: 'inventory' },
  { pattern: /^\/orders(?:\/|$)|^\/customers(?:\/|$)|^\/print-order(?:\/|$)/, capability: 'sales' },
  { pattern: /^\/bills(?:\/|$)|^\/vendors(?:\/|$)|^\/print-bill(?:\/|$)/, capability: 'purchases' },
  { pattern: /^\/banking(?:\/|$)|^\/transactions(?:\/|$)/, capability: 'banking' },
  { pattern: /^\/users(?:\/|$)|^\/payroll(?:\/|$)|^\/wallet(?:\/|$)|^\/human-resource-dashboard(?:\/|$)/, capability: 'human_resources' },
  { pattern: /^\/social-media-ads(?:\/|$)|^\/meta-ads(?:\/|$)/, capability: 'marketing' },
  { pattern: /^\/leads(?:\/|$)/, capability: 'automatic_leads' },
  { pattern: /^\/reports(?:\/|$)/, capability: 'advanced_reports' },
  { pattern: /^\/recycle-bin(?:\/|$)|^\/undoer(?:\/|$)/, capability: 'recycle_bin_undoer' },
  { pattern: /^\/fraud-checker(?:\/|$)/, capability: 'fraud_checker' },
  { pattern: /^\/grow-your-business(?:\/|$)/, capability: 'grow_your_business' },
  { pattern: /^\/whatsapp(?:\/|$)/, capability: 'whatsapp' },
  { pattern: /^\/messenger(?:\/|$)/, capability: 'messenger' },
  { pattern: /^\/auto-calling(?:\/|$)/, capability: 'auto_calling' },
  { pattern: /^\/recurring-transactions(?:\/|$)/, capability: 'recurring_transactions' },
];

export function capabilityForPath(pathname: string): AppCapabilityKey | null {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return ROUTE_CAPABILITY_RULES.find((rule) => rule.pattern.test(normalizedPath))?.capability ?? null;
}
