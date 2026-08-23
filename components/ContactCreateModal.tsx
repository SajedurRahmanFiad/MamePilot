import React, { useEffect, useState } from 'react';
import { Customer, Vendor } from '../types';
import { sanitizePhoneInput } from '../utils';
import { useAuth } from '../src/contexts/AuthProvider';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { useBeSmartSettings } from '../src/hooks/useQueries';
import { useCreateCustomer, useCreateVendor, useUpdateCustomer, useUpdateVendor } from '../src/hooks/useMutations';
import { Button } from './Button';
import InfoTooltip from './InfoTooltip';
import { Modal } from './Modal';

type ContactKind = 'customer' | 'vendor';

interface ContactFormValues {
  name: string;
  phone: string;
  address: string;
  smartInput?: string;
}

interface ContactCreateModalBaseProps {
  kind: ContactKind;
  isOpen: boolean;
  onClose: () => void;
  initialValues?: Partial<Pick<ContactFormValues, 'name' | 'phone' | 'address'>>;
  editing?: boolean;
  smartMode: boolean;
  isLoading: boolean;
  isPending: boolean;
  onSubmit: (values: ContactFormValues) => Promise<void>;
}

const ContactCreateModalBase: React.FC<ContactCreateModalBaseProps> = ({
  kind,
  isOpen,
  onClose,
  initialValues,
  editing = false,
  smartMode,
  isLoading,
  isPending,
  onSubmit,
}) => {
  const [form, setForm] = useState({ name: '', phone: '', address: '' });
  const [smartInput, setSmartInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isCustomer = kind === 'customer';
  const entityLabel = isCustomer ? 'customer' : 'vendor';
  const nameLabel = isCustomer ? 'Full Name' : 'Business Name';

  useEffect(() => {
    if (!isOpen) return;
    const nextForm = {
      name: initialValues?.name || '',
      phone: initialValues?.phone || '',
      address: initialValues?.address || '',
    };
    setForm(nextForm);
    setSmartInput([nextForm.name, nextForm.phone, nextForm.address].filter(Boolean).join('\n'));
    setError(null);
  }, [initialValues?.address, initialValues?.name, initialValues?.phone, isOpen]);

  const handleClose = () => {
    if (!isPending) onClose();
  };

  const handleSave = async () => {
    if (smartMode && !smartInput.trim()) {
      setError(`Paste the ${entityLabel} details before saving`);
      return;
    }

    if (!smartMode && (!form.name || !form.phone)) {
      setError(isCustomer ? 'Name and phone are required' : 'Business name and phone are required');
      return;
    }

    if (!smartMode && !/^0\d{10}$/.test(form.phone)) {
      setError('Phone number must be 11 digits and start with 0');
      return;
    }

    setError(null);
    try {
      await onSubmit(smartMode
        ? { name: '', phone: '', address: '', smartInput: smartInput.trim() }
        : form);
      onClose();
    } catch (err) {
      console.error(`Failed to save ${entityLabel}:`, err);
      setError(err instanceof Error ? err.message : `Failed to save ${entityLabel}`);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={isCustomer ? (editing ? 'Edit Customer' : 'New Customer') : (editing ? 'Edit Vendor' : 'New Vendor')}
      size="md"
      contentClassName="space-y-5"
      footer={(
        <>
          <Button onClick={handleClose} variant="secondary" disabled={isPending}>Cancel</Button>
          <Button onClick={handleSave} variant="primary" loading={isPending} disabled={isLoading || isPending}>
            {isPending
              ? (isCustomer ? (editing ? 'Updating Customer...' : 'Adding Customer...') : (editing ? 'Updating Vendor...' : 'Adding Vendor...'))
              : (isCustomer ? (editing ? 'Update Customer' : 'Add Customer') : (editing ? 'Update Vendor' : 'Add Vendor'))}
          </Button>
        </>
      )}
    >
      {isLoading ? (
        <div className="py-8 text-center text-gray-500">Preparing the {entityLabel} form...</div>
      ) : (
        <>
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm font-bold text-red-600">{String(error)}</p>
            </div>
          )}
          {smartMode ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-black uppercase tracking-widest text-gray-400">{isCustomer ? 'Customer' : 'Vendor'} details</label>
                  <InfoTooltip position="below" message="Name, phone, and address can be on separate lines or mixed together. They will be extracted when you save." />
                </div>
                <textarea
                  autoFocus
                  className="min-h-[220px] w-full rounded-2xl border border-gray-200 bg-gray-50 px-6 py-5 font-medium leading-7 outline-none transition-all focus:border-[#3c5a82] focus:bg-white"
                  value={smartInput}
                  onChange={(event) => setSmartInput(event.target.value)}
                  placeholder={isCustomer
                    ? 'Example:\nRahim Ahmed\n+880 1712-345678\nHouse 12, Road 4, Mirpur, Dhaka'
                    : 'Example:\nRahim Traders\n+880 1712-345678\nHouse 12, Road 4, Mirpur, Dhaka'}
                />
                <p className="text-xs font-semibold text-gray-400">The phone is normalized to Bangladesh local format, such as 01712345678.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">{nameLabel}</label>
                <input
                  autoFocus
                  type="text"
                  className="w-full px-5 py-3.5 bg-gray-50 border border-gray-200 focus:border-[#3c5a82] focus:bg-white rounded-2xl font-bold transition-all outline-none"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Phone Number</label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="^0\d{10}$"
                  maxLength={11}
                  className="w-full px-5 py-3.5 bg-gray-50 border border-gray-200 focus:border-[#3c5a82] focus:bg-white rounded-2xl font-bold transition-all outline-none"
                  value={form.phone}
                  onChange={(event) => {
                    const phoneValue = sanitizePhoneInput(event.target.value);
                    if (phoneValue === '' || phoneValue.startsWith('0')) {
                      setForm({ ...form, phone: phoneValue });
                    }
                  }}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Address</label>
                <textarea
                  className="w-full px-5 py-3.5 bg-gray-50 border border-gray-200 focus:border-[#3c5a82] focus:bg-white rounded-lg font-medium h-28 transition-all outline-none"
                  value={form.address}
                  onChange={(event) => setForm({ ...form, address: event.target.value })}
                />
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
};

interface CustomerCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialValues?: Partial<Pick<ContactFormValues, 'name' | 'phone' | 'address'>>;
  onCreated?: (customer: Customer) => void;
  editingCustomer?: (Pick<Customer, 'id'> & Partial<Customer>) | null;
  onUpdated?: (customer: Customer) => void;
}

export const CustomerCreateModal: React.FC<CustomerCreateModalProps> = ({ isOpen, onClose, initialValues, onCreated, editingCustomer, onUpdated }) => {
  const { user, isLoading: authLoading } = useAuth();
  const { capabilities, isLoading: capabilitiesLoading } = useCapabilities(Boolean(user));
  const hasBeSmart = Boolean(capabilities.be_smart);
  const { data: beSmartSettings, isPending: smartSettingsLoading } = useBeSmartSettings(isOpen && hasBeSmart);
  const createMutation = useCreateCustomer();
  const updateMutation = useUpdateCustomer();
  const smartMode = hasBeSmart && Boolean(beSmartSettings?.smartCustomerAdding);
  const editing = Boolean(editingCustomer);

  return (
    <ContactCreateModalBase
      kind="customer"
      isOpen={isOpen}
      onClose={onClose}
      initialValues={editingCustomer
        ? { name: editingCustomer.name, phone: editingCustomer.phone, address: editingCustomer.address }
        : initialValues}
      editing={editing}
      smartMode={smartMode}
      isLoading={authLoading || capabilitiesLoading || (hasBeSmart && smartSettingsLoading)}
      isPending={createMutation.isPending || updateMutation.isPending}
      onSubmit={async (values) => {
        if (editing && editingCustomer?.id) {
          const updated = await updateMutation.mutateAsync({
            id: editingCustomer.id,
            updates: values.smartInput
              ? { smartInput: values.smartInput }
              : { name: values.name, phone: values.phone, address: values.address },
          });
          onUpdated?.(updated);
          return;
        }
        const created = await createMutation.mutateAsync({
          name: values.name,
          phone: values.phone,
          address: values.address,
          totalOrders: 0,
          dueAmount: 0,
          ...(values.smartInput ? { smartInput: values.smartInput } : {}),
        });
        onCreated?.(created);
      }}
    />
  );
};

interface VendorCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialValues?: Partial<Pick<ContactFormValues, 'name' | 'phone' | 'address'>>;
  onCreated?: (vendor: Vendor) => void;
  editingVendor?: (Pick<Vendor, 'id'> & Partial<Vendor>) | null;
  onUpdated?: (vendor: Vendor) => void;
}

export const VendorCreateModal: React.FC<VendorCreateModalProps> = ({ isOpen, onClose, initialValues, onCreated, editingVendor, onUpdated }) => {
  const { user, isLoading: authLoading } = useAuth();
  const { capabilities, isLoading: capabilitiesLoading } = useCapabilities(Boolean(user));
  const hasBeSmart = Boolean(capabilities.be_smart);
  const { data: beSmartSettings, isPending: smartSettingsLoading } = useBeSmartSettings(isOpen && hasBeSmart);
  const createMutation = useCreateVendor();
  const updateMutation = useUpdateVendor();
  const smartMode = hasBeSmart && Boolean(beSmartSettings?.smartVendorAdding);
  const editing = Boolean(editingVendor);

  return (
    <ContactCreateModalBase
      kind="vendor"
      isOpen={isOpen}
      onClose={onClose}
      initialValues={editingVendor
        ? { name: editingVendor.name, phone: editingVendor.phone, address: editingVendor.address }
        : initialValues}
      editing={editing}
      smartMode={smartMode}
      isLoading={authLoading || capabilitiesLoading || (hasBeSmart && smartSettingsLoading)}
      isPending={createMutation.isPending || updateMutation.isPending}
      onSubmit={async (values) => {
        if (editing && editingVendor?.id) {
          const updated = await updateMutation.mutateAsync({
            id: editingVendor.id,
            updates: values.smartInput
              ? { smartInput: values.smartInput }
              : { name: values.name, phone: values.phone, address: values.address },
          });
          onUpdated?.(updated);
          return;
        }
        const created = await createMutation.mutateAsync({
          name: values.name,
          phone: values.phone,
          address: values.address,
          totalPurchases: 0,
          dueAmount: 0,
          ...(values.smartInput ? { smartInput: values.smartInput } : {}),
        });
        onCreated?.(created);
      }}
    />
  );
};
