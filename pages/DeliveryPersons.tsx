import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Table } from '../components';
import DynamicFilterBar, { formatDateDisplay, type CombinedFilter, type FilterOperator } from '../components/DynamicFilterBar';
import Pagination from '../src/components/Pagination';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { useDeliveryPersonFilterOptions, useDeliveryPersonsPage, useSystemDefaults } from '../src/hooks/useQueries';
import { useDeleteDeliveryPerson } from '../src/hooks/useMutations';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useUrlSyncedSearchQuery } from '../src/hooks/useUrlSyncedSearchQuery';
import { decodeDynamicTextFilterValue, encodeDynamicTextFilterValue } from '../utils';
import { buildHistoryBackState, getPositivePageParam } from '../src/utils/navigation';

const DeliveryPersons: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { can } = useRolePermissions();
  const canCreate = can('users.create');
  const canEdit = can('users.edit');
  const canDelete = can('users.delete');
  const { data: systemDefaults, isPending: defaultsPending, isError: defaultsError } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const canLoad = !defaultsPending || !!systemDefaults || defaultsError;
  const currentSearchParams = searchParams.toString();
  const urlPage = getPositivePageParam(searchParams.get('page'));
  const { searchQuery, setSearchQuery } = useUrlSyncedSearchQuery(searchParams.get('search') || '');
  const [syncedSearchParams, setSyncedSearchParams] = React.useState<string | null>(null);
  const shouldHydrateFromUrl = syncedSearchParams !== currentSearchParams;
  const [page, setPage] = React.useState(urlPage);
  const effectivePage = shouldHydrateFromUrl ? urlPage : page;
  const { data: options } = useDeliveryPersonFilterOptions();
  const [nameFilter, setNameFilter] = React.useState('');
  const [nameNotFilter, setNameNotFilter] = React.useState('');
  const [phoneFilter, setPhoneFilter] = React.useState('');
  const [phoneNotFilter, setPhoneNotFilter] = React.useState('');
  const [joinedFilter, setJoinedFilter] = React.useState<{ operator: string; value: string } | null>(null);
  const [genderFilter, setGenderFilter] = React.useState('');
  const [genderNotFilter, setGenderNotFilter] = React.useState('');
  const [nationalityFilter, setNationalityFilter] = React.useState('');
  const [nationalityNotFilter, setNationalityNotFilter] = React.useState('');
  const [bloodGroupFilter, setBloodGroupFilter] = React.useState('');
  const [bloodGroupNotFilter, setBloodGroupNotFilter] = React.useState('');
  const deleteMutation = useDeleteDeliveryPerson();

  const { data, isFetching } = useDeliveryPersonsPage(effectivePage, pageSize, {
    search: searchQuery || undefined,
    name: nameFilter || undefined,
    nameNot: nameNotFilter || undefined,
    phone: phoneFilter || undefined,
    phoneNot: phoneNotFilter || undefined,
    joined: joinedFilter || undefined,
    gender: genderFilter || undefined,
    genderNot: genderNotFilter || undefined,
    nationality: nationalityFilter || undefined,
    nationalityNot: nationalityNotFilter || undefined,
    bloodGroup: bloodGroupFilter || undefined,
    bloodGroupNot: bloodGroupNotFilter || undefined,
  }, { enabled: canLoad });
  const rows = data?.data || [];
  const totalPages = Math.max(1, Math.ceil((data?.count || 0) / pageSize));
  const previousSearchRef = useRef(searchQuery);

  useEffect(() => {
    if (!shouldHydrateFromUrl) return;
    setPage(urlPage);
    setSyncedSearchParams(currentSearchParams);
  }, [shouldHydrateFromUrl, urlPage, currentSearchParams]);

  useEffect(() => {
    if (shouldHydrateFromUrl) { previousSearchRef.current = searchQuery; return; }
    if (previousSearchRef.current !== searchQuery) { setPage(1); previousSearchRef.current = searchQuery; }
  }, [searchQuery, shouldHydrateFromUrl]);

  useEffect(() => {
    if (shouldHydrateFromUrl) return;
    const params = new URLSearchParams(currentSearchParams);
    if (effectivePage > 1) params.set('page', String(effectivePage)); else params.delete('page');
    if (params.toString() !== currentSearchParams) setSearchParams(params, { replace: true });
  }, [shouldHydrateFromUrl, effectivePage, currentSearchParams, setSearchParams]);

  const refresh = useCallback(() => { queryClient.refetchQueries({ queryKey: ['deliveryPersons'], exact: false, type: 'active' }); }, [queryClient]);
  const nameOptions = options?.names || [];
  const phoneOptions = options?.phones || [];
  const genderOptions = [...(options?.genders || ['Male', 'Female', 'Other']).map((value) => ({ value, label: value })), { value: '__not_specified__', label: 'Not Specified' }];
  const nationalityOptions = options?.nationalities || [];
  const bloodGroupOptions = [...(options?.bloodGroups || ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']).map((value) => ({ value, label: value })), { value: '__not_specified__', label: 'Not Specified' }];
  const filterDefinitions = useMemo(() => {
    const text = (type: string, values: string[]) => ({ type, operators: ['=', '≠', 'contains', 'does not contain'] as const, allowCustomValue: true, renderOptions: (query: string) => values.filter((value) => value.toLowerCase().includes(query.trim().toLowerCase())).map((value) => ({ value, label: value })) });
    return [text('Name', nameOptions), text('Phone', phoneOptions), { type: 'Joined', operators: ['on', 'before', 'after'] as const, valueType: 'date' as const }, { type: 'Gender', operators: ['=', '≠'] as const, values: genderOptions }, text('Nationality', nationalityOptions), { type: 'Blood Group', operators: ['=', '≠'] as const, values: bloodGroupOptions }];
  }, [nameOptions, phoneOptions, genderOptions, nationalityOptions, bloodGroupOptions]);
  const initialFilters = useMemo(() => {
    const decode = (value: string, negative = false): { operator: FilterOperator; value: string } => { const decoded = decodeDynamicTextFilterValue(value); return { operator: decoded.contains ? (negative ? 'does not contain' : 'contains') : (negative ? '≠' : '='), value: decoded.value }; };
    const filters: CombinedFilter[] = [];
    if (nameFilter) filters.push({ id: 'name', type: 'Name', ...decode(nameFilter) });
    if (nameNotFilter) filters.push({ id: 'name-not', type: 'Name', ...decode(nameNotFilter, true) });
    if (phoneFilter) filters.push({ id: 'phone', type: 'Phone', ...decode(phoneFilter) });
    if (phoneNotFilter) filters.push({ id: 'phone-not', type: 'Phone', ...decode(phoneNotFilter, true) });
    if (joinedFilter) filters.push({ id: 'joined', type: 'Joined', operator: joinedFilter.operator as FilterOperator, value: joinedFilter.value, display: formatDateDisplay(joinedFilter.value) });
    if (genderFilter) filters.push({ id: 'gender', type: 'Gender', operator: '=', value: genderFilter, display: genderFilter === '__not_specified__' ? 'Not Specified' : genderFilter });
    if (genderNotFilter) filters.push({ id: 'gender-not', type: 'Gender', operator: '≠', value: genderNotFilter, display: genderNotFilter === '__not_specified__' ? 'Not Specified' : genderNotFilter });
    if (nationalityFilter) filters.push({ id: 'nationality', type: 'Nationality', ...decode(nationalityFilter) });
    if (nationalityNotFilter) filters.push({ id: 'nationality-not', type: 'Nationality', ...decode(nationalityNotFilter, true) });
    if (bloodGroupFilter) filters.push({ id: 'blood-group', type: 'Blood Group', operator: '=', value: bloodGroupFilter, display: bloodGroupFilter === '__not_specified__' ? 'Not Specified' : bloodGroupFilter });
    if (bloodGroupNotFilter) filters.push({ id: 'blood-group-not', type: 'Blood Group', operator: '≠', value: bloodGroupNotFilter, display: bloodGroupNotFilter === '__not_specified__' ? 'Not Specified' : bloodGroupNotFilter });
    return filters;
  }, [nameFilter, nameNotFilter, phoneFilter, phoneNotFilter, joinedFilter, genderFilter, genderNotFilter, nationalityFilter, nationalityNotFilter, bloodGroupFilter, bloodGroupNotFilter]);
  const applyFilters = (filters: CombinedFilter[]) => {
    const textValue = (filter: { operator: string; value: string }) => encodeDynamicTextFilterValue(filter.value, filter.operator.includes('contain'));
    const pick = (type: string, operator: string) => filters.find((filter) => filter.type === type && filter.operator === operator);
    const pickNegative = (type: string) => filters.find((filter) => filter.type === type && (filter.operator === '≠' || filter.operator === 'does not contain'));
    setNameFilter(pick('Name', '=') || pick('Name', 'contains') ? textValue(pick('Name', '=') || pick('Name', 'contains')!) : '');
    setNameNotFilter(pickNegative('Name') ? textValue(pickNegative('Name')!) : '');
    setPhoneFilter(pick('Phone', '=') || pick('Phone', 'contains') ? textValue(pick('Phone', '=') || pick('Phone', 'contains')!) : '');
    setPhoneNotFilter(pickNegative('Phone') ? textValue(pickNegative('Phone')!) : '');
    setJoinedFilter(filters.find((filter) => filter.type === 'Joined') ? { operator: filters.find((filter) => filter.type === 'Joined')!.operator, value: filters.find((filter) => filter.type === 'Joined')!.value } : null);
    setGenderFilter(pick('Gender', '=')?.value || ''); setGenderNotFilter(pick('Gender', '≠')?.value || '');
    setNationalityFilter(pick('Nationality', '=') || pick('Nationality', 'contains') ? textValue(pick('Nationality', '=') || pick('Nationality', 'contains')!) : '');
    setNationalityNotFilter(pickNegative('Nationality') ? textValue(pickNegative('Nationality')!) : '');
    setBloodGroupFilter(pick('Blood Group', '=')?.value || ''); setBloodGroupNotFilter(pick('Blood Group', '≠')?.value || '');
    setPage(1);
  };

  return <div className="space-y-6">
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 flex-1"><DynamicFilterBar filterDefinitions={filterDefinitions} initialFilters={initialFilters} freeTextLabel="Delivery Persons" rawSearchValue={searchQuery} onRawSearchChange={setSearchQuery} onApply={applyFilters} /></div><button onClick={refresh} disabled={isFetching} className="rounded-xl border border-gray-100 bg-white px-3 py-2.5 text-sm font-bold text-gray-500 shadow-sm">Refresh</button>{canCreate && <Button onClick={() => navigate('/delivery-persons/new', { state: buildHistoryBackState(location) })} icon={<Plus size={17} />}>Add Delivery Person</Button>}</div>
    <Table columns={[{ key: 'name', label: 'Name', render: (_value, person) => <div className="flex items-center gap-3"><img src={person.image || '/uploads/Empty_avatar.png'} alt="" className="h-10 w-10 rounded-full border object-cover" /><span className="font-bold text-gray-900">{person.name}</span></div> }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email', render: (value) => <span className="block max-w-xs truncate text-sm text-gray-600">{value || '—'}</span> }, { key: 'address', label: 'Address', render: (value) => <span className="block max-w-xs truncate text-sm text-gray-600">{value || '—'}</span> }, ...((canEdit || canDelete) ? [{ key: 'id', label: 'Actions', align: 'right' as const, render: (value: string, person: any) => <div className="flex justify-end gap-1">{canEdit && <IconButton icon={<Pencil size={17} />} title="Edit" onClick={() => navigate(`/delivery-persons/edit/${value}`, { state: buildHistoryBackState(location) })} />}{canDelete && <IconButton icon={<Trash2 size={17} />} title="Archive" variant="danger" onClick={() => { if (window.confirm(`Archive ${person.name}?`)) deleteMutation.mutate(value); }} />}</div> }] : [])]} data={rows as any} loading={isFetching} emptyMessage="No delivery persons found" size="sm" onRowClick={(person) => navigate(`/delivery-persons/edit/${person.id}`, { state: buildHistoryBackState(location) })} />
    <Pagination page={effectivePage} totalPages={totalPages} onPageChange={setPage} disabled={isFetching} />
  </div>;
};

export default DeliveryPersons;
