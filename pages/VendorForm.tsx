
import React, { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Vendor } from '../types';
import { Button } from '../components';
import { theme } from '../theme';
import { useBeSmartSettings, useVendor } from '../src/hooks/useQueries';
import { useCreateVendor, useUpdateVendor } from '../src/hooks/useMutations';
import { useAuth } from '../src/contexts/AuthProvider';
import { sanitizePhoneInput } from '../utils';
import { useCapabilities } from '../src/hooks/useCapabilities';

const VendorForm: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const isEdit = Boolean(id);
  const { capabilities, isLoading: capabilitiesLoading } = useCapabilities(Boolean(user));
  const hasBeSmart = Boolean(capabilities.be_smart);
  const { data: beSmartSettings, isPending: smartSettingsLoading } = useBeSmartSettings(hasBeSmart);
  const smartMode = hasBeSmart && Boolean(beSmartSettings?.smartVendorAdding);
  
  const [form, setForm] = useState({ name: '', phone: '', address: '' });
  const [smartInput, setSmartInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: vendor, isPending: loading, error: fetchError } = useVendor(isEdit ? id : undefined);
  const createMutation = useCreateVendor();
  const updateMutation = useUpdateVendor();

  useEffect(() => {
    if (vendor) {
      setForm({ 
        name: vendor.name, 
        phone: vendor.phone, 
        address: vendor.address 
      });
      setSmartInput([vendor.name, vendor.phone, vendor.address].filter(Boolean).join('\n'));
      return;
    }

    // If navigated here from a form, and an optimistic vendor exists in cache, populate
    const state: any = (location && (location as any).state) || {};
    if (state.fromBillForm && state.preFill && (state.preFill.name || state.preFill.phone || state.preFill.address)) {
      setForm({
        name: state.preFill.name || '',
        phone: state.preFill.phone || '',
        address: state.preFill.address || '',
      });
      setSmartInput([state.preFill.name, state.preFill.phone, state.preFill.address].filter(Boolean).join('\n'));
    }
  }, [vendor, location]);

  if (authLoading || capabilitiesLoading || (hasBeSmart && smartSettingsLoading)) {
    return (
      <div className="p-8 text-center">
        <h2 className="mb-4 text-2xl font-bold text-gray-900">Loading...</h2>
        <p className="mb-6 text-gray-500">Preparing the vendor form...</p>
      </div>
    );
  }

  const handleSave = async () => {
    if (authLoading) {
      setError('Authenticating... Please wait');
      return;
    }
    
    if (smartMode && !smartInput.trim()) {
      setError('Paste the vendor details before saving');
      return;
    }

    if (!smartMode && (!form.name || !form.phone)) {
      setError('Business name and phone are required');
      return;
    }

    if (!smartMode && !/^0\d{10}$/.test(form.phone)) {
      setError('Phone number must be 11 digits and start with 0');
      return;
    }
    
    setError(null);
    
    try {
      if (isEdit) {
        const updates: Partial<Vendor> = smartMode
          ? { smartInput: smartInput.trim() }
          : { name: form.name, phone: form.phone, address: form.address };
        await updateMutation.mutateAsync({ id: id!, updates });
        navigate('/vendors');
      } else {
        const newVendor: Omit<Vendor, 'id'> = {
          name: smartMode ? '' : form.name,
          phone: smartMode ? '' : form.phone,
          address: smartMode ? '' : form.address,
          totalPurchases: 0,
          dueAmount: 0,
          ...(smartMode ? { smartInput: smartInput.trim() } : {}),
        };

        try {
          const created = await createMutation.mutateAsync(newVendor);

          // Cache updated deterministically by mutation hook

          const state: any = (location && (location as any).state) || {};
          if (state.fromBillForm && state.redirectPath) {
            const url = `${state.redirectPath}${state.redirectPath.includes('?') ? '&' : '?'}selectedVendorId=${created.id}`;
            navigate(url);
          } else {
            navigate('/vendors');
          }
        } catch (err: any) {
          console.error('Create vendor failed:', err);
          setError(err instanceof Error ? err.message : 'Failed to create vendor');
        }
      }
    } catch (err) {
      console.error(`Failed to ${isEdit ? 'update' : 'create'} vendor:`, err);
      setError(err instanceof Error ? err.message : `Failed to ${isEdit ? 'update' : 'create'} vendor`);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h2 className="md:text-2xl text-xl font-black text-gray-900 tracking-tight">{isEdit ? 'Edit Vendor' : 'New Vendor'}</h2>
        <button onClick={() => navigate(-1)} className="px-4 py-2 text-gray-500 font-bold hover:bg-gray-100 rounded-xl transition-all">Cancel</button>
      </div>
      <div className="bg-white p-10 rounded-xl border border-gray-100 shadow-xl space-y-8">
        {isEdit && loading ? (
          <div className="text-center text-gray-500">Loading vendor...</div>
        ) : (
          <>
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm font-bold text-red-600">{String(error)}</p>
              </div>
            )}
            {smartMode ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4">
                  <p className="text-sm font-black text-blue-900">Paste exactly what the vendor sent you</p>
                  <p className="mt-1 text-sm font-medium text-blue-700">Name, phone, and address can be on separate lines or mixed together. They will be extracted when you save.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-widest text-gray-400">Vendor details</label>
                  <textarea
                    autoFocus
                    className="min-h-[240px] w-full rounded-2xl border border-gray-200 bg-gray-50 px-6 py-5 font-medium leading-7 outline-none transition-all focus:border-[#3c5a82] focus:bg-white"
                    value={smartInput}
                    onChange={(event) => setSmartInput(event.target.value)}
                    placeholder={'Example:\nKarim Traders\n০১৮১২ ৩৪৫৬৭৮\nChawkbazar, Chattogram'}
                  />
                  <p className="text-xs font-semibold text-gray-400">Bengali digits and +880 numbers are converted to an 11-digit local phone number.</p>
                </div>
              </div>
            ) : (
            <>
            <div className="space-y-2">
              <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Full Name</label>
              <input 
                type="text" 
                className="w-full px-6 py-4 bg-gray-50 border border-gray-200 focus:border-[#3c5a82] focus:bg-white rounded-2xl font-bold transition-all outline-none"
                value={form.name}
                onChange={e => setForm({...form, name: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Phone Number</label>
              <input 
                type="text" 
                inputMode="numeric"
                pattern="^0\d{10}$"
                maxLength={11}
                className="w-full px-6 py-4 bg-gray-50 border border-gray-200 focus:border-[#3c5a82] focus:bg-white rounded-2xl font-bold transition-all outline-none"
                value={form.phone}
                onChange={e => {
                  const phoneValue = sanitizePhoneInput(e.target.value);
                  if (phoneValue === '' || phoneValue.startsWith('0')) {
                    setForm({...form, phone: phoneValue});
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Address</label>
              <textarea 
                className="w-full px-6 py-4 bg-gray-50 border border-gray-200 focus:border-[#3c5a82] focus:bg-white rounded-lg font-medium h-32 transition-all outline-none"
                value={form.address}
                onChange={e => setForm({...form, address: e.target.value})}
              />
            </div>
            </>
            )}
            <Button 
              onClick={handleSave}
              variant="primary"
              size="lg"
              className="w-full"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) ? (isEdit ? 'Updating...' : 'Adding...') : (isEdit ? 'Update Vendor' : 'Add Vendor')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default VendorForm;
