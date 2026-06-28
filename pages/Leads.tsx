import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Table } from '../components';
import Pagination from '../src/components/Pagination';
import FilterBar, { FilterRange } from '../components/FilterBar';
import { useSystemDefaults } from '../src/hooks/useQueries';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { useUrlSyncedSearchQuery } from '../src/hooks/useUrlSyncedSearchQuery';
import { getPositivePageParam } from '../src/utils/navigation';
import { ICONS } from '../constants';

type LeadStatus = 'New' | 'Follow-up' | 'Qualified' | 'Converted' | 'Lost';

interface Lead {
  id: string;
  name: string;
  phone: string;
  address: string;
  status: LeadStatus;
  source: string;
  createdAt: string;
  nextFollowUp: string;
}

const leadSeedData: Lead[] = [
  {
    id: 'lead-1',
    name: 'Amina Hassan',
    phone: '+255712345678',
    address: 'Mbezi Beach, Dar es Salaam',
    status: 'Follow-up',
    source: 'Website',
    createdAt: '2026-06-17T09:30:00',
    nextFollowUp: '2026-06-28T10:00:00',
  },
  {
    id: 'lead-2',
    name: 'Brian Mwakalobo',
    phone: '+255765432109',
    address: 'Kijitonyama, Dar es Salaam',
    status: 'Qualified',
    source: 'Referral',
    createdAt: '2026-06-16T14:40:00',
    nextFollowUp: '2026-06-29T11:30:00',
  },
  {
    id: 'lead-3',
    name: 'Cynthia Kileo',
    phone: '+255754321987',
    address: 'Mwananyamala, Dar es Salaam',
    status: 'New',
    source: 'Instagram',
    createdAt: '2026-06-20T08:15:00',
    nextFollowUp: '2026-06-30T13:00:00',
  },
  {
    id: 'lead-4',
    name: 'Daniel Mrosso',
    phone: '+255733456789',
    address: 'Goba, Dodoma',
    status: 'Lost',
    source: 'Campaign',
    createdAt: '2026-06-12T12:05:00',
    nextFollowUp: '2026-06-25T09:00:00',
  },
  {
    id: 'lead-5',
    name: 'Evelyn Nyerere',
    phone: '+255716789012',
    address: 'Mlimani, Arusha',
    status: 'Converted',
    source: 'WhatsApp',
    createdAt: '2026-06-18T16:20:00',
    nextFollowUp: '2026-06-27T15:45:00',
  },
  {
    id: 'lead-6',
    name: 'Faraji Salum',
    phone: '+255699876543',
    address: 'Tabata, Dar es Salaam',
    status: 'Follow-up',
    source: 'Facebook',
    createdAt: '2026-06-24T10:50:00',
    nextFollowUp: '2026-07-01T09:00:00',
  },
];

const statusStyles: Record<LeadStatus, string> = {
  New: 'bg-blue-50 text-blue-700',
  'Follow-up': 'bg-amber-50 text-amber-700',
  Qualified: 'bg-emerald-50 text-emerald-700',
  Converted: 'bg-purple-50 text-purple-700',
  Lost: 'bg-rose-50 text-rose-700',
};

const formatDate = (value: string) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

const isWithinRange = (value: string, filterRange: FilterRange, customDates: { from: string; to: string }, includeTime: boolean) => {
  if (!value) return true;
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return true;

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  switch (filterRange) {
    case 'Today':
      return target >= startOfToday && target <= endOfToday;
    case 'This Week': {
      const startOfWeek = new Date(startOfToday);
      startOfWeek.setDate(startOfToday.getDate() - startOfToday.getDay());
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);
      return target >= startOfWeek && target <= endOfWeek;
    }
    case 'This Month': {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      return target >= startOfMonth && target <= endOfMonth;
    }
    case 'This Year': {
      const startOfYear = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
      const endOfYear = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
      return target >= startOfYear && target <= endOfYear;
    }
    case 'Custom': {
      if (!customDates.from && !customDates.to) return true;
      const from = customDates.from ? new Date(customDates.from) : null;
      const to = customDates.to ? new Date(customDates.to) : null;
      if (from && includeTime) from.setSeconds(0, 0);
      if (to && includeTime) to.setSeconds(59, 999);
      if (from && to) return target >= from && target <= to;
      if (from) return target >= from;
      if (to) return target <= to;
      return true;
    }
    default:
      return true;
  }
};

const Leads: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: systemDefaults } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const [searchParams, setSearchParams] = useSearchParams();
  const currentSearchParams = searchParams.toString();
  const urlPage = getPositivePageParam(searchParams.get('page'));
  const { searchQuery } = useUrlSyncedSearchQuery(searchParams.get('search') || '');
  const [syncedSearchParams, setSyncedSearchParams] = useState<string | null>(null);
  const shouldHydrateFromUrl = syncedSearchParams !== currentSearchParams;
  const [page, setPage] = useState<number>(urlPage);
  const [filterRange, setFilterRange] = useState<FilterRange>('All Time');
  const [customDates, setCustomDates] = useState({ from: '', to: '' });
  const [includeTime, setIncludeTime] = useState(false);

  useEffect(() => {
    if (!shouldHydrateFromUrl) return;
    setPage(urlPage);
    setSyncedSearchParams(currentSearchParams);
  }, [shouldHydrateFromUrl, urlPage, currentSearchParams]);

  useEffect(() => {
    if (shouldHydrateFromUrl) return;

    const params: Record<string, string> = {};
    if (page > 1) params.page = String(page);
    if (searchQuery) params.search = searchQuery;

    if (new URLSearchParams(params).toString() !== currentSearchParams) {
      setSearchParams(params, { replace: true });
    }
  }, [shouldHydrateFromUrl, page, searchQuery, currentSearchParams, setSearchParams]);

  const filteredLeads = useMemo(() => {
    const loweredSearch = searchQuery.trim().toLowerCase();

    return leadSeedData.filter((lead) => {
      const matchesSearch = !loweredSearch || [lead.name, lead.phone, lead.address, lead.status, lead.source].some((value) => value.toLowerCase().includes(loweredSearch));
      const matchesDate = isWithinRange(lead.createdAt, filterRange, customDates, includeTime);
      return matchesSearch && matchesDate;
    });
  }, [searchQuery, filterRange, customDates, includeTime]);

  const total = filteredLeads.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedLeads = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredLeads.slice(start, start + pageSize);
  }, [filteredLeads, safePage, pageSize]);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="md:text-2xl text-xl font-bold text-gray-900">Leads</h2>
          <p className="text-sm text-gray-500 mt-1">Track prospective customers and follow-ups in a paginated list.</p>
        </div>
      </div>

      <FilterBar
        filterRange={filterRange}
        setFilterRange={setFilterRange}
        customDates={customDates}
        setCustomDates={setCustomDates}
        includeTime={includeTime}
        setIncludeTime={setIncludeTime}
        title="Leads"
      />

      <Table
        columns={[
          {
            key: 'name',
            label: 'Lead Name',
            render: (_, lead) => (
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 font-semibold text-gray-700">
                  {lead.name.split(' ').map((word) => word[0]).join('').slice(0, 2)}
                </div>
                <div>
                  <span className="font-bold text-gray-900 block">{lead.name}</span>
                  <p className="text-xs text-gray-400 truncate max-w-[220px]">{lead.address}</p>
                </div>
              </div>
            ),
          },
          {
            key: 'phone',
            label: 'Contact',
            render: (phone) => <span className="text-sm font-medium text-gray-700">{phone}</span>,
          },
          {
            key: 'status',
            label: 'Status',
            align: 'center' as const,
            render: (status: LeadStatus) => (
              <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${statusStyles[status]}`}>
                {status}
              </span>
            ),
          },
          {
            key: 'nextFollowUp',
            label: 'Next Follow-up',
            render: (value) => <span className="text-sm font-medium text-gray-700">{formatDate(value)}</span>,
          },
          {
            key: 'source',
            label: 'Source',
            render: (source) => <span className="text-sm font-medium text-gray-700">{source}</span>,
          },
          {
            key: 'createdAt',
            label: 'Created',
            render: (value) => <span className="text-sm font-medium text-gray-500">{formatDate(value)}</span>,
          },
        ]}
        data={paginatedLeads}
        loading={false}
        emptyMessage="No leads found"
        onRowClick={(lead) => navigate(`/leads/${lead.id}`, { state: { from: location.pathname } })}
      />

      <Pagination page={safePage} totalPages={totalPages} onPageChange={(p) => setPage(p)} />
    </div>
  );
};

export default Leads;
