
import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../../db';
import { formatCurrency, ICONS } from '../../constants';
import { ReportPageSkeleton } from '../../components';
import { theme } from '../../theme';
import type { FilterRange } from '../../utils';
import { toDateTimeLocalInputValue } from '../../utils';
import { useCompanySettings, useOrderReport } from '../../src/hooks/useQueries';
import { normalizeCompanySettings } from '../../src/utils/companyPages';
import type { OrderReportDateMode } from '../../types';

const DATE_MODE_LABELS: Record<OrderReportDateMode, string> = {
  created: 'Orders created during',
  on_hold: 'On Hold during',
  processing: 'Processing during',
  courier: 'Courier assigned during',
  picked: 'Picked during',
  completed: 'Actions delivered during',
  partiallyDelivered: 'Partially delivered during',
  exchangeProcessing: 'Exchange processing during',
  exchangePicked: 'Exchange picked during',
  exchangeDelivered: 'Exchange delivered during',
  exchangeReturned: 'Exchange returned during',
  exchangeCancelled: 'Exchange cancelled during',
  returned: 'Returned during',
  cancelled: 'Cancelled during',
};

export const ORDER_REPORT_DATE_MODES = Object.keys(DATE_MODE_LABELS) as OrderReportDateMode[];

const SummaryCard: React.FC<{ label: string; value: string | number; sub?: string; color?: string }> = ({ label, value, sub, color }) => (
  <div className={`p-4 rounded-xl border border-gray-100 bg-white shadow-sm ${color ? `border-l-4 ${color}` : ''}`}>
    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">{label}</p>
    <p className="text-xl font-black text-gray-900">{value}</p>
    {sub && <p className="text-[10px] font-bold text-gray-400 mt-0.5">{sub}</p>}
  </div>
);

const InsightRow: React.FC<{ label: string; value: string; detail?: string; valueClass?: string }> = ({ label, value, detail, valueClass = 'text-gray-900' }) => (
  <div className="flex items-center justify-between py-3 border-b border-gray-50 last:border-b-0">
    <div>
      <p className="text-sm font-bold text-gray-700">{label}</p>
      {detail && <p className="text-[10px] font-medium text-gray-400 mt-0.5">{detail}</p>}
    </div>
    <p className={`text-sm font-black ${valueClass}`}>{value}</p>
  </div>
);

const OrderReport: React.FC = () => {
  const navigate = useNavigate();
  const [filterRange, setFilterRange] = useState<FilterRange>('Today');
  const [customDates, setCustomDates] = useState({ from: '', to: '' });
  const [includeTime, setIncludeTime] = useState(false);
  const [dateMode, setDateMode] = useState<OrderReportDateMode>('completed');
  const [appliedCompanyIds, setAppliedCompanyIds] = useState<string[]>([]);
  const [pendingCompanyIds, setPendingCompanyIds] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: companySettingsData, isPending: isCompanyLoading } = useCompanySettings();
  const companySettings = useMemo(
    () => normalizeCompanySettings(companySettingsData || db.settings.company),
    [companySettingsData],
  );
  const allCompanyIds = useMemo(() => companySettings.pages.map((p) => p.id), [companySettings.pages]);

  const { data: reportData, isPending: isReportLoading } = useOrderReport(
    filterRange,
    customDates,
    appliedCompanyIds,
    dateMode,
  );

  const brandedCompanies = appliedCompanyIds.length === 0
    ? companySettings.pages
    : companySettings.pages.filter((company) => appliedCompanyIds.includes(company.id));
  const brandingNames = brandedCompanies.map((company) => company.name).filter(Boolean);

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

  const completionRate = (reportData?.totalOrders ?? 0) > 0
    ? Math.round(((reportData?.completedCount ?? 0) / (reportData?.totalOrders ?? 1)) * 100)
    : 0;
  const returnRate = (reportData?.totalOrders ?? 0) > 0
    ? Math.round(((reportData?.returnedCount ?? 0) / (reportData?.totalOrders ?? 1)) * 100)
    : 0;
  const cancelRate = (reportData?.totalOrders ?? 0) > 0
    ? Math.round(((reportData?.cancelledCount ?? 0) / (reportData?.totalOrders ?? 1)) * 100)
    : 0;
  const avgOrderValue = (reportData?.totalOrders ?? 0) > 0
    ? (reportData?.totalRevenue ?? 0) / (reportData?.totalOrders ?? 1)
    : 0;
  const collectionRate = (reportData?.totalRevenue ?? 0) > 0
    ? Math.round(((reportData?.totalPaid ?? 0) / (reportData?.totalRevenue ?? 1)) * 100)
    : 0;

  if (isCompanyLoading || isReportLoading) {
    return <ReportPageSkeleton cards={5} showChart={false} showFilters tableColumns={0} tableRows={0} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/reports')} className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          </button>
          <h2 className="text-2xl font-bold text-gray-900">Order Report</h2>
        </div>
        <button
          onClick={() => window.print()}
          className={`flex items-center gap-2 px-4 py-2 ${theme.colors.primary[600]} hover:${theme.colors.primary[700]} text-white font-bold rounded-xl transition-colors`}
        >
          {ICONS.Print} Print Report
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
          <label className="block text-xs font-bold text-gray-500 mb-1.5">Date Mode</label>
          <select
            value={dateMode}
            onChange={(e) => setDateMode(e.target.value as OrderReportDateMode)}
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-900 outline-none transition focus:border-[var(--primary-medium,#3c5a82)] focus:bg-white focus:ring-2 focus:ring-[var(--primary-soft,#ebf4ff)]"
          >
            {ORDER_REPORT_DATE_MODES.map((mode) => (
              <option key={mode} value={mode}>{DATE_MODE_LABELS[mode]}</option>
            ))}
          </select>
        </div>

        <div className="shrink-0">
          <label className="block text-xs font-bold text-gray-500 mb-1.5">Period</label>
          <div className="flex flex-wrap items-center gap-1.5 bg-white p-1.5 rounded-2xl border border-gray-100 shadow-sm">
            {(['All Time', 'Today', 'This Week', 'This Month', 'This Year', 'Custom'] as FilterRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setFilterRange(range)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  filterRange === range
                    ? `${theme.colors.primary[600]} text-white shadow-md`
                    : 'text-gray-500 hover:bg-gray-50'
                }`}
              >
                {range}
              </button>
            ))}
            {filterRange === 'Custom' && (
              <div className="flex items-center gap-2 px-2 border-l border-gray-100 ml-1">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={includeTime}
                    onChange={(e) => setIncludeTime(e.target.checked)}
                    className="w-3 h-3"
                  />
                  <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Time</span>
                </label>
                <input
                  type={includeTime ? 'datetime-local' : 'date'}
                  step={includeTime ? 60 : undefined}
                  value={includeTime ? toDateTimeLocalInputValue(customDates.from, 'start') : (customDates.from ? customDates.from.split('T')[0] : customDates.from)}
                  onChange={(e) => setCustomDates({ ...customDates, from: e.target.value })}
                  className="px-2 py-1 border rounded-lg text-[10px] font-bold bg-gray-50 outline-none focus:ring-2 focus:ring-[#3c5a82]"
                />
                <span className="text-[10px] text-gray-400">–</span>
                <input
                  type={includeTime ? 'datetime-local' : 'date'}
                  step={includeTime ? 60 : undefined}
                  value={includeTime ? toDateTimeLocalInputValue(customDates.to, 'end') : (customDates.to ? customDates.to.split('T')[0] : customDates.to)}
                  onChange={(e) => setCustomDates({ ...customDates, to: e.target.value })}
                  className="px-2 py-1 border rounded-lg text-[10px] font-bold bg-gray-50 outline-none focus:ring-2 focus:ring-[#3c5a82]"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
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
          <p className="text-center text-xs text-gray-400 mt-4">
            {DATE_MODE_LABELS[dateMode]} {' '}
            {filterRange === 'Custom'
              ? (customDates.from && customDates.to ? `${customDates.from} to ${customDates.to}` : customDates.from ? `from ${customDates.from}` : customDates.to ? `until ${customDates.to}` : 'all time')
              : filterRange === 'All Time' ? 'all time' : `this ${filterRange.toLowerCase().replace('this ', '').replace('last ', '')}`}
          </p>
        </div>

        <div className="p-8 space-y-8">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <SummaryCard label="Total Orders" value={reportData?.totalOrders ?? 0} />
            <SummaryCard label="Delivered" value={reportData?.completedCount ?? 0} sub={`${completionRate}% delivery rate`} color="border-l-green-400" />
            <SummaryCard label="Returned" value={reportData?.returnedCount ?? 0} sub={`${returnRate}% return rate`} color="border-l-orange-400" />
            <SummaryCard label="Cancelled" value={reportData?.cancelledCount ?? 0} sub={`${cancelRate}% cancel rate`} color="border-l-red-400" />
            <SummaryCard label="Exchanges" value={reportData?.exchangeCount ?? 0} color="border-l-blue-400" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <SummaryCard label="Processing" value={reportData?.processingCount ?? 0} color="border-l-yellow-400" />
            <SummaryCard label="Picked" value={reportData?.pickedCount ?? 0} color="border-l-indigo-400" />
            <SummaryCard label="Courier Assigned" value={reportData?.courierAssignedCount ?? 0} color="border-l-purple-400" />
            <SummaryCard label="On Hold" value={reportData?.onHoldCount ?? 0} color="border-l-cyan-400" />
            <SummaryCard label="Partially Delivered" value={reportData?.partialDeliveredCount ?? 0} color="border-l-teal-400" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <SummaryCard label="Total Revenue" value={formatCurrency(reportData?.totalRevenue ?? 0)} />
            <SummaryCard label="Total Paid" value={formatCurrency(reportData?.totalPaid ?? 0)} color="border-l-green-400" />
            <SummaryCard label="Total Due" value={formatCurrency(reportData?.totalDue ?? 0)} color={((reportData?.totalDue ?? 0) > 0) ? 'border-l-red-400' : undefined} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="rounded-xl border border-gray-100 bg-gray-50 p-5">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Order Metrics</h4>
              <div className="space-y-0">
                <InsightRow label="Total Orders" value={(reportData?.totalOrders ?? 0).toLocaleString()} />
                <InsightRow label="Delivered" value={(reportData?.completedCount ?? 0).toLocaleString()} detail={`${completionRate}%`} valueClass="text-green-600" />
                <InsightRow label="Returned" value={(reportData?.returnedCount ?? 0).toLocaleString()} detail={`${returnRate}%`} valueClass="text-orange-600" />
                <InsightRow label="Cancelled" value={(reportData?.cancelledCount ?? 0).toLocaleString()} detail={`${cancelRate}%`} valueClass="text-red-600" />
                <InsightRow label="Exchanges" value={(reportData?.exchangeCount ?? 0).toLocaleString()} valueClass="text-blue-600" />
                <InsightRow label="Processing" value={(reportData?.processingCount ?? 0).toLocaleString()} valueClass="text-yellow-600" />
                <InsightRow label="Picked" value={(reportData?.pickedCount ?? 0).toLocaleString()} valueClass="text-indigo-600" />
                <InsightRow label="Courier Assigned" value={(reportData?.courierAssignedCount ?? 0).toLocaleString()} valueClass="text-purple-600" />
                <InsightRow label="On Hold" value={(reportData?.onHoldCount ?? 0).toLocaleString()} valueClass="text-cyan-600" />
                <InsightRow label="Partially Delivered" value={(reportData?.partialDeliveredCount ?? 0).toLocaleString()} valueClass="text-teal-600" />
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50 p-5">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Financial Metrics</h4>
              <div className="space-y-0">
                <InsightRow label="Total Revenue" value={formatCurrency(reportData?.totalRevenue ?? 0)} />
                <InsightRow label="Total Paid" value={formatCurrency(reportData?.totalPaid ?? 0)} detail={`${collectionRate}% collected`} valueClass="text-green-600" />
                <InsightRow label="Total Due" value={formatCurrency(reportData?.totalDue ?? 0)} valueClass={(reportData?.totalDue ?? 0) > 0 ? 'text-red-600' : 'text-gray-400'} />
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50 p-5">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Averages</h4>
              <div className="space-y-0">
                <InsightRow label="Avg Order Value" value={formatCurrency(avgOrderValue)} />
                <InsightRow label="Revenue / Completed" value={formatCurrency((reportData?.completedCount ?? 0) > 0 ? (reportData?.totalRevenue ?? 0) / (reportData?.completedCount ?? 1) : 0)} />
              </div>
            </div>

            <div className="rounded-xl border border-gray-100 bg-gray-50 p-5">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-3">Breakdown</h4>
              <div className="space-y-0">
                <InsightRow label="Success Rate" value={`${completionRate + ((reportData?.exchangeCount ?? 0) > 0 ? Math.round(((reportData?.exchangeCount ?? 0) / (reportData?.totalOrders ?? 1)) * 100) : 0)}%`} detail="Completed + Exchanges" />
                <InsightRow label="Exception Rate" value={`${returnRate + cancelRate}%`} detail="Returned + Cancelled" valueClass={(returnRate + cancelRate) > 20 ? 'text-red-600' : 'text-orange-600'} />
                <InsightRow label="Collection Rate" value={`${collectionRate}%`} valueClass={collectionRate >= 80 ? 'text-green-600' : 'text-red-600'} />
                <InsightLabel label="Revenue Distribution" />
                <div className="mt-2 space-y-2">
                  <DistributionBar label="Paid" value={reportData?.totalPaid ?? 0} total={reportData?.totalRevenue ?? 1} color="bg-green-500" />
                  <DistributionBar label="Due" value={reportData?.totalDue ?? 0} total={reportData?.totalRevenue ?? 1} color="bg-red-400" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-8 text-center text-[10px] text-gray-300 italic border-t border-gray-50">
          This report is generated automatically by {brandingNames.join(' + ') || 'Mame Pilot'} Financial Management System.
        </div>
      </div>
    </div>
  );
};

const InsightLabel: React.FC<{ label: string }> = ({ label }) => (
  <p className="text-sm font-bold text-gray-700 pt-2">{label}</p>
);

const DistributionBar: React.FC<{ label: string; value: number; total: number; color: string }> = ({ label, value, total, color }) => {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-[10px] font-bold text-gray-500 mb-1">
        <span>{label}</span>
        <span>{formatCurrency(value)} ({pct}%)</span>
      </div>
      <div className="h-2 rounded-full bg-gray-200 overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
};

export default OrderReport;
