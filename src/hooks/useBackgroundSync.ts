import { useEffect } from 'react';

const POLL_INTERVAL = 120000; // 2 minutes

function buildEndpoint(): string {
  const rawBase = import.meta.env.VITE_API_BASE_URL || '/api/';
  const normalizedBase = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
  return `${normalizedBase}/trigger_update.php`;
}

async function dispatchSync(): Promise<void> {
  const endpoint = buildEndpoint();
  console.debug('[Update Sync] Dispatching to', endpoint);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('[Update Sync] Backend returned HTTP', response.status, response.statusText, body);
      return;
    }

    const payload = await response.json();
    console.debug('[Update Sync] Response payload:', payload);

    if (payload?.status === 'success') {
      console.info('[Update Sync] Background update dispatched successfully.');
    } else if (payload?.status === 'skipped') {
      console.info('[Update Sync] Update skipped:', payload?.message ?? 'Cooldown active.');
    } else {
      console.warn('[Update Sync] Unexpected update response:', payload);
    }
  } catch (error) {
    console.error('[Update Sync] Failed to contact backend update endpoint.', error);
  }
}

export function useBackgroundSync(): void {
  useEffect(() => {
    console.debug('[Update Sync] Starting background sync hook.');
    dispatchSync();
    const intervalId = window.setInterval(() => {
      console.debug('[Update Sync] Interval triggered dispatch.');
      dispatchSync();
    }, POLL_INTERVAL);

    return () => {
      window.clearInterval(intervalId);
      console.debug('[Update Sync] Stopped background sync hook.');
    };
  }, []);
}
