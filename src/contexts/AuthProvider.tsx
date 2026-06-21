import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { fetchAccounts, fetchBootstrapSession, fetchSystemDefaults, loginUser, syncLicenseCapabilities } from '../services/supabaseQueries';
import { ApiError, clearAuthToken, getAuthToken, setAuthToken } from '../services/apiClient';
import { useQueryClient } from '@tanstack/react-query';
import { hasAdminAccess, type CapabilitySettings, type PermissionsSettings, type User } from '../../types';
import { db, saveDb } from '../../db';

export type StartupStatus = 'idle' | 'checking' | 'ready' | 'anonymous' | 'timeout' | 'offline' | 'error';

type AuthContextType = {
  user: User | null;
  profile?: User | null;
  isLoading: boolean;
  startupStatus: StartupStatus;
  startupError: string | null;
  signIn: (phoneOrEmail: string, password: string) => Promise<{ error?: any; data?: any }>;
  signOut: () => Promise<void>;
  retrySessionRestore: () => Promise<void>;
};

type BootstrapSessionData = {
  user: User;
  permissions: PermissionsSettings;
  capabilities: CapabilitySettings;
};

type BootstrapFailure = {
  status: Extract<StartupStatus, 'timeout' | 'offline' | 'error'>;
  message: string;
};

type BootstrapCacheEntry = {
  token: string;
  cachedAt: number;
  session: BootstrapSessionData;
};

type BootstrapResult =
  | { kind: 'success'; data: BootstrapSessionData }
  | { kind: 'anonymous' }
  | { kind: 'failure'; failure: BootstrapFailure };

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const BOOTSTRAP_TIMEOUT_MS = 15000;
const BOOTSTRAP_CACHE_KEY = 'bootstrapSessionCache';
const BOOTSTRAP_CACHE_MAX_AGE_MS = 30 * 60 * 1000;
const LICENSE_SYNC_STORAGE_KEY = 'licenseCapabilitiesLastSyncAttempt';
const LICENSE_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const LEGACY_SESSION_KEYS = ['currentUserId', 'isLoggedIn', 'userProfile', 'userData', 'currentUser'] as const;

function readBootstrapCache(token: string): BootstrapSessionData | null {
  if (typeof window === 'undefined' || !token.trim()) {
    return null;
  }

  try {
    const raw = localStorage.getItem(BOOTSTRAP_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as BootstrapCacheEntry | null;
    if (
      !parsed
      || parsed.token !== token
      || typeof parsed.cachedAt !== 'number'
      || !parsed.session?.user
      || !parsed.session?.permissions
    ) {
      return null;
    }

    if (Date.now() - parsed.cachedAt > BOOTSTRAP_CACHE_MAX_AGE_MS) {
      return null;
    }

    return parsed.session;
  } catch {
    return null;
  }
}

function writeBootstrapCache(token: string, session: BootstrapSessionData): void {
  if (typeof window === 'undefined' || !token.trim()) {
    return;
  }

  try {
    const payload: BootstrapCacheEntry = {
      token,
      cachedAt: Date.now(),
      session,
    };
    localStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore cache-write failures; startup should still succeed.
  }
}

function clearBootstrapCache(): void {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.removeItem(BOOTSTRAP_CACHE_KEY);
}

function clearLegacySessionStorage(): void {
  for (const key of LEGACY_SESSION_KEYS) {
    localStorage.removeItem(key);
  }
}

function classifyBootstrapError(error: unknown): BootstrapFailure {
  if (error instanceof ApiError && error.code === 'TIMEOUT') {
    return {
      status: 'timeout',
      message: 'Restoring your session took too long. Please try again.',
    };
  }

  if (!navigator.onLine) {
    return {
      status: 'offline',
      message: 'No internet connection. Reconnect and try again.',
    };
  }

  return {
    status: 'error',
    message: 'The server did not respond. Please try again.',
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [startupStatus, setStartupStatus] = useState<StartupStatus>(() => (getAuthToken() ? 'checking' : 'anonymous'));
  const [startupError, setStartupError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const mountedRef = useRef(true);
  const bootstrapInFlightRef = useRef<{ token: string; promise: Promise<BootstrapResult> } | null>(null);

  const isLoading = startupStatus === 'idle' || startupStatus === 'checking';

  const applyAuthenticatedState = useCallback((session: BootstrapSessionData) => {
    setUser(session.user);
    db.currentUser = session.user;
    queryClient.setQueryData(['settings', 'permissions'], session.permissions);
    queryClient.setQueryData(['settings', 'capabilities'], session.capabilities);
    setStartupError(null);
    setStartupStatus('ready');
    saveDb();
  }, [queryClient]);

  const setAnonymousState = useCallback((clearToken: boolean) => {
    setUser(null);
    db.currentUser = null;
    queryClient.removeQueries({ queryKey: ['settings', 'permissions'], exact: true });
    queryClient.removeQueries({ queryKey: ['settings', 'capabilities'], exact: true });
    setStartupError(null);
    setStartupStatus('anonymous');

    if (clearToken) {
      clearAuthToken();
    }

    clearBootstrapCache();
    clearLegacySessionStorage();
    saveDb();
  }, [queryClient]);

  const prefetchPostBootstrap = useCallback(() => {
    try {
      queryClient.prefetchQuery({
        queryKey: ['accounts'],
        queryFn: () => fetchAccounts(),
        staleTime: 15 * 60 * 1000,
      }).catch(() => {});

      queryClient.prefetchQuery({
        queryKey: ['settings', 'defaults'],
        queryFn: () => fetchSystemDefaults(),
        staleTime: 60 * 60 * 1000,
      }).catch(() => {});
    } catch (error) {
      console.warn('[Auth] Background prefetch failed to start:', error);
    }
  }, [queryClient]);

  const maybeSyncLicenseCapabilities = useCallback((session: BootstrapSessionData) => {
    if (!hasAdminAccess(session.user.role)) {
      return;
    }

    const now = Date.now();
    const lastAttempt = Number(localStorage.getItem(LICENSE_SYNC_STORAGE_KEY) || '0');
    if (Number.isFinite(lastAttempt) && now - lastAttempt < LICENSE_SYNC_INTERVAL_MS) {
      return;
    }

    localStorage.setItem(LICENSE_SYNC_STORAGE_KEY, String(now));
    syncLicenseCapabilities()
      .then((capabilities) => {
        queryClient.setQueryData(['settings', 'capabilities'], capabilities);
        queryClient.invalidateQueries({ queryKey: ['settings', 'defaults'] });
      })
      .catch(() => {});
  }, [queryClient]);

  const bootstrapFromToken = useCallback(async (): Promise<BootstrapResult> => {
    const token = getAuthToken();

    if (!token) {
      if (mountedRef.current) {
        setAnonymousState(false);
      }
      return { kind: 'anonymous' };
    }

    if (bootstrapInFlightRef.current?.token === token) {
      return bootstrapInFlightRef.current.promise;
    }

    const cachedSession = readBootstrapCache(token);
    if (mountedRef.current) {
      setStartupError(null);
      if (cachedSession) {
        applyAuthenticatedState(cachedSession);
      } else {
        setStartupStatus('checking');
      }
    }

    const request = (async (): Promise<BootstrapResult> => {
      try {
        const session = await fetchBootstrapSession({ timeoutMs: BOOTSTRAP_TIMEOUT_MS });

        writeBootstrapCache(token, session);

        if (!mountedRef.current) {
          return { kind: 'success', data: session };
        }

        applyAuthenticatedState(session);
        maybeSyncLicenseCapabilities(session);
        prefetchPostBootstrap();
        window.dispatchEvent(new Event('authChange'));
        return { kind: 'success', data: session };
      } catch (error) {
        if (!mountedRef.current) {
          return { kind: 'failure', failure: classifyBootstrapError(error) };
        }

        if (error instanceof ApiError && error.status === 401) {
          console.warn('[Auth] Stored token is invalid, clearing session');
          clearBootstrapCache();
          setAnonymousState(true);
          window.dispatchEvent(new Event('authChange'));
          return { kind: 'anonymous' };
        }

        if (cachedSession) {
          console.warn('[Auth] Session bootstrap failed, using cached session snapshot:', error);
          maybeSyncLicenseCapabilities(cachedSession);
          prefetchPostBootstrap();
          return { kind: 'success', data: cachedSession };
        }

        const failure = classifyBootstrapError(error);
        console.error('[Auth] Session bootstrap failed:', error);
        setUser(null);
        db.currentUser = null;
        queryClient.removeQueries({ queryKey: ['settings', 'permissions'], exact: true });
        setStartupStatus(failure.status);
        setStartupError(failure.message);
        saveDb();
        return { kind: 'failure', failure };
      } finally {
        if (bootstrapInFlightRef.current?.token === token) {
          bootstrapInFlightRef.current = null;
        }
      }
    })();

    bootstrapInFlightRef.current = { token, promise: request };
    return request;
  }, [applyAuthenticatedState, maybeSyncLicenseCapabilities, prefetchPostBootstrap, queryClient, setAnonymousState]);

  useEffect(() => {
    mountedRef.current = true;
    void bootstrapFromToken();

    return () => {
      mountedRef.current = false;
    };
  }, [bootstrapFromToken]);

  const retrySessionRestore = useCallback(async () => {
    await bootstrapFromToken();
  }, [bootstrapFromToken]);

  const signIn = useCallback(async (phoneOrEmail: string, password: string) => {
    const phone = (phoneOrEmail.includes('@') ? phoneOrEmail.split('@')[0] : phoneOrEmail).trim();

    try {
      const { user: loginUserData, token, error: loginError } = await loginUser(phone, password);

      if (loginError || !loginUserData) {
        return { error: { message: loginError || 'Login failed' } };
      }

      if (!token || !token.trim()) {
        return { error: { message: 'Login succeeded but no session token was returned.' } };
      }

      await queryClient.cancelQueries();
      queryClient.clear();

      setAuthToken(token);
      clearLegacySessionStorage();

      const bootstrapResult = await bootstrapFromToken();
      if (bootstrapResult.kind === 'success') {
        return { data: { user: bootstrapResult.data.user, profileLoaded: true }, error: null };
      }

      if (bootstrapResult.kind === 'anonymous') {
        return { error: { message: 'Your session expired. Please sign in again.' } };
      }

      return { error: { message: bootstrapResult.failure.message } };
    } catch (error: any) {
      console.error('[Auth] signIn exception:', error?.message || error);
      return { error: { message: error?.message || 'Login failed' } };
    }
  }, [bootstrapFromToken, queryClient]);

  const signOut = useCallback(async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    setAnonymousState(true);
    window.dispatchEvent(new Event('authChange'));
  }, [queryClient, setAnonymousState]);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile: user,
        isLoading,
        startupStatus,
        startupError,
        signIn,
        signOut,
        retrySessionRestore,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    console.warn('[Auth] useAuth called without AuthProvider, falling back to db.currentUser');
    return {
      user: db.currentUser ?? null,
      profile: db.currentUser ?? null,
      isLoading: false,
      startupStatus: 'anonymous' as StartupStatus,
      startupError: null,
      signIn: async () => ({ error: { message: 'AuthProvider missing' } }),
      signOut: async () => {},
      retrySessionRestore: async () => {},
    };
  }
  return ctx;
}

export { AuthContext };
