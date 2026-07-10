import {
  UserRole,
  type PermissionDefinition,
  type PermissionKey,
  type PermissionRoleConfig,
  type PermissionsSettings,
  type RolePermissionMap,
} from '../../types';

export const RESERVED_PERMISSION_ROLES = [UserRole.ADMIN, UserRole.DEVELOPER] as const;
export const BUILT_IN_PERMISSION_ROLES = [UserRole.EMPLOYEE] as const;

const LEGACY_SCOPED_PERMISSION_KEYS: Array<{
  legacyKey: string;
  ownKey: PermissionKey;
  anyKey: PermissionKey;
}> = [
  { legacyKey: 'orders.edit', ownKey: 'orders.editOwn', anyKey: 'orders.editAny' },
  { legacyKey: 'orders.delete', ownKey: 'orders.deleteOwn', anyKey: 'orders.deleteAny' },
  { legacyKey: 'orders.cancel', ownKey: 'orders.cancelOwn', anyKey: 'orders.cancelAny' },
  {
    legacyKey: 'orders.moveOnHoldToProcessing',
    ownKey: 'orders.moveOnHoldToProcessingOwn',
    anyKey: 'orders.moveOnHoldToProcessingAny',
  },
  { legacyKey: 'orders.sendToCourier', ownKey: 'orders.sendToCourierOwn', anyKey: 'orders.sendToCourierAny' },
  { legacyKey: 'orders.moveToPicked', ownKey: 'orders.moveToPickedOwn', anyKey: 'orders.moveToPickedAny' },
  {
    legacyKey: 'orders.markCompleted',
    ownKey: 'orders.markCompletedOwn',
    anyKey: 'orders.markCompletedAny',
  },
  {
    legacyKey: 'orders.markReturned',
    ownKey: 'orders.markReturnedOwn',
    anyKey: 'orders.markReturnedAny',
  },
  { legacyKey: 'bills.edit', ownKey: 'bills.editOwn', anyKey: 'bills.editAny' },
  { legacyKey: 'bills.delete', ownKey: 'bills.deleteOwn', anyKey: 'bills.deleteAny' },
  { legacyKey: 'bills.cancel', ownKey: 'bills.cancelOwn', anyKey: 'bills.cancelAny' },
  {
    legacyKey: 'bills.moveOnHoldToProcessing',
    ownKey: 'bills.moveOnHoldToProcessingOwn',
    anyKey: 'bills.moveOnHoldToProcessingAny',
  },
  {
    legacyKey: 'bills.markReceived',
    ownKey: 'bills.markReceivedOwn',
    anyKey: 'bills.markReceivedAny',
  },
  { legacyKey: 'bills.markPaid', ownKey: 'bills.markPaidOwn', anyKey: 'bills.markPaidAny' },
];

function legacyPermissionGrantsAnyAccess(roleName: string): boolean {
  return !BUILT_IN_PERMISSION_ROLES.includes(normalizeRoleName(roleName) as (typeof BUILT_IN_PERMISSION_ROLES)[number]);
}

export const PERMISSION_DEFINITIONS: PermissionDefinition[] = [
  {
    key: 'allPrivileges',
    label: 'All Privileges',
    description: 'Check every permission in this column at once.',
    section: 'Overview',
    isVirtual: true,
  },
  {
    key: 'dashboard.viewAdmin',
    label: 'Admin Dashboard',
    description: 'See the admin dashboard widgets, charts, and summaries.',
    section: 'Overview',
  },
  {
    key: 'dashboard.viewEmployee',
    label: 'Employee Dashboard',
    description: 'See the employee performance and wallet dashboard.',
    section: 'Overview',
  },
  {
    key: 'orders.view',
    label: 'View Orders',
    description: 'Open the orders list and order details.',
    section: 'Orders',
  },
  {
    key: 'orders.create',
    label: 'Create Orders',
    description: 'Create new orders.',
    section: 'Orders',
  },
  {
    key: 'orders.editOwn',
    label: 'Edit Own Orders',
    description: 'Edit orders created by the current user.',
    section: 'Orders',
  },
  {
    key: 'orders.editAny',
    label: 'Edit Any Orders',
    description: 'Edit orders created by any user.',
    section: 'Orders',
  },
  {
    key: 'orders.deleteOwn',
    label: 'Delete Own Orders',
    description: 'Archive or remove orders created by the current user.',
    section: 'Orders',
  },
  {
    key: 'orders.deleteAny',
    label: 'Delete Any Orders',
    description: 'Archive or remove orders created by any user.',
    section: 'Orders',
  },
  {
    key: 'orders.cancelOwn',
    label: 'Cancel Own Orders',
    description: 'Mark orders created by the current user as cancelled.',
    section: 'Orders',
  },
  {
    key: 'orders.cancelAny',
    label: 'Cancel Any Orders',
    description: 'Mark orders created by any user as cancelled.',
    section: 'Orders',
  },
  {
    key: 'orders.moveOnHoldToProcessingOwn',
    label: 'Orders: On Hold to Processing (Own)',
    description: 'Move the current user’s On Hold orders to Processing.',
    section: 'Orders',
  },
  {
    key: 'orders.moveOnHoldToProcessingAny',
    label: 'Orders: On Hold to Processing (Any)',
    description: 'Move any user’s On Hold orders to Processing.',
    section: 'Orders',
  },
  {
    key: 'orders.sendToCourierOwn',
    label: 'Orders: Send to Courier (Own)',
    description: 'Submit the current user’s orders to courier services.',
    section: 'Orders',
  },
  {
    key: 'orders.sendToCourierAny',
    label: 'Orders: Send to Courier (Any)',
    description: 'Submit any user’s orders to courier services.',
    section: 'Orders',
  },
  {
    key: 'orders.moveToPickedOwn',
    label: 'Orders: Move to Picked (Own)',
    description: 'Mark the current user’s courier orders as picked.',
    section: 'Orders',
  },
  {
    key: 'orders.moveToPickedAny',
    label: 'Orders: Move to Picked (Any)',
    description: 'Mark any user’s courier orders as picked.',
    section: 'Orders',
  },
  {
    key: 'orders.markCompletedOwn',
    label: 'Orders: Mark Completed (Own)',
    description: 'Finalize delivered orders created by the current user.',
    section: 'Orders',
  },
  {
    key: 'orders.markCompletedAny',
    label: 'Orders: Mark Completed (Any)',
    description: 'Finalize delivered orders created by any user.',
    section: 'Orders',
  },
  {
    key: 'orders.markReturnedOwn',
    label: 'Orders: Mark Returned (Own)',
    description: 'Finalize returned orders created by the current user.',
    section: 'Orders',
  },
  {
    key: 'orders.markReturnedAny',
    label: 'Orders: Mark Returned (Any)',
    description: 'Finalize returned orders created by any user.',
    section: 'Orders',
  },
  {
    key: 'orders.print',
    label: 'Print Orders',
    description: 'Print order invoices and receipts.',
    section: 'Orders',
  },
  {
    key: 'customers.view',
    label: 'View Customers',
    description: 'Open the customers list and customer profiles.',
    section: 'Customers',
  },
  {
    key: 'customers.create',
    label: 'Create Customers',
    description: 'Add new customers.',
    section: 'Customers',
  },
  {
    key: 'customers.edit',
    label: 'Edit Customers',
    description: 'Edit existing customer profiles.',
    section: 'Customers',
  },
  {
    key: 'customers.delete',
    label: 'Delete Customers',
    description: 'Archive customers.',
    section: 'Customers',
  },
  {
    key: 'leads.view',
    label: 'View Leads',
    description: 'Open the leads list and lead details.',
    section: 'Customers',
  },
  {
    key: 'leads.create',
    label: 'Create Leads',
    description: 'Add new leads.',
    section: 'Customers',
  },
  {
    key: 'leads.edit',
    label: 'Edit Leads',
    description: 'Edit existing lead profiles.',
    section: 'Customers',
  },
  {
    key: 'leads.delete',
    label: 'Delete Leads',
    description: 'Archive or remove leads.',
    section: 'Customers',
  },
  {
    key: 'bills.view',
    label: 'View Bills',
    description: 'Open the bills list and bill details.',
    section: 'Bills',
  },
  {
    key: 'bills.create',
    label: 'Create Bills',
    description: 'Create new purchase bills.',
    section: 'Bills',
  },
  {
    key: 'bills.editOwn',
    label: 'Edit Own Bills',
    description: 'Edit bills created by the current user.',
    section: 'Bills',
  },
  {
    key: 'bills.editAny',
    label: 'Edit Any Bills',
    description: 'Edit bills created by any user.',
    section: 'Bills',
  },
  {
    key: 'bills.deleteOwn',
    label: 'Delete Own Bills',
    description: 'Archive or remove bills created by the current user.',
    section: 'Bills',
  },
  {
    key: 'bills.deleteAny',
    label: 'Delete Any Bills',
    description: 'Archive or remove bills created by any user.',
    section: 'Bills',
  },
  {
    key: 'bills.cancelOwn',
    label: 'Cancel Own Bills',
    description: 'Revert bills created by the current user back to On Hold.',
    section: 'Bills',
  },
  {
    key: 'bills.cancelAny',
    label: 'Cancel Any Bills',
    description: 'Revert bills created by any user back to On Hold.',
    section: 'Bills',
  },
  {
    key: 'bills.moveOnHoldToProcessingOwn',
    label: 'Bills: On Hold to Processing (Own)',
    description: 'Move the current user’s On Hold bills to Processing.',
    section: 'Bills',
  },
  {
    key: 'bills.moveOnHoldToProcessingAny',
    label: 'Bills: On Hold to Processing (Any)',
    description: 'Move any user’s On Hold bills to Processing.',
    section: 'Bills',
  },
  {
    key: 'bills.markReceivedOwn',
    label: 'Bills: Mark Received (Own)',
    description: 'Mark the current user’s incoming bills as received.',
    section: 'Bills',
  },
  {
    key: 'bills.markReceivedAny',
    label: 'Bills: Mark Received (Any)',
    description: 'Mark any user’s incoming bills as received.',
    section: 'Bills',
  },
  {
    key: 'bills.markPaidOwn',
    label: 'Bills: Mark Paid (Own)',
    description: 'Record payments for bills created by the current user.',
    section: 'Bills',
  },
  {
    key: 'bills.markPaidAny',
    label: 'Bills: Mark Paid (Any)',
    description: 'Record payments for bills created by any user.',
    section: 'Bills',
  },
  {
    key: 'bills.print',
    label: 'Print Bills',
    description: 'Print bill invoices and receipts.',
    section: 'Bills',
  },
  {
    key: 'transactions.view',
    label: 'View Transactions',
    description: 'Open the transaction list.',
    section: 'Transactions',
  },
  {
    key: 'transactions.create',
    label: 'Create Transactions',
    description: 'Record income and expense entries.',
    section: 'Transactions',
  },
  {
    key: 'transactions.edit',
    label: 'Edit Transactions',
    description: 'Edit existing transaction entries.',
    section: 'Transactions',
  },
  {
    key: 'transactions.delete',
    label: 'Delete Transactions',
    description: 'Archive transactions.',
    section: 'Transactions',
  },
  {
    key: 'vendors.view',
    label: 'View Vendors',
    description: 'Open the vendor list and vendor profiles.',
    section: 'Inventory & Banking',
  },
  {
    key: 'vendors.create',
    label: 'Create Vendors',
    description: 'Add new vendors.',
    section: 'Inventory & Banking',
  },
  {
    key: 'vendors.edit',
    label: 'Edit Vendors',
    description: 'Edit vendor profiles.',
    section: 'Inventory & Banking',
  },
  {
    key: 'vendors.delete',
    label: 'Delete Vendors',
    description: 'Archive vendors.',
    section: 'Inventory & Banking',
  },
  {
    key: 'vendors.viewBills',
    label: 'View Vendor Bills',
    description: 'View bills and invoices associated with vendors.',
    section: 'Inventory & Banking',
  },
  {
    key: 'products.view',
    label: 'View Products',
    description: 'Open the products list.',
    section: 'Inventory & Banking',
  },
  {
    key: 'products.create',
    label: 'Create Products',
    description: 'Add new products.',
    section: 'Inventory & Banking',
  },
  {
    key: 'products.edit',
    label: 'Edit Products',
    description: 'Edit products.',
    section: 'Inventory & Banking',
  },
  {
    key: 'products.delete',
    label: 'Delete Products',
    description: 'Archive products.',
    section: 'Inventory & Banking',
  },
  {
    key: 'accounts.view',
    label: 'View Accounts',
    description: 'Open banking accounts.',
    section: 'Inventory & Banking',
  },
  {
    key: 'accounts.create',
    label: 'Create Accounts',
    description: 'Add banking accounts.',
    section: 'Inventory & Banking',
  },
  {
    key: 'accounts.edit',
    label: 'Edit Accounts',
    description: 'Edit banking accounts.',
    section: 'Inventory & Banking',
  },
  {
    key: 'accounts.delete',
    label: 'Delete Accounts',
    description: 'Remove banking accounts.',
    section: 'Inventory & Banking',
  },
  {
    key: 'accounts.viewBalance',
    label: 'View Account Balances',
    description: 'View account balance amounts and financial details.',
    section: 'Inventory & Banking',
  },
  {
    key: 'fraudChecker.check',
    label: 'Use Fraud Checker',
    description: 'Run courier history and fraud checks from banking and order details.',
    section: 'Inventory & Banking',
  },
  {
    key: 'fraudChecker.viewHistory',
    label: 'View Fraud Check History',
    description: 'View past fraud check results and history.',
    section: 'Inventory & Banking',
  },
  {
    key: 'transfers.create',
    label: 'Create Transfers',
    description: 'Create balance transfers between accounts.',
    section: 'Inventory & Banking',
  },
  {
    key: 'transfers.view',
    label: 'View Transfers',
    description: 'View transfer history and records.',
    section: 'Inventory & Banking',
  },
  {
    key: 'reports.view',
    label: 'View Reports',
    description: 'Open reporting pages.',
    section: 'Other Modules',
  },
  {
    key: 'reports.viewExpense',
    label: 'View Expense Reports',
    description: 'View expense summary and breakdown reports.',
    section: 'Other Modules',
  },
  {
    key: 'reports.viewIncome',
    label: 'View Income Reports',
    description: 'View income summary and revenue reports.',
    section: 'Other Modules',
  },
  {
    key: 'reports.viewProfitLoss',
    label: 'View Profit/Loss Reports',
    description: 'View profit and loss statements.',
    section: 'Other Modules',
  },
  {
    key: 'reports.viewCustomerSales',
    label: 'View Customer Sales Reports',
    description: 'View customer sales breakdown reports.',
    section: 'Other Modules',
  },
  {
    key: 'reports.viewProductQuantity',
    label: 'View Product Quantity Reports',
    description: 'View product quantity sold reports.',
    section: 'Other Modules',
  },
  {
    key: 'reports.viewUserActivity',
    label: 'View User Activity Reports',
    description: 'View user activity and performance reports.',
    section: 'Other Modules',
  },
  {
    key: 'reports.export',
    label: 'Export Reports',
    description: 'Export and download report data.',
    section: 'Other Modules',
  },
  {
    key: 'wallet.view',
    label: 'View Wallet',
    description: 'Open wallet balance and activity.',
    section: 'Other Modules',
  },
  {
    key: 'wallet.viewAny',
    label: 'View Any Wallet',
    description: 'View any employee wallet balance and activity.',
    section: 'Other Modules',
  },
  {
    key: 'payroll.view',
    label: 'View Payroll',
    description: 'Open payroll and employee wallet summary pages.',
    section: 'Other Modules',
  },
  {
    key: 'payroll.pay',
    label: 'Pay Employees',
    description: 'Process wallet payouts to employees.',
    section: 'Other Modules',
  },
  {
    key: 'payroll.deletePayments',
    label: 'Delete Payroll Payments',
    description: 'Delete payroll payment records.',
    section: 'Other Modules',
  },
  {
    key: 'recycleBin.view',
    label: 'View Recycle Bin',
    description: 'Open archived records.',
    section: 'Other Modules',
  },
  {
    key: 'recycleBin.restore',
    label: 'Restore Records',
    description: 'Restore archived records from the recycle bin.',
    section: 'Other Modules',
  },
  {
    key: 'recycleBin.deletePermanent',
    label: 'Permanently Delete Records',
    description: 'Permanently delete records from the recycle bin.',
    section: 'Other Modules',
  },
  {
    key: 'users.view',
    label: 'View Users',
    description: 'Open the users and human resource pages.',
    section: 'Other Modules',
  },
  {
    key: 'users.create',
    label: 'Create Users',
    description: 'Create new user accounts.',
    section: 'Other Modules',
  },
  {
    key: 'users.edit',
    label: 'Edit Users',
    description: 'Edit user profiles and details.',
    section: 'Other Modules',
  },
  {
    key: 'users.delete',
    label: 'Delete Users',
    description: 'Delete or archive user accounts.',
    section: 'Other Modules',
  },
  {
    key: 'undoer.view',
    label: 'View Undoer',
    description: 'Access the status undoer to revert operations securely.',
    section: 'Other Modules',
  },
  {
    key: 'undoer.execute',
    label: 'Execute Undo Operations',
    description: 'Execute status reversal and undo operations.',
    section: 'Other Modules',
  },
  {
    key: 'marketing.view',
    label: 'View Marketing',
    description: 'View marketing dashboard and ad performance data.',
    section: 'Marketing',
  },
  {
    key: 'marketing.manageAds',
    label: 'Manage Ads',
    description: 'Manage Meta Ads and social media advertising.',
    section: 'Marketing',
  },
  {
    key: 'marketing.syncAds',
    label: 'Sync Ads',
    description: 'Sync ad data from Meta and advertising platforms.',
    section: 'Marketing',
  },
  {
    key: 'settings.view',
    label: 'View Settings',
    description: 'View system settings and configuration.',
    section: 'Settings',
  },
  {
    key: 'settings.editCompany',
    label: 'Edit Company Settings',
    description: 'Edit company information and branding.',
    section: 'Settings',
  },
  {
    key: 'settings.editOrderInvoice',
    label: 'Edit Order & Invoice Settings',
    description: 'Edit order numbering, invoice layout, and defaults.',
    section: 'Settings',
  },
  {
    key: 'settings.editDefaults',
    label: 'Edit System Defaults',
    description: 'Edit system default values and configurations.',
    section: 'Settings',
  },
  {
    key: 'settings.editWallet',
    label: 'Edit Wallet Settings',
    description: 'Edit wallet and payroll configuration.',
    section: 'Settings',
  },
  {
    key: 'settings.editCourier',
    label: 'Edit Courier Settings',
    description: 'Edit courier integration settings.',
    section: 'Settings',
  },
  {
    key: 'settings.editCategories',
    label: 'Edit Categories',
    description: 'Manage product and transaction categories.',
    section: 'Settings',
  },
  {
    key: 'settings.editPaymentMethods',
    label: 'Edit Payment Methods',
    description: 'Manage payment method configurations.',
    section: 'Settings',
  },
  {
    key: 'settings.managePermissions',
    label: 'Manage Permissions',
    description: 'Manage role-based access control permissions.',
    section: 'Settings',
  },
  {
    key: 'subscriptions.view',
    label: 'View Subscriptions',
    description: 'View subscription plans and billing details.',
    section: 'Settings',
  },
];

export const STORED_PERMISSION_DEFINITIONS = PERMISSION_DEFINITIONS.filter(
  (definition): definition is PermissionDefinition & { key: PermissionKey } => !definition.isVirtual,
);

export const STORED_PERMISSION_KEYS = STORED_PERMISSION_DEFINITIONS.map((definition) => definition.key);

export function createBlankPermissionMap(): RolePermissionMap {
  return STORED_PERMISSION_KEYS.reduce((accumulator, key) => {
    accumulator[key] = false;
    return accumulator;
  }, {} as RolePermissionMap);
}

function createPermissionMap(enabledKeys: PermissionKey[]): RolePermissionMap {
  const next = createBlankPermissionMap();
  for (const key of enabledKeys) {
    next[key] = true;
  }
  return next;
}

export const DEFAULT_ROLE_PERMISSION_SETTINGS: PermissionsSettings = {
  roles: [
    {
      roleName: UserRole.EMPLOYEE,
      isCustom: false,
      permissions: createPermissionMap([
        'dashboard.viewEmployee',
        'orders.view',
        'orders.create',
        'orders.editOwn',
        'orders.print',
        'customers.view',
        'customers.create',
        'customers.edit',
        'leads.view',
        'leads.create',
        'leads.edit',
        'products.view',
        'fraudChecker.check',
        'wallet.view',
        'reports.view',
        'reports.viewExpense',
        'reports.viewIncome',
        'reports.viewProfitLoss',
        'reports.viewCustomerSales',
        'reports.viewProductQuantity',
        'reports.viewUserActivity',
      ]),
    },
  ],
};

export function normalizeRoleName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function isReservedPermissionRole(roleName: string): boolean {
  return RESERVED_PERMISSION_ROLES.includes(normalizeRoleName(roleName) as (typeof RESERVED_PERMISSION_ROLES)[number]);
}

export function isBuiltInPermissionRole(roleName: string): boolean {
  return BUILT_IN_PERMISSION_ROLES.includes(normalizeRoleName(roleName) as (typeof BUILT_IN_PERMISSION_ROLES)[number]);
}

export function normalizeRolePermissionMap(
  value: Partial<Record<string, unknown>> | undefined | null,
  fallback?: Partial<RolePermissionMap>,
  roleName?: string,
): RolePermissionMap {
  const raw = value || {};
  const next = createBlankPermissionMap();
  for (const key of STORED_PERMISSION_KEYS) {
    const candidate = raw[key];
    if (typeof candidate === 'boolean') {
      next[key] = candidate;
      continue;
    }
    next[key] = Boolean(fallback?.[key]);
  }

  const normalizedRoleName = normalizeRoleName(String(roleName || ''));
  for (const { legacyKey, ownKey, anyKey } of LEGACY_SCOPED_PERMISSION_KEYS) {
    const legacyValue = raw[legacyKey];
    if (typeof legacyValue !== 'boolean') {
      continue;
    }
    if (typeof raw[ownKey] !== 'boolean') {
      next[ownKey] = legacyValue;
    }
    if (typeof raw[anyKey] !== 'boolean') {
      next[anyKey] = legacyValue && legacyPermissionGrantsAnyAccess(normalizedRoleName);
    }
  }

  return next;
}

export function getDefaultPermissionsForRole(roleName: string): RolePermissionMap {
  const normalizedRoleName = normalizeRoleName(roleName);
  const builtIn = DEFAULT_ROLE_PERMISSION_SETTINGS.roles.find((role) => role.roleName === normalizedRoleName);

  if (builtIn) {
    return normalizeRolePermissionMap(builtIn.permissions, undefined, builtIn.roleName);
  }

  if (isReservedPermissionRole(normalizedRoleName)) {
    return STORED_PERMISSION_KEYS.reduce((accumulator, key) => {
      accumulator[key] = true;
      return accumulator;
    }, {} as RolePermissionMap);
  }

  return createBlankPermissionMap();
}

export function normalizePermissionRoleConfig(
  value: Partial<PermissionRoleConfig> | null | undefined,
): PermissionRoleConfig | null {
  const roleName = normalizeRoleName(String(value?.roleName || ''));
  if (!roleName || isReservedPermissionRole(roleName)) {
    return null;
  }

  return {
    roleName,
    isCustom: !isBuiltInPermissionRole(roleName),
    permissions: normalizeRolePermissionMap(value?.permissions, getDefaultPermissionsForRole(roleName), roleName),
    createdAt: value?.createdAt ?? null,
    updatedAt: value?.updatedAt ?? null,
  };
}

export function normalizePermissionsSettings(value: Partial<PermissionsSettings> | null | undefined): PermissionsSettings {
  const mergedByRole = new Map<string, PermissionRoleConfig>();

  for (const role of DEFAULT_ROLE_PERMISSION_SETTINGS.roles) {
    mergedByRole.set(role.roleName, {
      ...role,
      permissions: normalizeRolePermissionMap(role.permissions, undefined, role.roleName),
    });
  }

  for (const candidate of value?.roles || []) {
    const normalizedRole = normalizePermissionRoleConfig(candidate);
    if (!normalizedRole) {
      continue;
    }

    const existing = mergedByRole.get(normalizedRole.roleName);
    mergedByRole.set(normalizedRole.roleName, {
      ...normalizedRole,
      isCustom: normalizedRole.isCustom,
      permissions: normalizeRolePermissionMap(
        normalizedRole.permissions,
        existing?.permissions || getDefaultPermissionsForRole(normalizedRole.roleName),
      ),
    });
  }

  const roles = Array.from(mergedByRole.values()).sort((left, right) => {
    if (left.isCustom !== right.isCustom) {
      return left.isCustom ? 1 : -1;
    }
    return left.roleName.localeCompare(right.roleName);
  });

  return { roles };
}

export function clonePermissionsSettings(value: Partial<PermissionsSettings> | null | undefined): PermissionsSettings {
  const normalized = normalizePermissionsSettings(value);
  return {
    roles: normalized.roles.map((role) => ({
      ...role,
      permissions: { ...role.permissions },
    })),
  };
}

export function getPermissionRoles(value: Partial<PermissionsSettings> | null | undefined): PermissionRoleConfig[] {
  return normalizePermissionsSettings(value).roles;
}

export function getRolePermissions(
  value: Partial<PermissionsSettings> | null | undefined,
  roleName: string | null | undefined,
): RolePermissionMap {
  const normalizedRoleName = normalizeRoleName(String(roleName || ''));
  if (!normalizedRoleName) {
    return createBlankPermissionMap();
  }

  if (isReservedPermissionRole(normalizedRoleName)) {
    return getDefaultPermissionsForRole(normalizedRoleName);
  }

  const settings = normalizePermissionsSettings(value);
  const role = settings.roles.find((candidate) => candidate.roleName === normalizedRoleName);
  return normalizeRolePermissionMap(role?.permissions, getDefaultPermissionsForRole(normalizedRoleName), normalizedRoleName);
}

export function roleHasPermission(
  roleName: string | null | undefined,
  permissionKey: PermissionKey,
  value: Partial<PermissionsSettings> | null | undefined,
): boolean {
  const permissions = getRolePermissions(value, roleName);
  return Boolean(permissions[permissionKey]);
}

export function areAllPrivilegesEnabled(permissions: RolePermissionMap): boolean {
  return STORED_PERMISSION_KEYS.every((key) => Boolean(permissions[key]));
}

export function permissionMapHasAnyPermission(
  permissions: Partial<RolePermissionMap> | null | undefined,
  permissionKeys: PermissionKey[],
): boolean {
  return permissionKeys.some((permissionKey) => Boolean(permissions?.[permissionKey]));
}

export function hasScopedPermission(
  permissions: Partial<RolePermissionMap> | null | undefined,
  currentUserId: string | null | undefined,
  createdBy: string | null | undefined,
  ownPermissionKey: PermissionKey,
  anyPermissionKey: PermissionKey,
): boolean {
  if (Boolean(permissions?.[anyPermissionKey])) {
    return true;
  }

  const normalizedCurrentUserId = String(currentUserId || '').trim();
  const normalizedCreatedBy = String(createdBy || '').trim();
  return (
    normalizedCurrentUserId !== ''
    && normalizedCreatedBy !== ''
    && normalizedCurrentUserId === normalizedCreatedBy
    && Boolean(permissions?.[ownPermissionKey])
  );
}

export function getAssignableUserRoles(
  value: Partial<PermissionsSettings> | null | undefined,
  options?: { includeDeveloper?: boolean },
): string[] {
  const roles = new Set<string>([
    UserRole.ADMIN,
    UserRole.EMPLOYEE,
    ...getPermissionRoles(value)
      .filter((role) => role.isCustom)
      .map((role) => role.roleName),
  ]);

  if (options?.includeDeveloper) {
    roles.add(UserRole.DEVELOPER);
  }

  return Array.from(roles);
}
