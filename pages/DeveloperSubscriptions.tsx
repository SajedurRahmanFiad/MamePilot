import React, { useEffect, useMemo, useState } from 'react';
import { formatCurrency, ICONS } from '../constants';
import { Button, LoadingOverlay } from '../components';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useCapabilitySettings, useCentralLicenseTiers, useLocalUsageSummary, useServiceSubscriptionOverview } from '../src/hooks/useQueries';
import { useCreateOrUpdateCentralLicense, useRegisterWebhookWithCentral, useResetCentralLicenseOverride, useSyncLicenseCapabilities, useUpdateCentralLicenseOverride } from '../src/hooks/useMutations';
import {
  CAPABILITY_KEYS,
  CAPABILITY_LABELS,
  normalizeCapabilities,
  getSubCapabilities,
  SUB_CAPABILITY_LABELS,
  normalizeSubCapabilities,
} from '../src/utils/capabilities';
import type { AppCapabilityKey, AppCapabilityMap, LicenseTier, SubCapabilityKey, SubCapabilityMap } from '../types';
import { formatDate, formatDateTime } from '../utils';

const StatCard: React.FC<{ label: string; value: string; hint?: string; valueColor?: string }> = ({ label, value, hint, valueColor }) => (
  <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">{label}</p>
    <p className={`mt-2 text-2xl font-black ${valueColor || 'text-gray-900'}`}>{value}</p>
    {hint && <p className="mt-1 text-xs font-medium text-gray-500">{hint}</p>}
  </div>
);

const formatState = (state: string): { label: string; color: string } => {
  const normalized = state.replace(/_/g, ' ').toLowerCase();
  const capitalized = normalized.replace(/\b\w/g, (c) => c.toUpperCase());
  const activeStates = ['active', 'trialing', 'paid', 'current'];
  const color = activeStates.some((s) => normalized.includes(s)) ? 'text-emerald-600' : 'text-red-600';
  return { label: capitalized, color };
};

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
  const [overrideSubCapabilities, setOverrideSubCapabilities] = useState<SubCapabilityMap>({});
  const [expandedCapabilities, setExpandedCapabilities] = useState<Record<string, boolean>>({});
  const [monthlyPriceOverride, setMonthlyPriceOverride] = useState('');
  const [yearlyPriceOverride, setYearlyPriceOverride] = useState('');

  const tiersQuery = useCentralLicenseTiers({ licenseApiUrl, licenseOwnerToken: ownerToken }, false);
  const syncMutation = useSyncLicenseCapabilities();
  const registerWebhookMutation = useRegisterWebhookWithCentral();
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
    const caps = normalizeCapabilities(capabilitySettings.capabilities);
    setOverrideCapabilities(caps);
    // Extract sub-capabilities from the capabilities response if present
    const rawSubs = (capabilitySettings.capabilities as any)?.subCapabilities;
    setOverrideSubCapabilities(normalizeSubCapabilities(rawSubs || {}, caps));
    setMonthlyPriceOverride(typeof capabilitySettings.pricingMetadata?.monthly === 'number' ? String(capabilitySettings.pricingMetadata.monthly) : '');
    setYearlyPriceOverride(typeof capabilitySettings.pricingMetadata?.yearly === 'number' ? String(capabilitySettings.pricingMetadata.yearly) : '');
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
    const toastId = toast.loading('Loading subscription plans...');
    try {
      const result = await tiersQuery.refetch();
      if (result.error) {
        throw result.error;
      }
      toast.update(toastId, 'Subscription plans loaded.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Could not load subscription plans. Please try again.', 'error');
    }
  };

  const saveLicense = async () => {
    if (!selectedTierKey) {
      toast.error('Please select a subscription plan first.');
      return;
    }
    const toastId = toast.loading(capabilitySettings?.licenseKey ? 'Updating subscription access...' : 'Creating subscription access...');
    try {
      await saveLicenseMutation.mutateAsync({
        licenseApiUrl,
        licenseOwnerToken: ownerToken,
        licenseKey: capabilitySettings?.licenseKey || undefined,
        tierKey: selectedTierKey,
        clientName: clientName || window.location.hostname,
        domain: window.location.hostname,
        renewalDate: renewalDate || null,
        pricingMetadata: {
          monthly: Number(monthlyPriceOverride || 0),
          yearly: Number(yearlyPriceOverride || 0),
        },
      });
      toast.update(toastId, 'Subscription access saved.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Could not save subscription access. Please try again.', 'error');
    }
  };

  const syncNow = async () => {
    const toastId = toast.loading('Refreshing subscription access...');
    try {
      await syncMutation.mutateAsync({ licenseKey: capabilitySettings?.licenseKey, licenseApiUrl });
      toast.update(toastId, 'Subscription access is up to date.', 'success');
      try {
        const webhookResult = await registerWebhookMutation.mutateAsync({});
        if (webhookResult.success) {
          toast.success('Automatic subscription updates are ready.');
        }
      } catch {
        // Webhook registration is best-effort; license sync already succeeded
      }
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Could not refresh subscription access. Please try again.', 'error');
    }
  };

  const saveOverride = async () => {
    const toastId = toast.loading('Saving custom subscription access...');
    try {
      // Merge sub-capabilities into the capabilities object for storage
      const capabilitiesWithSubs = { ...overrideCapabilities, subCapabilities: overrideSubCapabilities };
      await overrideMutation.mutateAsync({
        licenseApiUrl,
        licenseOwnerToken: ownerToken,
        licenseKey: capabilitySettings?.licenseKey,
        capabilities: capabilitiesWithSubs,
        pricingMetadata: {
          monthly: Number(monthlyPriceOverride || 0),
          yearly: Number(yearlyPriceOverride || 0),
        },
      });
      toast.update(toastId, 'Custom subscription access saved.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Could not save custom subscription access. Please try again.', 'error');
    }
  };

  const resetOverride = async () => {
    const toastId = toast.loading('Restoring subscription plan defaults...');
    try {
      await resetOverrideMutation.mutateAsync({ licenseApiUrl, licenseOwnerToken: ownerToken, licenseKey: capabilitySettings?.licenseKey });
      setOverrideSubCapabilities({});
      setMonthlyPriceOverride('');
      setYearlyPriceOverride('');
      toast.update(toastId, 'Subscription plan defaults restored.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Could not restore the plan defaults. Please try again.', 'error');
    }
  };

  const busy = loadingOverview || loadingUsage || loadingCapabilities || tiersQuery.isFetching || syncMutation.isPending || saveLicenseMutation.isPending || overrideMutation.isPending || resetOverrideMutation.isPending;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <LoadingOverlay isLoading={busy} message="Loading developer subscription summary..." />

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Current State" value={formatState(overview?.state || 'Unknown').label} valueColor={formatState(overview?.state || 'Unknown').color} hint={overview?.subscriptionStatus && overview.subscriptionStatus !== overview?.state ? overview.subscriptionStatus : undefined} />
        <StatCard label="Valid Till" value={overview?.dueAt ? formatDate(overview.dueAt) : 'Not set'} />
        <StatCard label="Monthly Price" value={formatCurrency(capabilitySettings?.pricingMetadata?.monthly ?? overview?.totalAmount ?? 0)} hint={capabilitySettings?.planName || overview?.planName || 'No tier'} />
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
            <Button
              variant="secondary"
              onClick={async () => {
                const toastId = toast.loading('Turning on automatic updates...');
                try {
                  await registerWebhookMutation.mutateAsync({});
                  toast.update(toastId, 'Automatic subscription updates are ready.', 'success');
                } catch (error) {
                  toast.update(toastId, error instanceof Error ? error.message : 'Could not turn on automatic updates. Please try again.', 'error');
                }
              }}
              disabled={!capabilitySettings?.licenseKey || !licenseApiUrl || registerWebhookMutation.isPending}
            >
              Register Webhook
            </Button>
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
          <p><span className="font-black text-gray-900">Last sync:</span> {capabilitySettings?.lastSyncedAt ? formatDateTime(capabilitySettings.lastSyncedAt) : 'Never'}</p>
        </div>

        <div className="mt-6 rounded-2xl border border-gray-100 bg-gray-50 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-black text-gray-900">Per-deployment Price Override</h3>
              <p className="mt-1 text-sm text-gray-500">Set a monthly or yearly override for this deployment. Leave them empty to keep the tier price.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-xs font-black uppercase tracking-widest text-gray-400">Monthly Price Override</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3" value={monthlyPriceOverride} onChange={(event) => setMonthlyPriceOverride(event.target.value)} placeholder="0" />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-black uppercase tracking-widest text-gray-400">Yearly Price Override</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3" value={yearlyPriceOverride} onChange={(event) => setYearlyPriceOverride(event.target.value)} placeholder="0" />
            </label>
          </div>
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
            <p className="mt-1 text-sm text-gray-500">Save only when this client needs custom access outside the selected tier. Expand grouped capabilities to toggle individual features.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={resetOverride} disabled={!capabilitySettings?.licenseKey}>Reset</Button>
            <Button variant="primary" onClick={saveOverride} disabled={!capabilitySettings?.licenseKey}>Save Override</Button>
          </div>
        </div>
        <div className="mt-5 divide-y divide-gray-100 rounded-2xl border border-gray-100">
          {CAPABILITY_KEYS.map((key: AppCapabilityKey) => {
            const checked = Boolean(overrideCapabilities[key]);
            const tierDefault = Boolean(tierDefaultCapabilities[key]);
            const active = Boolean(activeCapabilities[key]);
            const subKeys = getSubCapabilities(key);
            const hasSubs = subKeys.length > 0;
            const isExpanded = expandedCapabilities[key] || false;

            return (
              <div key={key}>
                {/* Parent row */}
                <div className={`flex items-center gap-3 px-5 py-4 ${checked ? 'bg-[#f8fbff]' : 'bg-white'}`}>
                  <label className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        const newChecked = event.target.checked;
                        setOverrideCapabilities((current) => ({ ...current, [key]: newChecked }));
                        // When parent is toggled off, disable all subs; when on, enable all subs
                        if (hasSubs) {
                          setOverrideSubCapabilities((current) => {
                            const updated = { ...current };
                            for (const subKey of subKeys) {
                              updated[subKey] = newChecked;
                            }
                            return updated;
                          });
                        }
                      }}
                      className="h-5 w-5 accent-[#0f2f57] shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="font-black text-gray-900 truncate">{CAPABILITY_LABELS[key]}</p>
                      <p className="mt-0.5 text-[11px] font-bold text-gray-400">
                        Tier: {tierDefault ? 'On' : 'Off'} · Active: {active ? 'On' : 'Off'}
                      </p>
                    </div>
                  </label>
                  {hasSubs && (
                    <button
                      type="button"
                      onClick={() => setExpandedCapabilities((current) => ({ ...current, [key]: !current[key] }))}
                      className="p-2 rounded-lg hover:bg-gray-100 transition-colors shrink-0"
                      aria-label={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      <span className={`block transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                        {ICONS.ChevronRight}
                      </span>
                    </button>
                  )}
                </div>

                {/* Sub-capability rows */}
                {hasSubs && isExpanded && (
                  <div className="bg-gray-50/60">
                    {subKeys.map((subKey) => {
                      const subChecked = overrideSubCapabilities[subKey] !== false;
                      const parentEnabled = checked;
                      return (
                        <label
                          key={subKey}
                          className={`flex items-center gap-3 pl-14 pr-5 py-3 border-t border-gray-50 cursor-pointer transition-colors ${
                            !parentEnabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={subChecked}
                            disabled={!parentEnabled}
                            onChange={(event) =>
                              setOverrideSubCapabilities((current) => ({ ...current, [subKey]: event.target.checked }))
                            }
                            className="h-4 w-4 accent-[#0f2f57] shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-700">{SUB_CAPABILITY_LABELS[subKey]}</p>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
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
                  <p className="text-xs font-medium text-gray-500">{formatDateTime(payment.submittedAt)}</p>
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
