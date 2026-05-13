import React, { useEffect, useMemo } from 'react';
import { Button } from './index';
import { formatCurrency } from '../constants';
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
      if (!availableOutcomes.includes(next.outcome)) {
        next.outcome = availableOutcomes[0] || 'Delivered';
      }

      // If Returned is selected, automatically set category to 'Shipping Costs'
      if (next.outcome === 'Returned' && shippingCostsCategory) {
        next.categoryId = shippingCostsCategory.id;
      }

      if (
        next.outcome === current.outcome &&
        next.accountId === current.accountId &&
        next.paymentMethod === current.paymentMethod &&
        next.categoryId === current.categoryId
      ) {
        return current;
      }

      return next;
    });
  }, [isOpen, accounts, paymentMethods, categories, shippingCostsCategory, systemDefaults, setForm, availableOutcomes]);

  // Handle outcome changes - automatically set category for Returned orders
  useEffect(() => {
    if (!availableOutcomes.includes(form.outcome)) {
      setForm((current) => ({ ...current, outcome: availableOutcomes[0] || 'Delivered' }));
      return;
    }

    if (form.outcome === 'Returned' && shippingCostsCategory && form.categoryId !== shippingCostsCategory.id) {
      setForm((current) => ({ ...current, categoryId: shippingCostsCategory.id }));
    }
  }, [form.outcome, shippingCostsCategory, form.categoryId, setForm, availableOutcomes]);

  if (!isOpen || !order || availableOutcomes.length === 0) return null;

  const isReturned = form.outcome === 'Returned';
  const outstanding = Math.max(order.total - order.paidAmount, 0);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative z-[210] w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-[2.5rem] border border-[#ebf4ff] bg-white p-10 animate-in zoom-in-95 duration-200">
        <div className="mb-8">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Picked Order</p>
          <h3 className="mt-2 text-2xl font-black text-gray-900">Finalize Order #{order.orderNumber}</h3>
          <p className="mt-2 text-sm font-medium text-gray-500">
            Outstanding amount {formatCurrency(outstanding)}
          </p>
        </div>

        <div className="space-y-6">
          <div className="space-y-1">
            <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Outcome</label>
            <select
              value={form.outcome}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  outcome: event.target.value as OrderCompletionOutcome,
                }))
              }
              disabled={isLoading}
              className="w-full rounded-lg border border-gray-100 bg-gray-50 px-6 py-3.5 font-bold outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
            >
              {availableOutcomes.includes('Delivered') && <option value="Delivered">Delivered</option>}
              {availableOutcomes.includes('Returned') && <option value="Returned">Returned</option>}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))}
                disabled={isLoading}
                className="w-full rounded-lg border border-gray-100 bg-gray-50 px-6 py-3.5 font-bold outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
              />
            </div>
            <div className="space-y-1">
              <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Time</label>
              <input
                type="time"
                value={form.time}
                onChange={(event) => setForm((current) => ({ ...current, time: event.target.value }))}
                disabled={isLoading}
                className="w-full rounded-lg border border-gray-100 bg-gray-50 px-6 py-3.5 font-bold outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
              {isReturned ? 'Expense From Account' : 'Receive To Account'}
            </label>
            <select
              value={form.accountId}
              onChange={(event) => setForm((current) => ({ ...current, accountId: event.target.value }))}
              disabled={isLoading}
              className="w-full rounded-lg border border-gray-100 bg-gray-50 px-6 py-3.5 font-bold outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
            >
              <option value="">Select an account...</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name} ({formatCurrency(account.currentBalance)})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">
              {isReturned ? 'Return Expense Amount' : 'Amount Received'}
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amount}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  amount: Number.parseFloat(event.target.value || '0') || 0,
                }))
              }
              disabled={isLoading}
              className="w-full rounded-lg border-2 border-[#c7dff5] bg-[#ebf4ff] px-6 py-4 text-lg font-black text-[#0f2f57] outline-none disabled:opacity-50"
            />
            {!isReturned && (
              <p className="ml-2 text-xs font-medium text-gray-400">
                If this is lower than the due amount, the remaining balance will be recorded as an expense.
              </p>
            )}
          </div>

          {isReturned && (
            <>
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
                    disabled={isLoading || !!shippingCostsCategory}
                    className="w-full rounded-lg border border-gray-100 bg-gray-50 px-6 py-3.5 font-bold outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
                  >
                    <option value="">Select an expense category...</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                  {shippingCostsCategory && (
                    <p className="ml-2 text-xs font-medium text-gray-400">
                      Returned orders use the Shipping Costs category automatically.
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Note</label>
                <textarea
                  value={form.note}
                  onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                  disabled={isLoading}
                  placeholder="Add any note about the return expense..."
                  className="min-h-[120px] w-full rounded-lg border border-gray-100 bg-gray-50 px-6 py-4 font-medium outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
                />
              </div>
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
