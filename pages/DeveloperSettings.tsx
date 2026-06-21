import React, { useEffect, useState } from 'react';
import { Button, LoadingOverlay } from '../components';
import { useAuth } from '../src/contexts/AuthProvider';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useCapabilitySettings, usePaymentGatewaySettings } from '../src/hooks/useQueries';
import { useSyncLicenseCapabilities, useUpdatePaymentGatewaySettings } from '../src/hooks/useMutations';
import { hasAdminAccess, type PaymentGatewaySettings } from '../types';

type TabId = 'license' | 'payment-gateway';

const emptyGateway: PaymentGatewaySettings = {
  piprapayBaseUrl: '',
  piprapayApiKey: '',
  piprapayMerchantId: '',
  piprapayIpnSecret: '',
};

const DeveloperSettings: React.FC = () => {
  const { user } = useAuth();
  const toast = useToastNotifications();
  const { data: capabilitySettings, isPending: loadingCapabilities } = useCapabilitySettings(Boolean(user));
  const { data: gatewaySettings, isPending: loadingGateway } = usePaymentGatewaySettings(user?.role === 'Developer');
  const syncCapabilities = useSyncLicenseCapabilities();
  const updateGateway = useUpdatePaymentGatewaySettings();

  const [activeTab, setActiveTab] = useState<TabId>('license');
  const [licenseForm, setLicenseForm] = useState({ licenseKey: '', licenseApiUrl: '', licenseOwnerToken: '' });
  const [gatewayForm, setGatewayForm] = useState<PaymentGatewaySettings>(emptyGateway);

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

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'license', label: 'License Sync' },
    { id: 'payment-gateway', label: 'Payment Gateway' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <LoadingOverlay
        isLoading={loadingCapabilities || loadingGateway || updateGateway.isPending || syncCapabilities.isPending}
        message="Loading developer settings..."
      />

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Developer Access Only</p>
          <h2 className="mt-1 md:text-2xl text-xl font-bold text-gray-900">Developer Settings</h2>
          <p className="mt-1 text-sm text-gray-500">Control central license sync and PipraPay credentials.</p>
        </div>
        {activeTab === 'license' && <Button onClick={syncNow} variant="primary">Sync Now</Button>}
        {activeTab === 'payment-gateway' && <Button onClick={saveGateway} variant="primary">Save Gateway</Button>}
      </div>

      <div className="flex flex-wrap gap-2 rounded-2xl border border-gray-100 bg-white p-2 shadow-sm">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-xl px-4 py-2 text-sm font-black transition-all ${
              activeTab === tab.id ? 'bg-[#0f2f57] text-white' : 'text-gray-500 hover:bg-gray-50'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

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
    </div>
  );
};

export default DeveloperSettings;
