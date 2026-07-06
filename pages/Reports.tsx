
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ICONS } from '../constants';
import {
  fetchCustomerSalesReport,
  fetchExpenseSummaryReport,
  fetchIncomeSummaryReport,
  fetchIncomeVsExpenseReport,
  fetchProductQuantitySoldReport,
  fetchProfitLossReport,
} from '../src/services/supabaseQueries';

const ReportCard: React.FC<{ 
  title: string; 
  description: string; 
  icon: React.ReactNode; 
  color: string; 
  to: string; 
  onPrefetch?: () => void;
}> = ({ title, description, icon, color, to, onPrefetch }) => {
  const navigate = useNavigate();
  return (
    <button 
      onClick={() => navigate(to)}
      onMouseEnter={() => onPrefetch?.()}
      onFocus={() => onPrefetch?.()}
      className={`flex items-start gap-4 p-6 bg-white rounded-lg border border-gray-100 shadow-sm hover:shadow-md hover:border-[#c7dff5] transition-all text-left w-full group`}
    >
      <div className={`p-4 rounded-[50%] ${color} transition-transform group-hover:scale-110 duration-300`}>
        {icon}
      </div>
      <div>
        <h3 className="font-bold text-gray-900 text-lg">{title}</h3>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">{description}</p>
        <div className={`mt-4 flex items-center gap-1 text-xs font-bold uppercase tracking-widest opacity-40 group-hover:opacity-100 transition-opacity`}>
          View Report {ICONS.ChevronRight}
        </div>
      </div>
    </button>
  );
};

const Reports: React.FC = () => {
  const queryClient = useQueryClient();
  const reportCategories = [
    {
      title: 'Expense Summary',
      description: 'Breakdown of your business spending by category and vendor.',
      icon: ICONS.Delete,
      color: 'bg-red-50 text-red-600',
      to: '/reports/expense',
      onPrefetch: () => {
        void queryClient.prefetchQuery({
          queryKey: ['reports', 'expense-summary'],
          queryFn: fetchExpenseSummaryReport,
        });
      }
    },
    {
      title: 'Income Summary',
      description: 'Analysis of your revenue streams and payment collections.',
      icon: ICONS.PlusCircle,
      color: `bg-[#ebf4ff]`,
      to: '/reports/income',
      onPrefetch: () => {
        void queryClient.prefetchQuery({
          queryKey: ['reports', 'income-summary'],
          queryFn: fetchIncomeSummaryReport,
        });
      }
    },
    {
      title: 'Income vs Expense',
      description: 'Visual comparison of cash inflows and outflows over time.',
      icon: ICONS.Transfer,
      color: `bg-[#e6f0ff]`,
      to: '/reports/income-vs-expense',
      onPrefetch: () => {
        void queryClient.prefetchQuery({
          queryKey: ['reports', 'income-vs-expense'],
          queryFn: fetchIncomeVsExpenseReport,
        });
      }
    },
    {
      title: 'Profit and Loss',
      description: 'Standard P&L statement to track net business profitability.',
      icon: ICONS.Reports,
      color: 'bg-purple-50 text-purple-600',
      to: '/reports/profit-loss',
      onPrefetch: () => {
        void queryClient.prefetchQuery({
          queryKey: ['reports', 'profit-loss', 'This Year', '', ''],
          queryFn: () => fetchProfitLossReport({ filterRange: 'This Year', customDates: { from: '', to: '' } }),
        });
      }
    },
    {
      title: 'Product Quantity Sold',
      description: 'Track sold quantities per product for the selected period.',
      icon: ICONS.Products,
      color: 'bg-emerald-50 text-emerald-600',
      to: '/reports/product-quantity-sold',
      onPrefetch: () => {
        void queryClient.prefetchQuery({
          queryKey: ['reports', 'product-quantity-sold', 'All Time', '', '', ''],
          queryFn: () => fetchProductQuantitySoldReport({ filterRange: 'All Time', customDates: { from: '', to: '' }, search: '' }),
        });
      }
    },
    {
      title: 'Customer Sales Report',
      description: 'Compare customers by order count, quantity, and sales amount.',
      icon: ICONS.Customers,
      color: 'bg-cyan-50 text-cyan-600',
      to: '/reports/customer-sales',
      onPrefetch: () => {
        void queryClient.prefetchQuery({
          queryKey: ['reports', 'customer-sales', 'All Time', '', '', ''],
          queryFn: () => fetchCustomerSalesReport({ filterRange: 'All Time', customDates: { from: '', to: '' }, search: '' }),
        });
      }
    },
    {
      title: 'User Activity & Performance',
      description: 'Detailed per-user activity, performance, and salary support report with PDF export.',
      icon: ICONS.Users,
      color: 'bg-amber-50 text-amber-600',
      to: '/reports/user-activity-performance'
    }
  ];

  return (
    <div className="space-y-8">
      <div />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {reportCategories.map((report, i) => (
          <ReportCard key={i} {...report} />
        ))}
      </div>
    </div>
  );
};

export default Reports;
