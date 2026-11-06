import React, { useEffect, useMemo, useState } from 'react';
import { MinusCircle, Plus } from 'lucide-react';
import { Button, LoadingOverlay, Modal, NumericInput, Table } from '../components';
import type { TableColumn } from '../components/Table';
import { formatCurrency } from '../constants';
import { hasAdminAccess, type DeliveryPersonPayrollCredit, type DeliveryPersonPayrollPayment, type DeliveryPersonPayrollSummary } from '../types';
import { useAuth } from '../src/contexts/AuthProvider';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useCreateDeliveryPersonPayrollCredit, usePayDeliveryPersonPayroll, useDeleteDeliveryPersonPayrollPayment } from '../src/hooks/useMutations';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import {
  useAccounts,
  useCategories,
  useDeliveryPersonPayrollCreditsPage,
  useDeliveryPersonPayrollPaymentsPage,
  useDeliveryPersonPayrollSummaries,
  usePaymentMethods,
  useSystemDefaults,
} from '../src/hooks/useQueries';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { buildPayrollPeriodFromSelection, getCurrentMonthValue, type PayrollPeriodSelection } from '../src/utils/payroll';
import Pagination from '../src/components/Pagination';
import { formatDateTimeParts, getTodayDate } from '../utils';

const DeliveryPersonPayroll: React.FC = () => {
  const { user } = useAuth();
  const toast = useToastNotifications();
  const { settings: capabilitySettings } = useCapabilities(true);
  const { can, canPayEmployees } = useRolePermissions();
  const canView = hasAdminAccess(user?.role) || can('payroll.view');
  const canManage = hasAdminAccess(user?.role) || canPayEmployees;
  const currentMonth = getCurrentMonthValue();
  const initialPeriod = buildPayrollPeriodFromSelection({ mode: 'month', selectedMonth: currentMonth, customDates: { from: '', to: '' } });
  const [periodSelection, setPeriodSelection] = useState<PayrollPeriodSelection>({
    mode: 'month',
    selectedMonth: currentMonth,
    customDates: { from: initialPeriod?.periodStart || getTodayDate(), to: initialPeriod?.periodEnd || getTodayDate() },
  });
  const [selectedCard, setSelectedCard] = useState<DeliveryPersonPayrollSummary | null>(null);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [isCreditModalOpen, setIsCreditModalOpen] = useState(false);
  const [creditPage, setCreditPage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const [creditForm, setCreditForm] = useState({ deliveryPersonId: '', amount: 0, note: '' });
  const [form, setForm] = useState({ bonusAmount: 0, deductionAmount: 0, isPartial: false, partialAmount: 0, accountId: '', paymentMethod: '', categoryId: '', paidAt: getTodayDate(), note: '' });
  const { data: systemDefaults, isPending: defaultsLoading } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const { data: summaries = [], isPending: summariesLoading, isError } = useDeliveryPersonPayrollSummaries(
    buildPayrollPeriodFromSelection(periodSelection)?.periodStart,
    buildPayrollPeriodFromSelection(periodSelection)?.periodEnd,
    canView && capabilitySettings?.businessMode === 'sofa_cover',
  );
  const payrollEnabled = canView && capabilitySettings?.businessMode === 'sofa_cover';
  const { data: creditsPage, isPending: creditsLoading, isError: creditsError } = useDeliveryPersonPayrollCreditsPage(creditPage, pageSize, payrollEnabled);
  const { data: paymentsPage, isPending: paymentsLoading, isError: paymentsError } = useDeliveryPersonPayrollPaymentsPage(paymentPage, pageSize, payrollEnabled);
  const { data: accounts = [], isPending: accountsLoading } = useAccounts({ enabled: !!selectedCard });
  const { data: paymentMethods = [], isPending: paymentMethodsLoading } = usePaymentMethods(true, { enabled: !!selectedCard });
  const { data: categories = [], isPending: categoriesLoading } = useCategories(undefined, { enabled: !!selectedCard });
  const payMutation = usePayDeliveryPersonPayroll();
  const deleteMutation = useDeleteDeliveryPersonPayrollPayment();
  const creditMutation = useCreateDeliveryPersonPayrollCredit();
  const activePeriod = useMemo(() => buildPayrollPeriodFromSelection(periodSelection), [periodSelection]);
  const expenseCategories = useMemo(() => categories.filter((category) => category.type === 'Expense'), [categories]);
  const payrollCategory = expenseCategories.find((category) => category.name.trim().toLowerCase() === 'payroll') || expenseCategories[0];
  const baseAmount = selectedCard?.remainingAmount || 0;
  const fullNetAmount = Math.max(0, baseAmount + form.bonusAmount - form.deductionAmount);
  const requestedAmount = form.isPartial ? Math.min(Math.max(0, form.partialAmount), fullNetAmount) : 0;
  const netAmount = form.isPartial ? requestedAmount : fullNetAmount;
  const canSubmit = !!selectedCard && !!form.accountId && !!form.paymentMethod && !!form.categoryId && netAmount > 0 && form.deductionAmount <= baseAmount + form.bonusAmount && !accountsLoading && !paymentMethodsLoading && !categoriesLoading;
  const creditRows = creditsPage?.data || [];
  const paymentRows = paymentsPage?.data || [];
  const creditTotalPages = Math.max(1, Math.ceil((creditsPage?.count || 0) / pageSize));
  const paymentTotalPages = Math.max(1, Math.ceil((paymentsPage?.count || 0) / pageSize));

  useEffect(() => {
    if (!selectedCard) return;
    setForm((current) => ({
      ...current,
      accountId: current.accountId || systemDefaults?.defaultAccountId || accounts[0]?.id || '',
      paymentMethod: current.paymentMethod || systemDefaults?.defaultPaymentMethod || paymentMethods[0]?.name || '',
      categoryId: current.categoryId || payrollCategory?.id || '',
    }));
  }, [selectedCard, systemDefaults, accounts, paymentMethods, payrollCategory]);

  const openPayment = (card: DeliveryPersonPayrollSummary) => {
    setSelectedCard(card);
    setForm({
      bonusAmount: 0,
      deductionAmount: 0,
      isPartial: false,
      partialAmount: card.remainingAmount,
      accountId: systemDefaults?.defaultAccountId || accounts[0]?.id || '',
      paymentMethod: systemDefaults?.defaultPaymentMethod || paymentMethods[0]?.name || '',
      categoryId: payrollCategory?.id || '',
      paidAt: getTodayDate(),
      note: '',
    });
  };

  const submitPayment = async () => {
    if (!selectedCard || !activePeriod || !canSubmit) return;
    try {
      await payMutation.mutateAsync({
        deliveryPersonId: selectedCard.deliveryPersonId,
        periodStart: activePeriod.periodStart,
        periodEnd: activePeriod.periodEnd,
        periodKind: activePeriod.periodKind,
        periodLabel: activePeriod.periodLabel,
        requestedAmount,
        bonusAmount: form.bonusAmount,
        deductionAmount: form.deductionAmount,
        accountId: form.accountId,
        paymentMethod: form.paymentMethod,
        categoryId: form.categoryId,
        paidAt: form.paidAt,
        note: form.note,
      });
      setSelectedCard(null);
      toast.success('Delivery person payroll payment recorded.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not record delivery person payroll payment.');
    }
  };

  const deletePayment = async () => {
    if (!deletingPaymentId) return;
    try {
      await deleteMutation.mutateAsync({ id: deletingPaymentId });
      setDeletingPaymentId(null);
      toast.success('Delivery person payroll payment deleted.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the payment.');
    }
  };

  const submitCredit = async () => {
    if (!creditForm.deliveryPersonId || !Number.isFinite(creditForm.amount) || creditForm.amount <= 0) {
      toast.warning('Select a delivery person and enter a credit amount greater than zero.');
      return;
    }
    try {
      await creditMutation.mutateAsync({
        deliveryPersonId: creditForm.deliveryPersonId,
        amount: creditForm.amount,
        note: creditForm.note.trim() || undefined,
      });
      setIsCreditModalOpen(false);
      setCreditForm({ deliveryPersonId: '', amount: 0, note: '' });
      toast.success('Additional amount credited to the delivery person.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not credit the delivery person.');
    }
  };

  const formatTimestamp = (value?: string | null) => {
    const { date, time } = formatDateTimeParts(value || undefined);
    if (!date) return '-';
    return time ? `${date}, ${time}` : date;
  };

  const creditColumns = useMemo<TableColumn[]>(() => [
    {
      key: 'deliveryPersonName',
      label: 'Delivery Person',
      render: (value: string, item: DeliveryPersonPayrollCredit) => (
        <div>
          <p className="text-sm font-black text-gray-900">{value || 'Unknown delivery person'}</p>
          <p className="mt-0.5 text-xs font-medium text-gray-500">{item.creditedByName || 'Unknown'}</p>
        </div>
      ),
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      render: (value: number) => <span className="text-sm font-black text-emerald-700">+ {formatCurrency(Number(value || 0))}</span>,
    },
    {
      key: 'note',
      label: 'Note',
      render: (value: string | null) => <span className="text-sm font-medium text-gray-600">{value || '-'}</span>,
    },
    {
      key: 'createdAt',
      label: 'Credited At',
      render: (value: string) => <span className="text-sm font-bold text-gray-700">{formatTimestamp(value)}</span>,
    },
  ], []);

  const paymentColumns = useMemo<TableColumn[]>(() => [
    {
      key: 'deliveryPersonName',
      label: 'Delivery Person',
      render: (value: string, item: DeliveryPersonPayrollPayment) => (
        <div>
          <p className="text-sm font-black text-gray-900">{value || 'Unknown delivery person'}</p>
          <p className="mt-0.5 text-xs font-medium text-gray-500">{item.orderCountSnapshot || 0} delivered orders</p>
        </div>
      ),
    },
    {
      key: 'periodLabel',
      label: 'Pay Period',
      render: (value: string, item: DeliveryPersonPayrollPayment) => (
        <span className="text-sm font-bold text-gray-800">{value || `${item.periodStart} - ${item.periodEnd}`}</span>
      ),
    },
    {
      key: 'baseAmountSnapshot',
      label: 'Base',
      align: 'right',
      render: (value: number, item: DeliveryPersonPayrollPayment) => (
        <span className="text-sm font-black text-gray-800">{formatCurrency(Number(value ?? item.amountSnapshot ?? 0))}</span>
      ),
    },
    {
      key: 'adjustments',
      label: 'Adjustments',
      align: 'right',
      render: (_value, item: DeliveryPersonPayrollPayment) => (
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
      render: (value: number) => <span className="text-sm font-black text-[#0f2f57]">{formatCurrency(Number(value || 0))}</span>,
    },
    {
      key: 'paymentMethod',
      label: 'Paid From',
      render: (value: string, item: DeliveryPersonPayrollPayment) => (
        <div>
          <p className="text-sm font-bold text-gray-700">{item.accountName || 'Account'}</p>
          <p className="mt-0.5 text-xs font-medium text-gray-500">{value || '-'}</p>
        </div>
      ),
    },
    {
      key: 'paidAt',
      label: 'Paid At',
      render: (value: string, item: DeliveryPersonPayrollPayment) => (
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
      render: (_value, item: DeliveryPersonPayrollPayment) => canManage ? (
        <button
          type="button"
          onClick={() => setDeletingPaymentId(item.id)}
          className="rounded-lg p-2 text-gray-400 transition hover:bg-rose-50 hover:text-rose-600"
          title="Delete payroll payment"
        >
          <MinusCircle size={17} />
        </button>
      ) : null,
    },
  ], [canManage]);

  if (capabilitySettings?.businessMode !== 'sofa_cover') {
    return <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm font-semibold text-gray-500">Delivery person payroll is available only in Sofa Cover mode.</div>;
  }
  if (!canView) {
    return <div className="rounded-2xl border border-gray-100 bg-white p-10 text-center text-sm font-semibold text-gray-500">You do not have permission to view delivery person payroll.</div>;
  }

  return (
    <div className="space-y-6">
      <LoadingOverlay isLoading={summariesLoading || defaultsLoading} message="Loading delivery person payroll..." />
      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Human Resource</p>
            <h1 className="mt-2 text-2xl font-black text-gray-900">Delivery person payroll</h1>
            <p className="mt-1 text-sm font-medium text-gray-500">Completed sofa-cover orders credit the assigned delivery person&apos;s recorded shipping cost.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canManage && (
              <Button type="button" variant="primary" onClick={() => setIsCreditModalOpen(true)}>
                <Plus size={16} className="mr-1" />
                Credit amount
              </Button>
            )}
            <select value={periodSelection.mode} onChange={(event) => setPeriodSelection((current) => ({ ...current, mode: event.target.value as PayrollPeriodSelection['mode'] }))} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold">
              <option value="month">Month</option>
              <option value="custom">Custom range</option>
            </select>
            {periodSelection.mode === 'month' ? (
              <input type="month" value={periodSelection.selectedMonth} onChange={(event) => setPeriodSelection((current) => ({ ...current, selectedMonth: event.target.value }))} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold" />
            ) : (
              <>
                <input type="date" value={periodSelection.customDates.from} onChange={(event) => setPeriodSelection((current) => ({ ...current, customDates: { ...current.customDates, from: event.target.value } }))} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold" />
                <input type="date" value={periodSelection.customDates.to} onChange={(event) => setPeriodSelection((current) => ({ ...current, customDates: { ...current.customDates, to: event.target.value } }))} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-bold" />
              </>
            )}
          </div>
        </div>
      </section>

      {isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center text-sm font-semibold text-rose-700">Delivery person payroll could not be loaded.</div>
      ) : summaries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center text-sm font-medium text-gray-500">No delivery persons are available.</div>
      ) : (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {summaries.map((card) => (
            <article key={card.deliveryPersonId} className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition hover:border-[#c9daec] hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><h2 className="truncate text-sm font-black text-gray-900">{card.deliveryPersonName}</h2><p className="mt-1 text-xs font-medium text-gray-500">{card.deliveryPersonPhone || 'No phone'}</p></div>
                <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wider ${card.paymentStatus === 'paid' ? 'bg-emerald-100 text-emerald-700' : card.paymentStatus === 'partial' ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{card.paymentStatus}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-3"><div><p className="text-[9px] font-black uppercase tracking-wider text-gray-400">Orders</p><p className="mt-1 text-lg font-black text-gray-900">{card.orderCount}</p></div><div><p className="text-[9px] font-black uppercase tracking-wider text-gray-400">Owed</p><p className="mt-1 text-lg font-black text-[#0f2f57]">{formatCurrency(card.remainingAmount)}</p></div></div>
              <div className="mt-3 flex items-center justify-between text-xs font-medium text-gray-500"><span>Base {formatCurrency(card.baseAmount)}</span><span>Paid {formatCurrency(card.netPaid)}</span></div>
              <Button type="button" variant={card.remainingAmount > 0 ? 'primary' : 'outline'} size="sm" disabled={!canManage || card.remainingAmount <= 0} onClick={() => openPayment(card)} className="mt-4 w-full justify-center">{card.remainingAmount > 0 ? 'Review & pay' : 'Paid'}</Button>
              {card.paymentCount > 0 && card.lastPaymentId && <button type="button" onClick={() => setDeletingPaymentId(card.lastPaymentId || null)} className="mt-2 w-full text-center text-xs font-bold text-rose-600 hover:text-rose-800">Delete latest payment</button>}
            </article>
          ))}
        </section>
      )}

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Manual adjustments</p>
          <h2 className="mt-2 text-xl font-black text-gray-900">Additional credits</h2>
          <p className="mt-1 text-sm font-medium text-gray-500">Credits carry forward in the delivery person&apos;s amount owed until paid. They do not create transactions.</p>
        </div>
        {creditsError ? (
          <div className="mt-6 rounded-2xl border border-dashed border-rose-200 bg-rose-50 px-6 py-10 text-center text-sm font-semibold text-rose-700">
            Additional credit history is unavailable.
          </div>
        ) : (
          <>
            <div className="mt-6">
              <Table
                columns={creditColumns}
                data={creditRows}
                hover={false}
                size="sm"
                loading={creditsLoading}
                emptyMessage="No additional credits have been recorded."
              />
            </div>
            <Pagination page={creditPage} totalPages={creditTotalPages} onPageChange={setCreditPage} disabled={creditsLoading} />
          </>
        )}
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-6">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Payments</p>
          <h2 className="mt-2 text-xl font-black text-gray-900">Payment history</h2>
          <p className="mt-1 text-sm font-medium text-gray-500">Base, adjustments, funding source, and payer for delivery person payroll payments.</p>
        </div>
        {paymentsError ? (
          <div className="mt-6 rounded-2xl border border-dashed border-rose-200 bg-rose-50 px-6 py-10 text-center text-sm font-semibold text-rose-700">
            Payment history is unavailable.
          </div>
        ) : (
          <>
            <div className="mt-6">
              <Table
                columns={paymentColumns}
                data={paymentRows}
                hover={false}
                size="sm"
                loading={paymentsLoading}
                emptyMessage="No delivery person payroll payments have been recorded."
              />
            </div>
            <Pagination page={paymentPage} totalPages={paymentTotalPages} onPageChange={setPaymentPage} disabled={paymentsLoading} />
          </>
        )}
      </section>

      <Modal
        isOpen={isCreditModalOpen}
        onClose={() => setIsCreditModalOpen(false)}
        title="Credit Delivery Person"
        size="md"
        footer={(
          <>
            <Button type="button" variant="ghost" onClick={() => setIsCreditModalOpen(false)}>Cancel</Button>
            <Button
              type="button"
              variant="primary"
              onClick={submitCredit}
              loading={creditMutation.isPending}
              disabled={!canManage || !creditForm.deliveryPersonId || !Number.isFinite(creditForm.amount) || creditForm.amount <= 0}
            >
              Credit {formatCurrency(Math.max(0, creditForm.amount))}
            </Button>
          </>
        )}
      >
        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Delivery person</span>
            <select
              value={creditForm.deliveryPersonId}
              onChange={(event) => setCreditForm((current) => ({ ...current, deliveryPersonId: event.target.value }))}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold"
            >
              <option value="">Select a delivery person</option>
              {summaries.map((person) => (
                <option key={person.deliveryPersonId} value={person.deliveryPersonId}>
                  {person.deliveryPersonName}{person.deliveryPersonPhone ? ` · ${person.deliveryPersonPhone}` : ''}
                </option>
              ))}
            </select>
          </label>
          <NumericInput
            label="Amount"
            value={creditForm.amount}
            onChange={(amount) => setCreditForm((current) => ({ ...current, amount: Math.max(0, amount) }))}
            min={0}
            helperText="This amount will be added to the delivery person's outstanding payroll balance."
          />
          <label className="block space-y-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Note (optional)</span>
            <textarea
              value={creditForm.note}
              onChange={(event) => setCreditForm((current) => ({ ...current, note: event.target.value }))}
              maxLength={4000}
              className="min-h-[90px] w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium"
              placeholder="Reason for this credit"
            />
          </label>
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs font-medium leading-relaxed text-sky-800">
            This adjustment is recorded in payroll history only. It will not create an expense transaction or change an account balance.
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!selectedCard} onClose={() => setSelectedCard(null)} title="Review Delivery Person Payroll" size="lg" footer={<><Button type="button" variant="ghost" onClick={() => setSelectedCard(null)}>Cancel</Button><Button type="button" variant="primary" onClick={submitPayment} loading={payMutation.isPending} disabled={!canSubmit}>{`Record ${formatCurrency(netAmount)}`}</Button></>}>
        {selectedCard && (
          <div className="space-y-5">
            <div className="rounded-2xl border border-[#d6e3f0] bg-[#f8fbff] p-5">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Delivery person</p>
              <p className="mt-2 text-lg font-black text-gray-900">{selectedCard.deliveryPersonName}</p>
              <p className="mt-1 text-sm font-medium text-gray-500">{activePeriod?.periodLabel} · {selectedCard.orderCount} delivered orders</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-[9px] font-black uppercase tracking-wider text-gray-400">Unpaid shipping cost</p>
                <p className="mt-2 text-lg font-black text-gray-900">{formatCurrency(baseAmount)}</p>
              </div>
              <div className="rounded-xl bg-[#e8f0fa] p-4">
                <p className="text-[9px] font-black uppercase tracking-wider text-[#3c5a82]">Net payment</p>
                <p className="mt-2 text-lg font-black text-[#0f2f57]">{formatCurrency(netAmount)}</p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <NumericInput label="Bonus" value={form.bonusAmount} onChange={(value) => setForm((current) => ({ ...current, bonusAmount: Math.max(0, value) }))} min={0} />
              <NumericInput label="Deduction" value={form.deductionAmount} onChange={(value) => setForm((current) => ({ ...current, deductionAmount: Math.max(0, value) }))} min={0} error={form.deductionAmount > baseAmount + form.bonusAmount ? 'Deduction exceeds available pay.' : undefined} />
            </div>
            <label className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 p-4">
              <span>
                <span className="block text-sm font-bold text-amber-800">Partial payment</span>
                <span className="block text-xs font-medium text-amber-700">Pay less now and carry the rest forward.</span>
              </span>
              <input type="checkbox" checked={form.isPartial} onChange={(event) => setForm((current) => ({ ...current, isPartial: event.target.checked, partialAmount: event.target.checked ? Math.max(0, fullNetAmount) : 0 }))} className="h-5 w-5 rounded border-gray-300 text-amber-600" />
            </label>
            {form.isPartial && <NumericInput label="Amount to pay now" value={form.partialAmount} onChange={(value) => setForm((current) => ({ ...current, partialAmount: Math.max(0, Math.min(value, fullNetAmount)) }))} min={0} max={fullNetAmount} />}
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Payment account</span>
                <select value={form.accountId} onChange={(event) => setForm((current) => ({ ...current, accountId: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold">
                  <option value="">Select an account</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Payment method</span>
                <select value={form.paymentMethod} onChange={(event) => setForm((current) => ({ ...current, paymentMethod: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold">
                  <option value="">Select a method</option>
                  {paymentMethods.map((method) => <option key={method.id} value={method.name}>{method.name}</option>)}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Payment date</span>
                <input type="date" value={form.paidAt} onChange={(event) => setForm((current) => ({ ...current, paidAt: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold" />
              </label>
              <label className="space-y-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Expense category</span>
                <select value={form.categoryId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))} disabled={categoriesLoading || expenseCategories.length === 0} className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-60">
                  <option value="">Select an expense category</option>
                  {expenseCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
            </div>
            <label className="space-y-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Payment note</span>
              <textarea value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} className="min-h-[90px] w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium" placeholder="Optional payment note" />
            </label>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!deletingPaymentId} onClose={() => setDeletingPaymentId(null)} title="Delete Delivery Person Payroll Payment" size="md" footer={<><Button type="button" variant="ghost" onClick={() => setDeletingPaymentId(null)}>Cancel</Button><Button type="button" variant="danger" onClick={deletePayment} loading={deleteMutation.isPending}>Delete payment</Button></>}><div className="space-y-4 text-center"><MinusCircle className="mx-auto text-rose-600" size={32} /><p className="text-sm font-medium text-gray-600">The linked expense and account deduction will be reverted.</p></div></Modal>
    </div>
  );
};

export default DeliveryPersonPayroll;
