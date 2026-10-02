import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

interface LocationOption {
  id: string;
  name: string;
}

interface SearchableLocationSelectProps {
  value: string;
  options: LocationOption[];
  onChange: (value: string) => void;
  placeholder: string;
  emptyOptionLabel: string;
  searchPlaceholder?: string;
  disabled?: boolean;
}

const PANEL_MIN_HEIGHT = 300;

function findScrollParent(element: HTMLElement | null): HTMLElement | null {
  let node = element?.parentElement ?? null;
  while (node) {
    const { overflowY } = window.getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') return node;
    node = node.parentElement;
  }
  return null;
}

const SearchableLocationSelect: React.FC<SearchableLocationSelectProps> = ({
  value,
  options,
  onChange,
  placeholder,
  emptyOptionLabel,
  searchPlaceholder = 'Search...',
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [dropUp, setDropUp] = useState(false);
  const [panelMaxHeight, setPanelMaxHeight] = useState<number | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectedOption = options.find((option) => option.id === value);

  const filteredOptions = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLocaleLowerCase();
    return normalizedSearch
      ? options.filter((option) => option.name.toLocaleLowerCase().includes(normalizedSearch))
      : options;
  }, [options, searchTerm]);

  useLayoutEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      return;
    }

    searchInputRef.current?.focus();

    const updatePlacement = () => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const scrollParent = findScrollParent(container);
      const parentRect = scrollParent ? scrollParent.getBoundingClientRect() : null;
      const spaceBelow = Math.max(
        0,
        Math.min(window.innerHeight - rect.bottom, (parentRect ? parentRect.bottom : window.innerHeight) - rect.bottom)
      );
      const spaceAbove = Math.max(
        0,
        Math.min(rect.top, parentRect ? rect.top - parentRect.top : rect.top)
      );
      const shouldDropUp = spaceBelow < PANEL_MIN_HEIGHT && spaceAbove > spaceBelow;
      setDropUp(shouldDropUp);
      setPanelMaxHeight(Math.max(160, (shouldDropUp ? spaceAbove : spaceBelow) - 8));
    };

    updatePlacement();
    window.addEventListener('resize', updatePlacement);

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('resize', updatePlacement);
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
        onClick={() => setIsOpen((open) => !open)}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-left transition-all hover:bg-white focus:ring-2 focus:ring-[#3c5a82] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={`truncate text-sm ${selectedOption ? 'font-bold text-gray-900' : 'text-gray-400'}`}>
          {selectedOption?.name || placeholder}
        </span>
        <div className={`shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
          <ChevronDown aria-hidden="true" className="h-4 w-4 text-gray-400" />
        </div>
      </button>

      {isOpen && (
        <div
          style={{ maxHeight: panelMaxHeight }}
          className={`absolute left-0 z-[110] flex w-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white p-2 shadow-2xl ${
            dropUp ? 'bottom-full mb-2' : 'top-full mt-2'
          }`}
        >
          <div className="relative mb-2 shrink-0">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={searchPlaceholder}
              aria-label="Search options"
              className="w-full rounded-xl border border-gray-100 bg-gray-50 py-2.5 pl-9 pr-4 text-sm font-medium outline-none focus:ring-2 focus:ring-[#3c5a82]"
            />
          </div>
          <div role="listbox" className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
            {!searchTerm.trim() && (
              <button
                type="button"
                role="option"
                aria-selected={!value}
                onClick={() => selectOption('')}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-4 py-2.5 text-left text-sm transition-colors hover:bg-[#ebf4ff] ${
                  !value ? 'bg-[#ebf4ff] font-bold text-[#0f2f57]' : 'font-medium text-gray-500'
                }`}
              >
                <span className="truncate">{emptyOptionLabel}</span>
                {!value && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
              </button>
            )}
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={option.id === value}
                  key={option.id}
                  onClick={() => selectOption(option.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-4 py-2.5 text-left text-sm transition-colors hover:bg-[#ebf4ff] ${
                    option.id === value ? 'bg-[#ebf4ff] font-bold text-[#0f2f57]' : 'font-medium text-gray-700'
                  }`}
                >
                  <span className="truncate">{option.name}</span>
                  {option.id === value && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
                </button>
              ))
            ) : (
              <p className="px-4 py-4 text-center text-sm font-medium text-gray-400">No matching locations</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SearchableLocationSelect;
