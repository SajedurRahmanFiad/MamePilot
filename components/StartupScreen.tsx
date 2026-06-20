import React, { useState } from 'react';
import { db } from '../db';
import type { StartupStatus } from '../src/contexts/AuthProvider';
import { Button } from './Button';

interface StartupScreenProps {
  status: Extract<StartupStatus, 'idle' | 'checking' | 'timeout' | 'offline' | 'error'>;
  error?: string | null;
  onRetry?: () => Promise<void> | void;
  onBackToLogin?: () => Promise<void> | void;
}

const STATUS_COPY: Record<StartupScreenProps['status'], { title: string; description: string }> = {
  idle: {
    title: 'Restoring your session...',
    description: 'We are getting your workspace ready.',
  },
  checking: {
    title: 'Restoring your session...',
    description: 'We are verifying your access and loading your workspace.',
  },
  timeout: {
    title: 'Connection is taking too long',
    description: 'The app did not get a startup response in time. You can retry, or go back to login safely.',
  },
  offline: {
    title: 'No Internet Connection',
    description: 'Reconnect to the internet, then retry restoring your session.',
  },
  error: {
    title: 'Unable to reach the server',
    description: 'The app could not finish startup right now. Please retry, or go back to login.',
  },
};

const StartupScreen: React.FC<StartupScreenProps> = ({
  status,
  error,
  onRetry,
  onBackToLogin,
}) => {
  const [retrying, setRetrying] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const companyName = db.settings.company.name?.trim() || 'Mame Pilot';
  const companyLogo = db.settings.company.logo?.trim() || '/uploads/Avatar.png';
  const copy = STATUS_COPY[status];
  const isChecking = status === 'idle' || status === 'checking';

  const handleRetry = async () => {
    if (!onRetry) return;
    try {
      setRetrying(true);
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  const handleBackToLogin = async () => {
    if (!onBackToLogin) return;
    try {
      setSigningOut(true);
      await onBackToLogin();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg rounded-3xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="px-8 py-10">
          <div className="flex items-center justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full border border-gray-200 bg-gray-100">
              {isChecking ? (
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-300 border-t-gray-600" />
              ) : (
                <div className={`text-2xl ${status === 'offline' ? 'text-red-600' : 'text-gray-600'}`}>
                  {status === 'offline' ? '!' : 'i'}
                </div>
              )}
            </div>
          </div>

          <div className="mt-8 text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-gray-900">{copy.title}</h2>
            <p className="mt-3 text-sm leading-6 text-gray-600">{copy.description}</p>
            {error && !isChecking ? (
              <div className="mt-5 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                {error}
              </div>
            ) : null}
          </div>

          {!isChecking ? (
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <Button type="button" onClick={handleRetry} loading={retrying} className="w-full sm:w-auto">
                Retry Session Restore
              </Button>
              <Button type="button" variant="outline" onClick={handleBackToLogin} loading={signingOut} className="w-full sm:w-auto">
                Back To Login
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default StartupScreen;
