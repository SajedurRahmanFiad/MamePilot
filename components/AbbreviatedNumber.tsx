import React, { useState } from 'react';

interface AbbreviatedNumberProps {
  value: number;
  className?: string;
  prefix?: string; // e.g., "৳ "
  suffix?: string; // e.g., " BDT"
}

export const AbbreviatedNumber: React.FC<AbbreviatedNumberProps> = ({ value, className = '', prefix = '', suffix = '' }) => {
  const [isHovering, setIsHovering] = useState(false);

  // Format the number
  const absValue = Math.abs(value);
  const numericValue = Number(value);
  
  if (!Number.isFinite(numericValue)) {
    return <span className={className}>0</span>;
  }

  const fullFormatted = numericValue.toLocaleString('en-BD');
  
  let abbreviated = fullFormatted;
  
  if (absValue >= 1_000_000_000) {
    abbreviated = `${(numericValue / 1_000_000_000).toFixed(1)}B`;
  } else if (absValue >= 1_000_000) {
    abbreviated = `${(numericValue / 1_000_000).toFixed(1)}M`;
  } else if (absValue >= 1_000) {
    abbreviated = `${(numericValue / 1_000).toFixed(1)}K`;
  }

  const showTooltip = isHovering && abbreviated !== fullFormatted;

  return (
    <div className="relative inline-block">
      <span
        className={className}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {prefix}{abbreviated}{suffix}
      </span>
      
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-gray-900 text-white text-sm rounded-lg whitespace-nowrap z-50 shadow-lg">
          {prefix}{fullFormatted}{suffix}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </div>
      )}
    </div>
  );
};
