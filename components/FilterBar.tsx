
import React, { useEffect, useState } from 'react';
import { ICONS } from '../constants';
import { theme } from '../theme';
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
  const ranges: FilterRange[] = rangesProp ?? ['All Time', 'Today', 'This Week', 'This Month', 'This Year', 'Custom'];
  const updateCustomDate = (field: 'from' | 'to', value: string) => {
    setCustomDates({ ...customDates, [field]: value });
  };

  useEffect(() => {
    if (!isMobileFilterOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow || '';
    };
  }, [isMobileFilterOpen]);

  const mobileSummary = filterRange === 'Custom'
    ? `${customDates.from ? customDates.from.split('T')[0] : 'From'} → ${customDates.to ? customDates.to.split('T')[0] : 'To'}`
    : filterRange;

  return (
    <>
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${compact ? '' : 'mb-6'}`}>
        {/* Mobile filter button */}
        {!showOnMobile && (
          <div className="flex items-center justify-between w-full sm:hidden gap-3">
            <button
              type="button"
              onClick={() => setIsMobileFilterOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm transition hover:bg-gray-50"
            >
              Filter
            </button>
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">{mobileSummary}</span>
          </div>
        )}

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

      {/* Mobile filter drawer */}
      {!showOnMobile && isMobileFilterOpen && (
        <>
          <div className="fixed inset-0 z-[999] bg-black/40 backdrop-blur-sm" onClick={() => setIsMobileFilterOpen(false)} />
          <div className="fixed inset-x-0 bottom-0 z-[1000] rounded-t-3xl border border-gray-100 bg-white p-4 shadow-2xl animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-center justify-between gap-4 pb-4">
              <div>
                <p className="text-sm font-bold text-gray-900">Filter</p>
                <p className="text-xs text-gray-500">Select a date range or custom date bounds.</p>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileFilterOpen(false)}
                className="rounded-2xl p-2 text-gray-500 hover:bg-gray-100"
              >
                {ICONS.Close}
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2 bg-white p-1.5 rounded-2xl border border-gray-100 shadow-sm">
                {ranges.map(range => (
                  <button
                    key={range}
                    onClick={() => setFilterRange(range)}
                    className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${
                      filterRange === range 
                        ? `${theme.colors.primary[600]} text-white shadow-md` 
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {range}
                  </button>
                ))}
              </div>

              {filterRange === 'Custom' && (
                <div className="grid gap-3 rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  {setIncludeTime && (
                    <label className="flex items-center gap-3 text-sm font-semibold text-gray-700">
                      <input
                        type="checkbox"
                        checked={includeTime}
                        onChange={(e) => setIncludeTime(e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 bg-white text-[#3c5a82]"
                      />
                      Include time
                    </label>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-2 text-xs font-black uppercase tracking-[0.24em] text-gray-500">
                      From
                      <input
                        type={includeTime ? 'datetime-local' : 'date'}
                        step={includeTime ? 60 : undefined}
                        value={includeTime ? toDateTimeLocalInputValue(customDates.from, 'start') : (customDates.from ? customDates.from.split('T')[0] : customDates.from)}
                        onChange={(event) => updateCustomDate('from', event.target.value)}
                        className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-[#3c5a82] focus:ring-2 focus:ring-[#3c5a82]/30"
                      />
                    </label>
                    <label className="flex flex-col gap-2 text-xs font-black uppercase tracking-[0.24em] text-gray-500">
                      To
                      <input
                        type={includeTime ? 'datetime-local' : 'date'}
                        step={includeTime ? 60 : undefined}
                        value={includeTime ? toDateTimeLocalInputValue(customDates.to, 'end') : (customDates.to ? customDates.to.split('T')[0] : customDates.to)}
                        onChange={(event) => updateCustomDate('to', event.target.value)}
                        className="w-full rounded-2xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-900 outline-none focus:border-[#3c5a82] focus:ring-2 focus:ring-[#3c5a82]/30"
                      />
                    </label>
                  </div>
                </div>
              )}

              {setStatusTab && statusOptions.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 bg-gray-100/50 p-2 rounded-2xl border border-gray-100">
                  {['All', ...statusOptions].map(tab => (
                    <button
                      key={tab}
                      onClick={() => setStatusTab(tab)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold transition-all ${
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

              {onRefresh && (
                <button
                  onClick={onRefresh}
                  disabled={isRefreshing}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-white px-4 py-3 text-sm font-bold text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  <svg className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  Refresh
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default FilterBar;
