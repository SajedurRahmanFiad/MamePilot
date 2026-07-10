import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ICONS } from '../constants';
import type { NotificationActionConfig, NotificationDecisionScope, NotificationDeploymentRecipient, NotificationRecipient } from '../types';
import { useNotificationById } from '../src/hooks/useQueries';
import { getPreservedRouteState } from '../src/utils/navigation';

const formatDateTime = (value?: string | null): string => {
  if (!value) return 'Not set';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not set';

  return date.toLocaleString('en-BD', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
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
  if (scope === 'all_users') return 'Every admin must respond';
  return 'Not applicable';
};

const getRecipientStatus = (recipient: NotificationRecipient | NotificationDeploymentRecipient): { label: string; className: string } => {
  if (recipient.actionResult === 'accepted') {
    return { label: 'Accepted', className: 'bg-emerald-50 text-emerald-700' };
  }
  if (recipient.actionResult === 'declined') {
    return { label: 'Declined', className: 'bg-red-50 text-red-700' };
  }
  if (recipient.isRead) {
    return { label: 'Read', className: 'bg-blue-50 text-blue-700' };
  }
  return { label: 'Pending', className: 'bg-gray-100 text-gray-500' };
};

const NotificationDetail: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError, error } = useNotificationById(id);
  const backState = getPreservedRouteState(location.state);

  const handleBack = () => {
    if (backState.backMode === 'history' && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(backState.from || '/developer/notifications');
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl py-10 text-center text-sm font-medium text-gray-400">
        Loading notification details...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-600 transition-all hover:border-[#c7dff5] hover:text-[#0f2f57]"
        >
          <span className="rotate-180">{ICONS.ChevronRight}</span>
          Back to history
        </button>
        <div className="rounded-[1.5rem] border border-red-100 bg-red-50 px-5 py-6 text-sm font-medium text-red-600">
          Failed to load notification details: {error?.message ?? 'Unknown error'}
        </div>
      </div>
    );
  }

  if (!data?.notification) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-600 transition-all hover:border-[#c7dff5] hover:text-[#0f2f57]"
        >
          <span className="rotate-180">{ICONS.ChevronRight}</span>
          Back to history
        </button>
        <div className="rounded-[1.5rem] border border-gray-100 bg-white px-5 py-6 text-sm font-medium text-gray-500">
          Notification not found.
        </div>
      </div>
    );
  }

  const { notification, recipients, summary, deployments } = data;
  const actionConfig = notification.actionConfig || { kind: 'none' as const };
  const linkUrl = actionConfig.linkUrl?.trim();

  // Filter state
  const [filterDeployment, setFilterDeployment] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [filterReadDateMode, setFilterReadDateMode] = useState<'on' | 'before' | 'after'>('on');
  const [filterReadDate, setFilterReadDate] = useState('');

  const activeFilterCount = [
    filterDeployment,
    filterRole,
    filterAction,
    filterReadDate,
  ].filter(Boolean).length;

  const clearAllFilters = () => {
    setFilterDeployment('');
    setFilterRole('');
    setFilterAction('');
    setFilterReadDateMode('on');
    setFilterReadDate('');
  };

  // Dynamically build unique roles from recipients
  const uniqueRoles = useMemo(() => {
    const roles = new Set<string>();
    (recipients ?? []).forEach((r) => {
      if (r.userRole) roles.add(r.userRole);
    });
    return Array.from(roles).sort();
  }, [recipients]);

  // Filter recipients
  const filteredRecipients = useMemo(() => {
    let list = recipients ?? [];

    if (filterDeployment) {
      list = list.filter(
        (r) => (r as NotificationDeploymentRecipient).deploymentKey === filterDeployment,
      );
    }

    if (filterRole) {
      list = list.filter((r) => r.userRole === filterRole);
    }

    if (filterAction) {
      list = list.filter((r) => {
        const status = getRecipientStatus(r);
        return status.label.toLowerCase() === filterAction.toLowerCase();
      });
    }

    if (filterReadDate) {
      const target = new Date(filterReadDate);
      if (!Number.isNaN(target.getTime())) {
        const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
        list = list.filter((r) => {
          if (!r.readAt) return false;
          const readDate = new Date(r.readAt);
          const readDay = new Date(readDate.getFullYear(), readDate.getMonth(), readDate.getDate());
          if (filterReadDateMode === 'on') return readDay.getTime() === targetDay.getTime();
          if (filterReadDateMode === 'before') return readDay.getTime() < targetDay.getTime();
          return readDay.getTime() > targetDay.getTime();
        });
      }
    }

    return list;
  }, [recipients, filterDeployment, filterRole, filterAction, filterReadDateMode, filterReadDate]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <button
        type="button"
        onClick={handleBack}
        className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-black text-gray-600 transition-all hover:border-[#c7dff5] hover:text-[#0f2f57]"
      >
        <span className="rotate-180">{ICONS.ChevronRight}</span>
        Back to history
      </button>

      <section className="rounded-[1.75rem] border border-gray-100 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-5 border-b border-gray-100 pb-5 lg:grid-cols-2">
          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Notification Detail</p>
            <h2 className="text-2xl font-black text-gray-900">{notification.subject}</h2>
            <p className="whitespace-pre-wrap text-sm leading-6 text-gray-600">{notification.body}</p>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-gray-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
                {notification.type || 'general'}
              </span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
                {getActionLabel(actionConfig)}
              </span>
              <span className="rounded-full bg-gray-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-500">
                {getDecisionScopeLabel(actionConfig.decisionScope)}
              </span>
            </div>

            <div className="space-y-2 text-xs font-medium text-gray-500">
              <p>Created: {formatDateTime(notification.createdAt)}</p>
              {notification.createdByName && <p>By: {notification.createdByName}</p>}
              <p>Notification ID: {notification.id}</p>
            </div>

            {actionConfig.kind === 'decision' || actionConfig.kind === 'link_and_decision' ? (
              <div className="rounded-[1.25rem] border border-gray-100 bg-gray-50/80 p-4">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Action Buttons</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {actionConfig.acceptLabel && (
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-600">
                      {actionConfig.acceptLabel}
                    </span>
                  )}
                  {actionConfig.declineLabel && (
                    <span className="rounded-full bg-red-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-red-600">
                      {actionConfig.declineLabel}
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-4">
          <div className="rounded-[1.25rem] border border-gray-100 bg-gray-50/80 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Recipients</p>
            <p className="mt-2 text-2xl font-black text-gray-900">{summary.recipientCount}</p>
          </div>
          <div className="rounded-[1.25rem] border border-gray-100 bg-gray-50/80 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Read</p>
            <p className="mt-2 text-2xl font-black text-gray-900">{summary.readCount}</p>
          </div>
          <div className="rounded-[1.25rem] border border-gray-100 bg-gray-50/80 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Acted</p>
            <p className="mt-2 text-2xl font-black text-gray-900">{summary.actedCount}</p>
          </div>
          <div className="rounded-[1.25rem] border border-gray-100 bg-gray-50/80 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Accepted / Declined</p>
            <p className="mt-2 text-2xl font-black text-gray-900">{summary.acceptedCount} / {summary.declinedCount}</p>
          </div>
        </div>

        <div className="mt-6">
          <section className="rounded-[1.5rem] border border-gray-100 bg-white p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-black text-gray-900">Recipient Activity</h3>
                <p className="mt-1 text-sm text-gray-500">
                  Every targeted user is listed below, including who read the notification and who clicked an action button.
                </p>
              </div>
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">
                  {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active
                </span>
              )}
            </div>

            <div className="mt-4 rounded-[1.25rem] border border-gray-100 bg-gray-50/80 px-4 py-4">
              <p className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Filters</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {/* Deployment filter */}
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                    Deployment
                  </label>
                  <select
                    value={filterDeployment}
                    onChange={(e) => setFilterDeployment(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">All deployments</option>
                    {(deployments ?? []).map((d) => (
                      <option key={d.licenseKey} value={d.licenseKey}>
                        {d.clientName}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Role filter */}
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                    User Role
                  </label>
                  <select
                    value={filterRole}
                    onChange={(e) => setFilterRole(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">All roles</option>
                    {uniqueRoles.map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </div>

                {/* Action Status filter */}
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                    Action Status
                  </label>
                  <select
                    value={filterAction}
                    onChange={(e) => setFilterAction(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">All</option>
                    <option value="accepted">Accepted</option>
                    <option value="declined">Declined</option>
                    <option value="read">Read</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>

                {/* Read Date filter */}
                <div>
                  <label className="mb-1 block text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                    Read Date
                  </label>
                  <div className="flex gap-1.5">
                    <select
                      value={filterReadDateMode}
                      onChange={(e) => setFilterReadDateMode(e.target.value as 'on' | 'before' | 'after')}
                      className="rounded-xl border border-gray-200 bg-white px-2 py-2 text-sm"
                    >
                      <option value="on">On</option>
                      <option value="before">Before</option>
                      <option value="after">After</option>
                    </select>
                    <input
                      type="date"
                      value={filterReadDate}
                      onChange={(e) => setFilterReadDate(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>

              {activeFilterCount > 0 && (
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="text-xs font-black uppercase tracking-[0.18em] text-gray-400 transition-colors hover:text-gray-600"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>

            <div className="mt-5 space-y-3">
              {filteredRecipients.length === 0 ? (
                <div className="rounded-[1.25rem] border border-dashed border-gray-200 px-4 py-6 text-center text-sm font-medium text-gray-400">
                  {(recipients ?? []).length === 0
                    ? 'No targeted users were found for this notification.'
                    : 'No recipients match the current filters.'}
                </div>
              ) : (
                filteredRecipients.map((recipient) => {
                  const status = getRecipientStatus(recipient);
                  const deploymentRecipient = recipient as NotificationDeploymentRecipient;
                  return (
                    <div
                      key={recipient.userId}
                      className="rounded-[1.25rem] border border-gray-100 bg-gray-50/70 px-4 py-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-black text-gray-900">{recipient.userName || 'Unknown user'}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
                              {recipient.userRole || 'Unknown role'}
                            </p>
                            {deploymentRecipient.deploymentName != null && (
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-gray-500">
                                {deploymentRecipient.deploymentName || 'Local'}
                              </span>
                            )}
                          </div>
                        </div>
                        <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${status.className}`}>
                          {status.label}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-2 text-xs font-medium text-gray-500 sm:grid-cols-2">
                        <p>Read at: {formatDateTime(recipient.readAt)}</p>
                        <p>Action clicked: {recipient.actionResult || 'No action yet'}</p>
                        <p>Acted at: {formatDateTime(recipient.actedAt)}</p>
                        <p>User ID: {recipient.userId}</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
};

export default NotificationDetail;
