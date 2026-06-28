import React from 'react';
import { Card } from '../components/Card';

const SocialMediaAdsDashboard: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-8 text-center shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Social Media Ads</p>
        <h1 className="mt-2 text-2xl font-black text-gray-900">Ads dashboard</h1>
        <p className="mt-3 text-sm text-gray-500">
          This section is ready for future campaign summaries and performance insights.
        </p>
      </div>

      <Card elevated className="p-6">
        <p className="text-sm text-gray-500">
          No widgets have been wired in yet. Add your first campaign overview here once the reporting requirements are finalized.
        </p>
      </Card>
    </div>
  );
};

export default SocialMediaAdsDashboard;
