export interface CurrencyOption {
  code: string;
  label: string;
  symbol: string;
}

export const META_ADS_CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: 'BDT', label: '৳ - Bangladeshi Taka', symbol: '৳' },
  { code: 'USD', label: 'USD - US Dollar', symbol: '$' },
  { code: 'EUR', label: 'EUR - Euro', symbol: '€' },
  { code: 'GBP', label: 'GBP - British Pound', symbol: '£' },
  { code: 'INR', label: 'INR - Indian Rupee', symbol: '₹' },
  { code: 'SAR', label: 'SAR - Saudi Riyal', symbol: 'SAR ' },
  { code: 'AED', label: 'AED - UAE Dirham', symbol: 'AED ' },
  { code: 'MYR', label: 'MYR - Malaysian Ringgit', symbol: 'RM' },
  { code: 'SGD', label: 'SGD - Singapore Dollar', symbol: 'S$' },
  { code: 'AUD', label: 'AUD - Australian Dollar', symbol: 'A$' },
  { code: 'CAD', label: 'CAD - Canadian Dollar', symbol: 'C$' },
];

export const CURRENCY_SYMBOLS: Record<string, string> = Object.fromEntries(
  META_ADS_CURRENCY_OPTIONS.map((c) => [c.code, c.symbol])
);

/**
 * Format a monetary amount in a given currency code.
 */
export function formatMetaAdsCurrency(amount: number, currencyCode: string): string {
  const code = (currencyCode || 'BDT').toUpperCase();
  try {
    const formatted = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
    const symbol = CURRENCY_SYMBOLS[code];
    if (symbol) {
      if (formatted.startsWith(code)) {
        return symbol + formatted.slice(code.length).trim();
      }
      // Prefer our symbol for BDT (৳) and multi-char prefixes
      if (code === 'BDT') {
        return `৳${Number(amount || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      }
    }
    return formatted;
  } catch {
    const symbol = CURRENCY_SYMBOLS[code] || `${code} `;
    return `${symbol}${Number(amount || 0).toFixed(2)}`;
  }
}

/**
 * Convert an amount in ads/native currency to BDT.
 * rateToBdt means "1 adsCurrency = X BDT".
 * Returns null when conversion is not possible (missing/invalid rate for non-BDT).
 */
export function convertAdsAmountToBdt(
  amount: number,
  adsCurrencyCode: string | undefined | null,
  rateToBdt: number | null | undefined,
): number | null {
  const code = (adsCurrencyCode || 'BDT').toUpperCase();
  if (code === 'BDT') {
    return Number(amount || 0);
  }
  if (rateToBdt == null || !Number.isFinite(rateToBdt) || rateToBdt <= 0) {
    return null;
  }
  return Number(amount || 0) * rateToBdt;
}

/**
 * Convert BDT to ads currency using inverse of rateToBdt.
 */
export function convertBdtToAds(
  bdtAmount: number,
  rateToBdt: number | null | undefined,
): number | null {
  if (rateToBdt == null || !Number.isFinite(rateToBdt) || rateToBdt <= 0) {
    return null;
  }
  return Number(bdtAmount || 0) / rateToBdt;
}

/** @deprecated Use convertAdsAmountToBdt */
export function convertToBdt(amount: number, nativeCode: string | undefined, rateToBdt: number | null): number | null {
  return convertAdsAmountToBdt(amount, nativeCode, rateToBdt);
}

/** @deprecated Use convertBdtToAds */
export function convertFromBdt(bdtAmount: number, rateToBdt: number | null): number | null {
  return convertBdtToAds(bdtAmount, rateToBdt);
}

/**
 * Build tooltip text showing ads-currency equivalent for a BDT amount.
 */
export function buildAdsCurrencyTooltip(
  bdtAmount: number,
  adsCurrencyCode: string | undefined | null,
  rateToBdt: number | null | undefined,
): string | null {
  const code = (adsCurrencyCode || 'BDT').toUpperCase();
  if (code === 'BDT') return null;
  const ads = convertBdtToAds(bdtAmount, rateToBdt);
  if (ads == null) return null;
  return formatMetaAdsCurrency(ads, code);
}

/**
 * @deprecated Prefer buildAdsCurrencyTooltip — primary display is BDT, tooltip is ads currency.
 */
export function buildBdtTooltip(
  displayAmount: number,
  displayCode: string,
  _nativeCode: string | undefined,
  rateToBdt: number | null,
): string | null {
  // Legacy: amount was shown in displayCode; tooltip was BDT.
  if ((displayCode || 'BDT').toUpperCase() === 'BDT') return null;
  if (rateToBdt == null || rateToBdt <= 0) return null;
  return `~ ${formatMetaAdsCurrency(displayAmount * rateToBdt, 'BDT')}`;
}
