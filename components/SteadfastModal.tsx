import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from './index';
import { OrderStatus, type Order, type Customer } from '../types';
import { useCourierSettings } from '../src/hooks/useQueries';
import { submitSteadfastOrder } from '../src/services/supabaseQueries';
import { useUpdateOrder } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { db } from '../db';
import { formatDateTimeParts } from '../utils';
import { ApiError } from '../src/services/apiClient';

interface SteadfastModalProps {
  isOpen: boolean;
  onClose: () => void;
  order?: Order | null;
  customer?: Customer | null;
  isExchangeConsignment?: boolean;
}

function formatHistoryMoment(): string {
  const { date, time } = formatDateTimeParts(new Date());
  return `${date}, at ${time}`;
}

export const SteadfastModal: React.FC<SteadfastModalProps> = ({ isOpen, onClose, order, customer, isExchangeConsignment }) => {
  const queryClient = useQueryClient();
  const { data: courierSettings } = useCourierSettings();
  const toast = useToastNotifications();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateOrder = useUpdateOrder();

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setError(null);

    if (!order || !customer) {
      setError('Missing order or customer information');
      console.error('[SteadfastModal] Missing order, customer information');
      return;
    }

    // Refetch courier settings to get the latest credentials
    await queryClient.invalidateQueries({ queryKey: ['settings', 'courier'] });
    const freshCourierSettings = queryClient.getQueryData<any>(['settings', 'courier']) || courierSettings;

    if (!freshCourierSettings?.steadfast) {
      setError('No Steadfast credentials configured');
      console.error('[SteadfastModal] No Steadfast settings');
      return;
    }

    const { baseUrl, apiKey, secretKey, invoice = '' } = freshCourierSettings.steadfast;

    // Detailed logging for debugging
    console.log('[SteadfastModal] ======== SUBMISSION DEBUG ========');
    console.log('[SteadfastModal] baseUrl:', baseUrl);
    console.log('[SteadfastModal] baseUrl type:', typeof baseUrl);
    console.log('[SteadfastModal] baseUrl empty?:', baseUrl === '' || !baseUrl);
    console.log('[SteadfastModal] apiKey:', apiKey ? `${apiKey.substring(0, 5)}...` : 'EMPTY/NULL');
    console.log('[SteadfastModal] apiKey type:', typeof apiKey);
    console.log('[SteadfastModal] secretKey:', secretKey ? `${secretKey.substring(0, 5)}...` : 'EMPTY/NULL');
    console.log('[SteadfastModal] secretKey type:', typeof secretKey);

    if (!baseUrl || !apiKey || !secretKey) {
      setError(`Incomplete Steadfast credentials - baseUrl: ${!!baseUrl}, apiKey: ${!!apiKey}, secretKey: ${!!secretKey}`);
      console.error('[SteadfastModal] Incomplete credentials');
      console.error('[SteadfastModal] baseUrl value:', JSON.stringify(baseUrl));
      console.error('[SteadfastModal] apiKey value:', JSON.stringify(apiKey));
      console.error('[SteadfastModal] secretKey value:', JSON.stringify(secretKey));
      return;
    }

    setSubmitting(true);
    try {
      console.log('[SteadfastModal] ======== PREPARING SUBMISSION ========');
      console.log('[SteadfastModal] Order Number:', order.orderNumber);
      console.log('[SteadfastModal] Customer Name:', customer.name);
      console.log('[SteadfastModal] Customer Phone:', customer.phone);
      console.log('[SteadfastModal] Customer Address:', customer.address);
      console.log('[SteadfastModal] Order Total:', order.total);

      const invoiceValue = invoice.trim() || order.orderNumber;
      const result = await submitSteadfastOrder({
        baseUrl,
        apiKey,
        secretKey,
        invoice: invoiceValue,
        orderId: order.id,
        recipientName: customer.name,
        recipientPhone: customer.phone,
        recipientAddress: customer.address,
        codAmount: order.total,
      });

      console.log('[SteadfastModal] ======== SUBMISSION RESULT ========');
      console.log('[SteadfastModal] Result:', result);

      if (result.error) {
        // Try to parse detailed error info
        let displayError = result.error;
        try {
          if (result.error.includes('Account is not active')) {
            displayError = 'Your Steadfast account is not active. Please contact Steadfast support or check your account status.';
          } else if (result.error.includes('Invalid API key') || result.error.includes('Unauthorized') || result.error.includes('401')) {
            displayError = 'Invalid Steadfast credentials. Please verify your API key and secret key in Settings → Courier.';
          } else if (result.error.includes('limit') || result.error.includes('quota')) {
            displayError = 'Steadfast API limit reached. Please try again later.';
          }
        } catch (e) {
          // Use original error if parsing fails
        }
        setError(displayError);
        console.error('[SteadfastModal] Submission failed:', result.error);
        return;
      }

      console.log('[SteadfastModal] Order submitted successfully to Steadfast');
      const consignmentId = (
        result?.consignment?.consignment_id ??
        result?.consignment?.consignmentId ??
        result?.consignment_id ??
        result?.consignmentId ??
        result?.data?.consignment?.consignment_id ??
        result?.data?.consignment?.consignmentId ??
        result?.data?.consignment_id ??
        result?.data?.consignmentId ??
        null
      );
      const trackingLink = (
        result?.consignment?.tracking_link ??
        result?.consignment?.trackingLink ??
        result?.tracking_link ??
        result?.trackingLink ??
        result?.data?.consignment?.tracking_link ??
        result?.data?.consignment?.trackingLink ??
        result?.data?.tracking_link ??
        result?.data?.trackingLink ??
        null
      );
      const courierStatus = (
        result?.consignment?.status ??
        result?.data?.consignment?.status ??
        (typeof result?.status === 'string' ? result.status : null) ??
        null
      );

      if (consignmentId === null || String(consignmentId).trim() === '') {
        throw new Error('Steadfast accepted the order but did not return a consignment ID. The local order was not changed.');
      }

      const normalizedConsignmentId = String(consignmentId).trim();
      const historyText = `${isExchangeConsignment ? 'Exchange s' : 'S'}ent to Steadfast by ${db.currentUser?.name || 'System'} on ${formatHistoryMoment()} (Consignment ID: ${normalizedConsignmentId})${courierStatus ? ` (Submit status: ${courierStatus})` : ''}`;
      console.log('[SteadfastModal] Setting courier history:', historyText);

      const updates: any = {
        history: {
          ...order.history,
        },
      };

      if (isExchangeConsignment) {
        // Exchange consignment — store in exchange fields, don't change status
        updates.exchangeCourier = 'steadfast';
        updates.history.exchangeCourier = historyText;
        updates.exchangeSteadfastConsignmentId = normalizedConsignmentId;
      } else {
        // Normal consignment
        updates.status = OrderStatus.COURIER_ASSIGNED;
        updates.history.courier = historyText;
        updates.steadfastConsignmentId = normalizedConsignmentId;
        updates.steadfastInvoice = invoiceValue;
        if (trackingLink !== null && String(trackingLink).trim() !== '') {
          updates.steadfastTrackingLink = String(trackingLink).trim();
        }
      }

      await updateOrder.mutateAsync({ id: order.id, updates });
      console.log('[SteadfastModal] Courier status updated and UI refreshed');
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['orders'], exact: false });
      toast.success('Order sent to Steadfast successfully');
    } catch (err) {
      let errorMsg = err instanceof Error ? err.message : 'Unknown error';
      console.error('[SteadfastModal] Exception during submission:', err);

      if (err instanceof ApiError) {
        console.error('[SteadfastModal] ApiError status:', err.status, 'code:', err.code);
        if (err.status === 401) {
          errorMsg = 'Authentication failed. Please verify your Steadfast API key and secret key in Settings → Courier are correct and your account is active.';
        } else if (err.status === 403) {
          errorMsg = 'Access denied. Your Steadfast account may not have permission for this action.';
        } else if (err.status === 422) {
          errorMsg = 'Invalid request data. Please check the order details and try again.';
        } else if (err.status && err.status >= 500) {
          errorMsg = 'Steadfast server error. Please try again later.';
        }
      }

      setError(errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  if (isExchangeConsignment) {
    return (
      <>
        <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="w-full max-w-md flex flex-col overflow-hidden rounded-3xl bg-white shadow-2xl animate-in fade-in scale-in-100 duration-300">
            <div className="flex items-center justify-between p-6 border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">Steadfast Unavailable</h2>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 mx-auto">
                <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <p className="text-center text-gray-600">
                Steadfast does not support exchange consignments. Please use <strong>CarryBee</strong> or <strong>Paperfly</strong> to ship exchange items.
              </p>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-gray-100">
              <Button onClick={onClose} variant="ghost" className="flex-1">
                Close
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden rounded-3xl bg-white shadow-2xl animate-in fade-in scale-in-100 duration-300">
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <h2 className="text-2xl font-bold text-gray-900">{isExchangeConsignment ? 'Exchange — ' : ''}Add to Steadfast</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
          </div>
          <div className="p-6 space-y-4 overflow-y-auto">
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                <p className="font-semibold">Error:</p>
                <p>{error}</p>
              </div>
            )}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Order Number</label>
              <p className="text-gray-900">{order?.orderNumber || '-'}</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Customer Name</label>
              <p className="text-gray-900">{customer?.name || '-'}</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Customer Phone</label>
              <p className="text-gray-900">{customer?.phone || '-'}</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Customer Address</label>
              <p className="text-gray-900">{customer?.address || '-'}</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">COD Amount</label>
              <p className="text-lg font-bold text-gray-900">৳ {order?.total?.toFixed(2) || '0.00'}</p>
            </div>
          </div>
          <div className="flex gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
            <Button
              onClick={onClose}
              variant="ghost"
              className="flex-1"
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              variant="primary"
              className="flex-1"
              loading={submitting}
              disabled={submitting || !order || !customer}
            >
              {submitting ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default SteadfastModal;
