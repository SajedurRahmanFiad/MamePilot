import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import FilterBar, { FilterRange } from '../../components/FilterBar';
import { ReportPageSkeleton } from '../../components';
import { useCustomerSalesReportData } from '../../src/hooks/useQueries';
import { formatCurrency } from '../../constants';
import { useSearch } from '../../src/contexts/SearchContext';

const CustomerSalesReport: React.FC = () => {
  const navigate = useNavigate();
  const { searchQuery } = useSearch();
  const [filterRange, setFilterRange] = useState<FilterRange>('All Time');
  const [customDates, setCustomDates] = useState({ from: '', to: '' });
  const deferredSearchQuery = React.useDeferredValue(searchQuery);
  const { data, isPending } = useCustomerSalesReportData(filterRange, customDates, deferredSearchQuery);
  const rows = data?.rows || [];

  if (isPending) {
    return <ReportPageSkeleton cards={0} showChart={false} showFilters tableColumns={4} tableRows={8} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/reports')} className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          </button>
          <h2 className="text-2xl font-bold text-gray-900">Customer Sales Report</h2>
        </div>
        <div className="hidden sm:block">
          <FilterBar
            filterRange={filterRange}
            setFilterRange={setFilterRange}
            customDates={customDates}
            setCustomDates={setCustomDates}
            compact={true}
          />
        </div>
      </div>
      <div className="sm:hidden">
        <FilterBar
          filterRange={filterRange}
          setFilterRange={setFilterRange}
          customDates={customDates}
          setCustomDates={setCustomDates}
        />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-6 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Customer-wise Sales</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Customer</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Orders</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Qty Bought</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-right">Sales Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-16 text-center text-gray-400 italic font-medium">No customer sales data for this period.</td>
                </tr>
              ) : (
                rows.map((row, idx) => (
                  <tr key={`${row.name}-${idx}`} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-bold text-gray-900">{row.name}</td>
                    <td className="px-6 py-4 text-right font-black text-gray-900">{row.orders}</td>
                    <td className="px-6 py-4 text-right font-black text-gray-900">{row.quantity}</td>
                    <td className="px-6 py-4 text-right font-black text-emerald-600">{formatCurrency(row.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CustomerSalesReport;
