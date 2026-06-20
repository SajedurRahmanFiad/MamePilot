import React, { useEffect, useState } from 'react';
import { useAuth } from '../src/contexts/AuthProvider';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useSystemDefaults } from '../src/hooks/useQueries';
import { useUpdateSystemDefaults } from '../src/hooks/useMutations';
import { LoadingOverlay } from '../components';
import { Button } from '../components';
import { hasAdminAccess } from '../types';
import { theme } from '../theme';

const DeveloperSettings: React.FC = () => {
  const { user } = useAuth();
  const { data: systemDefaults, isPending: loadingDefaults } = useSystemDefaults();
  const updateSystemDefaults = useUpdateSystemDefaults();
  const toast = useToastNotifications();
  const [whiteLabel, setWhiteLabel] = useState(false);

  useEffect(() => {
    if (systemDefaults) {
      setWhiteLabel(Boolean(systemDefaults.whiteLabel));
    }
  }, [systemDefaults]);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block p-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
          </div>
          <p className="mt-4 text-gray-600 font-medium">Loading user data...</p>
        </div>
      </div>
    );
  }

  if (!hasAdminAccess(user.role)) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Developer Access Only</p>
          <h2 className="mt-3 text-2xl font-black text-gray-900">Developer settings are available only to developer users.</h2>
          <p className="mt-2 text-sm font-medium text-gray-500">Please sign in with a developer account to manage these settings.</p>
        </div>
      </div>
    );
  }

  const handleSave = async () => {
    const toastId = toast.loading('Saving developer settings...');
    try {
      await updateSystemDefaults.mutateAsync({ whiteLabel });
      toast.update(toastId, 'Developer settings saved successfully.', 'success');
    } catch (err) {
      console.error('Failed to save developer settings:', err);
      toast.update(
        toastId,
        `Failed to save developer settings: ${err instanceof Error ? err.message : 'Unknown error'}`,
        'error',
      );
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <LoadingOverlay isLoading={loadingDefaults || updateSystemDefaults.isPending} message="Loading developer settings..." />

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="md:text-2xl text-xl font-bold text-gray-900">Developer Settings</h2>
          <p className="mt-1 text-sm text-gray-500">General configuration for developer-only features.</p>
        </div>
        <Button onClick={handleSave} variant="primary" size="md" disabled={updateSystemDefaults.isPending}>
          Save Changes
        </Button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-xl font-bold text-gray-800">General</h3>
            <p className="mt-2 text-sm text-gray-500">
              Control the main developer-only experience and branding behavior.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-full border border-gray-200 bg-gray-50 px-4 py-3">
            <label className="text-sm font-medium text-gray-700">White label</label>
            <input
              type="checkbox"
              checked={whiteLabel}
              onChange={(event) => setWhiteLabel(event.target.checked)}
              className="h-5 w-10 rounded-full border-gray-300 bg-white accent-blue-600"
            />
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-[#d6e3f0] bg-[#f8fbff] px-6 py-5">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Preview</p>
          <p className="mt-3 text-lg font-black text-gray-900">{whiteLabel ? 'Company branding is enabled' : 'Using default Mame Pilot branding'}</p>
          <p className="mt-2 text-sm text-gray-500">
            When white label is enabled, login and sidebar branding use current company settings instead of hardcoded Mame Pilot assets.
          </p>
        </div>
      </div>
    </div>
  );
};

export default DeveloperSettings;
