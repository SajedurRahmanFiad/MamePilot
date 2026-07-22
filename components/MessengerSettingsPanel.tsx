import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clipboard, ExternalLink, Facebook, Plus, Trash2 } from 'lucide-react';
import { Button } from './index';
import { useMessengerProfile, useMessengerSettings } from '../src/hooks/useQueries';
import {
  useSubscribeMessengerPage,
  useTestMessengerConnection,
  useUpdateMessengerProfile,
  useUpdateMessengerSettings,
} from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import type { MessengerProfileSettings, MessengerSettings } from '../types';

const EMPTY_SETTINGS: MessengerSettings = {
  pageAccessToken: '',
  pageId: '',
  verifyToken: '',
  appSecret: '',
  graphVersion: 'v25.0',
  pageName: '',
  pageUsername: '',
  pagePictureUrl: '',
  humanAgentEnabled: false,
  webhookUrl: '',
  configured: false,
  webhookConfigured: false,
  subscribed: false,
  subscribedFields: [],
};

const EMPTY_PROFILE: MessengerProfileSettings = { greeting: '', getStartedEnabled: false, iceBreakers: [] };

const MessengerSettingsPanel: React.FC = () => {
  const toast = useToastNotifications();
  const { data, isPending, error } = useMessengerSettings(true);
  const { data: profileData, isPending: profilePending } = useMessengerProfile(true);
  const saveSettings = useUpdateMessengerSettings();
  const testConnection = useTestMessengerConnection();
  const subscribePage = useSubscribeMessengerPage();
  const saveProfile = useUpdateMessengerProfile();
  const [settings, setSettings] = useState<MessengerSettings>(EMPTY_SETTINGS);
  const [profile, setProfile] = useState<MessengerProfileSettings>(EMPTY_PROFILE);

  useEffect(() => { if (data) setSettings(data); }, [data]);
  useEffect(() => { if (profileData) setProfile(profileData); }, [profileData]);

  const setField = <K extends keyof MessengerSettings>(key: K, value: MessengerSettings[K]) => setSettings((current) => ({ ...current, [key]: value }));

  const handleSave = async () => {
    const toastId = toast.loading('Saving Messenger settings...');
    try {
      const saved = await saveSettings.mutateAsync(settings);
      setSettings(saved);
      toast.update(toastId, 'Messenger settings saved.', 'success');
    } catch (saveError) {
      toast.update(toastId, saveError instanceof Error ? saveError.message : 'Could not save Messenger settings.', 'error');
    }
  };

  const handleTest = async () => {
    const toastId = toast.loading('Connecting to the Facebook Page...');
    try {
      const result = await testConnection.mutateAsync();
      toast.update(toastId, `Connected to ${result.pageName || 'Facebook Page'}.`, 'success');
    } catch (testError) {
      toast.update(toastId, testError instanceof Error ? testError.message : 'Messenger connection test failed.', 'error');
    }
  };

  const handleSubscribe = async () => {
    const toastId = toast.loading('Turning on Page message delivery...');
    try {
      const result = await subscribePage.mutateAsync();
      toast.update(toastId, result.subscribed ? 'Page message delivery is active.' : 'Page messages could not be turned on. Check the saved details and try again.', result.subscribed ? 'success' : 'error');
    } catch (subscribeError) {
      toast.update(toastId, subscribeError instanceof Error ? subscribeError.message : 'Could not turn on Page messages. Check the saved details and try again.', 'error');
    }
  };

  const handleSaveProfile = async () => {
    const toastId = toast.loading('Saving the Messenger welcome experience...');
    try {
      const saved = await saveProfile.mutateAsync(profile);
      setProfile(saved);
      toast.update(toastId, 'Messenger welcome experience updated.', 'success');
    } catch (profileError) {
      toast.update(toastId, profileError instanceof Error ? profileError.message : 'Could not update the Messenger welcome experience.', 'error');
    }
  };

  const copyWebhook = async () => {
    try { await navigator.clipboard.writeText(settings.webhookUrl); toast.success('Message delivery address copied.'); }
    catch { toast.error('Could not copy the message delivery address. Please try again.'); }
  };

  if (isPending) return <div className="py-16 text-center text-sm font-medium text-gray-500">Loading Messenger settings...</div>;
  if (error) return <div className="rounded-2xl border border-red-100 bg-red-50 p-5 text-sm font-semibold text-red-700">{error.message}</div>;

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <section className="space-y-6">
        <div className="flex flex-col gap-4 border-b border-gray-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#0866ff] text-white"><Facebook size={24} /></div>
            <div>
              <h3 className="text-xl font-bold text-gray-800">Facebook Page Messenger</h3>
              <p className="mt-2 max-w-3xl text-sm text-gray-500">Connect one Facebook Page to the shared Messenger inbox. Daily users will only see the familiar inbox; connection details stay here.</p>
            </div>
          </div>
          <Button type="button" onClick={handleSave} loading={saveSettings.isPending}>Save Messenger</Button>
        </div>

        {settings.configured && (
          <div className="flex flex-col gap-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-5 sm:flex-row sm:items-center">
            {settings.pagePictureUrl ? <img src={settings.pagePictureUrl} alt="Facebook Page" className="h-14 w-14 rounded-full object-cover" /> : <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#0866ff] text-white"><Facebook size={24} /></div>}
            <div className="min-w-0 flex-1">
              <p className="truncate font-black text-blue-950">{settings.pageName || 'Facebook Page'}</p>
              <p className="mt-1 text-sm font-medium text-blue-700">{settings.pageUsername ? `@${settings.pageUsername}` : `Page ${settings.pageId}`}</p>
            </div>
            <span className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-black ${settings.subscribed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
              <CheckCircle2 size={14} /> {settings.subscribed ? 'Messages active' : 'Subscription needed'}
            </span>
          </div>
        )}

        <div className="grid gap-5 lg:grid-cols-2">
          <label className="space-y-2 text-sm font-bold text-gray-700">
            <span>Page ID</span>
            <input value={settings.pageId} onChange={(event) => setField('pageId', event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 font-medium outline-none focus:border-[#0866ff]" placeholder="Facebook Page ID" />
          </label>
          <label className="space-y-2 text-sm font-bold text-gray-700">
            <span>Page access token</span>
            <input type="password" value={settings.pageAccessToken} onChange={(event) => setField('pageAccessToken', event.target.value)} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 font-medium outline-none focus:border-[#0866ff]" placeholder="Permanent Page access token" />
          </label>
        </div>

        <details className="rounded-2xl border border-gray-200 bg-gray-50/60 p-5">
          <summary className="cursor-pointer text-sm font-black text-gray-800">Advanced connection details</summary>
          <p className="mt-2 text-sm text-gray-500">Meta uses these details to deliver new Page messages securely.</p>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <label className="space-y-2 text-sm font-bold text-gray-700"><span>Security code (Verify token in Meta)</span><input type="password" value={settings.verifyToken} onChange={(event) => setField('verifyToken', event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-medium outline-none focus:border-[#0866ff]" /></label>
            <label className="space-y-2 text-sm font-bold text-gray-700"><span>Meta App Secret</span><input type="password" value={settings.appSecret} onChange={(event) => setField('appSecret', event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-medium outline-none focus:border-[#0866ff]" /></label>
            <label className="space-y-2 text-sm font-bold text-gray-700"><span>Connection version</span><input value={settings.graphVersion} onChange={(event) => setField('graphVersion', event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-medium outline-none focus:border-[#0866ff]" /></label>
          </div>
        </details>

        <label className="flex items-start gap-3 rounded-2xl border border-gray-200 p-4">
          <input type="checkbox" checked={settings.humanAgentEnabled} onChange={(event) => setField('humanAgentEnabled', event.target.checked)} className="mt-1 h-4 w-4 accent-[#0866ff]" />
          <span><span className="block text-sm font-black text-gray-800">Allow support follow-up for up to 7 days</span><span className="mt-1 block text-sm text-gray-500">Uses Meta's Human Agent access for genuine support replies after the normal 24-hour window. Your Meta app must be approved for it.</span></span>
        </label>

        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="outline" onClick={handleTest} loading={testConnection.isPending}>Test connection</Button>
          <Button type="button" onClick={handleSubscribe} loading={subscribePage.isPending} disabled={!settings.webhookConfigured}>Turn on Page messages</Button>
        </div>
      </section>

      <section className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5">
        <h4 className="font-black text-blue-950">Message delivery address</h4>
        <p className="mt-1 text-sm text-blue-700">Copy this address into the Messenger section of your Meta app, then turn on message delivery.</p>
        <div className="mt-4 flex gap-2"><input readOnly value={settings.webhookUrl} className="min-w-0 flex-1 rounded-xl border border-blue-200 bg-white px-3 py-2.5 text-sm font-medium" /><Button type="button" variant="outline" onClick={copyWebhook} aria-label="Copy message delivery address"><Clipboard size={17} /></Button></div>
      </section>

      <section className="space-y-5 border-t border-gray-100 pt-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div><h4 className="text-lg font-black text-gray-900">Welcome experience</h4><p className="mt-1 text-sm text-gray-500">Friendly first-touch options shown inside Messenger before a customer starts chatting.</p></div>
          <Button type="button" variant="outline" onClick={handleSaveProfile} loading={saveProfile.isPending} disabled={profilePending || !settings.configured}>Save welcome experience</Button>
        </div>
        <label className="block space-y-2 text-sm font-bold text-gray-700"><span>Greeting</span><textarea value={profile.greeting} maxLength={160} onChange={(event) => setProfile((current) => ({ ...current, greeting: event.target.value }))} rows={3} className="w-full rounded-xl border border-gray-200 px-3 py-2.5 font-medium outline-none focus:border-[#0866ff]" placeholder="Hi! How can we help you today?" /><span className="block text-right text-xs font-medium text-gray-400">{profile.greeting.length}/160</span></label>
        <label className="flex items-start gap-3 rounded-xl bg-gray-50 p-4"><input type="checkbox" checked={profile.getStartedEnabled} onChange={(event) => setProfile((current) => ({ ...current, getStartedEnabled: event.target.checked }))} className="mt-1 h-4 w-4 accent-[#0866ff]" /><span><span className="block text-sm font-black text-gray-800">Show Get Started</span><span className="mt-1 block text-sm text-gray-500">Lets new customers begin the conversation with one tap.</span></span></label>
        <div>
          <div className="flex items-center justify-between"><div><p className="text-sm font-black text-gray-800">Conversation starters</p><p className="mt-1 text-sm text-gray-500">Up to four common questions.</p></div><button type="button" disabled={profile.iceBreakers.length >= 4} onClick={() => setProfile((current) => ({ ...current, iceBreakers: [...current.iceBreakers, ''] }))} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-black text-[#0866ff] hover:bg-blue-50 disabled:opacity-40"><Plus size={16} /> Add</button></div>
          <div className="mt-3 space-y-3">{profile.iceBreakers.map((question, index) => <div key={index} className="flex gap-2"><input value={question} maxLength={80} onChange={(event) => setProfile((current) => ({ ...current, iceBreakers: current.iceBreakers.map((item, itemIndex) => itemIndex === index ? event.target.value : item) }))} className="min-w-0 flex-1 rounded-xl border border-gray-200 px-3 py-2.5 text-sm font-medium outline-none focus:border-[#0866ff]" placeholder="Where is my order?" /><button type="button" onClick={() => setProfile((current) => ({ ...current, iceBreakers: current.iceBreakers.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded-xl p-3 text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={17} /></button></div>)}</div>
        </div>
      </section>

      <a href="https://developers.facebook.com/docs/messenger-platform/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 hover:text-blue-900">Meta Messenger Platform documentation <ExternalLink size={15} /></a>
    </div>
  );
};

export default MessengerSettingsPanel;
