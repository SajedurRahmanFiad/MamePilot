import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { syncWooCommerceBackground } from '../services/supabaseQueries';

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

export interface WooAutoSyncState {
  lastSyncAt: Date | null;
  lastMessage: string;
  running: boolean;
  imported: number;
}

/**
 * Calls the WooCommerce background-sync endpoint every 5 minutes.
 * Silent on errors — never blocks the UI or other jobs.
 * Keeps the WooCommerce store list query fresh after each sync.
 */
export function useWooCommerceAutoSync(): WooAutoSyncState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<WooAutoSyncState>({
    lastSyncAt: null,
    lastMessage: '',
    running: false,
    imported: 0,
  });
  const runningRef = useRef(false);

  const runSync = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setState((prev) => ({ ...prev, running: true }));
    try {
      const result = await syncWooCommerceBackground();
      if (result.status !== 'skipped') {
        setState({
          lastSyncAt: new Date(),
          lastMessage: result.message || 'Background sync complete.',
          running: false,
          imported: result.imported ?? 0,
        });
        // Refresh the WooCommerce stores query so last-synced-at updates
        queryClient.invalidateQueries({ queryKey: ['settings', 'woocommerce'] });
      } else {
        setState((prev) => ({ ...prev, running: false }));
      }
    } catch {
      // Silent — never bother the user about background sync failures
      setState((prev) => ({ ...prev, running: false }));
    }
  }, [queryClient]);

  useEffect(() => {
    // Run once on mount after a short delay so the page loads first
    const startupTimer = window.setTimeout(runSync, 10_000);
    const intervalId = window.setInterval(runSync, POLL_INTERVAL);

    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(intervalId);
    };
  }, [runSync]);

  return state;
}
