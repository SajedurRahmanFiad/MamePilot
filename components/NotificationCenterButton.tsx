import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ICONS } from '../constants';
import type { AppNotification, NotificationDecision } from '../types';
import { useMyNotifications, useMyNotificationsPaginated } from '../src/hooks/useQueries';
import { useMarkNotificationRead, useRespondToNotification } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { buildHistoryBackState } from '../src/utils/navigation';
import { cacheReadReceipt, applyCachedReadState } from '../src/utils/readReceiptCache';
import { formatDate } from '../utils';

const formatNotificationTime = (value?: string | null): string => {
  if (!value) return 'Just now';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Just now';

  const diffMs = Date.now() - date.getTime();

  // If the timestamp is in the future (clock skew between servers), show "Just now".
  if (diffMs < 0) return 'Just now';

  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffMinutes < 1440) return `${Math.round(diffMinutes / 60)}h ago`;

  return formatDate(date);
};

const haveSameNotificationSnapshot = (left: AppNotification[], right: AppNotification[]): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];
    if (
      current.id !== next.id
      || current.subject !== next.subject
      || current.contentHtml !== next.contentHtml
      || current.isRead !== next.isRead
      || current.updatedAt !== next.updatedAt
      || current.createdAt !== next.createdAt
      || current.readAt !== next.readAt
      || current.actionResult !== next.actionResult
      || current.isActive !== next.isActive
      || current.actionConfig?.kind !== next.actionConfig?.kind
    ) {
      return false;
    }
  }

  return true;
};

const NotificationCenterButton: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const toast = useToastNotifications();
  const { data: unreadData } = useMyNotifications(true); // Keep for the badge count
  const markReadMutation = useMarkNotificationRead();
  const respondMutation = useRespondToNotification();
  const [isOpen, setIsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [allNotifications, setAllNotifications] = useState<AppNotification[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const seenNotificationIdsRef = useRef<Set<string>>(new Set());
  const knownNotificationIdsRef = useRef<Set<string>>(new Set());
  const hasInitializedNotificationFeedRef = useRef(false);
  const previousUnreadCountRef = useRef<number | null>(null);
  const attentionTimeoutRef = useRef<number | null>(null);
  const hasMoreRef = useRef(true);
  const isLoadingMoreRef = useRef(false);
  const [showAttentionCue, setShowAttentionCue] = useState(false);
  const markNotificationsSeen = markReadMutation.mutateAsync;

  const PAGE_SIZE = 10;

  const {
    data: firstPageData,
    isFetching: isFirstPageFetching,
    isError: isFirstPageError,
    error: firstPageError,
  } = useMyNotificationsPaginated(1, PAGE_SIZE, {
    enabled: isOpen,
    staleTime: 30 * 1000,
    refetchInterval: isOpen ? 20 * 1000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: true,
  });

  const {
    data: nextPageData,
    isFetching: isNextPageFetching,
    isError: isNextPageError,
    error: nextPageError,
  } = useMyNotificationsPaginated(page, PAGE_SIZE, {
    enabled: isOpen && page > 1,
  });

  const paginatedData = page === 1 ? firstPageData : nextPageData;
  const isPaginatedFetching = page === 1 ? isFirstPageFetching : isNextPageFetching;
  const isPaginatedError = page === 1 ? isFirstPageError : isNextPageError;
  const paginatedError = page === 1 ? firstPageError : nextPageError;
  const unreadCount = unreadData?.unreadCount ?? 0;

  const triggerAttentionCue = useCallback(() => {
    setShowAttentionCue(true);
    if (attentionTimeoutRef.current !== null) {
      window.clearTimeout(attentionTimeoutRef.current);
    }
    attentionTimeoutRef.current = window.setTimeout(() => {
      setShowAttentionCue(false);
      attentionTimeoutRef.current = null;
    }, 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (attentionTimeoutRef.current !== null) {
        window.clearTimeout(attentionTimeoutRef.current);
      }
    };
  }, []);

  // Keep the first page warm in memory so opening the panel is instant.
  useEffect(() => {
    if (!firstPageData?.items || page !== 1) return;

    setAllNotifications((prev) => {
      if (haveSameNotificationSnapshot(prev, firstPageData.items)) {
        return prev;
      }

      return applyCachedReadState(firstPageData.items);
    });

    hasMoreRef.current = firstPageData.page < firstPageData.totalPages;
    isLoadingMoreRef.current = false;
  }, [firstPageData, page]);

  useEffect(() => {
    if (!firstPageData?.items) return;

    const latestIds = firstPageData.items.map((notification) => notification.id);
    if (!hasInitializedNotificationFeedRef.current) {
      knownNotificationIdsRef.current = new Set(latestIds);
      hasInitializedNotificationFeedRef.current = true;
      return;
    }

    const newItems = firstPageData.items.filter((notification) => !knownNotificationIdsRef.current.has(notification.id));
    knownNotificationIdsRef.current = new Set([...knownNotificationIdsRef.current, ...latestIds]);

    if (newItems.length === 0) {
      return;
    }

    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      triggerAttentionCue();
    }

    if (newItems.some((notification) => notification.actionConfig?.decisionMode === 'transaction_approval')) {
      toast.info('A transaction needs admin approval');
    }
  }, [firstPageData, toast, triggerAttentionCue]);

  useEffect(() => {
    if (previousUnreadCountRef.current === null) {
      previousUnreadCountRef.current = unreadCount;
      return;
    }

    if (unreadCount > previousUnreadCountRef.current) {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        triggerAttentionCue();
      }
    }

    previousUnreadCountRef.current = unreadCount;
  }, [triggerAttentionCue, unreadCount]);

  // Append extra pages only when the panel is open and the user scrolls.
  useEffect(() => {
    if (!isOpen || page === 1 || !nextPageData?.items) return;

    setAllNotifications((prev) => {
      const existingIds = new Set(prev.map((notification) => notification.id));
      const onlyNew = nextPageData.items.filter((notification) => !existingIds.has(notification.id));
      if (onlyNew.length === 0) {
        return prev;
      }

      return applyCachedReadState([...prev, ...onlyNew]);
    });

    hasMoreRef.current = nextPageData.page < nextPageData.totalPages;
    isLoadingMoreRef.current = false;
  }, [isOpen, nextPageData, page]);

  // Handle infinite scroll
  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const scrollTop = target.scrollTop;
    const clientHeight = target.clientHeight;
    const scrollHeight = target.scrollHeight;

    // Trigger load when user scrolls near the bottom
    if (scrollHeight - (scrollTop + clientHeight) < 100 && !isLoadingMoreRef.current && hasMoreRef.current) {
      isLoadingMoreRef.current = true;
      setPage((prev) => prev + 1);
    }
  }, []);

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setPage(1);
      setAllNotifications((prev) => {
        const next = applyCachedReadState(firstPageData?.items ?? []);
        return haveSameNotificationSnapshot(prev, next) ? prev : next;
      });
      seenNotificationIdsRef.current.clear();
      hasMoreRef.current = firstPageData ? firstPageData.page < firstPageData.totalPages : true;
      isLoadingMoreRef.current = false;
    }
  }, [firstPageData, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isOpen]);

  useEffect(() => {
    let mounted = true;
    let channel: BroadcastChannel | null = null;

    const syncNotifications = () => {
      if (!mounted) return;
      queryClient.invalidateQueries({ queryKey: ['notifications'], exact: false, refetchInactive: true });
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'app:notifications-updated-at') {
        syncNotifications();
      }
    };

    const handleWindowUpdate = () => {
      syncNotifications();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('app:notifications-updated', handleWindowUpdate);

    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('app-notifications');
      channel.addEventListener('message', handleWindowUpdate);
    }

    return () => {
      mounted = false;
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('app:notifications-updated', handleWindowUpdate);
      channel?.removeEventListener('message', handleWindowUpdate);
      channel?.close();
    };
  }, [queryClient]);

  // Mark newly visible notifications as read
  useEffect(() => {
    if (!isOpen) return;

    const unseenIds = allNotifications
      .map((notification) => notification.id)
      .filter((notificationId) => !seenNotificationIdsRef.current.has(notificationId));

    if (unseenIds.length === 0) {
      return;
    }

    unseenIds.forEach((notificationId) => seenNotificationIdsRef.current.add(notificationId));
    const readAt = new Date().toISOString();
    
    setAllNotifications((current) =>
      current.map((notification) =>
        unseenIds.includes(notification.id)
          ? {
              ...notification,
              isRead: true,
              readAt: notification.readAt || readAt,
            }
          : notification,
      )
    );

    void markNotificationsSeen({ notificationIds: unseenIds }).catch((error) => {
      unseenIds.forEach((notificationId) => seenNotificationIdsRef.current.delete(notificationId));
      console.error('Failed to mark notifications as seen:', error);
    });
  }, [isOpen, allNotifications, markNotificationsSeen]);

  const pendingDecisionId = useMemo(() => {
    if (!respondMutation.variables?.notificationId) return null;
    return respondMutation.variables.notificationId;
  }, [respondMutation.variables]);

  const markAsRead = async (notification: AppNotification) => {
    if (notification.isRead || seenNotificationIdsRef.current.has(notification.id)) return;

    seenNotificationIdsRef.current.add(notification.id);
    cacheReadReceipt(notification.id);
    const readAt = new Date().toISOString();
    setAllNotifications((current) =>
      current.map((item) =>
        item.id === notification.id
          ? {
              ...item,
              isRead: true,
              readAt: item.readAt || readAt,
            }
          : item,
      )
    );

    try {
      await markNotificationsSeen({ notificationId: notification.id });
    } catch (error) {
      seenNotificationIdsRef.current.delete(notification.id);
      console.error('Failed to mark notification as read:', error);
    }
  };

  const openNotificationLink = async (notification: AppNotification, url?: string) => {
    await markAsRead(notification);

    const href = String(url || '').trim();
    if (!href) return;

    setIsOpen(false);

    if (/^https?:\/\//i.test(href)) {
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }

    navigate(href, { state: buildHistoryBackState(location) });
  };

  const handleDecision = async (notification: AppNotification, decision: NotificationDecision) => {
    try {
      await respondMutation.mutateAsync({
        notificationId: notification.id,
        decision,
      });
      toast.success(decision === 'accepted' ? 'Notification accepted.' : 'Notification declined.');
    } catch (error) {
      console.error('Failed to respond to notification:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to process notification.');
    }
  };

  const handleContentClick =
    (notification: AppNotification) =>
    async (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href') || '';
      if (!href) return;

      event.preventDefault();
      await openNotificationLink(notification, href);
    };

  return (
    <div className="relative" ref={containerRef}>
      {showAttentionCue && !isOpen && (
        <>
          <span className="pointer-events-none absolute inset-0 z-0 rounded-xl ring-4 ring-[#0f2f57]/15 animate-pulse" />
          <div className="pointer-events-none absolute right-0 top-full z-50 mt-2 rounded-md bg-[#0f2f57] px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] text-white shadow-[0_18px_40px_rgba(15,47,87,0.25)]">
            New notification
          </div>
        </>
      )}
      <button
        onClick={() => setIsOpen((current) => !current)}
        className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-xl border bg-white transition-all hover:bg-[#ebf4ff] hover:text-[#0f2f57] ${
          showAttentionCue
            ? 'border-[#c7dff5] text-[#0f2f57] shadow-[0_12px_30px_rgba(15,47,87,0.16)]'
            : 'border-gray-100 text-gray-600'
        }`}
        title="Notifications"
      >
        {ICONS.Bell}
        {unreadCount > 0 && (
          <span className={`absolute -right-1 -top-1 min-w-[18px] rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[10px] font-black leading-none text-white ${
            showAttentionCue ? 'animate-pulse' : ''
          }`}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div className="fixed inset-x-0 top-0 z-50 flex h-[100dvh] flex-col overflow-hidden bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-[0_30px_80px_rgba(15,47,87,0.18)] sm:absolute sm:right-0 sm:left-auto sm:top-full sm:mt-3 sm:h-auto sm:max-h-[70vh] sm:w-[380px] sm:max-w-[calc(100vw-2rem)] sm:overflow-hidden sm:rounded-[1.5rem] sm:border sm:border-[#e4eef8] sm:pt-0 sm:pb-0">
            <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-4 py-4 sm:px-5">
              <div>
                <h3 className="mt-1 text-lg font-black text-gray-900">All Notifications</h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-full p-2 text-gray-400 transition-all hover:bg-gray-100 hover:text-gray-700"
                title="Close"
              >
                {ICONS.Close}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 sm:px-3 sm:py-3" ref={scrollContainerRef} onScroll={handleScroll}>
              {page === 1 && isPaginatedFetching && allNotifications.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm font-medium text-gray-400">Loading notifications...</div>
              ) : isPaginatedError ? (
                <div className="px-3 py-10 text-center text-sm font-medium text-red-500">
                  Failed to load notifications: {paginatedError?.message ?? 'Unknown error'}
                </div>
              ) : allNotifications.length === 0 ? (
                <div className="px-3 py-10 text-center text-sm font-medium text-gray-400">No notifications yet.</div>
              ) : (
                <>
                  <div className="space-y-3">
                    {allNotifications.map((notification) => {
                      const actionConfig = notification.actionConfig || { kind: 'none' };
                      const canDecide = ['decision', 'link_and_decision'].includes(actionConfig.kind);
                      const canLink = ['link', 'link_and_decision'].includes(actionConfig.kind) && actionConfig.linkUrl;
                      const isPendingDecision = pendingDecisionId === notification.id && respondMutation.isPending;

                      return (
                        <div
                          key={notification.id}
                          className={`rounded-[1.25rem] border px-3 py-3 transition-all sm:px-4 sm:py-4 ${
                            notification.isRead
                              ? 'border-gray-100 bg-gray-50/60'
                              : 'border-[#c7dff5] bg-[#f8fbff] shadow-sm'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                {!notification.isRead && <span className="h-2.5 w-2.5 rounded-full bg-[#0f2f57]" />}
                                <p className="break-words text-sm font-black text-gray-900 sm:truncate">{notification.subject}</p>
                              </div>
                              <p className="mt-1 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                                {formatNotificationTime(notification.updatedAt || notification.createdAt)}
                              </p>
                            </div>
                            {notification.actionResult && (
                            <span
                              className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                                notification.actionResult === 'accepted'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-red-50 text-red-700'
                              }`}
                            >
                              {notification.actionResult}
                            </span>
                          )}
                        </div>

                        <div
                          className="prose prose-sm mt-3 max-w-none break-words text-sm text-gray-600 [&_a]:break-all [&_a]:font-bold [&_a]:text-[#0f2f57] [&_a]:underline [&_p]:my-1"
                          dangerouslySetInnerHTML={{ __html: notification.contentHtml }}
                          onClick={handleContentClick(notification)}
                        />

                        {(canLink || canDecide) && (
                          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                            {canLink && (
                              <button
                                onClick={() => openNotificationLink(notification, actionConfig.linkUrl)}
                                className="w-full rounded-xl bg-[#0f2f57] px-3.5 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-[#143b6d] sm:w-auto"
                              >
                                {actionConfig.linkLabel || 'Open'}
                              </button>
                            )}

                            {canDecide && !notification.actionResult && (
                              <>
                                <button
                                  onClick={() => handleDecision(notification, 'accepted')}
                                  disabled={isPendingDecision}
                                  className="w-full rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                                >
                                  {actionConfig.acceptLabel || 'Accept'}
                                </button>
                                <button
                                  onClick={() => handleDecision(notification, 'declined')}
                                  disabled={isPendingDecision}
                                  className="w-full rounded-xl bg-red-500 px-3.5 py-2 text-xs font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                                >
                                  {actionConfig.declineLabel || 'Decline'}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                  {isPaginatedFetching && page > 1 && (
                    <div className="py-3 text-center text-sm font-medium text-gray-400">Loading more...</div>
                  )}
                  {hasMoreRef.current === false && allNotifications.length > 0 && (
                    <div className="py-3 text-center text-xs font-medium text-gray-400">No more notifications</div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default NotificationCenterButton;
