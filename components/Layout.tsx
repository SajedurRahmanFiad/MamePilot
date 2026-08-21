
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ICONS } from '../constants';
import { ArrowLeft, RotateCcw, ChevronLeft, ChevronDown } from 'lucide-react';
import { db } from '../db';
import { hasAdminAccess, isEmployeeRole } from '../types';
import { theme } from '../theme';
import { useAuth } from '../src/contexts/AuthProvider';
import { buildHistoryBackState } from '../src/utils/navigation';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { useSubscriptionReadOnly } from '../src/contexts/SubscriptionReadOnlyContext';
import { SidebarConfigItem, buildSidebarItems } from '../src/sidebarConfig';
import IncidentModeBanner from './IncidentModeBanner';
import { WRITE_FREEZE_ENABLED, WRITE_FREEZE_MESSAGE } from '../src/config/incidentMode';
import NotificationCenterButton from './NotificationCenterButton';
import ServiceAnnouncementBar from './ServiceAnnouncementBar';
import MameChat from './MameChat';
import { useAppBranding } from '../src/contexts/BrandingProvider';
import { CustomerCreateModal, VendorCreateModal } from './ContactCreateModal';

type SidebarConfigItemWithActive = SidebarConfigItem & {
  active: boolean;
  children?: SidebarConfigItemWithActive[];
};

interface SidebarItemProps {
  to?: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick?: () => void;
  children?: SidebarConfigItemWithActive[];
  expanded?: boolean;
  expandOnFocus?: boolean;
  onCollapsedGroupClick?: () => void;
}

const SidebarItem: React.FC<SidebarItemProps> = ({
  to,
  icon,
  label,
  active,
  onClick,
  children,
  expanded = true,
  expandOnFocus = false,
  onCollapsedGroupClick,
}) => {
  const [isOpen, setIsOpen] = useState(active);

  useEffect(() => {
    if (!expanded) {
      setIsOpen(false);
      return;
    }

    if (active || expandOnFocus) {
      setIsOpen(true);
    }
  }, [expanded, active, expandOnFocus]);

  const hasActiveChild = children?.some((c) => c.active) ?? false;
  const rowActive = active && !hasActiveChild;

  const iconNode = (
    <span className="flex items-center justify-center w-11 h-8 shrink-0">
      {active && !expanded ? (
        <span className={`flex items-center justify-center w-10 h-10 rounded-full ${theme.colors.primary[600]} text-white shadow-md`}>
          {icon}
        </span>
      ) : (
        <span className="flex items-center justify-center w-8 h-8 text-current">
          {icon}
        </span>
      )}
    </span>
  );

  const rowClasses = `flex items-center w-full h-11 px-1 ${theme.radius.md} ${theme.transitions.colors}`;
  const activeRowClasses = expanded ? `${theme.colors.primary[600]} text-white` : '';
  const idleRowClasses = 'text-gray-500 hover:bg-gray-100 hover:text-gray-900';
  const labelClasses = `text-sm font-medium whitespace-nowrap transition-all duration-300 ${
    expanded ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 pointer-events-none'
  }`;
  const rowMarkClasses = expanded ? (rowActive ? activeRowClasses : idleRowClasses) : idleRowClasses;

  if (children) {
    return (
      <div>
        <button
          type="button"
          title={expanded ? undefined : label}
          aria-expanded={isOpen}
          onClick={() => {
            if (!expanded) {
              onCollapsedGroupClick?.();
              return;
            }
            setIsOpen(!isOpen);
          }}
          className={`${rowClasses} ${rowMarkClasses}`}
        >
          {iconNode}
          <span className={`${labelClasses} overflow-hidden`}>{label}</span>
          <span className={`ml-auto transition-opacity duration-300 ${expanded ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <span className={`transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
              {ICONS.ChevronRight}
            </span>
          </span>
        </button>
        {isOpen && expanded && (
          <div className="pl-9 pb-1 space-y-0.5">
            {children.map((child) => (
              <Link
                key={child.key}
                to={child.to ?? '#'}
                onClick={onClick}
                className={`block px-3 py-2 text-sm font-medium ${theme.radius.sm} ${theme.transitions.colors} ${
                  child.active
                    ? `${theme.colors.primary[600]} text-white`
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                {child.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      to={to || '#'}
      onClick={onClick}
      title={expanded ? undefined : label}
      className={`${rowClasses} ${rowMarkClasses}`}
    >
      {iconNode}
      <span className={`${labelClasses} min-w-0 overflow-hidden`}>{label}</span>
    </Link>
  );
};

const Layout: React.FC<{ children: React.ReactNode; hideSidebar?: boolean }> = ({ children, hideSidebar = false }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, profile } = useAuth();
  const branding = useAppBranding();
  const whiteLabelEnabled = branding.mode === 'white-label';
  const { can, canViewAdminDashboard, canViewEmployeeDashboard } = useRolePermissions();
  const { hasCapability, hasSubCapability } = useCapabilities(Boolean(profile));
  const { isReadOnly, showReadOnlyWarning } = useSubscriptionReadOnly();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDockPinned, setIsDockPinned] = useState(false);
  const [isDockHovered, setIsDockHovered] = useState(false);
  const [focusedGroupKey, setFocusedGroupKey] = useState<string | null>(null);
  const [isPlusOpen, setIsPlusOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isCustomerCreateOpen, setIsCustomerCreateOpen] = useState(false);
  const [isVendorCreateOpen, setIsVendorCreateOpen] = useState(false);
  const closeSidebar = useCallback(() => {
    setIsSidebarOpen(false);
    setIsDockPinned(false);
    setFocusedGroupKey(null);
  }, []);
  const toggleDock = () => {
    if (isDockPinned) {
      closeSidebar();
    } else {
      setIsDockPinned(true);
    }
  };
  const isDockExpanded = isDockPinned || isDockHovered;
  const brandLoading = branding.mode === 'loading';
  const brandUnavailable = branding.mode === 'unavailable';
  const isWhatsAppPage = location.pathname.startsWith('/whatsapp');
  const isMessengerPage = location.pathname.startsWith('/messenger');
  const isConversationPage = isWhatsAppPage || isMessengerPage;
  const isPosPage = location.pathname === '/pos';

  // Use profile from Auth context if available, fallback to db.currentUser
  const user = profile || db.currentUser;

  // Reset main scroll position when route changes so each page starts at top
  React.useEffect(() => {
    // main is the scrollable container in this layout
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
    // also reset window scroll as a fallback
    try { window.scrollTo(0, 0); } catch (e) {}
  }, [location.pathname]);

  const pageHeader = useMemo(() => {
    const pathname = location.pathname;

    if (pathname.startsWith('/orders/new')) {
      return { title: 'New Order', subtitle: 'Create a new sales order and capture fulfillment details.' };
    }
    if (pathname.startsWith('/orders/edit/')) {
      return { title: 'Edit Order', subtitle: 'Update the selected order and keep its details current.' };
    }
    if (pathname.startsWith('/orders')) {
      return { title: 'Orders', subtitle: 'Track sales orders, fulfillment, and payment progress.' };
    }
    if (pathname.startsWith('/customers/new')) {
      return { title: 'New Customer', subtitle: 'Add a new customer profile and contact details.' };
    }
    if (pathname.startsWith('/customers/edit/')) {
      return { title: 'Edit Customer', subtitle: 'Update customer details and account information.' };
    }
    if (pathname.startsWith('/customers')) {
      return { title: 'Customers', subtitle: 'Review customer records, activity, and outstanding balances.' };
    }
    if (pathname.startsWith('/vendors/new')) {
      return { title: 'New Vendor', subtitle: 'Create a vendor record for purchase workflows.' };
    }
    if (pathname.startsWith('/vendors/edit/')) {
      return { title: 'Edit Vendor', subtitle: 'Update vendor information and account details.' };
    }
    if (pathname.startsWith('/vendors')) {
      return { title: 'Vendors', subtitle: 'Manage supplier accounts and purchasing relationships.' };
    }
    if (pathname.startsWith('/bills/new')) {
      return { title: 'New Bill', subtitle: 'Capture a new purchase bill and vendor details.' };
    }
    if (pathname.startsWith('/bills/edit/')) {
      return { title: 'Edit Bill', subtitle: 'Adjust bill information and payment status.' };
    }
    if (pathname.startsWith('/bills')) {
      return { title: 'Purchase Bills', subtitle: 'Track vendor bills, receipts, and payment progress.' };
    }
    if (pathname.startsWith('/transactions/new/')) {
      return { title: 'New Transaction', subtitle: 'Record a new income or expense transaction.' };
    }
    if (pathname.startsWith('/transactions/edit/')) {
      return { title: 'Edit Transaction', subtitle: 'Update the selected financial transaction.' };
    }
    if (pathname.startsWith('/transactions')) {
      return { title: 'Financial Transactions', subtitle: 'Monitor income, expenses, transfers, and approvals.' };
    }
    if (pathname.startsWith('/banking/accounts')) {
      return { title: 'Bank Accounts', subtitle: 'Review balances, account types, and cash positions.' };
    }
    if (pathname.startsWith('/banking/transactions')) {
      return { title: 'Transaction Ledger', subtitle: 'Track income, expenses, transfers, and approvals.' };
    }
    if (pathname.startsWith('/banking/transfer')) {
      return { title: 'Fund Transfer', subtitle: 'Move balances between your business accounts.' };
    }
    if (pathname.startsWith('/banking')) {
      return { title: 'Banking & Accounts', subtitle: 'Manage balances, accounts, and cash-flow records.' };
    }
    if (pathname.startsWith('/products/new')) {
      return { title: 'Add Product', subtitle: 'Create a product entry for inventory and sales.' };
    }
    if (pathname.startsWith('/products/edit/')) {
      return { title: 'Edit Product', subtitle: 'Update product details and pricing.' };
    }
    if (pathname.startsWith('/products')) {
      return { title: 'Products Catalog', subtitle: 'Manage inventory, pricing, and product details.' };
    }
    if (pathname.startsWith('/batches/new')) {
      return { title: 'New Batch', subtitle: 'Create a new batch of living products.' };
    }
    if (pathname.startsWith('/batches/edit/')) {
      return { title: 'Edit Batch', subtitle: 'Update the selected batch details.' };
    }
    if (pathname.startsWith('/batches')) {
      return { title: 'Batches', subtitle: 'Manage batches of living products with population tracking.' };
    }
    if (pathname.startsWith('/batch-event-history')) {
      return { title: 'Batch Event History', subtitle: 'Review all recorded events for living product batches.' };
    }
    if (pathname.startsWith('/users/new')) {
      return { title: 'Add User', subtitle: 'Create a new app user and assign access.' };
    }
    if (pathname.startsWith('/users/edit/')) {
      return { title: 'Edit User', subtitle: 'Adjust user access and company profile information.' };
    }
    if (pathname.startsWith('/users')) {
      return { title: 'Application Users', subtitle: 'Manage app users, roles, and permissions.' };
    }
    if (pathname.startsWith('/reports')) {
      return { title: 'Financial Reports', subtitle: 'Explore performance insights and business metrics.' };
    }
    if (pathname.startsWith('/settings')) {
      return { title: 'Settings', subtitle: 'Configure company defaults, integrations, and workflows.' };
    }
    if (pathname.startsWith('/developer/notifications')) {
      return { title: 'Developer Notifications', subtitle: 'Manage system notices and targeted rollout messages.' };
    }
    if (pathname.startsWith('/developer/subscriptions')) {
      return { title: 'Developer Subscriptions', subtitle: 'Review license tiers, usage, and capability overrides.' };
    }
    if (pathname.startsWith('/developer/settings')) {
      return { title: 'Developer Settings', subtitle: 'Control integrations, maintenance, and system behavior.' };
    }
    if (pathname.startsWith('/developer/webhooks')) {
      return { title: 'Webhook Events', subtitle: 'Review courier webhook deliveries and raw payloads.' };
    }
    if (pathname.startsWith('/developer')) {
      return { title: 'Developer Settings', subtitle: 'Control integrations, maintenance, and system behavior.' };
    }
    if (pathname.startsWith('/fraud-checker')) {
      return { title: 'Fraud Checker', subtitle: 'Verify courier history and suspicious phone activity.' };
    }
    if (pathname.startsWith('/recycle-bin')) {
      return { title: 'Recycle Bin', subtitle: 'Restore removed records and review deleted items.' };
    }
    if (pathname.startsWith('/undoer')) {
      return { title: 'Undoer', subtitle: 'Review and reverse order status operations safely.' };
    }
    if (pathname.startsWith('/wallet')) {
      return { title: 'Wallet', subtitle: 'Track employee wallet balance and activity.' };
    }
    if (pathname.startsWith('/payroll')) {
      return { title: 'Payroll', subtitle: 'Review payroll data and employee payouts.' };
    }
    if (pathname.startsWith('/human-resource-dashboard')) {
      return { title: 'HR Dashboard', subtitle: 'Review staffing coverage and people-focused insights.' };
    }
    if (pathname.startsWith('/social-media-ads') || pathname.startsWith('/meta-ads')) {
      return {
        title: 'Campaigns',
        subtitle: 'Manage campaigns and analyze details.',
      };
    }
    if (pathname.startsWith('/leads')) {
      return { title: 'Leads', subtitle: 'Track prospective customers and follow-up tasks.' };
    }
    if (pathname.startsWith('/subscriptions')) {
      return { title: 'Subscriptions', subtitle: 'Manage central subscriptions, licensing, and renewals.' };
    }
    if (pathname.startsWith('/notifications')) {
      return { title: 'Notifications', subtitle: 'Review and manage system notifications.' };
    }
    if (pathname.startsWith('/dashboard')) {
      return { title: 'Dashboard', subtitle: 'Snapshot of your core operations and recent activity.' };
    }
    if (pathname.startsWith('/auto-calling')) {
      return { title: 'Auto Calling', subtitle: 'Manage automatic voice surveys, broadcasts, and balance.' };
    }
    if (pathname.startsWith('/grow-your-business')) {
      return { title: 'Grow Your Business', subtitle: 'AI-powered recommendations to optimize your product portfolio and boost sales.' };
    }
    if (pathname.startsWith('/whatsapp')) {
      return { title: 'WhatsApp', subtitle: 'Chat with customers on WhatsApp.' };
    }
    if (pathname.startsWith('/messenger')) {
      return { title: 'Messenger', subtitle: 'Chat with customers on Messenger.' };
    }
    if (pathname === '/pos') {
      return { title: 'Point of Sale', subtitle: 'Walk-in sales, holds, and instant receipts.' };
    }
    if (pathname === '/pos-sales') {
      return { title: 'POS Sales', subtitle: 'Every sale completed at the point of sale.' };
    }

    return { title: 'Overview', subtitle: 'Manage your business workspace.' };
  }, [location.pathname]);

  // Safety check: if user is somehow null (shouldn't happen with route guards), show loading
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block p-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
          <p className="mt-4 text-gray-600 font-medium">Loading user data...</p>
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + '/');
  const canViewDashboard = (canViewAdminDashboard || canViewEmployeeDashboard) && hasCapability('dashboard');
  const isAdminAccessUser = hasAdminAccess(user.role);
  const isEmployeeUser = isEmployeeRole(user.role);
  const isDeveloper = user.role === 'Developer';

  const sidebarPermissionContext = useMemo(
    () => ({
      can,
      hasCapability,
      hasSubCapability,
      canViewDashboard,
      isAdminAccessUser,
      isEmployeeUser,
      isDeveloper,
    }),
    [can, hasCapability, hasSubCapability, canViewDashboard, isAdminAccessUser, isEmployeeUser, isDeveloper]
  );

  const sidebarItems = useMemo(() => {
    const items = buildSidebarItems(sidebarPermissionContext);

    const normalizeItem = (item: SidebarConfigItem): SidebarConfigItemWithActive => {
      const children = item.children?.map(normalizeItem) as SidebarConfigItemWithActive[] | undefined;
      const active = Boolean((item.to && isActive(item.to)) || children?.some((child) => child.active));
      return { ...item, active, children };
    };

    return items.map(normalizeItem);
  }, [sidebarPermissionContext, location.pathname]);

  const dividerIndex = sidebarItems.findIndex((item) =>
    item.key === 'subscriptions' || item.key === 'settings' || item.key === 'developer'
  );

  const quickActions = [
    can('orders.create') && hasCapability('sales') ? { label: 'New Order', to: '/orders/new', icon: ICONS.Sales } : null,
    can('bills.create') && hasCapability('purchases') ? { label: 'New Bill', to: '/bills/new', icon: ICONS.Briefcase } : null,
    can('customers.create') && hasCapability('sales') ? { label: 'New Customer', onClick: () => setIsCustomerCreateOpen(true), icon: ICONS.Customers } : null,
    can('vendors.create') && hasCapability('purchases') ? { label: 'New Vendor', onClick: () => setIsVendorCreateOpen(true), icon: ICONS.Vendors } : null,
    can('transactions.create') && hasCapability('banking') ? { label: 'Add Income', to: '/transactions/new/income', icon: ICONS.PlusCircle } : null,
    can('transactions.create') && hasCapability('banking') ? { label: 'Add Expense', to: '/transactions/new/expense', icon: ICONS.Delete } : null,
  ].filter(Boolean) as { label: string; to?: string; onClick?: () => void; icon: React.ReactNode }[];

  return (
    <div className={`${theme.colors.bg.secondary} flex overflow-hidden`} style={{ minHeight: '100vh' }}>
      <div
        className={`fixed inset-0 z-[45] bg-gray-900/40 backdrop-blur-sm transition-opacity duration-300 ease-in-out ${
          isSidebarOpen || isDockExpanded ? 'opacity-100' : 'opacity-0 invisible pointer-events-none'
        }`}
        onClick={closeSidebar}
      />

      {!hideSidebar && (
        <>
          <style>{`
            .sidebar-scrollbar-hidden {
              scrollbar-width: none;
              -ms-overflow-style: none;
            }
            .sidebar-scrollbar-hidden::-webkit-scrollbar {
              display: none;
              width: 0;
              height: 0;
            }
          `}</style>

          {/* Mobile drawer (< md) */}
          <aside className={`fixed inset-y-0 left-0 z-50 md:hidden w-72 ${theme.colors.bg.primary} border-r ${theme.colors.border.primary} transform overflow-hidden transition-transform duration-300 ${
            isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}>
            <div className="flex flex-col h-full">
              <div className="p-8 h-28">
                {brandLoading || brandUnavailable ? (
                  <div className="flex items-center h-full gap-3 justify-start" role="status" aria-label={brandLoading ? 'Loading workspace branding' : 'Workspace branding unavailable'}>
                    <div className={`h-10 w-10 rounded-full bg-gray-200 ${brandLoading ? 'animate-pulse' : ''}`} />
                    {brandLoading ? (
                      <div className="h-5 w-32 animate-pulse rounded bg-gray-200" />
                    ) : (
                      <span className={`text-sm font-semibold ${theme.colors.text.secondary}`}>Management</span>
                    )}
                  </div>
                ) : whiteLabelEnabled ? (
                  <div className="flex items-center h-full gap-3 justify-start">
                    <div className={`p-1 ${theme.colors.primary[50]} rounded-full bg-white`}>
                      {branding.logo ? (
                        <img
                          src={branding.logo}
                          alt={branding.name || 'Company logo'}
                          className="w-10 h-10 rounded-full object-cover"
                          onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gray-200" />
                      )}
                    </div>
                    <h1 className={`text-xl font-black ${theme.colors.text.primary} tracking-tight leading-none`}>
                      {branding.name || 'Management'}
                    </h1>
                  </div>
                ) : (
                  <div className="flex items-center h-full justify-start">
                    <img
                      src={branding.logo}
                      alt="Mame Pilot"
                      className="object-contain h-14 w-auto"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/uploads/Avatar.png'; }}
                    />
                  </div>
                )}
              </div>

              <nav className="sidebar-scrollbar-hidden flex-1 px-3 pb-8 overflow-y-auto">
                {sidebarItems.map((item, index) => (
                  <React.Fragment key={item.key}>
                    {index === dividerIndex && (
                      <>
                        <div className="h-4" />
                        <div className="mx-3 border-t-2 border-gray-200" />
                        <div className="h-3" />
                      </>
                    )}
                    <div className="py-0.5">
                      <SidebarItem
                        expanded
                        to={item.to}
                        icon={item.icon}
                        label={item.label}
                        active={item.active}
                        children={item.children}
                        onClick={() => setIsSidebarOpen(false)}
                      />
                    </div>
                  </React.Fragment>
                ))}
                <div className="h-6" />
              </nav>
            </div>
          </aside>

          {/* Desktop & tablet floating pill dock (>= md) */}
          <aside
            onMouseEnter={() => setIsDockHovered(true)}
            onMouseLeave={() => setIsDockHovered(false)}
            className={`hidden md:flex fixed left-4 top-8 bottom-8 z-50 flex-col bg-white border border-gray-100 rounded-[36px] shadow-xl shadow-gray-900/10 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
              isDockExpanded ? 'w-[288px]' : 'w-[76px]'
            }`}
            style={{ willChange: 'width' }}
          >
            <div className="flex flex-col h-full">
              <div className="px-3 pt-3 pb-6">
                <div className="flex items-center w-full h-11">
                  <button
                    type="button"
                    onClick={toggleDock}
                    title={isDockExpanded ? 'Collapse navigation' : 'Expand navigation'}
                    aria-expanded={isDockExpanded}
                    className={`flex items-center w-full h-11 ${theme.radius.md} ${theme.transitions.colors} hover:bg-gray-100 ${
                      isDockExpanded ? '' : 'justify-center'
                    }`}
                  >
                    {brandLoading || brandUnavailable ? (
                      <div className={`w-10 h-10 rounded-full bg-gray-200 shrink-0 ${brandLoading ? 'animate-pulse' : ''}`} />
                    ) : whiteLabelEnabled ? (
                      branding.logo ? (
                        <img
                          src={branding.logo}
                          alt={branding.name || 'Company logo'}
                          className="w-10 h-10 rounded-full object-cover shrink-0"
                          onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-gray-200 shrink-0" />
                      )
                    ) : (
                      <img
                        src={branding.compactLogo}
                        alt="Mame Pilot"
                        className="w-10 h-10 rounded-full object-cover shrink-0"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/uploads/Avatar.png'; }}
                      />
                    )}
                    {isDockExpanded && (
                      <span className={`ml-1 min-w-0 block text-base font-black ${theme.colors.text.primary} tracking-tight leading-none truncate`}>
                        {branding.name || (whiteLabelEnabled ? 'Management' : 'Mame Pilot')}
                      </span>
                    )}
                  </button>
                  {isDockExpanded && (
                    <button
                      type="button"
                      onClick={closeSidebar}
                      title="Collapse navigation"
                      className="shrink-0 ml-1 w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-900 transition-colors duration-200"
                    >
                      <ChevronLeft size={20} />
                    </button>
                  )}
                </div>
              </div>

              <nav className="sidebar-scrollbar-hidden flex-1 px-3 pb-6 overflow-y-auto">
                {sidebarItems.map((item, index) => {
                  if (dividerIndex >= 0 && index >= dividerIndex) return null;
                  return (
                    <React.Fragment key={item.key}>
                      <div className="py-0.5">
                        <SidebarItem
                          expanded={isDockExpanded}
                          to={item.to}
                          icon={item.icon}
                          label={item.label}
                          active={item.active}
                          children={item.children}
                          expandOnFocus={focusedGroupKey === item.key}
                          onCollapsedGroupClick={() => { setFocusedGroupKey(item.key); setIsDockPinned(true); }}
                        />
                      </div>
                    </React.Fragment>
                  );
                })}
              </nav>
              {dividerIndex >= 0 && (
                <div className="px-3 pb-6">
                  <div className="mx-3 mb-3 border-t-2 border-gray-200" />
                  {sidebarItems.slice(dividerIndex).map((item) => (
                    <div key={item.key} className="py-0.5">
                      <SidebarItem
                        expanded={isDockExpanded}
                        to={item.to}
                        icon={item.icon}
                        label={item.label}
                        active={item.active}
                        children={item.children}
                        expandOnFocus={focusedGroupKey === item.key}
                        onCollapsedGroupClick={() => { setFocusedGroupKey(item.key); setIsDockPinned(true); }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </>
      )}

      <div className={`flex-1 flex flex-col min-w-0 h-screen overflow-hidden ${!hideSidebar ? 'md:pl-28' : ''}`}>
        <ServiceAnnouncementBar />
        <header className={`flex-shrink-0 sticky top-0 z-40 px-6 h-20 flex items-center`}>
          <div className="flex-1 min-w-0 flex items-center">
            {!hideSidebar && (
              <button onClick={() => setIsSidebarOpen(true)} className={`md:hidden p-2.5 hover:${theme.colors.bg.tertiary} ${theme.radius.md} ${theme.colors.text.secondary} border ${theme.colors.border.primary}`}>
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
              </button>
            )}

            {isPosPage && (
              <button
                type="button"
                onClick={() => navigate(-1)}
                title="Back"
                className={`p-2.5 ${theme.colors.bg.tertiary} ${theme.radius.md} ${theme.colors.text.secondary} border ${theme.colors.border.primary} hover:${theme.colors.text.primary} ${theme.transitions.normal} shrink-0`}
              >
                <ArrowLeft size={18} />
              </button>
            )}

            <div className="ml-4 min-w-0 flex-1 overflow-hidden">
              <style>{`
                @keyframes headerMarquee {
                  0% { transform: translateX(0); }
                  100% { transform: translateX(-50%); }
                }
              `}</style>
              <div className="block sm:hidden overflow-hidden">
                <div>
                  <h1 className={`text-base font-black ${theme.colors.text.primary} tracking-tight truncate`}>
                    {pageHeader.title}
                  </h1>
                </div>
              </div>
              <div className="hidden sm:block min-w-0">
                <h1 className={`text-lg font-black ${theme.colors.text.primary} tracking-tight truncate`}>
                  {pageHeader.title}
                </h1>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 ml-auto">
            {can('orders.create') && hasCapability('pos') && (
              <Link
                to="/pos"
                title="Point of Sale"
                className={`${theme.colors.primary[600]} text-white h-10 px-3 xl:px-4 flex items-center gap-2 ${theme.radius.md} ${theme.transitions.normal} shadow-lg shadow-[#0f2f57]/20 active:scale-95 ${
                  isPosPage ? 'ring-2 ring-offset-2' : `hover:${theme.colors.primary[700]}`
                }`}
                style={isPosPage ? { boxShadow: `0 0 0 2px ${theme.colors.bg.primary}, 0 0 0 4px ${theme.colors.primary[600]}` } : undefined}
              >
                {ICONS.Pos}
                <span className="hidden lg:inline text-sm font-bold min-w-0 truncate">Point of Sale</span>
              </Link>
            )}
            <div className="relative">
              <button
                onClick={() => {
                  if (isReadOnly) {
                    showReadOnlyWarning();
                    return;
                  }
                  if (!WRITE_FREEZE_ENABLED && !isReadOnly && quickActions.length > 0) {
                    setIsPlusOpen(!isPlusOpen);
                  }
                }}
                disabled={WRITE_FREEZE_ENABLED || quickActions.length === 0}
                title={WRITE_FREEZE_ENABLED ? WRITE_FREEZE_MESSAGE : isReadOnly ? 'Subscribe to continue. The app is currently in read-only mode.' : quickActions.length === 0 ? 'No quick actions available for this role' : 'Quick actions'}
                className={`${theme.colors.primary[600]} text-white h-10 px-3 flex items-center gap-1.5 ${theme.radius.md} ${theme.transitions.normal} shadow-lg shadow-[#0f2f57]/20 active:scale-95 ${WRITE_FREEZE_ENABLED || isReadOnly || quickActions.length === 0 ? 'cursor-not-allowed opacity-50' : `hover:${theme.colors.primary[700]}`}`}
              >
                {ICONS.Plus}
                <ChevronDown size={14} />
              </button>
              {isPlusOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsPlusOpen(false)}></div>
                  <div className={`absolute right-0 mt-3 w-56 ${theme.colors.bg.primary} border ${theme.colors.border.primary} rounded-2xl shadow-2xl z-50 py-2 animate-in fade-in zoom-in slide-in-from-top-2 duration-200 origin-top-right`}>
                    <div className={`px-4 py-2 text-[10px] font-bold ${theme.colors.text.tertiary} uppercase tracking-widest border-b ${theme.colors.border.primary} mb-1`}>Quick Actions</div>
                      {quickActions.map((item) => item.to ? (
                        <Link key={item.label} to={item.to} onClick={() => setIsPlusOpen(false)} className={`flex items-center gap-3 px-4 py-3 text-sm font-bold ${theme.colors.text.primary} hover:${theme.colors.primary[50]} hover:${theme.colors.primary.text} ${theme.transitions.normal}`}>
                          <span className="opacity-70">{item.icon}</span>
                          {item.label}
                        </Link>
                      ) : (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => {
                            setIsPlusOpen(false);
                            item.onClick?.();
                          }}
                          className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-bold ${theme.colors.text.primary} hover:${theme.colors.primary[50]} hover:${theme.colors.primary.text} ${theme.transitions.normal}`}
                        >
                          <span className="opacity-70">{item.icon}</span>
                          {item.label}
                        </button>
                      ))}
                  </div>
                </>
              )}
            </div>

            <NotificationCenterButton />

            <div className="relative">
              <button 
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className={`flex items-center gap-3 pl-4 border-l ${theme.colors.border.primary} hover:opacity-70 ${theme.transitions.normal}`}
              >
                <div className="text-right hidden md:block">
                  <p className={`text-sm font-black ${theme.colors.text.primary} leading-none`}>{user.name}</p>
                  <p className={`text-[10px] font-bold ${theme.colors.primary.text} uppercase tracking-widest mt-1`}>{user.role}</p>
                </div>
                <img src={user.image || '/uploads/Empty_avatar.png'} alt="Profile" className="w-10 h-10 rounded-[50%] object-cover cursor-pointer" />
              </button>
              {isProfileOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsProfileOpen(false)}></div>
                  <div className={`absolute right-0 mt-3 w-48 ${theme.colors.bg.primary} border ${theme.colors.border.primary} rounded-xl shadow-2xl z-50 py-2 animate-in fade-in zoom-in slide-in-from-top-2 duration-200 origin-top-right`}>
                    <button
                      onClick={() => {
                        navigate(`/users/${user.id}`, { state: buildHistoryBackState(location) });
                        setIsProfileOpen(false);
                      }}
                      className={`flex items-center gap-3 w-full px-4 py-3 text-sm font-bold ${theme.colors.primary.text} hover:${theme.colors.primary[50]} ${theme.transitions.normal}`}
                    >
                      {ICONS.Users}
                      Profile
                    </button>
                    <button
                      onClick={() => {
                        handleLogout();
                        setIsProfileOpen(false);
                      }}
                      className={`flex items-center gap-3 w-full px-4 py-3 text-sm font-bold ${theme.colors.danger.text} hover:${theme.colors.danger[50]} ${theme.transitions.normal}`}
                    >
                      {ICONS.LogOut}
                      Logout
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className={`relative min-h-0 flex-1 animate-in fade-in duration-500 ${isConversationPage ? 'overflow-hidden p-0' : isPosPage ? 'overflow-y-auto p-0' : 'overflow-y-auto px-6 pt-3 pb-6 lg:px-10 lg:pt-4 lg:pb-10'}`}>
          {!isConversationPage && <IncidentModeBanner />}
          {children}
          {!isConversationPage && !isPosPage && <footer className={`mt-20 py-8 border-t ${theme.colors.border.primary} flex flex-col items-center gap-2`}>
            <p className={`text-sm font-medium text-center md:text-left ${theme.colors.text.secondary}`}>
              © {new Date().getFullYear()} Mame Studios
              <span className="mx-2">|</span>
              Version {import.meta.env.VITE_APP_VERSION || 'unknown'}
              <span className="mx-2">|</span>
              All rights reserved.
            </p>
            <p className={`text-[11px] font-bold uppercase tracking-widest text-center md:text-left ${theme.colors.text.secondary}`}>developed by <a href="https://facebook.com/mamestudios" target="_blank" rel="noopener noreferrer" className="hover:underline">Mame Studios</a></p>
          </footer>}
        </main>
        {hasCapability('enterprise_ai_agent') && !isConversationPage && !isPosPage && <MameChat />}
        {isCustomerCreateOpen && (
          <CustomerCreateModal isOpen onClose={() => setIsCustomerCreateOpen(false)} />
        )}
        {isVendorCreateOpen && (
          <VendorCreateModal isOpen onClose={() => setIsVendorCreateOpen(false)} />
        )}
      </div>
    </div>
  );
};

export default Layout;
