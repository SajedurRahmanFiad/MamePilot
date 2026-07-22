import React, { createContext, useContext, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  syncCarryBeeTransferStatuses,
  syncPaperflyOrderStatuses,
  syncPathaoDeliveryStatuses,
  syncSteadfastDeliveryStatuses,
} from '../services/supabaseQueries';
import { useAuth } from './AuthProvider';
import { ENABLE_CLIENT_COURIER_SYNC } from '../config/incidentMode';

interface RealtimeContextType {
  isConnected: boolean;
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const syncingRef = React.useRef(false);

  useEffect(() => {
    if (!ENABLE_CLIENT_COURIER_SYNC || !user?.id) return;

    let cancelled = false;
    const INTERVAL_MS = 10 * 60_000;

    const runSync = async () => {
      if (cancelled || syncingRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      syncingRef.current = true;
      try {
        const results = await Promise.allSettled([
          syncCarryBeeTransferStatuses(),
          syncPaperflyOrderStatuses(),
          syncSteadfastDeliveryStatuses(),
          syncPathaoDeliveryStatuses(),
        ]);

        const hasUpdates = results.some(
          (result) => result.status === 'fulfilled' && result.value.updated > 0,
        );
        const failures = results.filter(
          (result): result is PromiseRejectedResult => result.status === 'rejected',
        );

        if (failures.length > 0) {
          console.error('[Realtime] One or more courier syncs failed:', failures.map((result) => result.reason));
        }

        if (!cancelled && hasUpdates) {
          queryClient.invalidateQueries({ queryKey: ['orders'], exact: false });
          queryClient.invalidateQueries({ queryKey: ['dashboard'], exact: false });
          queryClient.invalidateQueries({ queryKey: ['wallet'], exact: false });
          queryClient.invalidateQueries({ queryKey: ['payroll'], exact: false });
        }
      } catch (err) {
        console.error('[Realtime] Courier sync failed:', err);
      } finally {
        syncingRef.current = false;
      }
    };

    void runSync();
    const timer = window.setInterval(runSync, INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user?.id, queryClient]);

  return (
    <RealtimeContext.Provider value={{ isConnected: false }}>
      {children}
    </RealtimeContext.Provider>
  );
};

export function useRealtime() {
  const ctx = useContext(RealtimeContext);
  if (!ctx) {
    throw new Error('useRealtime must be used within RealtimeProvider');
  }
  return ctx;
}

export { RealtimeContext };
