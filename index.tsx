import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './src/contexts/AuthProvider';
import App from './App';

type VitePreloadErrorEvent = Event & {
  payload?: unknown;
};

const PRELOAD_RECOVERY_KEY = 'mamepilot:preload-recovery';
const PRELOAD_RECOVERY_COOLDOWN_MS = 30_000;
let preloadRecoveryScheduled = false;

function preloadErrorSignature(payload: unknown): string {
  if (payload instanceof Error) {
    return payload.message;
  }

  return typeof payload === 'string' ? payload : 'unknown-preload-error';
}

window.addEventListener('vite:preloadError', (event) => {
  if (preloadRecoveryScheduled) {
    event.preventDefault();
    return;
  }

  const preloadEvent = event as VitePreloadErrorEvent;
  const signature = preloadErrorSignature(preloadEvent.payload);
  const now = Date.now();
  let shouldReload = true;

  try {
    const previousAttempt = JSON.parse(window.sessionStorage.getItem(PRELOAD_RECOVERY_KEY) || 'null') as {
      signature?: string;
      attemptedAt?: number;
    } | null;

    shouldReload = typeof previousAttempt?.attemptedAt !== 'number'
      || now - previousAttempt.attemptedAt > PRELOAD_RECOVERY_COOLDOWN_MS;

    if (shouldReload) {
      window.sessionStorage.setItem(PRELOAD_RECOVERY_KEY, JSON.stringify({ signature, attemptedAt: now }));
    }
  } catch {
    // Without a persisted attempt marker, reloading could loop indefinitely.
    shouldReload = false;
  }

  if (shouldReload) {
    preloadRecoveryScheduled = true;
    event.preventDefault();
    window.location.reload();
  }
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 0,
    },
    mutations: {
      retry: 0,
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
