import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from './index';
import { theme } from '../theme';
import { OrderStatus, type Order, type Customer } from '../types';
import { useCourierSettings } from '../src/hooks/useQueries';
import { submitPathaoOrder, generatePathaoToken, refreshPathaoToken, fetchPathaoOrderInfo, updateCourierSettings } from '../src/services/supabaseQueries';
import { useUpdateOrder } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { db } from '../db';
import { formatDateTimeParts } from '../utils';

interface PathaoModalProps {
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

function getPathaoPickupStatus(orderStatusSlug: string): { rawStatus: string; isPickedOrBeyond: boolean } {
  const normalized = (orderStatusSlug || '').toLowerCase().trim();
  const nonPickedKeywords = ['pending', 'cancelled', 'canceled'];
  return {
    rawStatus: orderStatusSlug,
    isPickedOrBeyond: normalized !== '' && !nonPickedKeywords.some(k => normalized.includes(k)),
  };
}

export const PathaoModal: React.FC<PathaoModalProps> = ({ isOpen, onClose, order, customer, isExchangeConsignment }) => {
  const queryClient = useQueryClient();
  const { data: courierSettings, refetch: refetchCourierSettings } = useCourierSettings();
  const toast = useToastNotifications();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateOrder = useUpdateOrder();

  if (!isOpen) return null;

  const ensureValidToken = async (): Promise<string | null> => {
    if (!courierSettings?.pathao) return null;

    const { baseUrl, clientId, clientSecret, username, password, accessToken, refreshToken, tokenExpiresAt } = courierSettings.pathao;

    // Check if current token is still valid (with 5 min buffer)
    if (accessToken && tokenExpiresAt) {
      const expiresAt = new Date(tokenExpiresAt).getTime();
      const now = Date.now();
      if (expiresAt - now > 5 * 60 * 1000) {
        return accessToken;
      }
    }

    // Try refresh token first
    if (refreshToken && baseUrl && clientId && clientSecret) {
      try {
        const result = await refreshPathaoToken({ baseUrl, clientId, clientSecret, refreshToken });
        if (!result.error && result.accessToken) {
          const expiresAt = new Date(Date.now() + (result.expiresIn || 86400) * 1000).toISOString();
          await updateCourierSettings({
            pathao: {
              accessToken: result.accessToken,
              refreshToken: result.refreshToken || refreshToken,
              tokenExpiresAt: expiresAt,
            },
          } as any);
          await refetchCourierSettings();
          return result.accessToken;
        }
      } catch (e) {
        console.warn('[PathaoModal] Token refresh failed, trying password grant:', e);
      }
    }

    // Fall back to password grant
    if (baseUrl && clientId && clientSecret && username && password) {
      try {
        const result = await generatePathaoToken({ baseUrl, clientId, clientSecret, username, password });
        if (!result.error && result.accessToken) {
          const expiresAt = new Date(Date.now() + (result.expiresIn || 86400) * 1000).toISOString();
          await updateCourierSettings({
            pathao: {
              accessToken: result.accessToken,
              refreshToken: result.refreshToken || '',
              tokenExpiresAt: expiresAt,
            },
          } as any);
          await refetchCourierSettings();
          return result.accessToken;
        }
        setError(result.error || 'Failed to generate Pathao access token');
        return null;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to generate Pathao access token');
        return null;
      }
    }

    setError('Pathao credentials are not fully configured');
    return null;
  };

  const handleSubmit = async () => {
    setError(null);

    if (!order || !customer) {
      setError('Missing order or customer information');
      return;
    }

    if (!courierSettings?.pathao) {
      setError('No Pathao credentials configured');
      return;
    }

    const { baseUrl, storeId, defaultDeliveryType, defaultItemType, defaultQuantity, defaultWeight } = courierSettings.pathao;

    if (!baseUrl || !storeId) {
      setError('Incomplete Pathao credentials - baseUrl and storeId are required');
      return;
    }

    setSubmitting(true);
    try {
      // Ensure we have a valid access token
      const token = await ensureValidToken();
      if (!token) {
        setSubmitting(false);
        return;
      }

      // Build special instruction from additional phone or notes
      const specialInstruction = customer.phone ? `Phone: ${customer.phone}` : '';

      const result = await submitPathaoOrder({
        baseUrl,
        accessToken: token,
        storeId,
        recipientName: customer.name,
        recipientPhone: customer.phone,
        recipientAddress: customer.address,
        deliveryType: defaultDeliveryType || 48,
        itemType: defaultItemType || 2,
        itemQuantity: defaultQuantity || 1,
        itemWeight: defaultWeight || 1.0,
        amountToCollect: Math.max(0, Math.round(order.total)),
        specialInstruction: specialInstruction || undefined,
      });

      if (result.error) {
        setError(typeof result.error === 'string' ? result.error : 'Order submission failed');
        return;
      }

      // Extract consignment_id from response
      const consignmentId = (
        result?.data?.consignment_id ??
        result?.consignment_id ??
        result?.data?.consignmentId ??
        result?.consignmentId ??
        null
      );

      const merchantOrderId = (
        result?.data?.merchant_order_id ??
        result?.merchant_order_id ??
        null
      );

      const historyText = `${isExchangeConsignment ? 'Exchange s' : 'S'}ent to Pathao by ${db.currentUser?.name || 'System'} on ${formatHistoryMoment()}${consignmentId ? ` (Consignment: ${consignmentId})` : ''}`;

      const updates: any = {
        history: {
          ...order.history,
        },
      };

      if (isExchangeConsignment) {
        updates.exchangeCourier = 'pathao';
        updates.history.exchangeCourier = historyText;
        if (consignmentId) updates.exchangePathaoConsignmentId = String(consignmentId);
      } else {
        updates.status = OrderStatus.COURIER_ASSIGNED;
        updates.history.courier = historyText;
        if (consignmentId) updates.pathaoConsignmentId = String(consignmentId);

        // Immediate pickup check
        if (consignmentId) {
          try {
            const pickupCheck = await fetchPathaoOrderInfo({
              baseUrl,
              accessToken: token,
              consignmentId: String(consignmentId),
            });

            if (!pickupCheck.error && pickupCheck.data) {
              const responseData = pickupCheck.data;
              const orderData = responseData?.data || responseData;
              const orderStatusSlug = orderData?.order_status_slug || orderData?.order_status || '';
              const pickupStatus = getPathaoPickupStatus(orderStatusSlug);
              if (pickupStatus.isPickedOrBeyond) {
                updates.status = OrderStatus.PICKED;
                updates.history.picked = `Marked as picked automatically after Pathao confirmed status "${pickupStatus.rawStatus}" on ${formatHistoryMoment()}`;
              }
            }
          } catch (pickupCheckError) {
            console.warn('[PathaoModal] Immediate pickup verification threw an error:', pickupCheckError);
          }
        }
      }

      await updateOrder.mutateAsync({ id: order.id, updates });
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['orders'], exact: false });
      toast.success('Order sent to Pathao successfully');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
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
            <h2 className="text-2xl font-bold text-gray-900">{isExchangeConsignment ? 'Exchange — ' : ''}Add to Pathao</h2>
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
            {courierSettings?.pathao && (
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-gray-100">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Delivery Type</label>
                  <p className="text-sm text-gray-700">{courierSettings.pathao.defaultDeliveryType === 12 ? 'On Demand (12h)' : 'Normal (48h)'}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Item Type</label>
                  <p className="text-sm text-gray-700">{courierSettings.pathao.defaultItemType === 1 ? 'Document' : 'Parcel'}</p>
                </div>
              </div>
            )}
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

export default PathaoModal;
