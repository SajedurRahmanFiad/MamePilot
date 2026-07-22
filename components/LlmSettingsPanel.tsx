import React, { useEffect, useMemo, useState } from 'react';
import { Button, LoadingOverlay } from '.';
import type { LlmConfiguration, LlmFeatureKey, LlmProvider, LlmSettings } from '../types';
import { useLlmSettings } from '../src/hooks/useQueries';
import { useUpdateLlmSettings } from '../src/hooks/useMutations';
import { discoverLlmModels } from '../src/services/supabaseQueries';
import { useToastNotifications } from '../src/contexts/ToastContext';

const PROVIDERS: Array<{ id: LlmProvider; label: string; baseUrl: string; note: string }> = [
  { id: 'google', label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com', note: 'Uses an AI Studio or Google Cloud API key with the Gemini generateContent API.' },
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', note: 'Organization and project headers are optional; add them only when your OpenAI account requires them.' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', note: 'Site URL and app name are optional attribution headers recommended by OpenRouter.' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', note: 'Uses Groq’s OpenAI-compatible API. Choose a chat-capable model returned by the account.' },
  { id: 'anthropic', label: 'Anthropic', baseUrl: 'https://api.anthropic.com', note: 'Anthropic requires both x-api-key and an API version header; the stable default version is filled in.' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', note: 'Uses DeepSeek’s OpenAI-compatible chat API and Bearer authentication.' },
];

const FEATURE_DETAILS: Array<{ key: LlmFeatureKey; label: string; description: string }> = [
  { key: 'information_extraction', label: 'Information extraction', description: 'Extracts customer and vendor name, Bangladesh phone, and address for Be smart.' },
  { key: 'mame_ai', label: 'Mame AI', description: 'Plans read-only data queries and writes the answer shown in Mame AI.' },
  { key: 'business_growth', label: 'Grow Your Business', description: 'Analyzes business summaries and produces growth recommendations.' },
];

const EMPTY_SETTINGS: LlmSettings = {
  configurations: [],
  assignments: { information_extraction: null, mame_ai: null, business_growth: null },
};

const createId = () => `llm-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const newConfiguration = (): LlmConfiguration => ({
  id: createId(),
  label: '',
  provider: 'openai',
  enabled: true,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: '',
  organization: '',
  project: '',
  siteUrl: '',
  appName: 'MamePilot',
  anthropicVersion: '2023-06-01',
});

const inputClass = 'w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-800 outline-none transition focus:border-[#3c5a82] focus:bg-white focus:ring-2 focus:ring-[#3c5a82]/10';

const LlmSettingsPanel: React.FC = () => {
  const toast = useToastNotifications();
  const { data, isPending } = useLlmSettings(true);
  const updateSettings = useUpdateLlmSettings();
  const [form, setForm] = useState<LlmSettings>(EMPTY_SETTINGS);
  const [modelsById, setModelsById] = useState<Record<string, string[]>>({});
  const [loadingModelsId, setLoadingModelsId] = useState<string | null>(null);
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const selectableConfigurations = useMemo(
    () => form.configurations.filter((configuration) => configuration.enabled && configuration.model.trim()),
    [form.configurations],
  );

  const patchConfiguration = (id: string, updates: Partial<LlmConfiguration>) => {
    setForm((current) => ({
      ...current,
      configurations: current.configurations.map((configuration) => configuration.id === id ? { ...configuration, ...updates } : configuration),
    }));
  };

  const changeProvider = (configuration: LlmConfiguration, provider: LlmProvider) => {
    const definition = PROVIDERS.find((item) => item.id === provider)!;
    patchConfiguration(configuration.id, {
      provider,
      baseUrl: definition.baseUrl,
      model: '',
      organization: '',
      project: '',
      siteUrl: '',
      appName: provider === 'openrouter' ? 'MamePilot' : '',
      anthropicVersion: '2023-06-01',
    });
    setModelsById((current) => ({ ...current, [configuration.id]: [] }));
  };

  const removeConfiguration = (id: string) => {
    setForm((current) => ({
      configurations: current.configurations.filter((configuration) => configuration.id !== id),
      assignments: Object.fromEntries(
        Object.entries(current.assignments).map(([feature, selected]) => [feature, selected === id ? null : selected]),
      ) as LlmSettings['assignments'],
    }));
  };

  const loadModels = async (configuration: LlmConfiguration) => {
    setLoadingModelsId(configuration.id);
    try {
      const result = await discoverLlmModels(configuration);
      setModelsById((current) => ({ ...current, [configuration.id]: result.models }));
      if (result.models.length === 0) toast.warning('The provider returned no compatible models. You can still enter a model id manually.');
      else toast.success(`Loaded ${result.models.length} models from ${PROVIDERS.find((item) => item.id === configuration.provider)?.label}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load models from this provider.');
    } finally {
      setLoadingModelsId(null);
    }
  };

  const save = async () => {
    const toastId = toast.loading('Saving LLM profiles and feature assignments...');
    try {
      const saved = await updateSettings.mutateAsync(form);
      setForm(saved);
      toast.update(toastId, 'LLM settings saved.', 'success');
    } catch (error) {
      toast.update(toastId, error instanceof Error ? error.message : 'Could not save LLM settings.', 'error');
    }
  };

  return (
    <div className="relative space-y-8 animate-in fade-in duration-300">
      <LoadingOverlay isLoading={isPending || updateSettings.isPending} message="Loading LLM settings..." />

      <section className="space-y-5">
        <div className="flex flex-col gap-3 border-b border-gray-100 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-xl font-black text-gray-900">Feature model assignments</h3>
            <p className="mt-1 max-w-3xl text-sm font-medium text-gray-500">Each AI feature uses exactly one enabled model profile. Credentials stay on the server and are never exposed to customer or vendor forms.</p>
          </div>
          <Button onClick={save} variant="primary" disabled={updateSettings.isPending}>Save LLM Settings</Button>
        </div>
        <div className="grid gap-4">
          {FEATURE_DETAILS.map((feature) => (
            <div key={feature.key} className="grid gap-3 rounded-2xl border border-gray-100 bg-gray-50/70 p-5 md:grid-cols-[1fr_minmax(260px,420px)] md:items-center">
              <div>
                <p className="font-black text-gray-900">{feature.label}</p>
                <p className="mt-1 text-sm font-medium text-gray-500">{feature.description}</p>
              </div>
              <select
                className={inputClass}
                value={form.assignments[feature.key] || ''}
                onChange={(event) => setForm((current) => ({ ...current, assignments: { ...current.assignments, [feature.key]: event.target.value || null } }))}
              >
                <option value="">Not assigned</option>
                {selectableConfigurations.map((configuration) => (
                  <option key={configuration.id} value={configuration.id}>{configuration.label || 'Unnamed profile'} — {configuration.provider} / {configuration.model}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex flex-col gap-3 border-b border-gray-100 pb-5 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="text-xl font-black text-gray-900">Model API profiles</h3>
            <p className="mt-1 text-sm font-medium text-gray-500">Add multiple keys or models from the same provider when different features need different cost, speed, or privacy profiles.</p>
          </div>
          <Button onClick={() => setForm((current) => ({ ...current, configurations: [...current.configurations, newConfiguration()] }))} variant="secondary">Add Model API</Button>
        </div>

        {form.configurations.length === 0 && (
          <div className="rounded-2xl border-2 border-dashed border-gray-200 px-6 py-12 text-center">
            <p className="font-black text-gray-800">No model APIs have been added yet.</p>
            <p className="mt-1 text-sm font-medium text-gray-500">Add one, load its available models, then assign it to a feature above.</p>
          </div>
        )}

        <div className="space-y-6">
          {form.configurations.map((configuration, index) => {
            const provider = PROVIDERS.find((item) => item.id === configuration.provider)!;
            const modelOptions = modelsById[configuration.id] || [];
            return (
              <article key={configuration.id} className="space-y-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eef4fb] text-sm font-black text-[#0f2f57]">{index + 1}</span>
                    <div>
                      <p className="font-black text-gray-900">{configuration.label || 'New model API'}</p>
                      <p className="text-xs font-bold uppercase tracking-wider text-gray-400">{provider.label}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-gray-600">
                      <input type="checkbox" checked={configuration.enabled} onChange={(event) => patchConfiguration(configuration.id, { enabled: event.target.checked })} className="h-4 w-4 rounded text-[#3c5a82]" />
                      Enabled
                    </label>
                    <Button onClick={() => removeConfiguration(configuration.id)} variant="danger" size="sm">Remove</Button>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-xs font-black uppercase tracking-widest text-gray-400">Profile name</span>
                    <input className={inputClass} value={configuration.label} onChange={(event) => patchConfiguration(configuration.id, { label: event.target.value })} placeholder="e.g. Fast extraction model" />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs font-black uppercase tracking-widest text-gray-400">Provider</span>
                    <select className={inputClass} value={configuration.provider} onChange={(event) => changeProvider(configuration, event.target.value as LlmProvider)}>
                      {PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    </select>
                  </label>
                </div>

                <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">{provider.note}</div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2 md:col-span-2">
                    <span className="text-xs font-black uppercase tracking-widest text-gray-400">Base URL</span>
                    <input className={inputClass} value={configuration.baseUrl} onChange={(event) => patchConfiguration(configuration.id, { baseUrl: event.target.value })} />
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs font-black uppercase tracking-widest text-gray-400">API key</span>
                    <div className="flex gap-2">
                      <input className={inputClass} type={visibleKeys[configuration.id] ? 'text' : 'password'} value={configuration.apiKey} onChange={(event) => patchConfiguration(configuration.id, { apiKey: event.target.value })} autoComplete="new-password" placeholder="Paste API key" />
                      <button type="button" className="rounded-xl border border-gray-200 px-4 text-xs font-black text-gray-500 hover:bg-gray-50" onClick={() => setVisibleKeys((current) => ({ ...current, [configuration.id]: !current[configuration.id] }))}>{visibleKeys[configuration.id] ? 'Hide' : 'Show'}</button>
                    </div>
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs font-black uppercase tracking-widest text-gray-400">Model</span>
                    <div className="flex gap-2">
                      <input className={inputClass} list={`models-${configuration.id}`} value={configuration.model} onChange={(event) => patchConfiguration(configuration.id, { model: event.target.value })} placeholder="Enter or load a model id" />
                      <button type="button" className="whitespace-nowrap rounded-xl border border-gray-200 px-4 text-xs font-black text-gray-600 hover:bg-gray-50 disabled:opacity-50" disabled={loadingModelsId === configuration.id || !configuration.apiKey.trim()} onClick={() => loadModels(configuration)}>{loadingModelsId === configuration.id ? 'Loading...' : 'Load models'}</button>
                    </div>
                    <datalist id={`models-${configuration.id}`}>{modelOptions.map((model) => <option key={model} value={model} />)}</datalist>
                    {modelOptions.length > 0 && <span className="block text-xs font-semibold text-emerald-600">{modelOptions.length} models available. Start typing to filter.</span>}
                  </label>
                </div>

                {configuration.provider === 'openai' && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2"><span className="text-xs font-black uppercase tracking-widest text-gray-400">Organization ID (optional)</span><input className={inputClass} value={configuration.organization || ''} onChange={(event) => patchConfiguration(configuration.id, { organization: event.target.value })} placeholder="org_..." /></label>
                    <label className="space-y-2"><span className="text-xs font-black uppercase tracking-widest text-gray-400">Project ID (optional)</span><input className={inputClass} value={configuration.project || ''} onChange={(event) => patchConfiguration(configuration.id, { project: event.target.value })} placeholder="proj_..." /></label>
                  </div>
                )}
                {configuration.provider === 'openrouter' && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="space-y-2"><span className="text-xs font-black uppercase tracking-widest text-gray-400">Site URL (optional)</span><input className={inputClass} value={configuration.siteUrl || ''} onChange={(event) => patchConfiguration(configuration.id, { siteUrl: event.target.value })} placeholder="https://your-domain.com" /></label>
                    <label className="space-y-2"><span className="text-xs font-black uppercase tracking-widest text-gray-400">App name (optional)</span><input className={inputClass} value={configuration.appName || ''} onChange={(event) => patchConfiguration(configuration.id, { appName: event.target.value })} placeholder="MamePilot" /></label>
                  </div>
                )}
                {configuration.provider === 'anthropic' && (
                  <label className="block space-y-2"><span className="text-xs font-black uppercase tracking-widest text-gray-400">Anthropic API version</span><input className={`${inputClass} max-w-md`} value={configuration.anthropicVersion || '2023-06-01'} onChange={(event) => patchConfiguration(configuration.id, { anthropicVersion: event.target.value })} /></label>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default LlmSettingsPanel;
