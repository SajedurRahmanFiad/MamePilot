import { GENERIC_ACTION_ERROR, userFacingErrorMessage } from '../utils/userFacingMessages';

const RAW_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || '/api/';
const AUTH_TOKEN_KEY = 'authToken';

export type ApiActionOptions = {
  timeoutMs?: number;
};

type ApiErrorCode = 'TIMEOUT' | 'NETWORK' | 'HTTP_ERROR';

export class ApiError extends Error {
  status?: number;
  code: ApiErrorCode | string;

  constructor(message: string, options?: { status?: number; code?: ApiErrorCode | string }) {
    super(message);
    this.name = 'ApiError';
    this.status = options?.status;
    this.code = options?.code || 'HTTP_ERROR';
  }
}

function normalizeApiBaseUrl(value: string): string {
  if (value === '') {
    return '/api/';
  }

  if (value.includes('?') || /\.php$/i.test(value)) {
    return value;
  }

  return value.endsWith('/') ? value : `${value}/`;
}

const API_BASE_URL = normalizeApiBaseUrl(RAW_API_BASE_URL);
const SERVICE_ERROR_CODES = new Set(['SERVICE_EXPIRED', 'SERVICE_RENEWAL_PENDING']);

function buildActionUrl(action: string): string {
  const separator = API_BASE_URL.includes('?') ? '&' : '?';
  return `${API_BASE_URL}${separator}action=${encodeURIComponent(action)}`;
}

export function getAuthToken(): string {
  return localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

export function setAuthToken(token: string | null | undefined): void {
  if (token && token.trim()) {
    localStorage.setItem(AUTH_TOKEN_KEY, token.trim());
    return;
  }

  localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

export async function apiAction<T>(action: string, payload?: unknown, options?: ApiActionOptions): Promise<T> {
  const token = getAuthToken();
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutMs = Math.max(0, Number(options?.timeoutMs || 0));
  const timeoutId = controller && timeoutMs > 0
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : null;

  let response: Response;
  try {
    response = await fetch(buildActionUrl(action), {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(payload ?? {}),
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch (error: any) {
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }

    if (error?.name === 'AbortError') {
      throw new ApiError('This is taking longer than expected. Please try again.', { code: 'TIMEOUT' });
    }

    if (error instanceof TypeError) {
      throw new ApiError('Could not connect. Check your internet connection and try again.', { code: 'NETWORK' });
    }

    throw error;
  }

  if (timeoutId !== null) {
    window.clearTimeout(timeoutId);
  }

  const rawText = await response.text();
  let parsed: any = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { error: rawText };
    }
  }

  if (!response.ok) {
    if (
      typeof window !== 'undefined'
      && parsed?.code
      && SERVICE_ERROR_CODES.has(String(parsed.code))
    ) {
      window.dispatchEvent(new CustomEvent('api:service-blocked', {
        detail: {
          code: String(parsed.code),
          message: userFacingErrorMessage(parsed?.error, 'Your service is currently unavailable. Please contact an administrator.'),
        },
      }));
    }

    const rawMessage = parsed?.error || `Request failed with status ${response.status}`;
    const fallback = response.status >= 500 ? GENERIC_ACTION_ERROR : 'We could not complete this request. Please try again.';
    throw new ApiError(userFacingErrorMessage(rawMessage, fallback), {
      status: response.status,
      code: parsed?.code || 'HTTP_ERROR',
    });
  }

  return parsed as T;
}
