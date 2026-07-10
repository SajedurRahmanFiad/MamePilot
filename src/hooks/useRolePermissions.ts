import { db } from '../../db';
import type { PermissionKey } from '../../types';
import { hasAdminAccess } from '../../types';
import { useAuth } from '../contexts/AuthProvider';
import { createBlankPermissionMap, getRolePermissions, hasScopedPermission, permissionMapHasAnyPermission, roleHasPermission } from '../utils/permissions';
import { usePermissionsSettings } from './useQueries';

export function useRolePermissions() {
  const { user, profile } = useAuth();
  const activeUser = profile || user || db.currentUser;
  const role = String(activeUser?.role || '');
  const isAdminAccessUser = hasAdminAccess(role);
  const { data: permissionsSettings } = usePermissionsSettings(!!activeUser);
  const permissionsReady = !activeUser || isAdminAccessUser || !!permissionsSettings;
  const authoritativeSettings = permissionsReady ? permissionsSettings : null;
  const rolePermissions = permissionsReady
    ? getRolePermissions(authoritativeSettings, role)
    : createBlankPermissionMap();

  const can = (permissionKey: PermissionKey): boolean => {
    if (!permissionsReady) {
      return false;
    }

    return roleHasPermission(role, permissionKey, authoritativeSettings);
  };

  const canAny = (permissionKeys: PermissionKey[]): boolean => {
    return permissionMapHasAnyPermission(rolePermissions, permissionKeys);
  };

  const canAccessRecord = (
    createdBy: string | null | undefined,
    ownPermissionKey: PermissionKey,
    anyPermissionKey: PermissionKey,
  ): boolean => {
    return hasScopedPermission(rolePermissions, activeUser?.id, createdBy, ownPermissionKey, anyPermissionKey);
  };

  return {
    permissionsSettings: authoritativeSettings,
    permissionsReady,
    role,
    userId: String(activeUser?.id || ''),
    rolePermissions,
    isAdminAccessUser,
    can,
    canAny,
    canAccessRecord,
    canViewAdminDashboard: can('dashboard.viewAdmin'),
    canViewEmployeeDashboard: can('dashboard.viewEmployee'),
    // Users
    canCreateUsers: can('users.create'),
    canEditUsers: can('users.edit'),
    canDeleteUsers: can('users.delete'),
    // Customers
    canCreateCustomers: can('customers.create'),
    canEditCustomers: can('customers.edit'),
    canDeleteCustomers: can('customers.delete'),
    // Products
    canCreateProducts: can('products.create'),
    canEditProducts: can('products.edit'),
    canDeleteProducts: can('products.delete'),
    // Payroll
    canPayEmployees: can('payroll.pay'),
    canDeletePayrollPayments: can('payroll.deletePayments'),
    // Leads
    canViewLeads: can('leads.view'),
    canCreateLeads: can('leads.create'),
    canEditLeads: can('leads.edit'),
    canDeleteLeads: can('leads.delete'),
    // Reports
    canViewReports: can('reports.view'),
    canViewExpenseReports: can('reports.viewExpense'),
    canViewIncomeReports: can('reports.viewIncome'),
    canViewProfitLossReports: can('reports.viewProfitLoss'),
    canViewCustomerSalesReports: can('reports.viewCustomerSales'),
    canViewProductQuantityReports: can('reports.viewProductQuantity'),
    canViewUserActivityReports: can('reports.viewUserActivity'),
    canExportReports: can('reports.export'),
    // Marketing
    canViewMarketing: can('marketing.view'),
    canManageAds: can('marketing.manageAds'),
    canSyncAds: can('marketing.syncAds'),
    // Settings
    canViewSettings: can('settings.view'),
    canEditCompanySettings: can('settings.editCompany'),
    canEditOrderInvoiceSettings: can('settings.editOrderInvoice'),
    canEditDefaults: can('settings.editDefaults'),
    canEditWalletSettings: can('settings.editWallet'),
    canEditCourierSettings: can('settings.editCourier'),
    canEditCategories: can('settings.editCategories'),
    canEditPaymentMethods: can('settings.editPaymentMethods'),
    canManagePermissions: can('settings.managePermissions'),
    // Recycle Bin
    canRestoreRecords: can('recycleBin.restore'),
    canDeletePermanent: can('recycleBin.deletePermanent'),
    // Undoer
    canExecuteUndo: can('undoer.execute'),
    // Printing
    canPrintOrders: can('orders.print'),
    canPrintBills: can('bills.print'),
    // Wallet
    canViewAnyWallet: can('wallet.viewAny'),
    // Banking
    canViewAccountBalances: can('accounts.viewBalance'),
    canViewTransfers: can('transfers.view'),
    canCreateAccounts: can('accounts.create'),
    canEditAccounts: can('accounts.edit'),
    canDeleteAccounts: can('accounts.delete'),
    // Vendors
    canViewVendorBills: can('vendors.viewBills'),
    canCreateVendors: can('vendors.create'),
    canEditVendors: can('vendors.edit'),
    canDeleteVendors: can('vendors.delete'),
    // Fraud Checker
    canViewFraudHistory: can('fraudChecker.viewHistory'),
    // Subscriptions
    canViewSubscriptions: can('subscriptions.view'),
  };
}
