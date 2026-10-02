import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle, RefreshCw, Smartphone } from 'lucide-react';
import { Table } from '../components';
import DynamicFilterBar, { type CombinedFilter, type FilterDefinition } from '../components/DynamicFilterBar';
import Pagination from '../src/components/Pagination';
import { useLeadsPage, useSystemDefaults } from '../src/hooks/useQueries';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { useUrlSyncedSearchQuery } from '../src/hooks/useUrlSyncedSearchQuery';
import { getPositivePageParam } from '../src/utils/navigation';
import type { Lead } from '../types';

const statusStyles: Record<string, string> = {
  new: 'bg-blue-50 text-blue-700', active: 'bg-gray-100 text-gray-700', needs_reply: 'bg-amber-50 text-amber-700', qualified: 'bg-emerald-50 text-emerald-700', high_intent: 'bg-purple-50 text-purple-700', order_pending: 'bg-orange-50 text-orange-700', confirmed: 'bg-green-50 text-green-700', converted: 'bg-green-50 text-green-700', lost: 'bg-rose-50 text-rose-700', paused: 'bg-gray-100 text-gray-500',
};

const label = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatDate = (value?: string | null) => value ? new Date(value).toLocaleString('en-BD', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const Score: React.FC<{ value: number }> = ({ value }) => <div className="relative flex h-12 w-12 items-center justify-center rounded-full" style={{ background: `conic-gradient(${value >= 75 ? '#7c3aed' : value >= 50 ? '#059669' : '#f59e0b'} ${value * 3.6}deg, #eef2f7 0deg)` }}><div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-xs font-black text-gray-800">{Math.round(value)}%</div></div>;

const Leads: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: defaults } = useSystemDefaults();
  const pageSize = defaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const { searchQuery, setSearchQuery } = useUrlSyncedSearchQuery(searchParams.get('search') || '');
  const [page, setPage] = useState(getPositivePageParam(searchParams.get('page')));
  const [status, setStatus] = useState(searchParams.get('status') || '');
  const [statusOperator, setStatusOperator] = useState(searchParams.get('statusOperator') || '=');
  const [channel, setChannel] = useState(searchParams.get('channel') || '');
  const [channelOperator, setChannelOperator] = useState(searchParams.get('channelOperator') || '=');
  const [nameFilter, setNameFilter] = useState(searchParams.get('name') || '');
  const [nameOperator, setNameOperator] = useState(searchParams.get('nameOperator') || 'contains');
  const [phoneFilter, setPhoneFilter] = useState(searchParams.get('phone') || '');
  const [phoneOperator, setPhoneOperator] = useState(searchParams.get('phoneOperator') || 'contains');
  const [orderChance, setOrderChance] = useState(searchParams.get('orderChance') || '');
  const [orderChanceOperator, setOrderChanceOperator] = useState(searchParams.get('orderChanceOperator') || '=');
  const query = useLeadsPage({ page, pageSize, search: searchQuery, status, statusOperator, channel, channelOperator, name: nameFilter, nameOperator, phone: phoneFilter, phoneOperator, orderChance, orderChanceOperator }, true);
  const leads = query.data?.data || [];
  const totalPages = Math.max(1, Math.ceil((query.data?.count || 0) / pageSize));
  const filterDefinitions = useMemo<FilterDefinition[]>(() => [
    { type: 'Channel', operators: ['=', '≠'], values: [{ value: 'messenger', label: 'Messenger' }, { value: 'whatsapp', label: 'WhatsApp' }] },
    { type: 'Stage', operators: ['=', '≠'], values: Object.keys(statusStyles).map((value) => ({ value, label: label(value) })) },
    { type: 'Name', operators: ['=', '≠', 'contains', 'does not contain'], allowCustomValue: true },
    { type: 'Phone', operators: ['=', '≠', 'contains', 'does not contain'], allowCustomValue: true },
    { type: 'Order chance', operators: ['=', '≠', '<', '>'], valueType: 'number', allowCustomValue: true },
  ], []);
  const initialFilters = useMemo<CombinedFilter[]>(() => [
    ...(channel ? [{ id: 'channel', type: 'Channel', operator: channelOperator as CombinedFilter['operator'], value: channel, display: label(channel) }] : []),
    ...(status ? [{ id: 'stage', type: 'Stage', operator: statusOperator as CombinedFilter['operator'], value: status, display: label(status) }] : []),
    ...(nameFilter ? [{ id: 'name', type: 'Name', operator: nameOperator as CombinedFilter['operator'], value: nameFilter }] : []),
    ...(phoneFilter ? [{ id: 'phone', type: 'Phone', operator: phoneOperator as CombinedFilter['operator'], value: phoneFilter }] : []),
    ...(orderChance ? [{ id: 'order-chance', type: 'Order chance', operator: orderChanceOperator as CombinedFilter['operator'], value: orderChance }] : []),
  ], [channel, channelOperator, status, statusOperator, nameFilter, nameOperator, phoneFilter, phoneOperator, orderChance, orderChanceOperator]);

  useEffect(() => {
    const params: Record<string, string> = {};
    if (page > 1) params.page = String(page);
    if (searchQuery) params.search = searchQuery;
    if (status) { params.status = status; if (statusOperator !== '=') params.statusOperator = statusOperator; }
    if (channel) { params.channel = channel; if (channelOperator !== '=') params.channelOperator = channelOperator; }
    if (nameFilter) { params.name = nameFilter; params.nameOperator = nameOperator; }
    if (phoneFilter) { params.phone = phoneFilter; params.phoneOperator = phoneOperator; }
    if (orderChance) { params.orderChance = orderChance; if (orderChanceOperator !== '=') params.orderChanceOperator = orderChanceOperator; }
    setSearchParams(params, { replace: true });
  }, [page, searchQuery, status, statusOperator, channel, channelOperator, nameFilter, nameOperator, phoneFilter, phoneOperator, orderChance, orderChanceOperator, setSearchParams]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);

  const columns = useMemo(() => [
    { key: 'name', label: 'Lead', render: (_: unknown, lead: Lead) => <div className="flex items-center gap-3">{lead.profilePictureUrl ? <img src={lead.profilePictureUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" /> : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-black text-indigo-700">{(lead.name || 'L').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</div>}<div className="min-w-0"><span className="block truncate font-bold text-gray-900">{lead.name || 'Unknown lead'}</span><span className="block truncate text-xs text-gray-400">{lead.phone || 'Phone not captured'}</span></div></div> },
    { key: 'sourceChannel', label: 'Channel', render: (value: string) => <span className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-600">{value === 'whatsapp' ? <Smartphone size={15} className="text-emerald-600" /> : <MessageCircle size={15} className="text-blue-600" />}{label(value)}</span> },
    { key: 'orderProbability', label: 'Order chance', render: (value: number) => <Score value={value} /> },
    { key: 'status', label: 'Stage', render: (value: string) => <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${statusStyles[value] || statusStyles.active}`}>{label(value)}</span> },
    { key: 'lastMessagePreview', label: 'Last message', render: (value: string) => <span className="block max-w-[260px] truncate text-sm text-gray-600">{value || 'No message preview'}</span> },
    { key: 'updatedAt', label: 'Updated', render: (value: string) => <span className="text-sm text-gray-500">{formatDate(value)}</span> },
  ], []);

  return <div className="space-y-6">
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <DynamicFilterBar
          filterDefinitions={filterDefinitions}
          initialFilters={initialFilters}
          freeTextLabel="Leads"
          rawSearchValue={searchQuery}
          onRawSearchChange={(value) => { setSearchQuery(value); setPage(1); }}
          onApply={(filters) => {
            const channelFilter = filters.find((filter) => filter.type === 'Channel');
            const stageFilter = filters.find((filter) => filter.type === 'Stage');
            const name = filters.find((filter) => filter.type === 'Name');
            const phone = filters.find((filter) => filter.type === 'Phone');
            const chance = filters.find((filter) => filter.type === 'Order chance');
            setChannel(channelFilter?.value || '');
            setChannelOperator(channelFilter?.operator || '=');
            setStatus(stageFilter?.value || '');
            setStatusOperator(stageFilter?.operator || '=');
            setNameFilter(name?.value || '');
            setNameOperator(name?.operator || 'contains');
            setPhoneFilter(phone?.value || '');
            setPhoneOperator(phone?.operator || 'contains');
            setOrderChance(chance?.value || '');
            setOrderChanceOperator(chance?.operator || '=');
            setPage(1);
          }}
        />
      </div>
      <button
        type="button"
        onClick={() => queryClient.refetchQueries({ queryKey: ['leads'], exact: false, type: 'active' })}
        disabled={query.isFetching}
        className="flex items-center gap-1.5 rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-sm font-bold text-gray-500 shadow-sm transition-all hover:bg-gray-50 disabled:opacity-50"
        title="Refresh"
      >
        <RefreshCw size={16} className={query.isFetching ? 'animate-spin' : ''} />
        Refresh
      </button>
    </div>
    <Table columns={columns} data={leads} loading={query.isPending} emptyMessage="No Messenger or WhatsApp leads found" onRowClick={(lead) => navigate(`/leads/${lead.id}`, { state: { from: location.pathname } })} />
    <Pagination page={Math.min(page, totalPages)} totalPages={totalPages} onPageChange={setPage} />
  </div>;
};

export default Leads;
