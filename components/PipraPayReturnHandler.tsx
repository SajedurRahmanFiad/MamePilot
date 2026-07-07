import React, { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useQueryClient } from '@tanstack/react-query';
import { verifyPipraPayPayment } from '../src/services/supabaseQueries';

const PipraPayReturnHandler: React.FC = () => {
  const location = useLocation();
  const toast = useToastNotifications();
  const queryClient = useQueryClient();
  const hasRun = useRef(false);

  useEffect(() => {
    if (hasRun.current) {
      return;
    }

    const rawQuery = window.location.search || window.location.hash.split('?')[1] || '';
    const params = new URLSearchParams(rawQuery);
    const paymentStatus = params.get('payment') || params.get('pp_status') || params.get('status') || params.get('payment_status');
    const reference = params.get('reference') || params.get('transaction_ref') || params.get('transaction_reference') || params.get('order_id') || '';
    const ppId = params.get('pp_id') || params.get('payment_id') || params.get('transaction_id') || params.get('order_id') || '';
    const shouldVerify = Boolean(ppId || reference);

    if (!paymentStatus && !shouldVerify) {
      return;
    }

    hasRun.current = true;

    const clearReturnQuery = (): void => {
      const hash = window.location.hash || '';
      if (hash.includes('?')) {
        window.history.replaceState(null, '', window.location.pathname + hash.split('?')[0]);
      } else if (window.location.search) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      }
    };

    const handleStatusOnly = (): void => {
      const message = paymentStatus === 'cancelled' || paymentStatus === 'canceled'
        ? 'Payment was cancelled. No charges were made.'
        : 'Payment failed. Please try again or use a different payment method.';
      const toastFn = paymentStatus === 'cancelled' || paymentStatus === 'canceled' ? toast.warning : toast.error;
      toastFn(message);
      queryClient.invalidateQueries({ queryKey: ['service-subscription'], exact: false });
      clearReturnQuery();
    };

    const verifyReturn = async (): Promise<void> => {
      if (!shouldVerify && (paymentStatus === 'cancelled' || paymentStatus === 'canceled' || paymentStatus === 'failed' || paymentStatus === 'expired')) {
        handleStatusOnly();
        return;
      }

      if (!shouldVerify) {
        const message = 'Payment has returned from gateway and is awaiting verification.';
        toast.info(message);
        queryClient.invalidateQueries({ queryKey: ['service-subscription'], exact: false });
        clearReturnQuery();
        return;
      }

      try {
        toast.info('Payment received by gateway. Verifying payment status...');
        const result = await verifyPipraPayPayment({ reference, ppId });
        queryClient.invalidateQueries({ queryKey: ['service-subscription'], exact: false });
        clearReturnQuery();

        const resultStatus = String(result?.status || '').toLowerCase();
        const paymentOutcome = String(result?.paymentOutcome || resultStatus || '').toLowerCase();
        const responseMessage = typeof result?.message === 'string' && result.message.trim() ? result.message : '';

        if (['completed', 'complete', 'success', 'successful', 'paid'].includes(paymentOutcome) || ['completed', 'complete', 'success', 'successful', 'paid'].includes(resultStatus)) {
          toast.success(responseMessage || 'Payment verified successfully. Your subscription has been renewed.');
          return;
        }

        if (paymentOutcome === 'canceled' || paymentOutcome === 'cancelled') {
          toast.warning(responseMessage || 'Payment was cancelled by the user. No charges were made.');
          return;
        }

        if (paymentOutcome === 'failed') {
          toast.error(responseMessage || 'Payment failed. Please try again or use a different payment method.');
          return;
        }

        toast.error(responseMessage || 'Something went wrong while verifying the payment. Please contact support.');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Payment verification failed. Please try again later.';
        toast.warning(message);
        clearReturnQuery();
      }
    };

    void verifyReturn();
  }, [location, queryClient, toast]);

  return null;
};

export default PipraPayReturnHandler;
