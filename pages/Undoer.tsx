import React, { useState, useCallback, useMemo } from 'react';
import { useOrderSettings } from '../src/hooks/useQueries';
import { useRevertOrderStatus } from '../src/hooks/useMutations';
import { fetchOrderByNumber } from '../src/services/supabaseQueries';
import { formatCurrency, getStatusColor } from '../constants';
import { theme } from '../theme';
import type { Order } from '../types';
import { RotateCcw, Search, AlertTriangle, CheckCircle2, Package, User, Calendar, Hash, ChevronDown, ShieldAlert, Loader2 } from 'lucide-react';

const STATUS_ICONS: Record<string, React.ReactNode> = {
  'On Hold': <div className="w-2.5 h-2.5 rounded-full bg-gray-400" />,
  'Processing': <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />,
  'Picked': <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />,
  'Completed': <div className="w-2.5 h-2.5 rounded-full bg-green-500" />,
  'Returned': <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />,
  'Cancelled': <div className="w-2.5 h-2.5 rounded-full bg-red-500" />,
};

const Undoer: React.FC = () => {
  const { data: orderSettings } = useOrderSettings();
  const revertMutation = useRevertOrderStatus();

  const prefix = orderSettings?.prefix ?? 'ORD-';

  const [orderSuffix, setOrderSuffix] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [targetStatus, setTargetStatus] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [revertSuccess, setRevertSuccess] = useState<Order | null>(null);

  const fullOrderNumber = useMemo(() => {
    const trimmed = orderSuffix.trim();
    return trimmed ? `${prefix}${trimmed}` : '';
  }, [prefix, orderSuffix]);

  const displayStatuses = useMemo(() => {
    if (!order) return [];
    const base = ['On Hold', 'Processing', 'Picked'];
    if (order.status === 'Completed') return [...base, 'Completed'];
    if (order.status === 'Returned') return [...base, 'Returned'];
    if (order.status === 'Cancelled') return [...base, 'Cancelled'];
    return base;
  }, [order]);

  const priorStatuses = useMemo(() => {
    if (!order) return [];
    const currentIdx = displayStatuses.indexOf(order.status);
    if (currentIdx <= 0) return [];
    return displayStatuses.slice(0, currentIdx);
  }, [order, displayStatuses]);

  const handleSearch = useCallback(async () => {
    if (!fullOrderNumber) return;

    setSearching(true);
    setSearchError('');
    setOrder(null);
    setTargetStatus('');
    setRevertSuccess(null);
    revertMutation.reset();

    try {
      const result = await fetchOrderByNumber(fullOrderNumber);
      if (result) {
        setOrder(result);
      } else {
        setSearchError(`No active order found with number "${fullOrderNumber}".`);
      }
    } catch (err: any) {
      setSearchError(err?.message || 'Failed to look up order.');
    } finally {
      setSearching(false);
    }
  }, [fullOrderNumber]);

  const handleRevert = useCallback(() => {
    if (!order || !targetStatus) return;
    setShowConfirmation(true);
  }, [order, targetStatus]);

  const confirmRevert = useCallback(() => {
    if (!order || !targetStatus) return;
    setShowConfirmation(false);

    revertMutation.mutate(
      { orderId: order.id, targetStatus },
      {
        onSuccess: (data) => {
          setRevertSuccess(data);
          setOrder(data);
          setTargetStatus('');
        },
      }
    );
  }, [order, targetStatus, revertMutation]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl shadow-lg shadow-amber-200/40">
          <RotateCcw size={24} className="text-white" />
        </div>
        <div>
          <h2 className={`text-2xl font-bold ${theme.colors.text.primary}`}>Order Status Undoer</h2>
          <p className={`text-sm font-medium ${theme.colors.text.secondary} mt-0.5`}>
            Revert an order to a previous status — all side effects will be automatically reversed.
          </p>
        </div>
      </div>

      {/* Warning Banner */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
        <ShieldAlert size={20} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="text-sm font-medium text-amber-800">
          <span className="font-bold">Critical Operation</span> — Reverting an order status will undo all related
          financial transactions, account balance changes, wallet credits, and stock adjustments. Reversed transactions
          will be sent to the Recycle Bin.
        </div>
      </div>

      {/* Search Section */}
      <section className={`${theme.card.base} overflow-hidden`}>
        <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
          <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
            <Search size={16} className="text-gray-400" />
            Find Order
          </h3>
        </div>
        <div className="p-6">
          <label className="text-xs font-black uppercase tracking-[0.18em] text-gray-400 block mb-3">
            Order Number
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="flex-1 flex items-stretch rounded-xl border border-gray-200 bg-gray-50 overflow-hidden focus-within:border-[#0f2f57] focus-within:bg-white focus-within:ring-2 focus-within:ring-[#0f2f57]/10 transition-all">
              <span className="inline-flex items-center px-4 bg-[#0f2f57] text-white text-sm font-bold select-none tracking-wide">
                {prefix}
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={orderSuffix}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '');
                  setOrderSuffix(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                placeholder="Enter number..."
                className="flex-1 px-4 py-3.5 bg-transparent text-base font-bold text-gray-900 outline-none"
              />
            </div>
            <button
              type="button"
              onClick={handleSearch}
              disabled={!fullOrderNumber || searching}
              className={`${theme.buttons.base} ${theme.buttons.primary} ${theme.buttons.sizes.lg} gap-2 disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {searching ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Search size={18} />
              )}
              Search
            </button>
          </div>
        </div>
      </section>

      {/* Error */}
      {searchError && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-600 animate-in fade-in duration-300">
          <AlertTriangle size={18} className="flex-shrink-0" />
          {searchError}
        </div>
      )}

      {/* Revert Error */}
      {revertMutation.error && (
        <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-600 animate-in fade-in duration-300">
          <AlertTriangle size={18} className="flex-shrink-0" />
          {revertMutation.error.message}
        </div>
      )}

      {/* Success */}
      {revertSuccess && (
        <div className="flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 px-5 py-4 text-sm font-semibold text-green-700 animate-in fade-in duration-300">
          <CheckCircle2 size={18} className="flex-shrink-0" />
          Order <span className="font-black">{revertSuccess.orderNumber}</span> has been successfully reverted to
          <span className={`ml-1 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${getStatusColor(revertSuccess.status)}`}>
            {STATUS_ICONS[revertSuccess.status]}
            {revertSuccess.status}
          </span>
        </div>
      )}

      {/* Order Metadata */}
      {order && (
        <section className={`${theme.card.base} overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300`}>
          <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Package size={16} className="text-gray-400" />
              Order Details
            </h3>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${getStatusColor(order.status)}`}>
              {STATUS_ICONS[order.status]}
              {order.status}
            </span>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
              <div className="space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400 flex items-center gap-1.5">
                  <Hash size={12} />
                  Order Number
                </p>
                <p className="text-sm font-bold text-gray-900">{order.orderNumber}</p>
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400 flex items-center gap-1.5">
                  <User size={12} />
                  Customer
                </p>
                <p className="text-sm font-bold text-gray-900">{order.customerName || 'N/A'}</p>
                {order.customerPhone && (
                  <p className="text-xs text-gray-500">{order.customerPhone}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400 flex items-center gap-1.5">
                  <Calendar size={12} />
                  Order Date
                </p>
                <p className="text-sm font-bold text-gray-900">
                  {order.orderDate
                    ? new Date(order.orderDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
                    : 'N/A'}
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Total</p>
                <p className="text-sm font-black text-gray-900">{formatCurrency(order.total)}</p>
                {order.paidAmount > 0 && (
                  <p className="text-xs text-green-600 font-semibold">Paid: {formatCurrency(order.paidAmount)}</p>
                )}
              </div>
            </div>

            {order.items && order.items.length > 0 && (
              <div className="mt-5 pt-5 border-t border-gray-100">
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400 mb-3">Items ({order.items.length})</p>
                <div className="space-y-2">
                  {order.items.map((item: any, idx: number) => (
                    <div key={idx} className="flex items-center justify-between text-sm bg-gray-50 rounded-xl px-4 py-2.5">
                      <span className="font-medium text-gray-700">
                        {item.productName || item.name || 'Product'}
                        <span className="text-gray-400 ml-1">×{item.quantity || 1}</span>
                      </span>
                      <span className="font-bold text-gray-900">{formatCurrency(item.amount ?? (item.rate || 0) * (item.quantity || 1))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Status Selection */}
      {order && priorStatuses.length > 0 && (
        <section className={`${theme.card.base} overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300`}>
          <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-amber-50 to-white">
            <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <RotateCcw size={16} className="text-amber-600" />
              Revert Status
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Select the status you want this order to revert to. All side effects created after this status will be reversed.
            </p>
          </div>
          <div className="p-6">
            {/* Status flow visualization */}
            <div className="flex flex-wrap items-center gap-2 mb-6 p-4 bg-gray-50 rounded-xl">
              {displayStatuses.map((status, idx) => {
                const isCurrent = status === order.status;
                const isPrior = priorStatuses.includes(status);
                const isSelected = status === targetStatus;

                return (
                  <React.Fragment key={status}>
                    {idx > 0 && (
                      <ChevronDown size={14} className="text-gray-300 rotate-[-90deg]" />
                    )}
                    <button
                      type="button"
                      disabled={!isPrior}
                      onClick={() => setTargetStatus(status)}
                      className={`
                        inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all
                        ${isCurrent
                          ? 'bg-[#0f2f57] text-white shadow-md ring-2 ring-[#0f2f57]/30'
                          : isSelected
                            ? 'bg-amber-500 text-white shadow-md ring-2 ring-amber-500/30 scale-105'
                            : isPrior
                              ? 'bg-white text-gray-700 border border-gray-200 hover:border-amber-400 hover:bg-amber-50 cursor-pointer'
                              : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                        }
                      `}
                    >
                      {STATUS_ICONS[status]}
                      {status}
                      {isCurrent && <span className="text-[9px] font-medium opacity-80 ml-0.5">(current)</span>}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>

            {/* Selected target info */}
            {targetStatus && (
              <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-amber-200 bg-amber-50 mb-5 animate-in fade-in duration-200">
                <div className="flex items-center gap-3 text-sm">
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${getStatusColor(order.status)}`}>
                    {order.status}
                  </span>
                  <RotateCcw size={14} className="text-amber-500" />
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${getStatusColor(targetStatus)}`}>
                    {targetStatus}
                  </span>
                </div>
              </div>
            )}

            {/* Revert Button */}
            <button
              type="button"
              onClick={handleRevert}
              disabled={!targetStatus || revertMutation.isPending}
              className={`w-full ${theme.buttons.base} gap-2 px-6 py-4 text-sm font-bold rounded-xl transition-all
                ${targetStatus
                  ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-200/50 hover:shadow-xl hover:shadow-amber-200/60 hover:scale-[1.01] active:scale-[0.99]'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                }
              `}
            >
              {revertMutation.isPending ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Reverting Order...
                </>
              ) : (
                <>
                  <RotateCcw size={18} />
                  {targetStatus
                    ? `Revert to ${targetStatus}`
                    : 'Select a target status above'}
                </>
              )}
            </button>
          </div>
        </section>
      )}

      {/* No prior statuses message */}
      {order && priorStatuses.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center animate-in fade-in duration-300">
          <AlertTriangle size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm font-bold text-gray-500">
            This order is already in the earliest status (<span className="text-gray-700">{order.status}</span>). There are no prior statuses to revert to.
          </p>
        </div>
      )}

      {/* Empty state */}
      {!order && !searchError && !searching && (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-16 text-center">
          <RotateCcw size={40} className="mx-auto text-gray-300 mb-4" />
          <p className="text-sm font-bold text-gray-500">
            Enter an order number above to begin.
          </p>
          <p className="text-xs text-gray-400 mt-2">
            The order's current status and metadata will appear here.
          </p>
        </div>
      )}

      {/* Searching state */}
      {searching && (
        <div className="rounded-2xl border border-gray-100 bg-white px-6 py-16 text-center shadow-sm">
          <Loader2 size={28} className="mx-auto text-[#0f2f57] animate-spin mb-3" />
          <p className="text-sm font-medium text-gray-500">Looking up order {fullOrderNumber}...</p>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirmation && order && targetStatus && (
        <>
          <div
            className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50"
            onClick={() => setShowConfirmation(false)}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className={`${theme.card.elevated} w-full max-w-md p-0 animate-in fade-in zoom-in-95 duration-200 overflow-hidden`}>
              <div className="p-6 bg-gradient-to-br from-amber-50 to-orange-50 border-b border-amber-100">
                <div className="flex items-center gap-3 mb-3">
                  <div className="p-2.5 bg-amber-500/10 rounded-xl">
                    <AlertTriangle size={22} className="text-amber-600" />
                  </div>
                  <h3 className="text-lg font-bold text-gray-900">Confirm Status Revert</h3>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed">
                  You are about to revert order <strong>{order.orderNumber}</strong> from{' '}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${getStatusColor(order.status)}`}>
                    {order.status}
                  </span>{' '}
                  to{' '}
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${getStatusColor(targetStatus)}`}>
                    {targetStatus}
                  </span>.
                </p>
              </div>

              <div className="p-6 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">This action will:</p>
                <ul className="space-y-2 text-sm text-gray-600">
                  <li className="flex items-start gap-2">
                    <span className="text-amber-500 mt-0.5">•</span>
                    Soft-delete all linked financial transactions (moved to Recycle Bin)
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-500 mt-0.5">•</span>
                    Reverse account balance changes from those transactions
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-500 mt-0.5">•</span>
                    Clean up any wallet credit/reversal entries
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-500 mt-0.5">•</span>
                    Adjust product stock levels accordingly
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-500 mt-0.5">•</span>
                    Reset paid amount and update order history
                  </li>
                </ul>
              </div>

              <div className="p-6 pt-0 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowConfirmation(false)}
                  className={`flex-1 ${theme.buttons.base} ${theme.buttons.secondary} ${theme.buttons.sizes.lg}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmRevert}
                  className={`flex-1 ${theme.buttons.base} ${theme.buttons.sizes.lg} bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-lg hover:shadow-xl`}
                >
                  <RotateCcw size={16} />
                  Confirm Revert
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Undoer;
