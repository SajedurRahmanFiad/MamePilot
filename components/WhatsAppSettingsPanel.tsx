import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clipboard, ExternalLink, KeyRound, LogIn, Plus, RefreshCw, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from './Button';
import { useWhatsAppSettings } from '../src/hooks/useQueries';
import { useConnectWhatsAppEmbeddedSignup, useSyncWhatsAppBusinessAppData, useTestWhatsAppConnection, useUpdateWhatsAppEmbeddedSignupConfiguration, useUpdateWhatsAppWelcomeExperience } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useAuth } from '../src/contexts/AuthProvider';
import { buildWhatsAppBusinessAppOnboardingOptions, DEFAULT_WHATSAPP_GRAPH_VERSION } from '../src/utils/whatsappEmbeddedSignup';
import { isDeveloperRole, type WhatsAppSettings } from '../types';

type FacebookSdk = {
  init: (options: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string }) => void;
  login: (callback: (response: any) => void, options: Record<string, unknown>) => void;
  __mamePilotInitialized?: boolean;
};

type FeedbackState = {
  type: 'idle' | 'progress' | 'success' | 'warning' | 'error';
  message: string;
};

const EMPTY_SETTINGS: WhatsAppSettings = {
  accessToken: '', phoneNumberId: '', businessAccountId: '', verifyToken: '', appSecret: '', graphVersion: DEFAULT_WHATSAPP_GRAPH_VERSION,
  displayPhoneNumber: '', verifiedName: '', qualityRating: '', webhookUrl: '', configured: false, webhookConfigured: false,
  welcomeMessage: '', getStartedEnabled: false, iceBreakers: [], welcomeActive: false,
  embeddedSignupAvailable: false, embeddedSignupAppId: '', embeddedSignupConfigId: '', isOnBizApp: false,
  embeddedSignupMissing: [], embeddedSignupEnvironmentFields: [], connectionMode: 'none',
  connectionStatus: 'disconnected', contactsSyncRequested: false, historySyncRequested: false,
};

const isMetaOrigin = (origin: string): boolean => origin === 'https://facebook.com' || origin === 'https://www.facebook.com' || origin.endsWith('.facebook.com');

const WhatsAppSettingsPanel: React.FC = () => {
  const toast = useToastNotifications();
  const { user } = useAuth();
  const isDeveloper = isDeveloperRole(user?.role);
  const { data, isPending, error, refetch: refetchSettings } = useWhatsAppSettings(true);
  const configurationMutation = useUpdateWhatsAppEmbeddedSignupConfiguration();
  const connectMutation = useConnectWhatsAppEmbeddedSignup();
  const syncMutation = useSyncWhatsAppBusinessAppData();
  const testMutation = useTestWhatsAppConnection();
  const welcomeMutation = useUpdateWhatsAppWelcomeExperience();
  const [settings, setSettings] = useState<WhatsAppSettings>(EMPTY_SETTINGS);
  const [sdkLoading, setSdkLoading] = useState(false);
  const [popupOpening, setPopupOpening] = useState(false);
  const [signupEvent, setSignupEvent] = useState('');
  const [configurationFeedback, setConfigurationFeedback] = useState<FeedbackState>({ type: 'idle', message: '' });
  const [connectionFeedback, setConnectionFeedback] = useState<FeedbackState>({ type: 'idle', message: '' });
  const [developerConfiguration, setDeveloperConfiguration] = useState({
    embeddedSignupAppId: '',
    embeddedSignupConfigId: '',
    appSecret: '',
    webhookUrl: '',
    verifyToken: '',
    graphVersion: DEFAULT_WHATSAPP_GRAPH_VERSION,
  });
  const sdkRef = useRef<FacebookSdk | null>(null);
  const pendingCodeRef = useRef<string | null>(null);
  const pendingSessionRef = useRef<{ event: string; wabaId: string; phoneNumberId?: string } | null>(null);
  const completingRef = useRef(false);
  const completionTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (completionTimerRef.current !== null) window.clearTimeout(completionTimerRef.current);
  }, []);

  useEffect(() => {
    if (data) {
      const next = { ...EMPTY_SETTINGS, ...data };
      setSettings(next);
      setDeveloperConfiguration({
        embeddedSignupAppId: next.embeddedSignupAppId || '',
        embeddedSignupConfigId: next.embeddedSignupConfigId || '',
        appSecret: '',
        webhookUrl: next.webhookUrl || '',
        verifyToken: '',
        graphVersion: next.graphVersion || DEFAULT_WHATSAPP_GRAPH_VERSION,
      });
    }
  }, [data]);

  const setField = <K extends keyof WhatsAppSettings>(key: K, value: WhatsAppSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const initializeSdk = async (): Promise<FacebookSdk> => {
    const appId = settings.embeddedSignupAppId?.trim();
    if (!appId) throw new Error('WhatsApp login is not configured on this server.');
    const existing = (window as any).FB as FacebookSdk | undefined;
    if (existing) {
      if (!existing.__mamePilotInitialized) {
        existing.init({ appId, autoLogAppEvents: true, xfbml: true, version: settings.graphVersion || DEFAULT_WHATSAPP_GRAPH_VERSION });
        existing.__mamePilotInitialized = true;
      }
      sdkRef.current = existing;
      return existing;
    }
    setSdkLoading(true);
    try {
      const sdk = await new Promise<FacebookSdk>((resolve, reject) => {
        let settled = false;
        let activeScript: HTMLScriptElement | null = null;
        const timeoutId = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          if (!(window as any).FB) activeScript?.remove();
          reject(new Error('Meta login took too long to load. Check browser tracking protection and try again.'));
        }, 15000);
        const succeed = (loaded: FacebookSdk) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          resolve(loaded);
        };
        const fail = (message: string) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          if (!(window as any).FB) activeScript?.remove();
          reject(new Error(message));
        };
        const previous = (window as any).fbAsyncInit;
        (window as any).fbAsyncInit = () => {
          try { if (typeof previous === 'function') previous(); } catch { /* another integration must not block WhatsApp */ }
          const loaded = (window as any).FB as FacebookSdk | undefined;
          if (!loaded) { fail('Meta login could not be loaded.'); return; }
          try {
            loaded.init({ appId, autoLogAppEvents: true, xfbml: true, version: settings.graphVersion || DEFAULT_WHATSAPP_GRAPH_VERSION });
            loaded.__mamePilotInitialized = true;
            succeed(loaded);
          } catch { fail('Meta login could not be initialized.'); }
        };
        const existingScript = document.getElementById('facebook-jssdk') as HTMLScriptElement | null;
        if (existingScript) {
          activeScript = existingScript;
          const loaded = (window as any).FB as FacebookSdk | undefined;
          if (loaded) (window as any).fbAsyncInit();
          else existingScript.addEventListener('load', () => (window as any).fbAsyncInit(), { once: true });
          existingScript.addEventListener('error', () => fail('Meta login could not be loaded.'), { once: true });
          return;
        }
        const script = document.createElement('script');
        activeScript = script;
        script.id = 'facebook-jssdk'; script.async = true; script.defer = true; script.crossOrigin = 'anonymous';
        script.src = 'https://connect.facebook.net/en_US/sdk.js';
        script.onerror = () => fail('Meta login could not be loaded.');
        document.body.appendChild(script);
      });
      sdkRef.current = sdk;
      return sdk;
    } finally {
      setSdkLoading(false);
    }
  };

  const clearCompletionTimer = () => {
    if (completionTimerRef.current === null) return;
    window.clearTimeout(completionTimerRef.current);
    completionTimerRef.current = null;
  };

  const scheduleCompletionTimeout = () => {
    clearCompletionTimer();
    completionTimerRef.current = window.setTimeout(() => {
      completionTimerRef.current = null;
      if (completingRef.current || (pendingCodeRef.current && pendingSessionRef.current?.wabaId)) return;
      const missingAuthorization = !pendingCodeRef.current;
      const message = missingAuthorization
        ? 'Meta finished the business selection but did not return the authorization code. Please open WhatsApp login and try again.'
        : 'Meta authorized a general business connection but did not start WhatsApp Business app onboarding. Ask the Developer to confirm that the saved Configuration ID uses Meta\'s WhatsApp Embedded Signup template, then try again.';
      pendingCodeRef.current = null;
      pendingSessionRef.current = null;
      setPopupOpening(false);
      setConnectionFeedback({ type: 'error', message });
      toast.error(message);
    }, 30000);
  };

  const completeSignup = async () => {
    const code = pendingCodeRef.current;
    const session = pendingSessionRef.current;
    if (completingRef.current) return;
    if (!code || !session?.wabaId) {
      setConnectionFeedback({
        type: 'progress',
        message: code
          ? 'Meta authorization was received. Waiting for the selected WhatsApp business account...'
          : 'The WhatsApp business account was selected. Waiting for Meta authorization...',
      });
      scheduleCompletionTimeout();
      return;
    }
    clearCompletionTimer();
    completingRef.current = true;
    setPopupOpening(false);
    setConnectionFeedback({ type: 'progress', message: 'Meta login finished. Verifying and saving the WhatsApp Business connection...' });
    const toastId = toast.loading('Finishing WhatsApp Business connection...');
    try {
      const saved = await connectMutation.mutateAsync({ code, wabaId: session.wabaId, phoneNumberId: session.phoneNumberId });
      setSettings({ ...EMPTY_SETTINGS, ...saved });
      pendingCodeRef.current = null; pendingSessionRef.current = null; setSignupEvent('');
      const warning = saved.warnings?.join(' ');
      setConnectionFeedback({ type: warning ? 'warning' : 'success', message: warning ? `WhatsApp connected with a warning: ${warning}` : 'WhatsApp Business and Cloud API are connected and saved.' });
      toast.update(toastId, warning ? `WhatsApp is connected. ${warning}` : 'WhatsApp Business and Cloud API are connected.', warning ? 'warning' : 'success');
    } catch (connectError) {
      const message = connectError instanceof Error ? connectError.message : 'WhatsApp could not be connected. Please try again.';
      const refreshed = await refetchSettings();
      if (refreshed.data) setSettings({ ...EMPTY_SETTINGS, ...refreshed.data });
      setConnectionFeedback({ type: 'error', message });
      toast.update(toastId, message, 'error');
      pendingCodeRef.current = null; pendingSessionRef.current = null; setSignupEvent('');
    } finally {
      completingRef.current = false;
    }
  };

  useEffect(() => {
    if (!settings.embeddedSignupAvailable) return;
    const listener = (event: MessageEvent) => {
      if (!isMetaOrigin(event.origin)) return;
      let payload: any = event.data;
      if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { return; } }
      if (!payload || payload.type !== 'WA_EMBEDDED_SIGNUP') return;
      const eventName = String(payload.event || '');
      setSignupEvent(eventName);
      if (eventName === 'CANCEL' || eventName === 'ERROR') {
        clearCompletionTimer();
        pendingCodeRef.current = null; pendingSessionRef.current = null;
        setPopupOpening(false);
        const message = eventName === 'CANCEL' ? 'WhatsApp login was cancelled.' : 'Meta reported that WhatsApp login could not be completed.';
        setConnectionFeedback({ type: eventName === 'CANCEL' ? 'warning' : 'error', message });
        toast.warning(message);
        return;
      }
      if (!eventName.startsWith('FINISH')) return;
      const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
      const wabaId = String(data.waba_id || data.wabaId || '');
      if (!/^\d{5,32}$/.test(wabaId)) {
        clearCompletionTimer();
        pendingCodeRef.current = null;
        pendingSessionRef.current = null;
        setPopupOpening(false);
        const message = 'Meta finished a general business connection but did not return a WhatsApp account. Ask the Developer to replace the saved Configuration ID with a WhatsApp Embedded Signup configuration.';
        setConnectionFeedback({ type: 'error', message });
        toast.error(message);
        return;
      }
      pendingSessionRef.current = {
        event: eventName,
        wabaId,
        phoneNumberId: data.phone_number_id || data.phoneNumberId ? String(data.phone_number_id || data.phoneNumberId) : undefined,
      };
      void completeSignup();
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  });

  useEffect(() => {
    if (!settings.embeddedSignupAvailable) return;
    void initializeSdk().catch(() => { /* the button reports a useful error if the browser blocks the SDK */ });
    // The Meta SDK is loaded once per page; the current configuration is the
    // only value needed here and is intentionally not a credential.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.embeddedSignupAvailable, settings.embeddedSignupAppId]);

  const connect = async () => {
    if (!settings.embeddedSignupAvailable) {
      const missing = settings.embeddedSignupMissing?.filter(Boolean) || [];
      const message = missing.length > 0
        ? `WhatsApp login cannot open yet. Missing server setup: ${missing.join(', ')}.`
        : 'WhatsApp login is not enabled on this server yet.';
      setConnectionFeedback({ type: 'error', message });
      toast.error(message);
      return;
    }
    clearCompletionTimer();
    pendingCodeRef.current = null; pendingSessionRef.current = null; setSignupEvent('');
    setConnectionFeedback({ type: 'progress', message: 'Opening Meta login. Complete every step in the popup window...' });
    setPopupOpening(true);
    try {
      const sdk = sdkRef.current || await initializeSdk();
      setConnectionFeedback({ type: 'progress', message: 'Meta login is open. Finish the account and mobile-app confirmation in that window.' });
      sdk.login((response) => {
        setPopupOpening(false);
        const code = response?.authResponse?.code;
        if (!code) {
          clearCompletionTimer();
          const message = response?.status === 'unknown'
            ? 'Meta login closed without returning authorization. Allow popups and cross-site tracking for this site, then try again.'
            : 'WhatsApp login was cancelled before authorization finished.';
          setConnectionFeedback({ type: response?.status === 'unknown' ? 'error' : 'warning', message });
          if (response?.status === 'unknown') toast.error(message); else toast.warning(message);
          return;
        }
        pendingCodeRef.current = String(code);
        void completeSignup();
      }, {
        ...buildWhatsAppBusinessAppOnboardingOptions(settings.embeddedSignupConfigId),
        // Meta's Coexistence flow requires both the Business app feature flag
        // and session logging v3. Without these values Meta can complete a
        // generic portfolio/Page authorization without returning a WABA ID.
      });
    } catch (connectError) {
      setPopupOpening(false);
      const message = connectError instanceof Error ? connectError.message : 'Meta login could not be opened.';
      setConnectionFeedback({ type: 'error', message });
      toast.error(message);
    }
  };

  const saveDeveloperConfiguration = async () => {
    setConfigurationFeedback({ type: 'progress', message: 'Saving and verifying the Meta credentials on the server...' });
    const toastId = toast.loading('Saving the WhatsApp login configuration...');
    try {
      const saved = await configurationMutation.mutateAsync(developerConfiguration);
      const refreshed = await refetchSettings();
      const confirmed = refreshed.data || saved;
      if ((developerConfiguration.appSecret || !settings.hasAppSecret) && !confirmed.hasAppSecret) {
        throw new Error('The server did not confirm that the Meta app secret was saved.');
      }
      if ((developerConfiguration.verifyToken || !settings.hasVerifyToken) && !confirmed.hasVerifyToken) {
        throw new Error('The server did not confirm that the webhook verify token was saved.');
      }
      const next = { ...EMPTY_SETTINGS, ...confirmed };
      setSettings(next);
      setDeveloperConfiguration({
        embeddedSignupAppId: next.embeddedSignupAppId || '',
        embeddedSignupConfigId: next.embeddedSignupConfigId || '',
        appSecret: '',
        webhookUrl: next.webhookUrl || '',
        verifyToken: '',
        graphVersion: next.graphVersion || DEFAULT_WHATSAPP_GRAPH_VERSION,
      });
      sdkRef.current = null;
      const existingSdk = (window as any).FB as FacebookSdk | undefined;
      if (existingSdk) existingSdk.__mamePilotInitialized = false;
      const ready = Boolean(confirmed.embeddedSignupAvailable);
      const savedMessage = ready
        ? 'Saved and verified by the server. The Meta app secret and webhook verify token are stored securely.'
        : `Saved, but setup is still missing: ${confirmed.embeddedSignupMissing?.join(', ') || 'required Meta settings'}.`;
      setConfigurationFeedback({ type: ready ? 'success' : 'warning', message: savedMessage });
      toast.update(
        toastId,
        ready
          ? 'WhatsApp login is ready. You can open the Meta login window now.'
          : savedMessage,
        ready ? 'success' : 'warning',
      );
    } catch (configurationError) {
      const message = configurationError instanceof Error ? configurationError.message : 'The WhatsApp login configuration could not be saved.';
      setConfigurationFeedback({ type: 'error', message });
      toast.update(toastId, message, 'error');
    }
  };

  const test = async () => {
    const toastId = toast.loading('Checking the WhatsApp connection...');
    try {
      const result = await testMutation.mutateAsync();
      setSettings((current) => ({ ...current, configured: true, displayPhoneNumber: result.displayPhoneNumber, verifiedName: result.verifiedName, qualityRating: result.qualityRating, platformType: result.platformType, isOnBizApp: result.isOnBizApp, connectionStatus: result.isOnBizApp ? 'connected' : 'cloud_api_only' }));
      toast.update(toastId, result.isOnBizApp ? 'WhatsApp coexistence is verified.' : 'Cloud API is reachable, but Business app coexistence is not verified.', result.isOnBizApp ? 'success' : 'warning');
    } catch (testError) {
      toast.update(toastId, testError instanceof Error ? testError.message : 'WhatsApp could not be verified. Please try again.', 'error');
    }
  };

  const sync = async () => {
    const toastId = toast.loading('Starting WhatsApp contact and history synchronization...');
    try {
      const result = await syncMutation.mutateAsync('all');
      setSettings({ ...EMPTY_SETTINGS, ...result.settings });
      const warning = result.warnings?.join(' ');
      toast.update(toastId, warning ? `WhatsApp synchronization partially started. ${warning}` : 'WhatsApp synchronization has started. New history and contacts will arrive through webhooks.', warning ? 'warning' : 'success');
    } catch (syncError) {
      toast.update(toastId, syncError instanceof Error ? syncError.message : 'WhatsApp synchronization could not be started.', 'error');
    }
  };

  const saveWelcomeExperience = async () => {
    const toastId = toast.loading('Saving the WhatsApp welcome experience...');
    try {
      const saved = await welcomeMutation.mutateAsync({ welcomeMessage: settings.welcomeMessage, getStartedEnabled: settings.getStartedEnabled, iceBreakers: settings.iceBreakers });
      setSettings({ ...EMPTY_SETTINGS, ...saved });
      toast.update(toastId, 'WhatsApp welcome experience is active.', 'success');
    } catch (welcomeError) {
      toast.update(toastId, welcomeError instanceof Error ? welcomeError.message : 'The welcome experience could not be saved. Please try again.', 'error');
    }
  };

  const copyWebhook = async () => {
    try { await navigator.clipboard.writeText(settings.webhookUrl); toast.success('Message delivery address copied.'); }
    catch { toast.error('Could not copy the message delivery address. Please try again.'); }
  };

  if (isPending) return <div className="py-16 text-center text-sm font-medium text-gray-500">Loading WhatsApp settings...</div>;
  const coexistenceConnected = settings.configured && settings.isOnBizApp && String(settings.platformType || '').toUpperCase() === 'CLOUD_API';
  const cloudApiOnly = settings.configured && !coexistenceConnected;
  const connectionInProgress = settings.connectionStatus === 'connecting' && !settings.configured;
  const isMetaTestNumber = /test\s*number/i.test(settings.verifiedName || '');
  const qualityRating = String(settings.qualityRating || '').trim();
  const showQuality = qualityRating !== '' && qualityRating.toUpperCase() !== 'UNKNOWN';
  const environmentFields = new Set(settings.embeddedSignupEnvironmentFields || []);
  const configurationField = (field: keyof typeof developerConfiguration, value: string) => {
    setDeveloperConfiguration((current) => ({ ...current, [field]: value }));
  };

  return (
    <div className="space-y-7 animate-in fade-in duration-300">
      <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div><h3 className="text-xl font-bold text-gray-800">WhatsApp Business</h3><p className="mt-2 max-w-3xl text-sm text-gray-500">Connect the existing WhatsApp Business mobile account to MamePilot while keeping the mobile app and Cloud API active together.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={test} loading={testMutation.isPending} icon={<RefreshCw size={17} />}>Verify connection</Button>
          {coexistenceConnected && <Button type="button" variant="outline" onClick={sync} loading={syncMutation.isPending} disabled={Boolean(settings.contactsSyncRequested && settings.historySyncRequested)} icon={<RefreshCw size={17} />}>Sync Business app data</Button>}
        </div>
      </div>

      {error && <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">WhatsApp settings could not be loaded. Please refresh the page.</div>}

      <div className={`rounded-xl border p-4 ${coexistenceConnected ? 'border-emerald-100 bg-emerald-50' : cloudApiOnly ? 'border-amber-100 bg-amber-50' : connectionInProgress ? 'border-blue-100 bg-blue-50' : 'border-gray-200 bg-gray-50'}`}>
        <div className="flex items-start gap-3">
          {coexistenceConnected ? <CheckCircle2 className="mt-0.5 text-emerald-600" size={20} /> : <KeyRound className={`mt-0.5 ${cloudApiOnly ? 'text-amber-600' : connectionInProgress ? 'text-blue-600' : 'text-gray-500'}`} size={20} />}
          <div>
            <p className={`text-sm font-bold ${coexistenceConnected ? 'text-emerald-800' : cloudApiOnly ? 'text-amber-800' : connectionInProgress ? 'text-blue-800' : 'text-gray-800'}`}>{coexistenceConnected ? 'WhatsApp Business app + Cloud API are connected.' : cloudApiOnly ? (isMetaTestNumber ? 'A Meta Cloud API test number is saved. It is not a WhatsApp Business app connection.' : 'A Cloud API-only number is saved. WhatsApp Business app coexistence is not connected.') : connectionInProgress ? 'Meta authorization was saved, but phone setup did not finish.' : 'Connect WhatsApp Business to start.'}</p>
            {(settings.verifiedName || settings.displayPhoneNumber) && <p className="mt-1 text-xs font-semibold text-gray-600">{settings.verifiedName || 'WhatsApp Business'}{settings.displayPhoneNumber ? ` · ${settings.displayPhoneNumber}` : ''}{showQuality ? ` · Quality ${qualityRating}` : ''}</p>}
            {cloudApiOnly && <p className="mt-1 text-xs text-amber-700">Use Open WhatsApp login below and complete the Business app mobile prompt to replace this legacy connection with Coexistence.</p>}
            {settings.lastWebhookAt && <p className="mt-1 text-xs text-gray-500">Last message delivery: {new Date(settings.lastWebhookAt).toLocaleString()}</p>}
          </div>
        </div>
      </div>

      {isDeveloper && <section className="rounded-xl border border-violet-100 bg-violet-50/40 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="flex items-center gap-2"><ShieldCheck size={18} className="text-violet-700" /><h4 className="text-base font-black text-violet-950">Developer setup for WhatsApp login</h4></div><p className="mt-2 max-w-3xl text-sm text-violet-800">Configure the Meta app and this deployment's webhook once. The app secret and verify token are write-only: saved values are never sent back to the browser.</p></div>
          <Button type="button" onClick={saveDeveloperConfiguration} loading={configurationMutation.isPending} icon={<Save size={17} />}>Save login setup</Button>
        </div>
        {configurationFeedback.type !== 'idle' && <div className={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${configurationFeedback.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : configurationFeedback.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : configurationFeedback.type === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}>{configurationFeedback.message}</div>}
        {settings.hasAppSecret && settings.hasVerifyToken && settings.embeddedSignupConfigurationUpdatedAt && <p className="mt-3 text-xs font-semibold text-violet-700">Server record confirmed: {new Date(settings.embeddedSignupConfigurationUpdatedAt).toLocaleString()}</p>}
        <div className="mt-4 rounded-xl border border-violet-200 bg-white px-4 py-3 text-sm leading-6 text-violet-900">
          <p className="font-black">The Configuration ID must be WhatsApp-specific.</p>
          <p className="mt-1">In Meta, create it from <strong>WhatsApp Embedded Signup Configuration With 60 Expiration Token</strong>, or choose the <strong>WhatsApp Embedded Signup</strong> login variation in a custom configuration. Do not reuse a general portfolio, Facebook Page, or advertising login configuration.</p>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm font-bold text-gray-700"><span>Meta app ID</span><input value={developerConfiguration.embeddedSignupAppId} onChange={(event) => configurationField('embeddedSignupAppId', event.target.value)} disabled={environmentFields.has('embeddedSignupAppId')} inputMode="numeric" autoComplete="off" className="w-full rounded-xl border border-violet-100 bg-white px-3 py-2.5 font-medium outline-none focus:border-violet-500 disabled:bg-gray-100" placeholder="Numeric app ID" />{environmentFields.has('embeddedSignupAppId') && <span className="block text-xs font-medium text-violet-600">Managed by the server environment.</span>}</label>
          <label className="space-y-2 text-sm font-bold text-gray-700"><span>Embedded Signup v4 configuration ID</span><input value={developerConfiguration.embeddedSignupConfigId} onChange={(event) => configurationField('embeddedSignupConfigId', event.target.value)} disabled={environmentFields.has('embeddedSignupConfigId')} inputMode="numeric" autoComplete="off" className="w-full rounded-xl border border-violet-100 bg-white px-3 py-2.5 font-medium outline-none focus:border-violet-500 disabled:bg-gray-100" placeholder="Numeric configuration ID" />{environmentFields.has('embeddedSignupConfigId') && <span className="block text-xs font-medium text-violet-600">Managed by the server environment.</span>}</label>
          <label className="space-y-2 text-sm font-bold text-gray-700"><span>Meta app secret</span><input type="password" value={developerConfiguration.appSecret} onChange={(event) => configurationField('appSecret', event.target.value)} disabled={environmentFields.has('appSecret')} autoComplete="new-password" className="w-full rounded-xl border border-violet-100 bg-white px-3 py-2.5 font-medium outline-none focus:border-violet-500 disabled:bg-gray-100" placeholder={settings.hasAppSecret ? 'Saved - leave blank to keep it' : 'Enter the app secret'} />{environmentFields.has('appSecret') ? <span className="block text-xs font-medium text-violet-600">Saved in the server environment and never exposed here.</span> : settings.hasAppSecret ? <span className="flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} /> Saved securely on the server</span> : <span className="block text-xs font-medium text-amber-700">Not saved yet.</span>}</label>
          <label className="space-y-2 text-sm font-bold text-gray-700"><span>Webhook verify token</span><input type="password" value={developerConfiguration.verifyToken} onChange={(event) => configurationField('verifyToken', event.target.value)} disabled={environmentFields.has('verifyToken')} autoComplete="new-password" className="w-full rounded-xl border border-violet-100 bg-white px-3 py-2.5 font-medium outline-none focus:border-violet-500 disabled:bg-gray-100" placeholder={settings.hasVerifyToken ? 'Saved - leave blank to keep it' : 'Enter the token configured in Meta'} />{environmentFields.has('verifyToken') ? <span className="block text-xs font-medium text-violet-600">Saved in the server environment and never exposed here.</span> : settings.hasVerifyToken ? <span className="flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} /> Saved securely on the server</span> : <span className="block text-xs font-medium text-amber-700">Not saved yet.</span>}</label>
          <label className="space-y-2 text-sm font-bold text-gray-700 md:col-span-2"><span>Public HTTPS webhook URL</span><input type="url" value={developerConfiguration.webhookUrl} onChange={(event) => configurationField('webhookUrl', event.target.value)} disabled={environmentFields.has('webhookUrl')} autoComplete="url" className="w-full rounded-xl border border-violet-100 bg-white px-3 py-2.5 font-medium outline-none focus:border-violet-500 disabled:bg-gray-100" placeholder="https://your-domain.example/api/whatsapp-webhook.php" />{environmentFields.has('webhookUrl') && <span className="block text-xs font-medium text-violet-600">Managed by the server environment.</span>}</label>
          <label className="space-y-2 text-sm font-bold text-gray-700"><span>Meta Graph API version</span><input value={developerConfiguration.graphVersion} onChange={(event) => configurationField('graphVersion', event.target.value)} disabled={environmentFields.has('graphVersion')} autoComplete="off" className="w-full rounded-xl border border-violet-100 bg-white px-3 py-2.5 font-medium outline-none focus:border-violet-500 disabled:bg-gray-100" placeholder={DEFAULT_WHATSAPP_GRAPH_VERSION} />{environmentFields.has('graphVersion') && <span className="block text-xs font-medium text-violet-600">Managed by the server environment.</span>}</label>
        </div>
        <p className="mt-4 text-xs font-semibold leading-5 text-violet-700">Use the same callback URL and verify token in the Meta app's WhatsApp webhook configuration. Subscribe the default callback to account updates as well as message events so mobile disconnects reach this deployment.</p>
      </section>}

      <section className="rounded-xl border border-gray-100 bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><h4 className="text-base font-black text-gray-900">Connect with WhatsApp Business</h4><p className="mt-1 max-w-2xl text-sm text-gray-500">A secure Meta login window will open. Sign in, choose the existing WhatsApp Business account, and use the mobile app prompt to connect it to the Business Platform. No business access token or phone ID needs to be pasted here.</p></div><Button type="button" onClick={connect} loading={popupOpening || connectMutation.isPending || sdkLoading} icon={<LogIn size={17} />}>Open WhatsApp login</Button></div>
        {!settings.embeddedSignupAvailable && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><p className="font-bold">WhatsApp login is not ready on this deployment.</p><p className="mt-1">{isDeveloper ? 'Complete the developer setup above, save it, and then open the login again.' : 'A Developer must complete the Meta app and webhook setup before this login can open.'}</p>{Boolean(settings.embeddedSignupMissing?.length) && <p className="mt-2 text-xs font-semibold">Missing setup: {settings.embeddedSignupMissing?.join(', ')}.</p>}</div>}
        {connectionFeedback.type !== 'idle' && <div className={`mt-4 rounded-xl border px-4 py-3 text-sm font-semibold ${connectionFeedback.type === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : connectionFeedback.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : connectionFeedback.type === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-blue-200 bg-blue-50 text-blue-800'}`}><p>{connectionFeedback.message}</p>{signupEvent && connectionFeedback.type === 'progress' && <p className="mt-1 text-xs opacity-75">Meta event received: {signupEvent.replaceAll('_', ' ').toLowerCase()}.</p>}</div>}
        <ol className="mt-5 grid gap-3 text-sm text-gray-600 md:grid-cols-2 xl:grid-cols-4"><li className="rounded-xl bg-gray-50 p-4"><strong className="block text-gray-900">1. Sign in</strong><span className="mt-1 block">Use the Meta account that administers the business and select the existing WhatsApp Business option.</span></li><li className="rounded-xl bg-gray-50 p-4"><strong className="block text-gray-900">2. Copy Meta's code</strong><span className="mt-1 block">Meta normally shows a verification code. A QR option may also be available, but a QR code is not required.</span></li><li className="rounded-xl bg-gray-50 p-4"><strong className="block text-gray-900">3. Confirm on mobile</strong><span className="mt-1 block">Open the official Facebook Business message in WhatsApp Business, tap Connect, then Connect to the Business Platform and paste the code.</span></li><li className="rounded-xl bg-gray-50 p-4"><strong className="block text-gray-900">4. Finish in Meta</strong><span className="mt-1 block">Choose whether to share chat history and complete the remaining popup steps.</span></li></ol>
        {coexistenceConnected && <div className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">{settings.contactsSyncRequested && settings.historySyncRequested ? 'Contact and message-history synchronization requests have been sent.' : 'The connection is verified. MamePilot will request the one-time contact and history synchronization.'}</div>}
      </section>

      <section className="rounded-xl border border-blue-100 bg-blue-50 p-5"><h4 className="text-base font-black text-blue-950">Message delivery</h4><p className="mt-1 text-sm text-blue-700">Embedded Signup subscribes this WABA and routes supported message, history, echo, and contact events to this deployment automatically.</p><div className="mt-4 flex gap-2"><input readOnly value={settings.webhookUrl} aria-label="Message delivery address" className="min-w-0 flex-1 rounded-xl border border-blue-200 bg-white px-3 py-2 text-sm font-medium" /><Button type="button" variant="outline" onClick={copyWebhook} aria-label="Copy message delivery address"><Clipboard size={17} /></Button></div>{!settings.webhookConfigured && <p className="mt-3 text-xs font-semibold text-amber-700">The server app secret or webhook security configuration is incomplete; message delivery cannot be verified until the developer fixes the deployment environment.</p>}</section>

      <section className="space-y-5 rounded-xl border border-gray-100 bg-white p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h4 className="text-base font-black text-gray-900">Welcome experience</h4><p className="mt-1 max-w-2xl text-sm text-gray-500">When a customer messages for the first time, WhatsApp will automatically send this welcome—even when MamePilot is closed.</p></div><Button type="button" variant="outline" onClick={saveWelcomeExperience} loading={welcomeMutation.isPending} disabled={!settings.configured}>Save welcome experience</Button></div>
        <label className="block space-y-2 text-sm font-semibold text-gray-700"><span>Welcome message</span><textarea rows={4} maxLength={1024} value={settings.welcomeMessage} onChange={(event) => setField('welcomeMessage', event.target.value)} className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm font-medium outline-none focus:border-emerald-500" placeholder="Welcome! How can we help you today?" /><span className="block text-right text-xs font-medium text-gray-400">{settings.welcomeMessage.length}/1024</span></label>
        <label className="flex items-start gap-3 rounded-xl bg-gray-50 p-4"><input type="checkbox" checked={settings.getStartedEnabled} onChange={(event) => setSettings((current) => ({ ...current, getStartedEnabled: event.target.checked, iceBreakers: event.target.checked ? current.iceBreakers.slice(0, 2) : current.iceBreakers }))} className="mt-1 h-4 w-4 accent-emerald-600" /><span><span className="block text-sm font-black text-gray-800">Show Get Started</span><span className="mt-1 block text-sm text-gray-500">Customers can begin with one tap.</span></span></label>
        <div><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-black text-gray-800">Conversation starters</p><p className="mt-1 text-sm text-gray-500">Add short choices customers can tap.</p></div><button type="button" disabled={settings.iceBreakers.length >= (settings.getStartedEnabled ? 2 : 3)} onClick={() => setField('iceBreakers', [...settings.iceBreakers, ''])} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-black text-emerald-700 hover:bg-emerald-50 disabled:opacity-40"><Plus size={16} /> Add</button></div><div className="mt-3 space-y-3">{settings.iceBreakers.map((question, index) => <div key={index} className="flex gap-2"><input value={question} maxLength={20} onChange={(event) => setField('iceBreakers', settings.iceBreakers.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium outline-none focus:border-emerald-500" placeholder="Track my order" /><button type="button" onClick={() => setField('iceBreakers', settings.iceBreakers.filter((_, itemIndex) => itemIndex !== index))} className="rounded-xl p-3 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove conversation starter"><Trash2 size={17} /></button></div>)}</div></div>
        {settings.welcomeActive && <div className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">The automatic welcome is active for new customers.</div>}
      </section>
      <a href="https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-900">Open Meta's Business app Coexistence guide <ExternalLink size={15} /></a>
    </div>
  );
};

export default WhatsAppSettingsPanel;
