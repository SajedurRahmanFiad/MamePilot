import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useToastNotifications } from './ToastContext';
import { useAuth } from './AuthProvider';
import { useServiceSubscriptionOverview } from '../hooks/useQueries';
import { isDeveloperRole } from '../../types';

interface SubscriptionReadOnlyContextType {
  isReadOnly: boolean;
  showReadOnlyWarning: (action?: string) => void;
}

const SubscriptionReadOnlyContext = createContext<SubscriptionReadOnlyContextType | undefined>(undefined);

const EXEMPT_PATHS = ['/subscriptions', '/developer/subscriptions'];
const ACTION_LINK_PATTERNS = [/\/new(?:$|[/?#])/, /\/edit(?:$|[/?#])/, /\/duplicate(?:$|[/?#])/];

export const SubscriptionReadOnlyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const location = useLocation();
  const toast = useToastNotifications();
  const lastToastRef = useRef<{ message: string; at: number } | null>(null);

  const overviewQuery = useServiceSubscriptionOverview(!!user);
  const overview = overviewQuery.data;
  const [isServiceBlocked, setIsServiceBlocked] = useState(false);
  const isDeveloper = isDeveloperRole(user?.role);

  const isReadOnly = useMemo(() => {
    if (isDeveloper) return false;
    if (isServiceBlocked) return true;
    if (!overview) return false;
    return overview.state === 'expired' || overview.writeBlocked === true;
  }, [overview, isServiceBlocked, isDeveloper]);

  const isExemptPath = useMemo(() => {
    return EXEMPT_PATHS.some((path) => location.pathname.startsWith(path));
  }, [location.pathname]);

  const isExemptTarget = useCallback((element: HTMLElement | null) => {
    if (!element) return false;

    if (element.tagName === 'A') {
      const href = (element as HTMLAnchorElement).getAttribute('href') || '';
      return EXEMPT_PATHS.some((path) => href.startsWith(path) || href.includes(path));
    }

    return false;
  }, []);

  const showReadOnlyWarning = useCallback((_action?: string) => {
    const message = 'Subscribe to continue. The app is currently in read-only mode.';

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

    const handleBlockedInteraction = (event: Event) => {
      if (isExemptPath) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      const actionable = target.closest(
        'button, input[type="button"], input[type="submit"], input[type="reset"], [role="button"], a'
      ) as HTMLElement | null;
      if (!actionable) {
        return;
      }

      if (isExemptTarget(actionable)) {
        return;
      }

      if (actionable.tagName === 'A') {
        const href = (actionable as HTMLAnchorElement).getAttribute('href') || '';
        const isActionLink = ACTION_LINK_PATTERNS.some((pattern) => pattern.test(href));
        if (!isActionLink && actionable.getAttribute('role') !== 'button') {
          return;
        }
      }

      showReadOnlyWarning();
      event.preventDefault();
      event.stopPropagation();
    };

    const handleSubmit = (event: Event) => {
      if (isExemptPath) {
        return;
      }

      const form = event.target as HTMLFormElement | null;
      if (!form || form.nodeName !== 'FORM') {
        return;
      }

      showReadOnlyWarning('Form submission');
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener('pointerdown', handleBlockedInteraction, true);
    window.addEventListener('click', handleBlockedInteraction, true);
    window.addEventListener('submit', handleSubmit, true);
    return () => {
      window.removeEventListener('pointerdown', handleBlockedInteraction, true);
      window.removeEventListener('click', handleBlockedInteraction, true);
      window.removeEventListener('submit', handleSubmit, true);
    };
  }, [isReadOnly, isExemptPath, isExemptTarget, showReadOnlyWarning]);

  useEffect(() => {
    const handleServiceBlockedEvent = (event: Event) => {
      setIsServiceBlocked(true);
    };

    window.addEventListener('api:service-blocked', handleServiceBlockedEvent);
    return () => window.removeEventListener('api:service-blocked', handleServiceBlockedEvent);
  }, []);

  useEffect(() => {
    if (!overview || overview.state !== 'expired') {
      setIsServiceBlocked(false);
    }
  }, [overview]);

  return (
    <SubscriptionReadOnlyContext.Provider value={{ isReadOnly, showReadOnlyWarning }}>
      {children}
    </SubscriptionReadOnlyContext.Provider>
  );
};

export const useSubscriptionReadOnly = (): SubscriptionReadOnlyContextType => {
  const context = useContext(SubscriptionReadOnlyContext);
  if (!context) {
    // Fail-safe: return sensible defaults when provider is missing to avoid crashing
    // This can happen during tests or if the provider mounting order is incorrect.
    // Log a warning to help debugging.
    // eslint-disable-next-line no-console
    console.warn('useSubscriptionReadOnly called without SubscriptionReadOnlyProvider; returning safe defaults.');
    return {
      isReadOnly: false,
      showReadOnlyWarning: () => {},
    };
  }
  return context;
};
