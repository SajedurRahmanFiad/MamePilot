
import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { User, UserRole, hasAdminAccess } from '../types';
import { Button, NumericInput } from '../components';
import { theme } from '../theme';
import { compressImage } from '../utils';
import { usePermissionsSettings, useUser } from '../src/hooks/useQueries';
import { useCreateUser, useUpdateUser, useDeleteUser } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { getErrorMessage } from '../src/services/supabaseQueries';
import { useAuth } from '../src/contexts/AuthProvider';
import { db } from '../db';
import { getAssignableUserRoles } from '../src/utils/permissions';
import { useRolePermissions } from '../src/hooks/useRolePermissions';

const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
const BLOOD_GROUP_OPTIONS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

const UserForm: React.FC = () => {
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
    isCommissionBased: false,
    fixedSalary: null,
  });

  // Initialize form with existing user data when loaded
  React.useEffect(() => {
    if (existingUser) {
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
      });
    }
  }, [existingUser]);

  const isAdmin = hasAdminAccess(currentUser?.role);
  const isDeveloperTarget = form.role === UserRole.DEVELOPER;
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
    try {
      const compressed = await compressImage(file, { maxWidth: 800, maxHeight: 800, quality: 0.82 });
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
    isCommissionBased: showExtendedProfile ? Boolean(form.isCommissionBased) : false,
    fixedSalary: showExtendedProfile && !form.isCommissionBased ? form.fixedSalary ?? null : null,
  });

  const handleSave = async () => {
    if (!form.name || !form.phone || (isAdmin && !isEdit && !form.password)) {
      toast.warning('Please fill mandatory fields (Name, Phone, Password)');
      return;
    }

    const extendedFields = normalizeExtendedFields();

    setSaving(true);
    try {
      if (isEdit && id) {
        const updates: Partial<User> = {
          name: form.name,
          phone: form.phone,
          image: form.image,
          ...extendedFields,
        };

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
                <input type="file" id="user-pfp" className="hidden" onChange={handleImageUpload} />
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

                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Commission Based</label>
                  <select className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]" value={form.isCommissionBased ? 'yes' : 'no'} onChange={e => setFormValue('isCommissionBased', e.target.value === 'yes')}>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </div>

                {!form.isCommissionBased && (
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Fixed Salary</label>
                    <NumericInput
                      value={form.fixedSalary ?? ''}
                      onChange={(value) => setFormValue('fixedSalary', value)}
                      placeholder="0.00"
                      className="bg-gray-50 border rounded-xl"
                    />
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

export default UserForm;
