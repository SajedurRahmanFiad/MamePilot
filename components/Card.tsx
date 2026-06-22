import React from 'react';
import { theme } from '../theme';

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
  onClick?: () => void;
  className?: string;
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

export const StatCard: React.FC<StatCardProps> = ({ title, value, icon, variant = 'primary', bgColor, textColor: textColorProp, iconBgColor: iconBgColorProp, isProfitCard = false, profitValue, subtotalAmount, onClick, className = '' }) => {
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
        <h3 className={`text-lg font-black mt-1 flex flex-wrap items-baseline ${textColor}`}>
          <span>{value}</span>
          {subtotalAmount && (
            <span className="text-sm font-semibold ml-1 whitespace-nowrap">
              ({subtotalAmount})
            </span>
          )}
        </h3>
      </div>
    </Container>
  );
};
