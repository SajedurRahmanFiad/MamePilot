import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMaintenanceStatus } from '../src/hooks/useQueries';
import { DEFAULT_MAINTENANCE_CONTENT } from '../src/config/maintenance';
import { formatDateTime } from '../utils';

const Maintenance: React.FC = () => {
  const { data: maintenanceStatus, refetch } = useMaintenanceStatus(true);
  const [now, setNow] = useState(() => Date.now());
  const expiryRefreshRequested = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    expiryRefreshRequested.current = false;
  }, [maintenanceStatus?.endsAt]);

  const remainingSeconds = useMemo(() => {
    if (!maintenanceStatus?.endsAt) return null;
    const deadline = new Date(maintenanceStatus.endsAt).getTime();
    if (Number.isNaN(deadline)) return null;
    return Math.max(0, Math.ceil((deadline - now) / 1000));
  }, [maintenanceStatus?.endsAt, now]);

  useEffect(() => {
    if (remainingSeconds !== 0 || expiryRefreshRequested.current) return;
    expiryRefreshRequested.current = true;
    void refetch();
  }, [remainingSeconds, refetch]);

  const imageUrl = maintenanceStatus?.imageUrl || DEFAULT_MAINTENANCE_CONTENT.imageUrl;
  const caption = maintenanceStatus?.caption || DEFAULT_MAINTENANCE_CONTENT.caption;
  const subtitle = maintenanceStatus?.subtitle || DEFAULT_MAINTENANCE_CONTENT.subtitle;
  const explanation = maintenanceStatus?.explanation || DEFAULT_MAINTENANCE_CONTENT.explanation;

  const formatCountdown = (seconds: number): string => {
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const remainder = seconds % 60;
    const parts = [
      days > 0 ? `${days}d` : '',
      `${String(hours).padStart(2, '0')}h`,
      `${String(minutes).padStart(2, '0')}m`,
      `${String(remainder).padStart(2, '0')}s`,
    ].filter(Boolean);
    return parts.join(' ');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-16">
      <div className="max-w-2xl w-full rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 overflow-hidden border border-blue-200 shadow-sm">
          <img src={imageUrl} alt="Maintenance" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.src = DEFAULT_MAINTENANCE_CONTENT.imageUrl; }} />
        </div>
        <h1 className="mt-8 text-3xl font-bold text-slate-900">{caption}</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">{subtitle}</p>
        {remainingSeconds !== null && (
          <div className="mt-7 rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4">
            <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-500">Estimated return</p>
            <p className="mt-2 font-mono text-2xl font-black tracking-wider text-blue-900">{remainingSeconds > 0 ? formatCountdown(remainingSeconds) : '00h 00m 00s'}</p>
            {maintenanceStatus?.endsAt && (
              <p className="mt-2 text-xs font-medium text-blue-600">{formatDateTime(maintenanceStatus.endsAt)}</p>
            )}
          </div>
        )}
        <div className="mt-8 rounded-2xl bg-slate-50 p-6 text-left text-sm text-slate-500">
          <p className="font-semibold text-slate-800">What this means</p>
          <p className="mt-2 whitespace-pre-wrap">{explanation}</p>
        </div>
      </div>
    </div>
  );
};

export default Maintenance;
