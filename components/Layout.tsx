
import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ICONS } from '../constants';
import { RotateCcw } from 'lucide-react';
import { db } from '../db';
import { hasAdminAccess } from '../types';
import { resolveThemeColorPalette, theme } from '../theme';
import { useAuth } from '../src/contexts/AuthProvider';
import { useCompanySettings, useSystemDefaults } from '../src/hooks/useQueries';
import { buildHistoryBackState } from '../src/utils/navigation';
import { getGlobalCompanyPage, normalizeCompanySettings } from '../src/utils/companyPages';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { useSubscriptionReadOnly } from '../src/contexts/SubscriptionReadOnlyContext';
import { SidebarConfigItem, buildSidebarItems } from '../src/sidebarConfig';
import IncidentModeBanner from './IncidentModeBanner';
import { WRITE_FREEZE_ENABLED, WRITE_FREEZE_MESSAGE } from '../src/config/incidentMode';
import NotificationCenterButton from './NotificationCenterButton';
import ServiceAnnouncementBar from './ServiceAnnouncementBar';
import MameChat from './MameChat';

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
}

const SidebarItem: React.FC<SidebarItemProps> = ({ to, icon, label, active, onClick, children, expanded = true }) => {
  const [isOpen, setIsOpen] = useState(active);

  useEffect(() => {
    if (!expanded) {
      setIsOpen(false);
      return;
    }

    if (active) {
      setIsOpen(true);
    }
  }, [expanded, active]);

  const iconNode = (
    <span className="flex items-center justify-center w-8 h-8 text-current">
      {icon}
    </span>
  );

  if (children) {
    const activeCollapsedClasses = `${theme.colors.primary[600]} text-white shadow-lg shadow-emerald-200/50`;
    const activeExpandedClasses = `${theme.colors.primary[50]} ${theme.colors.primary.text}`;
    return (
      <div className="space-y-1">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center ${expanded ? 'justify-between' : 'justify-center'} w-full h-11 px-3 ${theme.radius.md} ${theme.transitions.colors} ${
            active 
              ? expanded
                ? activeExpandedClasses
                : activeCollapsedClasses
              : `text-gray-500 hover:${theme.colors.primary[50]} hover:${theme.colors.primary.text}`
          }`}
        >
          <div className={`flex items-center ${expanded ? 'gap-3' : ''}`}>
            {iconNode}
            <span className={`font-semibold text-sm ${expanded ? 'block text-left' : 'hidden'} leading-none`}>{label}</span>
          </div>
          {expanded && (
            <div className={`transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
              {ICONS.ChevronRight}
            </div>
          )}
        </button>
        {isOpen && expanded && (
          <div className="pl-11 space-y-1">
            {children.map((child) => (
              <Link
                key={child.key}
                to={child.to ?? '#'}
                onClick={onClick}
                className={`block px-4 py-2 text-sm font-medium ${theme.radius.sm} ${theme.transitions.colors} ${
                  child.active 
                    ? `${theme.colors.primary[600]} text-white` 
                    : `text-gray-400 hover:${theme.colors.primary.text} hover:${theme.colors.primary[50]}/30`
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
      className={`flex items-center ${expanded ? 'justify-start gap-3' : 'justify-center'} w-full h-11 px-3 ${theme.radius.md} ${theme.transitions.colors} ${
        active 
          ? `${theme.colors.primary[600]} text-white shadow-lg shadow-emerald-200/50` 
          : `text-gray-500 hover:${theme.colors.primary[50]} hover:${theme.colors.primary.text}`
      }`}
    >
      {iconNode}
      <span className={`font-semibold text-sm ${expanded ? 'block' : 'hidden'} leading-none`}>{label}</span>
    </Link>
  );
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, profile } = useAuth();
  const { data: fetchedCompanySettings, isLoading: isCompanySettingsLoading } = useCompanySettings();
  const { data: systemDefaults, isLoading: isSystemDefaultsLoading } = useSystemDefaults();
  const { can, canViewAdminDashboard, canViewEmployeeDashboard } = useRolePermissions();
  const { hasCapability, hasSubCapability } = useCapabilities(Boolean(profile));
  const { isReadOnly, showReadOnlyWarning } = useSubscriptionReadOnly();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [isPlusOpen, setIsPlusOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const whiteLabelEnabled = Boolean(systemDefaults?.whiteLabel);
  const isSidebarExpanded = isSidebarOpen || isSidebarHovered;
  const sidebarWidth = isSidebarOpen || isSidebarExpanded ? 288 : 80;
  const sidebarTransitionStyle = {
    width: sidebarWidth,
    minWidth: 80,
    transition: 'width 220ms ease-in-out',
    willChange: 'width',
  };
  const brandLoading = isSystemDefaultsLoading || (whiteLabelEnabled && isCompanySettingsLoading);

  const companySettings = useMemo(() => {
    if (isSystemDefaultsLoading) {
      return {
        name: 'Loading...',
        logo: '',
      };
    }

    if (!whiteLabelEnabled) {
      return {
        name: 'Mame Pilot',
        logo: '/uploads/Full Branding.png',
      };
    }

    if (isCompanySettingsLoading) {
      return {
        name: 'Loading...',
        logo: '',
      };
    }

    const normalizedCompany = normalizeCompanySettings(fetchedCompanySettings || db.settings.company);
    const globalPage = getGlobalCompanyPage(normalizedCompany);

    return {
      name: globalPage?.name || db.settings.company.name,
      logo: globalPage?.logo || db.settings.company.logo || '/uploads/Avatar.png',
    };
  }, [fetchedCompanySettings, whiteLabelEnabled, isCompanySettingsLoading, isSystemDefaultsLoading]);
  
  // Use profile from Auth context if available, fallback to db.currentUser
  const user = profile || db.currentUser;

  useEffect(() => {
    const pageTitle = companySettings.name?.trim() || 'Management';
    document.title = `${pageTitle} - Management`;
  }, [companySettings.name]);

  useEffect(() => {
    if (!systemDefaults?.themeColor) return;

    const { primary, medium, dark, soft } = resolveThemeColorPalette(systemDefaults.themeColor);
    const root = document.documentElement;

    root.style.setProperty('--primary-color', primary);
    root.style.setProperty('--primary-medium', medium);
    root.style.setProperty('--primary-dark', dark);
    root.style.setProperty('--primary-soft', soft);
  }, [systemDefaults?.themeColor]);

  // Update favicon links when company logo becomes available
  useEffect(() => {
    const faviconUrl = (whiteLabelEnabled ? companySettings.logo : '') || '/uploads/Avatar.png';
    try {
      const setLink = (rel: string) => {
        let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
        if (!el) {
          el = document.createElement('link');
          el.rel = rel;
          document.head.appendChild(el);
        }
        el.href = faviconUrl;
      };

      setLink('icon');
      setLink('shortcut icon');
      setLink('apple-touch-icon');
    } catch (e) {
      console.error('Failed to set favicon:', e);
    }
  }, [companySettings.logo]);

  const avatarBackgroundColor = useMemo(() => {
    if (!systemDefaults?.themeColor) return '0f2f57';
    return resolveThemeColorPalette(systemDefaults.themeColor).primary.replace('#', '');
  }, [systemDefaults?.themeColor]);

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
    if (pathname.startsWith('/developer')) {
      return { title: 'Developer Settings', subtitle: 'Control integrations, maintenance, and system behavior.' };
    }
    if (pathname.startsWith('/fraud-checker')) {
      return { title: 'Fraud Checker', subtitle: 'Verify courier history and suspicious phone activity.' };
    }
    if (pathname.startsWith('/recycle-bin')) {
      return { title: 'Recycle Bin', subtitle: 'Restore removed records and review deleted items.' };
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
  const isDeveloper = user.role === 'Developer';

  const sidebarPermissionContext = useMemo(
    () => ({
      can,
      hasCapability,
      hasSubCapability,
      canViewDashboard,
      isAdminAccessUser,
      isDeveloper,
    }),
    [can, hasCapability, hasSubCapability, canViewDashboard, isAdminAccessUser, isDeveloper]
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

  const quickActions = [
    can('orders.create') && hasCapability('sales') ? { label: 'New Order', to: '/orders/new', icon: ICONS.Sales } : null,
    can('bills.create') && hasCapability('purchases') ? { label: 'New Bill', to: '/bills/new', icon: ICONS.Briefcase } : null,
    can('customers.create') && hasCapability('sales') ? { label: 'New Customer', to: '/customers/new', icon: ICONS.Customers } : null,
    can('vendors.create') && hasCapability('purchases') ? { label: 'New Vendor', to: '/vendors/new', icon: ICONS.Vendors } : null,
    can('transactions.create') && hasCapability('banking') ? { label: 'Add Income', to: '/transactions/new/income', icon: ICONS.PlusCircle } : null,
    can('transactions.create') && hasCapability('banking') ? { label: 'Add Expense', to: '/transactions/new/expense', icon: ICONS.Delete } : null,
  ].filter(Boolean) as { label: string; to: string; icon: React.ReactNode }[];

  return (
    <div className={`${theme.colors.bg.secondary} flex overflow-hidden`} style={{ minHeight: '100vh' }}>
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside 
        onMouseEnter={() => setIsSidebarHovered(true)}
        onMouseLeave={() => setIsSidebarHovered(false)}
        className={`fixed inset-y-0 left-0 z-50 ${theme.colors.bg.primary} border-r ${theme.colors.border.primary} transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } overflow-hidden`}
        style={sidebarTransitionStyle}
      >
        <div className="flex flex-col h-full">
          <div className={isSidebarExpanded ? 'p-8 h-28' : 'px-3 py-4 h-28'}>
            <div className={`flex items-center h-full ${isSidebarExpanded ? 'gap-3 justify-start' : 'justify-center'}`}>
            {whiteLabelEnabled ? (
              <>
                <div className={`p-1 ${theme.colors.primary[50]} rounded-full bg-white ${isSidebarExpanded ? '' : 'mx-auto'}`}>
                  {companySettings.logo ? (
                    <img
                      src={companySettings.logo}
                      alt={companySettings.name || 'Mame Pilot'}
                      className="w-10 h-10 rounded-full object-cover"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/uploads/Avatar.png'; }}
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-200" />
                  )}
                </div>

                {isSidebarExpanded && (
                  <div>
                    <h1 className={`text-xl font-black ${theme.colors.text.primary} tracking-tight leading-none`}>
                      {brandLoading ? 'Loading...' : companySettings.name || 'Mame Pilot'}
                    </h1>
                    <span className={`text-[10px] font-bold uppercase tracking-widest`}>Business Management</span>
                  </div>
                )}
              </>
            ) : (
              <div className={`flex items-center ${isSidebarExpanded ? 'justify-start' : 'justify-center'}`}>
                <img
                  src={isSidebarExpanded ? '/uploads/Full Branding.png' : '/uploads/Avatar.png'}
                  alt="Mame Pilot"
                  className={`object-contain ${isSidebarExpanded ? 'h-14 w-auto' : 'h-10 w-10 rounded-full'}`}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/uploads/Avatar.png'; }}
                />
              </div>
            )}
          </div>
          </div>

          <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
            {sidebarItems.map((item) => (
            <SidebarItem
              key={item.key}
              expanded={isSidebarExpanded}
              to={item.to}
              icon={item.icon}
              label={item.label}
              active={item.active}
              children={item.children}
              onClick={() => setIsSidebarOpen(false)}
            />
          ))}
          </nav>


        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <ServiceAnnouncementBar />
        <header className={`flex-shrink-0 sticky top-0 z-40 ${theme.colors.bg.primary}/80 backdrop-blur-lg border-b ${theme.colors.border.primary} px-6 h-20 flex items-center`}>
          <div className="flex-1 min-w-0 flex items-center">
            <button onClick={() => setIsSidebarOpen(true)} className={`lg:hidden p-2.5 hover:${theme.colors.bg.tertiary} ${theme.radius.md} ${theme.colors.text.secondary} border ${theme.colors.border.primary}`}>
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7"></path></svg>
            </button>

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
                <p className={`text-sm ${theme.colors.text.secondary} truncate`}>
                  {pageHeader.subtitle}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 ml-auto">
            <NotificationCenterButton />
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
                className={`${theme.colors.primary[600]} text-white w-10 h-10 flex items-center justify-center ${theme.radius.md} ${theme.transitions.normal} shadow-lg shadow-[#0f2f57]/20 active:scale-95 ${WRITE_FREEZE_ENABLED || isReadOnly || quickActions.length === 0 ? 'cursor-not-allowed opacity-50' : `hover:${theme.colors.primary[700]}`}`}
              >
                {ICONS.Plus}
              </button>
              {isPlusOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsPlusOpen(false)}></div>
                  <div className={`absolute right-0 mt-3 w-56 ${theme.colors.bg.primary} border ${theme.colors.border.primary} rounded-2xl shadow-2xl z-50 py-2 animate-in fade-in zoom-in slide-in-from-top-2 duration-200 origin-top-right`}>
                    <div className={`px-4 py-2 text-[10px] font-bold ${theme.colors.text.tertiary} uppercase tracking-widest border-b ${theme.colors.border.primary} mb-1`}>Quick Actions</div>
                      {quickActions.map((item) => (
                        <Link key={item.label} to={item.to} onClick={() => setIsPlusOpen(false)} className={`flex items-center gap-3 px-4 py-3 text-sm font-bold ${theme.colors.text.primary} hover:${theme.colors.primary[50]} hover:${theme.colors.primary.text} ${theme.transitions.normal}`}>
                          <span className="opacity-70">{item.icon}</span>
                          {item.label}
                        </Link>
                      ))}
                  </div>
                </>
              )}
            </div>

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

        <main className="flex-1 overflow-y-auto p-6 lg:p-10 animate-in fade-in duration-500 relative">
          <IncidentModeBanner />
          {children}
          <footer className={`mt-20 py-8 border-t ${theme.colors.border.primary} flex flex-col items-center gap-2`}>
            <p className={`text-sm font-medium text-center md:text-left ${theme.colors.text.secondary}`}>
              © {new Date().getFullYear()} {companySettings.name || 'Mame Pilot'}
              <span className="mx-2">|</span>
              Version {import.meta.env.VITE_APP_VERSION || 'unknown'}
              <span className="mx-2">|</span>
              All rights reserved.
            </p>
            <p className={`text-[11px] font-bold uppercase tracking-widest text-center md:text-left ${theme.colors.text.secondary}`}>developed by Mame Studio</p>
          </footer>
        </main>
        {hasCapability('enterprise_ai_agent') && <MameChat />}
      </div>
    </div>
  );
};

export default Layout;
