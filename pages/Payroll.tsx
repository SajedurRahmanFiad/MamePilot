import React, { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  CheckCircle2,
  CircleDollarSign,
  MinusCircle,
  ReceiptText,
  Search,
  X,
} from 'lucide-react';
import { Button, LoadingOverlay, Modal, NumericInput, Table } from '../components';
import type { TableColumn } from '../components/Table';
import Pagination from '../src/components/Pagination';
import { formatCurrency } from '../constants';
import {
  hasAdminAccess,
  type PayrollPayment,
  type PayrollSummaryRow,
  type WalletBalanceCard,
} from '../types';
import { useAuth } from '../src/contexts/AuthProvider';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { useDeleteEmployeeWalletPayout, usePayEmployeeWallet } from '../src/hooks/useMutations';
import {
  useAccounts,
  useCategories,
  useEmployeeWalletCardsPage,
  usePaymentMethods,
  usePayrollHistory,
  usePayrollSummaries,
  useSystemDefaults,
  useWalletSettings,
} from '../src/hooks/useQueries';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import {
  buildPayrollPeriodFromSelection,
  formatPayrollDateRange,
  getCurrentMonthValue,
  type PayrollPeriodSelection,
} from '../src/utils/payroll';
import { formatDateTimeParts, getTodayDate } from '../utils';

const normalizeCategoryName = (value?: string): string => (value || '').trim().toLowerCase();

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

const formatTimestamp = (value?: string): string => {
  const { date, time } = formatDateTimeParts(value);
  if (!date) return '-';
  return time ? `${date}, ${time}` : date;
};

type CompensationKind = 'commission' | 'fixed' | 'unconfigured';

const getCompensationKind = (
  value?: string,
  isCommissionBased?: boolean,
  fixedSalary?: number | null
): CompensationKind => {
  if (value === 'fixed' || value === 'fixed_salary') return 'fixed';
  if (value === 'commission') return 'commission';
  if (isCommissionBased === true) return 'commission';
  if (Number(fixedSalary || 0) > 0) return 'fixed';
  return 'unconfigured';
};

const getCompensationLabel = (kind: CompensationKind): string => {
  if (kind === 'fixed') return 'Fixed salary';
  if (kind === 'commission') return 'Commission';
  return 'Pay basis missing';
};

const getPayrollBaseAmount = (summary?: PayrollSummaryRow): number => {
  if (!summary) return 0;
  if (summary.periodBaseAmount != null) return Number(summary.periodBaseAmount);
  if (summary.paymentStatus === 'paid' && summary.paymentSnapshot) {
    return Number(
      summary.paymentSnapshot.baseAmountSnapshot
      ?? summary.paymentSnapshot.amountSnapshot
      ?? 0
    );
  }
  return Number(summary.estimatedAmount || 0);
};

const MetricCard: React.FC<{
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  iconTone: string;
  loading?: boolean;
}> = ({ label, value, hint, icon, iconTone, loading = false }) => (
  <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">{label}</p>
        {loading ? (
          <div className="mt-3 h-7 w-28 animate-pulse rounded-lg bg-gray-100" />
        ) : (
          <p className="mt-2 text-xl font-black text-gray-900">{value}</p>
        )}
      </div>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${iconTone}`}>{icon}</span>
    </div>
    <p className="mt-3 text-xs font-medium leading-relaxed text-gray-500">{hint}</p>
  </div>
);

type PayrollCardProps = {
  card: WalletBalanceCard;
  summary?: PayrollSummaryRow;
  periodLabel: string;
  canPay: boolean;
  loadingSummary: boolean;
  onPay: (card: WalletBalanceCard) => void;
};

const PayrollCard: React.FC<PayrollCardProps> = ({
  card,
  summary,
  periodLabel,
  canPay,
  loadingSummary,
  onPay,
}) => {
  const isPaid = summary?.paymentStatus === 'paid';
  const baseAmount = getPayrollBaseAmount(summary);
  const payment = summary?.paymentSnapshot;
  const compensationKind = getCompensationKind(
    summary?.compensationType || card.compensationType,
    summary?.isCommissionBased ?? card.isCommissionBased,
    summary?.fixedSalary ?? card.fixedSalary
  );
  const hasOutstandingTopUp = compensationKind === 'commission'
    && isPaid
    && (summary?.hasOutstandingTopUp === true || Number(summary?.estimatedAmount || 0) > 0);
  const hasBlockingPeriodOverlap = summary?.hasBlockingPeriodOverlap === true;
  const netPaid = Number(summary?.paidNetAmount ?? payment?.amountSnapshot ?? payment?.netAmount ?? 0);
  const paidBonus = Number(summary?.paidBonusAmount ?? payment?.bonusAmount ?? 0);
  const paidDeduction = Number(summary?.paidDeductionAmount ?? payment?.deductionAmount ?? 0);

  return (
    <article className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition hover:border-[#c9daec] hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-black text-gray-900">{card.employeeName}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
              compensationKind === 'commission'
                ? 'bg-[#e8f0fa] text-[#0f2f57]'
                : compensationKind === 'fixed'
                  ? 'bg-violet-100 text-violet-700'
                  : 'bg-rose-100 text-rose-700'
            }`}>
              {getCompensationLabel(compensationKind)}
            </span>
            <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wider ${
              isPaid && !hasOutstandingTopUp && !hasBlockingPeriodOverlap ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {hasBlockingPeriodOverlap ? 'Date overlap' : hasOutstandingTopUp ? 'Top-up due' : isPaid ? 'Paid' : 'Pending'}
            </span>
          </div>
        </div>
        <span className="rounded-lg bg-gray-50 px-2 py-1 text-[9px] font-black text-gray-500">{card.employeeRole}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-3">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-gray-400">Period base</p>
          {loadingSummary ? (
            <div className="mt-2 h-5 w-20 animate-pulse rounded bg-gray-200" />
          ) : (
            <p className="mt-1 text-sm font-black text-gray-900">{formatCurrency(baseAmount)}</p>
          )}
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-gray-400">
            {isPaid ? 'Net paid' : 'Current balance'}
          </p>
          <p className="mt-1 text-sm font-black text-gray-900">
            {formatCurrency(isPaid ? netPaid : card.currentBalance)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs font-medium text-gray-500">
        <span className="truncate">{periodLabel}</span>
        <span className="shrink-0">
          {compensationKind === 'commission'
            ? `${summary?.countedOrderCount || 0} credited orders`
            : compensationKind === 'fixed'
              ? `${formatCurrency(summary?.fixedSalary ?? card.fixedSalary ?? 0)}/month`
              : 'Complete employee setup'}
        </span>
      </div>

      {isPaid && (paidBonus > 0 || paidDeduction > 0) && (
        <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-black">
          {paidBonus > 0 && (
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">+{formatCurrency(paidBonus)} bonus</span>
          )}
          {paidDeduction > 0 && (
            <span className="rounded-full bg-rose-50 px-2 py-1 text-rose-700">-{formatCurrency(paidDeduction)} deduction</span>
          )}
        </div>
      )}

      <Button
        type="button"
        variant={isPaid && !hasOutstandingTopUp && !hasBlockingPeriodOverlap ? 'outline' : 'primary'}
        size="sm"
        disabled={!canPay || hasBlockingPeriodOverlap || (isPaid && !hasOutstandingTopUp) || loadingSummary || !summary || compensationKind === 'unconfigured'}
        onClick={() => onPay(card)}
        className="mt-4 w-full justify-center"
      >
        {hasBlockingPeriodOverlap
          ? 'Choose uncovered dates'
          : hasOutstandingTopUp
          ? 'Review top-up'
          : isPaid
            ? 'Payment recorded'
          : compensationKind === 'unconfigured'
            ? 'Setup required'
            : canPay
              ? 'Review & pay'
              : 'View only'}
      </Button>
    </article>
  );
};

type PayoutFormState = {
  bonusAmount: number;
  deductionAmount: number;
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
  const { can, canPayEmployees, canDeletePayrollPayments, permissionsReady } = useRolePermissions();
  const canViewPayroll = hasAdminAccess(user?.role) || can('payroll.view');
  const canManagePayroll = hasAdminAccess(user?.role) || canPayEmployees;

  const currentMonth = getCurrentMonthValue();
  const initialPeriod = buildPayrollPeriodFromSelection({
    mode: 'month',
    selectedMonth: currentMonth,
    customDates: { from: '', to: '' },
  });
  const [periodSelection, setPeriodSelection] = useState<PayrollPeriodSelection>({
    mode: 'month',
    selectedMonth: currentMonth,
    customDates: {
      from: initialPeriod?.periodStart || getTodayDate(),
      to: initialPeriod?.periodEnd || getTodayDate(),
    },
  });
  const [selectedCard, setSelectedCard] = useState<WalletBalanceCard | null>(null);
  const [deletingPayoutId, setDeletingPayoutId] = useState<string | null>(null);
  const [cardsPage, setCardsPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [payoutForm, setPayoutForm] = useState<PayoutFormState>({
    bonusAmount: 0,
    deductionAmount: 0,
    accountId: '',
    paymentMethod: '',
    paidAt: getTodayDate(),
    note: '',
  });

  const activePeriod = useMemo(
    () => buildPayrollPeriodFromSelection(periodSelection),
    [periodSelection]
  );
  const periodStart = activePeriod?.periodStart;
  const periodEnd = activePeriod?.periodEnd;
  const isPayoutModalOpen = !!selectedCard;

  const { data: systemDefaults, isPending: defaultsLoading } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const {
    data: walletOverviewPage = {
      data: [],
      count: 0,
      summary: {
        totalBalance: 0,
        totalEarned: 0,
        totalPaid: 0,
        employeesDue: 0,
        fixedSalaryEmployees: 0,
        totalFixedSalaryDue: 0,
      },
    },
    isError: walletOverviewError,
  } = useEmployeeWalletCardsPage(1, pageSize, { enabled: canViewPayroll });
  const {
    data: walletCardsPage = {
      data: [],
      count: 0,
      summary: {
        totalBalance: 0,
        totalEarned: 0,
        totalPaid: 0,
        employeesDue: 0,
        fixedSalaryEmployees: 0,
        totalFixedSalaryDue: 0,
      },
    },
    isPending: walletCardsLoading,
    isFetching: walletCardsFetching,
    isError: walletCardsError,
  } = useEmployeeWalletCardsPage(cardsPage, pageSize, {
    enabled: canViewPayroll,
    search: debouncedSearch,
  });
  const { data: payrollSummaries = [], isPending: summariesLoading, isError: summariesError } = usePayrollSummaries(
    canViewPayroll ? periodStart : undefined,
    canViewPayroll ? periodEnd : undefined
  );
  const { data: payrollHistory = [], isPending: historyLoading, isError: historyError } = usePayrollHistory(periodStart, periodEnd, undefined, canViewPayroll);
  const { data: walletSettings = { unitAmount: 0, countedStatuses: [] }, isError: walletSettingsError } = useWalletSettings();
  const { data: accounts = [], isPending: accountsLoading } = useAccounts({ enabled: canViewPayroll && isPayoutModalOpen });
  const { data: paymentMethods = [], isPending: paymentMethodsLoading } = usePaymentMethods(true, { enabled: canViewPayroll && isPayoutModalOpen });
  const { data: categories = [], isPending: categoriesLoading } = useCategories(undefined, { enabled: canViewPayroll && isPayoutModalOpen });

  const walletCards = walletCardsPage.data;
  const walletCardsTotal = walletCardsPage.count;
  const walletSummary = walletOverviewPage.summary;
  const totalEmployees = walletOverviewPage.count;
  const walletCardsTotalPages = Math.max(1, Math.ceil(walletCardsTotal / pageSize));
  const employeeSearchLoading = walletCardsFetching || searchTerm.trim() !== debouncedSearch;
  const historyTotalPages = Math.max(1, Math.ceil(payrollHistory.length / pageSize));
  const visibleHistory = payrollHistory.slice((historyPage - 1) * pageSize, historyPage * pageSize);

  const summaryByEmployee = useMemo(
    () => new Map(payrollSummaries.map((summary) => [summary.employeeId, summary])),
    [payrollSummaries]
  );
  const selectedSummary = selectedCard ? summaryByEmployee.get(selectedCard.employeeId) : undefined;
  const selectedCompensationKind = selectedCard
    ? getCompensationKind(
      selectedSummary?.compensationType || selectedCard.compensationType,
      selectedSummary?.isCommissionBased ?? selectedCard.isCommissionBased,
      selectedSummary?.fixedSalary ?? selectedCard.fixedSalary
    )
    : 'unconfigured';

  const expenseCategories = useMemo(
    () => categories.filter((category) => category.type === 'Expense'),
    [categories]
  );
  const payrollExpenseCategory = useMemo(
    () => expenseCategories.find((category) => normalizeCategoryName(category.name) === 'payroll') || null,
    [expenseCategories]
  );
  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === payoutForm.accountId) || null,
    [accounts, payoutForm.accountId]
  );
  const selectedPaymentMethodIsValid = useMemo(
    () => paymentMethods.some((method) => method.name === payoutForm.paymentMethod),
    [paymentMethods, payoutForm.paymentMethod]
  );

  const periodTotals = useMemo(() => {
    return payrollSummaries.reduce(
      (totals, row) => {
        const pendingBase = Math.max(0, Number(row.estimatedAmount || 0));
        const paidBase = Math.max(0, Number(row.paidBaseAmount || 0));
        const baseAmount = Number(row.periodBaseAmount ?? paidBase + pendingBase);
        const payment = row.paymentSnapshot;
        totals.base += baseAmount;
        if (row.paymentStatus === 'paid' || Number(row.paymentCount || 0) > 0) {
          totals.paidNet += Number(row.paidNetAmount ?? payment?.amountSnapshot ?? payment?.netAmount ?? 0);
          totals.bonuses += Number(row.paidBonusAmount ?? payment?.bonusAmount ?? 0);
          totals.deductions += Number(row.paidDeductionAmount ?? payment?.deductionAmount ?? 0);
          totals.paidEmployees += 1;
        }
        totals.pendingBase += pendingBase;
        if (pendingBase > 0) totals.pendingEmployees += 1;
        return totals;
      },
      { base: 0, paidNet: 0, pendingBase: 0, bonuses: 0, deductions: 0, paidEmployees: 0, pendingEmployees: 0 }
    );
  }, [payrollSummaries]);

  const baseAmount = Number(selectedSummary?.estimatedAmount || 0);
  const bonusAmount = Math.max(0, Number(payoutForm.bonusAmount || 0));
  const deductionAmount = Math.max(0, Number(payoutForm.deductionAmount || 0));
  const netAmount = roundMoney(baseAmount + bonusAmount - deductionAmount);
  const deductionIsInvalid = deductionAmount > baseAmount + bonusAmount;
  const accountIsInsufficient = !!selectedAccount && netAmount > selectedAccount.currentBalance;
  const payoutFormReady = !!activePeriod
    && !!selectedSummary
    && selectedCompensationKind !== 'unconfigured'
    && selectedSummary.hasBlockingPeriodOverlap !== true
    && (selectedSummary.paymentStatus !== 'paid' || selectedSummary.hasOutstandingTopUp === true || (
      selectedCompensationKind === 'commission' && Number(selectedSummary.estimatedAmount || 0) > 0
    ))
    && netAmount > 0
    && !deductionIsInvalid
    && !accountIsInsufficient
    && !!selectedAccount
    && selectedPaymentMethodIsValid
    && !!payoutForm.paidAt
    && !!payrollExpenseCategory;

  useEffect(() => {
    if (!selectedCard) return;
    setPayoutForm({
      bonusAmount: 0,
      deductionAmount: 0,
      accountId: '',
      paymentMethod: '',
      paidAt: getTodayDate(),
      note: '',
    });
  }, [selectedCard]);

  useEffect(() => {
    if (!selectedCard) return;
    const defaultAccountId = accounts.some((account) => account.id === systemDefaults?.defaultAccountId)
      ? systemDefaults?.defaultAccountId || ''
      : accounts[0]?.id || '';
    const defaultPaymentMethod = paymentMethods.some((method) => method.name === systemDefaults?.defaultPaymentMethod)
      ? systemDefaults?.defaultPaymentMethod || ''
      : paymentMethods[0]?.name || '';

    setPayoutForm((current) => ({
      ...current,
      accountId: current.accountId || defaultAccountId,
      paymentMethod: current.paymentMethod || defaultPaymentMethod,
    }));
  }, [accounts, paymentMethods, selectedCard, systemDefaults?.defaultAccountId, systemDefaults?.defaultPaymentMethod]);

  useEffect(() => {
    if (cardsPage > walletCardsTotalPages) setCardsPage(walletCardsTotalPages);
  }, [cardsPage, walletCardsTotalPages]);

  useEffect(() => {
    if (historyPage > historyTotalPages) setHistoryPage(historyTotalPages);
  }, [historyPage, historyTotalPages]);

  useEffect(() => {
    setCardsPage(1);
    setHistoryPage(1);
    setSelectedCard(null);
  }, [periodSelection]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(searchTerm.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    setCardsPage(1);
  }, [debouncedSearch]);

  const handleOpenPayout = (card: WalletBalanceCard) => {
    const summary = summaryByEmployee.get(card.employeeId);
    if (!summary) {
      toast.warning('Payroll calculation is still loading for this employee.');
      return;
    }
    if (summary.hasBlockingPeriodOverlap) {
      toast.warning('The selected dates overlap another payroll period. Choose a fully uncovered date range.');
      return;
    }
    const hasOutstandingTopUp = getCompensationKind(
      summary.compensationType || card.compensationType,
      summary.isCommissionBased ?? card.isCommissionBased,
      summary.fixedSalary ?? card.fixedSalary
    ) === 'commission' && (summary.hasOutstandingTopUp === true || Number(summary.estimatedAmount || 0) > 0);
    if (summary.paymentStatus === 'paid' && !hasOutstandingTopUp) {
      toast.info('Payroll is already recorded for this employee in the selected period.');
      return;
    }
    const compensationKind = getCompensationKind(
      summary.compensationType || card.compensationType,
      summary.isCommissionBased ?? card.isCommissionBased,
      summary.fixedSalary ?? card.fixedSalary
    );
    if (compensationKind === 'unconfigured') {
      toast.warning('Set a fixed salary or commission pay basis for this employee before payroll.');
      return;
    }
    setSelectedCard(card);
  };

  const handleClosePayout = () => {
    setSelectedCard(null);
    setPayoutForm({
      bonusAmount: 0,
      deductionAmount: 0,
      accountId: '',
      paymentMethod: '',
      paidAt: getTodayDate(),
      note: '',
    });
  };

  const handleConfirmPayout = async () => {
    if (!selectedCard || !selectedSummary || !activePeriod) return;
    if (selectedSummary.hasBlockingPeriodOverlap) {
      toast.warning('The selected dates overlap another payroll period. Choose a fully uncovered date range.');
      return;
    }
    const canRecordCommissionTopUp = selectedCompensationKind === 'commission'
      && (selectedSummary.hasOutstandingTopUp === true || Number(selectedSummary.estimatedAmount || 0) > 0);
    if (selectedSummary.paymentStatus === 'paid' && !canRecordCommissionTopUp) {
      toast.warning('Payroll is already recorded for this employee in the selected period.');
      return;
    }
    if (deductionIsInvalid) {
      toast.warning('Deduction cannot be greater than base pay plus bonus.');
      return;
    }
    if (netAmount <= 0) {
      toast.warning('Net payment must be greater than zero.');
      return;
    }
    if (!payrollExpenseCategory) {
      toast.warning('Create an expense category named "Payroll" before recording payments.');
      return;
    }
    if (!selectedAccount || !selectedPaymentMethodIsValid || !payoutForm.paidAt) {
      toast.warning('Complete the payment account, method, and date.');
      return;
    }
    if (accountIsInsufficient) {
      toast.warning('The selected account does not have enough balance for this net payment.');
      return;
    }

    const toastId = toast.loading(`Recording payroll for ${selectedCard.employeeName}...`);
    try {
      await payEmployeeWalletMutation.mutateAsync({
        employeeId: selectedCard.employeeId,
        amount: netAmount,
        bonusAmount,
        deductionAmount,
        periodStart: activePeriod.periodStart,
        periodEnd: activePeriod.periodEnd,
        periodKind: activePeriod.mode,
        periodLabel: activePeriod.periodLabel,
        accountId: payoutForm.accountId,
        paymentMethod: payoutForm.paymentMethod,
        categoryId: payrollExpenseCategory.id,
        paidAt: payoutForm.paidAt,
        note: payoutForm.note.trim() || undefined,
      });
      toast.update(toastId, 'Payroll payment recorded successfully.', 'success');
      handleClosePayout();
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Failed to record payroll payment.', 'error');
    }
  };

  const handleConfirmDeletePayout = async () => {
    if (!deletingPayoutId) return;
    const toastId = toast.loading('Deleting payroll payment and reverting linked balances...');
    try {
      await deleteEmployeeWalletPayoutMutation.mutateAsync({ id: deletingPayoutId });
      toast.update(toastId, 'Payroll payment deleted successfully.', 'success');
      setDeletingPayoutId(null);
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Failed to delete payroll payment.', 'error');
    }
  };

  const historyColumns = useMemo<TableColumn[]>(() => [
    {
      key: 'employeeName',
      label: 'Employee',
      render: (value: string, item: PayrollPayment) => (
        <div>
          <p className="text-sm font-black text-gray-900">{value || 'Unknown employee'}</p>
          <p className="mt-0.5 text-xs font-medium text-gray-500">{item.employeeRole || 'Employee'}</p>
        </div>
      ),
    },
    {
      key: 'periodLabel',
      label: 'Pay Period',
      render: (value: string, item: PayrollPayment) => (
        <div>
          <p className="text-sm font-bold text-gray-800">{value || formatPayrollDateRange(item.periodStart, item.periodEnd)}</p>
          <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
            getCompensationKind(item.compensationType, item.isCommissionBased, item.fixedSalarySnapshot) === 'fixed'
              ? 'bg-violet-100 text-violet-700'
              : getCompensationKind(item.compensationType, item.isCommissionBased, item.fixedSalarySnapshot) === 'unconfigured'
                ? 'bg-rose-100 text-rose-700'
                : 'bg-[#e8f0fa] text-[#0f2f57]'
          }`}>
            {getCompensationLabel(getCompensationKind(item.compensationType, item.isCommissionBased, item.fixedSalarySnapshot))}
          </span>
        </div>
      ),
    },
    {
      key: 'baseAmountSnapshot',
      label: 'Base',
      align: 'right',
      render: (value: number, item: PayrollPayment) => (
        <span className="text-sm font-black text-gray-800">{formatCurrency(Number(value ?? item.amountSnapshot ?? 0))}</span>
      ),
    },
    {
      key: 'adjustments',
      label: 'Adjustments',
      align: 'right',
      render: (_value, item: PayrollPayment) => (
        <div className="space-y-1 text-right text-xs font-black">
          <p className="text-emerald-700">+ {formatCurrency(Number(item.bonusAmount || 0))}</p>
          <p className="text-rose-700">- {formatCurrency(Number(item.deductionAmount || 0))}</p>
        </div>
      ),
    },
    {
      key: 'amountSnapshot',
      label: 'Net Paid',
      align: 'right',
      render: (value: number, item: PayrollPayment) => (
        <span className="text-sm font-black text-[#0f2f57]">{formatCurrency(Number(value ?? item.netAmount ?? 0))}</span>
      ),
    },
    {
      key: 'paymentMethod',
      label: 'Paid From',
      render: (value: string, item: PayrollPayment) => (
        <div>
          <p className="text-sm font-bold text-gray-700">{item.accountName || 'Account'}</p>
          <p className="mt-0.5 text-xs font-medium text-gray-500">{value || '-'}</p>
        </div>
      ),
    },
    {
      key: 'paidAt',
      label: 'Paid At',
      render: (value: string, item: PayrollPayment) => (
        <div>
          <p className="text-sm font-bold text-gray-700">{formatTimestamp(value)}</p>
          <p className="mt-0.5 text-xs font-medium text-gray-500">By {item.paidByName || 'System'}</p>
        </div>
      ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (_value, item: PayrollPayment) => {
        const payoutId = item.walletPayoutId || item.id;
        if (!canDeletePayrollPayments || !payoutId) return null;
        return (
          <button
            type="button"
            onClick={() => setDeletingPayoutId(payoutId)}
            className="rounded-lg p-2 text-gray-400 transition hover:bg-rose-50 hover:text-rose-600"
            title="Delete payroll payment"
          >
            <MinusCircle size={17} />
          </button>
        );
      },
    },
  ], [canDeletePayrollPayments]);

  if (!user || !permissionsReady) {
    return <div className="p-8 text-center text-sm font-medium text-gray-500">Loading payroll access...</div>;
  }

  if (!canViewPayroll) {
    return (
      <div className="mx-auto max-w-3xl rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Payroll access</p>
        <h2 className="mt-3 text-2xl font-black text-gray-900">You do not have permission to view payroll.</h2>
        <p className="mt-2 text-sm font-medium text-gray-500">Employees can review their own earnings and payment history from Wallet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-12 sm:space-y-6">
      <LoadingOverlay isLoading={payEmployeeWalletMutation.isPending} message="Recording payroll payment..." />

      <header className="rounded-2xl border border-[#d6e3f0] bg-gradient-to-br from-[#f8fbff] via-white to-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-[#3c5a82]">Human Resource</p>
            <h1 className="mt-2 text-2xl font-black text-gray-900 sm:text-3xl">Payroll workspace</h1>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-relaxed text-gray-500">
              Review server-calculated salary or commission, apply bonuses and deductions, then record one traceable payment.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setPeriodSelection((current) => ({ ...current, mode: 'month' }))}
                className={`rounded-lg px-3 py-2 text-xs font-black transition ${periodSelection.mode === 'month' ? 'bg-white text-[#0f2f57] shadow-sm' : 'text-gray-500'}`}
              >
                Monthly
              </button>
              <button
                type="button"
                onClick={() => setPeriodSelection((current) => ({ ...current, mode: 'custom' }))}
                className={`rounded-lg px-3 py-2 text-xs font-black transition ${periodSelection.mode === 'custom' ? 'bg-white text-[#0f2f57] shadow-sm' : 'text-gray-500'}`}
              >
                Custom range
              </button>
            </div>

            {periodSelection.mode === 'month' ? (
              <input
                type="month"
                aria-label="Payroll month"
                value={periodSelection.selectedMonth}
                onChange={(event) => setPeriodSelection((current) => ({ ...current, selectedMonth: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-black text-gray-800 outline-none focus:ring-2 focus:ring-[#3c5a82]"
              />
            ) : (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <input
                  type="date"
                  aria-label="Payroll period start date"
                  value={periodSelection.customDates.from}
                  onChange={(event) => setPeriodSelection((current) => ({
                    ...current,
                    customDates: { ...current.customDates, from: event.target.value },
                  }))}
                  className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-[#3c5a82]"
                />
                <input
                  type="date"
                  aria-label="Payroll period end date"
                  value={periodSelection.customDates.to}
                  onChange={(event) => setPeriodSelection((current) => ({
                    ...current,
                    customDates: { ...current.customDates, to: event.target.value },
                  }))}
                  className="min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-[#3c5a82]"
                />
              </div>
            )}
          </div>
        </div>
      </header>

      {!activePeriod && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-800">
          Choose a valid payroll month or date range to continue.
        </div>
      )}
      {summariesError && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
          Payroll calculations could not be loaded. Refresh the page before recording any payment.
        </div>
      )}
      {(walletOverviewError || walletCardsError || historyError || walletSettingsError) && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm font-semibold text-rose-700">
          Some payroll records could not be refreshed. Unavailable sections are hidden instead of showing unverified zero balances.
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        <MetricCard
          label="Period base payroll"
          value={summariesError ? 'Unavailable' : formatCurrency(periodTotals.base)}
          hint={summariesError ? 'Payroll calculations could not be verified' : `Server-calculated base for ${activePeriod?.periodLabel || 'the selected period'}`}
          icon={<CircleDollarSign size={20} />}
          iconTone="bg-[#e8f0fa] text-[#0f2f57]"
          loading={summariesLoading}
        />
        <MetricCard
          label="Net paid"
          value={summariesError ? 'Unavailable' : formatCurrency(periodTotals.paidNet)}
          hint={summariesError ? 'Payment totals could not be verified' : `${periodTotals.paidEmployees} employees paid in this exact period`}
          icon={<CheckCircle2 size={20} />}
          iconTone="bg-emerald-100 text-emerald-700"
          loading={summariesLoading}
        />
        <MetricCard
          label="Pending base"
          value={summariesError ? 'Unavailable' : formatCurrency(periodTotals.pendingBase)}
          hint={summariesError ? 'Outstanding balances could not be verified' : `${periodTotals.pendingEmployees} employees currently awaiting payment`}
          icon={<Banknote size={20} />}
          iconTone="bg-amber-100 text-amber-700"
          loading={summariesLoading}
        />
        <MetricCard
          label="Recorded adjustments"
          value={summariesError ? 'Unavailable' : formatCurrency(periodTotals.bonuses - periodTotals.deductions)}
          hint={summariesError ? 'Adjustments could not be verified' : `Bonuses ${formatCurrency(periodTotals.bonuses)} · Deductions ${formatCurrency(periodTotals.deductions)}`}
          icon={<ReceiptText size={20} />}
          iconTone="bg-violet-100 text-violet-700"
          loading={summariesLoading}
        />
      </section>

      <section className="grid gap-3 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">Current wallet outstanding</p>
          <p className="mt-1 text-base font-black text-gray-900">{walletOverviewError ? 'Unavailable' : formatCurrency(walletSummary.totalBalance)}</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">Employees with balance</p>
          <p className="mt-1 text-base font-black text-gray-900">{walletOverviewError ? 'Unavailable' : walletSummary.employeesDue}</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">Current unit rate</p>
          <p className="mt-1 text-base font-black text-gray-900">{walletSettingsError ? 'Unavailable' : formatCurrency(walletSettings.unitAmount)}</p>
        </div>
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-gray-400">Compensation mix</p>
          <p className="mt-1 text-sm font-black text-gray-900">
            {walletOverviewError ? 'Unavailable' : `${walletSummary.fixedSalaryEmployees} fixed · ${Math.max(0, totalEmployees - walletSummary.fixedSalaryEmployees)} commission`}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Payment queue</p>
            <h2 className="mt-2 text-xl font-black text-gray-900">Employee payroll</h2>
            <p className="mt-1 text-sm font-medium text-gray-500">
              Base pay follows the selected period. Current balance is shown separately for context.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
            <label className="relative block min-w-0 sm:w-72">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="search"
                aria-label="Search employees for payroll"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search name, phone, or role"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-9 text-sm font-medium outline-none focus:border-[#3c5a82] focus:ring-2 focus:ring-[#3c5a82]/20"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-700"
                  aria-label="Clear employee search"
                >
                  <X size={15} />
                </button>
              )}
            </label>
            <span className="shrink-0 rounded-full bg-[#e8f0fa] px-3 py-2 text-center text-xs font-black text-[#0f2f57]">
              {activePeriod?.periodLabel || 'Select a period'}
            </span>
          </div>
        </div>

        {walletCardsError ? (
          <div className="mt-6 rounded-2xl border border-dashed border-rose-200 bg-rose-50 px-6 py-14 text-center text-sm font-semibold text-rose-700">
            Employee payroll balances are unavailable. Refresh before recording a payment.
          </div>
        ) : walletCardsLoading || employeeSearchLoading || defaultsLoading ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => <div key={index} className="h-56 animate-pulse rounded-2xl bg-gray-100" />)}
          </div>
        ) : walletCards.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-14 text-center text-sm font-medium text-gray-500">
            {debouncedSearch ? 'No employees match this search.' : 'No employee payroll records are available.'}
          </div>
        ) : (
          <>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {walletCards.map((card) => (
                <PayrollCard
                  key={card.employeeId}
                  card={card}
                  summary={summaryByEmployee.get(card.employeeId)}
                  periodLabel={activePeriod?.periodLabel || '-'}
                  canPay={canManagePayroll}
                  loadingSummary={summariesLoading}
                  onPay={handleOpenPayout}
                />
              ))}
            </div>
            <div className="mt-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="text-sm font-medium text-gray-500">
                Showing {walletCardsTotal === 0 ? 0 : (cardsPage - 1) * pageSize + 1} - {Math.min(cardsPage * pageSize, walletCardsTotal)} of {walletCardsTotal} employees
              </p>
              <Pagination page={cardsPage} totalPages={walletCardsTotalPages} onPageChange={setCardsPage} disabled={walletCardsLoading || employeeSearchLoading} />
            </div>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Audit trail</p>
          <h2 className="mt-2 text-xl font-black text-gray-900">Payment history</h2>
          <p className="mt-1 text-sm font-medium text-gray-500">Base, adjustments, funding source, and payer for the selected period.</p>
        </div>

        {historyError ? (
          <div className="mt-6 rounded-2xl border border-dashed border-rose-200 bg-rose-50 px-6 py-10 text-center text-sm font-semibold text-rose-700">
            Payment history is unavailable. No absence-of-payment conclusion should be made until it reloads.
          </div>
        ) : (
          <>
            <div className="mt-6">
              <Table
                columns={historyColumns}
                data={visibleHistory}
                hover={false}
                size="sm"
                loading={historyLoading}
                emptyMessage="No payroll payments were recorded for this period."
              />
            </div>
            <Pagination page={historyPage} totalPages={historyTotalPages} onPageChange={setHistoryPage} disabled={historyLoading} />
          </>
        )}
      </section>

      <Modal
        isOpen={!!selectedCard}
        onClose={handleClosePayout}
        title="Review Payroll Payment"
        size="lg"
        footer={(
          <>
            <Button type="button" variant="ghost" onClick={handleClosePayout}>Cancel</Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleConfirmPayout}
              loading={payEmployeeWalletMutation.isPending}
              disabled={!payoutFormReady || accountsLoading || paymentMethodsLoading || categoriesLoading}
            >
              Record {formatCurrency(Math.max(0, netAmount))}
            </Button>
          </>
        )}
      >
        {selectedCard && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-[#d6e3f0] bg-[#f8fbff] p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Employee</p>
                  <p className="mt-2 text-lg font-black text-gray-900">{selectedCard.employeeName}</p>
                  <p className="mt-1 text-sm font-medium text-gray-500">
                    {getCompensationLabel(selectedCompensationKind)} · {selectedCard.employeeRole}
                  </p>
                </div>
                <div className="rounded-xl bg-white px-4 py-3 text-right shadow-sm">
                  <p className="text-[9px] font-black uppercase tracking-wider text-gray-400">Pay period</p>
                  <p className="mt-1 text-sm font-black text-gray-900">{activePeriod?.periodLabel}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-gray-400">Server base</p>
                <p className="mt-2 text-lg font-black text-gray-900">{formatCurrency(baseAmount)}</p>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-emerald-600">Bonus</p>
                <p className="mt-2 text-lg font-black text-emerald-800">+{formatCurrency(bonusAmount)}</p>
              </div>
              <div className="rounded-xl border border-rose-100 bg-rose-50 p-4">
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-rose-600">Deduction</p>
                <p className="mt-2 text-lg font-black text-rose-800">-{formatCurrency(deductionAmount)}</p>
              </div>
              <div className="rounded-xl border border-[#c9daec] bg-[#e8f0fa] p-4">
                <p className="text-[9px] font-black uppercase tracking-[0.14em] text-[#3c5a82]">Net payment</p>
                <p className="mt-2 text-lg font-black text-[#0f2f57]">{formatCurrency(Math.max(0, netAmount))}</p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <NumericInput
                label="Bonus"
                value={payoutForm.bonusAmount}
                onChange={(value) => setPayoutForm((current) => ({ ...current, bonusAmount: Math.max(0, value) }))}
                min={0}
                helperText="Optional addition for performance, festival, or other approved bonus."
              />
              <NumericInput
                label="Deduction"
                value={payoutForm.deductionAmount}
                onChange={(value) => setPayoutForm((current) => ({ ...current, deductionAmount: Math.max(0, value) }))}
                min={0}
                error={deductionIsInvalid ? 'Deduction exceeds base pay plus bonus.' : undefined}
                helperText="Optional approved deduction from this period's pay."
              />
            </div>

            <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-medium leading-relaxed text-sky-800">
              {selectedCompensationKind === 'commission'
                ? `Base pay uses ${selectedSummary?.countedOrderCount || 0} eligible order credits and their recorded rates.`
                : selectedCompensationKind === 'fixed'
                  ? `Base pay is prorated from ${formatCurrency(selectedSummary?.fixedSalary ?? selectedCard.fixedSalary ?? 0)} monthly salary for the selected calendar days.`
                  : 'This employee has no configured compensation basis.'}
              {' '}The server recalculates this base before saving, so stale or duplicate payments are rejected.
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Payment account</label>
                <select
                  value={payoutForm.accountId}
                  onChange={(event) => setPayoutForm((current) => ({ ...current, accountId: event.target.value }))}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#3c5a82]"
                >
                  <option value="">Select an account</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
                <p className={`text-xs font-medium ${accountIsInsufficient ? 'text-rose-600' : 'text-gray-500'}`}>
                  {selectedAccount ? `Available ${formatCurrency(selectedAccount.currentBalance)}` : 'Choose the account funding this payroll payment.'}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Payment method</label>
                <select
                  value={payoutForm.paymentMethod}
                  onChange={(event) => setPayoutForm((current) => ({ ...current, paymentMethod: event.target.value }))}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#3c5a82]"
                >
                  <option value="">Select a method</option>
                  {paymentMethods.map((method) => <option key={method.id} value={method.name}>{method.name}</option>)}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Payment date</label>
                <input
                  type="date"
                  value={payoutForm.paidAt}
                  onChange={(event) => setPayoutForm((current) => ({ ...current, paidAt: event.target.value }))}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold outline-none focus:ring-2 focus:ring-[#3c5a82]"
                />
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Payroll expense category</p>
                <p className={`mt-2 text-sm font-black ${payrollExpenseCategory ? 'text-gray-900' : 'text-rose-600'}`}>
                  {payrollExpenseCategory?.name || 'Payroll category is missing'}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Payment note</label>
              <textarea
                value={payoutForm.note}
                onChange={(event) => setPayoutForm((current) => ({ ...current, note: event.target.value }))}
                placeholder="Optional reason for bonus, deduction, or other payroll context..."
                className="min-h-[100px] w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium outline-none focus:ring-2 focus:ring-[#3c5a82]"
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!deletingPayoutId}
        onClose={() => setDeletingPayoutId(null)}
        title="Delete Payroll Payment"
        size="md"
        footer={(
          <>
            <Button type="button" variant="ghost" onClick={() => setDeletingPayoutId(null)}>Cancel</Button>
            <Button type="button" variant="danger" onClick={handleConfirmDeletePayout} loading={deleteEmployeeWalletPayoutMutation.isPending}>
              Delete payment
            </Button>
          </>
        )}
      >
        <div className="space-y-4 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600"><MinusCircle size={22} /></span>
          <div>
            <h3 className="text-lg font-black text-gray-900">Remove this payroll record?</h3>
            <p className="mt-2 text-sm font-medium leading-relaxed text-gray-500">
              The payroll ledger, linked wallet entries, expense transaction, and account deduction will be reverted together.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Payroll;
