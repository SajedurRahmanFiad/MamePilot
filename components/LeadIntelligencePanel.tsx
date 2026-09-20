import React from 'react';
import { Clipboard, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { useCapabilities } from '../src/hooks/useCapabilities';
import { useAnalyzeLead } from '../src/hooks/useMutations';
import { getBusinessTerminology } from '../src/utils/businessMode';
import type { Lead, LeadProfileJson } from '../types';

const label = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

const legacyProfileValues = (profile: LeadProfileJson) => {
  const identity = profile.identity as unknown;
  const values = Array.isArray(identity)
    ? identity.map((item) => item && typeof item === 'object' && 'value' in item ? String(item.value || '') : '').filter(Boolean)
    : [];
  return {
    name: Array.isArray(identity) ? values[0] : profile.identity?.name?.value,
    phone: Array.isArray(identity) ? values.find((value) => /^\+?[\d\s().-]{8,}$/.test(value)) : profile.identity?.phone?.value,
    address: Array.isArray(identity) ? values[2] : profile.identity?.address?.value,
    product: profile.interest?.[0]?.productName || (profile.interest?.[0] as { value?: string } | undefined)?.value,
  };
};

const LeadIntelligencePanel: React.FC<{ lead?: Lead; loading?: boolean; error?: string | null; onClose?: () => void; onSendSuggestion?: (suggestion: { id: string; text: string }) => void; onRefresh?: () => void; }> = ({ lead, loading, error, onClose, onSendSuggestion, onRefresh }) => {
  const { settings: capabilitySettings } = useCapabilities(Boolean(lead));
  const terminology = getBusinessTerminology(capabilitySettings?.businessMode);
  const profile: LeadProfileJson = lead?.profile || { schemaVersion: 1 };
  const profileValues = legacyProfileValues(profile);
  const analyze = useAnalyzeLead();
  const isConfirmed = lead?.status === 'confirmed' || profile.orderConfirmation?.status === 'confirmed';
  const copy = async (value: string) => { if (value) await navigator.clipboard?.writeText(value); };
  return <aside className="flex h-full w-[330px] shrink-0 flex-col border-l border-gray-200 bg-white shadow-sm max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-50 max-md:w-full">
    <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3"><div className="flex items-center gap-2"><Sparkles size={17} className="text-violet-600" /><div><p className="text-sm font-black text-gray-900">Lead intelligence</p><p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Internal AI coach</p></div></div><button type="button" onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100"><X size={16} /></button></div>
    {!lead && loading ? <div className="flex flex-1 items-center justify-center"><Loader2 className="animate-spin text-violet-600" /></div> : !lead && error ? <div className="p-5 text-sm font-semibold text-red-600">{error}</div> : !lead ? <div className="p-5 text-sm text-gray-500">Lead analysis is not available yet. Send a message in this conversation, then refresh.</div> : <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <button type="button" onClick={() => analyze.mutate({ leadId: lead.id })} disabled={loading || analyze.isPending} className="mb-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-3 py-2.5 text-xs font-black text-white disabled:opacity-50"><RefreshCw size={14} className={analyze.isPending ? 'animate-spin' : ''} /> Analyze lead</button>
      <div className="rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 p-4 text-white"><div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-white/70">Order probability</p><p className="mt-1 text-3xl font-black">{Math.round(lead.orderProbability)}%</p></div><div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-white/30 text-sm font-black" style={{ background: `conic-gradient(#fff ${lead.orderProbability * 3.6}deg, rgba(255,255,255,.18) 0deg)` }}><span className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-600">{Math.round(lead.orderProbability)}%</span></div></div><p className="mt-3 text-xs font-bold text-white/80">{label(lead.status)}</p></div>
      <section className="mt-5"><p className="text-xs font-black uppercase tracking-wider text-gray-400">Lead profile</p><div className="mt-2 space-y-2">{[['Name', profileValues.name || lead.name], ['Phone', profileValues.phone || lead.phone], ['Address', profileValues.address], [terminology.item, profileValues.product]].map(([title, value]) => <button type="button" key={title} onClick={() => copy(String(value || ''))} className="flex w-full items-start justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2.5 text-left hover:bg-gray-100"><span><span className="block text-[10px] font-black uppercase tracking-wider text-gray-400">{title}</span><span className="mt-1 block text-xs font-bold text-gray-800">{String(value || 'Not captured')}</span></span><Clipboard size={14} className="mt-1 shrink-0 text-gray-400" /></button>)}</div></section>
      <section className="mt-5"><p className="text-xs font-black uppercase tracking-wider text-gray-400">Notices</p><div className="mt-2 space-y-2">{(profile.analysis?.notices || []).map((notice: string) => <div key={notice} className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-2.5 text-xs font-semibold text-indigo-900">{notice}</div>)}{!(profile.analysis?.notices || []).length && <p className="text-xs text-gray-500">Analyzing the conversation…</p>}</div></section>
      {!isConfirmed && <section className="mt-5"><div className="flex items-center justify-between"><p className="text-xs font-black uppercase tracking-wider text-gray-400">Suggested replies</p><button type="button" onClick={onRefresh} className="text-[10px] font-black text-violet-600">Refresh</button></div><div className="mt-2 space-y-2">{(lead.suggestions || []).map((suggestion) => <button type="button" key={suggestion.id} disabled={loading} onClick={() => onSendSuggestion?.({ id: suggestion.id, text: suggestion.text })} className="w-full rounded-xl border border-violet-100 bg-violet-50 px-3 py-3 text-left transition hover:border-violet-300 hover:bg-violet-100 disabled:opacity-50"><p className="text-xs font-black text-violet-950">{suggestion.text}</p><p className="mt-1 text-[10px] text-violet-700">{suggestion.reason || 'Recommended next step'} · Click to send</p></button>)}{!(lead.suggestions || []).length && <p className="text-xs text-gray-500">Suggestions will appear after analysis.</p>}</div></section>}
      <section className="mt-5 border-t border-gray-100 pt-4"><p className="text-xs font-black uppercase tracking-wider text-gray-400">Missing information</p><p className="mt-2 text-xs font-semibold text-gray-700">{(profile.missingInformation || []).join(', ') || 'Nothing important is missing.'}</p></section>
    </div>}
  </aside>;
};

export default LeadIntelligencePanel;
