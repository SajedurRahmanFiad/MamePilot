export interface CurrencyOption {
  code: string;
  label: string;
  symbol: string;
}

export const META_ADS_CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: 'BDT', label: '৳ - Bangladeshi Taka', symbol: '৳' },
  { code: 'USD', label: 'USD - US Dollar', symbol: '$' },
  { code: 'EUR', label: 'EUR - Euro', symbol: '৳' },
  { code: 'GBP', label: 'GBP - British Pound', symbol: '৳' },
  { code: 'INR', label: 'INR - Indian Rupee', symbol: '৳' },
  { code: 'SAR', label: 'SAR - Saudi Riyal', symbol: '৳' },
  { code: 'AED', label: 'AED - UAE Dirham', symbol: '?.?' },
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
 * Uses Intl.NumberFormat for proper locale formatting.
 */
export function formatMetaAdsCurrency(amount: number, currencyCode: string): string {
  try {
    const formatted = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currencyCode,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
    const symbol = CURRENCY_SYMBOLS[currencyCode];
    if (symbol) {
      if (formatted.startsWith(currencyCode)) {
        return symbol + formatted.slice(currencyCode.length).trim();
      }
      if (formatted.endsWith(symbol)) {
        return symbol + formatted.slice(0, -symbol.length).trim();
      }
    }
    return formatted;
  } catch {
    const symbol = CURRENCY_SYMBOLS[currencyCode] || currencyCode;
    return `${symbol}${amount.toFixed(2)}`;
  }
}

/**
 * Convert an amount from one currency to BDT using the exchange rate.
 * rateToBdt means "1 {displayCurrency} = X BDT".
 * If native is the display currency, BDT = native * rateToBdt.
 * If native is different (e.g., ad account is USD but display is BDT), 
 * we treat the amount as being in the ad account's currency and need conversion.
 */
export function convertToBdt(amount: number, nativeCode: string | undefined, rateToBdt: number | null): number | null {
  if (rateToBdt == null || rateToBdt <= 0) return null;
  if (!nativeCode || nativeCode === 'BDT') {
    // Amount is already in BDT, no conversion needed
    return amount;
  }
  // rateToBdt = 1 nativeCurrency = X BDT
  return amount * rateToBdt;
}

/**
 * Convert BDT to display currency using inverse of rateToBdt.
 * rateToBdt means "1 displayCurrency = X BDT", so displayAmount = bdtAmount / rateToBdt.
 */
export function convertFromBdt(bdtAmount: number, rateToBdt: number | null): number | null {
  if (rateToBdt == null || rateToBdt <= 0) return null;
  return bdtAmount / rateToBdt;
}

/**
 * Build tooltip text showing BDT equivalent for a money value.
 */
export function buildBdtTooltip(
  displayAmount: number,
  displayCode: string,
  nativeCode: string | undefined,
  rateToBdt: number | null,
): string | null {
  if (displayCode === 'BDT') return null;
  if (rateToBdt == null || rateToBdt <= 0) return null;

  // If native is BDT, display is foreign: BDT = display * rateToBdt
  // If native is the same as display: BDT = display * rateToBdt
  // If native is different: treat amount as display currency
  const bdt = displayAmount * rateToBdt;
  return `~ ${formatMetaAdsCurrency(bdt, 'BDT')}`;
}