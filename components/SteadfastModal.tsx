import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { theme } from '../theme';
import { OrderStatus, type Order, type Customer } from '../types';
import { useCourierSettings } from '../src/hooks/useQueries';
import { fetchSteadfastStatusByTrackingCode, submitSteadfastOrder } from '../src/services/supabaseQueries';
import { useUpdateOrder } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { db } from '../db';

interface SteadfastModalProps {
  isOpen: boolean;
  onClose: () => void;
  order?: Order | null;
  customer?: Customer | null;
}

const STEADFAST_NON_PICKED_STATUSES = new Set(['pending', 'in_review', 'cancelled']);

function formatHistoryMoment(): string {
  const now = new Date();
  const date = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${date}, at ${time}`;
}

function getSteadfastPickupStatus(payload: any): { rawStatus: string; isPickedOrBeyond: boolean } {
  const rawStatus = [
    payload?.data?.delivery_status,
    payload?.delivery_status,
  ].find((candidate) => typeof candidate === 'string' && candidate.trim() !== '')?.trim() ?? '';

  const normalizedStatus = rawStatus.toLowerCase().replace(/[\s-]+/g, '_');

  return {
    rawStatus,
    isPickedOrBeyond: rawStatus !== '' && !STEADFAST_NON_PICKED_STATUSES.has(normalizedStatus),
  };
}

export const SteadfastModal: React.FC<SteadfastModalProps> = ({ isOpen, onClose, order, customer }) => {
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

    if (!courierSettings?.steadfast) {
      setError('No Steadfast credentials configured');
      console.error('[SteadfastModal] No Steadfast settings');
      return;
    }

    const { baseUrl, apiKey, secretKey } = courierSettings.steadfast;

    // Detailed logging for debugging
    console.log('[SteadfastModal] ======== SUBMISSION DEBUG ========');
    console.log('[SteadfastModal] courierSettings object:', courierSettings);
    console.log('[SteadfastModal] steadfast object:', courierSettings.steadfast);
    console.log('[SteadfastModal] baseUrl:', baseUrl);
    console.log('[SteadfastModal] baseUrl type:', typeof baseUrl);
    console.log('[SteadfastModal] baseUrl empty?:', baseUrl === '' || !baseUrl);
    console.log('[SteadfastModal] baseUrl trimmed empty?:', (baseUrl || '').trim() === '');
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

    const result = await submitSteadfastOrder({
        baseUrl,
        apiKey,
        secretKey,
        invoice: order.orderNumber,
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
            displayError = 'Something went wrong.';
          }
        } catch (e) {
          // Use original error if parsing fails
        }
        setError(displayError);
        console.error('[SteadfastModal] Submission failed:', result.error);
        return;
      }

      console.log('[SteadfastModal] Order submitted successfully to Steadfast');
      try {
        const trackingCode = (
          result?.consignment?.tracking_code ??
          result?.consignment?.trackingCode ??
          result?.tracking_code ??
          result?.trackingCode ??
          result?.data?.consignment?.tracking_code ??
          result?.data?.consignment?.trackingCode ??
          result?.data?.tracking_code ??
          result?.data?.trackingCode ??
          null
        );
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
        const trackingOrConsignment = trackingCode ?? consignmentId;
        const courierStatus = (
          result?.consignment?.status ??
          result?.data?.consignment?.status ??
          (typeof result?.status === 'string' ? result.status : null) ??
          null
        );

        const historyText = `Sent to Steadfast by ${db.currentUser?.name || 'System'} on ${formatHistoryMoment()}${trackingOrConsignment ? ` (Tracking: ${trackingOrConsignment})` : ''}${courierStatus ? ` (Submit status: ${courierStatus})` : ''}`;
        console.log('[SteadfastModal] Setting courier history:', historyText);
        const updates: any = {
          status: OrderStatus.COURIER_ASSIGNED,
          history: {
            ...order.history,
            courier: historyText,
          },
        };

        if (trackingOrConsignment) updates.steadfastConsignmentId = String(trackingOrConsignment);

        if (trackingOrConsignment) {
          try {
            const pickupCheck = await fetchSteadfastStatusByTrackingCode({
              baseUrl,
              apiKey,
              secretKey,
              trackingCode: String(trackingOrConsignment),
            });

            if (!pickupCheck.error && pickupCheck.data) {
              const pickupStatus = getSteadfastPickupStatus(pickupCheck.data);
              if (pickupStatus.isPickedOrBeyond) {
                updates.status = OrderStatus.PICKED;
                updates.history.picked = `Marked as picked automatically after Steadfast confirmed delivery status "${pickupStatus.rawStatus}" on ${formatHistoryMoment()}`;
              } else {
                console.log('[SteadfastModal] Immediate pickup check did not confirm pickup yet:', pickupStatus.rawStatus || 'UNKNOWN');
              }
            } else {
              console.warn('[SteadfastModal] Immediate pickup verification failed:', pickupCheck.error || 'Unknown error');
            }
          } catch (pickupCheckError) {
            console.warn('[SteadfastModal] Immediate pickup verification threw an error:', pickupCheckError);
          }
        }

        await updateOrder.mutateAsync({ id: order.id, updates });
        console.log('[SteadfastModal] Courier status updated and UI refreshed');
      } catch (err) {
        console.error('[SteadfastModal] Failed to update order:', err);
      }
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['orders'], exact: false });
      toast.success('Order sent to Steadfast successfully');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
      console.error('[SteadfastModal] Exception during submission:', errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
        <div className={`${theme.card.elevated} w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300`}>
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <h2 className="text-2xl font-bold text-gray-900">Add to Steadfast</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
          </div>
          <div className="p-6 space-y-4 overflow-y-auto">
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                <p className="font-semibold">Error:</p>
                <p>{error instanceof Error ? error.message : String(error)}</p>
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
