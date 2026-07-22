import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { theme } from '../theme';
import { Button, NumericInput } from './index';
import { OrderStatus, type Order, type Customer } from '../types';
import { useCourierSettings } from '../src/hooks/useQueries';
import { fetchPaperflyOrderTracking, submitPaperflyOrder, submitPaperflyExchangeOrder } from '../src/services/supabaseQueries';
import { useUpdateOrder } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { db } from '../db';
import { formatDateTimeParts } from '../utils';

interface PaperflyModalProps {
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

function getPaperflyPickupMarker(payload: any): string {
  const trackingEntries = [
    payload?.success?.trackingStatus,
    payload?.trackingStatus,
    payload?.data?.trackingStatus,
    payload?.data?.success?.trackingStatus,
  ].find((candidate) => Array.isArray(candidate) && candidate.length > 0 && typeof candidate[0] === 'object');

  if (!Array.isArray(trackingEntries)) {
    return '';
  }

  const positivePatterns = [/\bpicked\b/i, /\bpickup\b/i, /\bpicked up\b/i, /\bcollected\b/i, /\bin transit\b/i, /\bshipped\b/i, /\bdelivered\b/i, /\breturned\b/i, /\bdispatch(?:ed)?\b/i, /\breceived\b/i];
  const negativePatterns = [/\bnot picked\b/i, /\bnot pickup\b/i, /\bpending\b/i, /\bbooked\b/i, /\border placed\b/i, /\bcreated\b/i, /\bcancel(?:led)?\b/i];

  for (const entry of trackingEntries) {
    if (!entry || typeof entry !== 'object') continue;

    const directMarker = [entry.Pick, entry.pick, entry.Pickup, entry.pickup]
      .find((value) => typeof value === 'string' && value.trim() !== '');
    if (typeof directMarker === 'string') {
      const normalizedMarker = directMarker.trim().toLowerCase();
      if (!['0', 'false', 'no', 'n/a', 'na', 'null', 'none', 'pending'].includes(normalizedMarker)) {
        return directMarker.trim();
      }
    }

    const scalarValues = Object.values(entry)
      .filter((value): value is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof value))
      .map((value) => String(value).trim())
      .filter(Boolean);
    if (scalarValues.length === 0) continue;

    const combined = scalarValues.join(' | ');
    const hasPositiveSignal = positivePatterns.some((pattern) => pattern.test(combined));
    const hasNegativeSignal = negativePatterns.some((pattern) => pattern.test(combined));

    if (hasPositiveSignal && !hasNegativeSignal) {
      return combined;
    }
  }

  return '';
}

export const PaperflyModal: React.FC<PaperflyModalProps> = ({ isOpen, onClose, order, customer, isExchangeConsignment }) => {
  const queryClient = useQueryClient();
  const { data: courierSettings } = useCourierSettings();
  const toast = useToastNotifications();
  const updateOrder = useUpdateOrder();

  const [storeName, setStoreName] = useState('');
  const [productBrief, setProductBrief] = useState('');
  const [maxWeightKg, setMaxWeightKg] = useState<number>(0.3);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const defaultShopName = courierSettings?.paperfly?.defaultShopName || '';
    const defaultWeight = Number(courierSettings?.paperfly?.maxWeightKg ?? 0.3);
    setStoreName(defaultShopName);
    setProductBrief(order?.notes || '');
    setMaxWeightKg(Number.isFinite(defaultWeight) ? defaultWeight : 0.3);
    setError(null);
  }, [isOpen, courierSettings?.paperfly?.defaultShopName, courierSettings?.paperfly?.maxWeightKg, order?.notes]);

  if (!isOpen) return null;

  const looksLikePhone = (value: string): boolean => /^[+]?[\d\s\-()]{7,20}$/.test(value.trim());
  const rawPhone = String(customer?.phone || '').trim();
  const rawAddress = String(customer?.address || '').trim();
  const normalizedCustomerPhone = !looksLikePhone(rawPhone) && looksLikePhone(rawAddress) ? rawAddress : rawPhone;
  const normalizedCustomerAddress = !looksLikePhone(rawPhone) && looksLikePhone(rawAddress) ? rawPhone : rawAddress;

  const handleSubmit = async () => {
    setError(null);

    if (!order || !customer) {
      setError('Missing order or customer information');
      return;
    }

    const paperfly = courierSettings?.paperfly;
    if (!paperfly) {
      setError('No Paperfly credentials configured');
      return;
    }

    const { baseUrl, username, password, paperflyKey } = paperfly;
    if (!baseUrl || !username || !password || !paperflyKey) {
      setError('Incomplete Paperfly settings. Please configure Base URL, Username, Password and Paperfly Key.');
      return;
    }
    if (!storeName.trim()) {
      setError('Store name is required');
      return;
    }
    if (!Number.isFinite(maxWeightKg) || maxWeightKg <= 0) {
      setError('Max weight must be a positive number');
      return;
    }

    setSubmitting(true);
    try {
      let result: any;

      if (isExchangeConsignment) {
        // Exchange consignment — use the exchange endpoint
        console.log('[PaperflyModal] Submitting exchange order:', {
          merchantOrderReference: order.orderNumber,
          storeName: storeName.trim(),
          customerName: customer.name,
        });
        result = await submitPaperflyExchangeOrder({
          baseUrl,
          username,
          password,
          paperflyKey,
          merchantOrderReference: order.orderNumber,
          storeName: storeName.trim(),
          productBrief: productBrief || 'Exchange product',
          packagePrice: String(order.total || 0),
          maxWeightKg: String(maxWeightKg),
          customerName: customer.name || '',
          customerAddress: normalizedCustomerAddress,
          customerPhone: normalizedCustomerPhone,
          exchangeDescription: 'Exchange product',
          exchangePrice: String(order.total || 0),
          exchangeWeightKg: String(maxWeightKg),
        });
      } else {
        result = await submitPaperflyOrder({
          baseUrl,
          username,
          password,
          paperflyKey,
          merchantOrderReference: order.orderNumber,
          storeName: storeName.trim(),
          productBrief: productBrief || '',
          packagePrice: String(order.total || 0),
          maxWeightKg: String(maxWeightKg),
          customerName: customer.name || '',
          customerAddress: normalizedCustomerAddress,
          customerPhone: normalizedCustomerPhone,
        });
      }

      if (result.error) {
        setError(result.error);
        return;
      }

      const trackingNumber =
        result?.success?.tracking_number ||
        result?.tracking_number ||
        result?.data?.success?.tracking_number ||
        result?.data?.tracking_number ||
        null;
      const paperflyReferenceNumber = String(order.orderNumber || '').trim();

      const historyParts = [`${isExchangeConsignment ? 'Exchange s' : 'S'}ent to Paperfly by ${db.currentUser?.name || 'System'} on ${formatHistoryMoment()}`];
      if (paperflyReferenceNumber) {
        historyParts.push(`Reference: ${paperflyReferenceNumber}`);
      }
      if (trackingNumber) {
        historyParts.push(`Courier ID: ${trackingNumber}`);
      }
      const historyText = historyParts.map((part, index) => (index === 0 ? part : `(${part})`)).join(' ');

      const updates: any = {
        history: {
          ...order.history,
        },
      };

      if (isExchangeConsignment) {
        updates.exchangeCourier = 'paperfly';
        updates.history.exchangeCourier = historyText;
        if (paperflyReferenceNumber) updates.exchangePaperflyTrackingNumber = paperflyReferenceNumber;
      } else {
        updates.status = OrderStatus.COURIER_ASSIGNED;
        updates.history.courier = historyText;
        if (paperflyReferenceNumber) updates.paperflyTrackingNumber = paperflyReferenceNumber;

        if (paperflyReferenceNumber) {
          try {
            const pickupCheck = await fetchPaperflyOrderTracking({
              baseUrl,
              username,
              password,
              paperflyKey,
              referenceNumber: paperflyReferenceNumber,
            });

            if (!pickupCheck.error && pickupCheck.data) {
              const pickupMarker = getPaperflyPickupMarker(pickupCheck.data);
              if (pickupMarker !== '') {
                updates.status = OrderStatus.PICKED;
                updates.history.picked = `Marked as picked automatically after Paperfly confirmed pickup${pickupMarker ? ` (${pickupMarker})` : ''} on ${formatHistoryMoment()}`;
              } else {
                console.log('[PaperflyModal] Immediate pickup check did not confirm pickup yet.');
              }
            } else {
              console.warn('[PaperflyModal] Immediate pickup verification failed:', pickupCheck.error || 'Unknown error');
            }
          } catch (pickupCheckError) {
            console.warn('[PaperflyModal] Immediate pickup verification threw an error:', pickupCheckError);
          }
        }
      }

      await updateOrder.mutateAsync({ id: order.id, updates });

      onClose();
      void queryClient.invalidateQueries({ queryKey: ['orders'], exact: false });
      toast.success('Order sent to Paperfly successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
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
            <h2 className="text-2xl font-bold text-gray-900">{isExchangeConsignment ? 'Exchange — ' : ''}Add to Paperfly</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
          </div>
          <div className="p-6 space-y-4 overflow-y-auto">
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                <p className="font-semibold">Error:</p>
                <p>{error}</p>
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">Store Name</label>
              <input
                type="text"
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">Product Brief</label>
              <input
                type="text"
                value={productBrief}
                onChange={(e) => setProductBrief(e.target.value)}
                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">Order Reference</label>
              <input
                type="text"
                value={order?.orderNumber || ''}
                disabled
                className="w-full px-4 py-2 bg-gray-100 border border-gray-200 rounded-lg text-gray-700"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">Max Weight (kg)</label>
              <NumericInput
                value={maxWeightKg}
                onChange={(value) => setMaxWeightKg(value)}
                className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2"
                allowDecimals={true}
                decimalPlaces={2}
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Customer Name</label>
              <p className="text-gray-900">{customer?.name || '-'}</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Customer Phone</label>
              <p className="text-gray-900">{normalizedCustomerPhone || '-'}</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">Customer Address</label>
              <p className="text-gray-900">{normalizedCustomerAddress || '-'}</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">COD to Collect</label>
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

export default PaperflyModal;
