import React from 'react';
import { Card } from '../components/Card';

const MetaAds: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-6 py-8 shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gray-400">Social Media Ads</p>
        <h1 className="mt-2 text-2xl font-black text-gray-900">Meta Ads</h1>
        <p className="mt-3 text-sm text-gray-500">
          Meta ad management will be added here as soon as the campaign workflow is ready.
        </p>
      </div>

      <Card elevated className="p-6">
        <p className="text-sm text-gray-500">
          This page is currently a placeholder. You can start adding Meta campaign forms and tables here later.
        </p>
      </Card>
    </div>
  );
};

export default MetaAds;
