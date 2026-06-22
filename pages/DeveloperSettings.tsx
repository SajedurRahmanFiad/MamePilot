import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, LoadingOverlay } from '../components';
import { useAuth } from '../src/contexts/AuthProvider';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useCapabilitySettings, useCourierSettings, useMaintenanceStatus, usePaymentGatewaySettings } from '../src/hooks/useQueries';
import { useSetMaintenanceStatus, useSyncLicenseCapabilities, useUpdateCourierSettings, useUpdatePaymentGatewaySettings } from '../src/hooks/useMutations';
import { hasAdminAccess, type PaymentGatewaySettings } from '../types';
import { theme } from '../theme';

type TabId = 'license' | 'payment-gateway' | 'fraud-checker' | 'maintenance';

const emptyGateway: PaymentGatewaySettings = {
  piprapayBaseUrl: '',
  piprapayApiKey: '',
  piprapayMerchantId: '',
  piprapayIpnSecret: '',
};

const DeveloperSettings: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToastNotifications();
  const { data: capabilitySettings, isPending: loadingCapabilities } = useCapabilitySettings(Boolean(user));
  const { data: courierSettings, isPending: loadingCourierSettings } = useCourierSettings();
  const { data: gatewaySettings, isPending: loadingGateway } = usePaymentGatewaySettings(user?.role === 'Developer');
  const { data: maintenanceStatus, isPending: loadingMaintenance } = useMaintenanceStatus(Boolean(user));
  const syncCapabilities = useSyncLicenseCapabilities();
  const updateCourierSettings = useUpdateCourierSettings();
  const updateGateway = useUpdatePaymentGatewaySettings();
  const setMaintenanceStatus = useSetMaintenanceStatus();

  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);

  const urlTab = searchParams.get('tab');
  const tabIds: TabId[] = ['license', 'maintenance', 'payment-gateway', 'fraud-checker'];
  const [activeTab, setActiveTab] = useState<TabId>(tabIds.includes(urlTab as TabId) ? (urlTab as TabId) : 'license');
  const [licenseForm, setLicenseForm] = useState({ licenseKey: '', licenseApiUrl: '', licenseOwnerToken: '' });
  const [gatewayForm, setGatewayForm] = useState<PaymentGatewaySettings>(emptyGateway);
  const [fraudSettings, setFraudSettings] = useState({ apiKey: '' });

  useEffect(() => {
    if (!capabilitySettings) return;
    setLicenseForm({
      licenseKey: capabilitySettings.licenseKey || '',
      licenseApiUrl: capabilitySettings.licenseApiUrl || '',
      licenseOwnerToken: capabilitySettings.licenseOwnerToken || '',
    });
  }, [capabilitySettings]);

  useEffect(() => {
    if (gatewaySettings) {
      setGatewayForm(gatewaySettings);
    }
  }, [gatewaySettings]);

  useEffect(() => {
    if (courierSettings) {
      setFraudSettings(courierSettings.fraudChecker || { apiKey: '' });
    }
  }, [courierSettings]);

  useEffect(() => {
    if (maintenanceStatus?.maintenanceEnabled !== undefined) {
      setMaintenanceEnabled(maintenanceStatus.maintenanceEnabled);
    }
  }, [maintenanceStatus]);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab && tabIds.includes(tab as TabId) && tab !== activeTab) {
      setActiveTab(tab as TabId);
    }
  }, [searchParams]);

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    if (activeTab === 'license') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', activeTab);
    }
    setSearchParams(nextParams, { replace: true });
  }, [activeTab]);

  if (!user) {
    return <div className="p-8 text-center text-gray-500">Loading developer settings...</div>;
  }

  if (!hasAdminAccess(user.role) || user.role !== 'Developer') {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Developer Access Only</p>
          <h2 className="mt-3 text-2xl font-black text-gray-900">Developer settings are available only to developer users.</h2>
        </div>
      </div>
    );
  }

  const syncNow = async () => {
    const toastId = toast.loading('Syncing license capabilities...');
    try {
      await syncCapabilities.mutateAsync(licenseForm);
      toast.update(toastId, 'License capabilities synced.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'License sync failed.', 'error');
    }
  };

  const saveGateway = async () => {
    const toastId = toast.loading('Saving gateway credentials...');
    try {
      await updateGateway.mutateAsync(gatewayForm);
      toast.update(toastId, 'Payment gateway settings saved.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Failed to save gateway settings.', 'error');
    }
  };

  const saveFraudSettings = async () => {
    const toastId = toast.loading('Saving fraud checker settings...');
    try {
      await updateCourierSettings.mutateAsync({ fraudChecker: fraudSettings });
      toast.update(toastId, 'Fraud checker settings saved.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Failed to save fraud checker settings.', 'error');
    }
  };

  const saveMaintenanceMode = async () => {
    const toastId = toast.loading('Updating maintenance mode...');
    try {
      const result = await setMaintenanceStatus.mutateAsync({ maintenanceEnabled: !maintenanceEnabled });
      setMaintenanceEnabled(result.maintenanceEnabled);
      toast.update(toastId, result.maintenanceEnabled ? 'Maintenance mode enabled.' : 'Maintenance mode disabled.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Failed to update maintenance mode.', 'error');
    }
  };

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'license', label: 'License Sync' },
    { id: 'maintenance', label: 'Maintenance Mode' },
    { id: 'payment-gateway', label: 'Payment Gateway' },
    { id: 'fraud-checker', label: 'Fraud Checker' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <LoadingOverlay
        isLoading={loadingCapabilities || loadingCourierSettings || loadingGateway || loadingMaintenance || updateGateway.isPending || updateCourierSettings.isPending || syncCapabilities.isPending}
        message="Loading developer settings..."
      />

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Developer Access Only</p>
          <h2 className="mt-1 md:text-2xl text-xl font-bold text-gray-900">Developer Settings</h2>
          <p className="mt-1 text-sm text-gray-500">Control central license sync, maintenance mode, and service configuration.</p>
        </div>
        {activeTab === 'license' && <Button onClick={syncNow} variant="primary">Sync Now</Button>}
        {activeTab === 'maintenance' && <Button onClick={saveMaintenanceMode} variant="primary">{maintenanceEnabled ? 'Disable Maintenance' : 'Enable Maintenance'}</Button>}
        {activeTab === 'payment-gateway' && <Button onClick={saveGateway} variant="primary">Save Gateway</Button>}
        {activeTab === 'fraud-checker' && <Button onClick={saveFraudSettings} variant="primary">Save Fraud Checker</Button>}
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="space-y-1 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex w-full items-center justify-start gap-3 rounded-2xl px-4 py-3 text-left text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? `${theme.colors.primary[600]} text-white shadow-sm border border-gray-100 ring-1 ring-[#ebf4ff]`
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="space-y-6">
          {activeTab === 'license' && (
            <section className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm space-y-6">
              <div>
                <h3 className="text-xl font-black text-gray-900">Remote License Sync</h3>
                <p className="mt-1 text-sm text-gray-500">This local installation can sync enabled capabilities from your central license API.</p>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">License Key</span>
                  <input className="w-full rounded-xl border border-gray-200 px-4 py-3" value={licenseForm.licenseKey} onChange={(e) => setLicenseForm({ ...licenseForm, licenseKey: e.target.value })} />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">License API URL</span>
                  <input className="w-full rounded-xl border border-gray-200 px-4 py-3" value={licenseForm.licenseApiUrl} onChange={(e) => setLicenseForm({ ...licenseForm, licenseApiUrl: e.target.value })} placeholder="https://license.your-domain.com/api.php" />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Owner Token</span>
                  <input type="password" className="w-full rounded-xl border border-gray-200 px-4 py-3" value={licenseForm.licenseOwnerToken} onChange={(e) => setLicenseForm({ ...licenseForm, licenseOwnerToken: e.target.value })} placeholder="Central owner token for tier changes" />
                </label>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5 text-sm text-gray-600">
                <p><span className="font-black text-gray-900">Plan:</span> {capabilitySettings?.planName || 'Local/manual'}</p>
                <p><span className="font-black text-gray-900">Status:</span> {capabilitySettings?.licenseStatus || 'local'}</p>
                <p><span className="font-black text-gray-900">Last sync:</span> {capabilitySettings?.lastSyncedAt ? new Date(capabilitySettings.lastSyncedAt).toLocaleString() : 'Never'}</p>
                {capabilitySettings?.lastSyncMessage && <p className="mt-1">{capabilitySettings.lastSyncMessage}</p>}
              </div>
            </section>
          )}

          {activeTab === 'maintenance' && (
            <section className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm space-y-6">
              <div>
                <h3 className="text-xl font-black text-gray-900">Maintenance Mode</h3>
                <p className="mt-1 text-sm text-gray-500">When enabled, all non-developer users are redirected to the maintenance page and login is restricted to developer users only.</p>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Maintenance Enabled</span>
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={maintenanceEnabled}
                      onChange={() => setMaintenanceEnabled((current) => !current)}
                      className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-700">{maintenanceEnabled ? 'Maintenance mode is currently enabled.' : 'Maintenance mode is currently disabled.'}</span>
                  </div>
                </label>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5 text-sm text-gray-600">
                <p className="font-semibold text-gray-900">Status</p>
                <p>{maintenanceEnabled ? 'Maintenance mode is active. Non-developer users are blocked from signing in.' : 'Maintenance mode is inactive.'}</p>
                <p className="mt-2">When central license sync is configured, maintenance status will also be persisted to the central API if possible.</p>
              </div>
            </section>
          )}

          {activeTab === 'payment-gateway' && (
            <section className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm space-y-6">
              <div>
                <h3 className="text-xl font-black text-gray-900">PipraPay Gateway</h3>
                <p className="mt-1 text-sm text-gray-500">Stored locally and visible only to developer users. DB admins can still read these values.</p>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                {[
                  ['piprapayBaseUrl', 'PipraPay Base URL', 'https://checkout.my-domain.com'],
                  ['piprapayApiKey', 'PipraPay API Key', ''],
                ].map(([field, label, placeholder]) => (
                  <label key={field} className="space-y-2">
                    <span className="text-xs font-black uppercase tracking-widest text-gray-400">{label}</span>
                    <input
                      type={field.includes('Key') || field.includes('Secret') ? 'password' : 'text'}
                      className="w-full rounded-xl border border-gray-200 px-4 py-3"
                      value={String(gatewayForm[field as keyof PaymentGatewaySettings] || '')}
                      onChange={(e) => setGatewayForm({ ...gatewayForm, [field]: e.target.value })}
                      placeholder={placeholder}
                    />
                  </label>
                ))}
              </div>
            </section>
          )}

          {activeTab === 'fraud-checker' && (
            <section className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm space-y-6">
              <div>
                <h3 className="text-xl font-black text-gray-900">Fraud Checker</h3>
                <p className="mt-1 text-sm text-gray-500">Manage the fraud checker API key for courier history checks.</p>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Fraud Checker API Key</span>
                  <input
                    type="password"
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                    value={fraudSettings.apiKey}
                    onChange={(e) => setFraudSettings({ apiKey: e.target.value })}
                    placeholder="Paste your fraud checker API key"
                  />
                </label>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeveloperSettings;
