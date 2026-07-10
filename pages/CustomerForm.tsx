
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Customer } from '../types';
import { Button } from '../components';
import { theme } from '../theme';
import { useCustomer } from '../src/hooks/useQueries';
import { useCreateCustomer, useUpdateCustomer } from '../src/hooks/useMutations';
import { useAuth } from '../src/contexts/AuthProvider';
import { isTempId } from '../src/utils/optimisticIdMap';
import { sanitizePhoneInput } from '../utils';
import { useRolePermissions } from '../src/hooks/useRolePermissions';

const CustomerForm: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isLoading: authLoading } = useAuth();
  const isEdit = Boolean(id);
  const { canCreateCustomers, canEditCustomers } = useRolePermissions();
  
  const [form, setForm] = useState({ name: '', phone: '', address: '' });
  const [error, setError] = useState<string | null>(null);
  const initializedRef = useRef(false);

  // Wait for auth to load
  if (authLoading) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Loading...</h2>
        <p className="text-gray-500 mb-6">Authenticating session...</p>
      </div>
    );
  }

  const { data: customer, isPending: loading, error: fetchError } = useCustomer(isEdit ? id : undefined);
  const createMutation = useCreateCustomer();
  const updateMutation = useUpdateCustomer();
  const location = useLocation();
  const queryClient = useQueryClient();

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
      });
      initializedRef.current = true;
      return;
    }

    // If this is an optimistic/local-only customer (temp id), populate from cached list.
    if (id && isTempId(id)) {
      const cachedCustomers = queryClient.getQueryData<Customer[]>(['customers']) || [];
      const optimistic = cachedCustomers.find(c => c.id === id);
      if (optimistic) {
        setForm({ name: optimistic.name, phone: optimistic.phone, address: optimistic.address });
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
    });
    initializedRef.current = true;
  }, [customer, id, isEdit, location, location.key, queryClient]);

  const handleSave = async () => {
    if (!form.name || !form.phone) {
      setError('Name and phone are required');
      return;
    }

    if (!/^0\d{10}$/.test(form.phone)) {
      setError('Phone number must be 11 digits and start with 0');
      return;
    }
    
    setError(null);
    
    try {
      if (isEdit) {
        const updates: Partial<Customer> = {
          name: form.name,
          phone: form.phone,
          address: form.address,
        };
        await updateMutation.mutateAsync({ id: id!, updates });
        navigate('/customers');
      } else {
        const newCustomer: Omit<Customer, 'id'> = {
          name: form.name,
          phone: form.phone,
          address: form.address,
          totalOrders: 0,
          dueAmount: 0,
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
          setError(err instanceof Error ? err.message : 'Failed to create customer');
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
        <h2 className="md:text-2xl text-xl font-black text-gray-900 tracking-tight">{isEdit ? 'Edit Customer' : 'New Customer'}</h2>
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
            <Button 
              onClick={handleSave}
              variant="primary"
              size="lg"
              className="w-full"
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {(createMutation.isPending || updateMutation.isPending) ? (isEdit ? 'Updating...' : 'Adding...') : (isEdit ? 'Update Customer' : 'Add Customer')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
};

export default CustomerForm;
