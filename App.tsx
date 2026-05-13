import React, { Suspense, lazy } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './src/contexts/AuthProvider';
import { ToastProvider } from './src/contexts/ToastContext';
import { SearchProvider } from './src/contexts/SearchContext';
import { RealtimeProvider } from './src/contexts/RealtimeProvider';
import { NetworkProvider } from './src/contexts/NetworkProvider';
import { ApiError } from './src/services/apiClient';
import Layout from './components/Layout';
import ToastContainer from './components/ToastContainer';
import NetworkStatusBanner from './components/NetworkStatusBanner';
import { WRITE_FREEZE_ENABLED } from './src/config/incidentMode';
import GlobalApiEventWatcher from './src/components/GlobalApiEventWatcher';

type PreloadableComponent<T extends React.ComponentType<any>> = React.LazyExoticComponent<T> & {
  preload: () => Promise<unknown>;
};

function lazyPage<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>
): PreloadableComponent<T> {
  const Component = lazy(importer) as PreloadableComponent<T>;
  Component.preload = importer;
  return Component;
}

function scheduleIdlePreload(task: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const idleApi = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

  if (typeof idleApi.requestIdleCallback === 'function') {
    const handle = idleApi.requestIdleCallback(task, { timeout: 2000 });
    return () => idleApi.cancelIdleCallback?.(handle);
  }

  const timer = window.setTimeout(task, 600);
  return () => window.clearTimeout(timer);
}

// Create a client for React Query
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes - data is considered fresh for 5 min
      gcTime: 30 * 60 * 1000, // 30 minutes (formerly cacheTime) - keep in memory for 30 min
      retry: (failureCount, error) => {
        // Keep safe reads resilient without multiplying load during outages.
        if (error instanceof ApiError) {
          if (error.code === 'SERVICE_EXPIRED' || error.code === 'SERVICE_RENEWAL_PENDING') {
            return false;
          }

          if (error.code === 'NETWORK' || error.code === 'TIMEOUT') {
            return failureCount < 1;
          }

          if (typeof error.status === 'number') {
            return error.status >= 500 && failureCount < 1;
          }

          return false;
        }

        return failureCount < 1;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff, max 10s
      refetchOnWindowFocus: false, // Don't auto-refetch on window focus (optimistic updates handle changes)
      refetchOnReconnect: false, // Don't auto-refetch on reconnect (optimistic updates handle changes)
      refetchOnMount: false, // Don't auto-refetch on mount (avoid unnecessary requests)
    },
    mutations: {
      retry: 0, // Avoid duplicate writes when the network is degraded
      retryDelay: 1000, // 1 second delay between retries
    },
  },
});
import { hasAdminAccess } from './types';
import { useRolePermissions } from './src/hooks/useRolePermissions';
import StartupScreen from './components/StartupScreen';

const Login = lazyPage(() => import('./pages/Login'));
const Dashboard = lazyPage(() => import('./pages/Dashboard'));
const Orders = lazyPage(() => import('./pages/Orders'));
const OrderForm = lazyPage(() => import('./pages/OrderForm'));
const OrderDetails = lazyPage(() => import('./pages/OrderDetails'));
const Bills = lazyPage(() => import('./pages/Bills'));
const BillForm = lazyPage(() => import('./pages/BillForm'));
const BillDetails = lazyPage(() => import('./pages/BillDetails'));
const Banking = lazyPage(() => import('./pages/Banking'));
const FraudCheckerPage = lazyPage(() => import('./pages/FraudChecker'));
const Transactions = lazyPage(() => import('./pages/Transactions'));
const TransactionForm = lazyPage(() => import('./pages/TransactionForm'));
const Transfer = lazyPage(() => import('./pages/Transfer'));
const Products = lazyPage(() => import('./pages/Products'));
const ProductForm = lazyPage(() => import('./pages/ProductForm'));
const Users = lazyPage(() => import('./pages/Users'));
const UserForm = lazyPage(() => import('./pages/UserForm'));
const UserDetails = lazyPage(() => import('./pages/UserDetails'));
const SettingsPage = lazyPage(() => import('./pages/Settings'));
const DeveloperNotifications = lazyPage(() => import('./pages/DeveloperNotifications'));
const NotificationDetail = lazyPage(() => import('./pages/NotificationDetail'));
const Customers = lazyPage(() => import('./pages/Customers'));
const CustomerForm = lazyPage(() => import('./pages/CustomerForm'));
const CustomerDetails = lazyPage(() => import('./pages/CustomerDetails'));
const Vendors = lazyPage(() => import('./pages/Vendors'));
const VendorForm = lazyPage(() => import('./pages/VendorForm'));
const VendorDetails = lazyPage(() => import('./pages/VendorDetails'));
const Reports = lazyPage(() => import('./pages/Reports'));
const Payroll = lazyPage(() => import('./pages/Payroll'));
const RecycleBin = lazyPage(() => import('./pages/RecycleBin'));
const ExpenseSummary = lazyPage(() => import('./pages/reports/ExpenseSummary'));
const IncomeSummary = lazyPage(() => import('./pages/reports/IncomeSummary'));
const IncomeVsExpense = lazyPage(() => import('./pages/reports/IncomeVsExpense'));
const ProfitLoss = lazyPage(() => import('./pages/reports/ProfitLoss'));
const ProductQuantitySold = lazyPage(() => import('./pages/reports/ProductQuantitySold'));
const CustomerSalesReport = lazyPage(() => import('./pages/reports/CustomerSalesReport'));
const UserActivityPerformanceReport = lazyPage(() => import('./pages/reports/UserActivityPerformanceReport'));
const PrintOrder = lazyPage(() => import('./pages/PrintOrder'));
const PrintBill = lazyPage(() => import('./pages/PrintBill'));
const WalletPage = lazyPage(() => import('./pages/Wallet'));
const Undoer = lazyPage(() => import('./pages/Undoer'));

const RouteFallback: React.FC = () => (
  <div className="min-h-[40vh] flex items-center justify-center px-6 py-12 text-center text-sm font-medium text-gray-500">
    Loading page...
  </div>
);

// Inner app component that uses auth context
const AppRouter: React.FC<{ user: any; profile: any }> = ({ user, profile }) => {
  // Check authentication state - only require user since profile is GUARANTEED to exist when user exists
  // Profile is always loaded along with user by AuthProvider, never null during normal operation
  const isAuthenticated = !!user;
  const activeUser = profile || user;
  const isAdmin = hasAdminAccess(activeUser?.role);
  const { can, canAny, canViewAdminDashboard, canViewEmployeeDashboard } = useRolePermissions();
  const writeFreezeEnabled = WRITE_FREEZE_ENABLED;
  const canViewDashboard = canViewAdminDashboard || canViewEmployeeDashboard;
  const defaultProtectedRoute = canViewDashboard
    ? '/dashboard'
    : can('orders.view')
      ? '/orders'
      : can('customers.view')
        ? '/customers'
        : can('products.view')
          ? '/products'
          : can('bills.view')
            ? '/bills'
            : can('vendors.view')
              ? '/vendors'
              : can('transactions.view')
                ? '/banking/transactions'
                : can('accounts.view')
                  ? '/banking/accounts'
                  : can('fraudChecker.check')
                    ? '/fraud-checker'
                  : can('transfers.create')
                    ? '/banking/transfer'
                    : can('wallet.view')
                      ? '/wallet'
                      : can('reports.view')
                        ? '/reports'
                        : can('recycleBin.view')
                          ? '/recycle-bin'
          : can('users.view')
            ? '/users'
            : isAdmin
              ? '/settings'
            : '/dashboard';

  React.useEffect(() => {
    if (!isAuthenticated) return;

    const preloaders = new Set<() => Promise<unknown>>();
    if (canViewDashboard) preloaders.add(Dashboard.preload);
    if (can('orders.view')) {
      preloaders.add(Orders.preload);
      preloaders.add(OrderDetails.preload);
    }
    if (can('orders.create') || canAny(['orders.editOwn', 'orders.editAny'])) {
      preloaders.add(OrderForm.preload);
    }
    if (can('bills.view')) {
      preloaders.add(Bills.preload);
      preloaders.add(BillDetails.preload);
    }
    if (can('bills.create') || canAny(['bills.editOwn', 'bills.editAny'])) {
      preloaders.add(BillForm.preload);
    }
    if (can('customers.view')) {
      preloaders.add(Customers.preload);
      preloaders.add(CustomerDetails.preload);
    }
    if (can('customers.create') || can('customers.edit')) {
      preloaders.add(CustomerForm.preload);
    }
    if (can('vendors.view')) {
      preloaders.add(Vendors.preload);
      preloaders.add(VendorDetails.preload);
    }
    if (can('vendors.create') || can('vendors.edit')) {
      preloaders.add(VendorForm.preload);
    }
    if (can('products.view')) preloaders.add(Products.preload);
    if (can('products.create') || can('products.edit')) preloaders.add(ProductForm.preload);
    if (can('transactions.view')) preloaders.add(Transactions.preload);
    if (can('transactions.create') || can('transactions.edit')) preloaders.add(TransactionForm.preload);
    if (can('accounts.view')) preloaders.add(Banking.preload);
    if (can('fraudChecker.check')) preloaders.add(FraudCheckerPage.preload);
    if (can('transfers.create')) preloaders.add(Transfer.preload);
    if (can('users.view')) {
      preloaders.add(Users.preload);
      preloaders.add(UserDetails.preload);
      preloaders.add(UserForm.preload);
    }
    if (can('wallet.view')) preloaders.add(WalletPage.preload);
    if (can('payroll.view')) preloaders.add(Payroll.preload);
    if (can('reports.view')) {
      preloaders.add(Reports.preload);
      preloaders.add(ExpenseSummary.preload);
      preloaders.add(IncomeSummary.preload);
      preloaders.add(IncomeVsExpense.preload);
      preloaders.add(ProfitLoss.preload);
      preloaders.add(ProductQuantitySold.preload);
      preloaders.add(CustomerSalesReport.preload);
      if (isAdmin) {
        preloaders.add(UserActivityPerformanceReport.preload);
      }
    }
    if (can('recycleBin.view')) preloaders.add(RecycleBin.preload);
    if (isAdmin) preloaders.add(SettingsPage.preload);
    if (activeUser?.role === 'Developer') {
      preloaders.add(DeveloperNotifications.preload);
      preloaders.add(NotificationDetail.preload);
    }
    if (can('undoer.view')) preloaders.add(Undoer.preload);

    return scheduleIdlePreload(() => {
      Array.from(preloaders).forEach((preload, index) => {
        window.setTimeout(() => {
          preload().catch(() => {});
        }, index * 180);
      });
    });
  }, [isAuthenticated, can, canAny, canViewDashboard, isAdmin, activeUser?.role]);
  
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
      {/* Public login route - redirect to dashboard if logged in */}
      <Route path="/login" element={
        isAuthenticated ? <Navigate to={defaultProtectedRoute} replace /> : <Login />
      } />

      {/* Protected routes - require authenticated user (profile guaranteed) */}
      <Route path="/" element={
        isAuthenticated ? <Navigate to={defaultProtectedRoute} replace /> : <Navigate to="/login" replace />
      } />
      
      <Route path="/dashboard" element={
        isAuthenticated ? (canViewDashboard ? <Layout><Dashboard /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />

      <Route path="/developer/notifications" element={
        isAuthenticated ? (activeUser?.role === 'Developer' ? <Layout><DeveloperNotifications /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />

      <Route path="/developer/notifications/:id" element={
        isAuthenticated ? (activeUser?.role === 'Developer' ? <Layout><NotificationDetail /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      
      <Route path="/orders" element={
        isAuthenticated ? (can('orders.view') ? <Layout><Orders /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/orders/new" element={
        isAuthenticated ? (can('orders.create') ? (writeFreezeEnabled ? <Navigate to="/orders" replace /> : <Layout><OrderForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/orders/edit/:id" element={
        isAuthenticated ? (canAny(['orders.editOwn', 'orders.editAny']) ? (writeFreezeEnabled ? <Navigate to="/orders" replace /> : <Layout><OrderForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/orders/:id" element={
        isAuthenticated ? (can('orders.view') ? <Layout><OrderDetails /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/print-order/:id" element={
        isAuthenticated ? (can('orders.view') ? <PrintOrder /> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      
      <Route path="/bills" element={
        isAuthenticated ? (can('bills.view') ? <Layout><Bills /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/bills/new" element={
        isAuthenticated ? (can('bills.create') ? (writeFreezeEnabled ? <Navigate to="/bills" replace /> : <Layout><BillForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/bills/edit/:id" element={
        isAuthenticated ? (canAny(['bills.editOwn', 'bills.editAny']) ? (writeFreezeEnabled ? <Navigate to="/bills" replace /> : <Layout><BillForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/bills/:id" element={
        isAuthenticated ? (can('bills.view') ? <Layout><BillDetails /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/print-bill/:id" element={
        isAuthenticated ? (can('bills.view') ? <PrintBill /> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />

      <Route path="/banking/accounts" element={
        isAuthenticated ? (can('accounts.view') ? <Layout><Banking /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/fraud-checker" element={
        isAuthenticated ? (can('fraudChecker.check') ? <Layout><FraudCheckerPage /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/banking/transfer" element={
        isAuthenticated ? (can('transfers.create') ? <Layout><Transfer /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/banking/transactions" element={
        isAuthenticated ? (can('transactions.view') ? <Layout><Transactions /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      
      <Route path="/transactions" element={
        isAuthenticated ? (can('transactions.view') ? <Navigate to="/banking/transactions" replace /> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/transactions/new/:type" element={
        isAuthenticated ? (can('transactions.create') ? (writeFreezeEnabled ? <Navigate to="/banking/transactions" replace /> : <Layout><TransactionForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/transactions/edit/:id" element={
        isAuthenticated ? (can('transactions.edit') ? (writeFreezeEnabled ? <Navigate to="/banking/transactions" replace /> : <Layout><TransactionForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />

      <Route path="/customers" element={
        isAuthenticated ? (can('customers.view') ? <Layout><Customers /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/customers/new" element={
        isAuthenticated ? (can('customers.create') ? (writeFreezeEnabled ? <Navigate to="/customers" replace /> : <Layout><CustomerForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/customers/edit/:id" element={
        isAuthenticated ? (can('customers.edit') ? (writeFreezeEnabled ? <Navigate to="/customers" replace /> : <Layout><CustomerForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/customers/:id" element={
        isAuthenticated ? (can('customers.view') ? <Layout><CustomerDetails /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      
      <Route path="/vendors" element={
        isAuthenticated ? (can('vendors.view') ? <Layout><Vendors /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/vendors/new" element={
        isAuthenticated ? (can('vendors.create') ? (writeFreezeEnabled ? <Navigate to="/vendors" replace /> : <Layout><VendorForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/vendors/edit/:id" element={
        isAuthenticated ? (can('vendors.edit') ? (writeFreezeEnabled ? <Navigate to="/vendors" replace /> : <Layout><VendorForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/vendors/:id" element={
        isAuthenticated ? (can('vendors.view') ? <Layout><VendorDetails /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />

      <Route path="/products" element={
        isAuthenticated ? (can('products.view') ? <Layout><Products /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/products/new" element={
        isAuthenticated ? (can('products.create') ? (writeFreezeEnabled ? <Navigate to="/products" replace /> : <Layout><ProductForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/products/edit/:id" element={
        isAuthenticated ? (can('products.edit') ? (writeFreezeEnabled ? <Navigate to="/products" replace /> : <Layout><ProductForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />

      <Route path="/users" element={
        isAuthenticated ? (can('users.view') ? <Layout><Users /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/users/new" element={
        isAuthenticated ? (can('users.view') ? (writeFreezeEnabled ? <Navigate to="/users" replace /> : <Layout><UserForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/users/edit/:id" element={
        isAuthenticated ? (can('users.view') ? (writeFreezeEnabled ? <Navigate to="/users" replace /> : <Layout><UserForm /></Layout>) : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/users/:id" element={
        isAuthenticated ? (can('users.view') ? <Layout><UserDetails /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />

      <Route path="/reports" element={
        isAuthenticated ? (can('reports.view') ? <Layout><Reports /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/payroll" element={
        isAuthenticated
          ? can('payroll.view')
            ? <Layout><Payroll /></Layout>
            : can('wallet.view')
              ? <Navigate to="/wallet" replace />
              : <Navigate to={defaultProtectedRoute} replace />
          : <Navigate to="/login" replace />
      } />
      <Route path="/recycle-bin" element={
        isAuthenticated
          ? can('recycleBin.view')
            ? <Layout><RecycleBin /></Layout>
            : can('wallet.view')
              ? <Navigate to="/wallet" replace />
              : <Navigate to={defaultProtectedRoute} replace />
          : <Navigate to="/login" replace />
      } />
      <Route path="/wallet" element={
        isAuthenticated
          ? can('wallet.view')
            ? <Layout><WalletPage /></Layout>
            : <Navigate to={defaultProtectedRoute} replace />
          : <Navigate to="/login" replace />
      } />
      <Route path="/reports/expense" element={
        isAuthenticated ? (can('reports.view') ? <Layout><ExpenseSummary /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/reports/income" element={
        isAuthenticated ? (can('reports.view') ? <Layout><IncomeSummary /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/reports/income-vs-expense" element={
        isAuthenticated ? (can('reports.view') ? <Layout><IncomeVsExpense /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/reports/profit-loss" element={
        isAuthenticated ? (can('reports.view') ? <Layout><ProfitLoss /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/reports/product-quantity-sold" element={
        isAuthenticated ? (can('reports.view') ? <Layout><ProductQuantitySold /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/reports/customer-sales" element={
        isAuthenticated ? (can('reports.view') ? <Layout><CustomerSalesReport /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />
      <Route path="/reports/user-activity-performance" element={
        isAuthenticated ? (can('reports.view') ? <Layout><UserActivityPerformanceReport /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />

      <Route path="/settings" element={
        isAuthenticated ? (isAdmin ? <Layout><SettingsPage /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />

      <Route path="/undoer" element={
        isAuthenticated ? (can('undoer.view') ? <Layout><Undoer /></Layout> : <Navigate to={defaultProtectedRoute} replace />) : <Navigate to="/login" replace />
      } />

      {/* Catch all - redirect based on auth state */}
      <Route path="*" element={isAuthenticated ? <Navigate to={defaultProtectedRoute} replace /> : <Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
};

// App content component - safely uses auth context and passes to router
const AppContent: React.FC = () => {
  const { user, profile, startupStatus, startupError, retrySessionRestore, signOut } = useAuth();

  if (startupStatus === 'idle' || startupStatus === 'checking') {
    return <StartupScreen status={startupStatus} />;
  }

  if (startupStatus === 'timeout' || startupStatus === 'offline' || startupStatus === 'error') {
    return (
      <StartupScreen
        status={startupStatus}
        error={startupError}
        onRetry={retrySessionRestore}
        onBackToLogin={signOut}
      />
    );
  }

  return <AppRouter user={user} profile={profile} />;
};

const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NetworkProvider>
          <ToastProvider>
            <SearchProvider>
              <RealtimeProvider>
                <HashRouter>
                  <AppContent />
                  <GlobalApiEventWatcher />
                  <NetworkStatusBanner />
                  <ToastContainer />
                </HashRouter>
              </RealtimeProvider>
            </SearchProvider>
          </ToastProvider>
        </NetworkProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
