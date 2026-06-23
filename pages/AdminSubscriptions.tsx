import React, { useEffect, useMemo, useState } from 'react';
import { formatCurrency, ICONS } from '../constants';
import { Button, LoadingOverlay } from '../components';
import { useCapabilitySettings, useServiceSubscriptionOverview } from '../src/hooks/useQueries';
import { useInitiatePipraPayCheckout } from '../src/hooks/useMutations';
import { CAPABILITY_KEYS, CAPABILITY_LABELS, normalizeCapabilities } from '../src/utils/capabilities';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useQueryClient } from '@tanstack/react-query';
import { verifyPipraPayPayment } from '../src/services/supabaseQueries';

const AdminSubscriptions: React.FC = () => {
  const { data: overview, isPending: loadingOverview } = useServiceSubscriptionOverview(true);
  const { data: capabilitySettings, isPending: loadingCapabilities } = useCapabilitySettings(true);
  const checkoutMutation = useInitiatePipraPayCheckout();
  const [interval, setInterval] = useState<'monthly' | 'yearly'>('monthly');
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);
  const toast = useToastNotifications();
  const queryClient = useQueryClient();

  // Handle payment return from PipraPay gateway
  useEffect(() => {
    let cancelled = false;

    const params = new URLSearchParams(window.location.search || window.location.hash.split('?')[1] || '');
    const paymentStatus = params.get('payment');
    if (!paymentStatus) {
      return () => {
        cancelled = true;
      };
    }

    // Clean up URL query params so they don't trigger again on re-render
    const cleanHash = window.location.hash.split('?')[0];
    window.history.replaceState(null, '', window.location.pathname + cleanHash);

    const reference = params.get('reference') || '';
    const ppId = params.get('pp_id') || params.get('payment_id') || '';
    const normalizedStatus = paymentStatus === 'cancelled' || paymentStatus === 'canceled'
      ? 'cancelled'
      : paymentStatus === 'failed'
        ? 'failed'
        : paymentStatus === 'success'
          ? 'success'
          : 'processing';

    const verifyReturn = async () => {
      if (normalizedStatus === 'cancelled') {
        const message = 'Payment was cancelled. No charges were made.';
        toast.warning(message);
        if (!cancelled) setCheckoutMessage(message);
        return;
      }

      if (normalizedStatus === 'failed') {
        const message = 'Payment failed. Please try again or use a different payment method.';
        toast.error(message);
        if (!cancelled) setCheckoutMessage(message);
        return;
      }

      if (ppId || reference) {
        const verifyingMessage = 'Payment received by gateway. Verifying payment status...';
        if (!cancelled) setCheckoutMessage(verifyingMessage);
        try {
          const result = await verifyPipraPayPayment({ reference, ppId });
          queryClient.invalidateQueries({ queryKey: ['service-subscription'], exact: false });
          if (result.paid) {
            const message = 'Payment verified successfully. Your subscription has been renewed.';
            toast.success(message);
            if (!cancelled) setCheckoutMessage(message);
            return;
          }

          const message = 'Payment is still being verified. Your subscription will update after PipraPay confirms payment.';
          toast.info(message);
          if (!cancelled) setCheckoutMessage(message);
          return;
        } catch (error: any) {
          const message = error?.message || 'Payment is being verified. Please refresh the subscription page shortly.';
          toast.warning(message);
          if (!cancelled) setCheckoutMessage(message);
          return;
        }
      }

      const message = 'Payment has returned from gateway and is awaiting PipraPay verification.';
      toast.info(message);
      if (!cancelled) setCheckoutMessage(message);
      queryClient.invalidateQueries({ queryKey: ['service-subscription'], exact: false });
    };

    void verifyReturn();
    return () => {
      cancelled = true;
    };
  }, [queryClient, toast]);

  const capabilities = useMemo(() => normalizeCapabilities(capabilitySettings?.capabilities), [capabilitySettings]);
  const monthlyAmount = Number(capabilitySettings?.pricingMetadata?.monthly || overview?.pricingMetadata?.monthly || overview?.totalAmount || 0);
  const yearlyAmount = Number(capabilitySettings?.pricingMetadata?.yearly || overview?.pricingMetadata?.yearly || overview?.yearlyAmount || monthlyAmount * 12 || 0);
  const selectedAmount = interval === 'yearly' ? yearlyAmount : monthlyAmount;
  const status = overview?.subscriptionStatus || overview?.state || 'unconfigured';
  const renewalDate = overview?.currentPeriodEnd || overview?.dueAt || capabilitySettings?.renewalDate;
  const processingPayment = overview?.currentPayment?.status === 'processing';

  const startCheckout = async () => {
    try {
      const result = await checkoutMutation.mutateAsync({ interval, amount: selectedAmount });
      if (result.checkoutUrl) {
        // Redirect the user to the PipraPay gateway page
        window.location.href = result.checkoutUrl;
      } else {
        toast.error('Could not get checkout URL from payment gateway. Please try again.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Checkout failed. Please try again.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <LoadingOverlay isLoading={loadingOverview || loadingCapabilities} message="Loading subscription..." />

      <section className="rounded-3xl border border-[var(--primary-medium,#3c5a82)] bg-gradient-to-br from-[var(--primary-color,#0f2f57)] to-[var(--primary-dark,#0c203b)] p-8 text-white shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">Current Plan</p>
        <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-black">{overview?.planName || capabilitySettings?.planName || 'Local Plan'}</h1>
            <p className="mt-2 text-sm font-medium text-white/75">
              Renewal: {renewalDate ? new Date(renewalDate).toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not configured'}
            </p>
            {processingPayment && (
              <p className="mt-2 text-sm font-medium text-white/80">
                Your payment has been submitted. Renewal date will update after PipraPay verification.
              </p>
            )}
          </div>
          <span className="inline-flex w-fit rounded-full bg-white/15 px-4 py-2 text-xs font-black uppercase tracking-[0.18em]">
            {status.replace(/_/g, ' ')}
          </span>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-black text-gray-900">Feature Inventory</h2>
              <p className="mt-1 text-sm text-gray-500">Live capabilities currently provisioned for this installation.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {CAPABILITY_KEYS.map((key) => {
              const active = Boolean(capabilities[key]);
              return (
                <div key={key} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-black text-gray-800">{CAPABILITY_LABELS[key]}</p>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                      {active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black text-gray-900">Renew</h2>
          <p className="mt-1 text-sm text-gray-500">Choose a billing interval and continue to PipraPay checkout.</p>
          {checkoutMessage && (
            <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-700">
              {checkoutMessage}
            </div>
          )}
          <div className="mt-5 grid gap-3">
            {(['monthly', 'yearly'] as const).map((option) => (
              <button
                key={option}
                onClick={() => setInterval(option)}
                className={`rounded-2xl border p-5 text-left transition-all ${interval === option ? 'border-[#0f2f57] bg-[#f8fbff]' : 'border-gray-100 bg-gray-50 hover:bg-white'}`}
              >
                <p className="font-black capitalize text-gray-900">{option}</p>
                <p className="mt-1 text-2xl font-black text-[#0f2f57]">{formatCurrency(option === 'yearly' ? yearlyAmount : monthlyAmount)}</p>
              </button>
            ))}
          </div>
          <Button
            onClick={startCheckout}
            variant="primary"
            size="lg"
            disabled={selectedAmount <= 0 || checkoutMutation.isPending || processingPayment}
            className="mt-5 w-full"
          >
            {checkoutMutation.isPending ? 'Redirecting to Gateway...' : processingPayment ? 'Payment Processing...' : 'Continue to Checkout'}
          </Button>
          {processingPayment && (
            <p className="mt-3 text-sm text-gray-500">A renewal payment is already in progress. Please wait for verification to complete before starting another checkout.</p>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black text-gray-900">Payment History</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">
              <tr>
                <th className="px-4 py-3">Transaction</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {(overview?.payments || []).map((payment) => (
                <tr key={payment.id} className="border-t border-gray-100">
                  <td className="px-4 py-3 font-bold text-gray-800">{payment.gatewayPaymentId || payment.transactionId}</td>
                  <td className="px-4 py-3">{formatCurrency(payment.amount)}</td>
                  <td className="px-4 py-3">{new Date(payment.submittedAt).toLocaleDateString('en-BD')}</td>
                  <td className="px-4 py-3 capitalize">{payment.status}</td>
                  <td className="px-4 py-3">
                    {payment.invoiceUrl ? <a className="font-black text-[#0f2f57]" href={payment.invoiceUrl} target="_blank" rel="noreferrer">Download</a> : <span className="text-gray-400">-</span>}
                  </td>
                </tr>
              ))}
              {(overview?.payments || []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">{ICONS.Info} No payments recorded yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};

export default AdminSubscriptions;
