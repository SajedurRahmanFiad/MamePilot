import React, { useEffect, useMemo, useState } from 'react';
import { LoadingOverlay, Table } from '../components';
import type { TableColumn } from '../components/Table';
import { formatCurrency } from '../constants';
import { UserRole, type WalletActivityEntry } from '../types';
import Pagination from '../src/components/Pagination';
import { useAuth } from '../src/contexts/AuthProvider';
import { useMyWallet, useSystemDefaults, useWalletActivityPage, useWalletSettings } from '../src/hooks/useQueries';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';

const formatTimestamp = (value?: string): string => {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-BD', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const getEntryLabel = (entryType: WalletActivityEntry['entryType']): string => {
  if (entryType === 'order_credit') return 'Order Credit';
  if (entryType === 'order_reversal') return 'Order Reversal';
  return 'Payout';
};

const getEntryBadgeClass = (entryType: WalletActivityEntry['entryType']): string => {
  if (entryType === 'order_credit') return 'bg-emerald-100 text-emerald-700';
  if (entryType === 'order_reversal') return 'bg-amber-100 text-amber-700';
  return 'bg-[#dfeaf7] text-[#0f2f57]';
};

const SummaryCard: React.FC<{
  label: string;
  value: string;
  hint: string;
  tone?: string;
}> = ({ label, value, hint, tone = 'border-gray-100 bg-white' }) => (
  <div className={`rounded-2xl border px-5 py-5 shadow-sm ${tone}`}>
    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">{label}</p>
    <p className="mt-3 text-lg font-black text-gray-900">{value}</p>
    <p className="mt-2 text-sm font-medium text-gray-500">{hint}</p>
  </div>
);

const Wallet: React.FC = () => {
  const { user } = useAuth();
  const [historyPage, setHistoryPage] = useState(1);
  const isEmployee = user?.role === UserRole.EMPLOYEE;
  const { data: walletSettings = { unitAmount: 0, countedStatuses: [] }, isPending: walletSettingsLoading } = useWalletSettings();
  const { data: myWallet, isPending: myWalletLoading } = useMyWallet();
  const { data: systemDefaults } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const { data: walletActivityPage = { data: [], count: 0 }, isPending: walletActivityLoading } = useWalletActivityPage(
    historyPage,
    pageSize,
    {
      enabled: isEmployee,
      entryTypes: ['payout'],
    }
  );
  const walletActivity = walletActivityPage.data;
  const walletActivityTotal = walletActivityPage.count;
  const walletActivityTotalPages = Math.max(1, Math.ceil(walletActivityTotal / pageSize));

  const loading = walletSettingsLoading || myWalletLoading || walletActivityLoading;

  useEffect(() => {
    if (historyPage > walletActivityTotalPages) {
      setHistoryPage(walletActivityTotalPages);
    }
  }, [historyPage, walletActivityTotalPages]);

  const historyColumns = useMemo<TableColumn[]>(
    () => [
      {
        key: 'entryType',
        label: 'Type',
        render: (value: WalletActivityEntry['entryType']) => (
          <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${getEntryBadgeClass(value)}`}>
            {getEntryLabel(value)}
          </span>
        ),
      },
      {
        key: 'source',
        label: 'Source',
        render: (_value, item: WalletActivityEntry) => (
          <div>
            <p className="text-sm font-black text-gray-900">
              {item.orderNumber
                ? `Order #${item.orderNumber}`
                : item.accountName
                  ? item.accountName
                  : 'System'}
            </p>
            <p className="mt-1 text-xs font-medium text-gray-500">
              {item.paymentMethod || item.categoryName || item.note || '-'}
            </p>
          </div>
        ),
      },
      {
        key: 'amountDelta',
        label: 'Amount',
        align: 'right',
        render: (value: number) => (
          <span className={`text-sm font-black ${value >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {value >= 0 ? '+' : '-'}{formatCurrency(Math.abs(value))}
          </span>
        ),
      },
      {
        key: 'createdAt',
        label: 'Date',
        render: (_value, item: WalletActivityEntry) => (
          <span className="text-sm font-medium text-gray-600">
            {formatTimestamp(item.paidAt || item.createdAt)}
          </span>
        ),
      },
      {
        key: 'by',
        label: 'By',
        render: (_value, item: WalletActivityEntry) => (
          <span className="text-sm font-medium text-gray-600">
            {item.paidByName || item.createdByName || 'System'}
          </span>
        ),
      },
      {
        key: 'note',
        label: 'Note',
        render: (value: string) => <span className="text-sm font-medium text-gray-600">{value || '-'}</span>,
      },
    ],
    []
  );

  if (!user) {
    return <div className="p-8 text-center text-gray-500">Loading wallet access...</div>;
  }

  if (!isEmployee) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Employee Only</p>
          <h2 className="mt-3 text-2xl font-black text-gray-900">Wallet is available to employees only.</h2>
          <p className="mt-2 text-sm font-medium text-gray-500">
            Admins manage payouts from the Payroll page.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <LoadingOverlay isLoading={loading} message="Loading wallet..." />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Wallet</h2>
          <p className="text-sm text-gray-500">
            {myWallet?.isCommissionBased === false && myWallet?.fixedSalary
              ? 'You are on a fixed monthly salary. Your balance resets each month.'
              : 'Review your live wallet balance and your payment history. Wallet balances start from Apr 1, 2026.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {myWallet?.isCommissionBased === false && myWallet?.fixedSalary && (
            <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-medium text-violet-700">
              Fixed Salary: <span className="font-black">{formatCurrency(myWallet.fixedSalary)}/month</span>
            </div>
          )}
          {myWallet?.isCommissionBased !== false && (
            <div className="rounded-2xl border border-[#d6e3f0] bg-[#f8fbff] px-4 py-3 text-sm font-medium text-gray-600">
              Current Unit Amount: <span className="font-black text-gray-900">{formatCurrency(walletSettings.unitAmount)}</span>
            </div>
          )}
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard
          label="Wallet Balance"
          value={formatCurrency(myWallet?.currentBalance ?? 0)}
          hint={myWallet?.isCommissionBased === false && myWallet?.fixedSalary
            ? "Your current month's remaining salary."
            : "Your live cumulative wallet balance."}
          tone="border-[#d6e3f0] bg-[#f8fbff]"
        />
        <SummaryCard
          label={myWallet?.isCommissionBased === false && myWallet?.fixedSalary ? "Monthly Salary" : "Total Earned"}
          value={formatCurrency(myWallet?.totalEarned ?? 0)}
          hint={myWallet?.isCommissionBased === false && myWallet?.fixedSalary
            ? "Your fixed monthly salary amount."
            : "Credits added from orders you created."}
        />
        <SummaryCard
          label="Total Paid"
          value={formatCurrency(myWallet?.totalPaid ?? 0)}
          hint="Wallet payouts already settled to you."
        />
        <SummaryCard
          label={myWallet?.isCommissionBased === false && myWallet?.fixedSalary ? "Salary Type" : "Credited Orders"}
          value={myWallet?.isCommissionBased === false && myWallet?.fixedSalary ? "Fixed" : `${myWallet?.creditedOrders ?? 0}`}
          hint={myWallet?.isCommissionBased === false && myWallet?.fixedSalary
            ? "You receive a fixed monthly salary."
            : "Orders that have credited your wallet."}
        />
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-xl font-black text-gray-900">Payment History</h3>
            <p className="mt-1 text-sm font-medium text-gray-500">
              Payouts that admins have already settled to your wallet.
            </p>
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
            Private to your account
          </p>
        </div>

        <div className="mt-6">
          <Table
            columns={historyColumns}
            data={walletActivity}
            hover={false}
            size="sm"
            loading={walletActivityLoading}
            emptyMessage="No payment history found yet."
          />
        </div>

        <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-sm font-medium text-gray-500">
            Showing {walletActivityTotal === 0 ? 0 : (historyPage - 1) * pageSize + 1}
            {' - '}
            {Math.min(historyPage * pageSize, walletActivityTotal)} of {walletActivityTotal} payment records
          </p>
          <Pagination
            page={historyPage}
            totalPages={walletActivityTotalPages}
            onPageChange={setHistoryPage}
            disabled={walletActivityLoading}
          />
        </div>
      </section>
    </div>
  );
};

export default Wallet;
