import React, { useEffect, useMemo, useState } from 'react';
import { LoadingOverlay, Table } from '../components';
import type { TableColumn } from '../components/Table';
import { formatCurrency } from '../constants';
import { UserRole, type WalletActivityEntry } from '../types';
import Pagination from '../src/components/Pagination';
import { useAuth } from '../src/contexts/AuthProvider';
import { useMyWallet, useSystemDefaults, useWalletActivityPage, useWalletSettings } from '../src/hooks/useQueries';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { formatDateTimeParts } from '../utils';

const formatTimestamp = (value?: string): string => {
  const { date, time } = formatDateTimeParts(value);
  if (!date) return '-';
  return time ? `${date}, ${time}` : date;
};

const formatPeriodDate = (value?: string | null): string => {
  if (!value) return '';
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return value;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return parsed.toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' });
};

const getEntryLabel = (entryType: WalletActivityEntry['entryType']): string => {
  if (entryType === 'order_credit') return 'Order Credit';
  if (entryType === 'order_reversal') return 'Order Reversal';
  if (entryType === 'payroll_bonus') return 'Payroll Bonus';
  if (entryType === 'payroll_deduction') return 'Payroll Deduction';
  return 'Payout';
};

const getEntryBadgeClass = (entryType: WalletActivityEntry['entryType']): string => {
  if (entryType === 'order_credit') return 'bg-emerald-100 text-emerald-700';
  if (entryType === 'order_reversal') return 'bg-amber-100 text-amber-700';
  if (entryType === 'payroll_bonus') return 'bg-sky-100 text-sky-700';
  if (entryType === 'payroll_deduction') return 'bg-rose-100 text-rose-700';
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
  const {
    data: walletSettings = { unitAmount: 0, countedStatuses: [] },
    isPending: walletSettingsLoading,
    error: walletSettingsError,
  } = useWalletSettings();
  const { data: myWallet, isPending: myWalletLoading, error: myWalletError } = useMyWallet();
  const { data: systemDefaults } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const {
    data: walletActivityPage = { data: [], count: 0 },
    isPending: walletActivityPending,
    isFetching: walletActivityFetching,
    error: walletActivityError,
  } = useWalletActivityPage(
    historyPage,
    pageSize,
    {
      enabled: isEmployee,
    }
  );
  const walletActivity = walletActivityPage.data;
  const walletActivityTotal = walletActivityPage.count;
  const walletActivityTotalPages = Math.max(1, Math.ceil(walletActivityTotal / pageSize));

  const loading = walletSettingsLoading || myWalletLoading || walletActivityPending;
  const loadError = myWalletError || walletActivityError || walletSettingsError;
  const isFixedSalary = myWallet?.compensationType
    ? myWallet.compensationType === 'fixed' || myWallet.compensationType === 'fixed_salary'
    : myWallet?.isCommissionBased === false && Number(myWallet?.fixedSalary || 0) > 0;
  const baseEarned = myWallet?.baseEarned
    ?? (isFixedSalary ? (myWallet?.fixedSalary ?? 0) : Math.max(0, (myWallet?.totalEarned ?? 0) - (myWallet?.totalBonuses ?? 0)));
  const totalBonuses = myWallet?.totalBonuses ?? 0;
  const totalDeductions = myWallet?.totalDeductions ?? 0;
  const hasCarryForwardAdjustment = !isFixedSalary && Number(myWallet?.currentBalance || 0) < 0;
  const balancePeriod = myWallet?.balancePeriodStart && myWallet?.balancePeriodEnd
    ? `${formatPeriodDate(myWallet.balancePeriodStart)} - ${formatPeriodDate(myWallet.balancePeriodEnd)}`
    : isFixedSalary
      ? 'Current month'
      : 'All eligible activity';

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
        render: (_value, item: WalletActivityEntry) => {
          const source = item.orderNumber
            ? `Order #${item.orderNumber}`
            : item.entryType === 'payroll_bonus' || item.entryType === 'payroll_deduction'
              ? 'Payroll adjustment'
              : item.accountName || 'Payroll';
          const detail = item.orderNumber && item.unitAmountSnapshot != null
            ? `${formatCurrency(item.unitAmountSnapshot)} captured commission rate`
            : item.paymentMethod || item.categoryName || item.note || 'System generated';
          return (
            <div>
              <p className="text-sm font-black text-gray-900">{source}</p>
              <p className="mt-1 text-xs font-medium text-gray-500">{detail}</p>
            </div>
          );
        },
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

  if (myWalletError && !myWallet) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-rose-50 px-6 py-12 text-center shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-rose-500">Wallet unavailable</p>
        <h2 className="mt-3 text-2xl font-black text-rose-900">Your compensation balance could not be loaded.</h2>
        <p className="mt-2 text-sm font-medium text-rose-700">Refresh before relying on any wallet or payroll amount.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <LoadingOverlay isLoading={loading} message="Loading wallet..." />

      {loadError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          Wallet information could not be refreshed. Please try again in a moment.
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-[#d6e3f0] bg-gradient-to-br from-white via-[#f8fbff] to-[#eef6fc] px-6 py-6 shadow-sm md:px-8 md:py-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#0f2f57]">Employee compensation</p>
              <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] ${isFixedSalary ? 'bg-violet-100 text-violet-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {isFixedSalary ? 'Fixed salary' : 'Commission based'}
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-black text-gray-900 md:text-3xl">My wallet</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-gray-500">
              {isFixedSalary
                ? 'Your current salary cycle, payroll adjustments, and settled payments are shown together.'
                : 'Follow every eligible order credit, reversal, payroll adjustment, and payment from one private ledger.'}
            </p>
          </div>
          <div className="rounded-2xl border border-white bg-white/90 px-5 py-4 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">
              {isFixedSalary ? 'Monthly base salary' : 'Current order rate'}
            </p>
            <p className="mt-2 text-xl font-black text-[#0f2f57]">
              {!isFixedSalary && walletSettingsError
                ? 'Unavailable'
                : formatCurrency(isFixedSalary ? (myWallet?.fixedSalary ?? 0) : walletSettings.unitAmount)}
              {!isFixedSalary && <span className="ml-1 text-xs font-bold text-gray-400">per eligible order</span>}
            </p>
            <p className="mt-1 text-xs font-semibold text-gray-500">Balance period: {balancePeriod}</p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <SummaryCard
          label={hasCarryForwardAdjustment ? 'Carry-forward adjustment' : 'Outstanding balance'}
          value={formatCurrency(hasCarryForwardAdjustment ? Math.abs(myWallet?.currentBalance ?? 0) : (myWallet?.currentBalance ?? 0))}
          hint={hasCarryForwardAdjustment
            ? 'A settled commission was later reversed. This amount will offset future eligible earnings.'
            : `${formatCurrency(myWallet?.basePaid ?? 0)} of base compensation settled in this balance period.`}
          tone={hasCarryForwardAdjustment ? 'border-rose-200 bg-rose-50/60' : 'border-[#d6e3f0] bg-[#f8fbff]'}
        />
        <SummaryCard
          label={isFixedSalary ? 'Base salary' : 'Base commission earned'}
          value={formatCurrency(baseEarned)}
          hint={isFixedSalary ? 'Base entitlement for the current salary cycle.' : 'Eligible order credits before payroll adjustments.'}
        />
        <SummaryCard
          label="Bonuses"
          value={formatCurrency(totalBonuses)}
          hint="Additional compensation included with payroll."
          tone="border-sky-100 bg-sky-50/60"
        />
        <SummaryCard
          label="Deductions"
          value={formatCurrency(totalDeductions)}
          hint="Approved deductions recorded with payroll."
          tone="border-rose-100 bg-rose-50/50"
        />
        <SummaryCard
          label="Net paid"
          value={formatCurrency(myWallet?.totalPaid ?? 0)}
          hint="Actual cash paid after bonuses and deductions."
        />
        <SummaryCard
          label={isFixedSalary ? 'Salary cycle' : 'Credited orders'}
          value={isFixedSalary ? balancePeriod : `${myWallet?.creditedOrders ?? 0}`}
          hint={isFixedSalary ? 'The period used for this outstanding balance.' : 'Orders that currently qualify for commission.'}
        />
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-xl font-black text-gray-900">Wallet activity</h3>
            <p className="mt-1 text-sm font-medium text-gray-500">
              Credits, reversals, bonuses, deductions, and payouts are recorded here as one audit trail.
            </p>
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
            Private to your account
          </p>
        </div>

        {walletActivityError && walletActivity.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-rose-200 bg-rose-50 px-5 py-10 text-center text-sm font-semibold text-rose-700">
            Wallet activity is unavailable. Refresh to load the private ledger.
          </div>
        ) : (
          <div className="mt-6">
            <Table
              columns={historyColumns}
              data={walletActivity}
              hover={false}
              size="sm"
              loading={walletActivityFetching}
              emptyMessage="No wallet activity has been recorded yet."
            />
          </div>
        )}

        {(!walletActivityError || walletActivity.length > 0) && (
          <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="text-sm font-medium text-gray-500">
              Showing {walletActivityTotal === 0 ? 0 : (historyPage - 1) * pageSize + 1}
              {' - '}
              {Math.min(historyPage * pageSize, walletActivityTotal)} of {walletActivityTotal} activity records
            </p>
            <Pagination
              page={historyPage}
              totalPages={walletActivityTotalPages}
              onPageChange={setHistoryPage}
              disabled={walletActivityFetching}
            />
          </div>
        )}
      </section>
    </div>
  );
};

export default Wallet;
