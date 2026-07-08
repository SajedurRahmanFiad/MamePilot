import React, { useState, useEffect } from 'react';
import { Button, NumericInput } from './index';
import { theme } from '../theme';
import { fetchCarryBeeCities, fetchCarryBeeZones, fetchCarryBeeAreas, submitCarryBeeOrder } from '../src/services/supabaseQueries';
import { useCourierSettings } from '../src/hooks/useQueries';
import { useUpdateOrder } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { db } from '../db';
import { type Order, type Customer } from '../types';

interface CarryBeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  order?: Order | null;
  customer?: Customer | null;
}

interface Location {
  id: string;
  name: string;
}

export const CarryBeeModal: React.FC<CarryBeeModalProps> = ({ isOpen, onClose, order, customer }) => {
  const { data: courierSettings } = useCourierSettings();
  const toast = useToastNotifications();
  
  // State for basic fields
  const [weight, setWeight] = useState(1000);
  const [deliveryType, setDeliveryType] = useState('1');
  
  // State for locations
  const [selectedCity, setSelectedCity] = useState('');
  const [selectedZone, setSelectedZone] = useState('');
  const [selectedArea, setSelectedArea] = useState('');
  
  // State for dropdown data
  const [cities, setCities] = useState<Location[]>([]);
  const [zones, setZones] = useState<Location[]>([]);
  const [areas, setAreas] = useState<Location[]>([]);
  
  // Loading states
  const [loadingCities, setLoadingCities] = useState(false);
  const [loadingZones, setLoadingZones] = useState(false);
  const [loadingAreas, setLoadingAreas] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const updateOrder = useUpdateOrder();

  // Fetch cities on mount
  useEffect(() => {
    const fetchCities = async () => {
      if (!courierSettings?.carryBee?.baseUrl || !courierSettings?.carryBee?.clientId || 
          !courierSettings?.carryBee?.clientSecret || !courierSettings?.carryBee?.clientContext) {
        setCities([]);
        return;
      }

      setLoadingCities(true);
      try {
        const citiesList = await fetchCarryBeeCities({
          baseUrl: courierSettings.carryBee.baseUrl,
          clientId: courierSettings.carryBee.clientId,
          clientSecret: courierSettings.carryBee.clientSecret,
          clientContext: courierSettings.carryBee.clientContext,
        });
        setCities(citiesList);
      } catch (err) {
        console.error('Failed to fetch cities:', err);
        setCities([]);
      } finally {
        setLoadingCities(false);
      }
    };

    if (isOpen) {
      fetchCities();
    }
  }, [isOpen, courierSettings]);

  // Fetch zones when city changes
  useEffect(() => {
    const fetchZones = async () => {
      if (!selectedCity || !courierSettings?.carryBee?.baseUrl || !courierSettings?.carryBee?.clientId) {
        setZones([]);
        setSelectedZone('');
        setSelectedArea('');
        setAreas([]);
        return;
      }

      setLoadingZones(true);
      try {
        const zonesList = await fetchCarryBeeZones({
          baseUrl: courierSettings.carryBee.baseUrl,
          clientId: courierSettings.carryBee.clientId,
          clientSecret: courierSettings.carryBee.clientSecret,
          clientContext: courierSettings.carryBee.clientContext,
          cityId: selectedCity,
        });
        setZones(zonesList);
      } catch (err) {
        console.error('Failed to fetch zones:', err);
        setZones([]);
      } finally {
        setLoadingZones(false);
      }
    };

    fetchZones();
  }, [selectedCity, courierSettings]);

  // Fetch areas when zone changes
  useEffect(() => {
    const fetchAreas = async () => {
      if (!selectedZone || !selectedCity || !courierSettings?.carryBee?.baseUrl || !courierSettings?.carryBee?.clientId) {
        setAreas([]);
        setSelectedArea('');
        return;
      }

      setLoadingAreas(true);
      try {
        const areasList = await fetchCarryBeeAreas({
          baseUrl: courierSettings.carryBee.baseUrl,
          clientId: courierSettings.carryBee.clientId,
          clientSecret: courierSettings.carryBee.clientSecret,
          clientContext: courierSettings.carryBee.clientContext,
          cityId: selectedCity,
          zoneId: selectedZone,
        });
        setAreas(areasList);
      } catch (err) {
        console.error('Failed to fetch areas:', err);
        setAreas([]);
      } finally {
        setLoadingAreas(false);
      }
    };

    fetchAreas();
  }, [selectedZone, selectedCity, courierSettings]);

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
        <div className={`${theme.card.elevated} w-full max-w-2xl max-h-[calc(100vh-2rem)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300`}>
          <div className="flex items-center justify-between p-6 border-b border-gray-100">
            <h2 className="text-2xl font-bold text-gray-900">Add to CarryBee</h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
          </div>
          <div className="p-6 space-y-4 overflow-y-auto">
            {/* Weight Field */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">
                Weight <span className="text-red-500">*</span>
              </label>
              <div className="flex items-center gap-2">
                <NumericInput
                  value={weight}
                  onChange={(value) => setWeight(value)}
                  className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2"
                  allowDecimals={false}
                />
                <span className="text-sm font-semibold text-gray-700 whitespace-nowrap">grams</span>
              </div>
            </div>

            {/* Delivery Type Dropdown */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">
                Delivery Type <span className="text-red-500">*</span>
              </label>
              <select
                value={deliveryType}
                onChange={(e) => setDeliveryType(e.target.value)}
                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg"
              >
                <option value="1">Normal Delivery (Type 1)</option>
                <option value="2">Express Delivery (Type 2)</option>
              </select>
            </div>

            {/* City Dropdown */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">
                City <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                disabled={loadingCities || cities.length === 0}
                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {loadingCities ? 'Loading cities...' : cities.length === 0 ? 'No cities available' : 'Select a city'}
                </option>
                {cities.map(city => (
                  <option key={city.id} value={city.id}>{city.name}</option>
                ))}
              </select>
            </div>

            {/* Zone Dropdown */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">
                Zone <span className="text-red-500">*</span>
              </label>
              <select
                value={selectedZone}
                onChange={(e) => setSelectedZone(e.target.value)}
                disabled={!selectedCity || loadingZones || zones.length === 0}
                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {!selectedCity ? 'Select a city first' : loadingZones ? 'Loading zones...' : zones.length === 0 ? 'No zones available' : 'Select a zone'}
                </option>
                {zones.map(zone => (
                  <option key={zone.id} value={zone.id}>{zone.name}</option>
                ))}
              </select>
            </div>

            {/* Area Dropdown */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">Area</label>
              <select
                value={selectedArea}
                onChange={(e) => setSelectedArea(e.target.value)}
                disabled={!selectedZone || loadingAreas}
                className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="">
                  {!selectedZone ? 'Select a zone first' : loadingAreas ? 'Loading areas...' : areas.length === 0 ? 'No areas available' : 'Select an area (optional)'}
                </option>
                {areas.map(area => (
                  <option key={area.id} value={area.id}>{area.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3 px-6 py-4 border-t border-gray-100 shrink-0">
            <Button
              onClick={onClose}
              variant="ghost"
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!selectedCity || !selectedZone) {
                  alert('Please select both City and Zone');
                  return;
                }

                if (!order || !customer) {
                  alert('Missing order or customer information');
                  console.error('Missing order or customer:', { order, customer });
                  return;
                }

                if (!courierSettings?.carryBee) {
                  alert('CarryBee settings not configured');
                  console.error('Missing CarryBee settings:', courierSettings);
                  return;
                }

                const { baseUrl, clientId, clientSecret, clientContext, storeId } = courierSettings.carryBee;
                
                if (!baseUrl || !clientId || !clientSecret || !clientContext || !storeId) {
                  alert('CarryBee settings incomplete. Please configure Base URL, Client ID, Client Secret, Client Context, and Store ID in Settings.');
                  console.error('Incomplete CarryBee settings:', { baseUrl, clientId, clientSecret, clientContext, storeId });
                  return;
                }

                setSubmitting(true);
                try {
                  console.log('[CarryBeeModal] Submitting order:', {
                    storeId,
                    deliveryType: Number(deliveryType),
                    recipientPhone: customer.phone,
                    recipientName: customer.name,
                    cityId: selectedCity,
                    zoneId: selectedZone,
                    areaId: selectedArea || undefined,
                    itemWeight: weight,
                    collectableAmount: order.total,
                  });

                  const result = await submitCarryBeeOrder({
                    baseUrl,
                    clientId,
                    clientSecret,
                    clientContext,
                    storeId,
                    deliveryType: Number(deliveryType),
                    productType: 1,
                    recipientPhone: customer.phone,
                    recipientName: customer.name,
                    recipientAddress: customer.address || '',
                    cityId: selectedCity,
                    zoneId: selectedZone,
                    areaId: selectedArea || undefined,
                    itemWeight: weight,
                    collectableAmount: order.total || 0,
                  });

                  if (result.error) {
                    toast.error(`Failed to send order: ${result.error}`);
                  } else {
                    try {
                      // Extract consignment id from possible response shapes
                      // Edge function returns data that may nest the order object.
                      // Check several possible paths defensively.
                      const consignmentId = (
                        result?.order?.consignment_id ||
                        result?.order?.consignmentId ||
                        result?.consignment_id ||
                        result?.consignmentId ||
                        result?.data?.order?.consignment_id ||
                        result?.data?.order?.consignmentId ||
                        result?.data?.consignment_id ||
                        result?.data?.consignmentId ||
                        result?.data?.data?.order?.consignment_id ||
                        result?.data?.data?.order?.consignmentId ||
                        result?.data?.data?.consignment_id ||
                        result?.data?.data?.consignmentId ||
                        null
                      );

                      const historyText = `Sent to CarryBee by ${db.currentUser?.name || 'System'} on ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, at ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })}`;

                      const updates: any = {
                        status: OrderStatus.COURIER_ASSIGNED,
                        history: {
                          ...order.history,
                          courier: historyText,
                        },
                      };
                      if (consignmentId) updates.carrybeeConsignmentId = consignmentId;

                      console.log('[CarryBeeModal] Updating order with courier history:', updates);
                      await updateOrder.mutateAsync({ id: order.id, updates });
                      console.log('[CarryBeeModal] Courier status updated and UI refreshed');

                    } catch (err) {
                      console.error('[CarryBeeModal] Failed to update order sent flag or consignment id:', err);
                    }
                    onClose();
                    toast.success('Order sent to CarryBee successfully');
                  }
                } catch (err) {
                  console.error('Error submitting order:', err);
                  toast.error('Error sending order to CarryBee');
                } finally {
                  setSubmitting(false);
                }
              }}
              variant="primary"
              className="flex-1"
              loading={submitting}
              disabled={!selectedCity || !selectedZone || submitting}
            >
              {submitting ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
};

export default CarryBeeModal;
