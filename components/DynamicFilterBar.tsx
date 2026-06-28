import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { OrderStatus } from '../types';
import { ICONS } from '../constants';

type FilterType = 'Created by' | 'Order ID' | 'Customer Name' | 'Company' | 'Order Status' | 'Payment Status' | 'Customer Phone' | 'Assigned courier' | 'Free Text';

interface CombinedFilter {
  id: string;
  type: FilterType;
  operator: '=' | '≠' | 'contains';
  value: string;
  display?: string;
}

interface DynamicFilterBarProps {
  users?: { id: string; name: string; role: string }[];
  customers?: { id?: string; name?: string; phone?: string }[];
  orderNumberOptions?: string[];
  suggestionValues?: string[];
  companies?: string[];
  couriers?: string[];
  freeTextLabel?: string;
  onApply?: (filters: CombinedFilter[]) => void;
  className?: string;
}
const TYPE_OPTIONS: FilterType[] = ['Created by', 'Order ID', 'Customer Name', 'Company', 'Order Status', 'Payment Status', 'Customer Phone', 'Assigned courier'];
const PAYMENT_STATUS_OPTIONS = ['Paid', 'Partially Paid', 'Unpaid'];

const DynamicFilterBar: React.FC<DynamicFilterBarProps> = ({ users = [], customers = [], orderNumberOptions = [], suggestionValues = [], companies = [], couriers = [], freeTextLabel = 'Free text', onApply, className }) => {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  // stage: 0=pick type,1=pick operator,2=pick value
  const [stage, setStage] = useState(0);
  const [currentType, setCurrentType] = useState<FilterType | null>(null);
  const [currentOperator, setCurrentOperator] = useState<'=' | '≠' | 'contains' | null>(null);
  const [currentValue, setCurrentValue] = useState<string>('');
  const [filters, setFilters] = useState<CombinedFilter[]>([]);
  const [chipsWidth, setChipsWidth] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chipsRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    setChipsWidth(chipsRef.current?.offsetWidth ?? 0);
  }, [filters, currentType, currentOperator, currentValue, inputValue]);

  useEffect(() => {
    if (!isOpen) setStage(0);
  }, [isOpen]);

  // Close dropdown when user clicks outside or focus moves away
  useEffect(() => {
    if (!isOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const target = e.target as Node | null;
      if (target && !containerRef.current.contains(target)) {
        setIsOpen(false);
      }
    };
    const onFocusIn = () => {
      if (!containerRef.current) return;
      const active = document.activeElement;
      if (active && containerRef.current.contains(active)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [isOpen]);

  const filteredTypes = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return TYPE_OPTIONS;
    return TYPE_OPTIONS.filter(t => t.toLowerCase().includes(q));
  }, [inputValue]);

  const handleSelectType = (t: FilterType) => {
    setCurrentType(t);
    setStage(1);
    setInputValue('');
    // ensure focus after DOM updates
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSelectOperator = (op: '=' | '≠') => {
    setCurrentOperator(op);
    setStage(2);
    setInputValue('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const metadataSuggestions = useMemo(
    () => Array.from(new Set(suggestionValues.map(String).map((value) => value.trim()).filter((value) => value !== ''))),
    [suggestionValues]
  );

  const matchSuggestions = (q: string) => {
    const low = q.toLowerCase();
    const results: string[] = [];
    if (users) results.push(...users.map(u => `${u.name} (${u.role})`));
    if (customers) {
      results.push(...customers.map(c => c.name));
      results.push(...customers.map(c => (c.phone || '')));
      results.push(...customers.map(c => (c.id || '')));
    }
    results.push(...metadataSuggestions);
    return Array.from(new Set(results.filter((r) => r && r.toLowerCase().includes(low))));
  };

  const freeTextSuggestions = useMemo(
    () => inputValue.trim() ? matchSuggestions(inputValue.trim()) : [],
    [inputValue, matchSuggestions]
  );

  const companyItems = useMemo(() => {
    const source = companies || suggestionValues || [];
    return Array.from(new Set(source.filter(Boolean).map(String).map((value) => value.trim())));
  }, [companies, suggestionValues]);

  const courierItems = useMemo(() => {
    const source = couriers || suggestionValues || [];
    const base = Array.from(new Set(source.filter(Boolean).map(String).map((value) => value.trim())));
    return Array.from(new Set([...base, 'Manual/Other']));
  }, [couriers, suggestionValues]);

  const handleSelectValue = (val: string, display?: string) => {
    const combined: CombinedFilter = {
      id: String(Date.now()) + Math.random().toString(36).slice(2, 8),
      type: currentType || 'Free Text',
      operator: currentOperator || 'contains',
      value: val,
      display: display ?? (currentType ? undefined : `${freeTextLabel} containing ${val}`),
    };
    const newFilters = [...filters, combined];
    setFilters(newFilters);
    setCurrentType(null);
    setCurrentOperator(null);
    setCurrentValue('');
    setStage(0);
    setInputValue('');
    onApply?.(newFilters);
  };

  const handleRemoveFilter = (id: string) => {
    const newFilters = filters.filter(f => f.id !== id);
    setFilters(newFilters);
    onApply?.(newFilters);
  };

  const effectiveStage = currentType ? (currentOperator ? 2 : 1) : stage;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (effectiveStage === 0 && inputValue.trim() && filteredTypes.length === 0) {
        const combined: CombinedFilter = {
          id: String(Date.now()) + Math.random().toString(36).slice(2, 8),
          type: 'Free Text',
          operator: 'contains',
          value: inputValue.trim(),
          display: `${freeTextLabel} containing ${inputValue.trim()}`,
        };
        const newFilters = [...filters, combined];
        setFilters(newFilters);
        setInputValue('');
        setIsOpen(false);
        onApply?.(newFilters);
        return;
      }

      if (effectiveStage === 2 && inputValue.trim()) {
        handleSelectValue(inputValue.trim());
        setIsOpen(false);
        return;
      }

      if (filters.length > 0) {
        onApply?.(filters);
        setIsOpen(false);
      }
    }
    if (e.key === 'Escape') {
      setIsOpen(false);
      setStage(0);
    }
  };

  // Render dropdown items based on stage
  const renderDropdown = () => {
    if (!isOpen) return null;
    // promote stage based on transient state to avoid race conditions
    let effectiveStage = stage;
    if (currentType && effectiveStage < 1) effectiveStage = 1;
    if (currentOperator && effectiveStage < 2) effectiveStage = 2;
    if (effectiveStage === 0) {
        if (inputValue.trim()) {
          if (filteredTypes.length === 0) {
            return (
              <div className="py-2">
                <button onMouseDown={() => { handleSelectValue(inputValue.trim()); setIsOpen(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">Search for "{inputValue.trim()}"</button>
              </div>
            );
          }
          return (
            <div className="py-2">
              {filteredTypes.map(t => (
                <button key={t} onMouseDown={() => handleSelectType(t)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">{t}</button>
              ))}
              {freeTextSuggestions.length > 0 && freeTextSuggestions.map(s => (
                <button key={s} onMouseDown={() => { handleSelectValue(s); setIsOpen(false); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">{s}</button>
              ))}
            </div>
          );
        }
        return (
          <div className="py-2">
            {filteredTypes.map(t => (
              <button key={t} onMouseDown={() => handleSelectType(t)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">{t}</button>
            ))}
          </div>
        );
      }
    if (effectiveStage === 1) {
      return (
        <div className="py-2 p-2 flex flex-col gap-1">
          <button onMouseDown={() => handleSelectOperator('=')} className="px-3 py-2 rounded-lg hover:bg-gray-100 text-sm text-left">=</button>
          <button onMouseDown={() => handleSelectOperator('≠')} className="px-3 py-2 rounded-lg hover:bg-gray-100 text-sm text-left">≠</button>
        </div>
      );
    }

    // stage 2: value selection
    if (effectiveStage === 2) {
      if (currentType === 'Order Status') {
        const opts = Object.values(OrderStatus);
        return (
          <div className="py-2">
            {opts.map(s => (
              <button key={s} onMouseDown={() => handleSelectValue(s)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">{s}</button>
            ))}
          </div>
        );
      }

      if (currentType === 'Payment Status') {
        return (
          <div className="py-2">
            {PAYMENT_STATUS_OPTIONS.map(s => (
              <button key={s} onMouseDown={() => handleSelectValue(s)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">{s}</button>
            ))}
          </div>
        );
      }

      if (currentType === 'Created by') {
        const roleFirst = users.slice().sort((a, b) => a.role.localeCompare(b.role));
        return (
          <div className="py-2">
            {roleFirst.map(u => (
              <button key={u.id} onMouseDown={() => handleSelectValue(u.id, u.name)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">{u.role}: {u.name}</button>
            ))}
          </div>
        );
      }

      // For ID, Name, Phone and Free Text: allow typing and suggestions
      // For typed-entry types, show suggestions (including when empty)
      if (currentType === 'Customer Name') {
        const list = Array.from(new Set(customers.map(c => c.name).filter(Boolean)));
        const shown = inputValue.trim() ? list.filter(n => n.toLowerCase().includes(inputValue.trim().toLowerCase())) : list.slice(0, 20);
        const normalized = inputValue.trim();
        const showFallback = normalized && !list.some((n) => n.toLowerCase() === normalized.toLowerCase());
        return (
          <div className="py-2">
            {shown.map(s => (
              <button key={s} onMouseDown={() => handleSelectValue(s)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">{s}</button>
            ))}
            {showFallback && (
              <button onMouseDown={() => handleSelectValue(normalized)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">Use "{normalized}"</button>
            )}
            <div className="px-4 py-2 text-sm text-gray-400">Type a value and press Enter to add</div>
          </div>
        );
      }

      if (currentType === 'Customer Phone') {
        const list = Array.from(new Set(customers.map(c => c.phone).filter(Boolean)));
        const shown = inputValue.trim() ? list.filter(n => n.toLowerCase().includes(inputValue.trim().toLowerCase())) : list.slice(0, 20);
        const normalized = inputValue.trim();
        const showFallback = normalized && !list.some((n) => n.toLowerCase() === normalized.toLowerCase());
        return (
          <div className="py-2">
            {shown.map(s => (
              <button key={s} onMouseDown={() => handleSelectValue(s)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">{s}</button>
            ))}
            {showFallback && (
              <button onMouseDown={() => handleSelectValue(normalized)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">Use "{normalized}"</button>
            )}
            <div className="px-4 py-2 text-sm text-gray-400">Type a value and press Enter to add</div>
          </div>
        );
      }

      if (currentType === 'Order ID') {
        const list = Array.from(new Set(orderNumberOptions.filter(Boolean)));
        const shown = inputValue.trim() ? list.filter(n => n.toLowerCase().includes(inputValue.trim().toLowerCase())) : list.slice(0, 20);
        const normalized = inputValue.trim();
        const showFallback = normalized && !list.some((n) => n.toLowerCase() === normalized.toLowerCase());
        return (
          <div className="py-2">
            {shown.map(s => (
              <button key={s} onMouseDown={() => handleSelectValue(s)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">{s}</button>
            ))}
            {showFallback && (
              <button onMouseDown={() => handleSelectValue(normalized)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">Use "{normalized}"</button>
            )}
            <div className="px-4 py-2 text-sm text-gray-400">Type a value and press Enter to add</div>
          </div>
        );
      }

      // Company suggestions
      if (currentType === 'Company') {
        const shown = inputValue.trim() ? companyItems.filter(n => n.toLowerCase().includes(inputValue.trim().toLowerCase())) : companyItems.slice(0, 20);
        const normalized = inputValue.trim();
        const showFallback = normalized && !companyItems.some((n) => n.toLowerCase() === normalized.toLowerCase());
        return (
          <div className="py-2">
            {shown.map(s => (
              <button key={s} onMouseDown={() => handleSelectValue(s)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">{s}</button>
            ))}
            {showFallback && (
              <button onMouseDown={() => handleSelectValue(normalized)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">Use "{normalized}"</button>
            )}
            <div className="px-4 py-2 text-sm text-gray-400">Type a value and press Enter to add</div>
          </div>
        );
      }

      // Assigned courier suggestions
      if (currentType === 'Assigned courier') {
        const shown = inputValue.trim() ? courierItems.filter(n => n.toLowerCase().includes(inputValue.trim().toLowerCase())) : courierItems.slice(0, 20);
        const normalized = inputValue.trim();
        const showFallback = normalized && !courierItems.some((n) => n.toLowerCase() === normalized.toLowerCase());
        return (
          <div className="py-2">
            {shown.map(s => (
              <button key={s} onMouseDown={() => handleSelectValue(s)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">{s}</button>
            ))}
            {showFallback && (
              <button onMouseDown={() => handleSelectValue(normalized)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">Use "{normalized}"</button>
            )}
            <div className="px-4 py-2 text-sm text-gray-400">Type a value and press Enter to add</div>
          </div>
        );
      }

      // default suggestions from users/customers
      const suggestions = inputValue.trim() ? matchSuggestions(inputValue.trim()) : Array.from(new Set([...(users.map(u=>`${u.name} (${u.role})`)), ...(customers.map(c=>c.name))])).slice(0,20);
      const normalized = inputValue.trim();
      const showFallback = normalized && !suggestions.some((s) => s.toLowerCase() === normalized.toLowerCase());
      return (
        <div className="py-2">
          {suggestions.length > 0 && suggestions.map(s => (
            <button key={s} onMouseDown={() => handleSelectValue(s)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">{s}</button>
          ))}
          {showFallback && (
            <button onMouseDown={() => handleSelectValue(normalized)} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">Use "{normalized}"</button>
          )}
          <div className="px-4 py-2 text-sm text-gray-400">Type a value and press Enter to add</div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className={"w-full " + (className || '')}>
      <div className="w-full rounded-2xl border border-gray-100 bg-white shadow-sm overflow-visible">
          <div className="w-full relative" ref={containerRef}>
          <div className="flex items-center gap-2 w-full py-2 px-2">
            <div className="flex items-center gap-2 flex-1">
              <div ref={chipsRef} className="flex flex-wrap gap-2 items-center">
                {filters.map(f => (
                  <div key={f.id} className="inline-flex items-center gap-2 bg-gray-100 px-3 py-1 rounded-full text-sm font-bold">
                    {f.type !== 'Free Text' && <span className="opacity-80">{f.type}</span>}
                    {f.type !== 'Free Text' && <span>{f.operator}</span>}
                    <span className="font-normal">{f.display ?? f.value}</span>
                    <button onClick={() => handleRemoveFilter(f.id)} className="ml-2 text-gray-400">×</button>
                  </div>
                ))}

                {/* transient badges for in-progress filter parts */}
                {currentType && (
                  <div className="inline-flex items-center gap-2 bg-white border border-gray-200 px-3 py-1 rounded-full text-sm font-bold">
                    <span className="opacity-90">{currentType}</span>
                    <button onClick={() => { setCurrentType(null); setStage(0); setCurrentOperator(null); setCurrentValue(''); setTimeout(() => inputRef.current?.focus(), 0); }} className="ml-2 text-gray-400">×</button>
                  </div>
                )}

                {currentOperator && (
                  <div className="inline-flex items-center gap-2 bg-white border border-gray-200 px-3 py-1 rounded-full text-sm font-bold">
                    <span className="opacity-90">{currentOperator}</span>
                    <button onClick={() => { setCurrentOperator(null); setStage(1); setTimeout(() => inputRef.current?.focus(), 0); }} className="ml-2 text-gray-400">×</button>
                  </div>
                )}

                {currentValue && (
                  <div className="inline-flex items-center gap-2 bg-white border border-gray-200 px-3 py-1 rounded-full text-sm font-bold">
                    <span className="opacity-90">{currentValue}</span>
                  </div>
                )}
              </div>

              <input
                ref={inputRef}
                value={inputValue}
                onFocus={() => setIsOpen(true)}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={filters.length === 0 ? 'Search or select filters' : 'Search or filter'}
                className="flex-1 outline-none bg-transparent text-sm px-2 py-2"
              />
            </div>
            <div className="hidden sm:flex text-gray-400 pr-2">{ICONS.Search}</div>
          </div>

          {isOpen && (
            <div
              className="absolute z-40 mt-1 bg-white border border-gray-100 rounded-lg shadow-md"
              style={chipsWidth ? {
                left: `${chipsWidth + 8}px`,
                width: 'max-content',
                minWidth: '8rem',
                maxWidth: `calc(100% - ${chipsWidth + 24}px)`,
              } : { left: 0, right: 0 }}
            >
              {renderDropdown()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DynamicFilterBar;
