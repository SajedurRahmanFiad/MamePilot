import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Modal, NumericInput, TableLoadingSkeleton } from '../components';
import { Dialog } from '../components/Modal';
import DynamicFilterBar, { type CombinedFilter, type FilterDefinition } from '../components/DynamicFilterBar';
import { formatCurrency, ICONS } from '../constants';
import type {
  RecurringTransaction,
  RecurringTransactionInput,
  RecurringTransactionInterval,
} from '../types';
import Pagination from '../src/components/Pagination';
import { useRecurringTransactionFormOptions, useRecurringTransactionsPage, useSystemDefaults } from '../src/hooks/useQueries';
import {
  useCreateRecurringTransaction,
  useDeleteRecurringTransaction,
  useUpdateRecurringTransaction,
} from '../src/hooks/useMutations';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useSubscriptionReadOnly } from '../src/contexts/SubscriptionReadOnlyContext';
import { WRITE_FREEZE_ENABLED } from '../src/config/incidentMode';
import { buildLocalDateTime, formatDateTimeParts, getCurrentTime, getTodayDate, normalizeUtcTimestamp } from '../utils';

type ModalMode = 'create' | 'view' | 'edit';

type FormState = {
  type: 'Income' | 'Expense';
  accountId: string;
  categoryId: string;
  paymentMethod: string;
  amount: number;
  note: string;
  interval: RecurringTransactionInterval;
  startDate: string;
  startTime: string;
  isActive: boolean;
};

const INTERVAL_LABELS: Record<RecurringTransactionInterval, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

const emptyForm = (): FormState => ({
  type: 'Expense',
  accountId: '',
  categoryId: '',
  paymentMethod: '',
  amount: 0,
  note: '',
  interval: 'monthly',
  startDate: getTodayDate(),
  startTime: getCurrentTime(),
  isActive: true,
});

const localInputParts = (value?: string | null) => {
  const normalized = normalizeUtcTimestamp(value) || String(value || '');
  const parsed = normalized ? new Date(normalized) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    return { date: getTodayDate(), time: getCurrentTime() };
  }
  return {
    date: parsed.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' }),
    time: parsed.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Asia/Dhaka',
    }),
  };
};

const displayDateTime = (value?: string | null) => {
  const parts = formatDateTimeParts(value);
  return parts.date && parts.time ? `${parts.date}, ${parts.time}` : 'Not yet';
};

const RecurringTransactions: React.FC = () => {
  const toast = useToastNotifications();
  const { can } = useRolePermissions();
  const { isReadOnly } = useSubscriptionReadOnly();
  const writeDisabled = isReadOnly || WRITE_FREEZE_ENABLED;
  const canCreate = can('transactions.create') && !writeDisabled;
  const canEdit = can('transactions.edit') && !writeDisabled;
  const canDelete = can('transactions.delete') && !writeDisabled;
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number(searchParams.get('page') || 1) || 1);
  const search = searchParams.get('search') || '';
  const [searchDraft, setSearchDraft] = useState(search);
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [selected, setSelected] = useState<RecurringTransaction | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecurringTransaction | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const { data: systemDefaults } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;

  useEffect(() => setSearchDraft(search), [search]);
  useEffect(() => {
    if (searchDraft === search) return;
    const timer = window.setTimeout(() => {
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        if (searchDraft.trim()) next.set('search', searchDraft.trim());
        else next.delete('search');
        next.delete('page');
        return next;
      }, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, searchDraft, setSearchParams]);

  const filters = useMemo(() => ({
    search: search || undefined,
    type: searchParams.get('type') || undefined,
    interval: searchParams.get('interval') || undefined,
    status: searchParams.get('status') || undefined,
    accountId: searchParams.get('accountId') || undefined,
    categoryId: searchParams.get('categoryId') || undefined,
    paymentMethod: searchParams.get('paymentMethod') || undefined,
  }), [search, searchParams]);

  const { data: pageData, isFetching, error } = useRecurringTransactionsPage(page, pageSize, filters);
  const { data: options, isPending: optionsLoading } = useRecurringTransactionFormOptions();
  const createMutation = useCreateRecurringTransaction();
  const updateMutation = useUpdateRecurringTransaction();
  const deleteMutation = useDeleteRecurringTransaction();
  const rows = pageData?.data ?? [];
  const count = pageData?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(count / pageSize));
  const saving = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (page <= totalPages) return;
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (totalPages > 1) next.set('page', String(totalPages));
      else next.delete('page');
      return next;
    }, { replace: true });
  }, [page, setSearchParams, totalPages]);

  const categoriesForType = useMemo(
    () => (options?.categories ?? []).filter((category) => category.type === form.type),
    [form.type, options?.categories]
  );

  const filterDefinitions = useMemo<FilterDefinition[]>(() => [
    { type: 'Type', values: ['Income', 'Expense'], operators: ['='] },
    { type: 'Frequency', values: Object.entries(INTERVAL_LABELS).map(([value, label]) => ({ value, label })), operators: ['='] },
    { type: 'Status', values: [{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'error', label: 'Needs attention' }], operators: ['='] },
    {
      type: 'Account',
      values: (options?.accounts ?? []).map((account) => ({ value: account.id, label: account.name })),
      operators: ['='],
    },
    {
      type: 'Category',
      values: (options?.categories ?? []).map((category) => ({ value: category.id, label: category.name })),
      operators: ['='],
    },
    {
      type: 'Payment Method',
      values: (options?.paymentMethods ?? []).map((method) => ({ value: method.name, label: method.name })),
      operators: ['='],
    },
  ], [options]);

  const initialFilters = useMemo<CombinedFilter[]>(() => {
    const result: CombinedFilter[] = [];
    const add = (id: string, type: string, value: string | null, display?: string) => {
      if (value) result.push({ id, type, operator: '=', value, display });
    };
    const type = searchParams.get('type');
    const interval = searchParams.get('interval');
    const status = searchParams.get('status');
    const accountId = searchParams.get('accountId');
    const categoryId = searchParams.get('categoryId');
    const paymentMethod = searchParams.get('paymentMethod');
    add('type', 'Type', type);
    add('interval', 'Frequency', interval, interval ? INTERVAL_LABELS[interval as RecurringTransactionInterval] : undefined);
    add('status', 'Status', status, status === 'error' ? 'Needs attention' : status ? `${status[0].toUpperCase()}${status.slice(1)}` : undefined);
    add('account', 'Account', accountId, options?.accounts.find((account) => account.id === accountId)?.name);
    add('category', 'Category', categoryId, options?.categories.find((category) => category.id === categoryId)?.name);
    add('payment', 'Payment Method', paymentMethod);
    return result;
  }, [options, searchParams]);

  const applyFilters = (applied: CombinedFilter[]) => {
    const mapping: Record<string, string> = {
      Type: 'type',
      Frequency: 'interval',
      Status: 'status',
      Account: 'accountId',
      Category: 'categoryId',
      'Payment Method': 'paymentMethod',
    };
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      Object.values(mapping).forEach((key) => next.delete(key));
      applied.forEach((filter) => {
        const key = mapping[filter.type];
        if (key) next.set(key, filter.value);
      });
      next.delete('page');
      return next;
    });
  };

  const initializeCreateForm = () => {
    const next = emptyForm();
    const defaultType = next.type;
    next.accountId = options?.defaults.accountId || options?.accounts[0]?.id || '';
    next.paymentMethod = options?.defaults.paymentMethod || options?.paymentMethods[0]?.name || '';
    next.categoryId = options?.defaults.expenseCategoryId
      || options?.categories.find((category) => category.type === defaultType)?.id
      || '';
    setSelected(null);
    setForm(next);
    setModalMode('create');
  };

  const initializeExistingForm = (row: RecurringTransaction, mode: 'view' | 'edit') => {
    const parts = localInputParts(row.startAt);
    setSelected(row);
    setForm({
      type: row.type,
      accountId: row.accountId,
      categoryId: row.categoryId,
      paymentMethod: row.paymentMethod,
      amount: row.amount,
      note: row.note || '',
      interval: row.interval,
      startDate: parts.date,
      startTime: parts.time,
      isActive: row.isActive,
    });
    setModalMode(mode);
  };

  const updateType = (type: 'Income' | 'Expense') => {
    const preferred = type === 'Income' ? options?.defaults.incomeCategoryId : options?.defaults.expenseCategoryId;
    const matching = options?.categories.find((category) => category.type === type && category.id === preferred)
      || options?.categories.find((category) => category.type === type);
    setForm((current) => ({ ...current, type, categoryId: matching?.id || '' }));
  };

  const save = async () => {
    if (!form.accountId || !form.categoryId || !form.paymentMethod) {
      toast.warning('Account, category, and payment method are required.');
      return;
    }
    if (form.amount <= 0) {
      toast.warning('Amount must be greater than zero.');
      return;
    }
    const localDateTime = buildLocalDateTime(form.startDate, form.startTime);
    if (!localDateTime) {
      toast.warning('Please select a valid first occurrence date and time.');
      return;
    }
    const payload: RecurringTransactionInput = {
      type: form.type,
      accountId: form.accountId,
      categoryId: form.categoryId,
      paymentMethod: form.paymentMethod,
      amount: form.amount,
      note: form.note.trim(),
      interval: form.interval,
      startAt: localDateTime.toISOString(),
      isActive: form.isActive,
    };

    try {
      if (modalMode === 'edit' && selected) {
        await updateMutation.mutateAsync({ id: selected.id, updates: payload });
        toast.success('Recurring transaction updated.');
      } else {
        await createMutation.mutateAsync(payload);
        toast.success('Recurring transaction created.');
      }
      setModalMode(null);
      setSelected(null);
    } catch (saveError) {
      toast.error(saveError instanceof Error ? saveError.message : 'Could not save the recurring transaction.');
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success('Recurring transaction deleted. Existing generated transactions were kept.');
      setDeleteTarget(null);
    } catch (deleteError) {
      toast.error(deleteError instanceof Error ? deleteError.message : 'Could not delete the recurring transaction.');
    }
  };

  const setPage = (nextPage: number) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (nextPage > 1) next.set('page', String(nextPage));
      else next.delete('page');
      return next;
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-gray-900">Recurring Transactions</h1>
          <p className="mt-1 text-sm font-medium text-gray-500">Automatically create scheduled income and expenses in the background.</p>
        </div>
        {canCreate && (
          <Button onClick={initializeCreateForm} icon={ICONS.PlusCircle} disabled={optionsLoading}>
            Add Recurring Transaction
          </Button>
        )}
      </div>

      <DynamicFilterBar
        filterDefinitions={filterDefinitions}
        initialFilters={initialFilters}
        rawSearchValue={searchDraft}
        onRawSearchChange={setSearchDraft}
        freeTextLabel="Search schedules"
        onApply={applyFilters}
      />

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-bold text-red-700">
          {error.message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['Type', 'Schedule', 'Account / Method', 'Category / Note', 'Next Occurrence', 'Amount', 'Status', 'Actions'].map((heading) => (
                  <th key={heading} className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-gray-400">{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isFetching ? (
                <TableLoadingSkeleton columns={8} rows={8} />
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="px-6 py-16 text-center text-sm font-medium italic text-gray-400">No recurring transactions found.</td></tr>
              ) : rows.map((row) => {
                const status = !row.isActive ? 'Paused' : row.lastError ? 'Needs attention' : 'Active';
                return (
                  <tr key={row.id} className="group transition-colors hover:bg-gray-50">
                    <td className="px-5 py-5">
                      <span className={`inline-flex rounded-lg px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${row.type === 'Income' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>{row.type}</span>
                    </td>
                    <td className="px-5 py-5">
                      <p className="text-sm font-black text-gray-900">{INTERVAL_LABELS[row.interval]}</p>
                      <p className="mt-1 text-[11px] font-medium text-gray-400">From {displayDateTime(row.startAt)}</p>
                    </td>
                    <td className="px-5 py-5">
                      <p className="text-sm font-bold text-gray-800">{row.accountName || 'Unknown account'}</p>
                      <p className="mt-1 text-[11px] font-medium text-gray-400">{row.paymentMethod}</p>
                    </td>
                    <td className="max-w-xs px-5 py-5">
                      <p className="text-sm font-bold text-gray-800">{row.categoryName || 'Uncategorized'}</p>
                      <p className="mt-1 max-w-[240px] truncate text-xs font-medium italic text-gray-400">{row.note || 'No note'}</p>
                    </td>
                    <td className="px-5 py-5">
                      <p className="text-sm font-bold text-gray-800">{displayDateTime(row.nextRunAt)}</p>
                      <p className="mt-1 text-[11px] font-medium text-gray-400">{row.runCount} created</p>
                    </td>
                    <td className={`px-5 py-5 text-base font-black ${row.type === 'Income' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {row.type === 'Income' ? '+' : '-'}{formatCurrency(row.amount)}
                    </td>
                    <td className="px-5 py-5">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-widest ${status === 'Active' ? 'bg-emerald-50 text-emerald-700' : status === 'Paused' ? 'bg-gray-100 text-gray-600' : 'bg-amber-50 text-amber-700'}`}>{status}</span>
                    </td>
                    <td className="px-5 py-5">
                      <div className="flex items-center gap-1 rounded-xl border border-gray-100 bg-white p-1 shadow-sm sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
                        <button onClick={() => initializeExistingForm(row, 'view')} className="rounded-lg p-2 text-gray-400 hover:bg-[#ebf4ff] hover:text-[#0f2f57]" title="View">{ICONS.View}</button>
                        {canEdit && <button onClick={() => initializeExistingForm(row, 'edit')} className="rounded-lg p-2 text-gray-400 hover:bg-[#ebf4ff] hover:text-[#0f2f57]" title="Edit">{ICONS.Edit}</button>}
                        {canDelete && <button onClick={() => setDeleteTarget(row)} className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600" title="Delete">{ICONS.Delete}</button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-medium text-gray-500">
          Showing {count ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, count)} of {count}
        </p>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} disabled={isFetching} />
      </div>

      <Modal
        isOpen={modalMode !== null}
        onClose={() => !saving && setModalMode(null)}
        title={modalMode === 'create' ? 'Add Recurring Transaction' : modalMode === 'edit' ? 'Edit Recurring Transaction' : 'Recurring Transaction Details'}
        size="lg"
        footer={modalMode === 'view' ? (
          <Button variant="secondary" onClick={() => setModalMode(null)}>Close</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setModalMode(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving}>{modalMode === 'edit' ? 'Save Changes' : 'Create Schedule'}</Button>
          </>
        )}
      >
        {modalMode === 'view' && selected ? (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ['Type', selected.type],
                ['Amount', formatCurrency(selected.amount)],
                ['Frequency', INTERVAL_LABELS[selected.interval]],
                ['Account', selected.accountName || 'Unknown account'],
                ['Category', selected.categoryName || 'Uncategorized'],
                ['Payment Method', selected.paymentMethod],
                ['First Occurrence', displayDateTime(selected.startAt)],
                ['Next Occurrence', displayDateTime(selected.nextRunAt)],
                ['Last Occurrence', displayDateTime(selected.lastRunAt)],
                ['Transactions Created', String(selected.runCount)],
                ['Created By', selected.creatorName || 'Unknown user'],
                ['Status', !selected.isActive ? 'Paused' : selected.lastError ? 'Needs attention' : 'Active'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p>
                  <p className="mt-2 text-sm font-bold text-gray-900">{value}</p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-gray-100 p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Note</p>
              <p className="mt-2 whitespace-pre-wrap text-sm font-medium text-gray-700">{selected.note || 'No note provided.'}</p>
            </div>
            {selected.lastError && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-amber-700">Last automatic run needs attention</p>
                <p className="mt-2 text-sm font-medium text-amber-800">{selected.lastError}</p>
                <p className="mt-2 text-xs font-medium text-amber-600">The worker will retry automatically.</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-gray-50 p-2">
              {(['Income', 'Expense'] as const).map((type) => (
                <button key={type} type="button" onClick={() => updateType(type)} className={`rounded-lg px-4 py-3 text-sm font-black transition-colors ${form.type === type ? (type === 'Income' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-red-600 text-white shadow-sm') : 'text-gray-500 hover:bg-white'}`}>{type}</button>
              ))}
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <label className="space-y-2">
                <span className="text-xs font-black uppercase tracking-widest text-gray-400">Amount (BDT)</span>
                <NumericInput value={form.amount} onChange={(amount) => setForm((current) => ({ ...current, amount }))} allowDecimals decimalPlaces={2} className="w-full rounded-xl border border-gray-200 px-4 py-3 font-bold" />
              </label>
              <label className="space-y-2">
                <span className="text-xs font-black uppercase tracking-widest text-gray-400">Frequency</span>
                <select value={form.interval} onChange={(event) => setForm((current) => ({ ...current, interval: event.target.value as RecurringTransactionInterval }))} className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold">
                  {Object.entries(INTERVAL_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-xs font-black uppercase tracking-widest text-gray-400">Account</span>
                <select value={form.accountId} onChange={(event) => setForm((current) => ({ ...current, accountId: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold">
                  <option value="">Select an account</option>
                  {(options?.accounts ?? []).map((account) => <option key={account.id} value={account.id}>{account.name} ({formatCurrency(account.currentBalance)})</option>)}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-xs font-black uppercase tracking-widest text-gray-400">Category</span>
                <select value={form.categoryId} onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold">
                  <option value="">Select a category</option>
                  {categoriesForType.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
              </label>
              <label className="space-y-2">
                <span className="text-xs font-black uppercase tracking-widest text-gray-400">Payment Method</span>
                <select value={form.paymentMethod} onChange={(event) => setForm((current) => ({ ...current, paymentMethod: event.target.value }))} className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 font-bold">
                  <option value="">Select a payment method</option>
                  {(options?.paymentMethods ?? []).map((method) => <option key={method.id} value={method.name}>{method.name}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">First Date</span>
                  <input type="date" value={form.startDate} onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold" />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Time</span>
                  <input type="time" value={form.startTime} onChange={(event) => setForm((current) => ({ ...current, startTime: event.target.value }))} className="w-full rounded-xl border border-gray-200 px-3 py-3 font-bold" />
                </label>
              </div>
            </div>
            <label className="block space-y-2">
              <span className="text-xs font-black uppercase tracking-widest text-gray-400">Note</span>
              <textarea value={form.note} onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} placeholder="What is this recurring transaction for?" rows={4} className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 font-medium outline-none focus:border-[#3c5a82]" />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 p-4">
              <div>
                <p className="text-sm font-black text-gray-900">Active schedule</p>
                <p className="mt-1 text-xs font-medium text-gray-500">Paused schedules remain saved but create no transactions.</p>
              </div>
              <input type="checkbox" checked={form.isActive} onChange={(event) => setForm((current) => ({ ...current, isActive: event.target.checked }))} className="h-5 w-5 rounded border-gray-300" />
            </label>
          </div>
        )}
      </Modal>

      <Dialog
        isOpen={deleteTarget !== null}
        onClose={() => !deleteMutation.isPending && setDeleteTarget(null)}
        onConfirm={remove}
        title="Delete recurring transaction?"
        message="This stops the schedule permanently. Transactions already created from it will be kept in transaction history."
        confirmText="Delete Schedule"
        variant="danger"
      />
    </div>
  );
};

export default RecurringTransactions;
