import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getAuthToken } from '../services/apiClient';

const RAW_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '/api/';

function normalizeApiBaseUrl(value: string): string {
  if (value === '') return '/api/';
  if (value.includes('?') || /\.php$/i.test(value)) return value;
  return value.endsWith('/') ? value : `${value}/`;
}

function buildStreamUrl(): string {
  const base = normalizeApiBaseUrl(RAW_API_BASE_URL);
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}action=streamNotifications`;
}

/**
 * Connects to the SSE notification stream for real-time notification delivery.
 * Falls back gracefully if SSE is not supported or connection fails.
 */
export function useNotificationStream(enabled: boolean = true) {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const connect = useCallback(() => {
    cleanup();

    const token = getAuthToken();
    if (!token) return;

    const url = buildStreamUrl();
    // EventSource doesn't support custom headers, so we pass the token as a query param
    // The backend should accept this for SSE connections
    const separator = url.includes('?') ? '&' : '?';
    const sseUrl = `${url}${separator}token=${encodeURIComponent(token)}`;

    const eventSource = new EventSource(sseUrl);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener('connected', () => {
      reconnectAttemptsRef.current = 0;
    });

    eventSource.addEventListener('notification', (event) => {
      try {
        const data = JSON.parse(event.data);
        // Invalidate notification queries to trigger a refetch
        queryClient.invalidateQueries({ queryKey: ['notifications'] });

        // Also dispatch a custom event for the BroadcastChannel
        window.dispatchEvent(new CustomEvent('app:notifications-updated', {
          detail: { timestamp: Date.now(), source: 'sse' }
        }));
      } catch {
        // Ignore parse errors
      }
    });

    eventSource.onerror = () {
      eventSource.close();
      eventSourceRef.current = null;

      // Exponential backoff for reconnection
      const attempts = reconnectAttemptsRef.current;
      const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
      reconnectAttemptsRef.current = attempts + 1;

      reconnectTimeoutRef.current = setTimeout(() => {
        if (enabled) {
          connect();
        }
      }, delay);
    };
  }, [cleanup, queryClient, enabled]);

  useEffect(() => {
    if (!enabled) {
      cleanup();
      return;
    }

    // Check if EventSource is supported
    if (typeof EventSource === 'undefined') {
      return;
    }

    connect();

    return cleanup;
  }, [enabled, connect, cleanup]);

  // Reconnect on visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && enabled && !eventSourceRef.current) {
        reconnectAttemptsRef.current = 0;
        connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled, connect]);
}
