import React, { useEffect, useMemo, useState } from 'react';
import { Button, LoadingOverlay, Modal, Table, NumericInput } from '../components';
import type { TableColumn } from '../components/Table';
import { ICONS, formatCurrency } from '../constants';
import DynamicFilterBar from '../components/DynamicFilterBar';
import type { CombinedFilter } from '../components/DynamicFilterBar';
import Pagination from '../src/components/Pagination';
import { hasAdminAccess, type WalletActivityEntry, type WalletBalanceCard } from '../types';
import { useAuth } from '../src/contexts/AuthProvider';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { usePayEmployeeWallet, useDeleteEmployeeWalletPayout } from '../src/hooks/useMutations';
import { formatDateTimeParts, getTodayDate } from '../utils';
import {
  useAccounts,
  useCategories,
  useEmployeeWalletCardsPage,
  usePaymentMethods,
  useSystemDefaults,
  useUsers,
  useWalletActivityPage,
  useWalletSettings,
} from '../src/hooks/useQueries';
import { useRolePermissions } from '../src/hooks/useRolePermissions';

const getTodayValue = (): string => getTodayDate();

const formatTimestamp = (value?: string): string => {
  const { date, time } = formatDateTimeParts(value);
  if (!date) return '-';
  return time ? `${date}, ${time}` : date;
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

const normalizeCategoryName = (value?: string): string => (value || '').trim().toLowerCase();

const MetricCard: React.FC<{
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

const WalletCard: React.FC<{
  card: WalletBalanceCard;
  onPay: (card: WalletBalanceCard) => void;
}> = ({ card, onPay }) => (
  <div className="group relative rounded-xl border border-gray-100 bg-white p-3 shadow-sm transition-all hover:border-[#d6e3f0] hover:shadow-md">
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <h3 className="text-xs font-black text-gray-900 truncate">{card.employeeName}</h3>
          {!card.isCommissionBased && card.fixedSalary ? (
            <span className="shrink-0 rounded-full bg-violet-100 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-violet-700">
              Fixed
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-[#dfeaf7] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest text-[#0f2f57]">
              {card.employeeRole}
            </span>
          )}
        </div>
      </div>

      <Button
        type="button"
        variant="primary"
        size="sm"
        icon={ICONS.Payroll}
        disabled={card.currentBalance <= 0}
        onClick={() => onPay(card)}
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity !px-2 !py-1 !text-[10px]"
      >
        Pay
      </Button>
    </div>

    <div className="mt-2 flex items-center gap-3">
      <div className="flex-1">
        <p className="text-[9px] font-black uppercase tracking-[0.15em] text-gray-400">Due</p>
        <p className="mt-0.5 text-sm font-black text-gray-900">{formatCurrency(card.currentBalance)}</p>
      </div>
      <div className="flex-1">
        <p className="text-[9px] font-black uppercase tracking-[0.15em] text-gray-400">
          {card.isCommissionBased ? 'Orders' : 'Paid'}
        </p>
        <p className="mt-0.5 text-sm font-black text-gray-900">
          {card.isCommissionBased ? card.creditedOrders : formatCurrency(card.totalPaid)}
        </p>
      </div>
    </div>
  </div>
);

type PayoutFormState = {
  amount: string;
  accountId: string;
  paymentMethod: string;
  paidAt: string;
  note: string;
};

const Payroll: React.FC = () => {
  const { user } = useAuth();
  const toast = useToastNotifications();
  const payEmployeeWalletMutation = usePayEmployeeWallet();
  const deleteEmployeeWalletPayoutMutation = useDeleteEmployeeWalletPayout();
  const [selectedCard, setSelectedCard] = useState<WalletBalanceCard | null>(null);
  const [deletingPayoutId, setDeletingPayoutId] = useState<string | null>(null);
  const [cardsPage, setCardsPage] = useState<number>(1);
  const [historyPage, setHistoryPage] = useState<number>(1);
  const [appliedFilters, setAppliedFilters] = useState<CombinedFilter[]>([]);
  const [payoutForm, setPayoutForm] = useState<PayoutFormState>({
    amount: '',
    accountId: '',
    paymentMethod: '',
    paidAt: getTodayValue(),
    note: '',
  });

  const { canPayEmployees, canDeletePayrollPayments } = useRolePermissions();
  const isAdmin = hasAdminAccess(user?.role) || canPayEmployees;
  const isPayoutModalOpen = !!selectedCard;
  const { data: walletSettings = { unitAmount: 0, countedStatuses: [] }, isPending: walletSettingsLoading } = useWalletSettings();
  const { data: systemDefaults, isPending: defaultsLoading } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const { data: walletCardsPage = { data: [], count: 0, summary: { totalBalance: 0, totalEarned: 0, totalPaid: 0, employeesDue: 0, fixedSalaryEmployees: 0, totalFixedSalaryDue: 0 } }, isPending: walletCardsLoading } = useEmployeeWalletCardsPage(
    cardsPage,
    pageSize,
    {
      enabled: isAdmin,
    }
  );
  const walletCards = walletCardsPage.data;
  const walletCardsTotal = walletCardsPage.count;
  const walletCardsTotalPages = Math.max(1, Math.ceil(walletCardsTotal / pageSize));
  const summary = walletCardsPage.summary;
  const { data: allUsers = [] } = useUsers();
  const { data: accounts = [], isPending: accountsLoading } = useAccounts({ enabled: isAdmin && isPayoutModalOpen });
  const { data: paymentMethods = [], isPending: paymentMethodsLoading } = usePaymentMethods(true, { enabled: isAdmin && isPayoutModalOpen });
  const { data: categories = [], isPending: categoriesLoading } = useCategories(undefined, { enabled: isAdmin && isPayoutModalOpen });
  const { data: walletActivityPage = { data: [], count: 0 }, isPending: walletActivityLoading } = useWalletActivityPage(
    historyPage,
    pageSize,
    {
      enabled: isAdmin,
      entryTypes: ['payout'],
    }
  );
  const walletActivity = walletActivityPage.data;
  const walletActivityTotal = walletActivityPage.count;
  const walletActivityTotalPages = Math.max(1, Math.ceil(walletActivityTotal / pageSize));

  const expenseCategories = useMemo(
    () => categories.filter((category) => category.type === 'Expense'),
    [categories]
  );
  const payrollExpenseCategory = useMemo(
    () => expenseCategories.find((category) => normalizeCategoryName(category.name) === 'payroll') || null,
    [expenseCategories]
  );

  // Filter definitions for DynamicFilterBar
  const filterDefinitions = useMemo(() => {
    const employeeNames = Array.from(new Set(allUsers.map((u) => u.name).filter(Boolean)));
    const roles = Array.from(new Set(allUsers.map((u) => u.role).filter(Boolean)));

    return [
      {
        type: 'Employee Name',
        operators: ['=', '≠'] as const,
        values: employeeNames,
        allowCustomValue: true,
      },
      {
        type: 'Salary Type',
        operators: ['=', '≠'] as const,
        values: ['Commission Based', 'Fixed Salary'],
      },
      {
        type: 'Role',
        operators: ['=', '≠'] as const,
        values: roles,
        allowCustomValue: true,
      },
      {
        type: 'Balance',
        operators: ['>', '<', '='] as const,
        valueType: 'number' as const,
        allowCustomValue: true,
      },
    ];
  }, [allUsers]);

  // Apply client-side filters to wallet cards
  const filteredWalletCards = useMemo(() => {
    if (appliedFilters.length === 0) return walletCards;

    return walletCards.filter((card) => {
      return appliedFilters.every((filter) => {
        const value = filter.value;
        const operator = filter.operator;

        switch (filter.type) {
          case 'Employee Name': {
            const matches = card.employeeName === value;
            return operator === '≠' ? !matches : matches;
          }
          case 'Salary Type': {
            const isFixed = !card.isCommissionBased && card.fixedSalary;
            const matches = value === 'Fixed Salary' ? !!isFixed : !isFixed;
            return operator === '≠' ? !matches : matches;
          }
          case 'Role': {
            const matches = card.employeeRole === value;
            return operator === '≠' ? !matches : matches;
          }
          case 'Balance': {
            const numValue = Number.parseFloat(value) || 0;
            switch (operator) {
              case '>': return card.currentBalance > numValue;
              case '<': return card.currentBalance < numValue;
              case '=': return card.currentBalance === numValue;
              default: return true;
            }
          }
          default:
            return true;
        }
      });
    });
  }, [walletCards, appliedFilters]);

  useEffect(() => {
    if (!selectedCard) return;

    setPayoutForm({
      amount: selectedCard.currentBalance > 0 ? String(selectedCard.currentBalance) : '',
      accountId: systemDefaults?.defaultAccountId || accounts[0]?.id || '',
      paymentMethod: systemDefaults?.defaultPaymentMethod || paymentMethods[0]?.name || '',
      paidAt: getTodayValue(),
      note: '',
    });
  }, [selectedCard, systemDefaults, accounts, paymentMethods]);

  useEffect(() => {
    if (cardsPage > walletCardsTotalPages) {
      setCardsPage(walletCardsTotalPages);
    }
  }, [cardsPage, walletCardsTotalPages]);

  useEffect(() => {
    if (historyPage > walletActivityTotalPages) {
      setHistoryPage(walletActivityTotalPages);
    }
  }, [historyPage, walletActivityTotalPages]);

  const loading = walletSettingsLoading
    || walletCardsLoading
    || walletActivityLoading
    || defaultsLoading
    || (isPayoutModalOpen && (accountsLoading || paymentMethodsLoading || categoriesLoading));

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === payoutForm.accountId) || null,
    [accounts, payoutForm.accountId]
  );

  const historyColumns = useMemo<TableColumn[]>(
    () => [
      {
        key: 'employeeName',
        label: 'Employee',
        render: (_value, item: WalletActivityEntry) => (
          <div>
            <p className="text-sm font-black text-gray-900">{item.employeeName || 'Unknown Employee'}</p>
            <p className="mt-1 text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
              {item.employeeRole || 'Employee'}
            </p>
          </div>
        ),
      },
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
        key: 'actor',
        label: 'By',
        render: (_value, item: WalletActivityEntry) => (
          <span className="text-sm font-medium text-gray-600">
            {item.paidByName || item.createdByName || 'System'}
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
        key: 'note',
        label: 'Note',
        render: (value: string) => <span className="text-sm font-medium text-gray-600">{value || '-'}</span>,
      },
      {
        key: 'actions',
        label: '',
        align: 'right',
        render: (_value, item: WalletActivityEntry) => {
          if (canDeletePayrollPayments && item.entryType === 'payout' && item.payoutId) {
            return (
              <button
                onClick={() => setDeletingPayoutId(item.payoutId || null)}
                className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                title="Delete Payout"
              >
                {ICONS.Delete}
              </button>
            );
          }
          return null;
        },
      },
    ],
    [canDeletePayrollPayments]
  );

  const handleOpenPayout = (card: WalletBalanceCard) => {
    setSelectedCard(card);
  };

  const handleClosePayout = () => {
    setSelectedCard(null);
    setPayoutForm({
      amount: '',
      accountId: '',
      paymentMethod: '',
      paidAt: getTodayValue(),
      note: '',
    });
  };

  const handleConfirmPayout = async () => {
    if (!selectedCard) return;

    const amount = Number.parseFloat(payoutForm.amount || '0') || 0;
    if (amount <= 0) {
      toast.warning('Enter a payout amount greater than zero.');
      return;
    }
    if (amount > selectedCard.currentBalance) {
      toast.warning('Payout amount cannot exceed the wallet balance.');
      return;
    }
    const payrollCategoryId = payrollExpenseCategory?.id || '';
    if (!payrollCategoryId) {
      toast.warning('Create an expense category named "Payroll" before recording payouts.');
      return;
    }
    if (!payoutForm.accountId || !payoutForm.paymentMethod || !payoutForm.paidAt) {
      toast.warning('Complete the payout form before continuing.');
      return;
    }
    if (selectedAccount && amount > selectedAccount.currentBalance) {
      toast.warning('The selected account does not have enough balance.');
      return;
    }

    const toastId = toast.loading(`Paying ${selectedCard.employeeName} from wallet...`);

    try {
      await payEmployeeWalletMutation.mutateAsync({
        employeeId: selectedCard.employeeId,
        amount,
        accountId: payoutForm.accountId,
        paymentMethod: payoutForm.paymentMethod,
        categoryId: payrollCategoryId,
        paidAt: payoutForm.paidAt,
        note: payoutForm.note,
      });

      toast.update(toastId, 'Wallet payout recorded successfully.', 'success');
      handleClosePayout();
    } catch (error) {
      toast.update(
        toastId,
        error instanceof Error ? error.message : 'Failed to record wallet payout.',
        'error'
      );
    }
  };

  const handleConfirmDeletePayout = async () => {
    if (!deletingPayoutId) return;

    const toastId = toast.loading('Deleting payout and reverting balances...');
    try {
      await deleteEmployeeWalletPayoutMutation.mutateAsync({ id: deletingPayoutId });
      toast.update(toastId, 'Payout deleted successfully.', 'success');
      setDeletingPayoutId(null);
    } catch (error) {
      toast.update(
        toastId,
        error instanceof Error ? error.message : 'Failed to delete payout.',
        'error'
      );
    }
  };

  if (!user) {
    return <div className="p-8 text-center text-gray-500">Loading payroll access...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Admin Access Only</p>
          <h2 className="mt-3 text-2xl font-black text-gray-900">Payroll is available to admin-access users only.</h2>
          <p className="mt-2 text-sm font-medium text-gray-500">
            Employees use the Wallet page to review their own balance and wallet history.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 sm:space-y-6 pb-12">
      <LoadingOverlay isLoading={loading || payEmployeeWalletMutation.isPending} message="Loading wallet data..." />

      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Payroll</h2>
        </div>
        <div className="rounded-2xl border border-[#d6e3f0] bg-[#f8fbff] px-4 py-3 text-sm font-medium text-gray-600">
          Unit Amount: <span className="font-black text-gray-900">{formatCurrency(walletSettings.unitAmount)}</span>
        </div>
      </div>

      {/* KPI Cards */}
      <section className="grid gap-4 grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Total Payroll This Month"
          value={formatCurrency(summary.totalBalance)}
          hint="Total amount payable (fixed salaries + commissions)."
          tone="border-[#d6e3f0] bg-[#f8fbff]"
        />
        <MetricCard
          label="Total Paid"
          value={formatCurrency(summary.totalPaid)}
          hint="Amount already paid this month."
        />
        <MetricCard
          label="Remaining Payable"
          value={formatCurrency(summary.totalBalance)}
          hint="Amount still unpaid."
          tone="border-amber-200 bg-amber-50"
        />
        <MetricCard
          label="Fixed Salary Employees"
          value={`${summary.fixedSalaryEmployees}`}
          hint="Total count of fixed-salary employees."
          tone="border-violet-200 bg-violet-50"
        />
        <MetricCard
          label="Commission Employees"
          value={`${walletCardsTotal - summary.fixedSalaryEmployees}`}
          hint="Total count of commission-based employees."
        />
        <MetricCard
          label="Employees Awaiting Payment"
          value={`${summary.employeesDue}`}
          hint="Number of employees with pending or partial payments."
        />
      </section>

      {/* Dynamic Filter Bar */}
      <div className="mt-0.5 sm:mt-4">
        <DynamicFilterBar
          filterDefinitions={filterDefinitions}
          onApply={setAppliedFilters}
        />
      </div>

      {/* Employee Wallets Section */}
      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-xl font-black text-gray-900">Employee Wallets</h3>
            <p className="mt-1 text-sm font-medium text-gray-500">
              Commission employees earn per order. Fixed salary employees receive their salary monthly.
            </p>
          </div>
        </div>

        {filteredWalletCards.length === 0 ? (
          <div className="mt-6 rounded-[22px] border border-dashed border-gray-200 bg-gray-50 px-6 py-14 text-center text-sm font-medium text-gray-400">
            {appliedFilters.length > 0
              ? 'No employee wallets match the current filters.'
              : 'No employee wallets are available yet.'}
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredWalletCards.map((card) => (
                <WalletCard key={card.employeeId} card={card} onPay={handleOpenPayout} />
              ))}
            </div>

            <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="text-sm font-medium text-gray-500">
                Showing {walletCardsTotal === 0 ? 0 : (cardsPage - 1) * pageSize + 1}
                {' - '}
                {Math.min(cardsPage * pageSize, walletCardsTotal)} of {walletCardsTotal} employee wallets
              </p>
              <Pagination
                page={cardsPage}
                totalPages={walletCardsTotalPages}
                onPageChange={setCardsPage}
                disabled={walletCardsLoading}
              />
            </div>
          </>
        )}
      </section>

      {/* Payment History Section */}
      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-xl font-black text-gray-900">Payment History</h3>
            <p className="mt-1 text-sm font-medium text-gray-500">
              Admin-only payout history for payments already settled to employees.
            </p>
          </div>
        </div>

        <div className="mt-6">
          <Table
            columns={historyColumns}
            data={walletActivity}
            hover={false}
            size="sm"
            loading={walletActivityLoading}
            emptyMessage="No employee payment history found yet."
          />
        </div>

        <Pagination
          page={historyPage}
          totalPages={walletActivityTotalPages}
          onPageChange={setHistoryPage}
          disabled={walletActivityLoading}
        />
      </section>

      {/* Payout Modal */}
      <Modal
        isOpen={!!selectedCard}
        onClose={handleClosePayout}
        title="Pay Employee Wallet"
        size="lg"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={handleClosePayout}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleConfirmPayout}
              loading={payEmployeeWalletMutation.isPending}
              disabled={!selectedCard || !payrollExpenseCategory}
            >
              Create Payout
            </Button>
          </>
        }
      >
        {selectedCard && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-[#d6e3f0] bg-[#f8fbff] px-5 py-5">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Employee</p>
              <p className="mt-2 text-lg font-black text-gray-900">{selectedCard.employeeName}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-sm font-medium text-gray-500">
                  Wallet balance {formatCurrency(selectedCard.currentBalance)}
                </span>
                {!selectedCard.isCommissionBased && selectedCard.fixedSalary && (
                  <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-violet-700">
                    Fixed Salary: {formatCurrency(selectedCard.fixedSalary)}/month
                  </span>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Amount</label>
                <NumericInput
                  value={payoutForm.amount}
                  onChange={(value) => setPayoutForm((current) => ({ ...current, amount: value }))}
                  className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-[#3c5a82]"
                  allowDecimals={false}
                />
                <p className="text-xs font-medium text-gray-400">
                  Any amount up to {formatCurrency(selectedCard.currentBalance)}.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Payment Date</label>
                <input
                  type="date"
                  value={payoutForm.paidAt}
                  onChange={(event) => setPayoutForm((current) => ({ ...current, paidAt: event.target.value }))}
                  className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#3c5a82]"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Account</label>
                <select
                  value={payoutForm.accountId}
                  onChange={(event) => setPayoutForm((current) => ({ ...current, accountId: event.target.value }))}
                  className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#3c5a82]"
                >
                  <option value="">Select an account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs font-medium text-gray-400">
                  {selectedAccount ? `Available balance ${formatCurrency(selectedAccount.currentBalance)}` : 'Choose the account that will fund this payout.'}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Payment Method</label>
                <select
                  value={payoutForm.paymentMethod}
                  onChange={(event) => setPayoutForm((current) => ({ ...current, paymentMethod: event.target.value }))}
                  className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#3c5a82]"
                >
                  <option value="">Select a payment method</option>
                  {paymentMethods.map((method) => (
                    <option key={method.id} value={method.name}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Optional Note</label>
              <textarea
                value={payoutForm.note}
                onChange={(event) => setPayoutForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="Add a note for the wallet history..."
                className="min-h-[110px] w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#3c5a82]"
              />
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={!!deletingPayoutId}
        onClose={() => setDeletingPayoutId(null)}
        title="Delete Payout"
        size="md"
        footer={
          <>
            <Button type="button" variant="ghost" onClick={() => setDeletingPayoutId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleConfirmDeletePayout}
              loading={deleteEmployeeWalletPayoutMutation.isPending}
            >
              Delete Payout
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100">
            <span className="text-rose-600">{ICONS.AlertCircle}</span>
          </div>
          <div className="text-center">
            <h3 className="text-lg font-black text-gray-900">Are you sure?</h3>
            <p className="mt-2 text-sm text-gray-500">
              This action will permanently delete this payout. The deducted amount will be refunded to the associated account and the employee's wallet balance will be restored.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Payroll;
