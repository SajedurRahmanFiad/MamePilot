import React from 'react';
import { ICONS } from '../constants';
import type { PermissionKey, AppCapabilityKey } from '../types';

export type SidebarPermissionContext = {
  can: (permission: PermissionKey) => boolean;
  hasCapability: (capability: AppCapabilityKey) => boolean;
  canViewDashboard: boolean;
  isAdminAccessUser: boolean;
  isDeveloper: boolean;
};

export interface SidebarConfigItem {
  key: string;
  label: string;
  to?: string;
  icon: React.ReactNode;
  children?: SidebarConfigItem[];
  visible?: (context: SidebarPermissionContext) => boolean;
}

const rawSidebarConfig: SidebarConfigItem[] = [
  {
    key: 'dashboard',
    label: 'Dashboard',
    to: '/dashboard',
    icon: ICONS.Dashboard,
    visible: ({ canViewDashboard }) => canViewDashboard,
  },
  {
    key: 'products',
    label: 'Products',
    to: '/products',
    icon: ICONS.Products,
    visible: ({ can, hasCapability }) => can('products.view') && hasCapability('inventory'),
  },
  {
    key: 'orders',
    label: 'Orders',
    to: '/orders',
    icon: ICONS.Sales,
    visible: ({ can, hasCapability }) => can('orders.view') && hasCapability('sales'),
  },
  {
    key: 'customer_relationship',
    label: 'Customer Relationship',
    icon: ICONS.Customers,
    children: [
      {
        key: 'leads',
        label: 'Leads',
        to: '/leads',
        icon: ICONS.Customers,
        visible: ({ can, hasCapability }) => can('customers.view') && hasCapability('sales') && hasCapability('automatic_leads'),
      },
      {
        key: 'customers',
        label: 'Customers',
        to: '/customers',
        icon: ICONS.Customers,
        visible: ({ can, hasCapability }) => can('customers.view') && hasCapability('sales'),
      },
      {
        key: 'fraud_checker',
        label: 'Fraud Checker',
        to: '/fraud-checker',
        icon: ICONS.FraudChecker,
        visible: ({ can, hasCapability }) => can('fraudChecker.check') && hasCapability('fraud_checker'),
      },
    ],
  },
  {
    key: 'wallet',
    label: 'Wallet',
    to: '/wallet',
    icon: ICONS.Payroll,
    visible: ({ can, hasCapability, isAdminAccessUser }) => !isAdminAccessUser && can('wallet.view') && hasCapability('human_resources'),
  },
  {
    key: 'purchases',
    label: 'Purchases',
    icon: ICONS.Briefcase,
    children: [
      {
        key: 'bills',
        label: 'Bills',
        to: '/bills',
        icon: ICONS.Briefcase,
        visible: ({ can, hasCapability }) => can('bills.view') && hasCapability('purchases'),
      },
      {
        key: 'vendors',
        label: 'Vendors',
        to: '/vendors',
        icon: ICONS.Vendors,
        visible: ({ can, hasCapability }) => can('vendors.view') && hasCapability('purchases'),
      },
    ],
  },
  {
    key: 'human_resources',
    label: 'Human Resource',
    icon: ICONS.Users,
    children: [
      {
        key: 'hr-dashboard',
        label: 'Dashboard',
        to: '/human-resource-dashboard',
        icon: ICONS.Dashboard,
        visible: ({ can, hasCapability }) => can('users.view') && hasCapability('human_resources'),
      },
      {
        key: 'users',
        label: 'Users',
        to: '/users',
        icon: ICONS.Users,
        visible: ({ can, hasCapability }) => can('users.view') && hasCapability('human_resources'),
      },
      {
        key: 'payroll',
        label: 'Payroll',
        to: '/payroll',
        icon: ICONS.Payroll,
        visible: ({ can, hasCapability }) => can('payroll.view') && hasCapability('human_resources'),
      },
    ],
  },
  {
    key: 'social_media_ads',
    label: 'Marketing',
    icon: ICONS.Bell,
    children: [
      {
        key: 'social_ads_dashboard',
        label: 'Dashboard',
        to: '/social-media-ads',
        icon: ICONS.Dashboard,
        visible: ({ canViewDashboard, hasCapability }) => canViewDashboard && hasCapability('marketing'),
      },
      {
        key: 'meta_ads',
        label: 'Meta Ads',
        to: '/meta-ads',
        icon: ICONS.Bell,
        visible: ({ hasCapability }) => hasCapability('marketing'),
      },
    ],
  },
  {
    key: 'banking',
    label: 'Banking',
    icon: ICONS.Banking,
    children: [
      {
        key: 'accounts',
        label: 'Accounts',
        to: '/banking/accounts',
        icon: ICONS.Banking,
        visible: ({ can, hasCapability }) => can('accounts.view') && hasCapability('banking'),
      },
      {
        key: 'transactions',
        label: 'Transactions',
        to: '/banking/transactions',
        icon: ICONS.Banking,
        visible: ({ can, hasCapability }) => can('transactions.view') && hasCapability('banking'),
      },
      {
        key: 'transfer',
        label: 'Transfer',
        to: '/banking/transfer',
        icon: ICONS.PlusCircle,
        visible: ({ can, hasCapability }) => can('transfers.create') && hasCapability('banking'),
      },
    ],
  },
  {
    key: 'reports',
    label: 'Reports',
    to: '/reports',
    icon: ICONS.Reports,
    visible: ({ can, hasCapability }) => can('reports.view') && hasCapability('advanced_reports'),
  },
  {
    key: 'recycle_bin',
    label: 'Recycle Bin',
    to: '/recycle-bin',
    icon: ICONS.RecycleBin,
    visible: ({ can, hasCapability }) => can('recycleBin.view') && hasCapability('recycle_bin_undoer'),
  },
  {
    key: 'undoer',
    label: 'Undoer',
    to: '/undoer',
    icon: ICONS.Undoer,
    visible: ({ can, hasCapability }) => can('undoer.view') && hasCapability('recycle_bin_undoer'),
  },
  {
    key: 'subscriptions',
    label: 'Subscriptions',
    to: '/subscriptions',
    icon: ICONS.Bell,
    visible: ({ isAdminAccessUser }) => isAdminAccessUser,
  },
  {
    key: 'settings',
    label: 'Settings',
    to: '/settings',
    icon: ICONS.Settings,
    visible: ({ isAdminAccessUser }) => isAdminAccessUser,
  },
  {
    key: 'developer',
    label: 'Developer-only',
    icon: ICONS.AlertCircle,
    visible: ({ isAdminAccessUser, isDeveloper }) => isAdminAccessUser && isDeveloper,
    children: [
      {
        key: 'developer_notifications',
        label: 'Notifications',
        to: '/developer/notifications',
        icon: ICONS.Bell,
        visible: () => true,
      },
      {
        key: 'developer_settings',
        label: 'Settings',
        to: '/developer/settings',
        icon: ICONS.Settings,
        visible: () => true,
      },
      {
        key: 'developer_subscriptions',
        label: 'Subscriptions',
        to: '/developer/subscriptions',
        icon: ICONS.Bell,
        visible: () => true,
      },
    ],
  },
];

const filterSidebarItems = (
  items: SidebarConfigItem[],
  context: SidebarPermissionContext
): SidebarConfigItem[] => {
  return items.reduce<SidebarConfigItem[]>((acc, item) => {
    if (item.children) {
      const filteredChildren = filterSidebarItems(item.children, context);
      if (filteredChildren.length > 0 && item.visible?.(context) !== false) {
        acc.push({ ...item, children: filteredChildren });
      }
      return acc;
    }

    if (item.visible?.(context) === false) {
      return acc;
    }

    acc.push(item);
    return acc;
  }, []);
};

export const buildSidebarItems = (context: SidebarPermissionContext) => {
  return filterSidebarItems(rawSidebarConfig, context);
};
