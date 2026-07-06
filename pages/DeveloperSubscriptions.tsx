import React, { useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '../constants';
import { Button, LoadingOverlay } from '../components';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useCapabilitySettings, useCentralLicenseTiers, useLocalUsageSummary, useServiceSubscriptionOverview } from '../src/hooks/useQueries';
import { useCreateOrUpdateCentralLicense, useResetCentralLicenseOverride, useSyncLicenseCapabilities, useUpdateCentralLicenseOverride } from '../src/hooks/useMutations';
import { CAPABILITY_KEYS, CAPABILITY_LABELS, normalizeCapabilities } from '../src/utils/capabilities';
import type { AppCapabilityKey, AppCapabilityMap, LicenseTier } from '../types';

const StatCard: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">{label}</p>
    <p className="mt-2 text-2xl font-black text-gray-900">{value}</p>
    {hint && <p className="mt-1 text-xs font-medium text-gray-500">{hint}</p>}
  </div>
);

const tierCapabilitiesToMap = (tier?: LicenseTier | null): AppCapabilityMap => {
  const defaults = normalizeCapabilities({});
  CAPABILITY_KEYS.forEach((key) => {
    defaults[key] = Boolean(tier?.capabilities?.includes(key));
  });
  return defaults;
};

const DeveloperSubscriptions: React.FC = () => {
  const toast = useToastNotifications();
  const { data: overview, isPending: loadingOverview } = useServiceSubscriptionOverview(true);
  const { data: usage, isPending: loadingUsage } = useLocalUsageSummary(true);
  const { data: capabilitySettings, isPending: loadingCapabilities } = useCapabilitySettings(true);

  const [licenseApiUrl, setLicenseApiUrl] = useState('');
  const [ownerToken, setOwnerToken] = useState('');
  const [clientName, setClientName] = useState('');
  const [renewalDate, setRenewalDate] = useState('');
  const [selectedTierKey, setSelectedTierKey] = useState('');
  const [overrideCapabilities, setOverrideCapabilities] = useState<AppCapabilityMap>(() => normalizeCapabilities(null));

  const tiersQuery = useCentralLicenseTiers({ licenseApiUrl, licenseOwnerToken: ownerToken }, false);
  const syncMutation = useSyncLicenseCapabilities();
  const saveLicenseMutation = useCreateOrUpdateCentralLicense();
  const overrideMutation = useUpdateCentralLicenseOverride();
  const resetOverrideMutation = useResetCentralLicenseOverride();

  const availableTiers = useMemo(() => {
    const remoteTiers = tiersQuery.data?.tiers || [];
    return remoteTiers.length > 0 ? remoteTiers : capabilitySettings?.availableTiers || [];
  }, [capabilitySettings?.availableTiers, tiersQuery.data?.tiers]);

  const selectedTier = availableTiers.find((tier) => tier.tierKey === selectedTierKey) || availableTiers[0] || null;
  const activeCapabilities = useMemo(() => normalizeCapabilities(capabilitySettings?.capabilities), [capabilitySettings?.capabilities]);
  const tierDefaultCapabilities = useMemo(() => tierCapabilitiesToMap(selectedTier), [selectedTier]);
  const payments = overview?.payments || [];

  useEffect(() => {
    if (!capabilitySettings) return;
    setLicenseApiUrl(capabilitySettings.licenseApiUrl || '');
    setOwnerToken(capabilitySettings.licenseOwnerToken || '');
    setSelectedTierKey(capabilitySettings.tierKey || capabilitySettings.availableTiers?.[0]?.tierKey || '');
    setOverrideCapabilities(normalizeCapabilities(capabilitySettings.capabilities));
    if (capabilitySettings.renewalDate) {
      setRenewalDate(capabilitySettings.renewalDate.slice(0, 10));
    }
  }, [capabilitySettings]);

  useEffect(() => {
    if (!selectedTierKey && availableTiers[0]?.tierKey) {
      setSelectedTierKey(availableTiers[0].tierKey);
    }
  }, [availableTiers, selectedTierKey]);

  const loadTiers = async () => {
    const toastId = toast.loading('Loading central tiers...');
    try {
      const result = await tiersQuery.refetch();
      if (result.error) {
        throw result.error;
      }
      toast.update(toastId, 'Central tiers loaded.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Failed to load tiers.', 'error');
    }
  };

  const saveLicense = async () => {
    if (!selectedTierKey) {
      toast.error('Please select a tier first.');
      return;
    }
    const toastId = toast.loading(capabilitySettings?.licenseKey ? 'Updating license tier...' : 'Creating license...');
    try {
      await saveLicenseMutation.mutateAsync({
        licenseApiUrl,
        licenseOwnerToken: ownerToken,
        licenseKey: capabilitySettings?.licenseKey || undefined,
        tierKey: selectedTierKey,
        clientName: clientName || window.location.hostname,
        domain: window.location.hostname,
        renewalDate: renewalDate || null,
      });
      toast.update(toastId, 'License saved and synced.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Failed to save license.', 'error');
    }
  };

  const syncNow = async () => {
    const toastId = toast.loading('Syncing license...');
    try {
      await syncMutation.mutateAsync({ licenseKey: capabilitySettings?.licenseKey, licenseApiUrl });
      toast.update(toastId, 'License synced.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'License sync failed.', 'error');
    }
  };

  const saveOverride = async () => {
    const toastId = toast.loading('Saving central override...');
    try {
      await overrideMutation.mutateAsync({
        licenseApiUrl,
        licenseOwnerToken: ownerToken,
        licenseKey: capabilitySettings?.licenseKey,
        capabilities: overrideCapabilities,
      });
      toast.update(toastId, 'Override saved and synced.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Failed to save override.', 'error');
    }
  };

  const resetOverride = async () => {
    const toastId = toast.loading('Resetting override...');
    try {
      await resetOverrideMutation.mutateAsync({ licenseApiUrl, licenseOwnerToken: ownerToken, licenseKey: capabilitySettings?.licenseKey });
      toast.update(toastId, 'Reset to tier defaults.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Failed to reset override.', 'error');
    }
  };

  const busy = loadingOverview || loadingUsage || loadingCapabilities || tiersQuery.isFetching || syncMutation.isPending || saveLicenseMutation.isPending || overrideMutation.isPending || resetOverrideMutation.isPending;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <LoadingOverlay isLoading={busy} message="Loading developer subscription summary..." />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Current State" value={(overview?.state || 'Unknown').replace(/_/g, ' ')} hint={overview?.subscriptionStatus || undefined} />
        <StatCard label="Valid Till" value={overview?.dueAt ? new Date(overview.dueAt).toLocaleDateString('en-BD') : 'Not set'} />
        <StatCard label="Monthly Price" value={formatCurrency(capabilitySettings?.pricingMetadata?.monthly || overview?.totalAmount || 0)} hint={capabilitySettings?.planName || overview?.planName || 'No tier'} />
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-black text-gray-900">License Setup</h2>
            <p className="mt-1 text-sm text-gray-500">Connect this deployment to the central license server and assign its tier.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={loadTiers} disabled={!licenseApiUrl}>Load Tiers</Button>
            <Button variant="secondary" onClick={syncNow} disabled={!capabilitySettings?.licenseKey || !licenseApiUrl}>Sync Now</Button>
            <Button variant="primary" onClick={saveLicense} disabled={!licenseApiUrl || !ownerToken || !selectedTierKey}>
              {capabilitySettings?.licenseKey ? 'Update Tier' : 'Create License'}
            </Button>
          </div>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs font-black uppercase tracking-widest text-gray-400">Central API URL</span>
            <input className="w-full rounded-xl border border-gray-200 px-4 py-3" value={licenseApiUrl} onChange={(e) => setLicenseApiUrl(e.target.value)} placeholder="https://license.your-domain.com/api.php" />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-black uppercase tracking-widest text-gray-400">Owner Token</span>
            <input type="password" className="w-full rounded-xl border border-gray-200 px-4 py-3" value={ownerToken} onChange={(e) => setOwnerToken(e.target.value)} placeholder="Central owner token" />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-black uppercase tracking-widest text-gray-400">Client Name</span>
            <input className="w-full rounded-xl border border-gray-200 px-4 py-3" value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder={window.location.hostname} />
          </label>
          <label className="space-y-2">
            <span className="text-xs font-black uppercase tracking-widest text-gray-400">Renewal Date</span>
            <input type="date" className="w-full rounded-xl border border-gray-200 px-4 py-3" value={renewalDate} onChange={(e) => setRenewalDate(e.target.value)} />
          </label>
        </div>

        <div className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-5 text-sm text-gray-600">
          <p><span className="font-black text-gray-900">License:</span> {capabilitySettings?.licenseKey || 'Not created yet'}</p>
          <p><span className="font-black text-gray-900">Current tier:</span> {capabilitySettings?.planName || 'Not assigned'}</p>
          <p><span className="font-black text-gray-900">Status:</span> {capabilitySettings?.licenseStatus || 'local'}</p>
          <p><span className="font-black text-gray-900">Override:</span> {capabilitySettings?.overrideEnabled ? 'Enabled' : 'Using tier defaults'}</p>
          <p><span className="font-black text-gray-900">Last sync:</span> {capabilitySettings?.lastSyncedAt ? new Date(capabilitySettings.lastSyncedAt).toLocaleString() : 'Never'}</p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {availableTiers.map((tier) => (
            <button
              key={tier.tierKey}
              onClick={() => setSelectedTierKey(tier.tierKey)}
              className={`rounded-2xl border p-5 text-left transition-all ${selectedTierKey === tier.tierKey ? 'border-[#0f2f57] bg-[#f8fbff]' : 'border-gray-100 bg-gray-50 hover:bg-white'}`}
            >
              <p className="font-black text-gray-900">{tier.tierName}</p>
              <p className="mt-2 text-sm font-bold text-gray-500">{formatCurrency(tier.monthlyPrice)} monthly</p>
              <p className="text-sm font-bold text-gray-500">{formatCurrency(tier.yearlyPrice)} yearly</p>
              <p className="mt-3 text-xs font-medium text-gray-400">{tier.capabilities.length} capabilities</p>
            </button>
          ))}
          {availableTiers.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-400 md:col-span-3">
              Enter the central API URL and owner token, then click Load Tiers.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-gray-900">Capability Override</h2>
            <p className="mt-1 text-sm text-gray-500">Save only when this client needs custom access outside the selected tier.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={resetOverride} disabled={!capabilitySettings?.licenseKey}>Reset</Button>
            <Button variant="primary" onClick={saveOverride} disabled={!capabilitySettings?.licenseKey}>Save Override</Button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {CAPABILITY_KEYS.map((key: AppCapabilityKey) => {
            const checked = Boolean(overrideCapabilities[key]);
            const tierDefault = Boolean(tierDefaultCapabilities[key]);
            const active = Boolean(activeCapabilities[key]);
            return (
              <label key={key} className={`rounded-2xl border p-4 ${checked ? 'border-[#0f2f57] bg-[#f8fbff]' : 'border-gray-100 bg-gray-50'}`}>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => setOverrideCapabilities((current) => ({ ...current, [key]: event.target.checked }))}
                    className="mt-1 h-5 w-5 accent-[#0f2f57]"
                  />
                  <div>
                    <p className="font-black text-gray-900">{CAPABILITY_LABELS[key]}</p>
                    <p className="mt-1 text-[11px] font-bold text-gray-400">
                      Tier: {tierDefault ? 'On' : 'Off'} · Active: {active ? 'On' : 'Off'}
                    </p>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black text-gray-900">Local Usage Summary</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Active Users" value={String(usage?.activeUsers || 0)} />
          <StatCard label="Transactions" value={String(usage?.totalTransactions || 0)} />
          <StatCard label="Orders" value={String(usage?.totalOrders || 0)} />
          <StatCard label="Bills" value={String(usage?.totalBills || 0)} />
          <StatCard label="Customers" value={String(usage?.totalCustomers || 0)} />
          <StatCard label="Products" value={String(usage?.totalProducts || 0)} />
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-black text-gray-900">Recent Payments</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {payments.slice(0, 6).map((payment) => (
            <div key={payment.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-black text-gray-900">{payment.gatewayPaymentId || payment.transactionId}</p>
                  <p className="text-xs font-medium text-gray-500">{new Date(payment.submittedAt).toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="font-black text-[#0f2f57]">{formatCurrency(payment.amount)}</p>
                  <p className="text-xs capitalize text-gray-500">{payment.status}</p>
                </div>
              </div>
            </div>
          ))}
          {payments.length === 0 && <p className="col-span-full rounded-2xl bg-gray-50 p-6 text-center text-sm text-gray-400">No payments yet.</p>}
        </div>
      </section>
    </div>
  );
};

export default DeveloperSubscriptions;
