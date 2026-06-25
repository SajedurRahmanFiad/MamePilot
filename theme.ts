/**
 * Global Theme Configuration
 * Update values here to change the entire app's appearance
 */

export type ThemeColorKey = 'navy' | 'blue' | 'emerald' | 'purple';

const themeColorPalette: Record<ThemeColorKey, { primary: string; medium: string; dark: string; soft: string }> = {
  navy: {
    primary: '#0f2f57',
    medium: '#3c5a82',
    dark: '#0c203b',
    soft: '#ebf4ff',
  },
  blue: {
    primary: '#1d4ed8',
    medium: '#2563eb',
    dark: '#1e40af',
    soft: '#eff6ff',
  },
  emerald: {
    primary: '#047857',
    medium: '#059669',
    dark: '#065f46',
    soft: '#ecfdf5',
  },
  purple: {
    primary: '#7c3aed',
    medium: '#8b5cf6',
    dark: '#5b21b6',
    soft: '#f3e8ff',
  },
};

const hexToRgb = (hex: string) => {
  const value = hex.replace('#', '').trim();
  if (value.length === 3) {
    return {
      r: parseInt(value[0] + value[0], 16),
      g: parseInt(value[1] + value[1], 16),
      b: parseInt(value[2] + value[2], 16),
    };
  }
  if (value.length !== 6) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
};

const rgbToHex = (r: number, g: number, b: number) => {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  const pad = (value: number) => clamp(value).toString(16).padStart(2, '0');
  return `#${pad(r)}${pad(g)}${pad(b)}`;
};

const rgbToHsl = (r: number, g: number, b: number) => {
  const rNorm = r / 255;
  const gNorm = g / 255;
  const bNorm = b / 255;
  const max = Math.max(rNorm, gNorm, bNorm);
  const min = Math.min(rNorm, gNorm, bNorm);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rNorm:
        h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0);
        break;
      case gNorm:
        h = (bNorm - rNorm) / d + 2;
        break;
      case bNorm:
        h = (rNorm - gNorm) / d + 4;
        break;
    }
    h /= 6;
  }

  return { h, s, l };
};

const hslToRgb = (h: number, s: number, l: number) => {
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  if (s === 0) {
    const value = Math.round(l * 255);
    return { r: value, g: value, b: value };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
};

const adjustLightness = (hex: string, delta: number) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#0f2f57';
  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  return rgbToHex(...Object.values(hslToRgb(h, s, Math.max(0, Math.min(1, l + delta)))));
};

export function resolveThemeColorPalette(themeColor: string) {
  const normalized = themeColor.trim();
  const key = normalized.toLowerCase() as ThemeColorKey;
  if (Object.prototype.hasOwnProperty.call(themeColorPalette, key)) {
    return themeColorPalette[key as ThemeColorKey];
  }

  const hex = normalized.startsWith('#') ? normalized : `#${normalized}`;
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return themeColorPalette['navy'];
  }

  return {
    primary: hex,
    medium: adjustLightness(hex, 0.08),
    dark: adjustLightness(hex, -0.15),
    soft: adjustLightness(hex, 0.8),
  };
}

const buildPrimaryColorTokens = (color: { primary: string; medium: string; dark: string; soft: string }) => ({
  50: `bg-[var(--primary-soft,${color.soft})]`,
  100: `bg-[var(--primary-medium,${color.medium})]`,
  200: `bg-[var(--primary-medium,${color.medium})]`,
  500: `bg-[var(--primary-medium,${color.medium})]`,
  600: `bg-[var(--primary-color,${color.primary})]`,
  700: `bg-[var(--primary-dark,${color.dark})]`,
  text: `text-[var(--primary-color,${color.primary})]`,
  textLight: `text-[var(--primary-color,${color.primary})]`,
  shadow: `shadow-[var(--primary-color,${color.primary})]/20`,
  focusRing: `focus:ring-[var(--primary-medium,${color.medium})]`,
  border: `border-[var(--primary-medium,${color.medium})]`,
});

const defaultThemeColor: ThemeColorKey = 'navy';
let primary = buildPrimaryColorTokens(themeColorPalette[defaultThemeColor]);

export const theme = {
  // Primary Colors
  colors: {
    // Brand colors - change these to update entire app theme
    primary,
    secondary: {
      50: 'bg-blue-50',
      100: 'bg-blue-100',
      600: 'bg-blue-600',
      700: 'bg-blue-700',
      text: 'text-blue-600',
    },
    danger: {
      50: 'bg-red-50',
      100: 'bg-red-100',
      600: 'bg-red-600',
      700: 'bg-red-700',
      text: 'text-red-600',
    },
    warning: {
      50: 'bg-orange-50',
      100: 'bg-orange-100',
      600: 'bg-orange-600',
      text: 'text-orange-600',
    },
    success: {
      50: 'bg-green-50',
      100: 'bg-green-100',
      600: 'bg-green-600',
      text: 'text-green-600',
    },
    info: {
      50: 'bg-purple-50',
      100: 'bg-purple-100',
      600: 'bg-purple-600',
      text: 'text-purple-600',
    },

    // Neutral
    bg: {
      primary: 'bg-white',
      secondary: 'bg-gray-50',
      tertiary: 'bg-gray-100',
    },
    text: {
      primary: 'text-gray-900',
      secondary: 'text-gray-500',
      tertiary: 'text-gray-400',
      light: 'text-gray-300',
    },
    border: {
      primary: 'border-gray-100',
      secondary: 'border-gray-200',
    },
  },

  // Spacing - use these consistently
  spacing: {
    xs: 'p-1.5',
    sm: 'p-3',
    md: 'p-6',
    lg: 'p-8',
    xl: 'p-12',
  },

  // Border Radius - use these consistently
  radius: {
    sm: 'rounded-lg',
    md: 'rounded-xl',
    lg: 'rounded-2xl',
    full: 'rounded-full',
  },

  // Typography
  typography: {
    title: {
      lg: 'text-3xl font-black tracking-tight',
      md: 'text-2xl font-bold',
      sm: 'text-lg font-bold',
    },
    label: {
      default: 'text-sm font-medium text-gray-400 uppercase tracking-wider',
      strong: 'text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]',
    },
    body: {
      default: 'text-sm font-medium',
      small: 'text-xs font-medium',
      tiny: 'text-[10px] font-bold',
    },
  },

  // Shadows
  shadows: {
    sm: 'shadow-sm',
    md: 'shadow-md',
    lg: 'shadow-lg',
    xl: 'shadow-xl',
    hoverGlow: 'hover:shadow-lg hover:scale-[1.02]',
  },

  // Transitions
  transitions: {
    fast: 'transition-all duration-150',
    normal: 'transition-all duration-300',
    slow: 'transition-all duration-500',
    colors: 'transition-colors duration-200 ease-in-out',
    transform: 'transition-transform duration-200 ease-in-out',
    opacity: 'transition-opacity duration-200 ease-in-out',
  },

  // Button styles
  buttons: {
    base: 'inline-flex items-center justify-center gap-2 font-bold rounded-xl transition-all duration-300 cursor-pointer',
    primary: `${primary[600]} text-white hover:${primary[700]} shadow-lg ${primary.shadow}`,
    secondary: 'bg-gray-100 text-gray-600 hover:bg-gray-200',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    outline: 'border-2 border-gray-200 text-gray-700 hover:bg-gray-50',
    sizes: {
      sm: 'px-3 py-2 text-xs',
      md: 'px-4 py-2.5 text-sm',
      lg: 'px-6 py-3.5 text-sm',
    },
  },

  // Input styles
  inputs: {
    base: `w-full px-4 py-2.5 border border-gray-200 rounded-xl outline-none focus:ring-2 ${primary.focusRing} focus:border-transparent transition-all`,
    label: 'block text-sm font-semibold text-gray-700 mb-2',
    error: 'border-red-500 focus:ring-red-500',
  },

  // Table styles
  table: {
    header: 'bg-gray-50 border-b border-gray-100',
    headerCell: 'px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]',
    bodyCell: 'px-6 py-5',
    row: `border-b border-gray-50 hover:${primary[50]}/50 cursor-pointer transition-all`,
  },

  // Card styles
  card: {
    base: 'bg-white rounded-2xl shadow-sm border border-gray-100 transition-all',
    elevated: 'bg-white rounded-2xl shadow-md border border-gray-100',
    hoverScale: 'hover:scale-[1.02] hover:shadow-md',
  },

  // Status colors mapping
  status: {
    'ON_HOLD': 'bg-gray-100 text-gray-600',
    'PROCESSING': 'bg-blue-100 text-blue-600',
    'COURIER_ASSIGNED': 'bg-blue-100 text-blue-600',
    'PICKED': 'bg-purple-100 text-purple-600',
    'COMPLETED': 'bg-green-100 text-green-600',
    'CANCELLED': 'bg-red-100 text-red-600',
    'RECEIVED': 'bg-green-100 text-green-600',
    'PENDING': 'bg-yellow-100 text-yellow-600',
  },
};

export type Theme = typeof theme;
