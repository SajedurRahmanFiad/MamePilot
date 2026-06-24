
import React, { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { hasAdminAccess } from '../types';
import { ICONS } from '../constants';
import { Button, Table, IconButton } from '../components';
import Pagination from '../src/components/Pagination';
import { theme } from '../theme';
import { useAuth } from '../src/contexts/AuthProvider';
import { useSystemDefaults, useUsersPage } from '../src/hooks/useQueries';
import { useUrlSyncedSearchQuery } from '../src/hooks/useUrlSyncedSearchQuery';
import { DEFAULT_PAGE_SIZE, fetchUserById } from '../src/services/supabaseQueries';
import { buildHistoryBackState, getPositivePageParam } from '../src/utils/navigation';

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Application Users</h2>
        </div>
        {isAdmin && (
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

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3">
        <div className="flex flex-wrap items-center gap-2">
          {roleFilters.map((filter) => (
            <button
              key={filter}
              onClick={() => handleRoleFilterChange(filter)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                roleFilter === filter
                  ? `${theme.colors.primary[600]} text-white shadow-md`
                  : 'text-gray-500 hover:bg-gray-50'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
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
              <IconButton
                icon={ICONS.Edit}
                variant="primary"
                title="Edit"
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/users/edit/${userId}`);
                }}
              />
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
      <Pagination page={effectivePage} totalPages={totalPages} onPageChange={(nextPage) => setPage(nextPage)} disabled={loading} />
    </div>
  );
};

export default Users;
