
import React, { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { db } from '../db';
import { UserRole, hasAdminAccess } from '../types';
import { ICONS, formatCurrency } from '../constants';
import { theme } from '../theme';
import { useUser } from '../src/hooks/useQueries';
import { useDeleteUser } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { getPreservedRouteState } from '../src/utils/navigation';
import { openAttachmentPreview } from '../utils';
import { useRolePermissions } from '../src/hooks/useRolePermissions';

const formatDateValue = (value?: string | null) => {
  if (!value) return 'Not provided';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not provided';

  return date.toLocaleDateString('en-BD', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

const formatTextValue = (value?: string | null) => {
  const text = String(value || '').trim();
  return text || 'Not provided';
};

const InfoBlock: React.FC<{ label: string; value?: React.ReactNode; multiline?: boolean }> = ({ label, value, multiline = false }) => (
  <div>
    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">{label}</p>
    <div className={`text-sm md:text-base font-medium text-gray-800 ${multiline ? 'whitespace-pre-wrap leading-relaxed' : ''}`}>
      {value}
    </div>
  </div>
);

const SectionCard: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 md:p-7 space-y-6">
    <div>
      <h3 className="text-lg font-bold text-gray-900">{title}</h3>
      {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
    </div>
    {children}
  </div>
);

const UserDetails: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = db.currentUser;
  const { data: user, isPending: loading, error } = useUser(id);
  const deleteUserMutation = useDeleteUser();
  const toast = useToastNotifications();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { canEditUsers, canDeleteUsers } = useRolePermissions();

  if (loading) return <div className="p-8 text-center text-gray-500">Loading user...</div>;
  if (error || !user) return <div className="p-8 text-center text-gray-500">{error?.message || 'User not found.'}</div>;
  if (!currentUser) return <div className="p-8 text-center text-gray-500">Not authenticated.</div>;

  const canEdit = canEditUsers || currentUser.id === id;
  const isAdmin = hasAdminAccess(currentUser.role);
  const isDeveloperTarget = user.role === UserRole.DEVELOPER;
  const hasNidPassportCopy = Boolean(String(user.nidPassportCopy || '').trim());
  const hasCv = Boolean(String(user.cv || '').trim());
  const documentCount = Number(hasNidPassportCopy) + Number(hasCv);

  const handleDelete = async () => {
    if (!id) return;
    try {
      await deleteUserMutation.mutateAsync(id);
      toast.success('User moved to the recycle bin');
      navigate('/users');
    } catch (err) {
      console.error('Failed to delete user:', err);
      toast.error(err instanceof Error ? err.message : 'Could not delete the user. Please try again.');
    } finally {
      setShowDeleteConfirm(false);
    }
  };

  const handleOpenDocument = (documentUrl?: string | null, label?: string) => {
    const opened = openAttachmentPreview(documentUrl);
    if (!opened) {
      toast.error(`Unable to open ${label || 'document'}`);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <button onClick={() => {
            const navState = getPreservedRouteState(location.state);
            if (navState.backMode === 'history' && window.history.length > 1) {
              navigate(-1);
              return;
            }

            if (navState.from) {
              navigate(navState.from);
              return;
            }

            navigate('/users');
          }} className="p-2 hover:bg-white rounded-lg border border-transparent hover:border-gray-200 text-gray-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
          </button>
          <h2 className="text-2xl font-bold text-gray-900">User Profile</h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canEdit && (
            <button
              onClick={() => navigate(`/users/edit/${user.id}`)}
              className={`px-6 py-2 ${theme.colors.primary[600]} text-white rounded-xl font-bold hover:${theme.colors.primary[700]} shadow-md flex items-center gap-2`}
            >
              {ICONS.Edit} Edit Profile
            </button>
          )}
          {canDeleteUsers && !isDeveloperTarget && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleteUserMutation.isPending}
              className="px-6 py-2 bg-red-50 border border-red-200 text-red-600 rounded-xl font-bold hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Archive User
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
        <div className="xl:col-span-1 space-y-6">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="h-32" style={{ background: 'linear-gradient(90deg, var(--primary-color, #0f2f57), var(--primary-dark, #1a3a6e))' }}></div>
            <div className="px-6 pb-6">
              <div className="relative flex justify-between items-end -mt-12 mb-6 gap-4">
                <div className="p-1 bg-white rounded-full shadow-xl">
                  <img
                    src={user.image || '/uploads/Empty_avatar.png'}
                    className="w-24 h-24 rounded-full object-cover border border-black/10"
                  />
                </div>
                <span className={`px-4 py-1 rounded-full text-xs font-black uppercase tracking-widest ${
                  hasAdminAccess(user.role) ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                }`}>
                  {user.role}
                </span>
              </div>

              <div className="space-y-5">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Full Name</p>
                  <h3 className="text-2xl font-bold text-gray-900">{user.name}</h3>
                </div>
                <div className="space-y-3">
                  <InfoBlock label="Phone Number" value={formatTextValue(user.phone)} />
                  <InfoBlock
                    label="Email"
                    value={user.email ? (
                      <a href={`mailto:${user.email}`} className="text-[var(--primary-color,#0f2f57)] hover:underline break-all">
                        {user.email}
                      </a>
                    ) : 'Not provided'}
                  />
                  <InfoBlock label="Joining Date" value={formatDateValue(user.createdAt)} />
                </div>
              </div>
            </div>
          </div>

          <SectionCard title="Quick Summary" subtitle="At-a-glance profile information.">
            <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-1 gap-3">
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Role</p>
                <p className="text-sm font-bold text-gray-900">{formatTextValue(user.role)}</p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Compensation</p>
                <p className="text-sm font-bold text-gray-900">{user.isCommissionBased ? 'Commission Based' : 'Fixed Salary'}</p>
              </div>
              <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Documents</p>
                <p className="text-sm font-bold text-gray-900">{documentCount} uploaded</p>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="xl:col-span-2 space-y-6">
          <SectionCard title="Personal Information" subtitle="Basic identity and contact information for this user.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <InfoBlock label="Full Name" value={formatTextValue(user.name)} />
              <InfoBlock label="Phone Number" value={formatTextValue(user.phone)} />
              <InfoBlock
                label="Email"
                value={user.email ? (
                  <a href={`mailto:${user.email}`} className="text-[var(--primary-color,#0f2f57)] hover:underline break-all">
                    {user.email}
                  </a>
                ) : 'Not provided'}
              />
              <InfoBlock label="Birthday" value={formatDateValue(user.birthday)} />
              <InfoBlock label="Gender" value={formatTextValue(user.gender)} />
              <InfoBlock label="Blood Group" value={formatTextValue(user.bloodGroup)} />
              <InfoBlock label="Nationality" value={formatTextValue(user.nationality)} />
              <InfoBlock label="Joining Date" value={formatDateValue(user.createdAt)} />
              <div className="md:col-span-2">
                <InfoBlock label="Address" value={formatTextValue(user.address)} multiline />
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Employment & Compensation" subtitle="Role and salary information for this user.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <InfoBlock label="System Role" value={formatTextValue(user.role)} />
              <InfoBlock label="Compensation Model" value={user.isCommissionBased ? 'Commission Based' : 'Fixed Salary'} />
              <InfoBlock
                label="Fixed Salary"
                value={user.isCommissionBased ? 'Not applicable' : (user.fixedSalary != null ? formatCurrency(user.fixedSalary) : 'Not provided')}
              />
            </div>
          </SectionCard>

          <SectionCard title="Documents" subtitle="Uploaded profile documents and supporting files.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-5 space-y-3">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">NID / Passport Copy</p>
                  <p className="text-sm text-gray-600">
                    {hasNidPassportCopy ? 'Identity document is available for preview.' : 'No document uploaded'}
                  </p>
                </div>
                {hasNidPassportCopy && (
                  <button
                    onClick={() => handleOpenDocument(user.nidPassportCopy, 'NID / Passport copy')}
                    className={`px-4 py-2 ${theme.colors.primary[600]} text-white rounded-lg text-sm font-bold hover:${theme.colors.primary[700]}`}
                  >
                    View NID / Passport Copy
                  </button>
                )}
              </div>

              <div className="rounded-xl border border-gray-100 bg-gray-50 p-5 space-y-3">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">CV</p>
                  <p className="text-sm text-gray-600">
                    {hasCv ? 'CV is available for preview.' : 'No document uploaded'}
                  </p>
                </div>
                {hasCv && (
                  <button
                    onClick={() => handleOpenDocument(user.cv, 'CV')}
                    className={`px-4 py-2 ${theme.colors.primary[600]} text-white rounded-lg text-sm font-bold hover:${theme.colors.primary[700]}`}
                  >
                    View CV
                  </button>
                )}
              </div>
            </div>
          </SectionCard>

        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl shadow-lg max-w-sm w-full p-6 space-y-6">
            <div>
              <h3 className="text-lg font-bold text-gray-900 mb-2">Move User To Recycle Bin?</h3>
              <p className="text-gray-600 text-sm">
                Are you sure you want to archive <strong>{user.name}</strong>? You can restore this user later from the recycle bin.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteUserMutation.isPending}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteUserMutation.isPending}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleteUserMutation.isPending ? 'Archiving...' : 'Move To Bin'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserDetails;
