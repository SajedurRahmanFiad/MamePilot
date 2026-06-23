import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ICONS } from '../constants';
import { hasAdminAccess } from '../types';
import { useServiceSubscriptionOverview } from '../src/hooks/useQueries';
import { useAuth } from '../src/contexts/AuthProvider';

const ServiceAnnouncementBar: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdminAccessUser = hasAdminAccess(user?.role);
  const { data: overview } = useServiceSubscriptionOverview(!!user);

  if (!overview) return null;
  const dueAt = overview.dueAt
    ? new Date(overview.dueAt).toLocaleDateString('en-BD', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    : '';

  let message = '';
  let barClassName = 'bg-red-600';

  if (overview.currentPayment?.status === 'processing' || overview.state === 'renewing') {
    barClassName = 'bg-amber-500';
    message = overview.currentPayment?.status === 'processing'
      ? 'Your subscription renewal is processing. We are verifying the payment and will update the renewal date shortly.'
      : 'Your subscription renewal is processing. It will take a while, please wait.';
  } else if (overview.state === 'expired') {
    barClassName = 'bg-red-600';
    message = isAdminAccessUser
      ? 'Subscribe to continue. The app is currently in read-only mode.'
      : 'Subscription is required to continue. The app is currently in read-only mode. Please ask an admin to renew it.';
  } else if (overview.state === 'warning') {
    message = isAdminAccessUser
      ? `Your subscription will expire soon. Please make the payment within ${dueAt}.`
      : `Your subscription will expire soon on ${dueAt}. Please ask an admin to renew it in time.`;
  }

  if (!message) return null;

  return (
    <div className={`flex-shrink-0 ${barClassName} px-4 py-3 text-white shadow-sm`}>
      <div className="mx-auto flex max-w-7xl flex-col gap-2 text-sm font-medium md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <span className="mt-0.5">{overview.currentPayment?.status === 'processing' || overview.state === 'renewing' ? ICONS.Clock : ICONS.AlertCircle}</span>
          <p>{message}</p>
        </div>
        {isAdminAccessUser && (
          <button
            onClick={() => navigate('/subscriptions')}
            className="rounded-full bg-white/15 px-4 py-1.5 text-xs font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-white/25"
          >
            Open Subscriptions
          </button>
        )}
      </div>
    </div>
  );
};

export default ServiceAnnouncementBar;
