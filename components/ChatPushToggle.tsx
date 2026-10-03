import React, { useEffect, useState } from 'react';
import { Bell, BellOff } from 'lucide-react';
import {
  fetchMessengerPushSettings,
  fetchWhatsAppPushSettings,
  updateMessengerPushPreference,
  updateWhatsAppPushPreference,
} from '../src/services/supabaseQueries';
import { decodeVapidPublicKey } from '../src/utils/chatPush';

type Channel = 'messenger' | 'whatsapp';
type PushSettings = { supported: boolean; vapidPublicKey: string; enabled: boolean };
type Props = { channel: Channel };

const fetchSettings = (channel: Channel, endpoint = ''): Promise<PushSettings> => channel === 'messenger'
  ? fetchMessengerPushSettings(endpoint)
  : fetchWhatsAppPushSettings(endpoint);

const updatePreference = (channel: Channel, subscription: PushSubscriptionJSON, enabled: boolean): Promise<PushSettings> => channel === 'messenger'
  ? updateMessengerPushPreference(subscription, enabled)
  : updateWhatsAppPushPreference(subscription, enabled);

const ChatPushToggle: React.FC<Props> = ({ channel }) => {
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const channelLabel = channel === 'messenger' ? 'Messenger' : 'WhatsApp';

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const browserSupported = 'Notification' in window
          && 'serviceWorker' in navigator
          && 'PushManager' in window;
        if (!browserSupported) {
          if (active) { setSupported(false); setLoading(false); }
          return;
        }
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        const settings = await fetchSettings(channel, subscription?.endpoint || '');
        if (active) {
          setSupported(settings.supported);
          setEnabled(settings.enabled);
          if (!settings.supported) setError('Push delivery is not configured on this server.');
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load notification settings.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [channel]);

  const toggle = async () => {
    setSaving(true);
    setError('');
    try {
      if (!supported) throw new Error('Push delivery is not available on this browser or server.');
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        throw new Error('This browser does not support push notifications.');
      }

      if (!enabled) {
        const settings = await fetchSettings(channel);
        if (!settings.vapidPublicKey) throw new Error('Push delivery is not configured on this server.');
        const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
        if (permission !== 'granted') throw new Error('Allow notifications in your browser settings to enable push alerts.');
        const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
        const existing = await registration.pushManager.getSubscription();
        const subscription = existing || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidPublicKey(settings.vapidPublicKey),
        });
        const saved = await updatePreference(channel, subscription.toJSON(), true);
        setEnabled(saved.enabled);
      } else {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager.getSubscription();
        if (!subscription) {
          setEnabled(false);
          return;
        }
        const saved = await updatePreference(channel, subscription.toJSON(), false);
        setEnabled(saved.enabled);
      }
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Could not update notification settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
          {enabled ? <Bell size={18} /> : <BellOff size={18} />}
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900">{channelLabel} message notifications</p>
          <p className="mt-0.5 text-xs text-gray-500">Customer name and a short message preview on this device.</p>
          {error && <p role="status" className="mt-1 text-xs font-semibold text-amber-700">{error}</p>}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`${enabled ? 'Disable' : 'Enable'} ${channelLabel} message notifications on this device`}
        disabled={loading || saving || !supported}
        onClick={() => void toggle()}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${enabled ? 'bg-emerald-600' : 'bg-gray-300'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
      </button>
    </div>
  );
};

export default ChatPushToggle;