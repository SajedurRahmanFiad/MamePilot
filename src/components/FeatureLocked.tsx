import React from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { CAPABILITY_LABELS } from '../utils/capabilities';
import type { AppCapabilityKey } from '../../types';

const FeatureLocked: React.FC<{ capability?: AppCapabilityKey | null }> = ({ capability }) => {
  const label = capability ? CAPABILITY_LABELS[capability] : 'This feature';

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-6 py-12">
      <div className="max-w-lg rounded-3xl border border-amber-100 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
          <Lock size={26} />
        </div>
        <p className="mt-5 text-[10px] font-black uppercase tracking-[0.2em] text-amber-500">Feature Locked</p>
        <h1 className="mt-3 text-2xl font-black text-gray-900">{label} is not enabled</h1>
        <p className="mt-3 text-sm font-medium text-gray-500">
          This installation does not currently include this capability. Please contact the developer or update the subscription plan.
        </p>
        <Link
          to="/subscriptions"
          className="mt-6 inline-flex rounded-xl bg-[#0f2f57] px-5 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-[#143b6d]"
        >
          View Subscription
        </Link>
      </div>
    </div>
  );
};

export default FeatureLocked;
