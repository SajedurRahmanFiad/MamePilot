
import React, { useEffect, useMemo, useRef } from 'react';
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
  const { data: usersPage, isFetching: loading } = useUsersPage(
    effectivePage,
    pageSize,
    {
      search: searchQuery || undefined,
      role: roleFilter !== 'All' ? roleFilter : undefined,
    },
    { enabled: canLoadUsers },
  );
  const users = usersPage?.data || [];
  const total = usersPage?.count || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
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

  const nameOptions = useMemo(() => {
    return Array.from(new Set(allUsers.map((u) => u.name).filter(Boolean))) as string[];
  }, [allUsers]);

  const phoneOptions = useMemo(() => {
    return Array.from(new Set(allUsers.map((u) => u.phone).filter(Boolean))) as string[];
  }, [allUsers]);

  const genderOptions = useMemo(() => {
    const fromData = Array.from(new Set(allUsers.map((u) => u.gender).filter(Boolean))) as string[];
    return fromData.length > 0 ? fromData : ['Male', 'Female', 'Other', 'Not Specified'];
  }, [allUsers]);

  const nationalityOptions = useMemo(() => {
    return Array.from(new Set(allUsers.map((u) => u.nationality).filter(Boolean))) as string[];
  }, [allUsers]);

  const bloodGroupOptions = useMemo(() => {
    const fromData = Array.from(new Set(allUsers.map((u) => u.bloodGroup).filter(Boolean))) as string[];
    return fromData.length > 0 ? fromData : ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Not Specified'];
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
        operators: ['=', '≠'] as const,
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
        operators: ['=', '≠'] as const,
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
        operators: ['=', '≠'] as const,
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
    if (roleFilter !== 'All') {
      filters.push({ id: 'role', type: 'Role', operator: '=' as const, value: roleFilter });
    }
    if (nameFilter) {
      filters.push({ id: 'name', type: 'Name', operator: '=' as const, value: nameFilter });
    }
    if (nameNotFilter) {
      filters.push({ id: 'name-not', type: 'Name', operator: '≠' as const, value: nameNotFilter });
    }
    if (phoneFilter) {
      filters.push({ id: 'phone', type: 'Phone', operator: '=' as const, value: phoneFilter });
    }
    if (phoneNotFilter) {
      filters.push({ id: 'phone-not', type: 'Phone', operator: '≠' as const, value: phoneNotFilter });
    }
    if (joinedFilter) {
      filters.push({ id: 'joined', type: 'Joined', operator: joinedFilter.operator as any, value: joinedFilter.value, display: formatDateDisplay(joinedFilter.value) });
    }
    if (genderFilter) {
      filters.push({ id: 'gender', type: 'Gender', operator: '=' as const, value: genderFilter });
    }
    if (genderNotFilter) {
      filters.push({ id: 'gender-not', type: 'Gender', operator: '≠' as const, value: genderNotFilter });
    }
    if (nationalityFilter) {
      filters.push({ id: 'nationality', type: 'Nationality', operator: '=' as const, value: nationalityFilter });
    }
    if (nationalityNotFilter) {
      filters.push({ id: 'nationality-not', type: 'Nationality', operator: '≠' as const, value: nationalityNotFilter });
    }
    if (bloodGroupFilter) {
      filters.push({ id: 'blood-group', type: 'Blood Group', operator: '=' as const, value: bloodGroupFilter });
    }
    if (bloodGroupNotFilter) {
      filters.push({ id: 'blood-group-not', type: 'Blood Group', operator: '≠' as const, value: bloodGroupNotFilter });
    }
    return filters;
  }, [roleFilter, nameFilter, nameNotFilter, phoneFilter, phoneNotFilter, joinedFilter, genderFilter, genderNotFilter, nationalityFilter, nationalityNotFilter, bloodGroupFilter, bloodGroupNotFilter]);

  // Client-side filters for Name, Phone, and other fields
  const displayedUsers = useMemo(() => {
    let filtered = users;

    if (nameFilter) {
      filtered = filtered.filter((u) => u.name?.toLowerCase().includes(nameFilter.toLowerCase()));
    }
    if (nameNotFilter) {
      filtered = filtered.filter((u) => !u.name?.toLowerCase().includes(nameNotFilter.toLowerCase()));
    }
    if (phoneFilter) {
      filtered = filtered.filter((u) => u.phone?.toLowerCase().includes(phoneFilter.toLowerCase()));
    }
    if (phoneNotFilter) {
      filtered = filtered.filter((u) => !u.phone?.toLowerCase().includes(phoneNotFilter.toLowerCase()));
    }

    // Date filter for Joined
    if (joinedFilter) {
      const filterDate = new Date(joinedFilter.value);
      if (!isNaN(filterDate.getTime())) {
        filtered = filtered.filter((u) => {
          if (!u.createdAt) return false;
          const userDate = new Date(u.createdAt);
          const filterDateStr = joinedFilter.value;
          const userDateStr = userDate.toISOString().split('T')[0];
          switch (joinedFilter.operator) {
            case 'on': return userDateStr === filterDateStr;
            case 'before': return userDateStr < filterDateStr;
            case 'after': return userDateStr > filterDateStr;
            default: return true;
          }
        });
      }
    }

    // Gender filter
    if (genderFilter) {
      filtered = filtered.filter((u) => u.gender?.toLowerCase() === genderFilter.toLowerCase());
    }
    if (genderNotFilter) {
      filtered = filtered.filter((u) => u.gender?.toLowerCase() !== genderNotFilter.toLowerCase());
    }

    // Nationality filter
    if (nationalityFilter) {
      filtered = filtered.filter((u) => u.nationality?.toLowerCase().includes(nationalityFilter.toLowerCase()));
    }
    if (nationalityNotFilter) {
      filtered = filtered.filter((u) => !u.nationality?.toLowerCase().includes(nationalityNotFilter.toLowerCase()));
    }

    // Blood Group filter
    if (bloodGroupFilter) {
      filtered = filtered.filter((u) => u.bloodGroup?.toLowerCase() === bloodGroupFilter.toLowerCase());
    }
    if (bloodGroupNotFilter) {
      filtered = filtered.filter((u) => u.bloodGroup?.toLowerCase() !== bloodGroupNotFilter.toLowerCase());
    }

    return filtered;
  }, [users, nameFilter, nameNotFilter, phoneFilter, phoneNotFilter, joinedFilter, genderFilter, genderNotFilter, nationalityFilter, nationalityNotFilter, bloodGroupFilter, bloodGroupNotFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <DynamicFilterBar
            filterDefinitions={userFilterDefinitions}
            initialFilters={initialFilters}
            onApply={(appliedFilters) => {
              setPage(1);

              const roleEqFilter = appliedFilters.find((f) => f.type === 'Role' && f.operator === '=');
              const roleNeFilter = appliedFilters.find((f) => f.type === 'Role' && f.operator === '≠');
              if (roleEqFilter) {
                handleRoleFilterChange(roleEqFilter.value);
              } else if (roleNeFilter) {
                handleRoleFilterChange('All');
              } else {
                handleRoleFilterChange('All');
              }

              const nameFilter = appliedFilters.find((f) => f.type === 'Name' && f.operator === '=');
              const nameNotFilter = appliedFilters.find((f) => f.type === 'Name' && f.operator === '≠');
              setNameFilter(nameFilter?.value ?? '');
              setNameNotFilter(nameNotFilter?.value ?? '');

              const phoneFilter = appliedFilters.find((f) => f.type === 'Phone' && f.operator === '=');
              const phoneNotFilter = appliedFilters.find((f) => f.type === 'Phone' && f.operator === '≠');
              setPhoneFilter(phoneFilter?.value ?? '');
              setPhoneNotFilter(phoneNotFilter?.value ?? '');

              const joinedFilter = appliedFilters.find((f) => f.type === 'Joined');
              setJoinedFilter(joinedFilter ? { operator: joinedFilter.operator, value: joinedFilter.value } : null);

              const genderFilter = appliedFilters.find((f) => f.type === 'Gender' && f.operator === '=');
              const genderNotFilter = appliedFilters.find((f) => f.type === 'Gender' && f.operator === '≠');
              setGenderFilter(genderFilter?.value ?? '');
              setGenderNotFilter(genderNotFilter?.value ?? '');

              const nationalityFilter = appliedFilters.find((f) => f.type === 'Nationality' && f.operator === '=');
              const nationalityNotFilter = appliedFilters.find((f) => f.type === 'Nationality' && f.operator === '≠');
              setNationalityFilter(nationalityFilter?.value ?? '');
              setNationalityNotFilter(nationalityNotFilter?.value ?? '');

              const bloodGroupFilter = appliedFilters.find((f) => f.type === 'Blood Group' && f.operator === '=');
              const bloodGroupNotFilter = appliedFilters.find((f) => f.type === 'Blood Group' && f.operator === '≠');
              setBloodGroupFilter(bloodGroupFilter?.value ?? '');
              setBloodGroupNotFilter(bloodGroupNotFilter?.value ?? '');
            }}
          />
        </div>
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
