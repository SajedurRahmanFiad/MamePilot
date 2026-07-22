import React, { useState } from 'react';
import { useMetaAdsSettings } from '../src/hooks/useQueries';
import {
  formatMetaAdsCurrency,
  convertAdsAmountToBdt,
  convertBdtToAds,
} from '../src/utils/metaAdsCurrency';

interface MetaAdsMoneyProps {
  /**
   * Monetary amount. By default treated as ads/native currency (Meta spend etc.).
   * Pass unit="bdt" when the amount is already in BDT (order revenue).
   */
  amount: number;
  /** Ads / Meta account currency code for this amount when unit is "ads". */
  nativeCode?: string;
  className?: string;
  /** If true, show just the formatted number without emphasis */
  compact?: boolean;
  /**
   * unit="ads" (default): amount is in ads currency → display BDT, tooltip ads currency.
   * unit="bdt": amount is already BDT → display BDT, tooltip ads currency via settings rate.
   */
  unit?: 'ads' | 'bdt';
}

/**
 * Displays money primarily in BDT. On hover, shows the ads-currency equivalent
 * using the exchange rate from Meta Ads settings (1 ads currency = X BDT).
 */
const MetaAdsMoney: React.FC<MetaAdsMoneyProps> = ({
  amount,
  nativeCode,
  className = '',
  compact = false,
  unit = 'ads',
}) => {
  const [hovered, setHovered] = useState(false);
  const { data: settings, isPending: settingsLoading } = useMetaAdsSettings(true);

  if (settingsLoading && !settings) {
    const loadingCode = unit === 'bdt' ? 'BDT' : (nativeCode || 'BDT');
    return <span className={className}>{formatMetaAdsCurrency(amount, loadingCode)}</span>;
  }

  const adsCode = (nativeCode || settings?.displayCurrencyCode || 'BDT').toUpperCase();
  const configuredCode = (settings?.displayCurrencyCode || 'BDT').toUpperCase();
  // A saved rate belongs to the configured currency only. Applying it to a
  // different account currency would display a plausible but false BDT value.
  const rateToBdt = adsCode === 'BDT'
    ? 1
    : configuredCode === adsCode
      ? settings?.resolvedRateToBdt ?? settings?.displayCurrencyRateToBdt ?? null
      : null;

  let bdtAmount: number | null;
  let adsAmount: number | null;

  if (unit === 'bdt') {
    bdtAmount = Number(amount || 0);
    adsAmount = adsCode === 'BDT' ? bdtAmount : convertBdtToAds(bdtAmount, rateToBdt);
  } else {
    adsAmount = Number(amount || 0);
    bdtAmount = convertAdsAmountToBdt(adsAmount, adsCode, rateToBdt);
  }

  const missingRate = adsCode !== 'BDT' && (rateToBdt == null || rateToBdt <= 0);

  // Primary: BDT when convertible; otherwise ads currency with a missing-rate cue
  const primaryText =
    bdtAmount != null
      ? formatMetaAdsCurrency(bdtAmount, 'BDT')
      : formatMetaAdsCurrency(adsAmount ?? 0, adsCode);

  const showTooltip = adsCode !== 'BDT' && (adsAmount != null || missingRate);

  if (!showTooltip) {
    return <span className={className}>{primaryText}</span>;
  }

  return (
    <span
      className={`relative inline-block ${className}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      tabIndex={0}
      aria-label={`${primaryText}${adsAmount != null && !missingRate ? `; ${formatMetaAdsCurrency(adsAmount, adsCode)}` : ''}`}
    >
      <span className={`cursor-help border-b border-dotted border-gray-300 ${missingRate && bdtAmount == null ? 'text-amber-700' : ''}`}>
        {primaryText}
      </span>
      {hovered && (
        <span className="absolute bottom-full left-1/2 z-[9999] mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 shadow-xl">
          {missingRate && bdtAmount == null ? (
            <span className="block font-semibold text-amber-700">Set exchange rate in Settings to show ৳</span>
          ) : (
            <>
              <span className="block font-semibold text-gray-900">
                {formatMetaAdsCurrency(adsAmount ?? 0, adsCode)}
              </span>
              {rateToBdt != null && rateToBdt > 0 && (
                <span className="mt-0.5 block text-[10px] text-gray-400">
                  Rate: 1 {adsCode} = {rateToBdt} ৳
                </span>
              )}
            </>
          )}
        </span>
      )}
    </span>
  );
};

export default MetaAdsMoney;
