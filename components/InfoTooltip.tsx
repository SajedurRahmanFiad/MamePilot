import React, { useState } from 'react';
import { ICONS } from '../constants';

interface InfoTooltipProps {
  message: string;
  label?: string;
}

const InfoTooltip: React.FC<InfoTooltipProps> = ({ message, label = 'More information' }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
        onBlur={() => setIsOpen(false)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-[#3c5a82] transition hover:bg-[#ebf4ff] focus:bg-[#ebf4ff] focus:outline-none focus:ring-2 focus:ring-[#c7dff5]"
      >
        {ICONS.Info}
      </button>
      <span
        role="tooltip"
        className={`absolute bottom-full left-0 z-30 mb-2 w-72 rounded-xl bg-gray-900 px-3 py-2 text-left text-xs font-medium normal-case leading-5 tracking-normal text-white shadow-xl transition-opacity ${isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0 group-hover:opacity-100'}`}
      >
        {message}
      </span>
    </span>
  );
};

export default InfoTooltip;
