import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clipboard, ExternalLink, KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from './Button';
import { useWhatsAppSettings } from '../src/hooks/useQueries';
import { useTestWhatsAppConnection, useUpdateWhatsAppSettings, useUpdateWhatsAppWelcomeExperience } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import type { WhatsAppSettings } from '../types';

const EMPTY_SETTINGS: WhatsAppSettings = {
  accessToken: '',
  phoneNumberId: '',
  businessAccountId: '',
  verifyToken: '',
  appSecret: '',
  graphVersion: 'v25.0',
  displayPhoneNumber: '',
  verifiedName: '',
  qualityRating: '',
  webhookUrl: '',
  configured: false,
  webhookConfigured: false,
  welcomeMessage: '',
  getStartedEnabled: false,
  iceBreakers: [],
  welcomeActive: false,
};

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const WhatsAppSettingsPanel: React.FC = () => {
  const toast = useToastNotifications();
  const { data, isPending, error } = useWhatsAppSettings(true);
  const updateMutation = useUpdateWhatsAppSettings();
  const testMutation = useTestWhatsAppConnection();
  const welcomeMutation = useUpdateWhatsAppWelcomeExperience();
  const [settings, setSettings] = useState<WhatsAppSettings>(EMPTY_SETTINGS);

  useEffect(() => {
    if (data) setSettings({ ...EMPTY_SETTINGS, ...data });
  }, [data]);

  const setField = <K extends keyof WhatsAppSettings>(key: K, value: WhatsAppSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    const toastId = toast.loading('Saving WhatsApp settings...');
    try {
      const saved = await updateMutation.mutateAsync(settings);
      setSettings({ ...EMPTY_SETTINGS, ...saved });
      toast.update(toastId, 'WhatsApp settings saved.', 'success');
    } catch (saveError) {
      toast.update(toastId, saveError instanceof Error ? saveError.message : 'WhatsApp settings could not be saved. Please try again.', 'error');
    }
  };

  const test = async () => {
    if (!settings.accessToken.trim() || !settings.phoneNumberId.trim()) {
      toast.warning('Add the required WhatsApp connection details, then try again.');
      return;
    }
    const toastId = toast.loading('Checking your WhatsApp connection...');
    try {
      const saved = await updateMutation.mutateAsync(settings);
      setSettings({ ...EMPTY_SETTINGS, ...saved });
      const result = await testMutation.mutateAsync();
      setSettings((current) => ({
        ...current,
        configured: true,
        displayPhoneNumber: result.displayPhoneNumber,
        verifiedName: result.verifiedName,
        qualityRating: result.qualityRating,
      }));
      toast.update(toastId, 'WhatsApp is connected.', 'success');
    } catch (testError) {
      toast.update(toastId, testError instanceof Error ? testError.message : 'WhatsApp could not be connected. Please check the settings and try again.', 'error');
    }
  };

  const saveWelcomeExperience = async () => {
    const toastId = toast.loading('Saving the WhatsApp welcome experience...');
    try {
      const saved = await welcomeMutation.mutateAsync({
        welcomeMessage: settings.welcomeMessage,
        getStartedEnabled: settings.getStartedEnabled,
        iceBreakers: settings.iceBreakers,
      });
      setSettings({ ...EMPTY_SETTINGS, ...saved });
      toast.update(toastId, 'WhatsApp welcome experience is active.', 'success');
    } catch (welcomeError) {
      toast.update(toastId, welcomeError instanceof Error ? welcomeError.message : 'The welcome experience could not be saved. Please try again.', 'error');
    }
  };

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(settings.webhookUrl);
      toast.success('Message delivery address copied.');
    } catch {
      toast.error('Could not copy the message delivery address. Please try again.');
    }
  };

  if (isPending) {
    return <div className="py-16 text-center text-sm font-medium text-gray-500">Loading WhatsApp settings...</div>;
  }

  return (
    <div className="space-y-7 animate-in fade-in duration-300">
      <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h3 className="text-xl font-bold text-gray-800">WhatsApp Business</h3>
          <p className="mt-2 max-w-3xl text-sm text-gray-500">
            Connect your business WhatsApp number to the shared inbox. These details are only available to administrators.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={test} loading={testMutation.isPending || updateMutation.isPending} icon={<RefreshCw size={17} />}>
            Test Connection
          </Button>
          <Button type="button" onClick={save} loading={updateMutation.isPending} icon={<ShieldCheck size={17} />}>
            Save WhatsApp
          </Button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">WhatsApp settings could not be loaded. Please refresh the page.</div>}

      <div className={`rounded-xl border p-4 ${settings.configured ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50'}`}>
        <div className="flex items-start gap-3">
          {settings.configured ? <CheckCircle2 className="mt-0.5 text-emerald-600" size={20} /> : <KeyRound className="mt-0.5 text-amber-600" size={20} />}
          <div>
            <p className={`text-sm font-bold ${settings.configured ? 'text-emerald-800' : 'text-amber-800'}`}>
              {settings.configured ? 'WhatsApp connection details are saved.' : 'Complete the required WhatsApp connection details below.'}
            </p>
            {settings.configured && !settings.webhookConfigured && <p className="mt-1 text-xs font-semibold text-amber-700">Complete the message delivery details below so new messages can reach the inbox.</p>}
            {(settings.verifiedName || settings.displayPhoneNumber) && (
              <p className="mt-1 text-xs font-semibold text-gray-600">
                {settings.verifiedName || 'WhatsApp Business'} · {settings.displayPhoneNumber || settings.phoneNumberId}
                {settings.qualityRating ? ` · Quality ${settings.qualityRating}` : ''}
              </p>
            )}
          </div>
        </div>
      </div>

      <section className="rounded-xl border border-gray-100 bg-white p-5">
        <h4 className="text-base font-black text-gray-900">WhatsApp connection</h4>
        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm font-semibold text-gray-700 md:col-span-2">
            <span>Permanent access token</span>
            <textarea
              rows={3}
              value={settings.accessToken}
              onChange={(event) => setField('accessToken', event.target.value)}
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium outline-none focus:border-[#0f2f57]"
              placeholder="Paste the permanent access token from Meta"
            />
          </label>
          <label className="space-y-2 text-sm font-semibold text-gray-700">
            <span>Phone Number ID</span>
            <input value={settings.phoneNumberId} onChange={(event) => setField('phoneNumberId', event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium outline-none focus:border-[#0f2f57]" placeholder="Meta Phone Number ID" />
          </label>
          <label className="space-y-2 text-sm font-semibold text-gray-700">
            <span>WhatsApp Business Account ID</span>
            <input value={settings.businessAccountId} onChange={(event) => setField('businessAccountId', event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium outline-none focus:border-[#0f2f57]" placeholder="Business Account ID from Meta" />
          </label>
          <label className="space-y-2 text-sm font-semibold text-gray-700">
            <span>Meta App Secret</span>
            <input type="password" value={settings.appSecret} onChange={(event) => setField('appSecret', event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium outline-none focus:border-[#0f2f57]" placeholder="Paste the app secret from Meta" />
          </label>
          <label className="space-y-2 text-sm font-semibold text-gray-700">
            <span>Connection version (advanced)</span>
            <input value={settings.graphVersion} onChange={(event) => setField('graphVersion', event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium outline-none focus:border-[#0f2f57]" placeholder="v25.0" />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-blue-100 bg-blue-50 p-5">
        <h4 className="text-base font-black text-blue-950">Message delivery</h4>
        <p className="mt-1 text-sm text-blue-700">Copy this address into the WhatsApp section of your Meta app, then turn on message delivery.</p>
        <div className="mt-4 grid grid-cols-1 gap-4">
          <label className="space-y-2 text-sm font-semibold text-blue-900">
            <span>Message delivery address</span>
            <div className="flex gap-2">
              <input readOnly value={settings.webhookUrl} className="min-w-0 flex-1 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-medium" />
              <Button type="button" variant="outline" onClick={copyWebhook} aria-label="Copy message delivery address"><Clipboard size={17} /></Button>
            </div>
          </label>
          <label className="space-y-2 text-sm font-semibold text-blue-900">
            <span>Security code (Verify token in Meta)</span>
            <div className="flex gap-2">
              <input value={settings.verifyToken} onChange={(event) => setField('verifyToken', event.target.value)} className="min-w-0 flex-1 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-medium outline-none" placeholder="A private random string" />
              <Button type="button" variant="outline" onClick={() => setField('verifyToken', randomToken())}>Generate</Button>
            </div>
          </label>
        </div>
      </section>

      <section className="space-y-5 rounded-xl border border-gray-100 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="text-base font-black text-gray-900">Welcome experience</h4>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">When a customer messages for the first time, WhatsApp will automatically send this welcome—even when MamePilot is closed.</p>
          </div>
          <Button type="button" variant="outline" onClick={saveWelcomeExperience} loading={welcomeMutation.isPending} disabled={!settings.configured}>
            Save welcome experience
          </Button>
        </div>

        <label className="block space-y-2 text-sm font-semibold text-gray-700">
          <span>Welcome message</span>
          <textarea
            rows={4}
            maxLength={1024}
            value={settings.welcomeMessage}
            onChange={(event) => setField('welcomeMessage', event.target.value)}
            className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium outline-none focus:border-emerald-500"
            placeholder="Welcome! How can we help you today?"
          />
          <span className="block text-right text-xs font-medium text-gray-400">{settings.welcomeMessage.length}/1024</span>
        </label>

        <label className="flex items-start gap-3 rounded-xl bg-gray-50 p-4">
          <input
            type="checkbox"
            checked={settings.getStartedEnabled}
            onChange={(event) => setSettings((current) => ({
              ...current,
              getStartedEnabled: event.target.checked,
              iceBreakers: event.target.checked ? current.iceBreakers.slice(0, 2) : current.iceBreakers,
            }))}
            className="mt-1 h-4 w-4 accent-emerald-600"
          />
          <span>
            <span className="block text-sm font-black text-gray-800">Show Get Started</span>
            <span className="mt-1 block text-sm text-gray-500">Customers can begin with one tap.</span>
          </span>
        </label>

        <div>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black text-gray-800">Conversation starters</p>
              <p className="mt-1 text-sm text-gray-500">Add short choices customers can tap.</p>
            </div>
            <button
              type="button"
              disabled={settings.iceBreakers.length >= (settings.getStartedEnabled ? 2 : 3)}
              onClick={() => setField('iceBreakers', [...settings.iceBreakers, ''])}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-black text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"
            >
              <Plus size={16} /> Add
            </button>
          </div>
          <div className="mt-3 space-y-3">
            {settings.iceBreakers.map((question, index) => (
              <div key={index} className="flex gap-2">
                <input
                  value={question}
                  maxLength={20}
                  onChange={(event) => setField('iceBreakers', settings.iceBreakers.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                  className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium outline-none focus:border-emerald-500"
                  placeholder="Track my order"
                />
                <button type="button" onClick={() => setField('iceBreakers', settings.iceBreakers.filter((_, itemIndex) => itemIndex !== index))} className="rounded-xl p-3 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove conversation starter">
                  <Trash2 size={17} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {settings.welcomeActive && <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">The automatic welcome is active for new customers.</div>}
      </section>

      <a href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-900">
        Open Meta's WhatsApp setup guide <ExternalLink size={15} />
      </a>
    </div>
  );
};

export default WhatsAppSettingsPanel;
