import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from './index';
import { useToastNotifications } from '../src/contexts/ToastContext';
import {
  deleteWooCommerceStore,
  fetchWooCommerceStores,
  registerWooCommerceWebhook,
  saveWooCommerceStore,
  syncWooCommerceOrders,
  testWooCommerceStore,
} from '../src/services/supabaseQueries';
import type { CompanyPage, WooCommerceStore } from '../types';
import { formatDateTime } from '../utils';

type StoreDraft = WooCommerceStore & { isNew?: boolean };

const blankStore = (companyPageId: string): StoreDraft => ({
  id: 'new-' + Date.now() + '-' + Math.random().toString(16).slice(2),
  storeName: '',
  storeUrl: '',
  consumerKey: '',
  consumerSecret: '',
  webhookSecret: '',
  webhookBaseUrl: '',
  webhookUrl: '',
  companyPageId,
  enabled: true,
  ordersSynced: 0,
  isNew: true,
});

const WooCommerceSettingsPanel: React.FC<{ companyPages: CompanyPage[] }> = ({ companyPages }) => {
  const toast = useToastNotifications();
  const queryClient = useQueryClient();
  const storesQuery = useQuery({
    queryKey: ['settings', 'woocommerce'],
    queryFn: fetchWooCommerceStores,
    staleTime: 30_000,
  });
  const [drafts, setDrafts] = useState<StoreDraft[]>([]);
  const [busyAction, setBusyAction] = useState('');

  useEffect(() => {
    if (storesQuery.data) setDrafts(storesQuery.data);
  }, [storesQuery.data]);

  const pageOptions = useMemo(
    () => companyPages.map((page) => ({ value: page.id, label: page.name || 'Unnamed company' })),
    [companyPages],
  );

  const updateDraft = <K extends keyof StoreDraft>(id: string, field: K, value: StoreDraft[K]) => {
    setDrafts((current) => current.map((store) => (store.id === id ? { ...store, [field]: value } : store)));
  };

  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: ['settings', 'woocommerce'] });
  };

  const saveStore = async (draft: StoreDraft) => {
    const action = 'save:' + draft.id;
    setBusyAction(action);
    const loadingId = toast.loading(draft.isNew ? 'Adding WooCommerce website...' : 'Saving WooCommerce website...');
    try {
      const saved = await saveWooCommerceStore({
        ...(draft.isNew ? {} : { id: draft.id }),
        storeName: draft.storeName,
        storeUrl: draft.storeUrl,
        consumerKey: draft.consumerKey,
        consumerSecret: draft.consumerSecret,
        webhookSecret: draft.webhookSecret,
        webhookBaseUrl: draft.webhookBaseUrl,
        companyPageId: draft.companyPageId,
        enabled: draft.enabled,
      });
      setDrafts((current) => current.map((item) => (item.id === draft.id ? saved : item)));
      await reload();
      toast.update(loadingId, 'WooCommerce website saved.', 'success');
    } catch (error) {
      toast.update(loadingId, error instanceof Error ? error.message : 'Could not save the WooCommerce website.', 'error');
    } finally {
      setBusyAction('');
    }
  };

  const runStoreAction = async (
    draft: StoreDraft,
    actionName: 'test' | 'webhook' | 'sync',
    operation: () => Promise<{ message?: string }>,
  ) => {
    if (draft.isNew) {
      toast.warning('Save this website before testing automatic order delivery or syncing orders.');
      return;
    }
    setBusyAction(actionName + ':' + draft.id);
    const labels = {
      test: 'Testing WooCommerce connection...',
      webhook: 'Turning on automatic order delivery...',
      sync: 'Syncing WooCommerce orders...',
    };
    const loadingId = toast.loading(labels[actionName]);
    try {
      const result = await operation();
      await reload();
      toast.update(loadingId, result.message || 'WooCommerce action completed.', 'success');
    } catch (error) {
      toast.update(loadingId, error instanceof Error ? error.message : 'WooCommerce action failed.', 'error');
    } finally {
      setBusyAction('');
    }
  };

  const removeStore = async (draft: StoreDraft) => {
    if (draft.isNew) {
      setDrafts((current) => current.filter((store) => store.id !== draft.id));
      return;
    }
    const confirmation = window.prompt(
      'This removes the website and its automatic order connection. Type "' + draft.storeName + '" to confirm.',
    );
    if (confirmation !== draft.storeName) {
      if (confirmation !== null) toast.warning('Website name did not match. Nothing was removed.');
      return;
    }

    setBusyAction('delete:' + draft.id);
    const loadingId = toast.loading('Removing WooCommerce website...');
    try {
      const result = await deleteWooCommerceStore(draft.id);
      setDrafts((current) => current.filter((store) => store.id !== draft.id));
      await reload();
      toast.update(loadingId, result.warning || 'WooCommerce website removed.', result.warning ? 'error' : 'success');
    } catch (error) {
      toast.update(loadingId, error instanceof Error ? error.message : 'Could not remove the WooCommerce website.', 'error');
    } finally {
      setBusyAction('');
    }
  };

  const addStore = () => {
    const defaultPage = companyPages.find((page) => page.isGlobalBranding) || companyPages[0];
    setDrafts((current) => [...current, blankStore(defaultPage?.id || '')]);
  };

  if (storesQuery.isPending) {
    return <div className="py-16 text-center text-sm font-semibold text-gray-500">Loading WooCommerce connections...</div>;
  }

  if (storesQuery.isError) {
    return (
      <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-sm font-semibold text-red-700">
        {storesQuery.error instanceof Error ? storesQuery.error.message : 'Could not load WooCommerce connections.'}
      </div>
    );
  }

  return (
    <div className="space-y-7 animate-in fade-in duration-300">
      <section className="flex flex-col gap-4 border-b border-gray-100 pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-xl font-bold text-gray-800">WooCommerce Order Sync</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">
            Connect multiple WooCommerce websites. New orders arrive automatically through a secure connection and are
            assigned to the selected company so invoices use the correct branding.
          </p>
        </div>
        <Button type="button" onClick={addStore} disabled={companyPages.length === 0}>Add Website</Button>
      </section>

      <section className="rounded-xl border border-blue-100 bg-blue-50/70 p-5">
        <h4 className="text-sm font-black text-blue-950">Setup guide</h4>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-blue-900">
          <li>In WordPress, open WooCommerce → Settings → Advanced → REST API and choose Add key.</li>
          <li>Give the key Read/Write permission. Copy its consumer key and consumer secret into the website below.</li>
          <li>Set Public delivery base URL to your live MamePilot API folder, for example https://app.example.com/api. For local testing, use an HTTPS tunnel; WooCommerce cannot deliver to localhost.</li>
          <li>Save the website, use Test Connection, then click Turn On Automatic Orders. MamePilot creates and maintains the secure order connection for you.</li>
          <li>Use Sync Existing Orders once if you also want older WooCommerce orders. Repeated syncs are safe and do not create duplicates.</li>
        </ol>
        <p className="mt-3 text-xs font-semibold text-blue-800">
          Customer matching uses the normalized billing phone. A match keeps the same customer record but replaces its
          name and address with the WooCommerce values; otherwise a new customer is created.
        </p>
      </section>

      {companyPages.length === 0 && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
          Add a company page first. Every WooCommerce website must map to a company for invoice branding.
        </div>
      )}

      {drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-6 py-12 text-center">
          <p className="font-black text-gray-800">No WooCommerce website connected</p>
          <p className="mt-2 text-sm text-gray-500">Add your first website to start receiving orders.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {drafts.map((store, index) => {
            const anyBusy = busyAction !== '';
            return (
              <article key={store.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-gray-400">Website {index + 1}</p>
                    <h4 className="mt-1 text-lg font-black text-gray-900">{store.storeName || 'New WooCommerce website'}</h4>
                  </div>
                  <label className="inline-flex items-center gap-3 text-sm font-bold text-gray-700">
                    <input
                      type="checkbox"
                      checked={store.enabled}
                      onChange={(event) => updateDraft(store.id, 'enabled', event.target.checked)}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    Automatic sync enabled
                  </label>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <Input label="Website name" value={store.storeName} onChange={(event) => updateDraft(store.id, 'storeName', event.target.value)} placeholder="Main online shop" />
                  <Input label="WooCommerce website URL" value={store.storeUrl} onChange={(event) => updateDraft(store.id, 'storeUrl', event.target.value)} placeholder="https://shop.example.com" />
                  <Input label="Consumer key" value={store.consumerKey} onChange={(event) => updateDraft(store.id, 'consumerKey', event.target.value)} placeholder="ck_..." autoComplete="off" />
                  <Input label="Consumer secret" type="password" value={store.consumerSecret} onChange={(event) => updateDraft(store.id, 'consumerSecret', event.target.value)} placeholder="cs_..." autoComplete="new-password" />
                  <div className="w-full">
                    <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">Invoice company</label>
                    <select
                      value={store.companyPageId}
                      onChange={(event) => updateDraft(store.id, 'companyPageId', event.target.value)}
                      className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#0f2f57] focus:ring-2 focus:ring-[#ebf4ff]"
                    >
                      <option value="">Select company</option>
                      {pageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                  <Input
                    label="Order connection security key"
                    type="password"
                    value={store.webhookSecret}
                    onChange={(event) => updateDraft(store.id, 'webhookSecret', event.target.value)}
                    placeholder="Generated automatically when empty"
                    autoComplete="new-password"
                    helperText="Leave empty on first save to generate a secure secret."
                  />
                  <Input
                    label="Public delivery base URL"
                    value={store.webhookBaseUrl}
                    onChange={(event) => updateDraft(store.id, 'webhookBaseUrl', event.target.value)}
                    placeholder="https://app.example.com/api"
                    autoComplete="url"
                    helperText="Must be public HTTPS. Use an HTTPS tunnel while developing locally."
                  />
                </div>

                {!store.isNew && (
                  <div className="mt-4 rounded-xl bg-gray-50 p-4">
                    <p className="text-xs font-black uppercase tracking-wider text-gray-400">Order delivery address</p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <code className="min-w-0 flex-1 break-all rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">{store.webhookUrl}</code>
                      <Button type="button" variant="secondary" size="sm" onClick={async () => {
                        await navigator.clipboard.writeText(store.webhookUrl);
                        toast.success('Order delivery address copied.');
                      }}>Copy</Button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-gray-500">
                      <span>Automatic orders: {store.webhookId ? 'connected' : 'not connected'}</span>
                      <span>Imported: {store.ordersSynced} orders</span>
                      <span>Last sync: {store.lastSyncedAt ? formatDateTime(store.lastSyncedAt) : 'never'}</span>
                    </div>
                    {store.lastSyncMessage && (
                      <p className={'mt-3 text-xs font-semibold ' + (store.lastSyncStatus === 'error' ? 'text-red-600' : 'text-gray-600')}>{store.lastSyncMessage}</p>
                    )}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button type="button" onClick={() => saveStore(store)} loading={busyAction === 'save:' + store.id} disabled={anyBusy || companyPages.length === 0}>Save Website</Button>
                  <Button type="button" variant="secondary" onClick={() => runStoreAction(store, 'test', () => testWooCommerceStore(store.id))} loading={busyAction === 'test:' + store.id} disabled={anyBusy || store.isNew}>Test Connection</Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => runStoreAction(store, 'webhook', async () => {
                      await registerWooCommerceWebhook(store.id);
                      return { message: 'Automatic order delivery turned on.' };
                    })}
                    loading={busyAction === 'webhook:' + store.id}
                    disabled={anyBusy || store.isNew || !store.enabled}
                  >Turn On Automatic Orders</Button>
                  <Button type="button" variant="secondary" onClick={() => runStoreAction(store, 'sync', () => syncWooCommerceOrders(store.id))} loading={busyAction === 'sync:' + store.id} disabled={anyBusy || store.isNew || !store.enabled}>Sync Existing Orders</Button>
                  <Button type="button" variant="danger" onClick={() => removeStore(store)} loading={busyAction === 'delete:' + store.id} disabled={anyBusy}>Remove</Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default WooCommerceSettingsPanel;
