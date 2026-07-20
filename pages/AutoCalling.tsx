import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ICONS, formatCurrency } from '../constants';
import { Button, Modal, NumericInput } from '../components';
import FilterBar, { type FilterRange } from '../components/FilterBar';
import { theme } from '../theme';
import { useRechargeHistory, useSurveyBalance, useSurveyBroadcasts, useSurveySummary } from '../src/hooks/useQueries';
import { useInitiateRechargeCheckout } from '../src/hooks/useMutations';
import { verifyPipraPayPayment } from '../src/services/supabaseQueries';
import { useToastNotifications } from '../src/contexts/ToastContext';
import Pagination from '../src/components/Pagination';

const PAGE_SIZE = 25;

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700',
  broadcasting: 'bg-blue-100 text-blue-700',
  pending: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
  scheduled: 'bg-purple-100 text-purple-700',
  success: 'bg-emerald-100 text-emerald-700',
  processing: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-gray-100 text-gray-600',
  canceled: 'bg-gray-100 text-gray-600',
  approved: 'bg-emerald-100 text-emerald-700',
};

type TableTab = 'broadcasts' | 'recharge_history';

const AutoCalling: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToastNotifications();

  // FilterBar state
  const [filterRange, setFilterRange] = useState<FilterRange>('All Time');
  const [customDates, setCustomDates] = useState({ from: '', to: '' });
  const [tableTab, setTableTab] = useState<TableTab>('broadcasts');
  const [page, setPage] = useState(1);

  // Recharge modal state
  const [showRechargeModal, setShowRechargeModal] = useState(false);
  const [rechargeAmount, setRechargeAmount] = useState<number>(0);
  const [processingPayment, setProcessingPayment] = useState(false);
  const rechargeMutation = useInitiateRechargeCheckout();

  // Compute date params from FilterBar
  const dateParams = useMemo(() => {
    const now = new Date();
    let start = '';
    let end = now.toISOString().slice(0, 10);

    switch (filterRange) {
      case 'All Time':
        start = '';
        end = '';
        break;
      case 'Today':
        start = end;
        break;
      case 'This Week': {
        const d = new Date(now);
        d.setDate(d.getDate() - d.getDay());
        start = d.toISOString().slice(0, 10);
        break;
      }
      case 'This Month':
        start = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        break;
      case 'This Year':
        start = `${now.getFullYear()}-01-01`;
        break;
      case 'Custom':
        start = customDates.from;
        end = customDates.to;
        break;
      case 'Last 30 days':
      default: {
        const d = new Date(now);
        d.setDate(d.getDate() - 30);
        start = d.toISOString().slice(0, 10);
        break;
      }
    }
    return { startDate: start, endDate: end };
  }, [filterRange, customDates]);

  // Queries
  const { data: balanceData, isLoading: balanceLoading, refetch: refetchBalance } = useSurveyBalance();
  const { data: summaryData, isLoading: summaryLoading, refetch: refetchSummary } = useSurveySummary();
  const { data: broadcastsData, isLoading: broadcastsLoading, refetch: refetchBroadcasts } = useSurveyBroadcasts(dateParams);
  const { data: recharges = [], isLoading: rechargesLoading, refetch: refetchRecharges } = useRechargeHistory();

  const broadcasts = broadcastsData?.broadcasts || [];
  const totalPages = Math.max(1, Math.ceil(broadcasts.length / PAGE_SIZE));
  const paginatedBroadcasts = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return broadcasts.slice(start, start + PAGE_SIZE);
  }, [broadcasts, page]);

  // Handle PipraPay payment return
  useEffect(() => {
    let cancelled = false;
    const rawQuery = window.location.search || window.location.hash.split('?')[1] || '';
    const params = new URLSearchParams(rawQuery);
    const paymentStatus = params.get('payment') || params.get('pp_status') || params.get('status') || params.get('payment_status');
    const ppId = params.get('pp_id') || params.get('payment_id') || params.get('transaction_id') || params.get('order_id') || '';
    const reference = params.get('reference') || params.get('transaction_ref') || params.get('transaction_reference') || params.get('order_id') || '';

    if (!paymentStatus && !ppId) return;

    const cleanHash = window.location.hash.split('?')[0];
    window.history.replaceState(null, '', window.location.pathname + cleanHash);

    const normalizedStatus = paymentStatus === 'cancelled' || paymentStatus === 'canceled'
      ? 'cancelled' : paymentStatus === 'failed' ? 'failed' : paymentStatus === 'success' ? 'success' : 'processing';

    const verifyReturn = async () => {
      if (!ppId && !reference) {
        if (normalizedStatus === 'cancelled') toast.warning('Payment was cancelled.');
        else if (normalizedStatus === 'failed') toast.error('Payment failed.');
        return;
      }

      setProcessingPayment(true);
      try {
        for (let attempt = 0; attempt < 12 && !cancelled; attempt += 1) {
          const result = await verifyPipraPayPayment({ reference, ppId });
          const resultStatus = String(result?.status || '').toLowerCase();
          const paymentOutcome = String((result as any)?.paymentOutcome || resultStatus || '').toLowerCase();

          if (resultStatus === 'pending' || paymentOutcome === 'pending') {
            await new Promise((r) => window.setTimeout(r, 5000));
            continue;
          }

          if (['completed', 'complete', 'success', 'successful', 'paid'].includes(paymentOutcome) || result?.paid) {
            toast.success(result?.message || 'Recharge payment verified. The balance top-up is ready for processing.');
            queryClient.invalidateQueries({ queryKey: ['survey'], exact: false });
          } else if (normalizedStatus === 'cancelled') {
            toast.warning('Payment was cancelled.');
          } else {
            toast.error('Payment could not be verified. Please check your balance.');
          }
          return;
        }
        if (!cancelled) {
          toast.info('Payment is still processing. The gateway webhook will update recharge history automatically.');
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Payment verification failed.');
      } finally {
        if (!cancelled) setProcessingPayment(false);
      }
    };

    verifyReturn();
    return () => { cancelled = true; };
  }, []);

  const handleRefresh = useCallback(() => {
    refetchBalance();
    refetchSummary();
    refetchBroadcasts();
    refetchRecharges();
    toast.success('Refreshed');
  }, [refetchBalance, refetchSummary, refetchBroadcasts, refetchRecharges, toast]);

  const handleRecharge = async () => {
    if (rechargeAmount <= 0) {
      toast.warning('Please enter a valid amount.');
      return;
    }
    try {
      const result = await rechargeMutation.mutateAsync({ amount: rechargeAmount });
      if (result?.checkoutUrl) {
        window.location.href = result.checkoutUrl;
      } else {
        toast.error('Could not get checkout URL from payment gateway.');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to initiate recharge.');
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('en-BD', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Filter Bar + Action Buttons */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <FilterBar
          title="Auto Calling"
          filterRange={filterRange}
          setFilterRange={(r) => { setFilterRange(r); setPage(1); }}
          customDates={customDates}
          setCustomDates={(d) => { setCustomDates(d); setPage(1); }}
          compact
        />
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} icon={ICONS.Dashboard}>
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/settings?tab=voice-survey')}
            icon={ICONS.Settings}
          >
            Settings
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Balance Card */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Balance</p>
            <button
              onClick={() => setShowRechargeModal(true)}
              className="text-[10px] font-bold text-blue-600 hover:text-blue-800 underline"
            >
              Recharge
            </button>
          </div>
          <p className="mt-2 text-3xl font-black text-gray-900">
            {balanceLoading ? '...' : balanceData?.success ? `৳${balanceData.balance.toFixed(2)}` : '—'}
          </p>
          {!balanceLoading && !balanceData?.success && balanceData?.message && (
            <p className="mt-1 text-[10px] text-red-500 font-medium">{balanceData.message}</p>
          )}
        </div>

        {/* Pulse Info Card */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Pulse Info</p>
          <div className="mt-2 space-y-1">
            <p className="text-sm font-bold text-gray-900">Pulse: <span className="text-gray-600">60 seconds</span></p>
            <p className="text-sm font-bold text-gray-900">Rate: <span className="text-gray-600">৳0.55 / pulse</span></p>
          </div>
        </div>

        {/* Sender Card */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Sender</p>
          <p className="mt-2 text-2xl font-black text-gray-900">
            {summaryLoading ? '...' : summaryData?.sender || 'Not configured'}
          </p>
        </div>

        {/* Total Calls Card */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Total Calls</p>
          <p className="mt-2 text-3xl font-black text-gray-900">
            {summaryLoading ? '...' : (summaryData?.totalCalls ?? 0).toLocaleString()}
          </p>
        </div>

        {/* Pending Calls Card */}
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Pending Calls</p>
          <p className="mt-2 text-3xl font-black text-amber-600">
            {summaryLoading ? '...' : (summaryData?.pendingCalls ?? 0).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Table with Tab Swapper */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {/* Tab Header */}
        <div className="flex items-center border-b border-gray-100">
          <button
            onClick={() => { setTableTab('broadcasts'); setPage(1); }}
            className={`px-5 py-3.5 text-sm font-bold transition-colors border-b-2 ${
              tableTab === 'broadcasts'
                ? 'border-[#0f2f57] text-gray-900'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Broadcasts
          </button>
          <button
            onClick={() => { setTableTab('recharge_history'); setPage(1); }}
            className={`px-5 py-3.5 text-sm font-bold transition-colors border-b-2 ${
              tableTab === 'recharge_history'
                ? 'border-[#0f2f57] text-gray-900'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            Recharge History
          </button>
        </div>

        {/* Broadcasts Table */}
        {tableTab === 'broadcasts' && (
          <>
            {broadcastsLoading ? (
              <div className="p-8 text-center">
                <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-[#0f2f57]" />
                <p className="mt-2 text-sm text-gray-500">Loading broadcasts...</p>
              </div>
            ) : broadcasts.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-sm text-gray-500 font-medium">No broadcasts found for the selected date range.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/50">
                      <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">ID</th>
                      <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Name</th>
                      <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                      <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {paginatedBroadcasts.map((broadcast) => (
                      <tr key={broadcast.id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-4 text-sm font-bold text-gray-900">#{broadcast.id}</td>
                        <td className="px-5 py-4 text-sm font-medium text-gray-700">{broadcast.name || '—'}</td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${STATUS_COLORS[broadcast.status] || 'bg-gray-100 text-gray-600'}`}>
                            {broadcast.status}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-sm text-gray-500 font-medium">{formatDate(broadcast.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Recharge History Table */}
        {tableTab === 'recharge_history' && (
          rechargesLoading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading recharge history...</div>
          ) : recharges.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-gray-500 font-medium">Recharge history will appear here after your first recharge.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Reference</th>
                    <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Amount</th>
                    <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                    <th className="px-5 py-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {recharges.map((recharge) => (
                    <tr key={recharge.id}>
                      <td className="px-5 py-4 text-sm font-bold text-gray-900">{recharge.localReference}</td>
                      <td className="px-5 py-4 text-sm font-medium text-gray-700">{formatCurrency(recharge.amount)}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${STATUS_COLORS[recharge.status] || 'bg-gray-100 text-gray-600'}`}>
                          {recharge.status}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-500 font-medium">{formatDate(recharge.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* Pagination */}
        {tableTab === 'broadcasts' && totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-100">
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          </div>
        )}
      </div>

      {/* Recharge Modal */}
      {showRechargeModal && (
        <Modal isOpen={showRechargeModal} onClose={() => setShowRechargeModal(false)} title="Recharge Balance">
          <div className="space-y-5">
            <p className="text-sm text-gray-500">
              Enter the amount you want to add to your balance. You will be redirected to the payment gateway.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">Amount (BDT)</label>
              <NumericInput
                value={rechargeAmount}
                onChange={(val) => setRechargeAmount(val || 0)}
                placeholder="e.g. 500"
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 outline-none focus:border-[#0f2f57]"
              />
            </div>
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-3">
              <p className="text-xs text-blue-700">
                <span className="font-bold">Note:</span> Pulse rate is ৳0.55 per 60 seconds. A ৳100 recharge gives approximately 181 pulses (minutes of call time).
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" onClick={() => setShowRechargeModal(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleRecharge}
                loading={rechargeMutation.isPending || processingPayment}
                disabled={rechargeAmount <= 0}
              >
                {processingPayment ? 'Processing...' : 'Proceed to Payment'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default AutoCalling;
