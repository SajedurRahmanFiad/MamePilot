import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, LoadingOverlay } from '../components';
import { useAuth } from '../src/contexts/AuthProvider';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useCapabilitySettings, useCourierSettings, useDeployments, useMaintenanceStatus, usePaymentGatewaySettings, useAgentSettings, useBusinessGrowthSettings, useEmailSettings, useVoiceSurveyIntegrationSettings } from '../src/hooks/useQueries';
import { useSetMaintenanceStatus, useSyncLicenseCapabilities, useUpdateCourierSettings, useUpdatePaymentGatewaySettings, useUpdateAgentSettings, useUpdateBusinessGrowthSettings, useUpdateEmailSettings, useUpdateVoiceSurveyIntegrationSettings } from '../src/hooks/useMutations';
import { hasAdminAccess, type DeploymentScope, type PaymentGatewaySettings, type AgentSettings, type BusinessGrowthSettings, type VoiceSurveyIntegrationSettings } from '../types';
import { theme } from '../theme';
import { compressImage, formatDateTime } from '../utils';
import { DEFAULT_MAINTENANCE_CONTENT } from '../src/config/maintenance';
import LlmSettingsPanel from '../components/LlmSettingsPanel';

type TabId = 'license' | 'payment-gateway' | 'fraud-checker' | 'maintenance' | 'llms' | 'agent' | 'business_growth' | 'email' | 'awajdigital';
type MaintenanceContentForm = {
  imageUrl: string;
  caption: string;
  subtitle: string;
  explanation: string;
  endsAt: string;
};

const toLocalDateTimeInput = (value?: string | null): string => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const toIsoDateTime = (value: string): string | null => {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

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
  showReasoningSummaries: true,
  showToolActivity: true,
  maxReasoningSteps: 5,
  maxToolCalls: 10,
  queryRowLimit: 1000,
  queryTimeoutMs: 30000,
};

const emptyBusinessGrowthSettings: BusinessGrowthSettings = {
  recommendationCacheHours: 6,
};

const emptyVoiceSurveyIntegration: VoiceSurveyIntegrationSettings = {
  apiToken: '',
  sender: '',
  templateName: '',
  webhookSecret: '',
  webhookUrl: '',
};

const DeveloperSettings: React.FC = () => {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToastNotifications();
  const { data: capabilitySettings, isPending: loadingCapabilities } = useCapabilitySettings(Boolean(user));
  const { data: courierSettings, isPending: loadingCourierSettings } = useCourierSettings();
  const { data: gatewaySettings, isPending: loadingGateway } = usePaymentGatewaySettings(user?.role === 'Developer');
  const { data: maintenanceStatus, isPending: loadingMaintenance } = useMaintenanceStatus(Boolean(user));
  const { data: deployments, isLoading: isLoadingDeployments, isError: isDeploymentsError, error: deploymentsError } = useDeployments(user?.role === 'Developer');
  const { data: agentSettings, isPending: loadingAgent } = useAgentSettings(user?.role === 'Developer');
  const { data: businessGrowthSettings, isPending: loadingBusinessGrowth } = useBusinessGrowthSettings(user?.role === 'Developer');
  const { data: emailSettingsData, isPending: loadingEmailSettings } = useEmailSettings(user?.role === 'Developer');
  const { data: voiceSurveyIntegrationData, isPending: loadingVoiceSurveyIntegration } = useVoiceSurveyIntegrationSettings(user?.role === 'Developer');
  const syncCapabilities = useSyncLicenseCapabilities();
  const updateCourierSettings = useUpdateCourierSettings();
  const updateGateway = useUpdatePaymentGatewaySettings();
  const setMaintenanceStatus = useSetMaintenanceStatus();
  const updateAgent = useUpdateAgentSettings();
  const updateBusinessGrowth = useUpdateBusinessGrowthSettings();
  const updateEmail = useUpdateEmailSettings();
  const updateVoiceSurveyIntegration = useUpdateVoiceSurveyIntegrationSettings();

  const [maintenanceModeEnabled, setMaintenanceModeEnabled] = useState(false);
  const [maintenanceDeploymentScope, setMaintenanceDeploymentScope] = useState<DeploymentScope>('all');
  const [maintenanceTargetDeployments, setMaintenanceTargetDeployments] = useState<string[]>([]);
  const [maintenanceDeploymentSearch, setMaintenanceDeploymentSearch] = useState('');
  const maintenanceFormDirty = useRef(false);
  const [maintenanceContent, setMaintenanceContent] = useState<MaintenanceContentForm>({ ...DEFAULT_MAINTENANCE_CONTENT, endsAt: '' });
  const [maintenanceImageName, setMaintenanceImageName] = useState<string | undefined>(undefined);
  const [isCompressingMaintenanceImage, setIsCompressingMaintenanceImage] = useState(false);
  const [agentForm, setAgentForm] = useState<AgentSettings>(emptyAgentSettings);
  const [businessGrowthForm, setBusinessGrowthForm] = useState<BusinessGrowthSettings>(emptyBusinessGrowthSettings);
  const [voiceSurveyIntegrationForm, setVoiceSurveyIntegrationForm] = useState<VoiceSurveyIntegrationSettings>(emptyVoiceSurveyIntegration);

  const urlTab = searchParams.get('tab');
  const tabIds: TabId[] = ['license', 'maintenance', 'payment-gateway', 'fraud-checker', 'llms', 'agent', 'business_growth', 'email', 'awajdigital'];
  const [activeTab, setActiveTab] = useState<TabId>(tabIds.includes(urlTab as TabId) ? (urlTab as TabId) : 'license');
  const [licenseForm, setLicenseForm] = useState({ licenseKey: '', licenseApiUrl: '', licenseOwnerToken: '' });
  const [gatewayForm, setGatewayForm] = useState<PaymentGatewaySettings>(emptyGateway);
  const [fraudSettings, setFraudSettings] = useState({ apiKey: '' });
  const [emailForm, setEmailForm] = useState({
    recipientEmail: '',
    smtpHost: '',
    smtpPort: 587,
    smtpUsername: '',
    smtpPassword: '',
    smtpEncryption: 'tls' as 'tls' | 'ssl' | 'none',
    senderEmail: '',
    senderName: '',
  });

  const filteredMaintenanceDeployments = useMemo(() => {
    if (!deployments) return [];
    const query = maintenanceDeploymentSearch.trim().toLowerCase();
    if (!query) return deployments;
    return deployments.filter((deployment) =>
      deployment.clientName.toLowerCase().includes(query)
      || deployment.licenseKey.toLowerCase().includes(query)
      || (deployment.domain || '').toLowerCase().includes(query)
    );
  }, [deployments, maintenanceDeploymentSearch]);

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
    if (!maintenanceFormDirty.current && maintenanceStatus?.maintenanceEnabled !== undefined) {
      setMaintenanceModeEnabled(maintenanceStatus.maintenanceModeEnabled ?? maintenanceStatus.maintenanceEnabled);
      setMaintenanceDeploymentScope(maintenanceStatus.deploymentScope || 'all');
      setMaintenanceTargetDeployments(maintenanceStatus.targetDeployments || []);
      setMaintenanceContent({
        imageUrl: maintenanceStatus.imageUrl || DEFAULT_MAINTENANCE_CONTENT.imageUrl,
        caption: maintenanceStatus.caption || DEFAULT_MAINTENANCE_CONTENT.caption,
        subtitle: maintenanceStatus.subtitle || DEFAULT_MAINTENANCE_CONTENT.subtitle,
        explanation: maintenanceStatus.explanation || DEFAULT_MAINTENANCE_CONTENT.explanation,
        endsAt: toLocalDateTimeInput(maintenanceStatus.endsAt),
      });
      setMaintenanceImageName(undefined);
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
    if (emailSettingsData) {
      setEmailForm(emailSettingsData);
    }
  }, [emailSettingsData]);

  useEffect(() => {
    if (voiceSurveyIntegrationData) {
      setVoiceSurveyIntegrationForm(voiceSurveyIntegrationData);
    }
  }, [voiceSurveyIntegrationData]);

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
    const toastId = toast.loading('Refreshing subscription access...');
    try {
      await syncCapabilities.mutateAsync(licenseForm);
      toast.update(toastId, 'Subscription access is up to date.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Could not refresh subscription access. Please try again.', 'error');
    }
  };

  const saveGateway = async () => {
    const toastId = toast.loading('Saving payment settings...');
    try {
      await updateGateway.mutateAsync(gatewayForm);
      toast.update(toastId, 'Payment settings saved.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Could not save payment settings. Please try again.', 'error');
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

  const toggleMaintenanceDeployment = (licenseKey: string) => {
    maintenanceFormDirty.current = true;
    setMaintenanceTargetDeployments((current) =>
      current.includes(licenseKey)
        ? current.filter((key) => key !== licenseKey)
        : [...current, licenseKey]
    );
  };

  const updateMaintenanceContent = (field: keyof typeof maintenanceContent, value: string) => {
    maintenanceFormDirty.current = true;
    setMaintenanceContent((current) => ({ ...current, [field]: value }));
  };

  const handleMaintenanceImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Select a valid image file.');
      return;
    }

    setIsCompressingMaintenanceImage(true);
    try {
      const compressed = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.82, force: true });
      maintenanceFormDirty.current = true;
      setMaintenanceImageName(file.name);
      setMaintenanceContent((current) => ({ ...current, imageUrl: compressed }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to process the image.');
    } finally {
      setIsCompressingMaintenanceImage(false);
    }
  };

  const resetMaintenanceContent = () => {
    maintenanceFormDirty.current = true;
    setMaintenanceImageName(undefined);
    setMaintenanceContent({ ...DEFAULT_MAINTENANCE_CONTENT, endsAt: '' });
  };

  const saveMaintenanceMode = async (nextEnabled: boolean, action: 'save' | 'toggle' = 'toggle') => {
    if (nextEnabled && maintenanceDeploymentScope !== 'all' && maintenanceTargetDeployments.length === 0) {
      toast.error('Select at least one deployment.');
      return;
    }

    maintenanceFormDirty.current = true;
    const toastId = toast.loading('Updating maintenance mode...');
    try {
      const result = await setMaintenanceStatus.mutateAsync({
        maintenanceEnabled: nextEnabled,
        deploymentScope: maintenanceDeploymentScope,
        targetDeployments: maintenanceDeploymentScope === 'all' ? [] : maintenanceTargetDeployments,
        imageUrl: maintenanceContent.imageUrl,
        imageName: maintenanceImageName,
        caption: maintenanceContent.caption,
        subtitle: maintenanceContent.subtitle,
        explanation: maintenanceContent.explanation,
        endsAt: toIsoDateTime(maintenanceContent.endsAt),
      });
      setMaintenanceModeEnabled(result.maintenanceModeEnabled ?? nextEnabled);
      setMaintenanceDeploymentScope(result.deploymentScope || 'all');
      setMaintenanceTargetDeployments(result.targetDeployments || []);
      setMaintenanceContent({
        imageUrl: result.imageUrl || DEFAULT_MAINTENANCE_CONTENT.imageUrl,
        caption: result.caption || DEFAULT_MAINTENANCE_CONTENT.caption,
        subtitle: result.subtitle || DEFAULT_MAINTENANCE_CONTENT.subtitle,
        explanation: result.explanation || DEFAULT_MAINTENANCE_CONTENT.explanation,
        endsAt: toLocalDateTimeInput(result.endsAt),
      });
      setMaintenanceImageName(undefined);
      maintenanceFormDirty.current = false;
      const savedEnabled = result.maintenanceModeEnabled ?? nextEnabled;
      const message = action === 'save'
        ? 'Maintenance settings saved.'
        : nextEnabled && !savedEnabled
          ? 'The selected end time has passed, so maintenance remains disabled.'
          : savedEnabled
            ? 'Maintenance settings saved and enabled.'
            : 'Maintenance mode disabled.';
      toast.update(toastId, message, 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Failed to update maintenance mode.', 'error');
    }
  };

  const saveAgentSettings = async () => {
    const toastId = toast.loading('Saving Mame AI settings...');
    try {
      await updateAgent.mutateAsync(agentForm);
      toast.update(toastId, 'Mame AI settings saved.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Failed to save Mame AI settings.', 'error');
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

  const saveEmailSettings = async () => {
    const toastId = toast.loading('Saving email settings...');
    try {
      await updateEmail.mutateAsync(emailForm);
      toast.update(toastId, 'Email settings saved.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Failed to save email settings.', 'error');
    }
  };

  const saveVoiceSurveyIntegration = async () => {
    const toastId = toast.loading('Saving voice survey connection...');
    try {
      const settings = await updateVoiceSurveyIntegration.mutateAsync(voiceSurveyIntegrationForm);
      setVoiceSurveyIntegrationForm(settings);
      toast.update(toastId, 'Voice survey connection saved.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Could not save the voice survey connection. Please try again.', 'error');
    }
  };

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'license', label: 'License Sync' },
    { id: 'maintenance', label: 'Maintenance Mode' },
    { id: 'payment-gateway', label: 'Payment Gateway' },
    { id: 'fraud-checker', label: 'Fraud Checker' },
    { id: 'llms', label: 'LLMs' },
    { id: 'agent', label: 'Mame AI' },
    { id: 'business_growth', label: 'Business Growth' },
    { id: 'email', label: 'Email Config' },
    { id: 'awajdigital', label: 'AwajDigital' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <LoadingOverlay
        isLoading={loadingCapabilities || loadingCourierSettings || loadingGateway || loadingMaintenance || loadingAgent || loadingBusinessGrowth || loadingEmailSettings || loadingVoiceSurveyIntegration || updateGateway.isPending || updateCourierSettings.isPending || syncCapabilities.isPending || updateAgent.isPending || updateBusinessGrowth.isPending || updateEmail.isPending || updateVoiceSurveyIntegration.isPending}
        message="Loading developer settings..."
      />

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div />
        {activeTab === 'license' && <Button onClick={syncNow} variant="primary">Sync Now</Button>}
        {activeTab === 'payment-gateway' && <Button onClick={saveGateway} variant="primary">Save Gateway</Button>}
        {activeTab === 'fraud-checker' && <Button onClick={saveFraudSettings} variant="primary">Save Fraud Checker</Button>}
        {activeTab === 'agent' && <Button onClick={saveAgentSettings} variant="primary">Save Mame AI Settings</Button>}
        {activeTab === 'business_growth' && <Button onClick={saveBusinessGrowthSettings} variant="primary">Save Business Growth Settings</Button>}
        {activeTab === 'email' && <Button onClick={saveEmailSettings} variant="primary">Save Email Settings</Button>}
        {activeTab === 'awajdigital' && <Button onClick={saveVoiceSurveyIntegration} variant="primary">Save AwajDigital</Button>}
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
                <p><span className="font-black text-gray-900">Last sync:</span> {capabilitySettings?.lastSyncedAt ? formatDateTime(capabilitySettings.lastSyncedAt) : 'Never'}</p>
                {capabilitySettings?.lastSyncMessage && <p className="mt-1">{capabilitySettings.lastSyncMessage}</p>}
              </div>
            </section>
          )}

          {activeTab === 'maintenance' && (
            <section className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm space-y-6">
              <div>
                <h3 className="text-xl font-black text-gray-900">Maintenance Mode</h3>
                <p className="mt-1 text-sm text-gray-500">When enabled, non-developer users in the selected deployments are redirected to the maintenance page and cannot log in.</p>
              </div>

              <div className={`rounded-xl border px-4 py-3 text-sm font-bold ${maintenanceModeEnabled ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}`}>
                {maintenanceModeEnabled ? 'Maintenance mode is currently enabled.' : 'Maintenance mode is currently disabled.'}
              </div>

              <div className="rounded-[1.35rem] border border-gray-100 bg-gray-50/80 p-4 space-y-5">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Maintenance Message</label>
                  <p className="mt-1 text-sm text-gray-500">Customize what visitors see while the selected deployments are offline. Empty text fields use the defaults.</p>
                </div>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <div className="h-24 w-24 shrink-0 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                    <img
                      src={maintenanceContent.imageUrl || DEFAULT_MAINTENANCE_CONTENT.imageUrl}
                      alt="Maintenance thumbnail"
                      className="h-full w-full object-cover"
                      onError={(event) => { event.currentTarget.src = DEFAULT_MAINTENANCE_CONTENT.imageUrl; }}
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-black uppercase tracking-widest text-gray-400">Image</p>
                    <input id="maintenance-image-upload" type="file" accept="image/*" className="hidden" onChange={handleMaintenanceImageUpload} />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      loading={isCompressingMaintenanceImage}
                      onClick={() => document.getElementById('maintenance-image-upload')?.click()}
                    >
                      {maintenanceContent.imageUrl === DEFAULT_MAINTENANCE_CONTENT.imageUrl ? 'Upload Image' : 'Change Image'}
                    </Button>
                    <p className="text-xs text-gray-400">Compressed before upload. Stored in the public uploads folder, never in the database as base64.</p>
                  </div>
                </div>

                <label className="block space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Caption</span>
                  <input
                    type="text"
                    value={maintenanceContent.caption}
                    onChange={(event) => updateMaintenanceContent('caption', event.target.value)}
                    placeholder={DEFAULT_MAINTENANCE_CONTENT.caption}
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Subtitle</span>
                  <textarea
                    rows={2}
                    value={maintenanceContent.subtitle}
                    onChange={(event) => updateMaintenanceContent('subtitle', event.target.value)}
                    placeholder={DEFAULT_MAINTENANCE_CONTENT.subtitle}
                    className="w-full resize-y rounded-xl border border-gray-200 bg-white px-4 py-3"
                  />
                </label>

                <label className="block space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Explanation</span>
                  <textarea
                    rows={4}
                    value={maintenanceContent.explanation}
                    onChange={(event) => updateMaintenanceContent('explanation', event.target.value)}
                    placeholder={DEFAULT_MAINTENANCE_CONTENT.explanation}
                    className="w-full resize-y rounded-xl border border-gray-200 bg-white px-4 py-3"
                  />
                </label>

                <label className="block max-w-md space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Maintenance Ends At</span>
                  <input
                    type="datetime-local"
                    value={maintenanceContent.endsAt}
                    onChange={(event) => updateMaintenanceContent('endsAt', event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3"
                  />
                  <p className="text-xs text-gray-400">The visitor sees a countdown in their own local time. Leave this empty for no automatic expiry.</p>
                </label>

                <Button type="button" variant="outline" size="sm" onClick={resetMaintenanceContent}>
                  Reset Message Defaults
                </Button>
              </div>

              <div className="rounded-[1.35rem] border border-gray-100 bg-gray-50/80 p-4 space-y-3">
                <label className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Target Deployments</label>
                <p className="text-sm text-gray-500">Choose which deployments enter maintenance mode.</p>
                <div className="flex flex-wrap gap-2">
                  {(['all', 'include', 'exclude'] as DeploymentScope[]).map((scope) => {
                    const selected = maintenanceDeploymentScope === scope;
                    const label = scope === 'all' ? 'All deployments' : scope === 'include' ? 'Specific deployments' : 'All except specific';
                    return (
                      <button
                        key={scope}
                        type="button"
                        onClick={() => {
                          maintenanceFormDirty.current = true;
                          setMaintenanceDeploymentScope(scope);
                          if (scope === 'all') setMaintenanceTargetDeployments([]);
                        }}
                        className={`rounded-full px-4 py-2 text-xs font-black uppercase tracking-[0.18em] transition-all ${
                          selected
                            ? 'bg-[var(--primary-color,#0f2f57)] text-white'
                            : 'border border-gray-200 bg-white text-gray-500 hover:border-[var(--primary-medium,#3c5a82)] hover:bg-[var(--primary-soft,#ebf4ff)] hover:text-[var(--primary-color,#0f2f57)]'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {maintenanceDeploymentScope !== 'all' && (
                  <div className="space-y-3 pt-1">
                    <input
                      type="text"
                      value={maintenanceDeploymentSearch}
                      onChange={(event) => setMaintenanceDeploymentSearch(event.target.value)}
                      placeholder="Search deployments..."
                      className="w-full rounded-xl border border-gray-100 bg-white px-4 py-2.5 text-sm font-medium outline-none transition-all focus:ring-2 focus:ring-[#3c5a82]"
                    />
                    {isLoadingDeployments ? (
                      <p className="py-3 text-center text-sm font-medium text-gray-400">Loading deployments...</p>
                    ) : isDeploymentsError ? (
                      <p className="py-3 text-center text-sm font-medium text-red-500">{deploymentsError?.message || 'Failed to load deployments. Check central server configuration.'}</p>
                    ) : filteredMaintenanceDeployments.length === 0 ? (
                      <p className="py-3 text-center text-sm font-medium text-gray-400">No deployments found.</p>
                    ) : (
                      <div className="max-h-60 space-y-2 overflow-y-auto pr-1">
                        {filteredMaintenanceDeployments.map((deployment) => {
                          const selected = maintenanceTargetDeployments.includes(deployment.licenseKey);
                          return (
                            <button
                              key={deployment.licenseKey}
                              type="button"
                              onClick={() => toggleMaintenanceDeployment(deployment.licenseKey)}
                              className={`w-full rounded-xl px-4 py-3 text-left transition-all ${
                                selected
                                  ? 'border-2 border-[var(--primary-color,#0f2f57)] bg-[var(--primary-soft,#ebf4ff)]'
                                  : 'border border-gray-200 bg-white hover:border-[var(--primary-medium,#3c5a82)] hover:bg-[var(--primary-soft,#ebf4ff)]'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-bold text-gray-900">{deployment.clientName}</p>
                                  <p className="mt-0.5 truncate text-[10px] font-medium tracking-wide text-gray-400">{deployment.domain || deployment.licenseKey}</p>
                                </div>
                                <span className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border-2 ${selected ? 'border-[var(--primary-color,#0f2f57)] bg-[var(--primary-color,#0f2f57)]' : 'border-gray-300 bg-white'}`}>
                                  {selected && (
                                    <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => saveMaintenanceMode(maintenanceModeEnabled, 'save')} variant="primary" loading={setMaintenanceStatus.isPending} disabled={isCompressingMaintenanceImage || setMaintenanceStatus.isPending}>
                  Save Maintenance Settings
                </Button>
                {maintenanceModeEnabled ? (
                  <Button onClick={() => saveMaintenanceMode(false)} variant="danger" disabled={isCompressingMaintenanceImage || setMaintenanceStatus.isPending}>
                    Disable Maintenance
                  </Button>
                ) : (
                  <Button onClick={() => saveMaintenanceMode(true)} variant="secondary" disabled={isCompressingMaintenanceImage || setMaintenanceStatus.isPending}>
                    Enable Maintenance
                  </Button>
                )}
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

          {activeTab === 'llms' && <LlmSettingsPanel />}

          {activeTab === 'agent' && (
            <section className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm space-y-6">
              <div>
                <h3 className="text-xl font-black text-gray-900">Mame AI Settings</h3>
                <p className="mt-1 text-sm text-gray-500">Control the Mame AI runtime and its safe read-only data tools. Select its provider and model in the LLMs tab.</p>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <label className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4 md:col-span-2">
                  <input
                    type="checkbox"
                    checked={agentForm.enabled}
                    onChange={(e) => setAgentForm({ ...agentForm, enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <div>
                    <p className="text-sm font-black text-gray-900">Enable Mame AI</p>
                    <p className="text-sm text-gray-500">Turn Mame AI on or off for this installation.</p>
                  </div>
                </label>
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
                <p className="mt-1 text-sm text-gray-500">Control how long recommendations are cached. Select the provider and model for Grow Your Business in the LLMs tab.</p>
              </div>

              <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4 text-sm font-semibold text-blue-800">
                Credentials are managed once in Developer Settings &gt; LLMs, where Grow Your Business has its own model assignment.
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

          {activeTab === 'awajdigital' && (
            <section className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm space-y-7">
              <div>
                <h3 className="text-xl font-black text-gray-900">AwajDigital API & Webhook</h3>
                <p className="mt-1 text-sm text-gray-500">Developer-only credentials used to create survey calls and authenticate incoming result webhooks.</p>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">API Token (Bearer)</span>
                  <input
                    type="password"
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                    value={voiceSurveyIntegrationForm.apiToken}
                    onChange={(event) => setVoiceSurveyIntegrationForm({ ...voiceSurveyIntegrationForm, apiToken: event.target.value })}
                    placeholder="Enter the AwajDigital API token"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Sender / Caller ID</span>
                  <input
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                    value={voiceSurveyIntegrationForm.sender}
                    onChange={(event) => setVoiceSurveyIntegrationForm({ ...voiceSurveyIntegrationForm, sender: event.target.value })}
                    placeholder="01XXXXXXXXX"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-gray-400">Template Name</span>
                  <input
                    className="w-full rounded-xl border border-gray-200 px-4 py-3"
                    value={voiceSurveyIntegrationForm.templateName}
                    onChange={(event) => setVoiceSurveyIntegrationForm({ ...voiceSurveyIntegrationForm, templateName: event.target.value })}
                    placeholder="Published survey template name"
                  />
                </label>
              </div>

              <div className="space-y-4 rounded-2xl border border-blue-100 bg-blue-50 p-5">
                <div>
                  <h4 className="font-black text-blue-950">Webhook Configuration</h4>
                  <p className="mt-1 text-sm text-blue-700">AwajDigital posts completed survey results to this endpoint. No result polling is required.</p>
                </div>
                <label className="block space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-blue-700">Webhook Secret</span>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="password"
                      className="min-w-0 flex-1 rounded-xl border border-blue-200 bg-white px-4 py-3"
                      value={voiceSurveyIntegrationForm.webhookSecret}
                      onChange={(event) => setVoiceSurveyIntegrationForm({ ...voiceSurveyIntegrationForm, webhookSecret: event.target.value, webhookUrl: '' })}
                      placeholder="Shared secret for webhook authentication"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        const webhookSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
                          .map((byte) => byte.toString(16).padStart(2, '0'))
                          .join('');
                        setVoiceSurveyIntegrationForm({ ...voiceSurveyIntegrationForm, webhookSecret, webhookUrl: '' });
                      }}
                    >
                      Generate
                    </Button>
                  </div>
                </label>
                <div className="space-y-2">
                  <span className="text-xs font-black uppercase tracking-widest text-blue-700">Public Webhook URL</span>
                  <input
                    type="url"
                    className="w-full rounded-xl border border-blue-200 bg-white px-4 py-3 text-sm text-blue-950"
                    value={voiceSurveyIntegrationForm.webhookUrl}
                    onChange={(event) => setVoiceSurveyIntegrationForm({ ...voiceSurveyIntegrationForm, webhookUrl: event.target.value })}
                    placeholder={`${window.location.origin}/api/webhook-survey.php?token=${voiceSurveyIntegrationForm.webhookSecret || '{webhook-secret}'}`}
                  />
                  <p className="text-xs text-blue-700">This exact URL is sent as <code>webhook_url</code> in every create-survey request. It is not configured in the AwajDigital dashboard.</p>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'email' && (
            <div className="space-y-8 animate-in fade-in duration-300">
              {/* Recipient */}
              <section className="space-y-4">
                <h3 className="text-xl font-black text-gray-900">Recipient</h3>
                <p className="text-sm text-gray-500">Email address that will receive notification emails (subscription renewals, recharge confirmations, etc.).</p>
                <label className="block space-y-2">
                  <span className="text-sm font-semibold text-gray-700">Recipient Email</span>
                  <input
                    type="email"
                    value={emailForm.recipientEmail}
                    onChange={(e) => setEmailForm({ ...emailForm, recipientEmail: e.target.value })}
                    placeholder="admin@example.com"
                    className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-900 outline-none focus:border-[#0f2f57]"
                  />
                </label>
              </section>

              {/* SMTP Settings */}
              <section className="space-y-4">
                <h3 className="text-xl font-black text-gray-900">SMTP / Sender Settings</h3>
                <p className="text-sm text-gray-500">Configure the authenticated SMTP server used to send payment confirmation emails.</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="text-sm font-semibold text-gray-700">SMTP Host</span>
                    <input
                      type="text"
                      value={emailForm.smtpHost}
                      onChange={(e) => setEmailForm({ ...emailForm, smtpHost: e.target.value })}
                      placeholder="smtp.gmail.com"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-900 outline-none focus:border-[#0f2f57]"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-semibold text-gray-700">SMTP Port</span>
                    <input
                      type="number"
                      value={emailForm.smtpPort}
                      onChange={(e) => setEmailForm({ ...emailForm, smtpPort: Number(e.target.value) })}
                      placeholder="587"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-900 outline-none focus:border-[#0f2f57]"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-semibold text-gray-700">SMTP Username</span>
                    <input
                      type="text"
                      value={emailForm.smtpUsername}
                      onChange={(e) => setEmailForm({ ...emailForm, smtpUsername: e.target.value })}
                      placeholder="your-email@gmail.com"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-900 outline-none focus:border-[#0f2f57]"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-semibold text-gray-700">SMTP Password / App Password</span>
                    <input
                      type="password"
                      value={emailForm.smtpPassword}
                      onChange={(e) => setEmailForm({ ...emailForm, smtpPassword: e.target.value })}
                      placeholder="16-character app password"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-900 outline-none focus:border-[#0f2f57]"
                    />
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-semibold text-gray-700">Encryption</span>
                    <select
                      value={emailForm.smtpEncryption}
                      onChange={(e) => setEmailForm({ ...emailForm, smtpEncryption: e.target.value as 'tls' | 'ssl' | 'none' })}
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-900 outline-none focus:border-[#0f2f57]"
                    >
                      <option value="tls">TLS (Port 587)</option>
                      <option value="ssl">SSL (Port 465)</option>
                      <option value="none">None</option>
                    </select>
                  </label>
                </div>
              </section>

              {/* Sender Info */}
              <section className="space-y-4">
                <h3 className="text-xl font-black text-gray-900">Sender Information</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="text-sm font-semibold text-gray-700">Sender Email</span>
                    <input
                      type="email"
                      value={emailForm.senderEmail}
                      onChange={(e) => setEmailForm({ ...emailForm, senderEmail: e.target.value })}
                      placeholder="noreply@yourdomain.com"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-900 outline-none focus:border-[#0f2f57]"
                    />
                    <span className="text-xs text-gray-400">Must match your authenticated SMTP email for Gmail.</span>
                  </label>
                  <label className="block space-y-2">
                    <span className="text-sm font-semibold text-gray-700">Sender Name</span>
                    <input
                      type="text"
                      value={emailForm.senderName}
                      onChange={(e) => setEmailForm({ ...emailForm, senderName: e.target.value })}
                      placeholder="MamePilot"
                      className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-medium text-gray-900 outline-none focus:border-[#0f2f57]"
                    />
                  </label>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeveloperSettings;
