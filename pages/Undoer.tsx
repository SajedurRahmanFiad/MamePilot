import React, { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Boxes,
  CheckCircle2,
  ChevronRight,
  History,
  Loader2,
  Package,
  ReceiptText,
  Recycle,
  RotateCcw,
  Search,
  User,
  WalletCards,
  X,
} from 'lucide-react';
import { formatCurrency, getStatusColor } from '../constants';
import { Button } from '../components';
import { useOrderSettings } from '../src/hooks/useQueries';
import { useRevertOrderStatus } from '../src/hooks/useMutations';
import { fetchOrderByNumber, fetchOrderUndoPlan } from '../src/services/supabaseQueries';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import type { OrderUndoPlan, OrderUndoRestorePoint } from '../types';
import { formatDate } from '../utils';

const sourceLabels: Record<string, string> = {
  update_order_status: 'Order status changed',
  complete_picked_order: 'Order finalized',
  process_order_exchange: 'Exchange processed',
  process_order_return: 'Return processed',
  legacy_inferred_status: 'Older status history',
};

const fieldLabels: Record<string, string> = {
  status: 'Order status',
  items: 'Items and return/exchange quantities',
  subtotal: 'Subtotal',
  discount: 'Discount',
  shipping: 'Shipping charge',
  total: 'Order total',
  paid_amount: 'Paid amount',
  history: 'Order history',
  carrybee_consignment_id: 'Carrybee consignment',
  steadfast_consignment_id: 'Steadfast consignment',
  paperfly_tracking_number: 'Paperfly tracking',
  pathao_consignment_id: 'Pathao consignment',
  exchange_courier: 'Exchange courier',
  exchange_courier_history: 'Exchange courier history',
};

const Undoer: React.FC = () => {
  const { data: orderSettings } = useOrderSettings();
  const { canExecuteUndo } = useRolePermissions();
  const revertMutation = useRevertOrderStatus();
  const prefix = orderSettings?.prefix ?? 'ORD-';

  const [query, setQuery] = useState('');
  const [plan, setPlan] = useState<OrderUndoPlan | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const selected = useMemo(
    () => plan?.restorePoints.find((point) => point.id === selectedId) ?? null,
    [plan, selectedId],
  );

  const normalizeOrderNumber = useCallback(() => {
    const value = query.trim();
    if (!value) return '';
    return /^\d+$/.test(value) ? `${prefix}${value}` : value;
  }, [prefix, query]);

  const handleSearch = useCallback(async () => {
    const orderNumber = normalizeOrderNumber();
    if (!orderNumber) return;
    setSearching(true);
    setError('');
    setPlan(null);
    setSelectedId('');
    setSuccess(null);
    revertMutation.reset();
    try {
      const order = await fetchOrderByNumber(orderNumber);
      if (!order) {
        setError(`No active order found with number “${orderNumber}”.`);
        return;
      }
      const undoPlan = await fetchOrderUndoPlan(order.id);
      setPlan(undoPlan);
      if (undoPlan.restorePoints.length === 1 && !undoPlan.restorePoints[0].blockedReason) {
        setSelectedId(undoPlan.restorePoints[0].id);
      }
    } catch (searchError: any) {
      setError(searchError?.message || 'The order undo plan could not be loaded.');
    } finally {
      setSearching(false);
    }
  }, [normalizeOrderNumber, revertMutation]);

  const confirmUndo = useCallback(() => {
    if (!plan || !selected || !acknowledged || selected.blockedReason) return;
    revertMutation.mutate(
      {
        orderId: plan.order.id,
        restorePointId: selected.id,
        targetStatus: selected.targetStatus,
      },
      {
        onSuccess: async (response) => {
          setConfirmOpen(false);
          setAcknowledged(false);
          const count = response.result.transactionsMovedToRecycleBin ?? 0;
          setSuccess(
            `Order ${response.order.orderNumber} was restored to ${response.order.status}. ${count} linked transaction${count === 1 ? '' : 's'} moved to Recycle Bin.`,
          );
          const refreshed = await fetchOrderUndoPlan(response.order.id);
          setPlan(refreshed);
          setSelectedId('');
        },
      },
    );
  }, [acknowledged, plan, selected, revertMutation]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={20} />
          <div>
            <p className="text-sm font-black text-amber-900">This changes business records.</p>
            <p className="mt-1 text-sm leading-6 text-amber-800">
              Financial rows are never permanently deleted: affected transactions go to Recycle Bin. Wallet history stays append-only and receives a compensating entry when required.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <label htmlFor="undo-order-search" className="text-xs font-black uppercase tracking-[0.16em] text-gray-500">Find an order</label>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <div className="flex min-w-0 flex-1 items-center rounded-xl border border-gray-200 bg-gray-50 px-4 focus-within:border-[var(--primary-medium,#3c5a82)] focus-within:bg-white focus-within:ring-4 focus-within:ring-[var(--primary-soft,#ebf4ff)]">
            <Search size={18} className="shrink-0 text-gray-400" />
            <input
              id="undo-order-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleSearch()}
              placeholder={`Enter ${prefix}123 or any full order number`}
              className="w-full bg-transparent px-3 py-3.5 text-sm font-bold text-gray-900 outline-none"
            />
          </div>
          <Button
            type="button"
            variant="primary"
            size="lg"
            onClick={handleSearch}
            disabled={!query.trim() || searching}
            loading={searching}
            icon={<Search size={18} />}
            className="justify-center sm:min-w-40"
          >
            Review order
          </Button>
        </div>
      </section>

      {(error || revertMutation.error) && (
        <div className="flex gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          <AlertTriangle className="shrink-0" size={19} /> {error || revertMutation.error?.message}
        </div>
      )}
      {success && (
        <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          <CheckCircle2 className="shrink-0" size={19} /> {success}
        </div>
      )}

      {searching && <LoadingState />}

      {plan && !searching && (
        <>
          <OrderSummary plan={plan} />

          {!plan.hasExactHistory && (
            <div className="flex gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-900">
              <History className="mt-0.5 shrink-0" size={19} />
              <span><strong>Older order:</strong> this order predates exact restore-point tracking. The available path is inferred from its saved status/history and is labelled accordingly.</span>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.4fr]">
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-gray-400">Step 1</p>
                <h2 className="mt-1 text-lg font-black text-gray-900">Choose a restore point</h2>
              </div>
              {plan.restorePoints.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center">
                  <BadgeCheck className="mx-auto text-emerald-500" size={30} />
                  <p className="mt-3 text-sm font-bold text-slate-700">Nothing is available to undo.</p>
                  <p className="mt-1 text-xs text-slate-500">This order is already at its earliest recorded state.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {plan.restorePoints.map((point) => (
                    <button
                      type="button"
                      key={point.id}
                      onClick={() => !point.blockedReason && setSelectedId(point.id)}
                      disabled={Boolean(point.blockedReason)}
                      className={`w-full rounded-xl border p-4 text-left transition ${selectedId === point.id ? 'border-[var(--primary-medium,#3c5a82)] bg-[var(--primary-soft,#ebf4ff)] ring-4 ring-[var(--primary-soft,#ebf4ff)]' : point.blockedReason ? 'cursor-not-allowed border-gray-200 bg-gray-50 opacity-70' : 'border-gray-200 hover:border-[var(--primary-medium,#3c5a82)] hover:bg-[var(--primary-soft,#ebf4ff)]'}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">Restore to</p>
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ${getStatusColor(point.targetStatus)}`}>{point.targetStatus}</span>
                          <p className="mt-2 text-sm font-bold text-slate-800">{sourceLabels[point.sourceAction] || 'Recorded order operation'}</p>
                          {point.occurredAt && <p className="mt-1 text-xs text-slate-500">Restore to before {formatDate(point.occurredAt)}</p>}
                        </div>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wide ${point.exact ? 'bg-emerald-100 text-emerald-700' : 'bg-sky-100 text-sky-700'}`}>{point.exact ? 'Exact' : 'Inferred'}</span>
                      </div>
                      {point.blockedReason && <p className="mt-3 text-xs font-semibold leading-5 text-red-600">{point.blockedReason}</p>}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4">
                <p className="text-xs font-black uppercase tracking-[0.16em] text-gray-400">Step 2</p>
                <h2 className="mt-1 text-lg font-black text-gray-900">Review the exact impact</h2>
              </div>
              {selected ? <ImpactPreview point={selected} currentStatus={plan.order.status} /> : <div className="rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm font-semibold text-slate-500">Select a restore point to see everything that will change.</div>}
              <Button
                type="button"
                variant="primary"
                size="lg"
                disabled={!selected || Boolean(selected?.blockedReason) || !canExecuteUndo}
                onClick={() => { setAcknowledged(false); setConfirmOpen(true); }}
                icon={<RotateCcw size={18} />}
                className="mt-5 w-full disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {canExecuteUndo ? 'Continue to confirmation' : 'You do not have execute permission'}
              </Button>
            </section>
          </div>
        </>
      )}

      {!plan && !searching && !error && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-14 text-center">
          <RotateCcw className="mx-auto text-slate-300" size={40} />
          <p className="mt-3 text-sm font-black text-slate-600">Search for an order to build its undo plan.</p>
          <p className="mt-1 text-xs text-slate-400">Nothing changes until you review and confirm the complete impact.</p>
        </div>
      )}

      {confirmOpen && plan && selected && (
        <ConfirmationModal
          plan={plan}
          point={selected}
          acknowledged={acknowledged}
          setAcknowledged={setAcknowledged}
          pending={revertMutation.isPending}
          onClose={() => !revertMutation.isPending && setConfirmOpen(false)}
          onConfirm={confirmUndo}
        />
      )}
    </div>
  );
};

const LoadingState = () => <div className="rounded-2xl border border-slate-200 bg-white p-14 text-center shadow-sm"><Loader2 className="mx-auto animate-spin text-[var(--primary-color,#0f2f57)]" size={30} /><p className="mt-3 text-sm font-bold text-slate-500">Building a server-verified undo plan…</p></div>;

const OrderSummary: React.FC<{ plan: OrderUndoPlan }> = ({ plan }) => {
  const order = plan.order;
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-slate-100 p-2.5 text-slate-600"><Package size={20} /></div><div><p className="text-xs font-bold text-slate-400">ORDER</p><h2 className="text-lg font-black text-slate-900">{order.orderNumber}</h2></div></div>
      <div className="text-left sm:text-right"><p className="mb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">Current status</p><span className={`inline-flex w-fit rounded-full px-3 py-1.5 text-xs font-black ${getStatusColor(order.status)}`}>{order.status}</span></div>
    </div>
    <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-5 sm:grid-cols-4">
      <SummaryValue icon={<User size={14} />} label="Customer" value={order.customerName || 'Unknown'} />
      <SummaryValue icon={<History size={14} />} label="Order date" value={order.orderDate ? formatDate(order.orderDate) : '—'} />
      <SummaryValue icon={<ReceiptText size={14} />} label="Total" value={formatCurrency(order.total)} />
      <SummaryValue icon={<Banknote size={14} />} label="Paid" value={formatCurrency(order.paidAmount)} />
    </div>
  </section>;
};

const SummaryValue: React.FC<{ icon: React.ReactNode; label: string; value: string }> = ({ icon, label, value }) => <div><p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">{icon}{label}</p><p className="mt-1 truncate text-sm font-bold text-slate-800">{value}</p></div>;

const ImpactPreview: React.FC<{ point: OrderUndoRestorePoint; currentStatus: string }> = ({ point, currentStatus }) => {
  const impact = point.impact;
  return <div className="space-y-3">
    <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-4"><span className={`rounded-full px-2.5 py-1 text-xs font-black ${getStatusColor(currentStatus)}`}>{currentStatus}</span><ArrowRight size={16} className="text-slate-400" /><span className={`rounded-full px-2.5 py-1 text-xs font-black ${getStatusColor(point.targetStatus)}`}>{point.targetStatus}</span></div>
    <ImpactGroup icon={<Recycle size={18} />} title={`${impact.transactionCount} transaction${impact.transactionCount === 1 ? '' : 's'} to Recycle Bin`} tone="red">
      {impact.transactions.length ? impact.transactions.map((transaction) => <div key={transaction.id} className="flex items-start justify-between gap-3 py-1.5 text-xs"><div><p className="font-bold text-slate-700">{transaction.description || transaction.type}</p><p className="text-slate-500">{transaction.accountName || 'Account'}{transaction.toAccountName ? ` → ${transaction.toAccountName}` : ''}</p></div><span className="font-black text-slate-800">{formatCurrency(transaction.amount)}</span></div>) : <p className="text-xs text-slate-500">No status-created financial rows will be removed.</p>}
    </ImpactGroup>
    <ImpactGroup icon={<Banknote size={18} />} title={`${impact.accountAdjustments.length} account balance${impact.accountAdjustments.length === 1 ? '' : 's'} recalculated`} tone="blue">
      {impact.accountAdjustments.length ? impact.accountAdjustments.map((account) => <div key={account.accountId} className="flex items-center justify-between py-1.5 text-xs"><span className="font-bold text-gray-700">{account.accountName}</span><span className="font-black text-gray-800">{formatCurrency(account.currentBalance)} <ChevronRight className="inline" size={13} /> {formatCurrency(account.projectedBalance)} <span className={account.adjustment >= 0 ? 'text-emerald-600' : 'text-red-600'}>({account.adjustment >= 0 ? '+' : ''}{formatCurrency(account.adjustment)})</span></span></div>) : <p className="text-xs text-gray-500">No account balance will change.</p>}
    </ImpactGroup>
    <ImpactGroup icon={<Boxes size={18} />} title={`${impact.stockAdjustments.length} stock balance${impact.stockAdjustments.length === 1 ? '' : 's'} adjusted`} tone="amber">
      {impact.stockAdjustments.length ? impact.stockAdjustments.map((stock) => <div key={stock.productId} className="flex items-center justify-between py-1.5 text-xs"><span className="font-bold text-slate-700">{stock.productName}</span><span className="font-black text-slate-800">{stock.currentStock} <ChevronRight className="inline" size={13} /> {stock.projectedStock} <span className={stock.adjustment >= 0 ? 'text-emerald-600' : 'text-red-600'}>({stock.adjustment >= 0 ? '+' : ''}{stock.adjustment})</span></span></div>) : <p className="text-xs text-slate-500">This restore point does not change stock.</p>}
    </ImpactGroup>
    <ImpactGroup icon={<WalletCards size={18} />} title="Wallet ledger reconciled" tone="blue"><p className="text-xs leading-5 text-slate-600">Wallet rows remain as audit history. A compensating credit or reversal is appended only if the restored status changes the employee’s payable balance.</p></ImpactGroup>
    {impact.externalEffects.length > 0 && <ImpactGroup icon={<AlertTriangle size={18} />} title="Courier follow-up required" tone="amber"><div className="space-y-2">{impact.externalEffects.map((effect) => <p key={`${effect.provider}-${effect.message}`} className="text-xs leading-5 text-gray-700">{effect.message}</p>)}</div></ImpactGroup>}
    <ImpactGroup icon={<Package size={18} />} title={`${impact.restoredFields.length} order field${impact.restoredFields.length === 1 ? '' : 's'} restored`} tone="slate"><div className="flex flex-wrap gap-1.5">{impact.restoredFields.map((field) => <span key={field} className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200">{fieldLabels[field] || field.replaceAll('_', ' ')}</span>)}</div></ImpactGroup>
  </div>;
};

const tones = { red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-700', blue: 'bg-sky-50 text-sky-700', slate: 'bg-slate-50 text-slate-700' };
const ImpactGroup: React.FC<{ icon: React.ReactNode; title: string; tone: keyof typeof tones; children: React.ReactNode }> = ({ icon, title, tone, children }) => <div className={`rounded-xl p-4 ${tones[tone]}`}><div className="mb-2 flex items-center gap-2 text-sm font-black">{icon}{title}</div><div className="text-slate-700">{children}</div></div>;

const ConfirmationModal: React.FC<{ plan: OrderUndoPlan; point: OrderUndoRestorePoint; acknowledged: boolean; setAcknowledged: (value: boolean) => void; pending: boolean; onClose: () => void; onConfirm: () => void }> = ({ plan, point, acknowledged, setAcknowledged, pending, onClose, onConfirm }) => <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
  <button aria-label="Close confirmation" className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm" onClick={onClose} />
  <div role="dialog" aria-modal="true" aria-labelledby="undo-confirm-title" className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
    <div className="border-b border-[var(--primary-soft,#ebf4ff)] bg-[var(--primary-soft,#ebf4ff)] p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-[var(--primary-medium,#3c5a82)]">Final confirmation</p><h2 id="undo-confirm-title" className="mt-1 text-xl font-black text-gray-900">Restore {plan.order.orderNumber}?</h2></div><button type="button" onClick={onClose} disabled={pending} className="rounded-lg p-2 text-gray-400 hover:bg-white hover:text-gray-700"><X size={19} /></button></div><div className="mt-4 flex items-center gap-2 text-sm font-bold"><span className={`rounded-full px-2.5 py-1 ${getStatusColor(plan.order.status)}`}>{plan.order.status}</span><ArrowRight size={15} className="text-[var(--primary-medium,#3c5a82)]" /><span className={`rounded-full px-2.5 py-1 ${getStatusColor(point.targetStatus)}`}>{point.targetStatus}</span></div></div>
    <div className="space-y-4 p-6"><div className="grid grid-cols-3 gap-2 text-center"><ConfirmMetric value={point.impact.transactionCount} label="Transactions recycled" /><ConfirmMetric value={point.impact.stockAdjustments.length} label="Products adjusted" /><ConfirmMetric value={point.impact.restoredFields.length} label="Fields restored" /></div>{point.impact.externalEffects.length > 0 && <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-800"><AlertTriangle className="mt-0.5 shrink-0" size={16} /> Courier-side consignments cannot be retracted automatically. Complete the provider follow-up shown in the impact review.</div>}<label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-4"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary-color,#0f2f57)]" /><span className="text-sm font-semibold leading-5 text-gray-700">I reviewed this exact action bundle and understand that it will change balances, stock, wallet state, and order history.</span></label><div className="flex gap-3"><Button type="button" variant="secondary" size="lg" onClick={onClose} disabled={pending} className="flex-1">Cancel</Button><Button type="button" variant="primary" size="lg" onClick={onConfirm} disabled={!acknowledged || pending} loading={pending} icon={<RotateCcw size={17} />} className="flex-1 disabled:opacity-40">{pending ? 'Restoring…' : 'Confirm undo'}</Button></div></div>
  </div>
</div>;

const ConfirmMetric: React.FC<{ value: number; label: string }> = ({ value, label }) => <div className="rounded-xl bg-slate-50 p-3"><p className="text-lg font-black text-slate-900">{value}</p><p className="mt-0.5 text-[10px] font-bold uppercase leading-4 text-slate-500">{label}</p></div>;

export default Undoer;
