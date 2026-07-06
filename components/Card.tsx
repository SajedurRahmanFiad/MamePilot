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
  value: string | number;
  icon: React.ReactNode;
  variant?: StatCardVariant;
  bgColor?: string;
  textColor?: string;
  iconBgColor?: string;
  isProfitCard?: boolean;
  profitValue?: number;
  subtotalAmount?: string; // Optional: amount to show in brackets, e.g. "৳ 670"
  subtotalNumericValue?: number; // For abbreviated subtotal display
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

export const StatCard: React.FC<StatCardProps> = ({ title, value, icon, variant = 'primary', bgColor, textColor: textColorProp, iconBgColor: iconBgColorProp, isProfitCard = false, profitValue, subtotalAmount, onClick, className = '', numericValue, showAbbreviated = false, subtotalNumericValue }) => {
  const style = statCardVariants[variant];
  
  // Use provided colors or determine from profit card logic
  let cardBgColor = bgColor || 'bg-white';
  let textColor = textColorProp || style.text;
  let iconBgColor = iconBgColorProp || style.bg;
  let borderStyle = '';
  
  // Override with profit card colors if applicable and no custom colors provided
  if (isProfitCard && profitValue !== undefined && !bgColor) {
    if (profitValue >= 0) {
      cardBgColor = 'bg-emerald-500';
      textColor = 'text-white';
      iconBgColor = 'bg-emerald-600';
    } else {
      cardBgColor = 'bg-red-500';
      textColor = 'text-white';
      iconBgColor = 'bg-red-600';
    }
  }

  const containerClasses = `p-4 flex items-start gap-3 text-left ${cardBgColor} rounded-xl shadow-lg border border-gray-100 ${borderStyle} ${className}`;
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
    <AbbreviatedNumber value={subtotalNumericValue} className="text-sm font-semibold" prefix="(" suffix=")" />
  ) : (
    subtotalAmount && <span className="text-sm font-semibold">({subtotalAmount})</span>
  );

  return (
    <Container
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`${containerClasses} ${clickableClasses}`}
    >
      <div className={`${iconBgColor} p-3 rounded-lg flex items-center justify-center`}>
        <div className={textColor}>{icon}</div>
      </div>
      <div className="flex-1">
        {/* slightly smaller title text */}
        <p className={`text-[10px] font-bold uppercase tracking-widest ${textColor === 'text-white' ? 'text-white/70' : 'text-gray-400'}`}>{title}</p>
        <h3 className={`text-lg font-black mt-1 flex flex-wrap items-baseline gap-1 ${textColor}`}>
          {valueDisplay}
          {subtotalDisplay}
        </h3>
      </div>
    </Container>
  );
};
