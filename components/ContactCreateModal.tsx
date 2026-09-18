import React, { useEffect, useState } from 'react';
import { Customer, Vendor } from '../types';
import { sanitizePhoneInput } from '../utils';
import { useAuth } from '../src/contexts/AuthProvider';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { useBeSmartSettings, useCompanySettings } from '../src/hooks/useQueries';
import { useCreateCustomer, useCreateVendor, useUpdateCustomer, useUpdateVendor } from '../src/hooks/useMutations';
import { Button } from './Button';
import InfoTooltip from './InfoTooltip';
import { Modal } from './Modal';
import { getBusinessTerminology } from '../src/utils/businessMode';

const getHeightParts = (height: number | null | undefined, unit: 'feet-inches' | 'cm') => {
  if (height === null || height === undefined || Number.isNaN(Number(height))) return { height: '', heightFeet: '', heightInches: '' };
  if (unit === 'feet-inches') {
    const totalInches = Number(height);
    return { height: '', heightFeet: String(Math.floor(totalInches / 12)), heightInches: String(Math.round(totalInches % 12)) };
  }
  return { height: String(height), heightFeet: '', heightInches: '' };
};

type ContactKind = 'customer' | 'vendor';

interface ContactFormValues {
  name: string;
  phone: string;
  address: string;
  age: string;
  gender: string;
  weight: string;
  height: string;
  bloodGroup: string;
  guardianName: string;
  emergencyContact: string;
  additionalNotes: string;
  smartInput?: string;
}

interface ContactCreateModalBaseProps {
  kind: ContactKind;
  isOpen: boolean;
  onClose: () => void;
  initialValues?: Partial<ContactFormValues>;
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
  const [smartInput, setSmartInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const isCustomer = kind === 'customer';
  const { settings: capabilitySettings } = useCapabilities();
  const { data: companySettings } = useCompanySettings();
  const terminology = getBusinessTerminology(capabilitySettings?.businessMode);
  const isVaccineCenter = capabilitySettings?.businessMode === 'vaccine_center';
  const weightUnit = companySettings?.weightUnit || 'kg';
  const heightUnit = companySettings?.heightUnit || 'cm';
  const entityLabel = isCustomer ? terminology.customerLower : 'vendor';
  const nameLabel = isCustomer ? 'Full Name' : 'Business Name';

  const [form, setForm] = useState({ name: '', phone: '', address: '', age: '', gender: '', weight: '', height: '', bloodGroup: '', guardianName: '', emergencyContact: '', additionalNotes: '' });

  useEffect(() => {
    if (!isOpen) return;
    const nextForm = {
      name: initialValues?.name || '',
      phone: initialValues?.phone || '',
      address: initialValues?.address || '',
      age: initialValues?.age?.toString() || '',
      gender: initialValues?.gender || '',
      weight: initialValues?.weight?.toString() || '',
      ...getHeightParts(initialValues?.height, heightUnit),
      height: initialValues?.height?.toString() || '',
      bloodGroup: initialValues?.bloodGroup || '',
      guardianName: initialValues?.guardianName || '',
      emergencyContact: initialValues?.emergencyContact || '',
      additionalNotes: initialValues?.additionalNotes || '',
    };
    setForm(nextForm);
    setSmartInput([nextForm.name, nextForm.phone, nextForm.address].filter(Boolean).join('\n'));
    setError(null);
  }, [heightUnit, initialValues?.additionalNotes, initialValues?.address, initialValues?.age, initialValues?.bloodGroup, initialValues?.emergencyContact, initialValues?.gender, initialValues?.guardianName, initialValues?.height, initialValues?.name, initialValues?.phone, initialValues?.weight, isOpen]);

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
      title={isCustomer ? (editing ? `Edit ${terminology.customer}` : `New ${terminology.customer}`) : (editing ? 'Edit Vendor' : 'New Vendor')}
      size="md"
      contentClassName="space-y-5"
      footer={(
        <>
          <Button onClick={handleClose} variant="secondary" disabled={isPending}>Cancel</Button>
          <Button onClick={handleSave} variant="primary" loading={isPending} disabled={isLoading || isPending}>
            {isPending
              ? (isCustomer ? (editing ? `Updating ${terminology.customer}...` : `Adding ${terminology.customer}...`) : (editing ? 'Updating Vendor...' : 'Adding Vendor...'))
              : (isCustomer ? (editing ? `Update ${terminology.customer}` : `Add ${terminology.customer}`) : (editing ? 'Update Vendor' : 'Add Vendor'))}
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
          {smartMode && !isVaccineCenter ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-black uppercase tracking-widest text-gray-400">{isCustomer ? terminology.customer : 'Vendor'} details</label>
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
              {!isVaccineCenter && <div className="space-y-2">
                <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Address</label>
                <textarea
                  className="w-full px-5 py-3.5 bg-gray-50 border border-gray-200 focus:border-[#3c5a82] focus:bg-white rounded-lg font-medium h-28 transition-all outline-none"
                  value={form.address}
                  onChange={(event) => setForm({ ...form, address: event.target.value })}
                />
              </div>}
              {isCustomer && isVaccineCenter && (
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2"><span className="text-xs font-black text-gray-400 uppercase tracking-widest">Age</span><input type="number" className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none" value={form.age} onChange={event => setForm({ ...form, age: event.target.value })} /></label>
                  <label className="space-y-2"><span className="text-xs font-black text-gray-400 uppercase tracking-widest">Gender</span><select className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium outline-none" value={form.gender} onChange={event => setForm({ ...form, gender: event.target.value })}><option value="">Select gender</option><option value="Male">Male</option><option value="Female">Female</option><option value="Non-Binary">Non-Binary</option></select></label>
                  <label className="space-y-2"><span className="text-xs font-black uppercase tracking-widest text-gray-400">Weight ({weightUnit === 'pound' ? 'lb' : weightUnit === 'gram' ? 'g' : 'kg'})</span><div className="relative"><input type="number" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 pr-12 font-medium outline-none" value={form.weight} onChange={event => setForm({ ...form, weight: event.target.value })} /><span className="absolute inset-y-0 right-4 flex items-center text-xs font-black text-gray-400">{weightUnit === 'pound' ? 'lb' : weightUnit === 'gram' ? 'g' : 'kg'}</span></div></label>
                  {heightUnit === 'feet-inches' ? <label className="space-y-3 md:col-span-2"><span className="text-xs font-black uppercase tracking-widest text-gray-400">Height (ft/in)</span><div className="grid grid-cols-2 gap-4"><div className="space-y-1.5"><span className="block text-xs font-bold text-gray-500">Feet</span><div className="relative"><input aria-label="Height feet" type="number" min="0" placeholder="0" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 pr-10 font-medium outline-none" value={form.heightFeet} onChange={event => setForm({ ...form, heightFeet: event.target.value })} /><span className="absolute inset-y-0 right-4 flex items-center text-xs font-black text-gray-400">ft</span></div></div><div className="space-y-1.5"><span className="block text-xs font-bold text-gray-500">Inches</span><div className="relative"><input aria-label="Height inches" type="number" min="0" max="11" placeholder="0" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 pr-10 font-medium outline-none" value={form.heightInches} onChange={event => setForm({ ...form, heightInches: event.target.value })} /><span className="absolute inset-y-0 right-4 flex items-center text-xs font-black text-gray-400">in</span></div></div></div></label> : <label className="space-y-2"><span className="text-xs font-black uppercase tracking-widest text-gray-400">Height (cm)</span><div className="relative"><input type="number" placeholder="0" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 pr-10 font-medium outline-none" value={form.height} onChange={event => setForm({ ...form, height: event.target.value })} /><span className="absolute inset-y-0 right-4 flex items-center text-xs font-black text-gray-400">cm</span></div></label>}
                  <label className="space-y-2"><span className="text-xs font-black uppercase tracking-widest text-gray-400">Blood Group</span><select className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 font-medium outline-none" value={form.bloodGroup} onChange={event => setForm({ ...form, bloodGroup: event.target.value })}><option value="">Select blood group</option><option value="A+">A+</option><option value="A-">A-</option><option value="B+">B+</option><option value="B-">B-</option><option value="AB+">AB+</option><option value="AB-">AB-</option><option value="O+">O+</option><option value="O-">O-</option></select></label>
                  <label className="space-y-2"><span className="text-xs font-black uppercase tracking-widest text-gray-400">Guardian/Parent Name</span><input type="text" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 font-medium outline-none" value={form.guardianName} onChange={event => setForm({ ...form, guardianName: event.target.value })} /></label>
                  <label className="space-y-2"><span className="text-xs font-black uppercase tracking-widest text-gray-400">Emergency Contact</span><input type="text" className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 font-medium outline-none" value={form.emergencyContact} onChange={event => setForm({ ...form, emergencyContact: event.target.value })} /></label>
                  <label className="space-y-2 md:col-span-2">
                    <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Additional Notes</span>
                    <textarea className="w-full px-4 py-3 bg-gray-50 border border-gray-200 focus:border-[#3c5a82] focus:bg-white rounded-xl font-medium outline-none" value={form.additionalNotes} onChange={(event) => setForm({ ...form, additionalNotes: event.target.value })} />
                  </label>
                </div>
              )}
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
  initialValues?: Partial<ContactFormValues>;
  onCreated?: (customer: Customer) => void;
  editingCustomer?: (Pick<Customer, 'id'> & Partial<Customer>) | null;
  onUpdated?: (customer: Customer) => void;
}

export const CustomerCreateModal: React.FC<CustomerCreateModalProps> = ({ isOpen, onClose, initialValues, onCreated, editingCustomer, onUpdated }) => {
  const { user, isLoading: authLoading } = useAuth();
  const { capabilities, settings: capabilitySettings, isLoading: capabilitiesLoading } = useCapabilities(Boolean(user));
  const { data: companySettings } = useCompanySettings();
  const isVaccineCenter = capabilitySettings?.businessMode === 'vaccine_center';
  const heightUnit = companySettings?.heightUnit || 'cm';
  const hasBeSmart = Boolean(capabilities.be_smart);
  const { data: beSmartSettings, isPending: smartSettingsLoading } = useBeSmartSettings(isOpen && hasBeSmart);
  const createMutation = useCreateCustomer();
  const updateMutation = useUpdateCustomer();
  const smartMode = hasBeSmart && !isVaccineCenter && Boolean(beSmartSettings?.smartCustomerAdding);
  const editing = Boolean(editingCustomer);

  return (
    <ContactCreateModalBase
      kind="customer"
      isOpen={isOpen}
      onClose={onClose}
      initialValues={editingCustomer
        ? { name: editingCustomer.name, phone: editingCustomer.phone, address: editingCustomer.address, age: editingCustomer.age, gender: editingCustomer.gender, weight: editingCustomer.weight, height: editingCustomer.height, bloodGroup: editingCustomer.bloodGroup, guardianName: editingCustomer.guardianName, emergencyContact: editingCustomer.emergencyContact, additionalNotes: editingCustomer.additionalNotes }
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
              : { name: values.name, phone: values.phone, address: isVaccineCenter ? '' : values.address, ...(isVaccineCenter ? {
                age: values.age === '' ? null : Number(values.age), gender: values.gender || null,
                weight: values.weight === '' ? null : Number(values.weight), height: heightUnit === 'feet-inches' ? (values.heightFeet === '' ? null : Number(values.heightFeet) * 12 + Number(values.heightInches || 0)) : (values.height === '' ? null : Number(values.height)),
                bloodGroup: values.bloodGroup || null, guardianName: values.guardianName || null, emergencyContact: values.emergencyContact || null,
                additionalNotes: values.additionalNotes || null,
              } : {}) },
          });
          onUpdated?.(updated);
          return;
        }
        const created = await createMutation.mutateAsync({
          name: values.name,
          phone: values.phone,
          address: isVaccineCenter ? '' : values.address,
          ...(isVaccineCenter ? {
            age: values.age === '' ? null : Number(values.age), gender: values.gender || null,
            weight: values.weight === '' ? null : Number(values.weight), height: heightUnit === 'feet-inches' ? (values.heightFeet === '' ? null : Number(values.heightFeet) * 12 + Number(values.heightInches || 0)) : (values.height === '' ? null : Number(values.height)),
            bloodGroup: values.bloodGroup || null, guardianName: values.guardianName || null, emergencyContact: values.emergencyContact || null,
            additionalNotes: values.additionalNotes || null,
          } : {}),
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
