import { useEffect } from 'react';
import { triggerGitUpdate, type GitUpdateDispatchResponse } from '../services/supabaseQueries';

const DEFAULT_INTERVAL_SECONDS = 120;

function normalizedDelay(response: GitUpdateDispatchResponse): number {
  const configured = Number(response.retryAfterSeconds || response.intervalSeconds || DEFAULT_INTERVAL_SECONDS);
  return Math.max(1, Number.isFinite(configured) ? Math.round(configured) : DEFAULT_INTERVAL_SECONDS);
}

export function useGitUpdateDispatcher(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let stopped = false;
    let timerId: number | null = null;

    const clearTimer = () => {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }
    };

    const dispatch = async (): Promise<void> => {
      if (stopped) {
        return;
      }

      console.debug('[Git Update] Requesting an authenticated background update check.');
      try {
        const response = await triggerGitUpdate();
        if (stopped) {
          return;
        }

        if (response.status === 'cron_only' || response.mode === 'package') {
          console.info('[Git Update] Package update mode detected. Browser dispatch is off; the server cron owns ZIP updates.');
          stopped = true;
          clearTimer();
          return;
        }

        if (response.status === 'disabled' || !response.enabled) {
          console.info('[Git Update] Git auto-update is not active:', response.message);
          stopped = true;
          clearTimer();
          return;
        }

        if (response.status === 'dispatched') {
          console.info('[Git Update] Git auto-update is active. Detached PHP updater dispatched.');
        } else if (response.status === 'cooldown') {
          console.info('[Git Update] Git auto-update is active. Another authenticated session dispatched it recently.');
        } else {
          console.warn('[Git Update] Git auto-update could not be dispatched:', response.message);
        }

        schedule(normalizedDelay(response));
      } catch (error) {
        if (stopped) {
          return;
        }
        console.warn('[Git Update] Authenticated dispatcher request failed. It will retry.', error);
        schedule(DEFAULT_INTERVAL_SECONDS);
      }
    };

    const schedule = (delaySeconds: number) => {
      clearTimer();
      const deadline = Date.now() + delaySeconds * 1000;

      const tick = () => {
        if (stopped) {
          return;
        }

        const secondsRemaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        if (secondsRemaining <= 0) {
          void dispatch();
          return;
        }

        console.debug(`[Git Update] Next detached PHP updater dispatch in ${secondsRemaining} seconds.`);
        timerId = window.setTimeout(tick, 1000);
      };

      tick();
    };

    console.info('[Git Update] Authenticated Git auto-update monitor started.');
    void dispatch();

    return () => {
      stopped = true;
      clearTimer();
      console.debug('[Git Update] Authenticated Git auto-update monitor stopped.');
    };
  }, [enabled]);
}
