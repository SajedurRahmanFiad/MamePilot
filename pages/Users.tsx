
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { hasAdminAccess } from '../types';
import { ICONS } from '../constants';
import { Button, Table, IconButton } from '../components';
import DynamicFilterBar, { formatDateDisplay } from '../components/DynamicFilterBar';
import Pagination from '../src/components/Pagination';
import { theme } from '../theme';
import { useAuth } from '../src/contexts/AuthProvider';
import { useSystemDefaults, useUsers, useUsersPage } from '../src/hooks/useQueries';
import { useUrlSyncedSearchQuery } from '../src/hooks/useUrlSyncedSearchQuery';
import { DEFAULT_PAGE_SIZE, fetchUserById } from '../src/services/supabaseQueries';
import { buildHistoryBackState, getPositivePageParam } from '../src/utils/navigation';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { decodeDynamicTextFilterValue, encodeDynamicTextFilterValue } from '../utils';

type RoleFilter = 'All' | string;

const Users: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    data: systemDefaults,
    isPending: systemDefaultsLoading,
    isError: systemDefaultsError,
  } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const canLoadUsers = !systemDefaultsLoading || !!systemDefaults || systemDefaultsError;
  const { user } = useAuth();
  const { canCreateUsers, canEditUsers } = useRolePermissions();
  const currentSearchParams = searchParams.toString();
  const urlPage = getPositivePageParam(searchParams.get('page'));
  const { searchQuery } = useUrlSyncedSearchQuery(searchParams.get('search') || '');
  const [syncedSearchParams, setSyncedSearchParams] = React.useState<string | null>(null);
  const shouldHydrateFromUrl = syncedSearchParams !== currentSearchParams;
  const [page, setPage] = React.useState<number>(urlPage);
  const previousSearchQueryRef = React.useRef(searchQuery);
  const roleFilter = (searchParams.get('role') as RoleFilter | null) || 'All';
  const previousRoleFilterRef = React.useRef(roleFilter);
  const effectivePage = shouldHydrateFromUrl ? urlPage : page;
  const { data: allUsers = [] } = useUsers();
  const [roleNotFilter, setRoleNotFilter] = React.useState<string>('');
  const [nameFilter, setNameFilter] = React.useState<string>('');
  const [nameNotFilter, setNameNotFilter] = React.useState<string>('');
  const [phoneFilter, setPhoneFilter] = React.useState<string>('');
  const [phoneNotFilter, setPhoneNotFilter] = React.useState<string>('');
  const [joinedFilter, setJoinedFilter] = React.useState<{ operator: string; value: string } | null>(null);
  const [genderFilter, setGenderFilter] = React.useState<string>('');
  const [genderNotFilter, setGenderNotFilter] = React.useState<string>('');
  const [nationalityFilter, setNationalityFilter] = React.useState<string>('');
  const [nationalityNotFilter, setNationalityNotFilter] = React.useState<string>('');
  const [bloodGroupFilter, setBloodGroupFilter] = React.useState<string>('');
  const [bloodGroupNotFilter, setBloodGroupNotFilter] = React.useState<string>('');
  const { data: usersPage, isFetching: loading } = useUsersPage(
    effectivePage,
    pageSize,
    {
      search: searchQuery || undefined,
      role: roleFilter !== 'All' ? roleFilter : undefined,
      roleNot: roleNotFilter || undefined,
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
    },
    { enabled: canLoadUsers },
  );
  const users = usersPage?.data || [];
  const total = usersPage?.count || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const handleRefreshUsers = useCallback(() => {
    queryClient.refetchQueries({ queryKey: ['users'], exact: false, type: 'active' });
  }, [queryClient]);
  const isAdmin = hasAdminAccess(user?.role);

  // Track location to detect browser back navigation
  const previousLocationRef = useRef<string>(location.pathname + location.search);
  const [isNavigatingViaHistory, setIsNavigatingViaHistory] = React.useState(false);

  React.useEffect(() => {
    const currentLocation = location.pathname + location.search;
    const prevLocation = previousLocationRef.current;

    // Detect back navigation: same pathname but different search params
    if (
      location.pathname === prevLocation.split('?')[0] &&
      currentLocation !== prevLocation &&
      location.search !== ''
    ) {
      setIsNavigatingViaHistory(true);
      const timer = setTimeout(() => setIsNavigatingViaHistory(false), 0);
      previousLocationRef.current = currentLocation;
      return () => clearTimeout(timer);
    }

    previousLocationRef.current = currentLocation;
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!shouldHydrateFromUrl) return;

    setPage(urlPage);
    setSyncedSearchParams(currentSearchParams);
  }, [shouldHydrateFromUrl, urlPage, currentSearchParams]);

  useEffect(() => {
    if (shouldHydrateFromUrl) {
      previousSearchQueryRef.current = searchQuery;
      previousRoleFilterRef.current = roleFilter;
      return;
    }

    if (previousSearchQueryRef.current !== searchQuery || previousRoleFilterRef.current !== roleFilter) {
      setPage(1);
      previousSearchQueryRef.current = searchQuery;
      previousRoleFilterRef.current = roleFilter;
    }
  }, [roleFilter, searchQuery, shouldHydrateFromUrl]);

  const handleRoleFilterChange = (filter: RoleFilter) => {
    const next = new URLSearchParams(searchParams);
    if (filter === 'All') {
      next.delete('role');
    } else {
      next.set('role', filter);
    }
    next.delete('page');
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    if (shouldHydrateFromUrl || isNavigatingViaHistory) return;
    const params: Record<string, string> = {};
    if (effectivePage > 1) params.page = String(effectivePage);
    if (searchQuery) params.search = searchQuery;
    if (roleFilter !== 'All') params.role = roleFilter;

    if (new URLSearchParams(params).toString() !== currentSearchParams) {
      setSearchParams(params, { replace: true });
    }
  }, [shouldHydrateFromUrl, isNavigatingViaHistory, effectivePage, searchQuery, roleFilter, currentSearchParams, setSearchParams]);

  const roleBadgeClass = (role: string) => {
    if (hasAdminAccess(role)) {
      return 'bg-purple-100 text-purple-700';
    }
    return 'bg-blue-100 text-blue-700';
  };

  const roleFilters: RoleFilter[] = useMemo(
    () => ['All', ...Array.from(new Set((usersPage?.roles || []).filter(Boolean))).sort()],
    [usersPage?.roles],
  );

  const nameOptions = useMemo(() => {
    return Array.from(new Set(allUsers.map((u) => u.name).filter(Boolean))) as string[];
  }, [allUsers]);

  const phoneOptions = useMemo(() => {
    return Array.from(new Set(allUsers.map((u) => u.phone).filter(Boolean))) as string[];
  }, [allUsers]);

  const genderOptions = useMemo(() => {
    const fromData = Array.from(new Set(allUsers.map((u) => u.gender).filter(Boolean))) as string[];
    const values = fromData.length > 0 ? fromData : ['Male', 'Female', 'Other'];
    return [
      ...values.map((value) => ({ value, label: value })),
      { value: '__not_specified__', label: 'Not Specified' },
    ];
  }, [allUsers]);

  const nationalityOptions = useMemo(() => {
    return Array.from(new Set(allUsers.map((u) => u.nationality).filter(Boolean))) as string[];
  }, [allUsers]);

  const bloodGroupOptions = useMemo(() => {
    const fromData = Array.from(new Set(allUsers.map((u) => u.bloodGroup).filter(Boolean))) as string[];
    const values = fromData.length > 0 ? fromData : ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
    return [
      ...values.map((value) => ({ value, label: value })),
      { value: '__not_specified__', label: 'Not Specified' },
    ];
  }, [allUsers]);

  const userFilterDefinitions = useMemo(() => {
    const roleOptions = (usersPage?.roles || []).filter(Boolean).sort().map((r) => ({ value: r, label: r }));

    return [
      {
        type: 'Role',
        operators: ['=', '≠'] as const,
        values: roleOptions,
      },
      {
        type: 'Name',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return nameOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Phone',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return phoneOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Joined',
        operators: ['on', 'before', 'after'] as const,
        valueType: 'date' as const,
      },
      {
        type: 'Gender',
        operators: ['=', '≠'] as const,
        values: genderOptions,
      },
      {
        type: 'Nationality',
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return nationalityOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Blood Group',
        operators: ['=', '≠'] as const,
        values: bloodGroupOptions,
      },
    ];
  }, [usersPage?.roles, nameOptions, phoneOptions, genderOptions, nationalityOptions, bloodGroupOptions]);

  const initialFilters = useMemo(() => {
    const filters = [];
    const decodeText = (encoded: string, negative = false) => {
      const { contains, value } = decodeDynamicTextFilterValue(encoded);
      return { operator: contains ? (negative ? 'does not contain' : 'contains') : (negative ? '≠' : '='), value };
    };
    if (roleFilter !== 'All') {
      filters.push({ id: 'role', type: 'Role', operator: '=' as const, value: roleFilter });
    }
    if (roleNotFilter) filters.push({ id: 'role-not', type: 'Role', operator: '≠' as const, value: roleNotFilter });
    if (nameFilter) {
      filters.push({ id: 'name', type: 'Name', ...decodeText(nameFilter) });
    }
    if (nameNotFilter) {
      filters.push({ id: 'name-not', type: 'Name', ...decodeText(nameNotFilter, true) });
    }
    if (phoneFilter) {
      filters.push({ id: 'phone', type: 'Phone', ...decodeText(phoneFilter) });
    }
    if (phoneNotFilter) {
      filters.push({ id: 'phone-not', type: 'Phone', ...decodeText(phoneNotFilter, true) });
    }
    if (joinedFilter) {
      filters.push({ id: 'joined', type: 'Joined', operator: joinedFilter.operator as any, value: joinedFilter.value, display: formatDateDisplay(joinedFilter.value) });
    }
    if (genderFilter) {
      filters.push({ id: 'gender', type: 'Gender', operator: '=' as const, value: genderFilter, display: genderFilter === '__not_specified__' ? 'Not Specified' : genderFilter });
    }
    if (genderNotFilter) {
      filters.push({ id: 'gender-not', type: 'Gender', operator: '≠' as const, value: genderNotFilter, display: genderNotFilter === '__not_specified__' ? 'Not Specified' : genderNotFilter });
    }
    if (nationalityFilter) {
      filters.push({ id: 'nationality', type: 'Nationality', ...decodeText(nationalityFilter) });
    }
    if (nationalityNotFilter) {
      filters.push({ id: 'nationality-not', type: 'Nationality', ...decodeText(nationalityNotFilter, true) });
    }
    if (bloodGroupFilter) {
      filters.push({ id: 'blood-group', type: 'Blood Group', operator: '=' as const, value: bloodGroupFilter, display: bloodGroupFilter === '__not_specified__' ? 'Not Specified' : bloodGroupFilter });
    }
    if (bloodGroupNotFilter) {
      filters.push({ id: 'blood-group-not', type: 'Blood Group', operator: '≠' as const, value: bloodGroupNotFilter, display: bloodGroupNotFilter === '__not_specified__' ? 'Not Specified' : bloodGroupNotFilter });
    }
    return filters;
  }, [roleFilter, roleNotFilter, nameFilter, nameNotFilter, phoneFilter, phoneNotFilter, joinedFilter, genderFilter, genderNotFilter, nationalityFilter, nationalityNotFilter, bloodGroupFilter, bloodGroupNotFilter]);

  const displayedUsers = users;

  return (
    <div className="space-y-6">
      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <DynamicFilterBar
            filterDefinitions={userFilterDefinitions}
            initialFilters={initialFilters}
            onApply={(appliedFilters) => {
              setPage(1);
              const encodeTextValue = (filter: { operator: string; value: string }) => encodeDynamicTextFilterValue(filter.value, filter.operator.includes('contain'));

              const roleEqFilter = appliedFilters.find((f) => f.type === 'Role' && f.operator === '=');
              const roleNeFilter = appliedFilters.find((f) => f.type === 'Role' && f.operator === '≠');
              if (roleEqFilter) {
                handleRoleFilterChange(roleEqFilter.value);
              } else if (roleNeFilter) {
                handleRoleFilterChange('All');
                setRoleNotFilter(roleNeFilter.value);
              } else {
                handleRoleFilterChange('All');
                setRoleNotFilter('');
              }
              if (roleEqFilter) setRoleNotFilter('');

              const nameFilter = appliedFilters.find((f) => f.type === 'Name' && (f.operator === '=' || f.operator === 'contains'));
              const nameNotFilter = appliedFilters.find((f) => f.type === 'Name' && (f.operator === '≠' || f.operator === 'does not contain'));
              setNameFilter(nameFilter ? encodeTextValue(nameFilter) : '');
              setNameNotFilter(nameNotFilter ? encodeTextValue(nameNotFilter) : '');

              const phoneFilter = appliedFilters.find((f) => f.type === 'Phone' && (f.operator === '=' || f.operator === 'contains'));
              const phoneNotFilter = appliedFilters.find((f) => f.type === 'Phone' && (f.operator === '≠' || f.operator === 'does not contain'));
              setPhoneFilter(phoneFilter ? encodeTextValue(phoneFilter) : '');
              setPhoneNotFilter(phoneNotFilter ? encodeTextValue(phoneNotFilter) : '');

              const joinedFilter = appliedFilters.find((f) => f.type === 'Joined');
              setJoinedFilter(joinedFilter ? { operator: joinedFilter.operator, value: joinedFilter.value } : null);

              const genderFilter = appliedFilters.find((f) => f.type === 'Gender' && f.operator === '=');
              const genderNotFilter = appliedFilters.find((f) => f.type === 'Gender' && f.operator === '≠');
              setGenderFilter(genderFilter?.value ?? '');
              setGenderNotFilter(genderNotFilter?.value ?? '');

              const nationalityFilter = appliedFilters.find((f) => f.type === 'Nationality' && (f.operator === '=' || f.operator === 'contains'));
              const nationalityNotFilter = appliedFilters.find((f) => f.type === 'Nationality' && (f.operator === '≠' || f.operator === 'does not contain'));
              setNationalityFilter(nationalityFilter ? encodeTextValue(nationalityFilter) : '');
              setNationalityNotFilter(nationalityNotFilter ? encodeTextValue(nationalityNotFilter) : '');

              const bloodGroupFilter = appliedFilters.find((f) => f.type === 'Blood Group' && f.operator === '=');
              const bloodGroupNotFilter = appliedFilters.find((f) => f.type === 'Blood Group' && f.operator === '≠');
              setBloodGroupFilter(bloodGroupFilter?.value ?? '');
              setBloodGroupNotFilter(bloodGroupNotFilter?.value ?? '');
            }}
          />
        </div>
        <button
          onClick={handleRefreshUsers}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold text-gray-500 bg-white border border-gray-100 shadow-sm hover:bg-gray-50 transition-all disabled:opacity-50"
          title="Refresh"
        >
          <svg className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          Refresh
        </button>
        {canCreateUsers && (
          <Button
            onClick={() => navigate('/users/new')}
            variant="primary"
            size="md"
            icon={ICONS.Plus}
          >
            Add User
          </Button>
        )}
      </div>

      <Table
        columns={[
          {
            key: 'name',
            label: 'User',
            render: (_, user) => (
              <div className="flex items-center gap-4">
                <img
                  src={user.image || '/uploads/Empty_avatar.png'}
                  className="w-10 h-10 rounded-full object-cover border"
                />
                <span className="font-bold text-gray-900">{user.name}</span>
              </div>
            ),
          },
          {
            key: 'role',
            label: 'Role',
            render: (role) => (
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${roleBadgeClass(String(role || ''))}`}
              >
                {role}
              </span>
            ),
          },
          {
            key: 'phone',
            label: 'Contact',
            render: (phone) => <span className="text-sm text-gray-600">{phone}</span>,
          },
          {
            key: 'id',
            label: 'Actions',
            align: 'right',
            render: (userId) => (
              canEditUsers ? (
                <IconButton
                  icon={ICONS.Edit}
                  variant="primary"
                  title="Edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/users/edit/${userId}`);
                  }}
                />
              ) : null
            ),
          },
        ]}
        data={users}
        onRowHover={(candidate) => {
          queryClient.prefetchQuery({
            queryKey: ['user', candidate.id],
            queryFn: () => fetchUserById(candidate.id),
            staleTime: 5 * 60 * 1000,
          }).catch(() => {});
        }}
        onRowClick={(user) => navigate(`/users/${user.id}`, { state: buildHistoryBackState(location) })}
        emptyMessage="No users found"
        loading={!canLoadUsers || loading}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500">
          {total === 0 ? 'Showing 0 users' : `Showing ${(effectivePage - 1) * pageSize + 1} - ${Math.min(effectivePage * pageSize, total)} of ${total} users`}
        </p>
        <Pagination page={effectivePage} totalPages={totalPages} onPageChange={(nextPage) => setPage(nextPage)} disabled={loading} />
      </div>
    </div>
  );
};

export default Users;
