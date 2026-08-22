import React, { useState, useEffect, useMemo } from 'react';
import { Button } from './Button';
import { NumericInput } from './Input';
import { formatCurrency } from '../constants';
import { Order, ConfirmPartialDeliveryPayload } from '../types';
import { useAccounts, usePaymentMethods, useSystemDefaults } from '../src/hooks/useQueries';

interface PartialDeliveryFormProps {
  order: Order | null;
  isActive: boolean;
  isLoading: boolean;
  onSubmit: (payload: ConfirmPartialDeliveryPayload) => void | Promise<void>;
  onCancel: () => void;
}

interface ItemSelection {
  lineIndex: number;
  productId: string;
  productName: string;
  originalQty: number;
  originalRate: number;
  returnQty: number;
}

const PartialDeliveryForm: React.FC<PartialDeliveryFormProps> = ({
  order,
  isActive,
  isLoading,
  onSubmit,
  onCancel,
}) => {
  const { data: accounts = [] } = useAccounts();
  const { data: paymentMethods = [] } = usePaymentMethods();
  const { data: systemDefaults } = useSystemDefaults();

  const [itemSelections, setItemSelections] = useState<ItemSelection[]>([]);
  const [accountId, setAccountId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [note, setNote] = useState('');
  const [receivedAmount, setReceivedAmount] = useState(0);

  useEffect(() => {
    if (!isActive || !order) return;

    const selections: ItemSelection[] = order.items
      .map((item, lineIndex) => ({ item, lineIndex }))
      .map(({ item, lineIndex }) => ({
        lineIndex,
        productId: item.productId,
        productName: item.productName,
        originalQty: item.quantity,
        originalRate: item.rate,
        returnQty: 0,
      }));

    setItemSelections(selections);
    setNote('');
    setReceivedAmount(order.partialCodAmount ?? 0);

    const fallbackAccountId = systemDefaults?.defaultAccountId || accounts[0]?.id || '';
    const fallbackPaymentMethod = systemDefaults?.defaultPaymentMethod || paymentMethods[0]?.name || '';
    setAccountId(fallbackAccountId);
    setPaymentMethod(fallbackPaymentMethod);
  }, [isActive, order, accounts, paymentMethods, systemDefaults]);

  const setItemReturnQty = (idx: number, qty: number) => {
    setItemSelections((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], returnQty: Math.min(Math.max(0, qty), next[idx].originalQty) };
      return next;
    });
  };

  const toggleItemReturn = (idx: number) => {
    setItemSelections((prev) => {
      const next = [...prev];
      const sel = next[idx];
      if (sel.returnQty > 0) {
        next[idx] = { ...sel, returnQty: 0 };
      } else {
        next[idx] = { ...sel, returnQty: sel.originalQty };
      }
      return next;
    });
  };

  const selectedItems = useMemo(
    () => itemSelections.filter((s) => s.returnQty > 0),
    [itemSelections]
  );

  const returnedValue = useMemo(
    () => selectedItems.reduce((sum, s) => sum + s.originalRate * s.returnQty, 0),
    [selectedItems]
  );

  const totalOrderValue = useMemo(
    () => order?.items.reduce((sum, item) => sum + item.rate * item.quantity, 0) ?? 0,
    [order]
  );

  const deliveredValue = totalOrderValue - returnedValue;

  const canSubmit = useMemo(() => {
    if (!accountId || !paymentMethod) return false;
    return true;
  }, [accountId, paymentMethod]);

  const handleSubmit = async () => {
    if (!order) return;

    const payload: ConfirmPartialDeliveryPayload = {
      orderId: order.id,
      returnedItems: selectedItems.map((s) => ({
        productId: s.productId,
        returnQty: s.returnQty,
      })),
      accountId,
      paymentMethod,
      note,
      date: new Date().toISOString(),
      receivedAmount,
    };

    await onSubmit(payload);
  };

  if (!isActive || !order) return null;

  return (
    <div className="space-y-6">
      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
        Select which items were returned. COGS, shipping, and COD will be calculated for delivered items only.
      </p>

      {/* Deferred amounts summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">COGS (Total)</p>
          <p className="text-sm font-black text-gray-900">{formatCurrency(order.partialCogsAmount || 0)}</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Shipping</p>
          <p className="text-sm font-black text-gray-900">{formatCurrency(order.partialShippingAmount || 0)}</p>
        </div>
        <div className="bg-gray-50 rounded-xl p-3 text-center">
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">COD Collected</p>
          <p className="text-sm font-black text-gray-900">{formatCurrency(order.partialCodAmount || 0)}</p>
        </div>
      </div>

      {/* Item selection */}
      <div className="space-y-3">
        <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Select items to mark as returned</p>
        {itemSelections.map((sel, idx) => {
          const isSelected = sel.returnQty > 0;
          return (
            <div
              key={sel.productId + idx}
              className={`flex items-center gap-4 p-4 rounded-xl border transition cursor-pointer ${
                isSelected
                  ? 'border-orange-300 bg-orange-50'
                  : 'border-gray-100 bg-gray-50 hover:border-gray-200'
              }`}
              onClick={() => toggleItemReturn(idx)}
            >
              <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition ${
                isSelected ? 'border-orange-500 bg-orange-500' : 'border-gray-300'
              }`}>
                {isSelected && <span className="text-white text-xs">✓</span>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-900 text-sm">{sel.productName}</p>
                <p className="text-xs text-gray-500">
                  {formatCurrency(sel.originalRate)} x {sel.originalQty} = {formatCurrency(sel.originalRate * sel.originalQty)}
                </p>
              </div>
              {isSelected && (
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <label className="text-[10px] font-black text-gray-400 uppercase">Qty:</label>
                  <NumericInput
                    value={sel.returnQty}
                    onChange={(val) => setItemReturnQty(idx, val)}
                    disabled={isLoading}
                    className="w-20 bg-white border-gray-200 text-sm"
                    decimalPlaces={0}
                    max={sel.originalQty}
                    helperText={`Max: ${sel.originalQty}`}
                  />
                </div>
              )}
              {isSelected && (
                <span className="font-black text-orange-600 text-sm whitespace-nowrap">
                  {formatCurrency(sel.originalRate * sel.returnQty)}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Financial summary */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span className="font-bold text-gray-600">Delivered item value</span>
          <span className="font-black text-emerald-600">{formatCurrency(deliveredValue)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="font-bold text-gray-600">Returned item value</span>
          <span className="font-black text-orange-600">{formatCurrency(returnedValue)}</span>
        </div>
      </div>

      {/* Received amount */}
      <div className="space-y-1">
        <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Received Amount (COD)</label>
        <input
          type="number"
          value={receivedAmount || ''}
          onChange={(e) => setReceivedAmount(parseFloat(e.target.value) || 0)}
          disabled={isLoading}
          placeholder="Amount received from courier"
          className="w-full rounded-lg border border-gray-100 bg-white px-3 py-2.5 font-bold text-sm outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
        />
        {order.partialCodAmount != null && order.partialCodAmount > 0 && (
          <p className="text-[10px] text-gray-400">Courier reported: {formatCurrency(order.partialCodAmount)}</p>
        )}
      </div>

      {/* Account selection */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Account</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={isLoading}
              className="w-full rounded-lg border border-gray-100 bg-white px-3 py-2.5 font-bold text-sm outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
            >
              <option value="">Select account...</option>
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>{acc.name} ({formatCurrency(acc.currentBalance)})</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Payment Method</label>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              disabled={isLoading}
              className="w-full rounded-lg border border-gray-100 bg-white px-3 py-2.5 font-bold text-sm outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
            >
              <option value="">Select method...</option>
              {paymentMethods.map((pm) => (
                <option key={pm.id} value={pm.name}>{pm.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Note (optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isLoading}
            placeholder="Add a note about this partial delivery confirmation..."
            className="w-full rounded-lg border border-gray-100 bg-white px-3 py-2.5 font-bold text-sm outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50 resize-none"
            rows={2}
          />
        </div>
      </div>

      {/* Submit */}
      <div className="flex gap-4 pt-4">
        <Button
          onClick={onCancel}
          variant="ghost"
          disabled={isLoading}
        >
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
          {isLoading ? 'Confirming...' : 'Mark Partially Delivered'}
        </Button>
      </div>
    </div>
  );
};

export default PartialDeliveryForm;