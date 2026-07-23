import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { MessageCircle, Search, Smartphone } from 'lucide-react';
import { Table } from '../components';
import Pagination from '../src/components/Pagination';
import { useLeadsPage, useSystemDefaults } from '../src/hooks/useQueries';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { useUrlSyncedSearchQuery } from '../src/hooks/useUrlSyncedSearchQuery';
import { getPositivePageParam } from '../src/utils/navigation';
import type { Lead } from '../types';

const statusStyles: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700', active: 'bg-gray-100 text-gray-700', needs_reply: 'bg-amber-50 text-amber-700', qualified: 'bg-emerald-50 text-emerald-700', high_intent: 'bg-purple-50 text-purple-700', order_pending: 'bg-orange-50 text-orange-700', converted: 'bg-green-50 text-green-700', lost: 'bg-rose-50 text-rose-700', paused: 'bg-gray-100 text-gray-500',
};

const label = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('en-BD', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const Score: React.FC<{ value: number }> = ({ value }) => <div className="relative flex h-12 w-12 items-center justify-center rounded-full" style={{ background: `conic-gradient(${value >= 75 ? '#7c3aed' : value >= 50 ? '#059669' : '#f59e0b'} ${value * 3.6}deg, #eef2f7 0deg)` }}><div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-xs font-black text-gray-800">{Math.round(value)}%</div></div>;

const Leads: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: defaults } = useSystemDefaults();
  const pageSize = defaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const { searchQuery } = useUrlSyncedSearchQuery(searchParams.get('search') || '');
  const [page, setPage] = useState(getPositivePageParam(searchParams.get('page')));
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [channel, setChannel] = useState(searchParams.get('channel') || '');
  const query = useLeadsPage({ page, pageSize, search: searchQuery, status, channel }, true);
  const leads = query.data?.data || [];
  const totalPages = Math.max(1, Math.ceil((query.data?.count || 0) / pageSize));

  useEffect(() => { const params: Record<string, string> = {}; if (page > 1) params.page = String(page); if (searchQuery) params.search = searchQuery; if (status) params.status = status; if (channel) params.channel = channel; setSearchParams(params, { replace: true }); }, [page, searchQuery, status, channel, setSearchParams]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const columns = useMemo(() => [
    { key: 'name', label: 'Lead', render: (_: unknown, lead: Lead) => <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-50 text-sm font-black text-indigo-700">{(lead.name || 'L').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</div><div className="min-w-0"><span className="block truncate font-bold text-gray-900">{lead.name || 'Unknown lead'}</span><span className="block truncate text-xs text-gray-400">{lead.phone || 'Phone not captured'}</span></div></div> },
    { key: 'sourceChannel', label: 'Channel', render: (value: string) => <span className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-600">{value === 'whatsapp' ? <Smartphone size={15} className="text-emerald-600" /> : <MessageCircle size={15} className="text-blue-600" />}{label(value)}</span> },
    { key: 'score', label: 'Order chance', render: (value: number) => <Score value={value} /> },
    { key: 'status', label: 'Stage', render: (value: string) => <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusStyles[value] || statusStyles.active}`}>{label(value)}</span> },
    { key: 'lastMessagePreview', label: 'Last message', render: (value: string) => <span className="block max-w-[260px] truncate text-sm text-gray-600">{value || 'No message preview'}</span> },
    { key: 'updatedAt', label: 'Updated', render: (value: string) => <span className="text-sm text-gray-500">{formatDate(value)}</span> },
  ], []);

  return <div className="space-y-6">
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h1 className="text-2xl font-black text-gray-900">Leads</h1><p className="mt-1 text-sm font-medium text-gray-500">Analyze Messenger and WhatsApp conversations and prioritize the next best action.</p></div><div className="flex flex-wrap gap-2"><select value={channel} onChange={(event) => { setChannel(event.target.value); setPage(1); }} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-700"><option value="">All channels</option><option value="messenger">Messenger</option><option value="whatsapp">WhatsApp</option></select><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-700"><option value="">All stages</option>{Object.keys(statusStyles).map((item) => <option key={item} value={item}>{label(item)}</option>)}</select></div></div>
    <div className="flex items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm"><Search size={18} className="text-gray-400" /><input value={searchParams.get('search') || ''} onChange={(event) => { const next = new URLSearchParams(searchParams); if (event.target.value) next.set('search', event.target.value); else next.delete('search'); next.delete('page'); setSearchParams(next, { replace: true }); setPage(1); }} placeholder="Search lead name or phone" className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" /></div>
    <Table columns={columns} data={leads} loading={query.isPending} emptyMessage="No Messenger or WhatsApp leads found" onRowClick={(lead) => navigate(`/leads/${lead.id}`, { state: { from: location.pathname } })} />
    <Pagination page={Math.min(page, totalPages)} totalPages={totalPages} onPageChange={setPage} />
  </div>;
};

export default Leads;
