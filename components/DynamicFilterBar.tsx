import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ICONS } from '../constants';
import { formatDate } from '../utils';

export type FilterOperator = '=' | '≠' | 'contains' | 'does not contain' | '<' | '>' | 'on' | 'before' | 'after';

type FilterValueType = 'text' | 'number' | 'date';

interface FilterValueOption {
  value: string;
  label?: string;
}

export interface FilterDefinition {
  type: string;
  label?: string;
  operators?: readonly FilterOperator[];
  values?: Array<string | FilterValueOption>;
  suggestions?: string[];
  renderOptions?: (query: string) => FilterValueOption[];
  allowCustomValue?: boolean;
  customValuePlaceholder?: string;
  defaultOperator?: FilterOperator;
  valueLabelFormatter?: (value: string) => string;
  valueType?: FilterValueType;
}

export interface CombinedFilter {
  id: string;
  type: string;
  operator: FilterOperator;
  value: string;
  display?: string;
}

export const formatDateDisplay = (dateStr: string): string => {
  return formatDate(dateStr);
};

interface DynamicFilterBarProps {
  filterDefinitions?: FilterDefinition[];
  initialFilters?: CombinedFilter[];
  freeTextLabel?: string;
  onApply?: (filters: CombinedFilter[]) => void;
  className?: string;
  users?: { id: string; name: string; role: string }[];
  customers?: { id?: string; name?: string; phone?: string }[];
  orderNumberOptions?: string[];
  suggestionValues?: string[];
  companies?: string[];
  couriers?: string[];
}
const PAYMENT_STATUS_OPTIONS = ['Paid', 'Partially Paid', 'Unpaid', 'Overpaid', 'Refunded'];

const filterSignature = (items: CombinedFilter[] | undefined): string => JSON.stringify(
  (items ?? [])
    .map(({ type, operator, value }) => [type, operator, value])
    .sort((left, right) => left.join('\u0000').localeCompare(right.join('\u0000')))
);

const filterPresentationSignature = (items: CombinedFilter[] | undefined): string => JSON.stringify(
  (items ?? [])
    .map(({ type, operator, value, display }) => [type, operator, value, display ?? ''])
    .sort((left, right) => left.join('\u0000').localeCompare(right.join('\u0000')))
);

const DynamicFilterBar: React.FC<DynamicFilterBarProps> = ({ users = [], customers = [], orderNumberOptions = [], suggestionValues = [], companies = [], couriers = [], freeTextLabel = 'Free text', filterDefinitions, initialFilters, onApply, className }) => {
  const [inputValue, setInputValue] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  // stage: 0=pick type,1=pick operator,2=pick value
  const [stage, setStage] = useState(0);
  const [currentType, setCurrentType] = useState<string | null>(null);
  const [currentOperator, setCurrentOperator] = useState<FilterOperator | null>(null);
  const [filters, setFilters] = useState<CombinedFilter[]>(() => initialFilters ?? []);
  const [chipsWidth, setChipsWidth] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chipsRef = useRef<HTMLDivElement | null>(null);
  const acceptedExternalSignatureRef = useRef(filterSignature(initialFilters));
  const pendingLocalSyncRef = useRef<{ submitted: string; previousExternal: string; submittedAt: number } | null>(null);

  useEffect(() => {
    if (initialFilters === undefined) return;
    const incomingSignature = filterSignature(initialFilters);
    const pending = pendingLocalSyncRef.current;

    if (pending) {
      if (incomingSignature === pending.submitted) {
        pendingLocalSyncRef.current = null;
      } else if (incomingSignature === pending.previousExternal && Date.now() - pending.submittedAt < 2000) {
        // A controlled parent can briefly render its previous state while it
        // updates several state fields or URL parameters. Do not let that stale
        // snapshot erase the filter the user just submitted.
        return;
      } else {
        // A different semantic value is an intentional external replacement
        // (for example browser history hydration or parent normalization).
        pendingLocalSyncRef.current = null;
      }
    }

    acceptedExternalSignatureRef.current = incomingSignature;
    // Semantic equality keeps locally submitted chips stable, but their labels
    // can improve later when async option metadata arrives (for example an ID
    // becoming a category name after hydration). Accept those display-only
    // updates without using generated filter IDs as a source of churn.
    setFilters((current) => filterPresentationSignature(current) === filterPresentationSignature(initialFilters)
      ? current
      : initialFilters);
  }, [initialFilters]);

  useLayoutEffect(() => {
    setChipsWidth(chipsRef.current?.offsetWidth ?? 0);
  }, [filters, currentType, currentOperator, inputValue]);

  useEffect(() => {
    if (!isOpen) {
      setStage(0);
      setCurrentType(null);
      setCurrentOperator(null);
      setInputValue('');
      if (inputRef.current === document.activeElement) {
        inputRef.current.blur();
      }
    }
  }, [isOpen]);

  // Close on outside interaction. Dropdown buttons retain input focus while
  // moving between stages, so an unmounted option cannot reset the badges.
  useEffect(() => {
    if (!isOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      // Selecting a dropdown item changes the stage and unmounts that button
      // before this document listener runs. `contains(target)` then becomes
      // false even though the pointer event originated inside the filterbar.
      // The composed path is captured for the whole event dispatch and keeps
      // the original ancestry, so it remains reliable across that rerender.
      if (e.composedPath().includes(container)) return;
      const target = e.target as Node | null;
      if (target && container.contains(target)) return;
      setIsOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
    };
  }, [isOpen]);

  const metadataSuggestions = useMemo(
    () => Array.from(new Set(suggestionValues.map(String).map((value) => value.trim()).filter((value) => value !== ''))),
    [suggestionValues]
  );

  const normalizeFilterValues = (values: Array<string | FilterValueOption>) => {
    const unique = new Map<string, FilterValueOption>();
    values
      .filter(Boolean)
      .map((value) => typeof value === 'string' ? { value, label: value } : value)
      .map((item) => ({
        value: String(item.value).trim(),
        label: String(item.label || item.value).trim(),
      }))
      .filter((item) => item.value !== '')
      .forEach((item) => unique.set(item.value, item));
    return Array.from(unique.values());
  };

  const defaultFilterDefinitions = useMemo<FilterDefinition[]>(() => {
    const companyOptions = Array.from(new Set((companies || suggestionValues || []).filter(Boolean).map(String).map((value) => value.trim())));
    return [
      {
        type: 'Created by',
        operators: ['=', '≠'],
        renderOptions: (query: string) => {
          const list = users
            .slice()
            .sort((a, b) => a.role.localeCompare(b.role))
            .map((u) => ({ value: u.id, label: `${u.role}: ${u.name}` }));
          return query
            ? list.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
            : list;
        },
      },
      {
        type: 'Company',
        operators: ['=', '≠'],
        values: companyOptions,
        allowCustomValue: true,
      },
      {
        type: 'Payment Status',
        operators: ['=', '≠'],
        values: PAYMENT_STATUS_OPTIONS,
      },
    ];
  }, [companies, suggestionValues, users, metadataSuggestions]);

  const effectiveFilterDefinitions = useMemo(
    () => (filterDefinitions && filterDefinitions.length > 0 ? filterDefinitions : defaultFilterDefinitions),
    [filterDefinitions, defaultFilterDefinitions]
  );

  const filteredTypes = useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return effectiveFilterDefinitions.map((def) => def.type);
    return effectiveFilterDefinitions
      .map((def) => def.type)
      .filter((t) => t.toLowerCase().includes(q));
  }, [inputValue, effectiveFilterDefinitions]);

  const findFilterDefinition = (type: string | null) => {
    return effectiveFilterDefinitions.find((def) => def.type === type) ?? null;
  };

  const currentDefinition = findFilterDefinition(currentType);

  const handleSelectType = (type: string) => {
    const definition = findFilterDefinition(type);
    const operators = definition?.operators ?? ['='];
    const operator = definition?.defaultOperator ?? operators[0] ?? '=';
    const singleOperator = operators.length === 1;

    setCurrentType(type);
    setCurrentOperator(singleOperator ? operator : null);
    setStage(singleOperator ? 2 : (operators.length > 1 ? 1 : 2));
    setInputValue('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSelectOperator = (op: FilterOperator) => {
    setCurrentOperator(op);
    setStage(2);
    setInputValue('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSelectValue = (val: string, display?: string) => {
    if (!currentType) return;
    const normalizedValue = String(val).trim();
    if (!normalizedValue) return;
    const valueType = currentDefinition?.valueType || 'text';
    if (valueType === 'number' && !Number.isFinite(Number(normalizedValue))) return;
    if (valueType === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) return;

    const combined: CombinedFilter = {
      id: String(Date.now()) + Math.random().toString(36).slice(2, 8),
      type: currentType,
      operator: currentOperator ?? currentDefinition?.operators?.[0] ?? 'contains',
      value: normalizedValue,
      display,
    };

    const nextFilters = filters.filter((filter) => filter.type !== combined.type);
    nextFilters.push(combined);
    pendingLocalSyncRef.current = {
      submitted: filterSignature(nextFilters),
      previousExternal: acceptedExternalSignatureRef.current,
      submittedAt: Date.now(),
    };
    setFilters(nextFilters);
    onApply?.(nextFilters);

    setCurrentType(null);
    setCurrentOperator(null);
    setStage(0);
    setInputValue('');
  };

  const handleRemoveFilter = (id: string) => {
    const newFilters = filters.filter((f) => f.id !== id);
    pendingLocalSyncRef.current = {
      submitted: filterSignature(newFilters),
      previousExternal: acceptedExternalSignatureRef.current,
      submittedAt: Date.now(),
    };
    setFilters(newFilters);
    onApply?.(newFilters);
  };

  const effectiveStage = currentType ? (currentOperator ? 2 : 1) : stage;

  const getValueOptions = (definition: FilterDefinition | null, query: string) => {
    if (!definition) return [];
    const normalizedQuery = query.trim().toLowerCase();
    const buildOptions = (items: Array<string | FilterValueOption>) => {
      return normalizeFilterValues(items).filter((item) =>
        !normalizedQuery || item.label.toLowerCase().includes(normalizedQuery) || item.value.toLowerCase().includes(normalizedQuery)
      );
    };
    if (definition.renderOptions) {
      return definition.renderOptions(normalizedQuery).map((item) => ({
        value: String(item.value).trim(),
        label: String(item.label || item.value).trim(),
      }));
    }
    if (definition.values) {
      return buildOptions(definition.values);
    }
    if (definition.suggestions) {
      return buildOptions(definition.suggestions);
    }
    return [];
  };

  const renderValueOptions = (definition: FilterDefinition | null) => {
    const query = inputValue.trim();
    const valueType = definition?.valueType || 'text';
    const options = getValueOptions(definition, query);
    const exactMatch = query && options.some((item) => item.value.toLowerCase() === query.toLowerCase());
    const hasDefinedOptions = Boolean(definition?.values || definition?.suggestions || definition?.renderOptions);
    const allowCustom = definition?.allowCustomValue ?? !hasDefinedOptions;
    const labelFormatter = definition?.valueLabelFormatter ?? ((value: string) => value);

    // Date picker for date filters
    if (valueType === 'date') {
      return (
        <div className="p-3">
          <input
            type="date"
            value={query}
            onChange={(e) => {
              setInputValue(e.target.value);
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {query && (
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                handleSelectValue(query, formatDateDisplay(query));
                setIsOpen(false);
              }}
              className="mt-2 w-full px-3 py-2 bg-blue-500 text-white rounded-lg text-sm font-bold hover:bg-blue-600 transition-colors"
            >
              Select {formatDateDisplay(query)}
            </button>
          )}
        </div>
      );
    }

    // Number input for numeric filters
    if (valueType === 'number') {
      return (
        <div className="p-3">
          <input
            type="number"
            value={query}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && inputValue.trim()) {
                handleSelectValue(inputValue.trim(), inputValue.trim());
                setIsOpen(false);
              }
            }}
            placeholder="Enter a number"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="mt-2 text-xs text-gray-400">Press Enter to apply</div>
        </div>
      );
    }

    if (options.length > 0) {
      return (
        <div className="py-2">
          <div className="max-h-60 overflow-y-auto">
            {options.map((option) => (
              <button
                type="button"
                key={`${option.value}-${option.label}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  handleSelectValue(option.value, option.label);
                  setIsOpen(false);
                }}
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
              >
                {option.label}
              </button>
            ))}
          </div>
          {query && allowCustom && !exactMatch && (
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
                handleSelectValue(query, labelFormatter(query));
              }}
              className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
            >
              Use "{query}"
            </button>
          )}
          {allowCustom && (
            <div className="px-4 py-2 text-sm text-gray-400">Type a value and press Enter to add</div>
          )}
        </div>
      );
    }

    if (query && allowCustom) {
      return (
        <div className="py-2">
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              handleSelectValue(query, labelFormatter(query));
            }}
            className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
          >
            Use "{query}"
          </button>
          <div className="px-4 py-2 text-sm text-gray-400">Type a value and press Enter to add</div>
        </div>
      );
    }

    return (
      <div className="py-2 px-4 text-sm text-gray-500">Type a value and press Enter to add</div>
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (effectiveStage === 0 && inputValue.trim() && filteredTypes.length === 0) {
        return;
      }

      if (effectiveStage === 2 && inputValue.trim()) {
        const hasDefinedOptions = Boolean(currentDefinition?.values || currentDefinition?.suggestions || currentDefinition?.renderOptions);
        const allowCustom = currentDefinition?.allowCustomValue ?? !hasDefinedOptions;
        if (!allowCustom) {
          const exactOption = getValueOptions(currentDefinition, inputValue)
            .find((option) => option.value.toLowerCase() === inputValue.trim().toLowerCase());
          if (!exactOption) return;
          handleSelectValue(exactOption.value, exactOption.label);
          setIsOpen(false);
          return;
        }
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
    let effectiveStage = stage;
    if (currentType && effectiveStage < 1) effectiveStage = 1;
    if (currentOperator && effectiveStage < 2) effectiveStage = 2;
    if (effectiveStage === 0) {
      if (inputValue.trim()) {
        if (filteredTypes.length === 0) {
          return (
            <div className="py-2 px-4 text-sm text-gray-500">No matching filters found.</div>
          );
        }
        return (
          <div className="py-2">
            {filteredTypes.map((t) => (
              <button type="button" key={t} onMouseDown={(event) => { event.preventDefault(); handleSelectType(t); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">
                {t}
              </button>
            ))}
          </div>
        );
      }
      return (
        <div className="py-2">
          {filteredTypes.map((t) => (
            <button type="button" key={t} onMouseDown={(event) => { event.preventDefault(); handleSelectType(t); }} className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100">
              {t}
            </button>
          ))}
        </div>
      );
    }
    if (effectiveStage === 1) {
      const definition = currentDefinition;
      const operators = definition?.operators ?? ['=', '≠'];
      if (operators.length === 1) {
        return renderValueOptions(definition);
      }
      return (
        <div className="py-2 p-2 flex flex-col gap-1">
          {operators.map((op) => (
            <button type="button" key={op} onMouseDown={(event) => { event.preventDefault(); handleSelectOperator(op); }} className="px-3 py-2 rounded-lg hover:bg-gray-100 text-sm text-left">
              {op}
            </button>
          ))}
        </div>
      );
    }
    return renderValueOptions(currentDefinition);
  };

  return (
    <div className={"w-full " + (className || '')}>
      <div className="w-full overflow-visible">
        <div
          className="relative w-full rounded-2xl border border-gray-200 bg-white shadow-sm"
          ref={containerRef}
        >
          <div className="flex w-full items-center gap-2 px-3 py-2.5">
            <div className="flex flex-1 items-center gap-2">
              <div ref={chipsRef} className="flex flex-wrap items-center gap-2">
                {filters.map(f => (
                  <div key={f.id} className="inline-flex items-center gap-2 bg-white px-3 py-1 rounded-full border border-gray-200 text-sm font-bold">
                    <span className="opacity-80">{f.type}</span>
                    <span>{f.operator}</span>
                    <span className="font-normal">{f.display ?? f.value}</span>
                    <button type="button" onClick={() => handleRemoveFilter(f.id)} className="ml-2 text-gray-400">×</button>
                  </div>
                ))}

                {/* transient badges for in-progress filter parts */}
                {currentType && (
                  <div className="inline-flex items-center gap-2 bg-white border border-gray-200 px-3 py-1 rounded-full text-sm font-bold">
                    <span className="opacity-90">{currentType}</span>
                    <button type="button" onClick={() => { setCurrentType(null); setStage(0); setCurrentOperator(null); setTimeout(() => inputRef.current?.focus(), 0); }} className="ml-2 text-gray-400">×</button>
                  </div>
                )}

                {currentOperator && currentDefinition?.operators && currentDefinition.operators.length > 1 && (
                  <div className="inline-flex items-center gap-2 bg-white border border-gray-200 px-3 py-1 rounded-full text-sm font-bold">
                    <span className="opacity-90">{currentOperator}</span>
                    <button type="button" onClick={() => { setCurrentOperator(null); setStage(1); setTimeout(() => inputRef.current?.focus(), 0); }} className="ml-2 text-gray-400">×</button>
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
            <div className="hidden sm:flex rounded-lg bg-white p-2 text-gray-400 shadow-sm">{ICONS.Search}</div>
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
