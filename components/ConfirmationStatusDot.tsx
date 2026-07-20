import React from 'react';
import type { ConfirmationStatus } from '../types';

interface ConfirmationStatusDotProps {
  status: ConfirmationStatus | null | undefined;
  size?: 'sm' | 'md';
  showLabel?: boolean;
  className?: string;
}

const STATUS_CONFIG: Record<ConfirmationStatus, { color: string; bg: string; ring: string; label: string; icon: string }> = {
  confirmed: {
    color: 'text-emerald-700',
    bg: 'bg-emerald-500',
    ring: 'ring-emerald-100',
    label: 'Confirmed',
    icon: '✓',
  },
  cancelled: {
    color: 'text-red-700',
    bg: 'bg-red-500',
    ring: 'ring-red-100',
    label: 'Cancelled',
    icon: '✕',
  },
  on_hold: {
    color: 'text-amber-700',
    bg: 'bg-amber-500',
    ring: 'ring-amber-100',
    label: 'Requested callback',
    icon: '☎',
  },
  waiting: {
    color: 'text-gray-500',
    bg: 'bg-gray-400',
    ring: 'ring-gray-100',
    label: 'Waiting for response',
    icon: '…',
  },
};

export const ConfirmationStatusDot: React.FC<ConfirmationStatusDotProps> = ({
  status,
  size = 'sm',
  showLabel = false,
  className = '',
}) => {
  if (!status) return null;

  const config = STATUS_CONFIG[status];
  if (!config) return null;

  const dotSize = size === 'sm' ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5';
  const textSize = size === 'sm' ? 'text-[10px]' : 'text-xs';

  if (showLabel) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${config.color} bg-opacity-10 ${config.bg.replace('500', '50')} ring-1 ${config.ring} ${className}`}
        title={config.label}
      >
        <span className={`${dotSize} rounded-full ${config.bg} ${status === 'waiting' ? 'animate-pulse' : ''}`} />
        {config.label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center ${dotSize} rounded-full ${config.bg} ring-2 ring-white ${status === 'waiting' ? 'animate-pulse' : ''} ${className}`}
      title={`Survey: ${config.label}`}
    />
  );
};
