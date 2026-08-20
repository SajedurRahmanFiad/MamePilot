import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from './index';
import { useToastNotifications } from '../src/contexts/ToastContext';
import {
  checkShopifyWebhookHealth,
  deleteShopifyStore,
  fetchShopifyStores,
  registerShopifyWebhook,
  repairShopifyWebhook,
  saveShopifyStore,
  syncShopifyOrders,
  syncShopifyProducts,
  testShopifyStore,
} from '../src/services/supabaseQueries';
import type { CompanyPage, ShopifyStore } from '../types';
import { formatDateTime } from '../utils';

interface WebhookHealth {
  healthy: boolean;
  status: string;
  message: string;
}

type StoreDraft = ShopifyStore & { isNew?: boolean };
type StoreAction = 'test' | 'webhook' | 'products' | 'orders' | 'repair';

const blankStore = (companyPageId: string): StoreDraft => ({
  id: `new-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  storeName: '',
  storeUrl: '',
  accessToken: '',
  apiSecret: '',
  webhookBaseUrl: '',
  webhookUrl: '',
  companyPageId,
  enabled: true,
  productsSynced: 0,
  ordersSynced: 0,
  isNew: true,
});

const ShopifySettingsPanel: React.FC<{ companyPages: CompanyPage[] }> = ({ companyPages }) => {
  const toast = useToastNotifications();
  const queryClient = useQueryClient();
  const storesQuery = useQuery({
    queryKey: ['settings', 'shopify'],
    queryFn: fetchShopifyStores,
    staleTime: 30_000,
  });
  const [drafts, setDrafts] = useState<StoreDraft[]>([]);
  const [busyAction, setBusyAction] = useState('');
  const [webhookHealth, setWebhookHealth] = useState<Record<string, WebhookHealth>>({});

  useEffect(() => {
    if (storesQuery.data) setDrafts(storesQuery.data);
  }, [storesQuery.data]);

  const checkHealth = useCallback(async (storeId: string) => {
    try {
      const result = await checkShopifyWebhookHealth(storeId);
      setWebhookHealth((current) => ({ ...current, [storeId]: result }));
    } catch {
      setWebhookHealth((current) => ({ ...current, [storeId]: { healthy: false, status: 'check_failed', message: 'Could not check Shopify webhook health.' } }));
    }
  }, []);

  useEffect(() => {
    for (const store of storesQuery.data || []) {
      if (store.webhookId) checkHealth(store.id);
    }
  }, [storesQuery.data, checkHealth]);

  const pageOptions = useMemo(
    () => companyPages.map((page) => ({ value: page.id, label: page.name || 'Unnamed company' })),
    [companyPages],
  );

  const updateDraft = <K extends keyof StoreDraft>(id: string, field: K, value: StoreDraft[K]) => {
    setDrafts((current) => current.map((store) => (store.id === id ? { ...store, [field]: value } : store)));
  };

  const reload = async () => {
    await queryClient.invalidateQueries({ queryKey: ['settings', 'shopify'] });
  };

  const saveStore = async (draft: StoreDraft) => {
    setBusyAction(`save:${draft.id}`);
    const loadingId = toast.loading(draft.isNew ? 'Adding Shopify store...' : 'Saving Shopify store...');
    try {
      const saved = await saveShopifyStore({
        ...(draft.isNew ? {} : { id: draft.id }),
        storeName: draft.storeName,
        storeUrl: draft.storeUrl,
        accessToken: draft.accessToken,
        apiSecret: draft.apiSecret,
        webhookBaseUrl: draft.webhookBaseUrl,
        companyPageId: draft.companyPageId,
        enabled: draft.enabled,
      });
      setDrafts((current) => current.map((item) => (item.id === draft.id ? saved : item)));
      await reload();
      toast.update(loadingId, 'Shopify store saved.', 'success');
    } catch (error) {
      toast.update(loadingId, error instanceof Error ? error.message : 'Could not save the Shopify store.', 'error');
    } finally {
      setBusyAction('');
    }
  };

  const runStoreAction = async (store: StoreDraft, action: StoreAction, operation: () => Promise<{ message?: string }>) => {
    if (store.isNew) {
      toast.warning('Save this store before running Shopify actions.');
      return;
    }
    const labels: Record<StoreAction, string> = {
      test: 'Testing Shopify connection...',
      webhook: 'Turning on automatic Shopify sync...',
      products: 'Importing all Shopify products...',
      orders: 'Importing all Shopify orders...',
      repair: 'Repairing Shopify webhooks...',
    };
    setBusyAction(`${action}:${store.id}`);
    const loadingId = toast.loading(labels[action]);
    try {
      const result = await operation();
      await reload();
      if (action === 'webhook' || action === 'repair') checkHealth(store.id);
      toast.update(loadingId, result.message || 'Shopify action completed.', 'success');
    } catch (error) {
      toast.update(loadingId, error instanceof Error ? error.message : 'Shopify action failed.', 'error');
    } finally {
      setBusyAction('');
    }
  };

  const removeStore = async (store: StoreDraft) => {
    if (store.isNew) {
      setDrafts((current) => current.filter((item) => item.id !== store.id));
      return;
    }
    const confirmation = window.prompt(`This removes the store and its automatic webhooks. Type "${store.storeName}" to confirm.`);
    if (confirmation !== store.storeName) {
      if (confirmation !== null) toast.warning('Store name did not match. Nothing was removed.');
      return;
    }
    setBusyAction(`delete:${store.id}`);
    const loadingId = toast.loading('Removing Shopify store...');
    try {
      const result = await deleteShopifyStore(store.id);
      setDrafts((current) => current.filter((item) => item.id !== store.id));
      await reload();
      toast.update(loadingId, result.warning || 'Shopify store removed.', result.warning ? 'error' : 'success');
    } catch (error) {
      toast.update(loadingId, error instanceof Error ? error.message : 'Could not remove the Shopify store.', 'error');
    } finally {
      setBusyAction('');
    }
  };

  const addStore = () => {
    const defaultPage = companyPages.find((page) => page.isGlobalBranding) || companyPages[0];
    setDrafts((current) => [...current, blankStore(defaultPage?.id || '')]);
  };

  if (storesQuery.isPending) return <div className="py-16 text-center text-sm font-semibold text-gray-500">Loading Shopify connections...</div>;
  if (storesQuery.isError) return <div className="rounded-xl border border-red-100 bg-red-50 p-5 text-sm font-semibold text-red-700">{storesQuery.error instanceof Error ? storesQuery.error.message : 'Could not load Shopify connections.'}</div>;

  return (
    <div className="space-y-7 animate-in fade-in duration-300">
      <section className="flex flex-col gap-4 border-b border-gray-100 pb-5 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-xl font-bold text-gray-800">Shopify Sync</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500">Import products and orders, then keep new customers and orders flowing automatically through verified Shopify webhooks.</p>
        </div>
        <Button type="button" onClick={addStore} disabled={companyPages.length === 0}>Add Shopify Store</Button>
      </section>

      <section className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-5">
        <h4 className="text-sm font-black text-emerald-950">Setup guide</h4>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-emerald-900">
          <li>In Shopify Admin, go to Settings → Apps and sales channels → Develop apps.</li>
          <li>Grant <strong>read_products</strong>, <strong>read_orders</strong>, and <strong>read_customers</strong>. Grant <strong>read_all_orders</strong> if older history is required.</li>
          <li>Install the app, then copy both the <strong>Admin API access token</strong> and the app&apos;s <strong>API secret key</strong>.</li>
          <li>Enter the <code>my-store.myshopify.com</code> hostname and select the matching invoice company.</li>
          <li>Save and test the connection, import all products, import all orders, then turn on automatic sync.</li>
        </ol>
        <p className="mt-3 text-xs font-semibold text-emerald-800">Every variant becomes its own product — a T-shirt in red and blue imports as T-shirt (Red) and T-shirt (Blue) — using the variant image, price, and stock. Products match by exact SKU, or by the product handle when the SKU is missing. Customers match by normalized phone. Orders use customer phone plus the sorted SKU-and-quantity bundle as their duplicate key.</p>
      </section>

      {companyPages.length === 0 && <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm font-semibold text-amber-800">Add a company page first. Every Shopify store must map to a company for invoice branding.</div>}

      {drafts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 px-6 py-12 text-center">
          <p className="font-black text-gray-800">No Shopify store connected</p>
          <p className="mt-2 text-sm text-gray-500">Add your first store to import products and orders.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {drafts.map((store, index) => {
            const anyBusy = busyAction !== '';
            const health = webhookHealth[store.id];
            return (
              <article key={store.id} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-black uppercase tracking-widest text-gray-400">Store {index + 1}</p>
                    <h4 className="mt-1 text-lg font-black text-gray-900">{store.storeName || 'New Shopify store'}</h4>
                  </div>
                  <label className="inline-flex items-center gap-3 text-sm font-bold text-gray-700">
                    <input type="checkbox" checked={store.enabled} onChange={(event) => updateDraft(store.id, 'enabled', event.target.checked)} className="h-4 w-4 rounded border-gray-300" />
                    Automatic sync enabled
                  </label>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <Input label="Store name" value={store.storeName} onChange={(event) => updateDraft(store.id, 'storeName', event.target.value)} placeholder="Main Shopify Store" />
                  <Input label="Shopify store hostname" value={store.storeUrl} onChange={(event) => updateDraft(store.id, 'storeUrl', event.target.value)} placeholder="store.myshopify.com" />
                  <Input label="Admin API access token" type="password" value={store.accessToken} onChange={(event) => updateDraft(store.id, 'accessToken', event.target.value)} placeholder={store.accessTokenConfigured ? 'Saved — enter only to replace' : 'shpat_...'} autoComplete="new-password" />
                  <Input label="Shopify API secret key" type="password" value={store.apiSecret} onChange={(event) => updateDraft(store.id, 'apiSecret', event.target.value)} placeholder={store.apiSecretConfigured ? 'Saved — enter only to replace' : 'Paste the app API secret key'} autoComplete="new-password" helperText="Shopify uses this app client secret for webhook HMAC signatures." />
                  <div className="w-full">
                    <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-gray-500">Invoice company</label>
                    <select value={store.companyPageId} onChange={(event) => updateDraft(store.id, 'companyPageId', event.target.value)} className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-[#0f2f57] focus:ring-2 focus:ring-[#ebf4ff]">
                      <option value="">Select company</option>
                      {pageOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                  <Input label="Public delivery base URL" value={store.webhookBaseUrl} onChange={(event) => updateDraft(store.id, 'webhookBaseUrl', event.target.value)} placeholder="https://app.example.com/api" autoComplete="url" helperText="Must be public HTTPS. Use an HTTPS tunnel for local testing." />
                </div>

                {!store.isNew && (
                  <div className="mt-4 rounded-xl bg-gray-50 p-4">
                    <p className="text-xs font-black uppercase tracking-wider text-gray-400">Webhook delivery address</p>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <code className="min-w-0 flex-1 break-all rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">{store.webhookUrl}</code>
                      <Button type="button" variant="secondary" size="sm" onClick={async () => { await navigator.clipboard.writeText(store.webhookUrl); toast.success('Webhook address copied.'); }}>Copy</Button>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-gray-500">
                      <span>Automatic sync: {store.webhookSubscriptions?.length === 3 ? 'connected' : 'not fully connected'}</span>
                      <span>Products: {store.productsSynced}</span>
                      <span>Orders: {store.ordersSynced}</span>
                      <span>Last product import: {store.lastProductsSyncedAt ? formatDateTime(store.lastProductsSyncedAt) : 'never'}</span>
                      <span>Last order import: {store.lastOrdersSyncedAt ? formatDateTime(store.lastOrdersSyncedAt) : 'never'}</span>
                    </div>
                    {store.webhookId && health && <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold ${health.healthy ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}><span className={`inline-block h-2 w-2 rounded-full ${health.healthy ? 'bg-emerald-500' : 'bg-red-500'}`} />{health.message}</div>}
                    {store.lastSyncMessage && <p className={`mt-3 text-xs font-semibold ${store.lastSyncStatus === 'error' ? 'text-red-600' : 'text-gray-600'}`}>{store.lastSyncMessage}</p>}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button type="button" onClick={() => saveStore(store)} loading={busyAction === `save:${store.id}`} disabled={anyBusy || companyPages.length === 0}>Save Store</Button>
                  <Button type="button" variant="secondary" onClick={() => runStoreAction(store, 'test', () => testShopifyStore(store.id))} loading={busyAction === `test:${store.id}`} disabled={anyBusy || store.isNew}>Test Connection</Button>
                  <Button type="button" variant="secondary" onClick={() => runStoreAction(store, 'products', () => syncShopifyProducts(store.id))} loading={busyAction === `products:${store.id}`} disabled={anyBusy || store.isNew || !store.enabled}>Import All Products</Button>
                  <Button type="button" variant="secondary" onClick={() => runStoreAction(store, 'orders', () => syncShopifyOrders(store.id))} loading={busyAction === `orders:${store.id}`} disabled={anyBusy || store.isNew || !store.enabled}>Import All Orders</Button>
                  <Button type="button" variant="secondary" onClick={() => runStoreAction(store, 'webhook', async () => { await registerShopifyWebhook(store.id); return { message: 'Automatic customer and order sync turned on.' }; })} loading={busyAction === `webhook:${store.id}`} disabled={anyBusy || store.isNew || !store.enabled}>Turn On Automatic Sync</Button>
                  {store.webhookId && health && !health.healthy && <Button type="button" variant="secondary" onClick={() => runStoreAction(store, 'repair', () => repairShopifyWebhook(store.id))} loading={busyAction === `repair:${store.id}`} disabled={anyBusy}>Repair Webhooks</Button>}
                  <Button type="button" variant="danger" onClick={() => removeStore(store)} loading={busyAction === `delete:${store.id}`} disabled={anyBusy}>Remove</Button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ShopifySettingsPanel;
