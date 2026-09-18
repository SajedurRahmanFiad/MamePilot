
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Customer } from '../types';
import { Button } from '../components';
import InfoTooltip from '../components/InfoTooltip';
import { useBeSmartSettings, useCompanySettings, useCustomer } from '../src/hooks/useQueries';
import { useCreateCustomer, useUpdateCustomer } from '../src/hooks/useMutations';
import { useAuth } from '../src/contexts/AuthProvider';
import { isTempId } from '../src/utils/optimisticIdMap';
import { sanitizePhoneInput } from '../utils';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { getBusinessTerminology } from '../src/utils/businessMode';

const getHeightParts = (height: number | null | undefined, unit: 'feet-inches' | 'cm') => {
  if (height === null || height === undefined || Number.isNaN(Number(height))) return { height: '', heightFeet: '', heightInches: '' };
  if (unit === 'feet-inches') {
    const totalInches = Number(height);
    return { height: '', heightFeet: String(Math.floor(totalInches / 12)), heightInches: String(Math.round(totalInches % 12)) };
  }
  return { height: String(height), heightFeet: '', heightInches: '' };
};

const CustomerForm: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const isEdit = Boolean(id);
  const { canCreateCustomers, canEditCustomers } = useRolePermissions();
  const { capabilities, settings: capabilitySettings, isLoading: capabilitiesLoading } = useCapabilities(Boolean(user));
  const businessMode = capabilitySettings?.businessMode || 'general_retail';
  const terminology = getBusinessTerminology(businessMode);
  const isVaccineCenter = businessMode === 'vaccine_center';
  const { data: companySettings } = useCompanySettings();
  const weightUnit = companySettings?.weightUnit || 'kg';
  const heightUnit = companySettings?.heightUnit || 'cm';
  const hasBeSmart = Boolean(capabilities.be_smart);
  const { data: beSmartSettings, isPending: smartSettingsLoading } = useBeSmartSettings(hasBeSmart);
  const { data: customer, isPending: loading, error: fetchError } = useCustomer(isEdit ? id : undefined);
  const createMutation = useCreateCustomer();
  const updateMutation = useUpdateCustomer();
  const location = useLocation();
  const queryClient = useQueryClient();
  const smartMode = hasBeSmart && !isVaccineCenter && Boolean(beSmartSettings?.smartCustomerAdding);
  
  const [form, setForm] = useState({
    name: '', phone: '', address: '', age: '', gender: '', weight: '', height: '', heightFeet: '', heightInches: '',
    bloodGroup: '', guardianName: '', emergencyContact: '', additionalNotes: '',
  });
  const [smartInput, setSmartInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    initializedRef.current = false;
  }, [id, location.key]);

  useEffect(() => {
    if (initializedRef.current) {
      return;
    }

    if (customer) {
      setForm({
        name: customer.name,
        phone: customer.phone,
        address: customer.address,
        age: customer.age?.toString() || '', gender: customer.gender || '',
        weight: customer.weight?.toString() || '', ...getHeightParts(customer.height, heightUnit), bloodGroup: customer.bloodGroup || '',
        guardianName: customer.guardianName || '', emergencyContact: customer.emergencyContact || '', additionalNotes: customer.additionalNotes || '',
      });
      setSmartInput([customer.name, customer.phone, customer.address].filter(Boolean).join('\n'));
      initializedRef.current = true;
      return;
    }

    // If this is an optimistic/local-only customer (temp id), populate from cached list.
    if (id && isTempId(id)) {
      const cachedCustomers = queryClient.getQueryData<Customer[]>(['customers']) || [];
      const optimistic = cachedCustomers.find(c => c.id === id);
      if (optimistic) {
        setForm({ name: optimistic.name, phone: optimistic.phone, address: optimistic.address, age: optimistic.age?.toString() || '', gender: optimistic.gender || '', weight: optimistic.weight?.toString() || '', ...getHeightParts(optimistic.height, heightUnit), bloodGroup: optimistic.bloodGroup || '', guardianName: optimistic.guardianName || '', emergencyContact: optimistic.emergencyContact || '', additionalNotes: optimistic.additionalNotes || '' });
        setSmartInput([optimistic.name, optimistic.phone, optimistic.address].filter(Boolean).join('\n'));
        initializedRef.current = true;
      }
      return;
    }

    if (isEdit) {
      return;
    }

    const state: any = (location && (location as any).state) || {};
    const preFill = state.fromOrderForm ? state.preFill : null;
    setForm({
      name: preFill?.name || '',
      phone: preFill?.phone || '',
      address: preFill?.address || '',
      age: '', gender: '', weight: '', height: '', heightFeet: '', heightInches: '', bloodGroup: '', guardianName: '', emergencyContact: '', additionalNotes: '',
    });
    setSmartInput([preFill?.name, preFill?.phone, preFill?.address].filter(Boolean).join('\n'));
    initializedRef.current = true;
  }, [customer, heightUnit, id, isEdit, location, location.key, queryClient]);

  if (authLoading || capabilitiesLoading || (hasBeSmart && smartSettingsLoading)) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Loading...</h2>
        <p className="text-gray-500 mb-6">Preparing the customer form...</p>
      </div>
    );
  }

  const handleSave = async () => {
    if (smartMode && !smartInput.trim()) {
      setError(`Paste the ${terminology.customerLower} details before saving`);
      return;
    }

    if (!smartMode && (!form.name || !form.phone)) {
      setError('Name and phone are required');
      return;
    }

    if (!smartMode && !/^0\d{10}$/.test(form.phone)) {
      setError('Phone number must be 11 digits and start with 0');
      return;
    }
    
    setError(null);
    
    try {
      if (isEdit) {
        const updates: Partial<Customer> = smartMode
          ? { smartInput: smartInput.trim() }
          : { name: form.name, phone: form.phone, address: isVaccineCenter ? '' : form.address, ...(isVaccineCenter ? {
            age: form.age === '' ? null : Number(form.age), gender: form.gender || null,
            weight: form.weight === '' ? null : Number(form.weight), height: heightUnit === 'feet-inches' ? (form.heightFeet === '' ? null : Number(form.heightFeet) * 12 + Number(form.heightInches || 0)) : (form.height === '' ? null : Number(form.height)),
            bloodGroup: form.bloodGroup || null, guardianName: form.guardianName || null, emergencyContact: form.emergencyContact || null,
            additionalNotes: form.additionalNotes || null,
          } : {}) };
        await updateMutation.mutateAsync({ id: id!, updates });
        navigate('/customers');
      } else {
        const newCustomer: Omit<Customer, 'id'> = {
          name: smartMode ? '' : form.name,
          phone: smartMode ? '' : form.phone,
          address: isVaccineCenter ? '' : (smartMode ? '' : form.address),
          ...(isVaccineCenter ? {
            age: form.age === '' ? null : Number(form.age), gender: form.gender || null,
            weight: form.weight === '' ? null : Number(form.weight), height: heightUnit === 'feet-inches' ? (form.heightFeet === '' ? null : Number(form.heightFeet) * 12 + Number(form.heightInches || 0)) : (form.height === '' ? null : Number(form.height)),
            bloodGroup: form.bloodGroup || null, guardianName: form.guardianName || null, emergencyContact: form.emergencyContact || null,
            additionalNotes: form.additionalNotes || null,
          } : {}),
          totalOrders: 0,
          dueAmount: 0,
          ...(smartMode ? { smartInput: smartInput.trim() } : {}),
        };

        // Await the mutation so we can catch AbortError and other failures
        try {
          const created = await createMutation.mutateAsync(newCustomer);
          // Ensure the newly created customer is present in the customers cache
          try {
            queryClient.setQueryData(['customers'], (old: any) => {
              if (!old) return [created];
              // Avoid duplicates (match by id)
              if (Array.isArray(old) && old.some((c: any) => c.id === created.id)) return old;
              return [...old, created];
            });
            queryClient.setQueryData(['customer', created.id], created);
          } catch (e) {
            // ignore cache update errors
          }
          const state: any = (location && (location as any).state) || {};
          if (state.fromOrderForm && state.redirectPath) {
            // Redirect back to the order form and pass the created customer id via query param
            const url = `${state.redirectPath}${state.redirectPath.includes('?') ? '&' : '?'}selectedCustomerId=${created.id}`;
            navigate(url);
          } else {
            navigate('/customers');
          }
        } catch (err: any) {
          console.error('Create customer failed:', err);
          const debug = err?.raw?.debug;
          let msg = err instanceof Error ? err.message : 'Failed to create customer';
          if (debug) {
            if (debug.llm_error) msg += '\nLLM: ' + debug.llm_error;
            if (debug.raw_response) msg += '\nResponse: ' + debug.raw_response;
            if (debug.regex_phone) msg += '\nRegex phone: ' + debug.regex_phone;
          }
          setError(msg);
        }
      }
    } catch (err) {
      console.error(`Failed to ${isEdit ? 'update' : 'create'} customer:`, err);
      setError(err instanceof Error ? err.message : `Failed to ${isEdit ? 'update' : 'create'} customer`);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <h2 className="md:text-2xl text-xl font-black text-gray-900 tracking-tight">{isEdit ? `Edit ${terminology.customer}` : `New ${terminology.customer}`}</h2>
        <button onClick={() => navigate(-1)} className="px-4 py-2 text-gray-500 font-bold hover:bg-gray-100 rounded-xl transition-all">Cancel</button>
      </div>
      <div className="bg-white p-10 rounded-xl border border-gray-100 shadow-xl space-y-8">
        {isEdit && loading ? (
          <div className="text-center text-gray-500">Loading customer...</div>
        ) : (
          <>
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm font-bold text-red-600">{String(error)}</p>
              </div>
            )}
            {smartMode && !isVaccineCenter ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <label className="text-xs font-black uppercase tracking-widest text-gray-400">{`${terminology.customer} details`}</label>
                    <InfoTooltip message="Name, phone, and address can be on separate lines or mixed together. They will be extracted when you save." />
                  </div>
                  <textarea
                    autoFocus
                    className="min-h-[240px] w-full rounded-2xl border border-gray-200 bg-gray-50 px-6 py-5 font-medium leading-7 outline-none transition-all focus:border-[#3c5a82] focus:bg-white"
                    value={smartInput}
                    onChange={(event) => setSmartInput(event.target.value)}
                    placeholder={'Example:\nRahim Ahmed\n+880 1712-345678\nHouse 12, Road 4, Mirpur, Dhaka'}
                  />
                  <p className="text-xs font-semibold text-gray-400">The phone is normalized to Bangladesh local format, such as 01712345678.</p>
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
            {!isVaccineCenter && <div className="space-y-2">
              <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Address</label>
              <textarea 
                className="w-full px-6 py-4 bg-gray-50 border border-gray-200 focus:border-[#3c5a82] focus:bg-white rounded-lg font-medium h-32 transition-all outline-none"
                value={form.address}
                onChange={e => setForm({...form, address: e.target.value})}
              />
            </div>}
            {isVaccineCenter && (
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2"><span className="text-xs font-black text-gray-400 uppercase tracking-widest">Age</span><input type="number" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none" value={form.age} onChange={e => setForm({ ...form, age: e.target.value })} /></label>
                <label className="space-y-2"><span className="text-xs font-black text-gray-400 uppercase tracking-widest">Gender</span><select className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none" value={form.gender} onChange={e => setForm({ ...form, gender: e.target.value })}><option value="">Select gender</option><option value="Male">Male</option><option value="Female">Female</option><option value="Non-Binary">Non-Binary</option></select></label>
                <label className="space-y-2"><span className="text-xs font-black text-gray-400 uppercase tracking-widest">Weight ({weightUnit === 'pound' ? 'lb' : weightUnit === 'gram' ? 'g' : 'kg'})</span><div className="relative"><input type="number" className="w-full px-4 py-3 pr-12 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none" value={form.weight} onChange={e => setForm({ ...form, weight: e.target.value })} /><span className="absolute inset-y-0 right-4 flex items-center text-xs font-black text-gray-400">{weightUnit === 'pound' ? 'lb' : weightUnit === 'gram' ? 'g' : 'kg'}</span></div></label>
                {heightUnit === 'feet-inches' ? <label className="space-y-3 md:col-span-2"><span className="text-xs font-black text-gray-400 uppercase tracking-widest">Height (ft/in)</span><div className="grid grid-cols-2 gap-4"><div className="space-y-1.5"><span className="block text-xs font-bold text-gray-500">Feet</span><div className="relative"><input aria-label="Height feet" type="number" min="0" placeholder="0" className="w-full px-4 py-3 pr-10 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none" value={form.heightFeet} onChange={e => setForm({ ...form, heightFeet: e.target.value })} /><span className="absolute inset-y-0 right-4 flex items-center text-xs font-black text-gray-400">ft</span></div></div><div className="space-y-1.5"><span className="block text-xs font-bold text-gray-500">Inches</span><div className="relative"><input aria-label="Height inches" type="number" min="0" max="11" placeholder="0" className="w-full px-4 py-3 pr-10 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none" value={form.heightInches} onChange={e => setForm({ ...form, heightInches: e.target.value })} /><span className="absolute inset-y-0 right-4 flex items-center text-xs font-black text-gray-400">in</span></div></div></div></label> : <label className="space-y-2"><span className="text-xs font-black text-gray-400 uppercase tracking-widest">Height (cm)</span><div className="relative"><input type="number" placeholder="0" className="w-full px-4 py-3 pr-10 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none" value={form.height} onChange={e => setForm({ ...form, height: e.target.value })} /><span className="absolute inset-y-0 right-4 flex items-center text-xs font-black text-gray-400">cm</span></div></label>}
                <label className="space-y-2"><span className="text-xs font-black text-gray-400 uppercase tracking-widest">Blood Group</span><select className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none" value={form.bloodGroup} onChange={e => setForm({ ...form, bloodGroup: e.target.value })}><option value="">Select blood group</option><option value="A+">A+</option><option value="A-">A-</option><option value="B+">B+</option><option value="B-">B-</option><option value="AB+">AB+</option><option value="AB-">AB-</option><option value="O+">O+</option><option value="O-">O-</option></select></label>
                <label className="space-y-2"><span className="text-xs font-black text-gray-400 uppercase tracking-widest">Guardian/Parent Name</span><input type="text" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none" value={form.guardianName} onChange={e => setForm({ ...form, guardianName: e.target.value })} /></label>
                <label className="space-y-2"><span className="text-xs font-black text-gray-400 uppercase tracking-widest">Emergency Contact</span><input type="text" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none" value={form.emergencyContact} onChange={e => setForm({ ...form, emergencyContact: e.target.value })} /></label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Additional Notes</span>
                  <textarea className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-[#3c5a82] focus:bg-white rounded-xl font-medium outline-none" value={form.additionalNotes} onChange={e => setForm({ ...form, additionalNotes: e.target.value })} />
                </label>
              </div>
            )}
            </>
            )}
            <Button 
              onClick={handleSave}
              variant="primary"
              size="lg"
              className="w-full"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) ? (isEdit ? 'Updating...' : 'Adding...') : (isEdit ? `Update ${terminology.customer}` : `Add ${terminology.customer}`)}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default CustomerForm;
