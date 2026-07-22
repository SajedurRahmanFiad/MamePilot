import type { AppNotification, NotificationListPageResponse, NotificationListResponse } from '../../types';

const SYSTEM_DEFAULTS_KEY = 'mamepilot:system-defaults:v1';
const NOTIFICATIONS_PREFIX = 'mamepilot:notifications:v1';
const GLOBAL_BRANDING_KEY = 'mamepilot:global-branding:v1';

type CacheEntry<T> = {
  cachedAt: number;
  data: T;
};

export type SystemDefaultsSnapshot = {
  defaultAccountId: string;
  defaultPaymentMethod: string;
  incomeCategoryId: string;
  expenseCategoryId: string;
  recordsPerPage: number;
  maxTransactionAmount: number;
  whiteLabel: boolean;
  themeColor: string;
};

function readEntry<T>(key: string): CacheEntry<T> | null {
  if (typeof window === 'undefined') return null;

  try {
    const parsed = JSON.parse(localStorage.getItem(key) || 'null') as CacheEntry<T> | null;
    if (!parsed || typeof parsed.cachedAt !== 'number' || !parsed.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeEntry<T>(key: string, data: T): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), data } satisfies CacheEntry<T>));
  } catch {
    // Cache failures must never block the live API path.
  }
}

function notificationKey(userId: string, role: string, kind: 'summary' | 'first-page'): string {
  return `${NOTIFICATIONS_PREFIX}:${encodeURIComponent(userId)}:${encodeURIComponent(role)}:${kind}`;
}

export function readSystemDefaultsCache(): CacheEntry<SystemDefaultsSnapshot> | null {
  return readEntry<SystemDefaultsSnapshot>(SYSTEM_DEFAULTS_KEY);
}

export function writeSystemDefaultsCache(data: SystemDefaultsSnapshot): void {
  writeEntry(SYSTEM_DEFAULTS_KEY, data);
}

export function readGlobalBrandingCache(): CacheEntry<{ name: string; logo: string; version: string }> | null {
  return readEntry(GLOBAL_BRANDING_KEY);
}

export function writeGlobalBrandingCache(data: { name: string; logo: string; version: string }): void {
  writeEntry(GLOBAL_BRANDING_KEY, data);
}

export function readNotificationSummaryCache(userId: string, role: string): CacheEntry<NotificationListResponse> | null {
  return readEntry<NotificationListResponse>(notificationKey(userId, role, 'summary'));
}

export function writeNotificationSummaryCache(userId: string, role: string, data: NotificationListResponse): void {
  writeEntry(notificationKey(userId, role, 'summary'), data);
}

export function readNotificationFirstPageCache(userId: string, role: string): CacheEntry<NotificationListPageResponse> | null {
  return readEntry<NotificationListPageResponse>(notificationKey(userId, role, 'first-page'));
}

export function writeNotificationFirstPageCache(userId: string, role: string, data: NotificationListPageResponse): void {
  writeEntry(notificationKey(userId, role, 'first-page'), data);
}

export function prependNotificationToCaches(userId: string, role: string, notification: AppNotification): void {
  const summary = readNotificationSummaryCache(userId, role);
  if (summary) {
    const items = [notification, ...summary.data.items.filter((item) => item.id !== notification.id)];
    writeNotificationSummaryCache(userId, role, {
      ...summary.data,
      items,
      unreadCount: items.filter((item) => !item.isRead).length,
    });
  }

  const firstPage = readNotificationFirstPageCache(userId, role);
  if (firstPage) {
    const pageSize = Math.max(1, firstPage.data.pageSize || 10);
    const items = [notification, ...firstPage.data.items.filter((item) => item.id !== notification.id)].slice(0, pageSize);
    writeNotificationFirstPageCache(userId, role, {
      ...firstPage.data,
      items,
      total: Math.max(firstPage.data.total, items.length),
    });
  }
}
