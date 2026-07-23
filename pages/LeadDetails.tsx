import React from 'react';
import { ArrowLeft, Clipboard, Loader2, RefreshCw } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useLead, useLeadIntelligence } from '../src/hooks/useQueries';
import { useAnalyzeLead } from '../src/hooks/useMutations';

const LeadDetails: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const leadQuery = useLead(id, true);
  const intelligenceQuery = useLeadIntelligence({ leadId: id }, Boolean(id));
  const analyze = useAnalyzeLead();
  const lead = intelligenceQuery.data || leadQuery.data;
  const profile = lead?.profile || {};
  const copy = async (value: string) => { if (value) await navigator.clipboard?.writeText(value); };
  if (leadQuery.isPending && !lead) return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-indigo-600" /></div>;
  if (!lead) return <div className="rounded-2xl bg-white p-8 text-center text-sm font-bold text-gray-500">Lead not found.</div>;
  return <div className="space-y-5">
    <button type="button" onClick={() => navigate((location.state as any)?.from || '/leads')} className="inline-flex items-center gap-2 text-sm font-black text-indigo-600"><ArrowLeft size={16} /> Back to leads</button>
    <div className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-sm md:flex-row md:items-center md:justify-between"><div><h1 className="text-2xl font-black text-gray-900">{lead.name}</h1><p className="mt-1 text-sm text-gray-500">{lead.sourceChannel} {lead.phone && `· ${lead.phone}`}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-purple-50 px-3 py-2 text-sm font-black text-purple-700">{Math.round(lead.orderProbability)}% order chance</span><button type="button" onClick={() => analyze.mutate({ leadId: lead.id })} disabled={analyze.isPending} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-black text-white disabled:opacity-50"><RefreshCw size={16} className={analyze.isPending ? 'animate-spin' : ''} /> Analyze</button></div></div>
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]"><section className="space-y-5 rounded-3xl bg-white p-6 shadow-sm"><div className="flex items-center justify-between"><h2 className="text-lg font-black text-gray-900">Lead profile</h2><button type="button" onClick={() => copy(JSON.stringify(profile, null, 2))} className="inline-flex items-center gap-2 rounded-xl bg-gray-100 px-3 py-2 text-xs font-black text-gray-700"><Clipboard size={14} /> Copy JSON</button></div><div className="grid gap-4 md:grid-cols-2">{[['Name', profile.identity?.name?.value], ['Phone', profile.identity?.phone?.value || lead.phone], ['Address', profile.identity?.address?.value], ['Product', profile.interest?.[0]?.productName], ['Next action', profile.recommendation?.nextAction], ['Missing', (profile.missingInformation || []).join(', ') || 'None detected']].map(([title, value]) => <button type="button" key={title} onClick={() => copy(String(value || ''))} className="rounded-2xl border border-gray-100 bg-gray-50 p-4 text-left"><p className="text-xs font-black uppercase tracking-widest text-gray-400">{title}</p><p className="mt-2 text-sm font-bold text-gray-800">{String(value || 'Not captured')}</p></button>)}</div><div><h3 className="text-sm font-black uppercase tracking-widest text-gray-400">AI notices</h3><div className="mt-3 space-y-2">{(profile.analysis?.notices || []).map((notice: string) => <div key={notice} className="rounded-xl bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-900">{notice}</div>)}{!(profile.analysis?.notices || []).length && <p className="text-sm text-gray-500">No notices yet.</p>}</div></div></section><aside className="space-y-5 rounded-3xl bg-white p-6 shadow-sm"><h2 className="text-lg font-black text-gray-900">Suggested replies</h2>{(lead.suggestions || []).map((suggestion) => <div key={suggestion.id} className="rounded-2xl border border-gray-100 p-4"><p className="text-sm font-bold text-gray-800">{suggestion.text}</p><p className="mt-2 text-xs text-gray-500">{suggestion.reason || 'Recommended next step'}</p></div>)}{!(lead.suggestions || []).length && <p className="text-sm text-gray-500">Suggestions will appear after the next analysis.</p>}<div className="border-t border-gray-100 pt-5"><p className="text-xs font-black uppercase tracking-widest text-gray-400">Order confirmation</p><p className="mt-2 text-sm font-black text-gray-800">{profile.orderConfirmation?.status || 'Not detected'}</p></div></aside></div>
  </div>;
};

export default LeadDetails;
