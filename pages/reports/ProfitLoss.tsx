
import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db';
import { formatCurrency, ICONS } from '../../constants';
import { ReportPageSkeleton } from '../../components';
import { theme } from '../../theme';
import { useCompanySettings, useProfitLossReport } from '../../src/hooks/useQueries';
import { normalizeCompanySettings } from '../../src/utils/companyPages';

const PLRow: React.FC<{ label: string; amount: number; isBold?: boolean; isTotal?: boolean; indent?: boolean }> = ({ label, amount, isBold, isTotal, indent }) => (
  <div className={`flex justify-between py-2 ${isBold ? 'font-bold text-gray-900' : 'text-gray-600'} ${isTotal ? 'border-t-2 border-gray-100 pt-4 mt-2' : ''} ${indent ? 'pl-6' : ''}`}>
    <span className="text-sm">{label}</span>
    <span className="text-sm font-black">{formatCurrency(amount)}</span>
  </div>
);

const ProfitLoss: React.FC = () => {
  const navigate = useNavigate();
  type DateRangeType = 'currentYear' | 'currentMonth' | 'custom';
  const [dateRange, setDateRange] = useState<DateRangeType>('currentYear');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedCompanyIds, setAppliedCompanyIds] = useState<string[]>([]);
  const [pendingCompanyIds, setPendingCompanyIds] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const reportFilterRange = dateRange === 'currentMonth' ? 'This Month' : dateRange === 'custom' ? 'Custom' : 'This Year';

  const { data: companySettingsData, isPending: isCompanyLoading } = useCompanySettings();
  const companySettings = useMemo(
    () => normalizeCompanySettings(companySettingsData || db.settings.company),
    [companySettingsData],
  );
  const allCompanyIds = useMemo(() => companySettings.pages.map((p) => p.id), [companySettings.pages]);

  const { data: plData, isPending: isReportLoading } = useProfitLossReport(
    reportFilterRange,
    { from: customFrom, to: customTo },
    appliedCompanyIds,
  );

  const brandedCompanies = appliedCompanyIds.length === 0
    ? companySettings.pages
    : companySettings.pages.filter((company) => appliedCompanyIds.includes(company.id));
  const brandingNames = brandedCompanies.map((company) => company.name).filter(Boolean);
  const expenseRows = plData?.expenses || [];

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setPendingCompanyIds(appliedCompanyIds);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen, appliedCompanyIds]);

  const openDropdown = () => {
    setPendingCompanyIds(appliedCompanyIds);
    setDropdownOpen(true);
  };

  const togglePending = (id: string) => {
    setPendingCompanyIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const selectAll = () => setPendingCompanyIds(allCompanyIds);
  const deselectAll = () => setPendingCompanyIds([]);

  const confirmSelection = () => {
    setAppliedCompanyIds(pendingCompanyIds);
    setDropdownOpen(false);
  };

  const allSelected = pendingCompanyIds.length === allCompanyIds.length;
  const selectionLabel = appliedCompanyIds.length === 0
    ? 'All Companies'
    : appliedCompanyIds.length === allCompanyIds.length
      ? 'All Companies'
      : appliedCompanyIds.length === 1
        ? companySettings.pages.find((p) => p.id === appliedCompanyIds[0])?.name || '1 Company'
        : `${appliedCompanyIds.length} Companies`;

  if (isCompanyLoading || isReportLoading) {
    return <ReportPageSkeleton cards={6} showChart={false} showFilters tableColumns={2} tableRows={8} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/reports')} className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          </button>
          <h2 className="text-2xl font-bold text-gray-900">Profit and Loss Statement</h2>
        </div>
        <button
          onClick={() => window.print()}
          className={`flex items-center gap-2 px-4 py-2 ${theme.colors.primary[600]} hover:${theme.colors.primary[700]} text-white font-bold rounded-xl transition-colors`}
        >
          {ICONS.Print} Print Statement
        </button>
      </div>

      <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="flex-1 min-w-0 relative" ref={dropdownRef}>
          <label className="block text-xs font-bold text-gray-500 mb-1.5">Company</label>
          <button
            type="button"
            onClick={() => (dropdownOpen ? setDropdownOpen(false) : openDropdown())}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-900 outline-none transition text-left flex items-center justify-between focus:border-[var(--primary-medium,#3c5a82)] focus:bg-white focus:ring-2 focus:ring-[var(--primary-soft,#ebf4ff)]"
          >
            <span className="truncate">{selectionLabel}</span>
            <svg className={`w-4 h-4 text-gray-400 shrink-0 ml-2 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
          </button>
          {dropdownOpen && (
            <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
              <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
                <button
                  type="button"
                  onClick={allSelected ? deselectAll : selectAll}
                  className="text-xs font-bold text-[var(--primary-medium,#3c5a82)] hover:underline"
                >
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
                <span className="text-xs text-gray-400">{pendingCompanyIds.length}/{allCompanyIds.length}</span>
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                {companySettings.pages.map((company) => (
                  <label
                    key={company.id}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={pendingCompanyIds.includes(company.id)}
                      onChange={() => togglePending(company.id)}
                      className="w-4 h-4 rounded border-gray-300 text-[var(--primary-medium,#3c5a82)] focus:ring-[var(--primary-soft,#ebf4ff)]"
                    />
                    {company.logo && (
                      <img src={company.logo} alt="" className="w-6 h-6 rounded object-contain shrink-0" />
                    )}
                    <span className="text-sm font-medium text-gray-700 truncate">{company.name}</span>
                  </label>
                ))}
              </div>
              <div className="px-3 py-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={confirmSelection}
                  className={`w-full py-1.5 rounded-lg text-sm font-bold text-white transition-colors ${theme.colors.primary[600]} hover:${theme.colors.primary[700]}`}
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className="block text-xs font-bold text-gray-500 mb-1.5">Period</span>
          <div className="flex flex-wrap gap-2 items-center">
            {(['currentYear', 'currentMonth', 'custom'] as DateRangeType[]).map((opt) => (
              <label
                key={opt}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition-colors border ${
                  dateRange === opt
                    ? 'bg-[var(--primary-soft,#ebf4ff)] border-[var(--primary-medium,#3c5a82)] text-[var(--primary-medium,#3c5a82)]'
                    : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                }`}
              >
                <input
                  type="radio"
                  name="dateRange"
                  value={opt}
                  checked={dateRange === opt}
                  onChange={(e) => setDateRange(e.target.value as DateRangeType)}
                  className="sr-only"
                />
                {opt === 'currentYear' ? 'This Year' : opt === 'currentMonth' ? 'This Month' : 'Custom Range'}
              </label>
            ))}
            {dateRange === 'custom' && (
              <div className="flex gap-2 items-center ml-1">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs"
                />
                <span className="text-xs text-gray-400">–</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="p-8 bg-gray-50 border-b border-gray-100">
          <div className="flex flex-col items-stretch justify-center gap-4 sm:flex-row sm:items-center">
            {brandedCompanies.map((company, index) => (
              <Fragment key={company.id}>
                {index > 0 && <span className="self-center text-2xl font-black text-gray-300" aria-hidden="true">+</span>}
                <div className="min-w-0 flex-1 text-center">
                  {company.logo && (
                    <img src={company.logo} alt={`${company.name} logo`} className="w-16 h-16 rounded-xl object-contain mx-auto mb-3" />
                  )}
                  <h3 className="text-lg font-bold text-gray-900">{company.name}</h3>
                </div>
              </Fragment>
            ))}
          </div>
        </div>

        <div className="p-8 space-y-2">
          <div className="flex gap-6 pb-6 mb-2 border-b border-gray-100">
            <div className="flex-1 text-center">
              <p className="text-2xl font-black text-gray-900">{plData?.orderCount ?? 0}</p>
              <p className="text-xs font-bold text-gray-500 mt-1">Orders Delivered</p>
            </div>
            <div className="flex-1 text-center border-l border-gray-100 pl-6">
              <p className="text-2xl font-black text-gray-900">{plData?.productsSold ?? 0}</p>
              <p className="text-xs font-bold text-gray-500 mt-1">Products Sold</p>
            </div>
          </div>

          <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Revenue</h4>
          {(plData?.incomeCategories ?? []).length > 0 ? (
            plData!.incomeCategories.map((e, i) => (
              <PLRow key={i} label={e.categoryName} amount={e.amount} />
            ))
          ) : (
            <PLRow label="Gross Sales (Delivered Orders)" amount={plData?.grossSales || 0} />
          )}
          <PLRow label="Total Revenue" amount={plData?.grossSales || 0} isBold isTotal />

          <div className="pt-8">
            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Cost of Goods Sold</h4>
            <PLRow label="Purchases" amount={plData?.costOfPurchases || 0} />
            <PLRow label="Total COGS" amount={plData?.costOfPurchases || 0} isBold isTotal />
          </div>

          <div className="pt-8">
            <PLRow label="Gross Profit" amount={plData?.grossProfit || 0} isBold />
          </div>

          <div className="pt-8">
            <h4 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-4">Operating Expenses</h4>
            {expenseRows.length > 0 ? (
              expenseRows.map((e, i) => (
                <PLRow key={i} label={e.categoryName} amount={e.amount} indent />
              ))
            ) : (
              <PLRow label="None" amount={0} indent />
            )}
            <PLRow label="Total Operating Expenses" amount={plData?.totalOperatingExpenses || 0} isBold isTotal />
          </div>

          <div className="pt-12">
            <div className={`p-6 rounded-lg flex justify-between items-center ${(plData?.netProfit || 0) >= 0 ? theme.colors.primary[600] : 'bg-red-600'} text-white shadow-xl`}>
              <span className="text-lg font-black uppercase tracking-widest">Net Profit / Loss</span>
              <span className="text-lg font-black">{formatCurrency(plData?.netProfit || 0)}</span>
            </div>
          </div>

          {plData?.sharedCostsConsolidated && appliedCompanyIds.length > 0 && (
            <p className="pt-5 text-xs font-medium leading-5 text-gray-500">
              Shared purchases and operating costs have no company assignment in existing records, so they remain consolidated in this company view. Order-linked revenue and expenses are filtered to the selected companies.
            </p>
          )}
        </div>

        <div className="p-8 text-center text-[10px] text-gray-300 italic border-t border-gray-50">
          This report is generated automatically by {brandingNames.join(' + ') || 'Mame Pilot'} Financial Management System.
        </div>
      </div>
    </div>
  );
};

export default ProfitLoss;
