
import React, { useState, useMemo, useEffect } from 'react';
import PortalMenu from '../components/PortalMenu';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '../db';
import { Bill, BillStatus, hasAdminAccess, isEmployeeRole } from '../types';
import { formatCurrency, ICONS, getStatusColor } from '../constants';
import FilterBar, { FilterRange } from '../components/FilterBar';
import { Button, TableLoadingSkeleton } from '../components';
import { theme } from '../theme';
import { useBillsPage, useUsers, useSystemDefaults } from '../src/hooks/useQueries';
import Pagination from '../src/components/Pagination';
import { useCreateBill, useDeleteBill } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { DEFAULT_PAGE_SIZE, fetchBillById } from '../src/services/supabaseQueries';
import { useUrlSyncedSearchQuery } from '../src/hooks/useUrlSyncedSearchQuery';
import { buildHistoryBackState, getPositivePageParam } from '../src/utils/navigation';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { formatDate, getBillActivityDate, getDateTimeFilters, getTodayDate } from '../utils';

const Bills: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const toast = useToastNotifications();
  const user = db.currentUser;
  const { can, canAccessRecord } = useRolePermissions();
  const canCreateBills = can('bills.create');
  const {
    data: systemDefaults,
    isPending: systemDefaultsLoading,
    isError: systemDefaultsError,
  } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const canLoadBills = !systemDefaultsLoading || !!systemDefaults || systemDefaultsError;
  const [searchParams, setSearchParams] = useSearchParams();
  const currentSearchParams = searchParams.toString();
  const urlPage = getPositivePageParam(searchParams.get('page'));
  const urlFilterRange = (searchParams.get('range') as FilterRange | null) || 'All Time';
  const urlCustomDates = {
    from: searchParams.get('from') || '',
    to: searchParams.get('to') || '',
  };
  const urlStatusTab = (searchParams.get('status') as BillStatus | null) || 'All';
  const urlCreatedByFilter = searchParams.get('createdBy') || 'all';
  const { searchQuery } = useUrlSyncedSearchQuery(searchParams.get('search') || '');
  const [syncedSearchParams, setSyncedSearchParams] = useState<string | null>(null);
  const shouldHydrateFromUrl = syncedSearchParams !== currentSearchParams;
  const [page, setPage] = useState<number>(urlPage);
  const [filterRange, setFilterRange] = useState<FilterRange>(urlFilterRange);
  const [customDates, setCustomDates] = useState(urlCustomDates);
  const [statusTab, setStatusTab] = useState<BillStatus | 'All'>(urlStatusTab);
  const [createdByFilter, setCreatedByFilter] = useState<string>(urlCreatedByFilter);
  const previousSearchQueryRef = React.useRef(searchQuery);
  
  const { data: users = [] } = useUsers();

  useEffect(() => {
    if (!shouldHydrateFromUrl) return;

    setPage(urlPage);
    setFilterRange(urlFilterRange);
    setCustomDates(urlCustomDates);
    setStatusTab(urlStatusTab);
    setCreatedByFilter(urlCreatedByFilter);
    setSyncedSearchParams(currentSearchParams);
  }, [
    shouldHydrateFromUrl,
    urlPage,
    urlFilterRange,
    urlCustomDates,
    urlStatusTab,
    urlCreatedByFilter,
    currentSearchParams,
  ]);

  useEffect(() => {
    if (shouldHydrateFromUrl) {
      previousSearchQueryRef.current = searchQuery;
      return;
    }

    if (previousSearchQueryRef.current !== searchQuery) {
      setPage(1);
      previousSearchQueryRef.current = searchQuery;
    }
  }, [searchQuery, shouldHydrateFromUrl]);

  const effectivePage = shouldHydrateFromUrl ? urlPage : page;
  const effectiveFilterRange = shouldHydrateFromUrl ? urlFilterRange : filterRange;
  const effectiveCustomDates = shouldHydrateFromUrl ? urlCustomDates : customDates;
  const effectiveStatusTab = shouldHydrateFromUrl ? urlStatusTab : statusTab;
  const effectiveCreatedByFilter = shouldHydrateFromUrl ? urlCreatedByFilter : createdByFilter;
  const timeFilters = useMemo(
    () => getDateTimeFilters(effectiveFilterRange, effectiveCustomDates),
    [effectiveFilterRange, effectiveCustomDates]
  );

  // Compute createdByIds based on createdByFilter
  const createdByIds = useMemo(() => {
    if (effectiveCreatedByFilter === 'all') return undefined;
    if (effectiveCreatedByFilter === 'admins') {
      return users.filter((u) => u.role === 'Admin').map((u) => u.id);
    }
    if (effectiveCreatedByFilter === 'employees') {
      return users.filter((u) => isEmployeeRole(u.role)).map((u) => u.id);
    }
    if (effectiveCreatedByFilter === 'developers') {
      return users.filter(u => u.role === 'Developer').map(u => u.id);
    }
    // Specific user ID
    return [effectiveCreatedByFilter];
  }, [effectiveCreatedByFilter, users]);

  const { data: billsPage, isFetching: billsLoading } = useBillsPage(effectivePage, pageSize, {
    status: effectiveStatusTab === 'All' ? undefined : effectiveStatusTab,
    from: timeFilters.from,
    to: timeFilters.to,
    search: searchQuery,
    createdByIds,
  }, {
    enabled: canLoadBills,
  });
  const bills = billsPage?.data ?? [];
  const showBillsTableLoading = !canLoadBills || billsLoading;
  const total = billsPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    if (shouldHydrateFromUrl) return;

    const params: Record<string, string> = {};
    if (effectivePage > 1) params.page = String(effectivePage);
    if (effectiveFilterRange !== 'All Time') params.range = effectiveFilterRange;
    if (effectiveCustomDates.from) params.from = effectiveCustomDates.from;
    if (effectiveCustomDates.to) params.to = effectiveCustomDates.to;
    if (effectiveStatusTab !== 'All') params.status = effectiveStatusTab;
    if (effectiveCreatedByFilter !== 'all') params.createdBy = effectiveCreatedByFilter;
    if (searchQuery) params.search = searchQuery;

    if (new URLSearchParams(params).toString() !== currentSearchParams) {
      setSearchParams(params, { replace: true });
    }
  }, [
    shouldHydrateFromUrl,
    effectivePage,
    effectiveFilterRange,
    effectiveCustomDates.from,
    effectiveCustomDates.to,
    effectiveStatusTab,
    effectiveCreatedByFilter,
    searchQuery,
    currentSearchParams,
    setSearchParams,
  ]);

  // Wrapper functions that reset page AND apply filter (atomic operation)
  const handleStatusTabChange = (newStatus: BillStatus | 'All') => {
    setPage(1);
    setStatusTab(newStatus);
  };

  const handleFilterRangeChange = (range: FilterRange) => {
    setPage(1);
    setFilterRange(range);
    // Clear customDates when switching away from 'Custom' to prevent stale date values
    if (range !== 'Custom') {
      setCustomDates({ from: '', to: '' });
    }
  };

  const handleCustomDatesChange = (dates: { from: string; to: string }) => {
    setPage(1);
    setCustomDates(dates);
  };

  const handleCreatedByFilterChange = (filter: string) => {
    setPage(1);
    setCreatedByFilter(filter);
  };

  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [openActionsMenu, setOpenActionsMenu] = useState<string | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const createMutation = useCreateBill();
  const deleteMutation = useDeleteBill();

  // Create a Map for O(1) user lookups instead of O(n) array searching
  const userMap = useMemo(() => {
    return new Map(users.map(u => [u.id, u]));
  }, [users]);

  // Helper to get creator name from createdBy field or history
  const getCreatorName = (bill: Bill) => {
    // First try to lookup from createdBy database field using O(1) Map lookup
    if (bill.createdBy?.trim()) {
      const user = userMap.get(bill.createdBy);
      if (user?.name) return user.name;
    }
    
    // Fallback: extract from history for older records
    if (bill.history?.created) {
      // Bills history format: "Created by {name} on ..."
      const match = bill.history.created.match(/Created by\s+(.+?)\s+on/);
      if (match && match[1]) return match[1];
    }
    
    return null;
  };

  // Server-side filtering applied; keep client-side logic minimal
  const filteredBills = bills;

  const handleDuplicate = async (bill: Bill) => {
    try {
      const sourceBill = await fetchBillById(bill.id);
      if (!sourceBill) {
        toast.error('Unable to load the source bill for duplication.');
        return;
      }

      const now = new Date();
      const dateStr = now.toLocaleDateString('en-BD', { day: 'numeric', month: 'short', year: 'numeric' });
      const timeStr = now.toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit' });
      
      const newBillData: Omit<Bill, 'id'> = {
        billNumber: `PUR-${Math.floor(1000 + Math.random() * 9000)}`,
        billDate: getTodayDate(),
        vendorId: sourceBill.vendorId,
        createdBy: user?.id || sourceBill.createdBy,
        status: BillStatus.ON_HOLD,
        items: sourceBill.items,
        subtotal: sourceBill.subtotal,
        discount: sourceBill.discount,
        shipping: sourceBill.shipping,
        total: sourceBill.total,
        paidAmount: 0,
        notes: sourceBill.notes,
        history: {
          created: `Created as duplicate on ${dateStr}, at ${timeStr}`
        }
      };

      await createMutation.mutateAsync(newBillData as any);
      // Cache updated deterministically by mutation hook
    } catch (error) {
      console.error('Failed to duplicate bill:', error);
      toast.error('Failed to duplicate bill');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Move this bill to the recycle bin? You can restore it later.')) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Bill moved to the recycle bin');
      // Cache updated deterministically by mutation hook
    } catch (error) {
      console.error('Failed to delete bill:', error);
      toast.error('Failed to delete bill');
    }
  };

  const canEditBill = (bill: Bill) =>
    canAccessRecord(bill.createdBy, 'bills.editOwn', 'bills.editAny');

  const canDeleteBill = (bill: Bill) =>
    canAccessRecord(bill.createdBy, 'bills.deleteOwn', 'bills.deleteAny');

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div>
            <h2 className="md:text-2xl text-xl font-black text-gray-900 tracking-tight">Purchase Bills</h2>
          </div>
          <div className="hidden sm:block">
            <FilterBar 
              title="Bills"
              filterRange={effectiveFilterRange}
              setFilterRange={handleFilterRangeChange}
              customDates={effectiveCustomDates}
              setCustomDates={handleCustomDatesChange}
              statusTab={effectiveStatusTab}
              setStatusTab={handleStatusTabChange}
              statusOptions={Object.values(BillStatus)}
              compact={true}
            />
          </div>
        </div>
        {canCreateBills && (
          <Button
            onClick={() => navigate('/bills/new')}
            variant="primary"
            size="md"
            icon={ICONS.Plus}
          >
            New Bill
          </Button>
        )}
      </div>
      <div className="sm:hidden">
        <FilterBar 
          title="Bills"
          filterRange={effectiveFilterRange}
          setFilterRange={handleFilterRangeChange}
          customDates={effectiveCustomDates}
          setCustomDates={handleCustomDatesChange}
          statusTab={effectiveStatusTab}
          setStatusTab={handleStatusTabChange}
          statusOptions={Object.values(BillStatus)}
        />
      </div>

      {/* Created By Filter Dropdown */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <div className="flex items-center gap-4 flex-wrap">
          <label className="text-sm font-bold text-gray-700">Created By:</label>
          <select
            value={effectiveCreatedByFilter}
            onChange={(e) => handleCreatedByFilterChange(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Users</option>
            {users.some((u) => u.role === 'Admin') && <option value="admins">Admins</option>}
            {users.some((u) => isEmployeeRole(u.role)) && <option value="employees">Employees</option>}
            {users.some((user) => user.role === 'Developer') && <option value="developers">Developers</option>}
            <optgroup label="Specific Users">
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-visible">
        <div className="overflow-x-auto overflow-y-visible">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Bill Details</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Vendor</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Created By</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Status</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] text-right">Net Amount</th>
                <th className="px-6 py-5 text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] sm:hidden">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {showBillsTableLoading ? (
                <TableLoadingSkeleton columns={5} rows={8} />
              ) : filteredBills.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-20 text-center text-gray-400 italic font-medium">No purchase bills found for this period.</td></tr>
              ) : filteredBills.map((bill) => {
                const canEditSelectedBill = canEditBill(bill);
                const canDeleteSelectedBill = canDeleteBill(bill);
                const hasRowActions = canEditSelectedBill || canDeleteSelectedBill;

                return (
                <tr 
                  key={bill.id} 
                  onMouseEnter={() => {
                    setHoveredRow(bill.id);
                    queryClient.prefetchQuery({
                      queryKey: ['bill', bill.id],
                      queryFn: () => fetchBillById(bill.id),
                      staleTime: 5 * 60 * 1000,
                    }).catch(() => {});
                  }} 
                  onMouseLeave={() => setHoveredRow(null)} 
                  onClick={() => navigate(`/bills/${bill.id}`, { state: buildHistoryBackState(location) })} 
                  className="group relative hover:bg-[#ebf4ff]/20 cursor-pointer transition-all"
                >
                  <td className="px-6 py-5">
                    <span className="font-black text-gray-900">#{bill.billNumber}</span>
                    <p className="text-[10px] text-gray-400 font-bold mt-1 tracking-tight">{formatDate(getBillActivityDate(bill))}</p>
                  </td>
                  <td className="px-6 py-5">
                    <span className="text-sm font-bold text-gray-700">{bill.vendorName || 'Unknown Vendor'}</span>
                    <p className="text-[10px] text-gray-400 font-medium mt-0.5">{bill.vendorPhone || ''}</p>
                  </td>
                  <td className="px-6 py-5 text-xs font-bold text-gray-500">{bill.creatorName || getCreatorName(bill) || '—'}</td>
                  <td className="px-6 py-5">
                    <span className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${getStatusColor(bill.status)}`}>{bill.status}</span>
                  </td>
                  <td className="px-6 py-5 text-right">
                    <span className="font-black text-gray-900 text-base">{formatCurrency(bill.total)}</span>
                  </td>

                  {/* Mobile Actions Dropdown */}
                  <td className="px-6 py-5 sm:hidden relative z-[999]" onClick={e => e.stopPropagation()}>
                    {hasRowActions && (
                      <div className="relative z-[999]">
                        <button
                          onClick={(e) => {
                            const target = e.currentTarget as HTMLElement;
                            if (openActionsMenu === bill.id) {
                              setOpenActionsMenu(null);
                              setAnchorEl(null);
                            } else {
                              setOpenActionsMenu(bill.id);
                              setAnchorEl(target);
                            }
                          }}
                          className="p-2 text-gray-400 hover:text-[#0f2f57] hover:bg-[#ebf4ff] rounded-lg transition-all"
                        >
                          {ICONS.More}
                        </button>
                        <PortalMenu anchorEl={anchorEl} open={openActionsMenu === bill.id} onClose={() => { setOpenActionsMenu(null); setAnchorEl(null); }}>
                          {canEditSelectedBill && <button onClick={() => { navigate(`/bills/edit/${bill.id}`); setOpenActionsMenu(null); setAnchorEl(null); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-gray-700">{ICONS.Edit} Edit</button>}
                          {canDeleteSelectedBill && (
                            <>
                              {canEditSelectedBill && <div className="border-t my-1"></div>}
                              <button onClick={() => { handleDelete(bill.id); setOpenActionsMenu(null); setAnchorEl(null); }} className="w-full text-left px-4 py-2.5 text-sm hover:bg-red-50 flex items-center gap-2 font-bold text-red-600">{ICONS.Delete} Delete</button>
                            </>
                          )}
                        </PortalMenu>
                      </div>
                    )}
                  </td>

                  {/* Desktop Hover Actions */}
                  {hoveredRow === bill.id && hasRowActions && (
                    <td className="absolute right-6 top-1/2 -translate-y-1/2 z-10 animate-in fade-in slide-in-from-right-2 duration-200 hidden sm:table-cell" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5 bg-white p-1.5 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-[#ebf4ff]">
                        {canEditSelectedBill && <button onClick={() => navigate(`/bills/edit/${bill.id}`)} className="p-2.5 text-gray-400 hover:text-[#0f2f57] hover:bg-[#ebf4ff] rounded-xl transition-all" title="Edit">{ICONS.Edit}</button>}
                        {canDeleteSelectedBill && (
                          <>
                            {canEditSelectedBill && <div className="h-5 w-px bg-gray-100 mx-1"></div>}
                            <button onClick={() => handleDelete(bill.id)} className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all" title="Delete">{ICONS.Delete}</button>
                          </>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <Pagination page={effectivePage} totalPages={totalPages} onPageChange={(p) => setPage(p)} disabled={billsLoading} />
    </div>
  );
};

export default Bills;



