const STORAGE_KEY = 'mamepilot:read-receipts';
const MAX_AGE_DAYS = 7;

interface ReadEntry {
  readAt: string;
}

interface ReadCache {
  [notificationId: string]: ReadEntry;
}

function loadCache(): ReadCache {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveCache(cache: ReadCache): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function pruneCache(cache: ReadCache): ReadCache {
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const pruned: ReadCache = {};
  for (const [id, entry] of Object.entries(cache)) {
    const ts = new Date(entry.readAt).getTime();
    if (!Number.isNaN(ts) && ts > cutoff) {
      pruned[id] = entry;
    }
  }
  return pruned;
}

/** Mark a notification as read in localStorage immediately. */
export function cacheReadReceipt(notificationId: string): void {
  const cache = loadCache();
  cache[notificationId] = { readAt: new Date().toISOString() };
  saveCache(pruneCache(cache));
}

/** Mark multiple notifications as read in localStorage. */
export function cacheReadReceipts(notificationIds: string[]): void {
  if (notificationIds.length === 0) return;
  const now = new Date().toISOString();
  const cache = loadCache();
  for (const id of notificationIds) {
    cache[id] = { readAt: now };
  }
  saveCache(pruneCache(cache));
}

/** Check if a notification has been locally cached as read. */
export function isCachedRead(notificationId: string): boolean {
  const cache = loadCache();
  return notificationId in cache;
}

/** Get the cached read-at timestamp, if any. */
export function getCachedReadAt(notificationId: string): string | null {
  const cache = loadCache();
  return cache[notificationId]?.readAt ?? null;
}

/** Apply cached read state to a list of notifications. Returns a new array. */
export function applyCachedReadState<T extends { id: string; isRead?: boolean; readAt?: string | null }>(
  notifications: T[],
): T[] {
  const cache = loadCache();
  let changed = false;
  const result = notifications.map((n) => {
    if (!n.isRead && cache[n.id]) {
      changed = true;
      return { ...n, isRead: true, readAt: n.readAt || cache[n.id].readAt };
    }
    return n;
  });
  return changed ? result : notifications;
}