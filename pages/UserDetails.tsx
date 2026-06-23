
import React, { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { db } from '../db';
import { UserRole, hasAdminAccess } from '../types';
import { ICONS } from '../constants';
import { theme } from '../theme';
import { useUser } from '../src/hooks/useQueries';
import { useDeleteUser, useUpdateUser } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { getPreservedRouteState } from '../src/utils/navigation';

const UserDetails: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const currentUser = db.currentUser;
  const { data: user, isPending: loading, error } = useUser(id);
  const deleteUserMutation = useDeleteUser();
  const updateUserMutation = useUpdateUser();
  const toast = useToastNotifications();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPassword, setShowPassword] = useState(true);
  const [editedPassword, setEditedPassword] = useState('');

  // Initialize editedPassword with user's current password
  React.useEffect(() => {
    console.log('[UserDetails] User data loaded:', { id: user?.id, name: user?.name, password: user?.password ? '(exists)' : '(missing)' });
    if (user && user.password) {
      console.log('[UserDetails] Setting editedPassword from user.password');
      setEditedPassword(user.password);
    } else if (user) {
      console.log('[UserDetails] WARNING: user loaded but password is missing/empty!');
      setEditedPassword('');
    }
  }, [user?.id, user?.password]);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading user...</div>;
  if (error || !user) return <div className="p-8 text-center text-gray-500">{error?.message || 'User not found.'}</div>;
  if (!currentUser) return <div className="p-8 text-center text-gray-500">Not authenticated.</div>;

  const canEdit = hasAdminAccess(currentUser.role) || currentUser.id === id;
  const isAdmin = hasAdminAccess(currentUser.role);
  const isDeveloperTarget = user.role === UserRole.DEVELOPER;

  const handleDelete = async () => {
    if (!id) return;
    try {
      await deleteUserMutation.mutateAsync(id);
      toast.success('User moved to the recycle bin');
      navigate('/users');
    } catch (err) {
      console.error('Failed to delete user:', err);
      toast.error('Failed to delete user: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setShowDeleteConfirm(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!id || !editedPassword.trim()) {
      toast.warning('Please enter a password');
      return;
    }

    try {
      await updateUserMutation.mutateAsync({
        id,
        updates: { password: editedPassword }
      });
      toast.success('Password updated successfully!');
    } catch (err) {
      console.error('Failed to update password:', err);
      toast.error('Failed to update password: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
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
        <div className="flex items-center gap-2">
          {canEdit && (
            <button 
              onClick={() => navigate(`/users/edit/${user.id}`)}
              className={`px-6 py-2 ${theme.colors.primary[600]} text-white rounded-xl font-bold hover:${theme.colors.primary[700]} shadow-md flex items-center gap-2`}
            >
              {ICONS.Edit} Edit Profile
            </button>
          )}
          {isAdmin && !isDeveloperTarget && (
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

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="h-32" style={{ background: 'linear-gradient(90deg, var(--primary-color, #0f2f57), var(--primary-dark, #1a3a6e))' }}></div>
        <div className="px-8 pb-8">
          <div className="relative flex justify-between items-end -mt-12 mb-8">
            <div className="p-1 bg-white rounded-full shadow-xl">
              <img 
                src={user.image || 'https://picsum.photos/200/200?random=' + user.id} 
                className="w-24 h-24 rounded-full object-cover border-1 border-black" 
              />
            </div>
            <span className={`px-4 py-1 rounded-full text-xs font-black uppercase tracking-widest ${
              hasAdminAccess(user.role) ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {user.role}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Full Name</p>
                <h3 className="text-xl font-bold text-gray-900">{user.name}</h3>
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Phone Number</p>
                <p className="text-lg font-medium text-gray-700">{user.phone}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Joining Date</p>
                <p className="text-lg font-medium text-gray-700">{user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-BD', { year: 'numeric', month: 'long', day: 'numeric' }) : 'N/A'}</p>
              </div>
            </div>
            <div className="bg-gray-50 p-6 rounded-lg space-y-4">
              <h4 className="font-bold text-gray-900">Account Security</h4>
              {isAdmin ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Password</p>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={editedPassword}
                        onChange={(e) => setEditedPassword(e.target.value)}
                        className="w-full px-4 py-3 pr-10 bg-white rounded-lg font-mono text-sm text-gray-700 border-[var(--primary-medium,#3c5a82)] focus:ring-2 focus:ring-[var(--primary-medium,#3c5a82)] focus:border-transparent"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--primary-color,#0f2f57)] hover:text-[var(--primary-dark,#0c203b)]"
                      >
                        {showPassword ? (
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"></path><path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd"></path></svg>
                        ) : (
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-14-14zM10 4C6.687 4 3.89 5.945 2.58 8.808c-.35.915-.35 2.468 0 3.384.74 1.94 2.08 3.61 3.756 4.7l1.83-1.83A3.992 3.992 0 016 10a4 4 0 016.956-3.533l1.416-1.416C14.225 4.523 12.15 4 10 4zm7.42 3.192c.35.915.35 2.468 0 3.384C15.26 13.055 12.463 15 9 15a6.966 6.966 0 01-3.15-.744l2.119-2.119A3.992 3.992 0 0114 10c0-.901-.281-1.735-.743-2.434l2.163-2.174z" clipRule="evenodd"></path></svg>
                        )}
                      </button>
                    </div>
                    <button
                      onClick={handleUpdatePassword}
                      disabled={updateUserMutation.isPending || editedPassword === user.password}
                      className={`mt-3 w-full px-3 py-2 ${theme.colors.primary[600]} text-white rounded-lg text-sm font-bold hover:${theme.colors.primary[700]} disabled:opacity-50 disabled:cursor-not-allowed transition-colors`}
                    >
                      {updateUserMutation.isPending ? 'Updating...' : 'Update Password'}
                    </button>
                    <p className="text-[10px] text-[var(--primary-color,#0f2f57)] font-medium mt-2">Admin access only. Edit and save password here.</p>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm text-gray-500">Passwords are managed by system administrators. If you need to reset your password, please contact the IT department.</p>
                  <div className={`flex items-center gap-2 text-emerald-700 text-sm font-bold`}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
                    Active Status Verified
                  </div>
                </>
              )}
            </div>
          </div>
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
