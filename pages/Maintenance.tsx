import React from 'react';

const Maintenance: React.FC = () => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-16">
      <div className="max-w-2xl w-full rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-100 overflow-hidden border border-blue-200 shadow-sm">
          <img src="/uploads/Rat_avatar.png" alt="Rat avatar" className="h-full w-full object-cover" />
        </div>
        <h1 className="mt-8 text-3xl font-bold text-slate-900">A mouse is stuck in your server</h1>
        <p className="mt-4 text-base leading-7 text-slate-600">
          Mame is actively chasing him with a piece of cheese to get it back to make the server work again.
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
