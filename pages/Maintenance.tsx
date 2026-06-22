import React from 'react';

const Maintenance: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-16">
      <div className="max-w-2xl w-full rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 text-blue-700">
          <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v4" />
            <path d="M12 18v4" />
            <path d="M4.93 4.93l2.83 2.83" />
            <path d="M16.24 16.24l2.83 2.83" />
            <path d="M2 12h4" />
            <path d="M18 12h4" />
            <path d="M4.93 19.07l2.83-2.83" />
            <path d="M16.24 7.76l2.83-2.83" />
            <circle cx="12" cy="12" r="5" />
          </svg>
        </div>
        <h1 className="mt-8 text-3xl font-bold text-slate-900">Maintenance Mode</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          The server is under maintenance, please wait...
        </p>
        <div className="mt-8 rounded-2xl bg-slate-50 p-6 text-left text-sm text-slate-500">
          <p className="font-semibold text-slate-800">What this means</p>
          <p className="mt-2">Some new updates are in progress. For the sake of safety and security, the server is currently turned off. You'll be able to access the app again as soon as the update is complete.</p>
        </div>
      </div>
    </div>
  );
};

export default Maintenance;
