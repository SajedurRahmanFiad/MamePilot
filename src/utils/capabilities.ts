import type { AppCapabilityKey, AppCapabilityMap } from '../../types';

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
  enterprise_ai_agent: 'AI Assistant Mame',
  grow_your_business: 'Grow Your Business',
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
};

export const CAPABILITY_KEYS = Object.keys(DEFAULT_CAPABILITIES) as AppCapabilityKey[];

export function normalizeCapabilities(value: Partial<AppCapabilityMap> | undefined | null): AppCapabilityMap {
  return CAPABILITY_KEYS.reduce((accumulator, key) => {
    accumulator[key] = typeof value?.[key] === 'boolean' ? Boolean(value[key]) : DEFAULT_CAPABILITIES[key];
    return accumulator;
  }, {} as AppCapabilityMap);
}

export const ROUTE_CAPABILITY_RULES: Array<{ pattern: RegExp; capability: AppCapabilityKey }> = [
  { pattern: /^\/dashboard(?:\/|$)/, capability: 'dashboard' },
  { pattern: /^\/products(?:\/|$)/, capability: 'inventory' },
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
];

export function capabilityForPath(pathname: string): AppCapabilityKey | null {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return ROUTE_CAPABILITY_RULES.find((rule) => rule.pattern.test(normalizedPath))?.capability ?? null;
}
