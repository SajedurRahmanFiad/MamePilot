import React from 'react';
import { ICONS } from '../constants';
import type { PermissionKey, AppCapabilityKey, SubCapabilityKey } from '../types';

export type SidebarPermissionContext = {
  can: (permission: PermissionKey) => boolean;
  hasCapability: (capability: AppCapabilityKey) => boolean;
  hasSubCapability: (capability: SubCapabilityKey) => boolean;
  canViewDashboard: boolean;
  isAdminAccessUser: boolean;
  isEmployeeUser: boolean;
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
        visible: ({ can, hasCapability }) => can('leads.view') && hasCapability('sales') && hasCapability('automatic_leads'),
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
      {
        key: 'whatsapp',
        label: 'WhatsApp',
        to: '/whatsapp',
        icon: ICONS.WhatsApp,
        visible: ({ hasCapability }) => hasCapability('whatsapp'),
      },
      {
        key: 'messenger',
        label: 'Messenger',
        to: '/messenger',
        icon: ICONS.Messenger,
        visible: ({ hasCapability }) => hasCapability('messenger'),
      },
      {
        key: 'auto_calling',
        label: 'Auto Calling',
        to: '/auto-calling',
        icon: ICONS.Bell,
        visible: ({ can, hasCapability }) => can('orders.view') && hasCapability('auto_calling'),
      },
    ],
  },
  {
    key: 'wallet',
    label: 'Wallet',
    to: '/wallet',
    icon: ICONS.Payroll,
    visible: ({ can, hasSubCapability, isEmployeeUser }) => isEmployeeUser && can('wallet.view') && hasSubCapability('payroll'),
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
        visible: ({ can, hasSubCapability }) => can('users.view') && hasSubCapability('hr_management'),
      },
      {
        key: 'users',
        label: 'Users',
        to: '/users',
        icon: ICONS.Users,
        visible: ({ can, hasSubCapability }) => can('users.view') && hasSubCapability('hr_management'),
      },
      {
        key: 'payroll',
        label: 'Payroll',
        to: '/payroll',
        icon: ICONS.Payroll,
        visible: ({ can, hasSubCapability }) => can('payroll.view') && hasSubCapability('payroll'),
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
        visible: ({ can, canViewDashboard, hasCapability }) => can('marketing.view') && canViewDashboard && hasCapability('marketing'),
      },
      {
        key: 'meta_ads',
        label: 'Meta Ads',
        to: '/meta-ads',
        icon: ICONS.Bell,
        visible: ({ can, hasCapability }) => can('marketing.view') && hasCapability('marketing'),
      },
    ],
  },
  {
    key: 'grow_your_business',
    label: 'Grow your business',
    to: '/grow-your-business',
    icon: ICONS.TrendingUp,
    visible: ({ hasCapability }) => hasCapability('grow_your_business'),
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
        visible: ({ can, hasSubCapability }) => can('accounts.view') && hasSubCapability('accounts'),
      },
      {
        key: 'transactions',
        label: 'Transactions',
        to: '/banking/transactions',
        icon: ICONS.Banking,
        visible: ({ can, hasSubCapability }) => can('transactions.view') && hasSubCapability('transactions'),
      },
      {
        key: 'transfer',
        label: 'Transfer',
        to: '/banking/transfer',
        icon: ICONS.PlusCircle,
        visible: ({ can, hasSubCapability }) => can('transfers.create') && hasSubCapability('transfer'),
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
    visible: ({ can, hasSubCapability }) => can('recycleBin.view') && hasSubCapability('recycle_bin'),
  },
  {
    key: 'undoer',
    label: 'Undoer',
    to: '/undoer',
    icon: ICONS.Undoer,
    visible: ({ can, hasSubCapability }) => can('undoer.view') && hasSubCapability('undoer'),
  },
  {
    key: 'subscriptions',
    label: 'Subscriptions',
    to: '/subscriptions',
    icon: ICONS.Bell,
    visible: ({ can }) => can('subscriptions.view'),
  },
  {
    key: 'settings',
    label: 'Settings',
    to: '/settings',
    icon: ICONS.Settings,
    visible: ({ can }) => can('settings.view'),
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
        key: 'developer_notes',
        label: 'Notes',
        to: '/developer/notes',
        icon: ICONS.Edit,
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
