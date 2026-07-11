import React, { useEffect, useMemo } from 'react';
import { Button, NumericInput } from './index';
import { formatCurrency, ICONS } from '../constants';
import { Order, OrderCompletionOutcome } from '../types';
import { useAccounts, useCategories, usePaymentMethods, useSystemDefaults } from '../src/hooks/useQueries';

export type OrderCompletionFormState = {
  outcome: OrderCompletionOutcome;
  date: string;
  time: string;
  accountId: string;
  amount: number;
  paymentMethod: string;
  categoryId: string;
  note: string;
  refundAmount: number;
  refundAccountId: string;
  refundPaymentMethod: string;
};

interface OrderCompletionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
  order: Order | null;
  form: OrderCompletionFormState;
  setForm: React.Dispatch<React.SetStateAction<OrderCompletionFormState>>;
  isLoading: boolean;
  allowDeliveredOutcome?: boolean;
  allowReturnedOutcome?: boolean;
}

const OrderCompletionModal: React.FC<OrderCompletionModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  order,
  form,
  setForm,
  isLoading,
  allowDeliveredOutcome = true,
  allowReturnedOutcome = true,
}) => {
  const { data: accounts = [] } = useAccounts();
  const { data: paymentMethods = [] } = usePaymentMethods();
  const { data: categories = [] } = useCategories('Expense');
  const { data: systemDefaults } = useSystemDefaults();
  const shippingCostsCategory = categories.find((category) => category.name === 'Shipping Costs') ?? null;
  const availableOutcomes = useMemo<OrderCompletionOutcome[]>(
    () => [
      ...(allowDeliveredOutcome ? ['Delivered' as const] : []),
      ...(allowReturnedOutcome ? ['Returned' as const] : []),
    ],
    [allowDeliveredOutcome, allowReturnedOutcome],
  );

  useEffect(() => {
    if (!isOpen) return;

    setForm((current) => {
      const next = { ...current };
      const fallbackAccountId =
        (systemDefaults?.defaultAccountId && accounts.some((account) => account.id === systemDefaults.defaultAccountId)
          ? systemDefaults.defaultAccountId
          : '') ||
        accounts[0]?.id ||
        '';
      const fallbackPaymentMethod =
        (systemDefaults?.defaultPaymentMethod &&
        paymentMethods.some((paymentMethod) => paymentMethod.name === systemDefaults.defaultPaymentMethod)
          ? systemDefaults.defaultPaymentMethod
          : '') ||
        paymentMethods[0]?.name ||
        '';
      const fallbackCategoryId =
        shippingCostsCategory?.id ||
        ((systemDefaults?.expenseCategoryId && categories.some((category) => category.id === systemDefaults.expenseCategoryId)
          ? systemDefaults.expenseCategoryId
          : '') ||
          categories[0]?.id ||
          '');

      if (!next.accountId && fallbackAccountId) next.accountId = fallbackAccountId;
      if (!next.paymentMethod && fallbackPaymentMethod) next.paymentMethod = fallbackPaymentMethod;
      if (!next.categoryId && fallbackCategoryId) next.categoryId = fallbackCategoryId;
      if (!next.refundAccountId && fallbackAccountId) next.refundAccountId = fallbackAccountId;
      if (!next.refundPaymentMethod && fallbackPaymentMethod) next.refundPaymentMethod = fallbackPaymentMethod;
      if (!availableOutcomes.includes(next.outcome)) {
        next.outcome = availableOutcomes[0] || 'Delivered';
      }

      // If Returned is selected, default category to 'Shipping Costs' (but allow user to change it)
      if (next.outcome === 'Returned' && shippingCostsCategory && !current.categoryId) {
        next.categoryId = shippingCostsCategory.id;
      }

      if (
        next.outcome === current.outcome &&
        next.accountId === current.accountId &&
        next.paymentMethod === current.paymentMethod &&
        next.categoryId === current.categoryId &&
        next.refundAccountId === current.refundAccountId &&
        next.refundPaymentMethod === current.refundPaymentMethod
      ) {
        return current;
      }

      return next;
    });
  }, [isOpen, accounts, paymentMethods, categories, shippingCostsCategory, systemDefaults, setForm, availableOutcomes]);

  // Handle outcome changes - default category to Shipping Costs when switching to Returned (if no category selected yet)
  useEffect(() => {
    if (!availableOutcomes.includes(form.outcome)) {
      setForm((current) => ({ ...current, outcome: availableOutcomes[0] || 'Delivered' }));
      return;
    }

    if (form.outcome === 'Returned' && shippingCostsCategory && !form.categoryId) {
      setForm((current) => ({ ...current, categoryId: shippingCostsCategory.id }));
    }
  }, [form.outcome, shippingCostsCategory, form.categoryId, setForm, availableOutcomes]);

  useEffect(() => {
    if (!order) return;
    if (form.outcome === 'Returned' && !form.amount && order.shipping > 0) {
      setForm((current) => ({ ...current, amount: order.shipping }));
    }
  }, [form.outcome, form.amount, order, setForm]);

  if (!isOpen || !order || availableOutcomes.length === 0) return null;

  const isReturned = form.outcome === 'Returned';
  const outstanding = Math.max(order.total - order.paidAmount, 0);

  const dueAmount = Math.max(order.total - order.paidAmount, 0);
  const isFullyPaid = dueAmount === 0;
  const dueLabel = isFullyPaid
    ? 'Fully paid'
    : `${formatCurrency(dueAmount)} (${order.paidAmount > 0 ? 'Partially paid' : 'Not paid yet'})`;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative z-[210] w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl border border-[#ebf4ff] bg-white p-10 animate-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-6 top-6 rounded-full border border-gray-200 bg-white p-2 text-gray-500 transition hover:border-gray-300 hover:text-gray-900"
          aria-label="Close"
        >
          ×
        </button>
        <div className="mb-8">
          <h3 className="mt-2 text-2xl font-black text-gray-900">Complete order #{order.orderNumber}</h3>
          <p className="mt-2 text-sm font-medium">
            <span className={`font-black ${isFullyPaid ? 'text-emerald-600' : 'text-red-600'}`}>
              {isFullyPaid ? dueLabel : `Due amount ${dueLabel}`}
            </span>
          </p>
        </div>

        <div className="space-y-6">
          {availableOutcomes.length > 1 && (
            <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
              {availableOutcomes.map((outcome) => (
                <button
                  key={outcome}
                  type="button"
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      outcome,
                      amount: outcome === 'Returned' ? order.shipping : current.amount,
                    }))
                  }
                  disabled={isLoading}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-all ${
                    form.outcome === outcome
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  } disabled:opacity-50`}
                >
                  {outcome === 'Delivered' ? ICONS.Check : ICONS.Return}
                  <span className="hidden sm:inline">{outcome}</span>
                </button>
              ))}
            </div>
          )}

          {isReturned && (
            <>
              <div className="space-y-1">
                <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Return Expense Amount</label>
                <NumericInput
                  value={form.amount}
                  onChange={(value) =>
                    setForm((current) => ({
                      ...current,
                      amount: value,
                    }))
                  }
                  disabled={isLoading}
                  className="border-2 border-[#c7dff5] bg-[#ebf4ff] text-lg text-[#0f2f57]"
                  decimalPlaces={2}
                  allowDecimals={true}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Payment Method</label>
                  <select
                    value={form.paymentMethod}
                    onChange={(event) => setForm((current) => ({ ...current, paymentMethod: event.target.value }))}
                    disabled={isLoading}
                    className="w-full rounded-lg border border-gray-100 bg-gray-50 px-6 py-3.5 font-bold outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
                  >
                    <option value="">Select a payment method...</option>
                    {paymentMethods.map((paymentMethod) => (
                      <option key={paymentMethod.id} value={paymentMethod.name}>
                        {paymentMethod.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Expense Category</label>
                  <select
                    value={form.categoryId}
                    onChange={(event) => setForm((current) => ({ ...current, categoryId: event.target.value }))}
                    disabled={isLoading}
                    className="w-full rounded-lg border border-gray-100 bg-gray-50 px-6 py-3.5 font-bold outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
                  >
                    <option value="">Select an expense category...</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Note</label>
                <textarea
                  value={form.note}
                  onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                  disabled={isLoading}
                  placeholder="Add any note about the return expense..."
                  className="min-h-[80px] w-full rounded-lg border border-gray-100 bg-gray-50 px-6 py-4 font-medium outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
                />
              </div>

              {/* Refund section for partially paid orders */}
              {order.paidAmount > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-black text-emerald-700 uppercase tracking-widest">Refund to Customer</p>
                    <span className="text-xs font-bold text-emerald-600">
                      Already paid: {formatCurrency(order.paidAmount)}
                    </span>
                  </div>

                  <div className="space-y-1">
                    <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Refund Amount</label>
                    <NumericInput
                      value={form.refundAmount}
                      onChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          refundAmount: Math.min(value, order.paidAmount),
                        }))
                      }
                      disabled={isLoading}
                      className="border-2 border-emerald-200 bg-white text-lg text-emerald-700"
                      decimalPlaces={2}
                      allowDecimals={true}
                    />
                    <p className="text-[10px] text-gray-500 ml-2">Max refundable: {formatCurrency(order.paidAmount)}</p>
                  </div>

                  {form.refundAmount > 0 && (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Refund Account</label>
                        <select
                          value={form.refundAccountId}
                          onChange={(event) => setForm((current) => ({ ...current, refundAccountId: event.target.value }))}
                          disabled={isLoading}
                          className="w-full rounded-lg border border-gray-100 bg-white px-4 py-3 font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                        >
                          <option value="">Select account...</option>
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name} ({formatCurrency(account.currentBalance)})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Refund Method</label>
                        <select
                          value={form.refundPaymentMethod}
                          onChange={(event) => setForm((current) => ({ ...current, refundPaymentMethod: event.target.value }))}
                          disabled={isLoading}
                          className="w-full rounded-lg border border-gray-100 bg-white px-4 py-3 font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50"
                        >
                          <option value="">Select method...</option>
                          {paymentMethods.map((pm) => (
                            <option key={pm.id} value={pm.name}>{pm.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          <div className="flex gap-4 pt-4">
            <Button onClick={onClose} variant="ghost" disabled={isLoading}>
              Cancel
            </Button>
            <Button
              onClick={onSubmit}
              variant="primary"
              size="md"
              className="flex-1"
              disabled={isLoading}
              loading={isLoading}
            >
              {isReturned ? 'Mark Returned' : 'Mark Delivered'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderCompletionModal;
