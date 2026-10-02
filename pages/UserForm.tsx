
import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DeliveryPerson, User, UserRole, hasAdminAccess } from '../types';
import { Button, NumericInput } from '../components';
import { theme } from '../theme';
import { compressImage } from '../utils';
import { useDeliveryPerson, usePermissionsSettings, useUser } from '../src/hooks/useQueries';
import { useCreateDeliveryPerson, useCreateUser, useDeleteDeliveryPerson, useDeleteUser, useUpdateDeliveryPerson, useUpdateUser } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { getErrorMessage } from '../src/services/supabaseQueries';
import { useAuth } from '../src/contexts/AuthProvider';
import { db } from '../db';
import { getAssignableUserRoles } from '../src/utils/permissions';
import { useRolePermissions } from '../src/hooks/useRolePermissions';

const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
const BLOOD_GROUP_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const StandardUserForm: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);

  // Query user if editing
  const { data: existingUser, isPending: userLoading, error: userError } = useUser(isEdit ? id : undefined);
  const { data: permissionsSettings } = usePermissionsSettings();

  // Mutations
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const deleteMutation = useDeleteUser();
  const toast = useToastNotifications();
  const { user: currentUser } = useAuth();
  const { canCreateUsers, canEditUsers, canDeleteUsers } = useRolePermissions();

  // Form state
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [profileImageName, setProfileImageName] = useState('');
  const [form, setForm] = useState<Partial<User>>({
    name: '',
    phone: '',
    password: '',
    role: UserRole.EMPLOYEE,
    image: '',
    email: '',
    address: '',
    birthday: '',
    nidPassportCopy: '',
    gender: '',
    bloodGroup: '',
    nationality: '',
    cv: '',
    isCommissionBased: true,
    fixedSalary: null,
    unitAmount: null,
    compensationType: 'commission',
  });

  // Initialize form with existing user data when loaded
  React.useEffect(() => {
    if (existingUser) {
      // Derive compensation type from existing data
      const existingCompensationType = existingUser.compensationType === 'hybrid'
        ? 'hybrid'
        : existingUser.isCommissionBased ? 'commission' : 'fixed';
      setForm({
        ...existingUser,
        password: '',
        email: existingUser.email || '',
        address: existingUser.address || '',
        birthday: existingUser.birthday || '',
        nidPassportCopy: existingUser.nidPassportCopy || '',
        gender: existingUser.gender || '',
        bloodGroup: existingUser.bloodGroup || '',
        nationality: existingUser.nationality || '',
        cv: existingUser.cv || '',
        isCommissionBased: Boolean(existingUser.isCommissionBased),
        fixedSalary: existingUser.fixedSalary ?? null,
        unitAmount: existingUser.unitAmount ?? null,
        compensationType: existingCompensationType,
      });
    }
  }, [existingUser]);

  const isAdmin = hasAdminAccess(currentUser?.role);
  const isDeveloperTarget = form.role === UserRole.DEVELOPER;
  const isEmployeeTarget = form.role === UserRole.EMPLOYEE;
  const showExtendedProfile = !isDeveloperTarget;
  const assignableRoles = getAssignableUserRoles(permissionsSettings || db.settings.permissions, {
    includeDeveloper: existingUser?.role === UserRole.DEVELOPER,
  });

  const loading = userLoading;

  const setFormValue = <K extends keyof User>(key: K, value: User[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.warning('Please select an image file for the profile picture.');
      e.target.value = '';
      return;
    }
    setProfileImageName(file.name);
    try {
      const compressed = await compressImage(file, { maxWidth: 800, maxHeight: 800, quality: 0.82, force: true });
      setForm((prev) => ({ ...prev, image: compressed }));
    } catch {
      const reader = new FileReader();
      reader.onload = () => setForm((prev) => ({ ...prev, image: reader.result as string }));
      reader.readAsDataURL(file);
    }
  };

  const handleDocumentUpload = (field: 'nidPassportCopy' | 'cv') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Compress images; pass non-images through as data URL
    if (file.type.startsWith('image/')) {
      try {
        const compressed = await compressImage(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.82 });
        setForm((prev) => ({ ...prev, [field]: compressed }));
        return;
      } catch { /* fallback below */ }
    }
    const reader = new FileReader();
    reader.onload = () => setForm((prev) => ({ ...prev, [field]: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const normalizeExtendedFields = () => ({
    email: showExtendedProfile ? (form.email || '') : '',
    address: showExtendedProfile ? (form.address || '') : '',
    birthday: showExtendedProfile ? (form.birthday || '') : '',
    nidPassportCopy: showExtendedProfile ? (form.nidPassportCopy || '') : '',
    gender: showExtendedProfile ? (form.gender || '') : '',
    bloodGroup: showExtendedProfile ? (form.bloodGroup || '') : '',
    nationality: showExtendedProfile ? (form.nationality || '') : '',
    cv: showExtendedProfile ? (form.cv || '') : '',
    isCommissionBased: isEmployeeTarget
      ? (form.compensationType === 'commission' || form.compensationType === 'hybrid')
      : false,
    fixedSalary: isEmployeeTarget && (form.compensationType === 'fixed' || form.compensationType === 'hybrid')
      ? form.fixedSalary ?? null
      : null,
    unitAmount: isEmployeeTarget && (form.compensationType === 'commission' || form.compensationType === 'hybrid')
      ? form.unitAmount ?? null
      : null,
  });

  const handleSave = async () => {
    if (isEdit && !canEditUsers) {
      toast.error('You do not have permission to edit users');
      return;
    }
    if (!form.name || !form.phone || (isAdmin && !isEdit && !form.password)) {
      toast.warning('Please fill mandatory fields (Name, Phone, Password)');
      return;
    }
    if (isEmployeeTarget && form.compensationType === 'fixed' && Number(form.fixedSalary || 0) <= 0) {
      toast.warning('Enter a fixed monthly salary greater than zero.');
      return;
    }
    if (isEmployeeTarget && form.compensationType === 'hybrid' && Number(form.fixedSalary || 0) <= 0) {
      toast.warning('Enter a fixed monthly salary greater than zero for hybrid compensation.');
      return;
    }

    const extendedFields = normalizeExtendedFields();

    setSaving(true);
    try {
      if (isEdit && id) {
        const updates: Partial<User> & { imageName?: string } = {
          name: form.name,
          phone: form.phone,
          image: form.image,
          ...extendedFields,
        };
        if (profileImageName) updates.imageName = profileImageName;

        if (isAdmin) {
          if (form.password) updates.password = form.password;
          if (existingUser && form.role && form.role !== existingUser.role) {
            updates.role = form.role;
          }
        }

        await updateMutation.mutateAsync({ id, updates });

      } else {
        if (!canCreateUsers) {
          toast.error('You do not have permission to create users');
          setSaving(false);
          return;
        }

        await createMutation.mutateAsync({
          name: form.name || '',
          phone: form.phone || '',
          password: form.password || '',
          role: form.role || UserRole.EMPLOYEE,
          image: form.image || '',
          ...(profileImageName ? { imageName: profileImageName } : {}),
          ...extendedFields,
        } as any);
      }

      toast.success(isEdit ? 'User updated successfully!' : 'User created successfully!');
      navigate('/users');
    } catch (err) {
      console.error('Failed to save user:', err);
      const errorMsg = getErrorMessage(err);
      toast.error('Failed to save user: ' + errorMsg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;

    setSaving(true);
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('User moved to the recycle bin');
      navigate('/users');
    } catch (err) {
      console.error('Failed to delete user:', err);
      const errorMsg = getErrorMessage(err);
      toast.error('Failed to delete user: ' + errorMsg);
    } finally {
      setSaving(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 pb-20">
      <div className="flex items-center justify-between">
        <h2 className="md:text-2xl text-xl font-bold text-gray-900">{isEdit ? 'Edit Profile' : 'Add User'}</h2>
        <button onClick={() => navigate('/users')} className="px-4 py-2 border rounded-xl font-bold bg-white text-gray-500 hover:bg-gray-50">Cancel</button>
      </div>

      {isEdit && loading && (
        <div className="bg-white p-8 rounded-lg border border-gray-100 shadow-sm text-center text-gray-500">
          Loading user details...
        </div>
      )}

      {userError && (
        <div className="bg-red-50 p-4 rounded-lg border border-red-100 text-red-700">
          {userError.message || 'User not found'}
        </div>
      )}

      {(!isEdit || !loading) && (
        <div className="bg-white p-8 rounded-lg border border-gray-100 shadow-sm space-y-6">
          <div className="space-y-6">
            <div className="flex items-center gap-6 p-6 bg-gray-50 rounded-lg">
              <div className="w-20 h-20 rounded-[50%] overflow-hidden bg-white border">
                <img src={form.image || '/uploads/Empty_avatar.png'} className="w-full h-full object-cover" />
              </div>
              <div className="space-y-2">
                <p className="text-xs font-bold text-gray-400 uppercase mb-2">Profile Photo</p>
                <input type="file" id="user-pfp" accept="image/*" className="hidden" onChange={handleImageUpload} />
                <label htmlFor="user-pfp" className={`cursor-pointer px-4 py-2 ${theme.colors.primary[600]} text-white text-xs font-bold rounded-lg hover:${theme.colors.primary[700]}`}>Upload Picture</label>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Full Name</label>
              <input type="text" className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]`} value={form.name || ''} onChange={e => setFormValue('name', e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Phone Number</label>
              <input type="text" className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]`} value={form.phone || ''} onChange={e => setFormValue('phone', e.target.value)} />
            </div>

            {isAdmin && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Password (Admin Only Access)</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="w-full px-4 py-3 pr-10 bg-purple-50 border border-purple-100 rounded-xl focus:ring-2 focus:ring-purple-500"
                    value={form.password || ''}
                    onChange={e => setFormValue('password', e.target.value)}
                    placeholder={isEdit ? "Leave blank to keep current password" : "Secure system password"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-purple-500 hover:text-purple-700"
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"></path><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"></path></svg>
                    ) : (
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-14-14zM10 4C6.687 4 3.89 5.945 2.58 8.808c-.35.915-.35 2.468 0 3.384.74 1.94 2.08 3.61 3.756 4.7l1.83-1.83A3.992 3.992 0 016 10a4 4 0 016.956-3.533l1.416-1.416C14.225 4.523 12.15 4 10 4zm7.42 3.192c.35.915.35 2.468 0 3.384C15.26 13.055 12.463 15 9 15a6.966 6.966 0 01-3.15-.744l2.119-2.119A3.992 3.992 0 0114 10c0-.901-.281-1.735-.743-2.434l2.163-2.174z" clipRule="evenodd"></path></svg>
                    )}
                  </button>
                </div>
                <p className="text-[10px] text-purple-400 font-medium">Only administrators can set or change passwords.</p>
              </div>
            )}

            {isAdmin && (
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">System Role</label>
                <select className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]`} value={form.role || ''} onChange={e => setFormValue('role', e.target.value)} disabled={existingUser?.role === UserRole.DEVELOPER}>
                  {assignableRoles.map((roleName) => (
                    <option key={roleName} value={roleName}>
                      {roleName === UserRole.ADMIN ? 'Administrator' : roleName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {showExtendedProfile && (
              <div className="space-y-6 border-t pt-6">
                <div>
                  <h3 className="text-sm font-bold text-gray-900">Additional Profile Information</h3>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Email</label>
                  <input type="email" className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]" value={form.email || ''} onChange={e => setFormValue('email', e.target.value)} />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Address</label>
                  <textarea className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] min-h-[100px]" value={form.address || ''} onChange={e => setFormValue('address', e.target.value)} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Birthday</label>
                    <input type="date" className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]" value={form.birthday || ''} onChange={e => setFormValue('birthday', e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Nationality</label>
                    <input type="text" className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]" value={form.nationality || ''} onChange={e => setFormValue('nationality', e.target.value)} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Gender</label>
                    <select className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]" value={form.gender || ''} onChange={e => setFormValue('gender', e.target.value)}>
                      <option value="">Select Gender</option>
                      {GENDER_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Blood Group</label>
                    <select className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]" value={form.bloodGroup || ''} onChange={e => setFormValue('bloodGroup', e.target.value)}>
                      <option value="">Select Blood Group</option>
                      {BLOOD_GROUP_OPTIONS.map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {isEmployeeTarget && (
                  <div className="rounded-2xl border border-[#d6e3f0] bg-[#f8fbff] p-4 md:p-5">
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[#0f2f57]">Compensation</p>
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Compensation Type</label>
                        <select
                          className="w-full rounded-xl border bg-white px-4 py-3 focus:ring-2 focus:ring-[#3c5a82]"
                          value={form.compensationType || (form.isCommissionBased ? 'commission' : 'fixed')}
                          onChange={(event) => {
                            const selected = event.target.value;
                            setFormValue('compensationType', selected);
                            if (selected === 'hybrid') {
                              setFormValue('isCommissionBased', true);
                            } else {
                              setFormValue('isCommissionBased', selected === 'commission');
                            }
                          }}
                        >
                          <option value="commission">Commission per eligible order</option>
                          <option value="fixed">Fixed monthly salary</option>
                          <option value="hybrid">Hybrid (Fixed salary + Commission)</option>
                        </select>
                        <p className="text-xs font-medium text-gray-500">
                          {form.compensationType === 'commission'
                            ? 'Eligible orders add credits to the employee wallet.'
                            : form.compensationType === 'fixed'
                              ? 'Payroll calculates the salary for the selected calendar period.'
                              : 'Combines a fixed monthly salary with per-order commission credits.'}
                        </p>
                      </div>

                      {form.compensationType === 'fixed' && (
                        <div className="space-y-1">
                          <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Monthly Salary <span className="text-rose-500">*</span></label>
                          <NumericInput
                            value={form.fixedSalary ?? ''}
                            onChange={(value) => setFormValue('fixedSalary', value)}
                            placeholder="Enter monthly salary"
                            className="rounded-xl border bg-white"
                          />
                          <p className="text-xs font-medium text-gray-500">Must be greater than zero before this employee can be paid.</p>
                        </div>
                      )}

                      {form.compensationType === 'commission' && (
                        <div className="space-y-1">
                          <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Unit Amount</label>
                          <NumericInput
                            value={form.unitAmount ?? ''}
                            onChange={(value) => setFormValue('unitAmount', value)}
                            placeholder="Leave empty to use global default"
                            className="rounded-xl border bg-white"
                          />
                          <p className="text-xs font-medium text-gray-500">Amount per eligible order. Falls back to the global wallet setting if left empty.</p>
                        </div>
                      )}

                      {form.compensationType === 'hybrid' && (
                        <>
                          <div className="space-y-1">
                            <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Monthly Salary <span className="text-rose-500">*</span></label>
                            <NumericInput
                              value={form.fixedSalary ?? ''}
                              onChange={(value) => setFormValue('fixedSalary', value)}
                              placeholder="Enter monthly salary"
                              className="rounded-xl border bg-white"
                            />
                            <p className="text-xs font-medium text-gray-500">Must be greater than zero before this employee can be paid.</p>
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-bold uppercase tracking-widest text-gray-500">Unit Amount</label>
                            <NumericInput
                              value={form.unitAmount ?? ''}
                              onChange={(value) => setFormValue('unitAmount', value)}
                              placeholder="Leave empty to use global default"
                              className="rounded-xl border bg-white"
                            />
                            <p className="text-xs font-medium text-gray-500">Amount per eligible order. Falls back to the global wallet setting if left empty.</p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 p-4 bg-gray-50 rounded-lg border">
                    <div>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">NID / Passport Copy</p>
                      <p className="text-[11px] text-gray-500 mt-1">Optional identity document upload.</p>
                    </div>
                    <input type="file" id="user-nid-passport" className="hidden" onChange={handleDocumentUpload('nidPassportCopy')} />
                    <label htmlFor="user-nid-passport" className={`inline-block cursor-pointer px-4 py-2 ${theme.colors.primary[600]} text-white text-xs font-bold rounded-lg hover:${theme.colors.primary[700]}`}>Upload Document</label>
                    {form.nidPassportCopy && <p className="text-[11px] text-green-600 font-medium">Document attached</p>}
                  </div>
                  <div className="space-y-2 p-4 bg-gray-50 rounded-lg border">
                    <div>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">CV</p>
                      <p className="text-[11px] text-gray-500 mt-1">Optional CV upload.</p>
                    </div>
                    <input type="file" id="user-cv" className="hidden" onChange={handleDocumentUpload('cv')} />
                    <label htmlFor="user-cv" className={`inline-block cursor-pointer px-4 py-2 ${theme.colors.primary[600]} text-white text-xs font-bold rounded-lg hover:${theme.colors.primary[700]}`}>Upload CV</label>
                    {form.cv && <p className="text-[11px] text-green-600 font-medium">CV attached</p>}
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="pt-6 space-y-3">
            <Button
              onClick={handleSave}
              variant="primary"
              size="lg"
              className="w-full"
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Details'}
            </Button>

            {isEdit && canDeleteUsers && !isDeveloperTarget && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                disabled={saving}
                className="w-full px-4 py-3 bg-red-50 border border-red-200 text-red-600 rounded-xl font-bold hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Archive User
              </button>
            )}
            {isEdit && isDeveloperTarget && (
              <p className="text-center text-xs font-bold text-gray-400">
                Developer users cannot be archived from the app.
              </p>
            )}
          </div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6 space-y-6">
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Move User To Recycle Bin?</h3>
              <p className="text-gray-600 text-sm">
                Are you sure you want to archive <strong>{form.name}</strong>? You can restore this user later from the recycle bin.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={saving}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={saving}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {saving ? 'Archiving...' : 'Move To Bin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

type DeliveryPersonFormProps = {
  id?: string;
};

const DeliveryPersonForm: React.FC<DeliveryPersonFormProps> = ({ id }) => {
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const { data: existingPerson, isPending, error } = useDeliveryPerson(id);
  const createMutation = useCreateDeliveryPerson();
  const updateMutation = useUpdateDeliveryPerson();
  const deleteMutation = useDeleteDeliveryPerson();
  const toast = useToastNotifications();
  const { can } = useRolePermissions();
  const canCreate = can('users.create');
  const canEdit = can('users.edit');
  const canDelete = can('users.delete');
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [imageName, setImageName] = useState('');
  const [form, setForm] = useState<Partial<DeliveryPerson>>({ name: '', phone: '', image: '', email: '', address: '', birthday: '', nidPassportCopy: '', gender: '', bloodGroup: '', nationality: '', cv: '' });

  React.useEffect(() => {
    if (!existingPerson) return;
    setForm({ ...existingPerson, email: existingPerson.email || '', address: existingPerson.address || '', birthday: existingPerson.birthday || '', nidPassportCopy: existingPerson.nidPassportCopy || '', gender: existingPerson.gender || '', bloodGroup: existingPerson.bloodGroup || '', nationality: existingPerson.nationality || '', cv: existingPerson.cv || '' });
  }, [existingPerson]);

  const setValue = <K extends keyof DeliveryPerson>(key: K, value: DeliveryPerson[K]) => setForm((current) => ({ ...current, [key]: value }));
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file.'); return; }
    setImageName(file.name);
    try { setValue('image', await compressImage(file, { maxWidth: 800, maxHeight: 800, quality: 0.82, force: true })); }
    catch { const reader = new FileReader(); reader.onload = () => setValue('image', String(reader.result || '')); reader.readAsDataURL(file); }
  };
  const handleDocumentUpload = (field: 'nidPassportCopy' | 'cv') => (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setValue(field, String(reader.result || ''));
    reader.readAsDataURL(file);
  };
  const handleSave = async () => {
    if (!form.name?.trim() || !form.phone?.trim()) { toast.error('Name and phone are required.'); return; }
    if (isEdit && !canEdit) { toast.error('You do not have permission to edit delivery persons.'); return; }
    if (!isEdit && !canCreate) { toast.error('You do not have permission to create delivery persons.'); return; }
    setSaving(true);
    const payload = { ...form, name: form.name.trim(), phone: form.phone.trim(), imageName: imageName || undefined };
    try {
      if (isEdit && id) await updateMutation.mutateAsync({ id, updates: payload });
      else await createMutation.mutateAsync(payload);
      toast.success(isEdit ? 'Delivery person updated successfully.' : 'Delivery person added successfully.');
      navigate('/delivery-persons');
    } catch (saveError) { toast.error(saveError instanceof Error ? saveError.message : 'Could not save the delivery person.'); }
    finally { setSaving(false); }
  };
  const handleDelete = async () => {
    if (!id || !canDelete) return;
    setSaving(true);
    try { await deleteMutation.mutateAsync(id); toast.success('Delivery person archived.'); navigate('/delivery-persons'); }
    catch (deleteError) { toast.error(deleteError instanceof Error ? deleteError.message : 'Could not archive the delivery person.'); }
    finally { setSaving(false); setShowDeleteConfirm(false); }
  };
  const inputClass = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 focus:ring-2 focus:ring-[#3c5a82]';

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-20">
      <div className="flex items-center justify-between"><h2 className="text-xl font-bold text-gray-900 md:text-2xl">{isEdit ? 'Edit Delivery Person' : 'Add Delivery Person'}</h2><button onClick={() => navigate('/delivery-persons')} className="rounded-xl border bg-white px-4 py-2 font-bold text-gray-500 hover:bg-gray-50">Cancel</button></div>
      {isEdit && isPending && <div className="rounded-lg border border-gray-100 bg-white p-8 text-center text-gray-500">Loading delivery person details...</div>}
      {error && <div className="rounded-lg border border-red-100 bg-red-50 p-4 text-red-700">{error.message || 'Delivery person not found.'}</div>}
      {(!isEdit || !isPending) && (
        <div className="space-y-6 rounded-lg border border-gray-100 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-6 rounded-lg bg-gray-50 p-6"><div className="h-20 w-20 overflow-hidden rounded-full border bg-white"><img src={form.image || '/uploads/Empty_avatar.png'} className="h-full w-full object-cover" alt="" /></div><div><p className="mb-2 text-xs font-bold uppercase text-gray-400">Profile Photo</p><input type="file" id="delivery-person-pfp" accept="image/*" className="hidden" onChange={handleImageUpload} /><label htmlFor="delivery-person-pfp" className={`cursor-pointer rounded-lg px-4 py-2 text-xs font-bold text-white ${theme.colors.primary[600]} hover:${theme.colors.primary[700]}`}>Upload Picture</label></div></div>
          <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-gray-400">Full Name</span><input className={inputClass} value={form.name || ''} onChange={(event) => setValue('name', event.target.value)} /></label>
          <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-gray-400">Phone Number</span><input className={inputClass} value={form.phone || ''} onChange={(event) => setValue('phone', event.target.value)} /></label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-gray-400">Email</span><input type="email" className={inputClass} value={form.email || ''} onChange={(event) => setValue('email', event.target.value)} /></label>
            <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-gray-400">Birthday</span><input type="date" className={inputClass} value={form.birthday || ''} onChange={(event) => setValue('birthday', event.target.value)} /></label>
            <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-gray-400">Nationality</span><input className={inputClass} value={form.nationality || ''} onChange={(event) => setValue('nationality', event.target.value)} /></label>
            <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-gray-400">Gender</span><select className={inputClass} value={form.gender || ''} onChange={(event) => setValue('gender', event.target.value)}><option value="">Select Gender</option>{GENDER_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
            <label className="flex flex-col items-start gap-1 md:col-span-2"><span className="block text-xs font-bold uppercase tracking-widest text-gray-400">Blood Group</span><select className={`${inputClass} md:max-w-xs`} value={form.bloodGroup || ''} onChange={(event) => setValue('bloodGroup', event.target.value)}><option value="">Select Blood Group</option>{BLOOD_GROUP_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
          </div>
          <label className="block space-y-1"><span className="text-xs font-bold uppercase tracking-widest text-gray-400">Address</span><textarea className={`${inputClass} min-h-[100px]`} value={form.address || ''} onChange={(event) => setValue('address', event.target.value)} /></label>
          <div className="grid gap-4 md:grid-cols-2">{([['nidPassportCopy', 'NID / Passport Copy'], ['cv', 'CV']] as const).map(([field, label]) => <div key={field} className="space-y-2 rounded-lg border bg-gray-50 p-4"><p className="text-xs font-bold uppercase tracking-widest text-gray-400">{label}</p><input type="file" id={`delivery-${field}`} className="hidden" onChange={handleDocumentUpload(field)} /><label htmlFor={`delivery-${field}`} className={`inline-block cursor-pointer rounded-lg px-4 py-2 text-xs font-bold text-white ${theme.colors.primary[600]} hover:${theme.colors.primary[700]}`}>Upload {field === 'cv' ? 'CV' : 'Document'}</label>{form[field] && <p className="text-xs font-medium text-emerald-600">Document attached</p>}</div>)}</div>
          <div className="space-y-3"><Button onClick={() => void handleSave()} loading={saving} className="w-full">{saving ? 'Saving...' : 'Save Details'}</Button>{isEdit && canDelete && <button onClick={() => setShowDeleteConfirm(true)} disabled={saving} className="w-full rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-bold text-red-600">Archive Delivery Person</button>}</div>
        </div>
      )}
      {showDeleteConfirm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="w-full max-w-sm space-y-5 rounded-xl bg-white p-6"><h3 className="text-lg font-bold text-gray-900">Archive Delivery Person?</h3><p className="text-sm text-gray-600">Archive {form.name}? You can restore it later.</p><div className="flex gap-3"><Button variant="secondary" onClick={() => setShowDeleteConfirm(false)} className="flex-1">Cancel</Button><Button variant="danger" onClick={() => void handleDelete()} loading={saving} className="flex-1">Archive</Button></div></div></div>}
    </div>
  );
};

type UserFormProps = { mode?: 'delivery-person' };
const UserForm: React.FC<UserFormProps> = ({ mode }) => {
  const { id } = useParams();
  return mode === 'delivery-person' ? <DeliveryPersonForm id={id} /> : <StandardUserForm />;
};

export default UserForm;
