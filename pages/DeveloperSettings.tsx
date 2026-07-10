import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, LoadingOverlay } from '../components';
import { useAuth } from '../src/contexts/AuthProvider';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useCapabilitySettings, useCourierSettings, useMaintenanceStatus, usePaymentGatewaySettings, useAgentSettings, useBusinessGrowthSettings } from '../src/hooks/useQueries';
import { useSetMaintenanceStatus, useSyncLicenseCapabilities, useUpdateCourierSettings, useUpdatePaymentGatewaySettings, useUpdateAgentSettings, useUpdateBusinessGrowthSettings } from '../src/hooks/useMutations';
import { hasAdminAccess, type PaymentGatewaySettings, type AgentSettings, type BusinessGrowthSettings } from '../types';
import { theme } from '../theme';

type TabId = 'license' | 'payment-gateway' | 'fraud-checker' | 'maintenance' | 'agent' | 'business_growth';

const emptyGateway: PaymentGatewaySettings = {
  piprapayBaseUrl: '',
  piprapayApiKey: '',
  piprapayMerchantId: '',
  piprapayIpnSecret: '',
  piprapayWebhookUrl: '',
  piprapayReturnUrl: '',
};

const emptyAgentSettings: AgentSettings = {
  enabled: false,
  mainProvider: 'anthropic',
  anthropic: { enabled: false, baseUrl: '', apiKey: '', model: '', organization: '', project: '' },
  openai: { enabled: false, baseUrl: '', apiKey: '', model: '', organization: '', project: '' },
  google: { enabled: false, baseUrl: '', apiKey: '', model: '', organization: '', project: '' },
  openrouter: { enabled: false, baseUrl: '', apiKey: '', model: '', organization: '', project: '' },
  groq: { enabled: false, baseUrl: '', apiKey: '', model: '', organization: '', project: '' },
  showReasoningSummaries: true,
  showToolActivity: true,
  maxReasoningSteps: 5,
  maxToolCalls: 10,
  queryRowLimit: 1000,
  queryTimeoutMs: 30000,
};

const emptyBusinessGrowthSettings: BusinessGrowthSettings = {
  provider: 'openai',
  openai: { baseUrl: '', apiKey: '', model: '' },
  anthropic: { baseUrl: '', apiKey: '', model: '' },
  google: { baseUrl: '', apiKey: '', model: '' },
  openrouter: { baseUrl: '', apiKey: '', model: '' },
  groq: { baseUrl: '', apiKey: '', model: '' },
  recommendationCacheHours: 6,
};

const DeveloperSettings: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToastNotifications();
  const { data: capabilitySettings, isPending: loadingCapabilities } = useCapabilitySettings(Boolean(user));
  const { data: courierSettings, isPending: loadingCourierSettings } = useCourierSettings();
  const { data: gatewaySettings, isPending: loadingGateway } = usePaymentGatewaySettings(user?.role === 'Developer');
  const { data: maintenanceStatus, isPending: loadingMaintenance } = useMaintenanceStatus(Boolean(user));
  const { data: agentSettings, isPending: loadingAgent } = useAgentSettings(user?.role === 'Developer');
  const { data: businessGrowthSettings, isPending: loadingBusinessGrowth } = useBusinessGrowthSettings(user?.role === 'Developer');
  const syncCapabilities = useSyncLicenseCapabilities();
  const updateCourierSettings = useUpdateCourierSettings();
  const updateGateway = useUpdatePaymentGatewaySettings();
  const setMaintenanceStatus = useSetMaintenanceStatus();
  const updateAgent = useUpdateAgentSettings();
  const updateBusinessGrowth = useUpdateBusinessGrowthSettings();

  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [agentForm, setAgentForm] = useState<AgentSettings>(emptyAgentSettings);
  const [businessGrowthForm, setBusinessGrowthForm] = useState<BusinessGrowthSettings>(emptyBusinessGrowthSettings);

  const urlTab = searchParams.get('tab');
  const tabIds: TabId[] = ['license', 'maintenance', 'payment-gateway', 'fraud-checker', 'agent', 'business_growth'];
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
    if (agentSettings) {
      setAgentForm(agentSettings);
    }
  }, [agentSettings]);

  useEffect(() => {
    if (businessGrowthSettings) {
      setBusinessGrowthForm(businessGrowthSettings);
    }
  }, [businessGrowthSettings]);

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

  const saveAgentSettings = async () => {
    const toastId = toast.loading('Saving AI agent settings...');
    try {
      await updateAgent.mutateAsync(agentForm);
      toast.update(toastId, 'AI agent settings saved.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Failed to save AI agent settings.', 'error');
    }
  };

  const saveBusinessGrowthSettings = async () => {
    const toastId = toast.loading('Saving business growth settings...');
    try {
      await updateBusinessGrowth.mutateAsync(businessGrowthForm);
      toast.update(toastId, 'Business growth settings saved.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Failed to save business growth settings.', 'error');
    }
  };

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'license', label: 'License Sync' },
    { id: 'maintenance', label: 'Maintenance Mode' },
    { id: 'payment-gateway', label: 'Payment Gateway' },
    { id: 'fraud-checker', label: 'Fraud Checker' },
    { id: 'agent', label: 'AI Agent' },
    { id: 'business_growth', label: 'Business Growth' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <LoadingOverlay
        isLoading={loadingCapabilities || loadingCourierSettings || loadingGateway || loadingMaintenance || loadingAgent || loadingBusinessGrowth || updateGateway.isPending || updateCourierSettings.isPending || syncCapabilities.isPending || updateAgent.isPending || updateBusinessGrowth.isPending}
        message="Loading developer settings..."
      />

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div />
        {activeTab === 'license' && <Button onClick={syncNow} variant="primary">Sync Now</Button>}
        {activeTab === 'payment-gateway' && <Button onClick={saveGateway} variant="primary">Save Gateway</Button>}
        {activeTab === 'fraud-checker' && <Button onClick={saveFraudSettings} variant="primary">Save Fraud Checker</Button>}
        {activeTab === 'agent' && <Button onClick={saveAgentSettings} variant="primary">Save AI Agent Settings</Button>}
        {activeTab === 'business_growth' && <Button onClick={saveBusinessGrowthSettings} variant="primary">Save Business Growth Settings</Button>}
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
              <div>
                <Button onClick={saveMaintenanceMode} variant="primary">
                  {maintenanceEnabled ? 'Disable Maintenance' : 'Enable Maintenance'}
                </Button>
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
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">PipraPay Webhook URL</span>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                    value={String(gatewayForm.piprapayWebhookUrl || '')}
                    onChange={(e) => setGatewayForm({ ...gatewayForm, piprapayWebhookUrl: e.target.value })}
                    placeholder="https://your-deployment.com/api/?action=handlePipraPayIpn"
                  />
                  <p className="text-sm text-gray-500">Use your deployment base URL plus <span className="font-semibold text-gray-700">/api/?action=handlePipraPayIpn</span>.</p>
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">PipraPay Return URL</span>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                    value={String(gatewayForm.piprapayReturnUrl || '')}
                    onChange={(e) => setGatewayForm({ ...gatewayForm, piprapayReturnUrl: e.target.value })}
                    placeholder="https://your-deployment.com/subscriptions"
                  />
                  <p className="text-sm text-gray-500">Use your deployment base URL plus <span className="font-semibold text-gray-700">/#/subscriptions</span>. This is where users return after payment.</p>
                </label>
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

          {activeTab === 'agent' && (
            <section className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm space-y-6">
              <div>
                <h3 className="text-xl font-black text-gray-900">AI Agent Settings</h3>
                <p className="mt-1 text-sm text-gray-500">Configure the enterprise AI agent runtime, providers, and tool behavior.</p>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Main Provider</span>
                  <select
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3"
                    value={agentForm.mainProvider}
                    onChange={(e) => setAgentForm({ ...agentForm, mainProvider: e.target.value as any })}
                  >
                    <option value="anthropic">Anthropic</option>
                    <option value="openai">OpenAI</option>
                    <option value="google">Google</option>
                  </select>
                </label>

                <label className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={agentForm.enabled}
                    onChange={(e) => setAgentForm({ ...agentForm, enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <div>
                    <p className="text-sm font-black text-gray-900">Enable AI Agent Runtime</p>
                    <p className="text-sm text-gray-500">Turn the enterprise agent on or off for this installation.</p>
                  </div>
                </label>

                {(['anthropic', 'openai', 'google', 'openrouter', 'groq'] as const).map((provider) => {
                  const providerConfig = agentForm[provider];
                  const label = provider === 'groq' ? 'Deterministic Groq' : provider === 'openrouter' ? 'OpenRouter Provider' : `${provider.charAt(0).toUpperCase() + provider.slice(1)} Provider`;
                  return (
                    <div key={provider} className="rounded-2xl border border-gray-100 bg-gray-50 p-5 space-y-4 md:col-span-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-black text-gray-900">{label}</p>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <input
                            id={`agent-${provider}-enabled`}
                            type="checkbox"
                            checked={providerConfig.enabled}
                            onChange={(e) => setAgentForm({
                              ...agentForm,
                              [provider]: { ...providerConfig, enabled: e.target.checked },
                            })}
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                          <label htmlFor={`agent-${provider}-enabled`}>Enabled</label>
                        </div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="space-y-2">
                          <span className="text-xs font-black uppercase tracking-widest text-gray-400">Base URL</span>
                          <input
                            className="w-full rounded-xl border border-gray-200 px-4 py-3"
                            value={providerConfig.baseUrl}
                            onChange={(e) => setAgentForm({
                              ...agentForm,
                              [provider]: { ...providerConfig, baseUrl: e.target.value },
                            })}
                            placeholder={provider === 'groq' ? 'https://api.groq.com' : 'https://api.your-provider.com'}
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-black uppercase tracking-widest text-gray-400">API Key</span>
                          <input
                            type="password"
                            className="w-full rounded-xl border border-gray-200 px-4 py-3"
                            value={providerConfig.apiKey}
                            onChange={(e) => setAgentForm({
                              ...agentForm,
                              [provider]: { ...providerConfig, apiKey: e.target.value },
                            })}
                            placeholder="Paste API key"
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-black uppercase tracking-widest text-gray-400">Model</span>
                          <input
                            className="w-full rounded-xl border border-gray-200 px-4 py-3"
                            value={providerConfig.model}
                            onChange={(e) => setAgentForm({
                              ...agentForm,
                              [provider]: { ...providerConfig, model: e.target.value },
                            })}
                            placeholder="e.g. gpt-4o-mini"
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-black uppercase tracking-widest text-gray-400">Organization</span>
                          <input
                            className="w-full rounded-xl border border-gray-200 px-4 py-3"
                            value={providerConfig.organization || ''}
                            onChange={(e) => setAgentForm({
                              ...agentForm,
                              [provider]: { ...providerConfig, organization: e.target.value },
                            })}
                            placeholder="Optional organization id"
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-black uppercase tracking-widest text-gray-400">Project</span>
                          <input
                            className="w-full rounded-xl border border-gray-200 px-4 py-3"
                            value={providerConfig.project || ''}
                            onChange={(e) => setAgentForm({
                              ...agentForm,
                              [provider]: { ...providerConfig, project: e.target.value },
                            })}
                            placeholder="Optional project id"
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5 space-y-4 md:grid md:grid-cols-2 md:gap-4">
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Max Reasoning Steps</span>
                  <input
                    type="number"
                    min={1}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                    value={agentForm.maxReasoningSteps}
                    onChange={(e) => setAgentForm({ ...agentForm, maxReasoningSteps: Number(e.target.value) })}
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Max Tool Calls</span>
                  <input
                    type="number"
                    min={1}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                    value={agentForm.maxToolCalls}
                    onChange={(e) => setAgentForm({ ...agentForm, maxToolCalls: Number(e.target.value) })}
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Query Row Limit</span>
                  <input
                    type="number"
                    min={1}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                    value={agentForm.queryRowLimit}
                    onChange={(e) => setAgentForm({ ...agentForm, queryRowLimit: Number(e.target.value) })}
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Query Timeout (sec)</span>
                  <input
                    type="number"
                    min={5}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                    value={Math.round(agentForm.queryTimeoutMs / 1000)}
                    onChange={(e) => setAgentForm({ ...agentForm, queryTimeoutMs: Number(e.target.value) * 1000 })}
                  />
                </label>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4">
                  <input
                    type="checkbox"
                    checked={agentForm.showReasoningSummaries}
                    onChange={(e) => setAgentForm({ ...agentForm, showReasoningSummaries: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <div>
                    <p className="text-sm font-black text-gray-900">Show reasoning summaries</p>
                    <p className="text-sm text-gray-500">Display structured reasoning output in the agent chat widget.</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4">
                  <input
                    type="checkbox"
                    checked={agentForm.showToolActivity}
                    onChange={(e) => setAgentForm({ ...agentForm, showToolActivity: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <div>
                    <p className="text-sm font-black text-gray-900">Show tool activity</p>
                    <p className="text-sm text-gray-500">Expose structured tool execution and query details in the UI.</p>
                  </div>
                </label>
              </div>
            </section>
          )}

          {activeTab === 'business_growth' && (
            <section className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm space-y-6">
              <div>
                <h3 className="text-xl font-black text-gray-900">Business Growth AI Settings</h3>
                <p className="mt-1 text-sm text-gray-500">Configure the AI provider used to generate product recommendations and business insights.</p>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Provider</span>
                  <select
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3"
                    value={businessGrowthForm.provider}
                    onChange={(e) => setBusinessGrowthForm({ ...businessGrowthForm, provider: e.target.value as BusinessGrowthSettings['provider'] })}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google</option>
                    <option value="openrouter">OpenRouter</option>
                    <option value="groq">Groq</option>
                  </select>
                </label>

                {(['openai', 'anthropic', 'google', 'openrouter', 'groq'] as const).map((provider) => {
                  const providerConfig = businessGrowthForm[provider];
                  const isActive = businessGrowthForm.provider === provider;
                  return (
                    <div key={provider} className={`rounded-2xl border p-5 space-y-4 md:col-span-2 ${isActive ? 'border-primary-200 bg-primary-50/30' : 'border-gray-100 bg-gray-50'}`}>
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-black text-gray-900">{provider.charAt(0).toUpperCase() + provider.slice(1)}</p>
                        {isActive && <span className="text-xs font-bold text-primary-600 bg-primary-100 px-2 py-1 rounded-full">Active</span>}
                      </div>
                      <div className="grid gap-4 md:grid-cols-3">
                        <label className="space-y-2">
                          <span className="text-xs font-black uppercase tracking-widest text-gray-400">Base URL</span>
                          <input
                            className="w-full rounded-xl border border-gray-200 px-4 py-3"
                            value={providerConfig.baseUrl}
                            onChange={(e) => setBusinessGrowthForm({
                              ...businessGrowthForm,
                              [provider]: { ...providerConfig, baseUrl: e.target.value },
                            })}
                            placeholder="https://api.your-provider.com"
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-black uppercase tracking-widest text-gray-400">API Key</span>
                          <input
                            type="password"
                            className="w-full rounded-xl border border-gray-200 px-4 py-3"
                            value={providerConfig.apiKey}
                            onChange={(e) => setBusinessGrowthForm({
                              ...businessGrowthForm,
                              [provider]: { ...providerConfig, apiKey: e.target.value },
                            })}
                            placeholder="Paste API key"
                          />
                        </label>
                        <label className="space-y-2">
                          <span className="text-xs font-black uppercase tracking-widest text-gray-400">Model</span>
                          <input
                            className="w-full rounded-xl border border-gray-200 px-4 py-3"
                            value={providerConfig.model}
                            onChange={(e) => setBusinessGrowthForm({
                              ...businessGrowthForm,
                              [provider]: { ...providerConfig, model: e.target.value },
                            })}
                            placeholder="e.g. gpt-4o-mini"
                          />
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5 space-y-4">
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Recommendation Cache Duration (hours)</span>
                  <input
                    type="number"
                    min={1}
                    max={72}
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                    value={businessGrowthForm.recommendationCacheHours}
                    onChange={(e) => setBusinessGrowthForm({ ...businessGrowthForm, recommendationCacheHours: Number(e.target.value) })}
                  />
                  <p className="text-sm text-gray-500">How long to cache AI-generated recommendations before regenerating. Default: 6 hours.</p>
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
