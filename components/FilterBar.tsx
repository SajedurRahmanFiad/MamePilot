
import React, { useState } from 'react';
import { ICONS } from '../constants';
import { theme } from '../theme';
import { useSearch } from '../src/contexts/SearchContext';
import { toDateTimeLocalInputValue } from '../utils';

export type FilterRange =
  | 'All Time'
  | 'Today'
  | 'Last 7 days'
  | 'Last 30 days'
  | 'This Week'
  | 'This Month'
  | 'This Year'
  | 'Custom';

interface FilterBarProps {
  filterRange: FilterRange;
  setFilterRange: (range: FilterRange) => void;
  customDates: { from: string; to: string };
  setCustomDates: (dates: { from: string; to: string }) => void;
  includeTime?: boolean;
  setIncludeTime?: (include: boolean) => void;
  statusTab?: string;
  setStatusTab?: (status: any) => void;
  statusOptions?: string[];
  title?: string;
  compact?: boolean;
  /** Override which range chips are shown. Defaults to the standard set. */
  ranges?: FilterRange[];
  /** Callback for an optional refresh button rendered to the right of the filter bar. */
  onRefresh?: () => void;
  /** Whether the refresh action is in progress. */
  isRefreshing?: boolean;
  /** Keep the range controls available on small screens using horizontal scrolling. */
  showOnMobile?: boolean;
}

const FilterBar: React.FC<FilterBarProps> = ({
  filterRange,
  setFilterRange,
  customDates,
  setCustomDates,
  includeTime = false,
  setIncludeTime,
  statusTab,
  setStatusTab,
  statusOptions = [],
  title
  , compact = false
  , ranges: rangesProp
  , onRefresh
  , isRefreshing = false
  , showOnMobile = false
}) => {
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const { searchQuery, setSearchQuery } = useSearch();
  const ranges: FilterRange[] = rangesProp ?? ['All Time', 'Today', 'This Week', 'This Month', 'This Year', 'Custom'];
  const updateCustomDate = (field: 'from' | 'to', value: string) => {
    setCustomDates({ ...customDates, [field]: value });
  };

  return (
    <>
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${compact ? '' : 'mb-6'}`}>
        {/* Desktop Filter Bar */}
        <div className={`${showOnMobile ? 'flex max-w-full overflow-x-auto pb-1' : 'hidden sm:flex'} flex-wrap items-center gap-3`}>
          <div className="flex min-w-max items-center gap-1.5 bg-white p-1.5 rounded-2xl border border-gray-100 shadow-sm">
            {ranges.map(range => (
              <button
                key={range}
                onClick={() => setFilterRange(range)}
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  filterRange === range 
                    ? `${theme.colors.primary[600]} text-white shadow-md` 
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {range}
              </button>
            ))}
            {filterRange === 'Custom' && (
              <div className="flex items-end gap-2 px-3 border-l border-gray-100 ml-1">
                {setIncludeTime && (
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={includeTime}
                      onChange={(e) => setIncludeTime(e.target.checked)}
                      className="w-3 h-3"
                    />
                    <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Time</span>
                  </label>
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">From</span>
                  <input
                    type={includeTime ? "datetime-local" : "date"}
                    step={includeTime ? 60 : undefined}
                    value={includeTime ? toDateTimeLocalInputValue(customDates.from, 'start') : (customDates.from ? customDates.from.split('T')[0] : customDates.from)}
                    onChange={(event) => updateCustomDate('from', event.target.value)}
                    className="px-2 py-1 border rounded-lg text-[10px] font-bold bg-gray-50 outline-none focus:ring-2 focus:ring-[#3c5a82]"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">To</span>
                  <input
                    type={includeTime ? "datetime-local" : "date"}
                    step={includeTime ? 60 : undefined}
                    value={includeTime ? toDateTimeLocalInputValue(customDates.to, 'end') : (customDates.to ? customDates.to.split('T')[0] : customDates.to)}
                    onChange={(event) => updateCustomDate('to', event.target.value)}
                    className="px-2 py-1 border rounded-lg text-[10px] font-bold bg-gray-50 outline-none focus:ring-2 focus:ring-[#3c5a82]"
                  />
                </label>
              </div>
            )}
          </div>

          {setStatusTab && statusOptions.length > 0 && (
            <div className="flex items-center gap-1 bg-gray-100/50 p-1 rounded-2xl border border-gray-100">
              {['All', ...statusOptions].map(tab => (
                <button
                  key={tab}
                  onClick={() => setStatusTab(tab)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                    statusTab === tab
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}
        </div>

        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={isRefreshing}
            className="hidden sm:flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold text-gray-500 bg-white border border-gray-100 shadow-sm hover:bg-gray-50 transition-all disabled:opacity-50"
            title="Refresh"
          >
            <svg className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            Refresh
          </button>
        )}
      </div>
    </>
  );
};

export default FilterBar;
