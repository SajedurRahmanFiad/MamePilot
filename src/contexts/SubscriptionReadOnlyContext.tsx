import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useToastNotifications } from './ToastContext';
import { useAuth } from './AuthProvider';
import { useServiceSubscriptionOverview } from '../hooks/useQueries';

interface SubscriptionReadOnlyContextType {
  isReadOnly: boolean;
  showReadOnlyWarning: (action?: string) => void;
}

const SubscriptionReadOnlyContext = createContext<SubscriptionReadOnlyContextType | undefined>(undefined);

const EXEMPT_PATHS = ['/subscriptions', '/developer/subscriptions'];

export const SubscriptionReadOnlyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const location = useLocation();
  const toast = useToastNotifications();
  const lastToastRef = useRef<{ message: string; at: number } | null>(null);

  const overviewQuery = useServiceSubscriptionOverview(!!user);
  const overview = overviewQuery.data;

  const isReadOnly = useMemo(() => {
    if (!overview) return false;
    return overview.state === 'expired' || overview.writeBlocked === true;
  }, [overview]);

  const isExemptPath = useMemo(() => {
    return EXEMPT_PATHS.some((path) => location.pathname.startsWith(path));
  }, [location.pathname]);

  const showReadOnlyWarning = useCallback((action?: string) => {
    const message = action
      ? `${action} is disabled because your subscription has expired. Please renew to continue.`
      : 'Actions are disabled because your subscription has expired. Please renew to continue.';

    const now = Date.now();
    const previous = lastToastRef.current;
    if (previous && previous.message === message && now - previous.at < 3500) {
      return;
    }

    lastToastRef.current = { message, at: now };
    toast.warning(message);
  }, [toast]);

  useEffect(() => {
    if (!isReadOnly) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (isExemptPath) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      const actionable = target.closest(
        'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"]'
      ) as HTMLElement | null;
      if (!actionable) {
        return;
      }

      const disabledAttr = actionable.getAttribute('disabled');
      if (disabledAttr !== null) {
        return;
      }

      const actionText = actionable.getAttribute('aria-label') || actionable.getAttribute('title') || actionable.textContent?.trim();
      showReadOnlyWarning(actionText || 'This action');
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('click', handleClick, true);
    return () => window.removeEventListener('click', handleClick, true);
  }, [isReadOnly, isExemptPath, showReadOnlyWarning]);

  return (
    <SubscriptionReadOnlyContext.Provider value={{ isReadOnly, showReadOnlyWarning }}>
      {children}
    </SubscriptionReadOnlyContext.Provider>
  );
};

export const useSubscriptionReadOnly = (): SubscriptionReadOnlyContextType => {
  const context = useContext(SubscriptionReadOnlyContext);
  if (!context) {
    throw new Error('useSubscriptionReadOnly must be used within SubscriptionReadOnlyProvider');
  }
  return context;
};
