import React, { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from './index';
import { OrderStatus, type Order, type Customer } from '../types';
import { useCourierSettings } from '../src/hooks/useQueries';
import {
  submitPathaoOrder,
  generatePathaoToken,
  refreshPathaoToken,
  fetchPathaoCities,
  fetchPathaoZones,
  fetchPathaoAreas,
  updateCourierSettings,
} from '../src/services/supabaseQueries';
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

type PathaoLocationOption = { id: string; name: string };

function formatHistoryMoment(): string {
  const { date, time } = formatDateTimeParts(new Date());
  return `${date}, at ${time}`;
}

export const PathaoModal: React.FC<PathaoModalProps> = ({ isOpen, onClose, order, customer, isExchangeConsignment }) => {
  const queryClient = useQueryClient();
  const {
    data: courierSettings,
    error: courierSettingsError,
    isLoading: loadingCourierSettings,
    refetch: refetchCourierSettings,
  } = useCourierSettings();
  const toast = useToastNotifications();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateOrder = useUpdateOrder();
  const [cities, setCities] = useState<PathaoLocationOption[]>([]);
  const [zones, setZones] = useState<PathaoLocationOption[]>([]);
  const [areas, setAreas] = useState<PathaoLocationOption[]>([]);
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedZone, setSelectedZone] = useState('');
  const [selectedArea, setSelectedArea] = useState('');
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingZones, setLoadingZones] = useState(false);
  const [loadingAreas, setLoadingAreas] = useState(false);

  const ensureValidToken = useCallback(async (): Promise<string | null> => {
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
  }, [courierSettings?.pathao, refetchCourierSettings]);

  useEffect(() => {
    if (!isOpen) return;
    if (!courierSettings?.pathao) {
      setCities([]);
      setLoadingCities(loadingCourierSettings);
      setError(loadingCourierSettings ? null : courierSettingsError?.message || 'No Pathao credentials configured');
      return;
    }
    let cancelled = false;
    setSelectedCity('');
    setSelectedZone('');
    setSelectedArea('');
    setCities([]);
    setZones([]);
    setAreas([]);
    setError(null);
    setLoadingCities(true);

    void (async () => {
      try {
        const token = await ensureValidToken();
        if (!token || cancelled) return;
        const items = await fetchPathaoCities();
        if (!cancelled) setCities(items);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load Pathao cities');
      } finally {
        if (!cancelled) setLoadingCities(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, courierSettings?.pathao, courierSettingsError, ensureValidToken, loadingCourierSettings]);

  useEffect(() => {
    if (!isOpen || !selectedCity) {
      setZones([]);
      setLoadingZones(false);
      return;
    }
    let cancelled = false;
    setError(null);
    setLoadingZones(true);
    void fetchPathaoZones({ cityId: selectedCity })
      .then((items) => { if (!cancelled) setZones(items); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load Pathao zones'); })
      .finally(() => { if (!cancelled) setLoadingZones(false); });
    return () => { cancelled = true; };
  }, [isOpen, selectedCity]);

  useEffect(() => {
    if (!isOpen || !selectedZone) {
      setAreas([]);
      setLoadingAreas(false);
      return;
    }
    let cancelled = false;
    setError(null);
    setLoadingAreas(true);
    void fetchPathaoAreas({ zoneId: selectedZone })
      .then((items) => { if (!cancelled) setAreas(items); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load Pathao areas'); })
      .finally(() => { if (!cancelled) setLoadingAreas(false); });
    return () => { cancelled = true; };
  }, [isOpen, selectedZone]);

  if (!isOpen) return null;

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
    if (!selectedCity || !selectedZone) {
      setError('Select a Pathao city and zone before creating the delivery order');
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
        merchantOrderId: order.orderNumber,
        recipientName: customer.name,
        recipientPhone: customer.phone,
        recipientAddress: customer.address,
        recipientCity: selectedCity,
        recipientZone: selectedZone,
        recipientArea: selectedArea || undefined,
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
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
        <div className="w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden rounded-3xl bg-white shadow-2xl animate-in fade-in scale-in-100 duration-300">
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
            <div className="grid grid-cols-1 gap-4 border-t border-gray-100 pt-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700">City <span className="text-red-500">*</span></label>
                <select
                  value={selectedCity}
                  onChange={(event) => {
                    setError(null);
                    setSelectedCity(event.target.value);
                    setSelectedZone('');
                    setSelectedArea('');
                  }}
                  disabled={loadingCities || cities.length === 0 || submitting}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">
                    {loadingCities ? 'Loading cities...' : cities.length === 0 ? 'No cities available' : 'Select a city'}
                  </option>
                  {cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700">Zone <span className="text-red-500">*</span></label>
                <select
                  value={selectedZone}
                  onChange={(event) => {
                    setError(null);
                    setSelectedZone(event.target.value);
                    setSelectedArea('');
                  }}
                  disabled={!selectedCity || loadingZones || zones.length === 0 || submitting}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">
                    {loadingZones
                      ? 'Loading zones...'
                      : !selectedCity
                        ? 'Select a city first'
                        : zones.length === 0
                          ? 'No zones available'
                          : 'Select a zone'}
                  </option>
                  {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                </select>
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-sm font-semibold text-gray-700">Area <span className="font-medium text-gray-400">(optional)</span></label>
                <select
                  value={selectedArea}
                  onChange={(event) => {
                    setError(null);
                    setSelectedArea(event.target.value);
                  }}
                  disabled={!selectedZone || loadingAreas || areas.length === 0 || submitting}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">
                    {loadingAreas
                      ? 'Loading areas...'
                      : !selectedZone
                        ? 'Select a zone first'
                        : areas.length === 0
                          ? 'No areas available'
                          : 'No specific area'}
                  </option>
                  {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                </select>
              </div>
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
              disabled={submitting || !order || !customer || !selectedCity || !selectedZone}
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
