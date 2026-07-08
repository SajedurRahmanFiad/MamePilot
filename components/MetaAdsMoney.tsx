import React, { useState } from 'react';
import { useMetaAdsSettings } from '../src/hooks/useQueries';
import {
  formatMetaAdsCurrency,
  buildBdtTooltip,
  CURRENCY_SYMBOLS,
} from '../src/utils/metaAdsCurrency';

interface MetaAdsMoneyProps {
  amount: number;
  nativeCode?: string;
  className?: string;
  /** If true, show just the formatted number without currency symbol wrapper */
  compact?: boolean;
}

/**
 * Displays a monetary value in the user's configured display currency.
 * On hover, shows a tooltip with the BDT equivalent based on the exchange rate.
 */
const MetaAdsMoney: React.FC<MetaAdsMoneyProps> = ({ amount, nativeCode, className = '', compact = false }) => {
  const [hovered, setHovered] = useState(false);
  const { data: settings, isPending: settingsLoading } = useMetaAdsSettings(true);

  // While settings are loading, avoid showing the fallback currency (e.g. 'BDT').
  // Instead, show a numeric-only value without currency symbol or code.
  if (settingsLoading && !settings) {
    const numericOnly = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
    return <span className={className}>{compact ? numericOnly : numericOnly}</span>;
  }

  const displayCode = settings?.displayCurrencyCode || 'BDT';
  const rateToBdt = settings?.displayCurrencyRateToBdt ?? null;

  // Format the display amount
  const displayText = formatMetaAdsCurrency(amount, displayCode);

  // Build tooltip
  const tooltip = buildBdtTooltip(amount, displayCode, nativeCode, rateToBdt);

  // If native currency is different from display, also show native amount
  const nativeText = nativeCode && nativeCode !== displayCode
    ? formatMetaAdsCurrency(amount, nativeCode)
    : null;

  if (!tooltip && !nativeText) {
    return <span className={className}>{displayText}</span>;
  }

  return (
    <span
      className={`relative inline-block ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span className="cursor-help border-b border-dotted border-gray-300">{displayText}</span>
      {hovered && (tooltip || nativeText) && (
        <span className="absolute bottom-full left-1/2 z-[9999] mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-xl">
          {nativeText && nativeText !== displayText && (
            <span className="block text-gray-400">Native: {nativeText}</span>
          )}
          {tooltip && <span className="block font-semibold text-gray-900">{tooltip}</span>}
          {displayCode !== 'BDT' && (
            <span className="mt-0.5 block text-[10px] text-gray-400">
              Rate: 1 {displayCode} = {rateToBdt ?? '?'} ৳
            </span>
          )}
        </span>
      )}
    </span>
  );
};

export default MetaAdsMoney;