import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Button, NumericInput } from './index';
import { formatCurrency, ICONS } from '../constants';
import { theme } from '../theme';
import { Order, OrderItem, ReturnExchangeAction, ReturnExchangeItemSelection, ProcessOrderReturnExchangePayload, Product } from '../types';
import { useAccounts, usePaymentMethods, useSystemDefaults } from '../src/hooks/useQueries';
import { fetchProductsSearch } from '../src/services/supabaseQueries';

interface OrderReturnExchangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: ProcessOrderReturnExchangePayload) => void | Promise<void>;
  order: Order | null;
  isLoading: boolean;
}

type TabKey = 'partialReturn' | 'exchange';

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'partialReturn', label: 'Partial Return', icon: ICONS.Return },
  { key: 'exchange', label: 'Exchange', icon: ICONS.Transfer },
];

const OrderReturnExchangeModal: React.FC<OrderReturnExchangeModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  order,
  isLoading,
}) => {
  const { data: accounts = [] } = useAccounts();
  const { data: paymentMethods = [] } = usePaymentMethods();
  const { data: systemDefaults } = useSystemDefaults();

  const [activeTab, setActiveTab] = useState<TabKey>('partialReturn');
  const [itemSelections, setItemSelections] = useState<ReturnExchangeItemSelection[]>([]);
  const [refundAmount, setRefundAmount] = useState(0);
  const [extraCollectionAmount, setExtraCollectionAmount] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [note, setNote] = useState('');

  // Product search for exchange replacements
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [activeExchangeItemIdx, setActiveExchangeItemIdx] = useState<number | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset item selections when switching tabs so financial impact doesn't carry over
  useEffect(() => {
    if (!order || !isOpen) return;
    setItemSelections((prev) =>
      prev.map((sel) => ({
        ...sel,
        action: 'keep' as const,
        returnQty: 0,
        replacementItems: [],
      }))
    );
    setActiveExchangeItemIdx(null);
    setSearchQuery('');
    setSearchResults([]);
  }, [activeTab, isOpen]);

  // Initialize selections when order changes
  useEffect(() => {
    if (!isOpen || !order) return;

    // Only include items the customer currently has (exclude fully returned/exchanged items)
    const selections: ReturnExchangeItemSelection[] = order.items
      .filter((item) => {
        const returnedQty = item.returnedQty ?? 0;
        const exchangedQty = item.exchangedQty ?? 0;
        return (item.quantity - returnedQty - exchangedQty) > 0;
      })
      .map((item) => {
        const returnedQty = item.returnedQty ?? 0;
        const exchangedQty = item.exchangedQty ?? 0;
        const activeQty = item.quantity - returnedQty - exchangedQty;
        return {
          productId: item.productId,
          productName: item.productName,
          originalQty: activeQty,
          originalRate: item.rate,
          action: 'keep' as const,
          returnQty: 0,
          replacementItems: [],
        };
      });
    setItemSelections(selections);
    setActiveTab('partialReturn');
    setRefundAmount(0);
    setExtraCollectionAmount(0);
    setNote('');
    setSearchQuery('');
    setSearchResults([]);
    setActiveExchangeItemIdx(null);

    // Set defaults
    const fallbackAccountId = systemDefaults?.defaultAccountId || accounts[0]?.id || '';
    const fallbackPaymentMethod = systemDefaults?.defaultPaymentMethod || paymentMethods[0]?.name || '';
    setAccountId(fallbackAccountId);
    setPaymentMethod(fallbackPaymentMethod);
  }, [isOpen, order, accounts, paymentMethods, systemDefaults]);

  // Auto-calculate refund/collection amounts with proportional discount
  useEffect(() => {
    if (!order) return;

    const returnValue = itemSelections.reduce((sum, sel) => {
      if (sel.action !== 'keep' && sel.returnQty > 0) {
        return sum + sel.originalRate * sel.returnQty;
      }
      return sum;
    }, 0);

    const replacementValue = itemSelections.reduce((sum, sel) => {
      if (sel.replacementItems) {
        return sum + sel.replacementItems.reduce((s, r) => s + r.amount, 0);
      }
      return sum;
    }, 0);

    // Proportional discount
    const originalSubtotal = order.subtotal;
    const keptValue = originalSubtotal - returnValue + replacementValue;
    const discountRatio = originalSubtotal > 0 ? (keptValue / originalSubtotal) : 1;
    const newDiscount = Math.round(order.discount * discountRatio * 100) / 100;
    const newTotal = keptValue - newDiscount + order.shipping;

    // Refund only if customer has paid and is overpaid
    const overpaid = Math.max(0, order.paidAmount - newTotal);
    const stillOwed = Math.max(0, newTotal - order.paidAmount);

    setRefundAmount(overpaid);
    setExtraCollectionAmount(stillOwed);
  }, [itemSelections, activeTab, order]);

  // Product search debounce — fetches suggestions when opened, and on typing
  const handleProductSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await fetchProductsSearch(query.trim() || '', 20);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, query.trim().length === 0 ? 0 : 300);
  }, []);

  // Fetch initial suggestions when a search box opens
  useEffect(() => {
    if (activeExchangeItemIdx !== null && searchResults.length === 0 && !isSearching) {
      handleProductSearch('');
    }
  }, [activeExchangeItemIdx]);

  const toggleItemReturn = (idx: number) => {
    setItemSelections((prev) => {
      const next = [...prev];
      const sel = next[idx];
      if (sel.action === 'keep') {
        next[idx] = { ...sel, action: activeTab === 'exchange' ? 'exchange' : 'return', returnQty: sel.originalQty };
      } else {
        next[idx] = { ...sel, action: 'keep', returnQty: 0, replacementItems: [] };
      }
      return next;
    });
  };

  const setItemReturnQty = (idx: number, qty: number) => {
    setItemSelections((prev) => {
      const next = [...prev];
      const sel = next[idx];
      next[idx] = { ...sel, returnQty: Math.min(Math.max(0, qty), sel.originalQty) };
      return next;
    });
  };

  const addReplacementItem = (idx: number, product: Product) => {
    setItemSelections((prev) => {
      const next = [...prev];
      const sel = next[idx];
      const existing = sel.replacementItems || [];
      // Check if already added
      const existingIdx = existing.findIndex((r) => r.productId === product.id);
      if (existingIdx >= 0) {
        const updated = [...existing];
        updated[existingIdx] = {
          ...updated[existingIdx],
          quantity: updated[existingIdx].quantity + 1,
          amount: updated[existingIdx].rate * (updated[existingIdx].quantity + 1),
        };
        next[idx] = { ...sel, replacementItems: updated };
      } else {
        next[idx] = {
          ...sel,
          replacementItems: [
            ...existing,
            {
              productId: product.id,
              productName: product.name,
              quantity: 1,
              rate: product.salePrice,
              amount: product.salePrice,
            },
          ],
        };
      }
      return next;
    });
    setSearchQuery('');
    setSearchResults([]);
    setActiveExchangeItemIdx(null);
  };

  const removeReplacementItem = (itemIdx: number, repIdx: number) => {
    setItemSelections((prev) => {
      const next = [...prev];
      const sel = next[itemIdx];
      next[itemIdx] = {
        ...sel,
        replacementItems: (sel.replacementItems || []).filter((_, i) => i !== repIdx),
      };
      return next;
    });
  };

  const updateReplacementQty = (itemIdx: number, repIdx: number, qty: number) => {
    setItemSelections((prev) => {
      const next = [...prev];
      const sel = next[itemIdx];
      const reps = [...(sel.replacementItems || [])];
      reps[repIdx] = {
        ...reps[repIdx],
        quantity: Math.max(1, qty),
        amount: reps[repIdx].rate * Math.max(1, qty),
      };
      next[itemIdx] = { ...sel, replacementItems: reps };
      return next;
    });
  };

  const selectedItems = useMemo(
    () => itemSelections.filter((s) => s.action !== 'keep' && s.returnQty > 0),
    [itemSelections]
  );

  const returnValue = useMemo(
    () => selectedItems.reduce((sum, s) => sum + s.originalRate * s.returnQty, 0),
    [selectedItems]
  );

  const replacementValue = useMemo(
    () =>
      itemSelections.reduce(
        (sum, s) => sum + (s.replacementItems || []).reduce((s2, r) => s2 + r.amount, 0),
        0
      ),
    [itemSelections]
  );

  // Compute the actual refund/collection amounts that respect paidAmount
  const computedRefund = useMemo(() => {
    if (!order || order.paidAmount <= 0 || refundAmount <= 0) return 0;
    const originalSubtotal = order.subtotal;
    const keptValue = originalSubtotal - returnValue + replacementValue;
    const discountRatio = originalSubtotal > 0 ? (keptValue / originalSubtotal) : 1;
    const newDiscount = Math.round(order.discount * discountRatio * 100) / 100;
    const newTotal = keptValue - newDiscount + order.shipping;
    const overpaid = Math.max(0, order.paidAmount - newTotal);
    return Math.min(refundAmount, overpaid);
  }, [order, refundAmount, returnValue, replacementValue]);

  const computedCollection = useMemo(() => {
    if (!order || extraCollectionAmount <= 0) return 0;
    const originalSubtotal = order.subtotal;
    const keptValue = originalSubtotal - returnValue + replacementValue;
    const discountRatio = originalSubtotal > 0 ? (keptValue / originalSubtotal) : 1;
    const newDiscount = Math.round(order.discount * discountRatio * 100) / 100;
    const newTotal = keptValue - newDiscount + order.shipping;
    const stillOwed = Math.max(0, newTotal - order.paidAmount);
    return Math.min(extraCollectionAmount, stillOwed);
  }, [order, extraCollectionAmount, returnValue, replacementValue]);

  const canSubmit = useMemo(() => {
    if (selectedItems.length === 0) return false;
    if (activeTab === 'exchange') {
      const hasReplacements = itemSelections.some(
        (s) => s.action === 'exchange' && (s.replacementItems || []).length > 0
      );
      if (!hasReplacements) return false;
    }
    if (computedRefund > 0 && accountId === '') return false;
    if (computedCollection > 0 && accountId === '') return false;
    return true;
  }, [activeTab, selectedItems, computedRefund, computedCollection, accountId, itemSelections]);

  const handleSubmit = async () => {
    if (!order) return;

    const payload: ProcessOrderReturnExchangePayload = {
      orderId: order.id,
      returnAction: activeTab,
      items: itemSelections.filter((s) => s.action !== 'keep' && s.returnQty > 0),
      refundAmount: computedRefund,
      extraCollectionAmount: computedCollection,
      accountId,
      paymentMethod,
      note,
      date: new Date().toISOString(),
    };

    await onSubmit(payload);
  };

  if (!isOpen || !order) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-[210] w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl border border-[#ebf4ff] bg-white p-8 animate-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-6 top-6 rounded-full border border-gray-200 bg-white p-2 text-gray-500 transition hover:border-gray-300 hover:text-gray-900"
          aria-label="Close"
        >
          ×
        </button>

        <div className="mb-6">
          <h3 className="text-2xl font-black text-gray-900">Return / Exchange</h3>
          <p className="mt-1 text-sm text-gray-500 font-medium">
            Order #{order.orderNumber} · {formatCurrency(order.total)}
          </p>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-sm font-bold transition ${
                activeTab === tab.key
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Partial Return Tab */}
        {activeTab === 'partialReturn' && (
          <div className="space-y-3">
            <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Select items to return</p>
            {itemSelections.map((sel, idx) => {
              const isSelected = sel.action === 'return' && sel.returnQty > 0;
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
                      {formatCurrency(sel.originalRate)} × {sel.originalQty} = {formatCurrency(sel.originalRate * sel.originalQty)}
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
        )}

        {/* Exchange Tab */}
        {activeTab === 'exchange' && (
          <div className="space-y-4">
            <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Select items to exchange</p>
            {itemSelections.map((sel, idx) => {
              const isSelected = sel.action === 'exchange' && sel.returnQty > 0;
              return (
                <div
                  key={sel.productId + idx}
                  className={`p-4 rounded-xl border transition ${
                    isSelected
                      ? 'border-blue-300 bg-blue-50'
                      : 'border-gray-100 bg-gray-50 hover:border-gray-200'
                  }`}
                >
                  <div
                    className="flex items-center gap-4 cursor-pointer"
                    onClick={() => toggleItemReturn(idx)}
                  >
                    <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition ${
                      isSelected ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                    }`}>
                      {isSelected && <span className="text-white text-xs">✓</span>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-gray-900 text-sm">{sel.productName}</p>
                      <p className="text-xs text-gray-500">
                        {formatCurrency(sel.originalRate)} × {sel.originalQty}
                      </p>
                    </div>
                    {isSelected && (
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <label className="text-[10px] font-black text-gray-400 uppercase">Return qty:</label>
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
                      <span className="font-black text-blue-600 text-sm whitespace-nowrap">
                        {formatCurrency(sel.originalRate * sel.returnQty)}
                      </span>
                    )}
                  </div>

                  {/* Replacement items */}
                  {isSelected && (
                    <div className="mt-3 pl-9 space-y-2">
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Replacing with ↓</p>
                      {(sel.replacementItems || []).map((rep, repIdx) => (
                        <div key={rep.productId + repIdx} className="flex items-center gap-3 bg-white rounded-lg border border-gray-200 p-3">
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-900 text-sm">{rep.productName}</p>
                            <p className="text-xs text-gray-500">{formatCurrency(rep.rate)} each</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase">Qty:</label>
                            <NumericInput
                              value={rep.quantity}
                              onChange={(val) => updateReplacementQty(idx, repIdx, val)}
                              disabled={isLoading}
                              className="w-16 bg-gray-50 border-gray-200 text-sm"
                              decimalPlaces={0}
                            />
                          </div>
                          <span className="font-bold text-gray-900 text-sm">{formatCurrency(rep.amount)}</span>
                          <button
                            type="button"
                            onClick={() => removeReplacementItem(idx, repIdx)}
                            className="p-1 text-red-400 hover:text-red-600 transition"
                          >
                            {ICONS.Close}
                          </button>
                        </div>
                      ))}

                      {/* Add replacement product */}
                      {activeExchangeItemIdx === idx ? (
                        <div className="relative">
                          <div className="relative">
                            <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-300">
                              {ICONS.Search}
                            </div>
                            <input
                              type="text"
                              value={searchQuery}
                              onChange={(e) => handleProductSearch(e.target.value)}
                              placeholder="Search catalog..."
                              className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#3c5a82] text-sm font-medium"
                              autoFocus
                            />
                          </div>
                          <div className="w-full max-w-md bg-white border border-gray-200 shadow-2xl rounded-lg z-10 p-2 overflow-hidden mt-1">
                            <div className="max-h-[220px] overflow-y-auto space-y-0.5 custom-scrollbar">
                              {searchResults.length === 0 && isSearching ? (
                                <div className="p-4 space-y-3">
                                  <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                                  <div className="h-10 bg-gray-100 rounded-xl animate-pulse w-full"></div>
                                </div>
                              ) : searchResults.length === 0 ? (
                                <div className="p-4 text-center text-gray-400 text-sm font-medium">No products found</div>
                              ) : (
                                searchResults.map((product) => (
                                  <button
                                    key={product.id}
                                    type="button"
                                    onClick={() => addReplacementItem(idx, product)}
                                    className="flex items-center gap-4 w-full px-4 py-3 text-left hover:bg-[#ebf4ff] rounded-xl group transition-all"
                                  >
                                    {product.image && (
                                      <img src={product.image} className="w-10 h-10 rounded-full object-cover border border-gray-100 shadow-sm" />
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-bold text-gray-800 group-hover:text-[#0f2f57] truncate">{product.name}</p>
                                      <p className="text-[10px] font-bold text-[#3c5a82]/60 uppercase tracking-widest">{formatCurrency(product.salePrice)}</p>
                                      <p className={`text-[10px] font-bold uppercase tracking-widest ${product.stock <= 0 ? 'text-red-500' : 'text-gray-400'}`}>Stock: {product.stock ?? 0}</p>
                                    </div>
                                  </button>
                                ))
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setActiveExchangeItemIdx(null); setSearchQuery(''); setSearchResults([]); }}
                            className="mt-1 text-xs text-gray-500 hover:text-gray-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setActiveExchangeItemIdx(idx)}
                          className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 transition"
                        >
                          {ICONS.Plus} Add replacement product
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Summary & Payment Section */}
        {selectedItems.length > 0 && (() => {
          // Calculate proportional discount
          const originalSubtotal = order.subtotal;
          const keptValue = originalSubtotal - returnValue + replacementValue;
          const discountRatio = originalSubtotal > 0 ? (keptValue / originalSubtotal) : 1;
          const newDiscount = Math.round(order.discount * discountRatio * 100) / 100;
          const discountSaved = order.discount - newDiscount;
          const newTotal = keptValue - newDiscount + order.shipping;

          return (
            <div className="mt-6 bg-gray-50 rounded-xl p-4 space-y-3">
              <p className="text-xs font-black text-gray-400 uppercase tracking-widest">Financial Impact</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Original total</span>
                  <span className="font-bold">{formatCurrency(order.total)}</span>
                </div>
                {returnValue > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Return value</span>
                    <span className="font-bold text-red-600">-{formatCurrency(returnValue)}</span>
                  </div>
                )}
                {replacementValue > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Replacement value</span>
                    <span className="font-bold text-emerald-600">+{formatCurrency(replacementValue)}</span>
                  </div>
                )}
                {discountSaved > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Discount adjusted</span>
                    <span className="font-bold text-orange-600">-{formatCurrency(discountSaved)}</span>
                  </div>
                )}
                <div className="border-t border-gray-200 pt-2 flex justify-between">
                  <span className="font-black">New order total</span>
                  <span className="font-black">{formatCurrency(newTotal)}</span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>Already paid</span>
                  <span>{formatCurrency(order.paidAmount)}</span>
                </div>
              </div>

              {/* Refund — only if customer has actually paid and is owed money */}
              {computedRefund > 0 && (
                <div className="border-t border-gray-200 pt-2 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="font-bold text-orange-600">Refund to customer</span>
                    <span className="font-black text-orange-600">{formatCurrency(computedRefund)}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Refund Account</label>
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
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Refund Method</label>
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
                </div>
              )}

              {/* Collection — only if customer owes more */}
              {computedCollection > 0 && (
                <div className="border-t border-gray-200 pt-2 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="font-bold text-emerald-600">Customer pays extra</span>
                    <span className="font-black text-emerald-600">{formatCurrency(computedCollection)}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Collect into Account</label>
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
                </div>
              )}

              {/* No money movement */}
              {computedRefund === 0 && computedCollection === 0 && (
                <div className="border-t border-gray-200 pt-2">
                  <p className="text-xs text-gray-500">
                    {order.paidAmount > 0
                      ? 'No refund due — customer has not overpaid.'
                      : 'No payment recorded yet — order total will be adjusted.'}
                  </p>
                </div>
              )}
            </div>
          );
        })()}

        {/* Note */}
        <div className="mt-4 space-y-1">
          <label className="ml-2 text-[10px] font-black uppercase tracking-widest text-gray-400">Note (optional)</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isLoading}
            placeholder="Add any note about this return/exchange..."
            className="min-h-[80px] w-full rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 font-medium text-sm outline-none focus:ring-2 focus:ring-[#3c5a82] disabled:opacity-50"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-4 pt-6">
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
            {activeTab === 'partialReturn' && 'Process Return'}
            {activeTab === 'exchange' && 'Complete Exchange'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default OrderReturnExchangeModal;
