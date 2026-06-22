
import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ICONS } from '../constants';
import { RotateCcw } from 'lucide-react';
import { db } from '../db';
import { hasAdminAccess } from '../types';
import { theme } from '../theme';
import { useAuth } from '../src/contexts/AuthProvider';
import { useSearch } from '../src/contexts/SearchContext';
import { useCompanySettings, useOrderSearchPreview, useSystemDefaults } from '../src/hooks/useQueries';
import { buildHistoryBackState } from '../src/utils/navigation';
import { getGlobalCompanyPage, normalizeCompanySettings } from '../src/utils/companyPages';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useCapabilities } from '../src/hooks/useCapabilities';
import IncidentModeBanner from './IncidentModeBanner';
import { WRITE_FREEZE_ENABLED, WRITE_FREEZE_MESSAGE } from '../src/config/incidentMode';
import NotificationCenterButton from './NotificationCenterButton';
import ServiceAnnouncementBar from './ServiceAnnouncementBar';
import MameChat from './MameChat';

interface SidebarItemProps {
  to?: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick?: () => void;
  children?: { to: string; label: string; active: boolean }[];
}

const SidebarItem: React.FC<SidebarItemProps> = ({ to, icon, label, active, onClick, children }) => {
  const [isOpen, setIsOpen] = useState(active);

  if (children) {
    return (
      <div className="space-y-1">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center justify-between w-full px-4 py-3 ${theme.radius.md} ${theme.transitions.normal} ${
            active 
              ? `${theme.colors.primary[50]} ${theme.colors.primary.text}` 
              : `text-gray-500 hover:${theme.colors.primary[50]} hover:${theme.colors.primary.text}`
          }`}
        >
          <div className="flex items-center gap-3">
            {icon}
            <span className="font-semibold text-sm">{label}</span>
          </div>
          <div className={`transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
            {ICONS.ChevronRight}
          </div>
        </button>
        {isOpen && (
          <div className="pl-11 space-y-1">
            {children.map((child) => (
              <Link
                key={child.to}
                to={child.to}
                onClick={onClick}
                className={`block px-4 py-2 text-sm font-medium ${theme.radius.sm} ${theme.transitions.normal} ${
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
      className={`flex items-center gap-3 px-4 py-3 ${theme.radius.md} ${theme.transitions.normal} ${
        active 
          ? `${theme.colors.primary[600]} text-white shadow-lg shadow-emerald-200/50` 
          : `text-gray-500 hover:${theme.colors.primary[50]} hover:${theme.colors.primary.text}`
      }`}
    >
      {icon}
      <span className="font-semibold text-sm">{label}</span>
    </Link>
  );
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut, profile } = useAuth();
  const { searchQuery, setSearchQuery, clearSearch } = useSearch();
  const { data: fetchedCompanySettings, isLoading: isCompanySettingsLoading } = useCompanySettings();
  const { data: systemDefaults, isLoading: isSystemDefaultsLoading } = useSystemDefaults();
  const { can, canViewAdminDashboard, canViewEmployeeDashboard } = useRolePermissions();
  const { hasCapability } = useCapabilities(Boolean(profile));
  const deferredSearchQuery = useDeferredValue(searchQuery.trim());
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isPlusOpen, setIsPlusOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const whiteLabelEnabled = Boolean(systemDefaults?.whiteLabel);
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
      logo: globalPage?.logo || db.settings.company.logo,
    };
  }, [fetchedCompanySettings, whiteLabelEnabled, isCompanySettingsLoading, isSystemDefaultsLoading]);
  
  // Use profile from Auth context if available, fallback to db.currentUser
  const user = profile || db.currentUser;

  useEffect(() => {
    const pageTitle = companySettings.name?.trim() || 'Management';
    document.title = `${pageTitle} - Management`;
  }, [companySettings.name]);

  // Update favicon links when company logo becomes available
  useEffect(() => {
    const faviconUrl = whiteLabelEnabled ? companySettings.logo : '/uploads/Avatar.png';
    if (!faviconUrl) return;
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

  // Reset main scroll position when route changes so each page starts at top
  React.useEffect(() => {
    // main is the scrollable container in this layout
    const main = document.querySelector('main');
    if (main) main.scrollTop = 0;
    // also reset window scroll as a fallback
    try { window.scrollTo(0, 0); } catch (e) {}
  }, [location.pathname]);

  // clear search text any time we change pages, also compute placeholder/visibility
  const getSearchConfig = (pathname: string) => {
    // note: ordering matters for prefix checks
    if (pathname.startsWith('/dashboard') || pathname.startsWith('/orders')) {
      return { visible: true, placeholder: 'Search Orders' };
    }
    if (pathname.startsWith('/customers')) {
      return { visible: true, placeholder: 'Search Customers' };
    }
    if (pathname.startsWith('/vendors')) {
      return { visible: true, placeholder: 'Search Vendors' };
    }
    if (pathname.startsWith('/bills')) {
      return { visible: true, placeholder: 'Search Bills' };
    }
    if (pathname.startsWith('/banking/accounts')) {
      return { visible: true, placeholder: 'Search Accounts' };
    }
    if (pathname.startsWith('/banking/transactions')) {
      return { visible: true, placeholder: 'Search Transactions' };
    }
    if (pathname.startsWith('/products')) {
      return { visible: true, placeholder: 'Search Products' };
    }
    if (pathname.startsWith('/users')) {
      return { visible: true, placeholder: 'Search Users' };
    }
    // fallback: hide
    return { visible: false, placeholder: '' };
  };

  const { visible: showSearch, placeholder: searchPlaceholder } = getSearchConfig(location.pathname);

  useEffect(() => {
    clearSearch();
  }, [location.pathname]);

  const { data: dashboardResults = [] } = useOrderSearchPreview(deferredSearchQuery, 10, {
    enabled: location.pathname.startsWith('/dashboard'),
  });

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
  const canViewWalletInSidebar = !isAdminAccessUser && can('wallet.view') && hasCapability('human_resources');
  const salesChildren = [
    can('orders.view') && hasCapability('sales') ? { to: '/orders', label: 'Orders', active: isActive('/orders') } : null,
    can('customers.view') && hasCapability('sales') ? { to: '/customers', label: 'Customers', active: isActive('/customers') } : null,
  ].filter(Boolean) as { to: string; label: string; active: boolean }[];
  const purchasesChildren = [
    can('bills.view') && hasCapability('purchases') ? { to: '/bills', label: 'Bills', active: isActive('/bills') } : null,
    can('vendors.view') && hasCapability('purchases') ? { to: '/vendors', label: 'Vendors', active: isActive('/vendors') } : null,
  ].filter(Boolean) as { to: string; label: string; active: boolean }[];
  const bankingChildren = [
    can('accounts.view') && hasCapability('banking') ? { to: '/banking/accounts', label: 'Accounts', active: isActive('/banking/accounts') } : null,
    can('transactions.view') && hasCapability('banking') ? { to: '/banking/transactions', label: 'Transactions', active: isActive('/banking/transactions') } : null,
    can('transfers.create') && hasCapability('banking') ? { to: '/banking/transfer', label: 'Transfer', active: isActive('/banking/transfer') } : null,
  ].filter(Boolean) as { to: string; label: string; active: boolean }[];
  const hrChildren = [
    can('users.view') && hasCapability('human_resources') ? { to: '/users', label: 'Users', active: isActive('/users') } : null,
    can('payroll.view') && hasCapability('human_resources') ? { to: '/payroll', label: 'Payroll', active: isActive('/payroll') } : null,
  ].filter(Boolean) as { to: string; label: string; active: boolean }[];
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
        className={`fixed inset-y-0 left-0 z-50 w-72 ${theme.colors.bg.primary} border-r ${theme.colors.border.primary} ${theme.transitions.normal} transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          <div className="p-8">
            <div className="flex items-center gap-3">
            {whiteLabelEnabled ? (
              <>
                <div className={`p-1 ${theme.colors.primary[50]} rounded-full bg-white`}>
                  {companySettings.logo ? (
                    <img
                      src={companySettings.logo}
                      alt={companySettings.name || 'Mame Pilot'}
                      className="w-10 h-10 object-contain"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-200" />
                  )}
                </div>
                <div>
                  <h1 className={`text-xl font-black ${theme.colors.text.primary} tracking-tight leading-none`}>
                    {brandLoading ? 'Loading...' : companySettings.name || 'Mame Pilot'}
                  </h1>
                  <span className={`text-[10px] font-bold uppercase tracking-widest`}>Business Management</span>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-start">
                <img
                  src="/uploads/Full Branding.png"
                  alt="Mame Pilot"
                  className="h-16 object-contain"
                />
              </div>
            )}
          </div>
          </div>

          <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
            {canViewDashboard && (
              <SidebarItem to="/dashboard" icon={ICONS.Dashboard} label="Dashboard" active={isActive('/dashboard')} onClick={() => setIsSidebarOpen(false)} />
            )}
            
            {can('products.view') && hasCapability('inventory') && (
              <SidebarItem to="/products" icon={ICONS.Products} label="Products" active={isActive('/products')} onClick={() => setIsSidebarOpen(false)} />
            )}

            {salesChildren.length > 0 && (
              <SidebarItem 
                icon={ICONS.Sales} 
                label="Sales" 
                active={isActive('/orders') || isActive('/customers')} 
                children={salesChildren}
                onClick={() => setIsSidebarOpen(false)}
              />
            )}

            {canViewWalletInSidebar && (
              <SidebarItem to="/wallet" icon={ICONS.Payroll} label="Wallet" active={isActive('/wallet')} onClick={() => setIsSidebarOpen(false)} />
            )}

            {purchasesChildren.length > 0 && (
              <SidebarItem 
                icon={ICONS.Briefcase} 
                label="Purchases" 
                active={isActive('/bills') || isActive('/vendors')} 
                children={purchasesChildren}
                onClick={() => setIsSidebarOpen(false)}
              />
            )}

            {hrChildren.length > 0 && (
              <SidebarItem
                icon={ICONS.Users}
                label="Human Resource"
                active={isActive('/users') || isActive('/payroll')}
                children={hrChildren}
                onClick={() => setIsSidebarOpen(false)}
              />
            )}

            {bankingChildren.length > 0 && (
              <SidebarItem 
                icon={ICONS.Banking} 
                label="Banking" 
                active={isActive('/banking')} 
                children={bankingChildren}
                onClick={() => setIsSidebarOpen(false)}
              />
            )}

            {can('fraudChecker.check') && hasCapability('fraud_checker') && (
              <SidebarItem to="/fraud-checker" icon={ICONS.FraudChecker} label="Fraud Checker" active={isActive('/fraud-checker')} onClick={() => setIsSidebarOpen(false)} />
            )}

            {((can('reports.view') && hasCapability('advanced_reports')) || (can('recycleBin.view') && hasCapability('recycle_bin_undoer')) || (can('undoer.view') && hasCapability('recycle_bin_undoer')) || isAdminAccessUser) && (
              <>
                {can('reports.view') && hasCapability('advanced_reports') && (
                  <SidebarItem to="/reports" icon={ICONS.Reports} label="Reports" active={isActive('/reports')} onClick={() => setIsSidebarOpen(false)} />
                )}
                {can('recycleBin.view') && hasCapability('recycle_bin_undoer') && (
                  <SidebarItem to="/recycle-bin" icon={ICONS.RecycleBin} label="Recycle Bin" active={isActive('/recycle-bin')} onClick={() => setIsSidebarOpen(false)} />
                )}
                {can('undoer.view') && hasCapability('recycle_bin_undoer') && (
                  <SidebarItem to="/undoer" icon={<RotateCcw size={20} />} label="Undoer" active={isActive('/undoer')} onClick={() => setIsSidebarOpen(false)} />
                )}
                {isAdminAccessUser && (
                  <>
                    <SidebarItem to="/subscriptions" icon={ICONS.Bell} label="Subscriptions" active={isActive('/subscriptions')} onClick={() => setIsSidebarOpen(false)} />
                    <SidebarItem to="/settings" icon={ICONS.Settings} label="Settings" active={isActive('/settings')} onClick={() => setIsSidebarOpen(false)} />
                    {isDeveloper && (
                      <SidebarItem
                        icon={ICONS.AlertCircle}
                        label="Developer-only"
                        active={isActive('/developer')}
                        children={[
                          { to: '/developer/notifications', label: 'Notifications', active: isActive('/developer/notifications') },
                          { to: '/developer/settings', label: 'Settings', active: isActive('/developer/settings') },
                          { to: '/developer/subscriptions', label: 'Subscriptions', active: isActive('/developer/subscriptions') },
                        ]}
                        onClick={() => setIsSidebarOpen(false)}
                      />
                    )}
                  </>
                )}
              </>
            )}
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

            {showSearch && (
              <div className="flex-1 max-w-xl mx-4 relative group hidden sm:block">
                <div className={`absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-gray-300 group-focus-within:${theme.colors.primary.text} ${theme.transitions.normal}`}>
                  {ICONS.Search}
                </div>
                <input 
                  type="text" 
                  placeholder={searchPlaceholder}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={`block w-full pl-11 pr-4 py-2.5 ${theme.colors.bg.secondary} border-transparent focus:${theme.colors.bg.primary} focus:ring-2 focus:ring-[#3c5a82] focus:border-transparent ${theme.radius.md} text-sm ${theme.transitions.normal}`} 
                />

                {/* dropdown for dashboard search results */}
                {dashboardResults.length > 0 && (
                  <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-60 overflow-auto">
                    {dashboardResults.map(o => (
                      <Link
                        key={o.id}
                        to={`/orders/${o.id}`}
                        state={buildHistoryBackState(location)}
                        onClick={() => setSearchQuery('')}
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                      >
                        {o.orderNumber} {o.customerName ? `- ${o.customerName}` : ''}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 ml-auto">
            <NotificationCenterButton />
            <div className="relative">
              <button
                onClick={() => {
                  if (!WRITE_FREEZE_ENABLED && quickActions.length > 0) {
                    setIsPlusOpen(!isPlusOpen);
                  }
                }}
                disabled={WRITE_FREEZE_ENABLED || quickActions.length === 0}
                title={WRITE_FREEZE_ENABLED ? WRITE_FREEZE_MESSAGE : quickActions.length === 0 ? 'No quick actions available for this role' : 'Quick actions'}
                className={`${theme.colors.primary[600]} text-white w-10 h-10 flex items-center justify-center ${theme.radius.md} ${theme.transitions.normal} shadow-lg shadow-[#0f2f57]/20 active:scale-95 ${WRITE_FREEZE_ENABLED || quickActions.length === 0 ? 'cursor-not-allowed opacity-50' : `hover:${theme.colors.primary[700]}`}`}
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
                <img src={user.image || `https://ui-avatars.com/api/?name=${user.name}&background=0f2f57&color=fff`} alt="Profile" className="w-10 h-10 rounded-[50%] object-cover cursor-pointer" />
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
            <p className={`text-sm font-medium ${theme.colors.text.secondary}`}>
              © {new Date().getFullYear()} {companySettings.name || 'Mame Pilot'}.
              <span className="mx-2">|</span>
              Version {import.meta.env.VITE_APP_VERSION || 'unknown'}
              <span className="mx-2">|</span>
              All rights reserved.
            </p>
            <p className={`text-[11px] font-bold uppercase tracking-widest ${theme.colors.text.secondary}`}>developed by Mame Studio</p>
          </footer>
        </main>
        <MameChat />
      </div>
    </div>
  );
};

export default Layout;
