import React, { useEffect, useMemo, useState } from 'react';
import { formatCurrency, ICONS } from '../constants';
import { Button, LoadingOverlay } from '../components';
import { useCapabilitySettings, useServiceSubscriptionOverview } from '../src/hooks/useQueries';
import { useInitiatePipraPayCheckout } from '../src/hooks/useMutations';
import {
  CAPABILITY_KEYS,
  CAPABILITY_LABELS,
  CAPABILITY_DESCRIPTIONS,
  normalizeCapabilities,
  getSubCapabilities,
  SUB_CAPABILITY_LABELS,
  normalizeSubCapabilities,
} from '../src/utils/capabilities';
import type { SubCapabilityKey } from '../types';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useQueryClient } from '@tanstack/react-query';
import { verifyPipraPayPayment } from '../src/services/supabaseQueries';
import { clearPipraPayReturnParams, readPipraPayReturnParams, readPipraPayReturnStatus } from '../src/utils/piprapay';
import { formatDate } from '../utils';

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

    const params = readPipraPayReturnParams();
    const paymentStatus = readPipraPayReturnStatus(params);
    const verificationRequested = params.get('pp_id') || params.get('payment_id') || params.get('transaction_id') || params.get('order_id') || params.get('payment') || params.get('reference') || params.get('transaction_ref') || params.get('transaction_reference');
    if (!paymentStatus && !verificationRequested) {
      return () => {
        cancelled = true;
      };
    }

    clearPipraPayReturnParams();

    const reference = params.get('reference') || params.get('transaction_ref') || params.get('transaction_reference') || params.get('order_id') || '';
    const ppId = params.get('pp_id') || params.get('payment_id') || params.get('transaction_id') || params.get('order_id') || '';
    const normalizedStatus = paymentStatus === 'cancelled' || paymentStatus === 'canceled'
      ? 'cancelled'
      : paymentStatus === 'failed' || paymentStatus === 'expired'
        ? 'failed'
        : paymentStatus === 'success'
          ? 'success'
          : 'processing';
    const shouldVerify = Boolean(ppId || reference);

    const verifyReturn = async () => {
      if (!shouldVerify && (normalizedStatus === 'cancelled' || normalizedStatus === 'failed')) {
        const message = normalizedStatus === 'cancelled'
          ? 'Payment was cancelled. No charges were made.'
          : 'Payment failed. Please try again or use a different payment method.';
        const toastFn = normalizedStatus === 'cancelled' ? toast.warning : toast.error;
        toastFn(message);
        if (!cancelled) {
          setCheckoutMessage(null);
          queryClient.invalidateQueries({ queryKey: ['service-subscription'], exact: false });
        }
        return;
      }

      if (ppId || reference) {
        const verifyingMessage = 'Payment received by gateway. Verifying payment status...';
        let verifyAttempts = 0;
        const verifyOnce = async () => {
          if (cancelled) {
            return;
          }

          if (!cancelled) {
            setCheckoutMessage(verifyingMessage);
          }

          try {
            verifyAttempts += 1;
            const result = await verifyPipraPayPayment({ reference, ppId });
            queryClient.invalidateQueries({ queryKey: ['service-subscription'], exact: false });
            const resultStatus = String(result?.status || '').toLowerCase();
            const paymentOutcome = String(result?.paymentOutcome || resultStatus || '').toLowerCase();
            const messageFromResult = typeof result?.message === 'string' && result.message.trim() ? result.message : '';
            // Log verification status for debugging
            // eslint-disable-next-line no-console
            console.log('PipraPay verification response status:', resultStatus, paymentOutcome, result);

            if (resultStatus === 'pending' || paymentOutcome === 'pending') {
              // eslint-disable-next-line no-console
              console.log('PipraPay status pending — will retry in 5s', { reference, ppId });
              await new Promise((resolve) => window.setTimeout(resolve, 5000));
              if (!cancelled && verifyAttempts < 12) {
                await verifyOnce();
              } else if (!cancelled) {
                toast.info('Payment is still being confirmed. Your subscription will update automatically.');
                setCheckoutMessage(null);
              }
              return;
            }

            if (['completed', 'complete', 'success', 'successful', 'paid'].includes(paymentOutcome) || ['completed', 'complete', 'success', 'successful', 'paid'].includes(resultStatus)) {
              const message = messageFromResult || 'Payment verified successfully. Your subscription has been renewed.';
              toast.success(message);
              if (!cancelled) {
                setCheckoutMessage(null);
              }
              // eslint-disable-next-line no-console
              console.log('PipraPay verification terminal success:', { reference, ppId, result });
              return;
            }

            if (paymentOutcome === 'canceled' || paymentOutcome === 'cancelled') {
              const message = messageFromResult || 'Payment was cancelled by the user. No charges were made.';
              toast.warning(message);
              if (!cancelled) {
                setCheckoutMessage(null);
              }
              return;
            }

            if (paymentOutcome === 'failed') {
              const message = messageFromResult || 'Payment failed. Please try again or use a different payment method.';
              toast.error(message);
              if (!cancelled) {
                setCheckoutMessage(null);
              }
              return;
            }

            const message = messageFromResult || 'Something went wrong while verifying the payment. Please contact the Mame Studios team for assistance.';
            toast.error(message);
            if (!cancelled) {
              setCheckoutMessage(null);
            }
            // eslint-disable-next-line no-console
            console.log('PipraPay verification terminal failure:', { reference, ppId, result });
            return;
          } catch (error: any) {
            // eslint-disable-next-line no-console
            console.log('PipraPay verification error:', error);
            const message = error?.message || 'Payment is being verified. Please refresh the subscription page shortly.';
            toast.warning(message);
            if (!cancelled) {
              setCheckoutMessage(null);
            }
            return;
          }
        };

        void verifyOnce();
        return;
      }

      const message = 'Payment was received and is still being confirmed.';
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

  const activeKeys = useMemo(() => CAPABILITY_KEYS.filter((key) => Boolean(capabilities[key])), [capabilities]);
  const inactiveKeys = useMemo(() => CAPABILITY_KEYS.filter((key) => !capabilities[key]), [capabilities]);
  const yearlySavings = monthlyAmount > 0 && yearlyAmount > 0 ? Math.ceil(((monthlyAmount * 12 - yearlyAmount) / (monthlyAmount * 12)) * 100) : 0;
  const rawSubs = (capabilitySettings?.capabilities as any)?.subCapabilities;
  const subCaps = useMemo(() => normalizeSubCapabilities(rawSubs || {}, capabilities), [rawSubs, capabilities]);
  const [expandedFeatures, setExpandedFeatures] = useState<Set<string>>(new Set());
  const toggleFeature = (key: string) => setExpandedFeatures((prev) => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });

  const startCheckout = async () => {
    try {
      const result = await checkoutMutation.mutateAsync({ interval, amount: selectedAmount });
      if (result.checkoutUrl) {
        // Redirect the user to the PipraPay gateway page
        window.location.href = result.checkoutUrl;
      } else {
        toast.error('The payment page could not be opened. Please try again.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Checkout failed. Please try again.');
    }
  };

  // Feature card renderer
  const renderFeatureCard = (key: string, active: boolean) => {
    const subKeys = getSubCapabilities(key as any);
    const hasChildren = subKeys.length > 0 && active;
    const isExpanded = expandedFeatures.has(key);
    const description = CAPABILITY_DESCRIPTIONS[key as keyof typeof CAPABILITY_DESCRIPTIONS];
    return (
      <div
        key={key}
        className={`group relative rounded-2xl border p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md ${
          active
            ? 'border-emerald-200 bg-white hover:border-emerald-300'
            : 'border-dashed border-gray-200 bg-gray-50/60 hover:border-gray-300'
        }`}
      >
        {/* Tooltip */}
        {description && (
          <div className="pointer-events-none absolute -top-2 left-1/2 z-10 w-56 -translate-x-1/2 -translate-y-full rounded-xl bg-gray-900 px-3 py-2 text-center text-xs font-medium leading-relaxed text-white opacity-0 shadow-lg transition-all duration-200 group-hover:-top-3 group-hover:opacity-100">
            {description}
            <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
          </div>
        )}
        {active && <div className="absolute left-0 top-3 bottom-3 w-1 rounded-full bg-emerald-400" />}
        <div
          className={`flex items-center justify-between gap-3 ${hasChildren ? 'cursor-pointer select-none' : ''}`}
          onClick={hasChildren ? () => toggleFeature(key) : undefined}
        >
          <p className={`font-black ${active ? 'text-gray-900' : 'text-gray-400'}`}>{CAPABILITY_LABELS[key as keyof typeof CAPABILITY_LABELS]}</p>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${
                active ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-400'
              }`}
            >
              {active ? (
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              )}
              {active ? 'Active' : 'Inactive'}
            </span>
            {hasChildren && (
              <svg
                className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            )}
          </div>
        </div>
        {hasChildren && (
          <div className={`overflow-hidden transition-all duration-200 ${isExpanded ? 'mt-3 max-h-96 opacity-100' : 'max-h-0 opacity-0'}`}>
            <div className="space-y-1.5 border-l-2 border-emerald-100 pl-3">
              {subKeys.map((subKey: SubCapabilityKey) => {
                const subActive = Boolean(subCaps[subKey]);
                return (
                  <div key={subKey} className="flex items-center justify-between gap-3">
                    <p className="text-xs font-bold text-gray-600">{SUB_CAPABILITY_LABELS[subKey]}</p>
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-bold ${
                        subActive ? 'text-emerald-600' : 'text-gray-400'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full ${subActive ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                      {subActive ? 'On' : 'Off'}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-12">
      <LoadingOverlay isLoading={loadingOverview || loadingCapabilities} message="Loading subscription..." />

      {/* ── Hero Banner ── */}
      <section className="relative overflow-hidden rounded-3xl border border-[var(--primary-medium,#3c5a82)] bg-gradient-to-br from-[var(--primary-color,#0f2f57)] to-[var(--primary-dark,#0c203b)] p-8 text-white shadow-lg">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-48 w-48 rounded-full bg-white/[0.03]" />
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-white/60">Current Plan</p>
        <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-black tracking-tight">{overview?.planName || capabilitySettings?.planName || 'Local Plan'}</h1>
            <p className="mt-2 text-sm font-medium text-white/75">
              Renewal: {renewalDate ? formatDate(renewalDate) : 'Not configured'}
            </p>
            {processingPayment && (
              <p className="mt-2 flex items-center gap-2 text-sm font-medium text-amber-300">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-300" />
                Payment submitted — awaiting verification
              </p>
            )}
          </div>
          <span
            className={`inline-flex w-fit items-center gap-2 rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] ${
              status === 'active' || status === 'trial'
                ? 'bg-emerald-400/20 text-emerald-200'
                : status === 'expired' || status === 'suspended'
                  ? 'bg-red-400/20 text-red-200'
                  : 'bg-white/15 text-white/80'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${status === 'active' || status === 'trial' ? 'bg-emerald-400 animate-pulse' : 'bg-white/40'}`} />
            {status.replace(/_/g, ' ')}
          </span>
        </div>
      </section>

      {/* ── Active Features ── */}
      <section className="rounded-2xl border border-emerald-100 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-black text-gray-900">Active Features</h2>
            <p className="text-sm text-gray-500">{activeKeys.length} feature{activeKeys.length !== 1 ? 's' : ''} currently live on your installation.</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {activeKeys.map((key) => renderFeatureCard(key, true))}
        </div>
        {activeKeys.length === 0 && (
          <div className="mt-6 rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
            <p className="text-sm font-bold text-gray-400">No active features found.</p>
          </div>
        )}
      </section>

      {/* ── Renew Section ── */}
      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="text-center">
          <h2 className="text-xl font-black text-gray-900">Renew Your Subscription</h2>
          <p className="mt-1 text-sm text-gray-500">Choose a billing interval and continue to secure checkout.</p>
        </div>
        {checkoutMessage && (
          <div className="mx-auto mt-4 max-w-md rounded-2xl border border-blue-100 bg-blue-50 p-4 text-center text-sm text-blue-700">
            {checkoutMessage}
          </div>
        )}
        <div className="mx-auto mt-6 grid max-w-lg grid-cols-2 gap-4">
          {(['monthly', 'yearly'] as const).map((option) => {
            const isSelected = interval === option;
            const amount = option === 'yearly' ? yearlyAmount : monthlyAmount;
            return (
              <button
                key={option}
                onClick={() => setInterval(option)}
                className={`relative rounded-2xl border-2 p-6 text-center transition-all duration-200 ${
                  isSelected
                    ? 'border-[#0f2f57] bg-[#f8fbff] shadow-md ring-2 ring-[#0f2f57]/10'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-white hover:shadow-sm'
                }`}
              >
                {isSelected && (
                  <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-[#0f2f57] px-3 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
                    Selected
                  </div>
                )}
                {option === 'yearly' && yearlySavings > 0 && (
                  <div className="absolute -right-2 -top-2.5 rounded-full bg-emerald-500 px-2.5 py-0.5 text-[10px] font-black text-white">
                    Save {yearlySavings}%
                  </div>
                )}
                <p className="text-sm font-black uppercase tracking-wider text-gray-500">{option}</p>
                <p className={`mt-2 text-3xl font-black ${isSelected ? 'text-[#0f2f57]' : 'text-gray-700'}`}>
                  {formatCurrency(amount)}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  {option === 'yearly' ? 'per year' : 'per month'}
                </p>
              </button>
            );
          })}
        </div>
        <div className="mx-auto mt-6 max-w-lg">
          <Button
            onClick={startCheckout}
            variant="primary"
            size="lg"
            disabled={selectedAmount <= 0 || checkoutMutation.isPending || processingPayment}
            className="w-full"
          >
            {checkoutMutation.isPending ? 'Redirecting to Gateway...' : processingPayment ? 'Payment Processing...' : (
              <span className="inline-flex items-center gap-2">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                Continue to Checkout
              </span>
            )}
          </Button>
          {processingPayment && (
            <p className="mt-3 text-center text-sm text-gray-400">A renewal payment is already in progress. Please wait for verification to complete.</p>
          )}
        </div>
      </section>

      {/* ── Inactive / Available Features ── */}
      {capabilitySettings?.showInactiveSubscriptionFeatures !== false && inactiveKeys.length > 0 && (
        <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-black text-gray-900">Available Features</h2>
              <p className="text-sm text-gray-500">{inactiveKeys.length} more feature{inactiveKeys.length !== 1 ? 's' : ''} you can unlock by upgrading your plan.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {inactiveKeys.map((key) => renderFeatureCard(key, false))}
          </div>
        </section>
      )}

      {/* ── Payment History ── */}
      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-black text-gray-900">Payment History</h2>
            <p className="text-sm text-gray-500">Your past transactions and invoices.</p>
          </div>
        </div>
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
              {(overview?.payments || []).map((payment, idx) => (
                <tr key={payment.id} className={`border-t border-gray-100 transition-colors hover:bg-gray-50 ${idx % 2 === 1 ? 'bg-gray-50/50' : ''}`}>
                  <td className="px-4 py-3 font-bold text-gray-800">{payment.gatewayPaymentId || payment.transactionId}</td>
                  <td className="px-4 py-3 font-semibold text-gray-700">{formatCurrency(payment.amount)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(payment.submittedAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                      payment.status === 'completed' || payment.status === 'success'
                        ? 'bg-emerald-100 text-emerald-700'
                        : payment.status === 'failed'
                          ? 'bg-red-100 text-red-600'
                          : payment.status === 'processing'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-gray-100 text-gray-500'
                    }`}>
                      {payment.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {payment.invoiceUrl ? (
                      <a className="inline-flex items-center gap-1 font-black text-[#0f2f57] transition-colors hover:text-[#3c5a82]" href={payment.invoiceUrl} target="_blank" rel="noreferrer">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Download
                      </a>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {(overview?.payments || []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-300">
                      <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
                      </svg>
                      <p className="text-sm font-bold">No payments recorded yet.</p>
                      <p className="text-xs text-gray-400">Your transaction history will appear here after your first payment.</p>
                    </div>
                  </td>
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
