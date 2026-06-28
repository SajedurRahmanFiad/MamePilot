import type { AppCapabilityKey, AppCapabilityMap } from '../../types';

export const CAPABILITY_LABELS: Record<AppCapabilityKey, string> = {
  dashboard: 'Dashboard',
  inventory: 'Inventory',
  sales: 'Sales',
  recycle_bin_undoer: 'Recycle Bin & Undoer',
  purchases: 'Purchases',
  banking: 'Banking',
  human_resources: 'Human Resources',
  advanced_reports: 'Advanced Reports',
  fraud_checker: 'Fraud Checker',
  whitelabel: 'Whitelabel',
  custom_roles: 'Custom Roles',
  courier_automation: 'Courier Automation',
};

export const DEFAULT_CAPABILITIES: AppCapabilityMap = {
  dashboard: true,
  inventory: true,
  sales: true,
  recycle_bin_undoer: true,
  purchases: true,
  banking: true,
  human_resources: true,
  advanced_reports: true,
  fraud_checker: true,
  whitelabel: false,
  custom_roles: true,
  courier_automation: true,
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
  { pattern: /^\/social-media-ads(?:\/|$)|^\/meta-ads(?:\/|$)/, capability: 'dashboard' },
  { pattern: /^\/reports(?:\/|$)/, capability: 'advanced_reports' },
  { pattern: /^\/recycle-bin(?:\/|$)|^\/undoer(?:\/|$)/, capability: 'recycle_bin_undoer' },
  { pattern: /^\/fraud-checker(?:\/|$)/, capability: 'fraud_checker' },
];

export function capabilityForPath(pathname: string): AppCapabilityKey | null {
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return ROUTE_CAPABILITY_RULES.find((rule) => rule.pattern.test(normalizedPath))?.capability ?? null;
}
