import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ICONS } from '../constants';
import type { AppNotification, NotificationActionConfig, NotificationDecisionScope, NotificationDeploymentScope } from '../types';
import { useNotificationHistoryPage, usePermissionsSettings, useDeployments } from '../src/hooks/useQueries';
import { useCreateNotification } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { buildHistoryBackState } from '../src/utils/navigation';

const HISTORY_PAGE_SIZE = 12;

const toIsoString = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const formatDateTime = (value?: string | null): string => {
  if (!value) return 'Not set';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';

  return date.toLocaleString('en-BD', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
};

const stripHtml = (value: string): string =>
  value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const haveSameNotificationSnapshot = (left: AppNotification[], right: AppNotification[]): boolean => {
  if (left === right) return true;
  if (left.length !== right.length) return false;

  for (let index = 0; index < left.length; index += 1) {
    const current = left[index];
    const next = right[index];
    if (
      current.id !== next.id
      || current.subject !== next.subject
      || current.updatedAt !== next.updatedAt
      || current.createdAt !== next.createdAt
      || current.isActive !== next.isActive
      || current.actionConfig?.kind !== next.actionConfig?.kind
    ) {
      return false;
    }
  }

  return true;
};

const getActionLabel = (actionConfig?: NotificationActionConfig | null): string => {
  switch (actionConfig?.kind) {
    case 'link':
      return 'Link';
    case 'decision':
      return 'Decision';
    case 'link_and_decision':
      return 'Link + decision';
    default:
      return 'No action';
  }
};

const getDecisionScopeLabel = (scope?: NotificationDecisionScope): string => {
  if (scope === 'single_user') return 'One admin click is enough';
  return 'Every admin must respond';
};

const getActionPreviewNote = (form: {
  actionKind: 'none' | 'link' | 'decision' | 'link_and_decision';
  decisionMode: 'record_only' | 'transaction_approval';
  decisionScope: NotificationDecisionScope;
}): string => {
  if (form.actionKind === 'none') return 'No action buttons will be shown.';
  if (form.decisionMode === 'transaction_approval') return 'This notification resolves as soon as one admin-access reviewer acts.';
  if (form.actionKind === 'decision' || form.actionKind === 'link_and_decision') {
    return getDecisionScopeLabel(form.decisionScope);
  }
  return 'Recipients will see a link action.';
};

const DeveloperNotifications: React.FC = () => {
  const toast = useToastNotifications();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: permissionsSettings } = usePermissionsSettings(true);
  const { data: deployments, isLoading: isLoadingDeployments } = useDeployments(true);
  const createNotificationMutation = useCreateNotification();
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyItems, setHistoryItems] = useState<AppNotification[]>([]);
  const [deploymentSearch, setDeploymentSearch] = useState('');
  const [form, setForm] = useState({
    subject: '',
    contentHtml: '<p></p>',
    targetRoles: ['Admin'],
    scheduleMode: 'instant' as 'instant' | 'scheduled',
    startsAt: '',
    actionKind: 'none' as 'none' | 'link' | 'decision' | 'link_and_decision',
    linkLabel: 'Open',
    linkUrl: '',
    acceptLabel: 'Accept',
    declineLabel: 'Decline',
    decisionMode: 'record_only' as 'record_only' | 'transaction_approval',
    decisionScope: 'all_users' as NotificationDecisionScope,
    targetDeployments: [] as string[],
    deploymentScope: 'all' as NotificationDeploymentScope,
  });

  const roles = useMemo(() => {
    const roleSet = new Set<string>(['Admin', 'Developer']);
    (permissionsSettings?.roles || []).forEach((role) => {
      if (role?.roleName) roleSet.add(role.roleName);
    });
    return Array.from(roleSet).sort((left, right) => {
      const priority = ['Admin', 'Developer'];
      const leftIndex = priority.indexOf(left);
      const rightIndex = priority.indexOf(right);
      if (leftIndex >= 0 || rightIndex >= 0) {
        return (leftIndex >= 0 ? leftIndex : 99) - (rightIndex >= 0 ? rightIndex : 99);
      }
      return left.localeCompare(right);
    });
  }, [permissionsSettings]);

  const {
    data: firstHistoryPage,
    isFetching: isFirstHistoryFetching,
    isError: isFirstHistoryError,
    error: firstHistoryError,
  } = useNotificationHistoryPage(1, HISTORY_PAGE_SIZE, {
    enabled: true,
    staleTime: 10 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
  });

  const {
    data: nextHistoryPage,
    isFetching: isNextHistoryFetching,
    isError: isNextHistoryError,
    error: nextHistoryError,
  } = useNotificationHistoryPage(historyPage, HISTORY_PAGE_SIZE, {
    enabled: historyPage > 1,
    staleTime: 10 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchOnMount: 'always',
  });

  const isDecisionAction = form.actionKind === 'decision' || form.actionKind === 'link_and_decision';
  const isLinkAction = form.actionKind === 'link' || form.actionKind === 'link_and_decision';
  const isAdminViewerNotification =
    form.targetRoles.length > 0
    && form.targetRoles.includes('Admin')
    && form.targetRoles.every((role) => role === 'Admin' || role === 'Developer');

  const historyTotalPages = nextHistoryPage?.totalPages ?? firstHistoryPage?.totalPages ?? 0;
  const historyHasMore = historyPage < historyTotalPages;

  useEffect(() => {
    if (!firstHistoryPage?.items) return;

    setHistoryItems((prev) => {
      const firstPageIds = new Set(firstHistoryPage.items.map((item) => item.id));
      const remainingItems = historyPage === 1
        ? []
        : prev.filter((item) => !firstPageIds.has(item.id));
      const next = [...firstHistoryPage.items, ...remainingItems];
      return haveSameNotificationSnapshot(prev, next) ? prev : next;
    });
  }, [firstHistoryPage, historyPage]);

  useEffect(() => {
    if (historyPage === 1 || !nextHistoryPage?.items) return;

    setHistoryItems((prev) => {
      const existingIds = new Set(prev.map((item) => item.id));
      const onlyNew = nextHistoryPage.items.filter((item) => !existingIds.has(item.id));
      if (onlyNew.length === 0) {
        return prev;
      }
      return [...prev, ...onlyNew];
    });
  }, [historyPage, nextHistoryPage]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !historyHasMore || isNextHistoryFetching) return;

    const mainRoot = document.querySelector('main');
    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) return;
        setHistoryPage((current) => (current < historyTotalPages ? current + 1 : current));
      },
      {
        root: mainRoot instanceof HTMLElement ? mainRoot : null,
        rootMargin: '0px 0px 240px 0px',
        threshold: 0.1,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [historyHasMore, historyTotalPages, isNextHistoryFetching]);

  const toggleRole = (roleName: string) => {
    setForm((current) => {
      const exists = current.targetRoles.includes(roleName);
      const targetRoles = exists
        ? current.targetRoles.filter((role) => role !== roleName)
        : [...current.targetRoles, roleName];
      const nextIsAdminViewerNotification =
        targetRoles.length > 0
        && targetRoles.includes('Admin')
        && targetRoles.every((role) => role === 'Admin' || role === 'Developer');

      return {
        ...current,
        targetRoles,
        decisionScope: nextIsAdminViewerNotification ? current.decisionScope : 'all_users',
      };
    });
  };

  const toggleDeployment = (licenseKey: string) => {
    setForm((current) => {
      const exists = current.targetDeployments.includes(licenseKey);
      const targetDeployments = exists
        ? current.targetDeployments.filter((key) => key !== licenseKey)
        : [...current.targetDeployments, licenseKey];
      return { ...current, targetDeployments };
    });
  };

  const filteredDeployments = useMemo(() => {
    if (!deployments) return [];
    if (!deploymentSearch.trim()) return deployments;
    const q = deploymentSearch.trim().toLowerCase();
    return deployments.filter(
      (d) =>
        d.clientName.toLowerCase().includes(q) ||
        d.licenseKey.toLowerCase().includes(q) ||
        (d.domain && d.domain.toLowerCase().includes(q)),
    );
  }, [deployments, deploymentSearch]);

  const handleSubmit = async () => {
    if (!form.subject.trim()) {
      toast.error('Subject is required.');
      return;
    }
    if (!form.contentHtml.trim()) {
      toast.error('Content is required.');
      return;
    }
    if (form.targetRoles.length === 0) {
      toast.error('Select at least one viewer role.');
      return;
    }

    if ((form.deploymentScope === 'include' || form.deploymentScope === 'exclude') && form.targetDeployments.length === 0) {
      toast.error('Select at least one deployment.');
      return;
    }

    const startsAt = form.scheduleMode === 'scheduled' ? toIsoString(form.startsAt) : null;
    if (form.scheduleMode === 'scheduled' && !startsAt) {
      toast.error('Please choose a valid scheduled time.');
      return;
    }

    if (isLinkAction && !form.linkUrl.trim()) {
      toast.error('Link URL is required for link actions.');
      return;
    }

    try {
      await createNotificationMutation.mutateAsync({
        subject: form.subject.trim(),
        contentHtml: form.contentHtml,
        targetRoles: form.targetRoles,
        startsAt,
        targetDeployments: form.deploymentScope !== 'all' ? form.targetDeployments : [],
        deploymentScope: form.deploymentScope,
        actionConfig: {
          kind: form.actionKind,
          linkLabel: form.linkLabel.trim() || 'Open',
          linkUrl: form.linkUrl.trim() || undefined,
          acceptLabel: form.acceptLabel.trim() || 'Accept',
          declineLabel: form.declineLabel.trim() || 'Decline',
          decisionMode: form.decisionMode,
          decisionScope: form.decisionMode === 'transaction_approval'
            ? 'single_user'
            : (isAdminViewerNotification ? form.decisionScope : 'all_users'),
        },
      });

      toast.success('Notification created successfully.');
      setHistoryPage(1);
      setForm((current) => ({
        ...current,
        subject: '',
        contentHtml: '<p></p>',
        linkUrl: '',
        startsAt: '',
        decisionScope: 'all_users',
        targetDeployments: [],
        deploymentScope: 'all',
      }));
      setDeploymentSearch('');
    } catch (error) {
      console.error('Failed to create notification:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create notification.');
    }
  };

  const openDetail = (notificationId: string) => {
    navigate(`/developer/notifications/${notificationId}`, {
      state: buildHistoryBackState(location),
    });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-[1.75rem] border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-lg font-black text-gray-900">Create Notification</h3>
            <p className="mt-1 text-sm text-gray-500">
              Supports HTML content, internal links, and decision actions with admin review requirements.
            </p>
          </div>
          <button
            onClick={handleSubmit}
            disabled={createNotificationMutation.isPending}
            className="rounded-xl bg-[var(--primary-color,#0f2f57)] px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-[var(--primary-dark,#0c203b)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {createNotificationMutation.isPending ? 'Sending...' : 'Send Now'}
          </button>
        </div>

        <div className="mt-6 space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-gray-400">Subject</label>
            <input
              type="text"
              value={form.subject}
              onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))}
              className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
              placeholder="Title"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-gray-400">Viewer Roles</label>
            <div className="flex flex-wrap gap-2">
              {roles.map((roleName) => {
                const selected = form.targetRoles.includes(roleName);
                return (
                  <button
                    key={roleName}
                    type="button"
                    onClick={() => toggleRole(roleName)}
                    className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] transition-all ${
                      selected
                        ? 'bg-[var(--primary-color,#0f2f57)] text-white'
                        : 'border border-gray-200 bg-white text-gray-500 hover:border-[var(--primary-medium,#3c5a82)] hover:bg-[var(--primary-soft,#ebf4ff)] hover:text-[var(--primary-color,#0f2f57)]'
                    }`}
                  >
                    {roleName}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-[1.35rem] border border-gray-100 bg-gray-50/80 p-4 space-y-3">
            <label className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Target Deployments</label>
            <p className="text-sm text-gray-500">Choose which deployments receive this notification.</p>
            <div className="flex flex-wrap gap-2">
              {(['all', 'include', 'exclude'] as NotificationDeploymentScope[]).map((scope) => {
                const selected = form.deploymentScope === scope;
                const label = scope === 'all' ? 'All deployments' : scope === 'include' ? 'Specific deployments' : 'All except specific';
                return (
                  <button
                    key={scope}
                    type="button"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        deploymentScope: scope,
                        targetDeployments: scope === 'all' ? [] : current.targetDeployments,
                      }))
                    }
                    className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] transition-all ${
                      selected
                        ? 'bg-[var(--primary-color,#0f2f57)] text-white'
                        : 'border border-gray-200 bg-white text-gray-500 hover:border-[var(--primary-medium,#3c5a82)] hover:bg-[var(--primary-soft,#ebf4ff)] hover:text-[var(--primary-color,#0f2f57)]'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {(form.deploymentScope === 'include' || form.deploymentScope === 'exclude') && (
              <div className="space-y-3 pt-1">
                <input
                  type="text"
                  value={deploymentSearch}
                  onChange={(e) => setDeploymentSearch(e.target.value)}
                  placeholder="Search deployments..."
                  className="w-full rounded-xl border border-gray-100 bg-white px-4 py-2.5 text-sm font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
                />
                {isLoadingDeployments ? (
                  <p className="py-3 text-center text-sm font-medium text-gray-400">Loading deployments...</p>
                ) : filteredDeployments.length === 0 ? (
                  <p className="py-3 text-center text-sm font-medium text-gray-400">No deployments found.</p>
                ) : (
                  <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                    {filteredDeployments.map((deployment) => {
                      const selected = form.targetDeployments.includes(deployment.licenseKey);
                      return (
                        <button
                          key={deployment.licenseKey}
                          type="button"
                          onClick={() => toggleDeployment(deployment.licenseKey)}
                          className={`w-full rounded-xl px-4 py-3 text-left transition-all ${
                            selected
                              ? 'border-2 border-[var(--primary-color,#0f2f57)] bg-[var(--primary-soft,#ebf4ff)]'
                              : 'border border-gray-200 bg-white hover:border-[var(--primary-medium,#3c5a82)] hover:bg-[var(--primary-soft,#ebf4ff)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-gray-900">{deployment.clientName}</p>
                              <p className="mt-0.5 truncate text-[10px] font-medium tracking-wide text-gray-400">{deployment.licenseKey}</p>
                            </div>
                            <span
                              className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 transition-all ${
                                selected
                                  ? 'border-[var(--primary-color,#0f2f57)] bg-[var(--primary-color,#0f2f57)]'
                                  : 'border-gray-300 bg-white'
                              }`}
                            >
                              {selected && (
                                <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-gray-400">Show Time</label>
              <select
                value={form.scheduleMode}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scheduleMode: event.target.value as 'instant' | 'scheduled',
                  }))
                }
                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
              >
                <option value="instant">Instant</option>
                <option value="scheduled">Scheduled</option>
              </select>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-xs font-black uppercase tracking-widest text-gray-400">Starts At</label>
              <input
                type="datetime-local"
                value={form.startsAt}
                onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))}
                disabled={form.scheduleMode === 'instant'}
                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-gray-400">HTML Content</label>
            <textarea
              value={form.contentHtml}
              onChange={(event) => setForm((current) => ({ ...current, contentHtml: event.target.value }))}
              className="min-h-[220px] w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-mono text-sm outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-gray-400">Action Type</label>
              <select
                value={form.actionKind}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    actionKind: event.target.value as 'none' | 'link' | 'decision' | 'link_and_decision',
                    decisionScope: event.target.value === 'none' || event.target.value === 'link' ? 'all_users' : current.decisionScope,
                  }))
                }
                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
              >
                <option value="none">No action</option>
                <option value="link">Link only</option>
                <option value="decision">Accept / Decline only</option>
                <option value="link_and_decision">Link + Accept / Decline</option>
              </select>
            </div>
          </div>

          {isDecisionAction && form.decisionMode !== 'transaction_approval' && isAdminViewerNotification && (
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-gray-400">Admin Action Requirement</label>
              <select
                value={form.decisionScope}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    decisionScope: event.target.value as NotificationDecisionScope,
                  }))
                }
                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
              >
                <option value="single_user">One admin click is enough</option>
                <option value="all_users">Every admin must respond individually</option>
              </select>
            </div>
          )}

          {isLinkAction && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-gray-400">Link Label</label>
                <input
                  type="text"
                  value={form.linkLabel}
                  onChange={(event) => setForm((current) => ({ ...current, linkLabel: event.target.value }))}
                  className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-gray-400">Link URL</label>
                <input
                  type="text"
                  value={form.linkUrl}
                  onChange={(event) => setForm((current) => ({ ...current, linkUrl: event.target.value }))}
                  placeholder="/subscriptions"
                  className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
                />
              </div>
            </div>
          )}

          {isDecisionAction && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-gray-400">Accept Label</label>
                <input
                  type="text"
                  value={form.acceptLabel}
                  onChange={(event) => setForm((current) => ({ ...current, acceptLabel: event.target.value }))}
                  className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-widest text-gray-400">Decline Label</label>
                <input
                  type="text"
                  value={form.declineLabel}
                  onChange={(event) => setForm((current) => ({ ...current, declineLabel: event.target.value }))}
                  className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
                />
              </div>
            </div>
          )}

          <div className="rounded-[1.5rem] border border-[#d8e6f5] bg-[linear-gradient(135deg,#f8fbff_0%,#eef5fd_100%)] p-5">
            <div className="flex items-center gap-3 border-b border-[#d9e7f5] pb-4">
              <span className="rounded-xl bg-white/90 p-3 text-[#0f2f57] shadow-sm">{ICONS.View}</span>
              <div>
                <h4 className="text-lg font-black text-gray-900">Live Preview</h4>
                <p className="text-sm text-gray-500">This block mirrors how the notification will appear in the notification center.</p>
              </div>
            </div>

            <div className="mt-5 rounded-[1.25rem] border border-[#c7dff5] bg-white/90 p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[#e6f0ff] px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#0f2f57]">
                  {(form.targetRoles || []).join(', ') || 'No roles selected'}
                </span>
                <span className="rounded-full bg-gray-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
                  {getActionLabel({
                    kind: form.actionKind,
                    decisionMode: form.decisionMode,
                    decisionScope: form.decisionScope,
                  })}
                </span>
                <span className="rounded-full bg-[#f0f4ff] px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-[#4b6a94]">
                  {form.deploymentScope === 'all'
                    ? 'All deployments'
                    : form.deploymentScope === 'include'
                      ? `${form.targetDeployments.length} deployment(s) selected`
                      : `All except ${form.targetDeployments.length} deployment(s)`}
                </span>
              </div>

              <p className="mt-4 text-base font-black text-gray-900">{form.subject || 'Notification subject'}</p>
              <div
                className="prose prose-sm mt-3 max-w-none text-sm text-gray-600 [&_a]:font-bold [&_a]:text-[#0f2f57] [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: form.contentHtml || '<p>No content yet.</p>' }}
              />

              {(isLinkAction || isDecisionAction) && (
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                  {isLinkAction && (
                    <span className="rounded-xl bg-[#0f2f57] px-3.5 py-2 text-xs font-black uppercase tracking-[0.18em] text-white">
                      {form.linkLabel || 'Open'}
                    </span>
                  )}
                  {isDecisionAction && (
                    <>
                      <span className="rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-black uppercase tracking-[0.18em] text-white">
                        {form.acceptLabel || 'Accept'}
                      </span>
                      <span className="rounded-xl bg-red-500 px-3.5 py-2 text-xs font-black uppercase tracking-[0.18em] text-white">
                        {form.declineLabel || 'Decline'}
                      </span>
                    </>
                  )}
                </div>
              )}

              <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-gray-400">
                {getActionPreviewNote(form)}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 border-b border-gray-100 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-lg font-black text-gray-900">Notification History</h3>
            <p className="text-sm text-gray-500">Click any notification to open a dedicated detail view with recipients and actions.</p>
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
            {firstHistoryPage?.total ?? historyItems.length} total
          </span>
        </div>

        <div className="mt-5 space-y-3">
          {isFirstHistoryFetching && historyItems.length === 0 ? (
            <div className="py-10 text-center text-sm font-medium text-gray-400">Loading notification history...</div>
          ) : isFirstHistoryError ? (
            <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-5 text-sm font-medium text-red-600">
              Failed to load notification history: {firstHistoryError?.message ?? 'Unknown error'}
            </div>
          ) : historyItems.length === 0 ? (
            <div className="py-10 text-center text-sm font-medium text-gray-400">No notifications created yet.</div>
          ) : (
            <>
              {historyItems.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => openDetail(notification.id)}
                  className="w-full rounded-[1.35rem] border border-gray-100 bg-gray-50/80 p-4 text-left transition-all hover:border-[#c7dff5] hover:bg-[#f8fbff] hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="truncate text-base font-black text-gray-900">{notification.subject}</p>
                      <p className="mt-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                        {(notification.targetRoles || []).join(', ') || 'No roles'}
                      </p>
                    </div>
                    <span className="rounded-full bg-white px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500 shadow-sm">
                      {getActionLabel(notification.actionConfig)}
                    </span>
                  </div>

                  <p className="mt-3 line-clamp-2 text-sm font-medium leading-6 text-gray-600">
                    {stripHtml(notification.contentHtml) || 'No content'}
                  </p>

                  <div className="mt-4 flex flex-col gap-2 text-xs font-medium text-gray-500 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                    <span>Created: {formatDateTime(notification.createdAt)}</span>
                    <span>Creator: {notification.createdByName || 'System'}</span>
                    {notification.actionConfig?.decisionMode && (
                      <span>
                        Decision: {notification.actionConfig.decisionMode === 'transaction_approval' ? 'Transaction approval' : 'Record only'}
                      </span>
                    )}
                    {notification.actionConfig?.decisionScope && (
                      <span>{getDecisionScopeLabel(notification.actionConfig.decisionScope)}</span>
                    )}
                  </div>
                </button>
              ))}

              {isNextHistoryFetching && historyPage > 1 && (
                <div className="py-3 text-center text-sm font-medium text-gray-400">Loading more notifications...</div>
              )}

              {isNextHistoryError && (
                <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 text-sm font-medium text-amber-700">
                  Failed to load more notifications: {nextHistoryError?.message ?? 'Unknown error'}
                </div>
              )}

              {!historyHasMore && historyItems.length > 0 && (
                <div className="py-3 text-center text-xs font-medium uppercase tracking-[0.18em] text-gray-400">
                  End of history
                </div>
              )}

              <div ref={loadMoreRef} className="h-2 w-full" />
            </>
          )}
        </div>
      </section>
    </div>
  );
};

export default DeveloperNotifications;
