
import React, { useState } from 'react';
import { ICONS } from '../constants';
import { theme } from '../theme';
import { useSearch } from '../src/contexts/SearchContext';
import { toDateTimeLocalInputValue } from '../utils';

export type FilterRange = 'All Time' | 'Today' | 'This Week' | 'This Month' | 'This Year' | 'Custom';

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
}) => {
  const [isMobileFilterOpen, setIsMobileFilterOpen] = useState(false);
  const { searchQuery, setSearchQuery } = useSearch();
  const ranges: FilterRange[] = ['All Time', 'Today', 'This Week', 'This Month', 'This Year', 'Custom'];
  const updateCustomDate = (field: 'from' | 'to', value: string) => {
    setCustomDates({ ...customDates, [field]: value });
  };

  return (
    <>
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${compact ? '' : 'mb-6'}`}>
        {/* Desktop Filter Bar */}
        <div className="hidden sm:flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 bg-white p-1.5 rounded-2xl border border-gray-100 shadow-sm">
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

        {/* Mobile Filter Button */}
        <button 
          onClick={() => setIsMobileFilterOpen(true)}
          className="sm:hidden flex items-center justify-center gap-2 bg-white border border-gray-200 text-gray-600 px-4 py-3 rounded-2xl font-bold shadow-sm w-full"
        >
          {ICONS.Search} 
          <span className="text-sm">Filter & Period</span>
          {filterRange !== 'All Time' && <div className={`w-2 h-2 rounded-full ${theme.colors.primary[500]} ml-1`}></div>}
        </button>
      </div>

      {/* Mobile Filter Modal */}
      {isMobileFilterOpen && (
        <div className="fixed inset-0 z-[150] flex items-end justify-center">
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsMobileFilterOpen(false)}></div>
          <div className="bg-white w-full rounded-t-2xl p-8 z-[160] animate-in slide-in-from-bottom duration-300 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-black text-gray-900">Filter {title}</h3>
              <button onClick={() => setIsMobileFilterOpen(false)} className="p-2 text-gray-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l18 18"></path></svg>
              </button>
            </div>
            
            <div className="space-y-8">
              {/* Search Box */}
              <div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Search</p>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-3 pl-12 bg-gray-50 border border-gray-100 rounded-xl text-sm font-bold focus:ring-2 focus:ring-[#3c5a82] outline-none"
                  />
                  <span className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400">
                    {ICONS.Search}
                  </span>
                </div>
              </div>

              <div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Time Period</p>
                <div className="grid grid-cols-2 gap-2">
                  {ranges.map(range => (
                    <button
                      key={range}
                      onClick={() => setFilterRange(range)}
                      className={`py-3 rounded-2xl text-xs font-bold transition-all border ${
                        filterRange === range 
                          ? `${theme.colors.primary[600]} text-white border-[#0f2f57] shadow-lg` 
                          : 'bg-white text-gray-500 border-gray-100 hover:bg-gray-50'
                      }`}
                    >
                      {range}
                    </button>
                  ))}
                </div>
                
                {filterRange === 'Custom' && (
                  <div className="mt-4 space-y-4 animate-in fade-in duration-200">
                    {setIncludeTime && (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={includeTime}
                          onChange={(e) => setIncludeTime(e.target.checked)}
                          className="w-4 h-4"
                        />
                        <span className="text-sm font-bold text-gray-700">Include Time</span>
                      </label>
                    )}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-gray-400 uppercase ml-2">From</label>
                        <input
                          type={includeTime ? "datetime-local" : "date"}
                          step={includeTime ? 60 : undefined}
                          value={includeTime ? toDateTimeLocalInputValue(customDates.from, 'start') : (customDates.from ? customDates.from.split('T')[0] : customDates.from)}
                          onChange={(event) => updateCustomDate('from', event.target.value)}
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-sm font-bold focus:ring-2 focus:ring-[#3c5a82] outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[9px] font-bold text-gray-400 uppercase ml-2">To</label>
                        <input
                          type={includeTime ? "datetime-local" : "date"}
                          step={includeTime ? 60 : undefined}
                          value={includeTime ? toDateTimeLocalInputValue(customDates.to, 'end') : (customDates.to ? customDates.to.split('T')[0] : customDates.to)}
                          onChange={(event) => updateCustomDate('to', event.target.value)}
                          className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-sm font-bold focus:ring-2 focus:ring-[#3c5a82] outline-none"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {setStatusTab && statusOptions.length > 0 && (
                <div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Status Filter</p>
                  <div className="grid grid-cols-2 gap-2">
                    {['All', ...statusOptions].map(tab => (
                      <button
                        key={tab}
                        onClick={() => setStatusTab(tab)}
                        className={`py-3 rounded-2xl text-xs font-bold transition-all border ${
                          statusTab === tab 
                            ? 'bg-gray-900 text-white border-gray-900 shadow-lg' 
                            : 'bg-white text-gray-500 border-gray-100'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <button 
                onClick={() => setIsMobileFilterOpen(false)}
                className={`w-full py-5 ${theme.colors.primary[600]} text-white rounded-xl font-black text-lg shadow-xl active:scale-95 transition-all mt-4`}
              >
                Apply Filters
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default FilterBar;
