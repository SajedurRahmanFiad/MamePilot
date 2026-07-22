import React, { useState, useEffect, useMemo } from 'react';
import { Button, NumericInput } from './index';
import { formatCurrency, ICONS } from '../constants';
import { Bill, ProcessBillReturnPayload } from '../types';
import { useAccounts, usePaymentMethods, useCategories, useSystemDefaults } from '../src/hooks/useQueries';
import { calculateReturnAdjustment } from '../utils';

interface BillReturnModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: ProcessBillReturnPayload) => void | Promise<void>;
  bill: Bill | null;
  isLoading: boolean;
}

interface ItemSelection {
  lineIndex: number;
  productId: string;
  productName: string;
  originalQty: number;
  rate: number;
  returnQty: number;
  selected: boolean;
}

const BillReturnModal: React.FC<BillReturnModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  bill,
  isLoading,
}) => {
  const { data: accounts = [] } = useAccounts();
  const { data: paymentMethods = [] } = usePaymentMethods();
  const { data: categories = [] } = useCategories('Income');
  const { data: systemDefaults } = useSystemDefaults();

  const [itemSelections, setItemSelections] = useState<ItemSelection[]>([]);
  const [refundAmount, setRefundAmount] = useState(0);
  const [recordRefundNow, setRecordRefundNow] = useState(true);
  const [accountId, setAccountId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!isOpen || !bill) return;

    const selections: ItemSelection[] = bill.items.map((item, lineIndex) => ({
      lineIndex,
      productId: item.productId,
      productName: item.productName,
      originalQty: Math.max(0, item.quantity - (item.returnedQty ?? 0)),
      rate: item.rate,
      returnQty: 0,
      selected: false,
    }));
    setItemSelections(selections);
    setRefundAmount(0);
    setRecordRefundNow(true);
    setNote('');

    const fallbackAccountId = systemDefaults?.defaultAccountId || accounts[0]?.id || '';
    const fallbackPaymentMethod = systemDefaults?.defaultPaymentMethod || paymentMethods[0]?.name || '';
    setAccountId(fallbackAccountId);
    setPaymentMethod(fallbackPaymentMethod);
    setCategoryId(categories[0]?.id || '');
  }, [isOpen, bill, accounts, paymentMethods, categories, systemDefaults]);

  // Auto-calculate refund
  useEffect(() => {
    const returnValue = itemSelections.reduce((sum, sel) => {
      if (sel.selected && sel.returnQty > 0) {
        return sum + sel.rate * sel.returnQty;
      }
      return sum;
    }, 0);
    if (!bill) {
      setRefundAmount(0);
      return;
    }
    setRefundAmount(calculateReturnAdjustment({
      subtotal: bill.subtotal,
      discount: bill.discount,
      shipping: bill.shipping,
      paidAmount: bill.paidAmount,
      returnValue,
    }).maxRefund);
  }, [itemSelections, bill]);

  const toggleItem = (idx: number) => {
    setItemSelections((prev) => {
      const next = [...prev];
      const sel = next[idx];
      if (sel.originalQty <= 0) return prev;
      next[idx] = {
        ...sel,
        selected: !sel.selected,
        returnQty: !sel.selected ? sel.originalQty : 0,
      };
      return next;
    });
  };

  const setReturnQty = (idx: number, qty: number) => {
    setItemSelections((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], returnQty: Math.min(Math.max(0, qty), next[idx].originalQty) };
      return next;
    });
  };

  const selectedItems = useMemo(
    () => itemSelections.filter((s) => s.selected && s.returnQty > 0),
    [itemSelections]
  );

  const returnValue = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.rate * item.returnQty, 0),
    [selectedItems]
  );
  const adjustment = useMemo(() => bill ? calculateReturnAdjustment({
    subtotal: bill.subtotal,
    discount: bill.discount,
    shipping: bill.shipping,
    paidAmount: bill.paidAmount,
    returnValue,
  }) : null, [bill, returnValue]);
  const effectiveRefund = recordRefundNow ? Math.min(refundAmount, adjustment?.maxRefund ?? 0) : 0;
  const canSubmit = selectedItems.length > 0
    && (effectiveRefund <= 0 || (accountId !== '' && paymentMethod !== ''));

  const handleSubmit = async () => {
    if (!bill) return;

    const payload: ProcessBillReturnPayload = {
      billId: bill.id,
      items: selectedItems.map((s) => ({
        lineIndex: s.lineIndex,
        productId: s.productId,
        productName: s.productName,
        originalQty: s.originalQty,
        returnQty: s.returnQty,
        rate: s.rate,
        amount: s.rate * s.returnQty,
      })),
      refundAmount: effectiveRefund,
      accountId,
      paymentMethod,
      categoryId,
      note,
      date: new Date().toISOString(),
    };

    await onSubmit(payload);
  };

  if (!isOpen || !bill) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-[210] w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-[#ebf4ff] bg-white p-8 animate-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-6 top-6 rounded-full border border-gray-200 bg-white p-2 text-gray-500 transition hover:border-gray-300 hover:text-gray-900"
          aria-label="Close"
        >
          ×
        </button>

        <div className="mb-6">
          <h3 className="text-2xl font-black text-gray-900">Return to Vendor</h3>
          <p className="mt-1 text-sm text-gray-500 font-medium">
            Bill #{bill.billNumber} · {formatCurrency(bill.total)}
          </p>
        </div>

        {/* Item Selection */}
        <div className="space-y-3 mb-6">
          <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Select items to return</p>
          {bill.items.map((item, idx) => {
            const sel = itemSelections[idx];
            if (!sel) return null;
            return (
              <div
                key={item.productId + idx}
                className={`flex items-center gap-4 p-4 rounded-xl border transition ${sel.originalQty > 0 ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'} ${
                  sel.selected
                    ? 'border-orange-300 bg-orange-50'
                    : 'border-gray-100 bg-gray-50 hover:border-gray-200'
                }`}
                onClick={() => toggleItem(idx)}
              >
                <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition ${
                  sel.selected ? 'border-orange-500 bg-orange-500' : 'border-gray-300'
                }`}>
                  {sel.selected && <span className="text-white text-xs">✓</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-gray-900 text-sm">{item.productName}</p>
                  <p className="text-xs text-gray-500">
                    {formatCurrency(item.rate)} × {sel.originalQty} available to return
                  </p>
                </div>
                {sel.selected && (
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <label className="text-[10px] font-black text-gray-400 uppercase">Qty:</label>
                    <NumericInput
                      value={sel.returnQty}
                      onChange={(val) => setReturnQty(idx, val)}
                      disabled={isLoading}
                      className="w-20 bg-white border-gray-200 text-sm"
                      decimalPlaces={0}
                    />
                  </div>
                )}
                {sel.selected && (
                  <span className="font-black text-orange-600 text-sm whitespace-nowrap">
                    {formatCurrency(sel.rate * sel.returnQty)}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Refund Summary */}
        {selectedItems.length > 0 && adjustment && (
          <div className="bg-gray-50 rounded-xl p-4 mb-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="font-bold text-gray-600">Returned item value</span>
              <span className="font-black text-gray-900">{formatCurrency(returnValue)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-bold text-gray-600">Adjusted bill total</span>
              <span className="font-black text-gray-900">{formatCurrency(adjustment.newTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="font-bold text-emerald-600">Refund due from vendor</span>
              <span className="font-black text-emerald-600">{formatCurrency(adjustment.maxRefund)}</span>
            </div>
            {adjustment.maxRefund === 0 && (
              <p className="text-xs text-gray-500">No cash refund is due because the adjusted bill is not overpaid.</p>
            )}
          </div>
        )}

        {selectedItems.length > 0 && adjustment && adjustment.maxRefund > 0 && (
          <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm">
            <input
              type="checkbox"
              checked={recordRefundNow}
              onChange={(event) => setRecordRefundNow(event.target.checked)}
              disabled={isLoading}
              className="mt-0.5 h-4 w-4 rounded border-blue-300 text-blue-600 focus:ring-blue-500"
            />
            <span>
              <span className="block font-bold text-blue-900">Record the vendor refund now</span>
              <span className="mt-0.5 block text-xs text-blue-700">
                Turn this off if the items are returned now and the vendor will refund the money later.
              </span>
            </span>
          </label>
        )}

        {/* Payment */}
        {effectiveRefund > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="space-y-1">
              <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Refund into Account</label>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                disabled={isLoading}
                className="w-full rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 font-bold text-sm outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
              >
                <option value="">Select account...</option>
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>{acc.name} ({formatCurrency(acc.currentBalance)})</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Payment Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                disabled={isLoading}
                className="w-full rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 font-bold text-sm outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
              >
                <option value="">Select method...</option>
                {paymentMethods.map((pm) => (
                  <option key={pm.id} value={pm.name}>{pm.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Note */}
        <div className="space-y-1 mb-6">
          <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Note (optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isLoading}
            placeholder="Add any note about this return..."
            className="min-h-[80px] w-full rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 font-medium text-sm outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-4">
          <Button onClick={onClose} variant="ghost" disabled={isLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            variant="primary"
            size="md"
            className="flex-1"
            disabled={isLoading || !canSubmit}
            loading={isLoading}
          >
            Process Return
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BillReturnModal;
