import React from 'react';
import { theme } from '../theme';
import { AbbreviatedNumber } from './AbbreviatedNumber';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  elevated?: boolean;
  hover?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, className = '', elevated = false, hover = false }) => {
  const baseStyle = elevated ? theme.card.elevated : theme.card.base;
  const hoverStyle = hover ? theme.card.hoverScale : '';

  return (
    <div className={`${baseStyle} ${hoverStyle} ${className}`}>
      {children}
    </div>
  );
};

type StatCardVariant = 'primary' | 'secondary' | 'danger' | 'warning' | 'success' | 'info' | 'neutral' | 'profit';

interface StatCardProps {
  title: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  variant?: StatCardVariant;
  bgColor?: string;
  textColor?: string;
  iconBgColor?: string;
  isProfitCard?: boolean;
  profitValue?: number;
  subtotalAmount?: string; // Optional: amount to show in brackets, e.g. "৳ 670"
  subtotalNumericValue?: number; // For abbreviated subtotal display
  subtitle?: React.ReactNode;
  subtitleTone?: 'positive' | 'negative' | 'neutral';
  onClick?: () => void;
  className?: string;
  numericValue?: number; // For abbreviated display with tooltip
  showAbbreviated?: boolean; // Show abbreviated format (e.g., 4.5K, 7.4M)
}

const statCardVariants: Record<StatCardVariant, { bg: string; text: string; icon: string }> = {
  primary: {
    bg: 'bg-gray-50',
    text: 'text-black',
    icon: 'text-black',
  },
  secondary: {
    bg: 'bg-gray-50',
    text: 'text-black',
    icon: 'text-black',
  },
  danger: {
    bg: 'bg-gray-50',
    text: 'text-black',
    icon: 'text-black',
  },
  warning: {
    bg: 'bg-gray-50',
    text: 'text-black',
    icon: 'text-black',
  },
  success: {
    bg: 'bg-gray-50',
    text: 'text-black',
    icon: 'text-black',
  },
  info: {
    bg: 'bg-gray-50',
    text: 'text-black',
    icon: 'text-black',
  },
  neutral: {
    bg: 'bg-gray-50',
    text: 'text-black',
    icon: 'text-black',
  },
  profit: {
    bg: 'bg-gray-50',
    text: 'text-black',
    icon: 'text-black',
  },
};

export const StatCard: React.FC<StatCardProps> = ({ title, value, icon, variant = 'primary', bgColor, textColor: textColorProp, iconBgColor: iconBgColorProp, isProfitCard = false, profitValue, subtotalAmount, subtitle, subtitleTone = 'neutral', onClick, className = '', numericValue, showAbbreviated = false, subtotalNumericValue }) => {
  const style = statCardVariants[variant];
  
  // Derive light border and icon colors from bgColor for the white card style
  const deriveLightColors = (bg: string) => {
    // Map Tailwind bg-* classes to their light border and icon bg equivalents
    const colorMap: Record<string, { border: string; iconBg: string }> = {
      'bg-blue-600': { border: 'border-blue-200', iconBg: 'bg-blue-100' },
      'bg-blue-700': { border: 'border-blue-200', iconBg: 'bg-blue-100' },
      'bg-purple-600': { border: 'border-purple-200', iconBg: 'bg-purple-100' },
      'bg-purple-500': { border: 'border-purple-200', iconBg: 'bg-purple-100' },
      'bg-amber-500': { border: 'border-amber-200', iconBg: 'bg-amber-100' },
      'bg-amber-600': { border: 'border-amber-200', iconBg: 'bg-amber-100' },
      'bg-indigo-700': { border: 'border-indigo-200', iconBg: 'bg-indigo-100' },
      'bg-indigo-500': { border: 'border-indigo-200', iconBg: 'bg-indigo-100' },
      'bg-indigo-600': { border: 'border-indigo-200', iconBg: 'bg-indigo-100' },
      'bg-indigo-800': { border: 'border-indigo-200', iconBg: 'bg-indigo-100' },
      'bg-violet-700': { border: 'border-violet-200', iconBg: 'bg-violet-100' },
      'bg-violet-500': { border: 'border-violet-200', iconBg: 'bg-violet-100' },
      'bg-violet-600': { border: 'border-violet-200', iconBg: 'bg-violet-100' },
      'bg-violet-800': { border: 'border-violet-200', iconBg: 'bg-violet-100' },
      'bg-orange-500': { border: 'border-orange-200', iconBg: 'bg-orange-100' },
      'bg-orange-600': { border: 'border-orange-200', iconBg: 'bg-orange-100' },
      'bg-orange-700': { border: 'border-orange-200', iconBg: 'bg-orange-100' },
      'bg-orange-800': { border: 'border-orange-200', iconBg: 'bg-orange-100' },
      'bg-sky-500': { border: 'border-sky-200', iconBg: 'bg-sky-100' },
      'bg-sky-600': { border: 'border-sky-200', iconBg: 'bg-sky-100' },
      'bg-cyan-500': { border: 'border-cyan-200', iconBg: 'bg-cyan-100' },
      'bg-cyan-600': { border: 'border-cyan-200', iconBg: 'bg-cyan-100' },
      'bg-teal-600': { border: 'border-teal-200', iconBg: 'bg-teal-100' },
      'bg-teal-700': { border: 'border-teal-200', iconBg: 'bg-teal-100' },
      'bg-emerald-500': { border: 'border-emerald-200', iconBg: 'bg-emerald-100' },
      'bg-emerald-600': { border: 'border-emerald-200', iconBg: 'bg-emerald-100' },
      'bg-emerald-700': { border: 'border-emerald-200', iconBg: 'bg-emerald-100' },
      'bg-red-500': { border: 'border-red-200', iconBg: 'bg-red-100' },
      'bg-red-600': { border: 'border-red-200', iconBg: 'bg-red-100' },
      'bg-red-700': { border: 'border-red-200', iconBg: 'bg-red-100' },
      'bg-rose-600': { border: 'border-rose-200', iconBg: 'bg-rose-100' },
      'bg-rose-700': { border: 'border-rose-200', iconBg: 'bg-rose-100' },
      'bg-green-700': { border: 'border-green-200', iconBg: 'bg-green-100' },
      'bg-green-800': { border: 'border-green-200', iconBg: 'bg-green-100' },
    };
    return colorMap[bg] || { border: 'border-gray-200', iconBg: 'bg-gray-100' };
  };

  // Use white background with light colored border matching the original color
  let cardBgColor = 'bg-white';
  let iconBgColor = iconBgColorProp || style.bg;
  let borderStyle = bgColor ? deriveLightColors(bgColor).border : 'border-gray-200';
  
  // For profit card: use green or red tinted white card with dynamic text
  if (isProfitCard && profitValue !== undefined) {
    if (profitValue >= 0) {
      cardBgColor = 'bg-emerald-50/50';
      iconBgColor = 'bg-emerald-500';
      borderStyle = 'border-emerald-200';
    } else {
      cardBgColor = 'bg-red-50/50';
      iconBgColor = 'bg-red-500';
      borderStyle = 'border-red-200';
    }
  }
  
  // Override iconBgColor with light version when bgColor is provided
  if (bgColor && !isProfitCard) {
    const lightColors = deriveLightColors(bgColor);
    iconBgColor = iconBgColorProp || lightColors.iconBg;
  }

  const containerClasses = `p-4 flex items-start gap-3 text-left ${cardBgColor} rounded-xl shadow-sm border ${borderStyle} ${className}`;
  const clickableClasses = onClick ? 'cursor-pointer transition hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500' : '';
  const Container = onClick ? 'button' : 'div';

  // Render abbreviated value if requested and numeric value is provided
  // Extract currency symbol from formatted value if present
  const valueDisplay = showAbbreviated && numericValue !== undefined ? (
    <AbbreviatedNumber value={numericValue} className="text-lg font-black" prefix="৳ " />
  ) : (
    <span>{value}</span>
  );

  // Render subtotal with abbreviation if numeric value provided
  const subtotalDisplay = subtotalNumericValue !== undefined ? (
    <AbbreviatedNumber value={subtotalNumericValue} className="text-sm font-semibold" prefix="(৳" suffix=")" />
  ) : (
    subtotalAmount && <span className="text-sm font-semibold">({subtotalAmount})</span>
  );

  const subtitleClassName = subtitleTone === 'positive'
    ? 'text-emerald-600'
    : subtitleTone === 'negative'
      ? 'text-red-600'
      : 'text-gray-500';

  const titleClassName = isProfitCard && profitValue !== undefined
    ? profitValue >= 0 ? 'text-emerald-500' : 'text-red-500'
    : 'text-gray-400';
  
  // Dynamic text color for profit card
  const valueTextClassName = isProfitCard && profitValue !== undefined
    ? profitValue >= 0 ? 'text-emerald-600' : 'text-red-600'
    : 'text-gray-900';

  return (
    <Container
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`${containerClasses} ${clickableClasses}`}
    >
      <div className={`${iconBgColor} p-3 rounded-lg flex items-center justify-center`}>
        <div className="text-white">{icon}</div>
      </div>
      <div className="flex-1">
        {/* slightly smaller title text */}
        <p className={`text-[10px] font-bold uppercase tracking-widest ${titleClassName}`}>{title}</p>
        <h3 className={`text-lg font-black mt-1 flex flex-wrap items-baseline gap-1 ${valueTextClassName}`}>
          {valueDisplay}
          {subtotalDisplay}
        </h3>
        {subtitle && <p className={`mt-1 text-xs font-semibold ${subtitleClassName}`}>{subtitle}</p>}
      </div>
    </Container>
  );
};
