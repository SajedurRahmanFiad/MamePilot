import React, { useEffect, useMemo, useState } from 'react';
import { formatCurrency, ICONS } from '../constants';
import { NumericInput } from './index';
import { hasAdminAccess, isDeveloperRole, type ServiceSubscriptionItem, type ServiceSubscriptionMethod } from '../types';
import { useServiceSubscriptionOverview } from '../src/hooks/useQueries';
import { useSaveServiceSubscriptionSettings, useSubmitServiceSubscriptionPayment } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useAuth } from '../src/contexts/AuthProvider';
import { formatDate, formatDateTime } from '../utils';

const RESET_DAY_OPTIONS = Array.from({ length: 31 }, (_, index) => index + 1);

const formatOrdinalDay = (value: number): string => {
  const remainder10 = value % 10;
  const remainder100 = value % 100;
  let suffix = 'th';
  if (remainder10 === 1 && remainder100 !== 11) suffix = 'st';
  if (remainder10 === 2 && remainder100 !== 12) suffix = 'nd';
  if (remainder10 === 3 && remainder100 !== 13) suffix = 'rd';
  return `${value}${suffix}`;
};

const resolveResetDayOfMonth = (resetDayOfMonth?: number | null, dueAt?: string | null): number => {
  if (typeof resetDayOfMonth === 'number' && resetDayOfMonth >= 1 && resetDayOfMonth <= 31) {
    return resetDayOfMonth;
  }

  if (dueAt) {
    const date = new Date(dueAt);
    if (!Number.isNaN(date.getTime())) {
      return date.getDate();
    }
  }

  return 1;
};

const ServiceSubscriptionsPanel: React.FC = () => {
  const toast = useToastNotifications();
  const { user } = useAuth();
  const { data: overview } = useServiceSubscriptionOverview(!!user);
  const saveSettingsMutation = useSaveServiceSubscriptionSettings();
  const submitPaymentMutation = useSubmitServiceSubscriptionPayment();

  const isDeveloper = isDeveloperRole(user?.role);
  const canPay = hasAdminAccess(user?.role) && !isDeveloper;

  const [configForm, setConfigForm] = useState({
    resetDayOfMonth: 1,
    warningDays: 7,
    totalAmount: 0,
    nagadNumber: '',
  });
  const [items, setItems] = useState<ServiceSubscriptionItem[]>([]);
  const [methods, setMethods] = useState<ServiceSubscriptionMethod[]>([]);
  const [paymentForm, setPaymentForm] = useState({
    amount: 0,
    paymentMethodId: '',
    transactionId: '',
  });

  useEffect(() => {
    if (!overview) return;

    setConfigForm({
      resetDayOfMonth: resolveResetDayOfMonth(overview.resetDayOfMonth, overview.dueAt),
      warningDays: overview.warningDays || 7,
      totalAmount: overview.totalAmount || 0,
      nagadNumber: overview.nagadNumber || '',
    });
    setItems(overview.items || []);
    setMethods(overview.methods || []);
    setPaymentForm((current) => ({
      ...current,
      amount: overview.minimumPaymentAmount || overview.totalAmount || 0,
      paymentMethodId:
        current.paymentMethodId ||
        overview.methods.find((method) => method.isActive)?.id ||
        '',
    }));
  }, [overview]);

  const activeItems = useMemo(() => (overview?.items || []).filter((item) => item.isActive), [overview?.items]);
  const activeMethods = useMemo(() => (overview?.methods || []).filter((method) => method.isActive), [overview?.methods]);
  const minimumAmount = overview?.minimumPaymentAmount || 0;
  const tipAmount = Math.max(0, paymentForm.amount - minimumAmount);
  const stateLabel = overview
    ? overview.state === 'unconfigured'
      ? 'Not configured'
      : overview.state.charAt(0).toUpperCase() + overview.state.slice(1)
    : 'Unknown';
  const stateValueClass =
    overview?.state === 'active'
      ? 'text-emerald-600'
      : overview?.state === 'unconfigured'
        ? 'text-gray-500'
        : 'text-red-600';
  const summaryCards = overview ? (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Current State</p>
        <p className={`mt-2 text-sm font-black ${stateValueClass}`}>{stateLabel}</p>
      </div>
      <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Valid Till</p>
        <p className="mt-2 text-sm font-black text-gray-900">
          {overview.dueAt ? formatDate(overview.dueAt) : 'Not configured'}
        </p>
      </div>
      <div className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Required Amount</p>
        <p className="mt-2 text-sm font-black text-gray-900">{formatCurrency(overview.totalAmount || 0)}</p>
      </div>
    </div>
  ) : null;

  const updateItem = (id: string, updater: (current: ServiceSubscriptionItem) => ServiceSubscriptionItem) => {
    setItems((current) => current.map((item) => (item.id === id ? updater(item) : item)));
  };

  const updateMethod = (id: string, updater: (current: ServiceSubscriptionMethod) => ServiceSubscriptionMethod) => {
    setMethods((current) => current.map((method) => (method.id === id ? updater(method) : method)));
  };

  const addItem = () => {
    setItems((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: '',
        description: '',
        isOptional: false,
        isActive: true,
        displayOrder: (current.length + 1) * 10,
      },
    ]);
  };

  const addMethod = () => {
    setMethods((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        name: '',
        description: '',
        isActive: true,
        displayOrder: (current.length + 1) * 10,
      },
    ]);
  };

  const saveDeveloperConfig = async () => {
    if (configForm.resetDayOfMonth < 1 || configForm.resetDayOfMonth > 31) {
      toast.error('Please choose a valid monthly reset day.');
      return;
    }

    if (configForm.totalAmount <= 0) {
      toast.error('Total amount must be greater than zero.');
      return;
    }

    const cleanedItems = items
      .filter((item) => item.name.trim())
      .map((item) => ({
        id: item.id,
        name: item.name.trim(),
        description: item.description?.trim() || null,
        isOptional: !!item.isOptional,
        isActive: !!item.isActive,
        displayOrder: item.displayOrder,
        systemKey: item.systemKey || null,
      }));

    const cleanedMethods = methods
      .filter((method) => method.name.trim())
      .map((method) => ({
        id: method.id,
        name: method.name.trim(),
        description: method.description?.trim() || null,
        isActive: !!method.isActive,
        displayOrder: method.displayOrder,
      }));

    try {
      await saveSettingsMutation.mutateAsync({
        resetDayOfMonth: configForm.resetDayOfMonth,
        warningDays: Math.max(1, configForm.warningDays),
        totalAmount: configForm.totalAmount,
        nagadNumber: configForm.nagadNumber.trim() || null,
        items: cleanedItems,
        methods: cleanedMethods,
      });
      toast.success('Service subscription settings saved.');
    } catch (error) {
      console.error('Failed to save subscription settings:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to save subscription settings.');
    }
  };

  const submitPayment = async () => {
    if (!paymentForm.paymentMethodId) {
      toast.error('Please select a payment method.');
      return;
    }
    if (!paymentForm.transactionId.trim()) {
      toast.error('Please enter the transaction id.');
      return;
    }
    if (paymentForm.amount < minimumAmount) {
      toast.error(`Amount cannot be lower than ${formatCurrency(minimumAmount)}.`);
      return;
    }

    try {
      await submitPaymentMutation.mutateAsync({
        amount: paymentForm.amount,
        paymentMethodId: paymentForm.paymentMethodId,
        transactionId: paymentForm.transactionId.trim(),
      });
      toast.success('Payment submitted. The renewal process can take up to 10 minutes.');
      setPaymentForm((current) => ({
        ...current,
        transactionId: '',
      }));
    } catch (error) {
      console.error('Failed to submit subscription payment:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to submit subscription payment.');
    }
  };

  if (!overview) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center text-sm font-medium text-gray-400 shadow-sm">
        Loading subscription settings...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {isDeveloper ? (
        <div className="rounded-[1.75rem] border border-gray-100 bg-white p-6 shadow-sm">
          {summaryCards}
        </div>
      ) : (
        summaryCards
      )}

      {canPay && (
        <div className="rounded-[1.75rem] border border-gray-100 bg-white p-6 shadow-sm">
          <div className="border-b border-gray-100 pb-4">
            <h4 className="text-lg font-black text-gray-900">Renew Services</h4>
            <p className="mt-1 text-sm text-gray-500">
              Pay the required amount, submit the transaction id, and the system will reopen automatically after processing.
            </p>
          </div>

          <div className="mt-5 space-y-5">
            <div className="rounded-2xl border border-[#d6e3f0] bg-[#f8fbff] px-4 py-4">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Account Number</p>
              <p className="mt-2 text-lg font-black text-gray-900">{overview.nagadNumber || 'Not configured yet'}</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-gray-400">Payment Method</label>
              <select
                value={paymentForm.paymentMethodId}
                onChange={(event) => setPaymentForm((current) => ({ ...current, paymentMethodId: event.target.value }))}
                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
              >
                <option value="">Select a payment method...</option>
                {activeMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <label className="text-xs font-black uppercase tracking-widest text-gray-400">Amount</label>
                <span
                  title="You can pay more than the required amount if you want to leave a maintenance tip for the developer."
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-gray-100 text-gray-500"
                >
                  {ICONS.Help}
                </span>
              </div>
              <NumericInput
                value={paymentForm.amount}
                onChange={(value) =>
                  setPaymentForm((current) => ({
                    ...current,
                    amount: value,
                  }))
                }
                className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium transition-all focus:ring-2 focus:ring-[#3c5a82]"
                allowDecimals={true}
                decimalPlaces={2}
              />
              <p className="text-xs font-medium text-gray-500">
                Minimum required amount: {formatCurrency(minimumAmount)}
              </p>
              {tipAmount > 0 && (
                <p className="text-xs font-medium text-emerald-600">
                  {formatCurrency(tipAmount)} will go as a maintenance tip to the developer.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-gray-400">Transaction ID</label>
              <input
                type="text"
                value={paymentForm.transactionId}
                onChange={(event) => setPaymentForm((current) => ({ ...current, transactionId: event.target.value }))}
                className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
              />
            </div>

            {(overview.currentPayment?.status === 'processing' || overview.state === 'renewing') && (
              <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4 text-sm font-medium text-amber-700">
                Renewal is processing. The server will be fully available again within 10 minutes.
              </div>
            )}

            <button
              onClick={submitPayment}
              disabled={submitPaymentMutation.isPending || activeMethods.length === 0}
              className="w-full rounded-xl bg-[#0f2f57] px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-[#143b6d] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitPaymentMutation.isPending ? 'Submitting...' : 'Submit Renewal Payment'}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6">
        <section className="space-y-6">
          <div className="rounded-[1.75rem] border border-gray-100 bg-white p-6 shadow-sm">
            <div className="border-b border-gray-100 pb-4">
              <h4 className="text-lg font-black text-gray-900">Covered Tools & Sectors</h4>
              <p className="mt-1 text-sm text-gray-500">These are the backend services that must stay funded.</p>
            </div>

            <div className="mt-5 space-y-3">
              {(isDeveloper ? items : activeItems).map((item) => (
                <div key={item.id} className="rounded-2xl border border-gray-100 bg-gray-50/70 px-4 py-4">
                  {isDeveloper ? (
                    <div className="grid gap-4 md:grid-cols-[1fr_auto_auto]">
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={item.name}
                          onChange={(event) => updateItem(item.id, (current) => ({ ...current, name: event.target.value }))}
                          placeholder="Item name"
                          className="w-full rounded-xl border border-gray-100 bg-white px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
                        />
                      </div>
                      <label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-gray-500">
                        <input
                          type="checkbox"
                          checked={item.isOptional}
                          onChange={(event) => updateItem(item.id, (current) => ({ ...current, isOptional: event.target.checked }))}
                        />
                        Optional
                      </label>
                      <label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-gray-500">
                        <input
                          type="checkbox"
                          checked={item.isActive}
                          onChange={(event) => updateItem(item.id, (current) => ({ ...current, isActive: event.target.checked }))}
                        />
                        Active
                      </label>
                    </div>
                  ) : (
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-gray-900">{item.name}</p>
                        <p className="mt-1 text-sm text-gray-500">{item.description || 'Included in the renewal cycle.'}</p>
                      </div>
                      {item.isOptional && (
                        <span className="rounded-full bg-gray-200 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-gray-600">
                          Optional
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {isDeveloper && (
                <button
                  onClick={addItem}
                  className="w-full rounded-2xl border border-dashed border-[#c7dff5] bg-[#f8fbff] px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-[#0f2f57] transition-all hover:bg-[#ebf4ff]"
                >
                  Add Service Item
                </button>
              )}
            </div>
          </div>
        </section>

        {isDeveloper && (
          <section className="space-y-6">
            <div className="rounded-[1.75rem] border border-gray-100 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <div>
                  <h4 className="text-lg font-black text-gray-900">Billing Configuration</h4>
                  <p className="mt-1 text-sm text-gray-500">Choose the day of the month when the subscription should reset every month.</p>
                </div>
                <button
                  onClick={saveDeveloperConfig}
                  disabled={saveSettingsMutation.isPending}
                  className="rounded-xl bg-[#0f2f57] px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] text-white transition-all hover:bg-[#143b6d] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saveSettingsMutation.isPending ? 'Saving...' : 'Save Config'}
                </button>
              </div>

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-gray-400">Monthly Reset Day</label>
                  <select
                    value={configForm.resetDayOfMonth}
                    onChange={(event) =>
                      setConfigForm((current) => ({
                        ...current,
                        resetDayOfMonth: Math.max(1, Math.min(31, Number.parseInt(event.target.value || '1', 10) || 1)),
                      }))
                    }
                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
                  >
                    {RESET_DAY_OPTIONS.map((day) => (
                      <option key={day} value={day}>
                        {formatOrdinalDay(day)} day of every month
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-gray-400">Warning Window (days)</label>
                  <NumericInput
                    value={configForm.warningDays}
                    onChange={(value) =>
                      setConfigForm((current) => ({
                        ...current,
                        warningDays: Math.max(1, value),
                      }))
                    }
                    className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium transition-all focus:ring-2 focus:ring-[#3c5a82]"
                    allowDecimals={false}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-gray-400">Global Total Amount</label>
                  <NumericInput
                    value={configForm.totalAmount}
                    onChange={(value) =>
                      setConfigForm((current) => ({
                        ...current,
                        totalAmount: Math.max(0, value),
                      }))
                    }
                    className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium transition-all focus:ring-2 focus:ring-[#3c5a82]"
                    allowDecimals={true}
                    decimalPlaces={2}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-gray-400">Account Number</label>
                  <input
                    type="text"
                    value={configForm.nagadNumber}
                    onChange={(event) => setConfigForm((current) => ({ ...current, nagadNumber: event.target.value }))}
                    className="w-full rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-gray-100 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <div>
                  <h4 className="text-lg font-black text-gray-900">Payment Method Options</h4>
                  <p className="mt-1 text-sm text-gray-500">These drive the dedicated renewal payment dropdown.</p>
                </div>
                <button
                  onClick={addMethod}
                  className="rounded-xl border border-[#c7dff5] bg-[#f8fbff] px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] text-[#0f2f57] transition-all hover:bg-[#ebf4ff]"
                >
                  Add Method
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {methods.map((method) => (
                  <div key={method.id} className="rounded-2xl border border-gray-100 bg-gray-50/70 px-4 py-4">
                    <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={method.name}
                          onChange={(event) => updateMethod(method.id, (current) => ({ ...current, name: event.target.value }))}
                          placeholder="Method name"
                          className="w-full rounded-xl border border-gray-100 bg-white px-4 py-3 font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
                        />
                      </div>
                      <label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-gray-500">
                        <input
                          type="checkbox"
                          checked={method.isActive}
                          onChange={(event) => updateMethod(method.id, (current) => ({ ...current, isActive: event.target.checked }))}
                        />
                        Active
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-gray-100 bg-white p-6 shadow-sm">
              <div className="border-b border-gray-100 pb-4">
                <h4 className="text-lg font-black text-gray-900">Recent Payments</h4>
                <p className="mt-1 text-sm text-gray-500">Renewal history for the current and previous monthly cycles.</p>
              </div>

              <div className="mt-5 space-y-3">
                {overview.payments.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-5 py-8 text-center text-sm font-medium text-gray-400">
                    No renewal payments submitted yet.
                  </div>
                ) : (
                  overview.payments.map((payment) => (
                    <div key={payment.id} className="rounded-2xl border border-gray-100 bg-gray-50/70 px-4 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-gray-900">{payment.paymentMethodName}</p>
                          <p className="mt-1 text-xs font-medium text-gray-500">Txn ID: {payment.transactionId}</p>
                          <p className="mt-1 text-xs font-medium text-gray-500">
                            Submitted by {payment.submittedByName || 'Unknown'} on{' '}
                            {payment.submittedAt ? formatDateTime(payment.submittedAt) : 'Unknown'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-gray-900">{formatCurrency(payment.amount)}</p>
                          <span
                            className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${
                              payment.status === 'approved'
                                ? 'bg-emerald-50 text-emerald-700'
                                : payment.status === 'processing'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-red-50 text-red-700'
                            }`}
                          >
                            {payment.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default ServiceSubscriptionsPanel;
