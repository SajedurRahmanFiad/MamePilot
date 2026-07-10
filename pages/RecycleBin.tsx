import React, { useEffect, useState, useMemo } from 'react';
import { Button, Table } from '../components';
import DynamicFilterBar, { formatDateDisplay } from '../components/DynamicFilterBar';
import { ICONS } from '../constants';
import Pagination from '../src/components/Pagination';
import { useAuth } from '../src/contexts/AuthProvider';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { usePermanentlyDeleteDeletedItem, useRestoreDeletedItem } from '../src/hooks/useMutations';
import { useRecycleBinPage, useSystemDefaults } from '../src/hooks/useQueries';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { RecycleBinEntityType, RecycleBinItem, hasAdminAccess } from '../types';
import { useRolePermissions } from '../src/hooks/useRolePermissions';

const ENTITY_LABELS: Record<RecycleBinEntityType, string> = {
  customer: 'Customer',
  order: 'Order',
  bill: 'Bill',
  transaction: 'Transaction',
  user: 'User',
  vendor: 'Vendor',
  product: 'Product',
};

const ENTITY_BADGES: Record<RecycleBinEntityType, string> = {
  customer: 'bg-blue-100 text-blue-700',
  order: 'bg-emerald-100 text-emerald-700',
  bill: 'bg-amber-100 text-amber-700',
  transaction: 'bg-violet-100 text-violet-700',
  user: 'bg-rose-100 text-rose-700',
  vendor: 'bg-cyan-100 text-cyan-700',
  product: 'bg-slate-100 text-slate-700',
};

const formatTimestamp = (value?: string): string => {
  if (!value) return '-';
  return new Date(value).toLocaleString('en-BD', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const RecycleBin: React.FC = () => {
  const { user } = useAuth();
  const toast = useToastNotifications();
  const { data: systemDefaults } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const restoreMutation = useRestoreDeletedItem();
  const permanentlyDeleteMutation = usePermanentlyDeleteDeletedItem();

  const [page, setPage] = useState<number>(1);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'all' | RecycleBinEntityType>('all');
  const [typeNotFilter, setTypeNotFilter] = useState<string>('');
  const [deletedByFilter, setDeletedByFilter] = useState<string>('');
  const [deletedByNotFilter, setDeletedByNotFilter] = useState<string>('');
  const [titleFilter, setTitleFilter] = useState<string>('');
  const [titleNotFilter, setTitleNotFilter] = useState<string>('');
  const [deletedDateFilter, setDeletedDateFilter] = useState<{ operator: string; value: string } | null>(null);
  const deferredSearchQuery = React.useDeferredValue(searchQuery);

  const { canRestoreRecords, canDeletePermanent } = useRolePermissions();
  const isAdmin = hasAdminAccess(user?.role);
  const isMutating = restoreMutation.isPending || permanentlyDeleteMutation.isPending;
  const { data: recycleBinPage = { data: [], count: 0 }, isPending, isFetching } = useRecycleBinPage(
    page,
    pageSize,
    {
      enabled: isAdmin,
      search: deferredSearchQuery,
      entityType: typeFilter,
    }
  );
  const visibleItems = recycleBinPage.data;
  const totalItems = recycleBinPage.count;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const deletedByOptions = useMemo(() => {
    return Array.from(new Set(visibleItems.map((item) => item.deletedByName || item.deletedBy).filter(Boolean))) as string[];
  }, [visibleItems]);

  const titleOptions = useMemo(() => {
    return Array.from(new Set(visibleItems.map((item) => item.title).filter(Boolean))) as string[];
  }, [visibleItems]);

  const recycleBinFilterDefinitions = useMemo(() => {
    const entityTypeOptions = Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label }));

    return [
      {
        type: 'Entity Type',
        operators: ['=', '≠'] as const,
        values: entityTypeOptions,
      },
      {
        type: 'Deleted by',
        operators: ['=', '≠'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return deletedByOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Title',
        operators: ['=', '≠'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return titleOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Deleted',
        operators: ['on', 'before', 'after'] as const,
        valueType: 'date' as const,
      },
    ];
  }, [deletedByOptions, titleOptions]);

  const initialFilters = useMemo(() => {
    const filters = [];
    if (typeFilter !== 'all') {
      const label = ENTITY_LABELS[typeFilter as RecycleBinEntityType];
      filters.push({ id: 'entity-type', type: 'Entity Type', operator: '=' as const, value: typeFilter, display: label });
    }
    if (typeNotFilter) {
      const label = ENTITY_LABELS[typeNotFilter as RecycleBinEntityType];
      filters.push({ id: 'entity-type-not', type: 'Entity Type', operator: '≠' as const, value: typeNotFilter, display: label || typeNotFilter });
    }
    if (deletedByFilter) {
      filters.push({ id: 'deleted-by', type: 'Deleted by', operator: '=' as const, value: deletedByFilter });
    }
    if (deletedByNotFilter) {
      filters.push({ id: 'deleted-by-not', type: 'Deleted by', operator: '≠' as const, value: deletedByNotFilter });
    }
    if (titleFilter) {
      filters.push({ id: 'title', type: 'Title', operator: '=' as const, value: titleFilter });
    }
    if (titleNotFilter) {
      filters.push({ id: 'title-not', type: 'Title', operator: '≠' as const, value: titleNotFilter });
    }
    if (deletedDateFilter) {
      filters.push({ id: 'deleted', type: 'Deleted', operator: deletedDateFilter.operator as any, value: deletedDateFilter.value, display: formatDateDisplay(deletedDateFilter.value) });
    }
    return filters;
  }, [typeFilter, typeNotFilter, deletedByFilter, deletedByNotFilter, titleFilter, titleNotFilter, deletedDateFilter]);

  // Client-side filters for additional fields
  const filteredItems = useMemo(() => {
    let filtered = visibleItems;

    if (typeFilter !== 'all') {
      filtered = filtered.filter((item) => item.entityType === typeFilter);
    }
    if (typeNotFilter) {
      filtered = filtered.filter((item) => item.entityType !== typeNotFilter);
    }
    if (deletedByFilter) {
      filtered = filtered.filter((item) => {
        const name = (item.deletedByName || item.deletedBy || '').toLowerCase();
        return name.includes(deletedByFilter.toLowerCase());
      });
    }
    if (deletedByNotFilter) {
      filtered = filtered.filter((item) => {
        const name = (item.deletedByName || item.deletedBy || '').toLowerCase();
        return !name.includes(deletedByNotFilter.toLowerCase());
      });
    }
    if (titleFilter) {
      filtered = filtered.filter((item) => item.title?.toLowerCase().includes(titleFilter.toLowerCase()));
    }
    if (titleNotFilter) {
      filtered = filtered.filter((item) => !item.title?.toLowerCase().includes(titleNotFilter.toLowerCase()));
    }

    // Date filter for Deleted
    if (deletedDateFilter) {
      const filterDate = new Date(deletedDateFilter.value);
      if (!isNaN(filterDate.getTime())) {
        filtered = filtered.filter((item) => {
          if (!item.deletedAt) return false;
          const itemDate = new Date(item.deletedAt);
          const filterDateStr = deletedDateFilter.value;
          const itemDateStr = itemDate.toISOString().split('T')[0];
          switch (deletedDateFilter.operator) {
            case 'on': return itemDateStr === filterDateStr;
            case 'before': return itemDateStr < filterDateStr;
            case 'after': return itemDateStr > filterDateStr;
            default: return true;
          }
        });
      }
    }

    return filtered;
  }, [visibleItems, typeFilter, typeNotFilter, deletedByFilter, deletedByNotFilter, titleFilter, titleNotFilter, deletedDateFilter]);

  useEffect(() => {
    setPage(1);
  }, [deferredSearchQuery, typeFilter, typeNotFilter, deletedByFilter, deletedByNotFilter, titleFilter, titleNotFilter, deletedDateFilter]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const handleRestore = async (item: RecycleBinItem) => {
    if (!confirm(`Restore this ${ENTITY_LABELS[item.entityType].toLowerCase()} from the recycle bin?`)) {
      return;
    }

    const toastId = toast.loading(`Restoring ${item.title}...`);
    try {
      await restoreMutation.mutateAsync({ entityType: item.entityType, id: item.id });
      toast.update(toastId, `${item.title} restored successfully.`, 'success');
    } catch (error) {
      toast.update(
        toastId,
        error instanceof Error ? error.message : `Failed to restore ${item.title}.`,
        'error'
      );
    }
  };

  const handleDeleteForever = async (item: RecycleBinItem) => {
    if (!confirm(`Delete ${item.title} forever? This cannot be undone.`)) {
      return;
    }

    const toastId = toast.loading(`Deleting ${item.title} forever...`);
    try {
      await permanentlyDeleteMutation.mutateAsync({ entityType: item.entityType, id: item.id });
      toast.update(toastId, `${item.title} deleted forever.`, 'success');
    } catch (error) {
      toast.update(
        toastId,
        error instanceof Error ? error.message : `Failed to permanently delete ${item.title}.`,
        'error'
      );
    }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Admin Access Only</p>
        <h2 className="mt-3 text-2xl font-black text-gray-900">Recycle bin access is restricted.</h2>
        <p className="mt-2 text-sm font-medium text-gray-500">
          Only admin-access users can review, restore, or permanently delete archived records.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DynamicFilterBar
        filterDefinitions={recycleBinFilterDefinitions}
        initialFilters={initialFilters}
        onApply={(appliedFilters) => {
          setPage(1);

          const entityTypeFilter = appliedFilters.find((f) => f.type === 'Entity Type' && f.operator === '=');
          const entityTypeNotFilter = appliedFilters.find((f) => f.type === 'Entity Type' && f.operator === '≠');
          setTypeFilter((entityTypeFilter?.value as 'all' | RecycleBinEntityType) ?? 'all');
          setTypeNotFilter(entityTypeNotFilter?.value ?? '');

          const deletedByFilter = appliedFilters.find((f) => f.type === 'Deleted by' && f.operator === '=');
          const deletedByNotFilter = appliedFilters.find((f) => f.type === 'Deleted by' && f.operator === '≠');
          setDeletedByFilter(deletedByFilter?.value ?? '');
          setDeletedByNotFilter(deletedByNotFilter?.value ?? '');

          const titleFilter = appliedFilters.find((f) => f.type === 'Title' && f.operator === '=');
          const titleNotFilter = appliedFilters.find((f) => f.type === 'Title' && f.operator === '≠');
          setTitleFilter(titleFilter?.value ?? '');
          setTitleNotFilter(titleNotFilter?.value ?? '');

          const deletedDateFilter = appliedFilters.find((f) => f.type === 'Deleted');
          setDeletedDateFilter(deletedDateFilter ? { operator: deletedDateFilter.operator, value: deletedDateFilter.value } : null);
        }}
      />

      <Table
        columns={[
          {
            key: 'title',
            label: 'Item',
            render: (_value, item: RecycleBinItem) => (
              <div className="min-w-0">
                <p className="text-sm font-black text-gray-900">{item.title}</p>
                {item.description && (
                  <p className="mt-1 text-sm font-medium text-gray-500">{item.description}</p>
                )}
                {item.details.length > 0 && (
                  <p className="mt-1 text-xs font-medium text-gray-500">{item.details.join(' | ')}</p>
                )}
              </div>
            ),
          },
          {
            key: 'entityType',
            label: 'Type',
            render: (value: RecycleBinEntityType) => (
              <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${ENTITY_BADGES[value]}`}>
                {ENTITY_LABELS[value]}
              </span>
            ),
          },
          {
            key: 'deletedAt',
            label: 'Deleted',
            render: (_value, item: RecycleBinItem) => (
              <p className="text-sm font-medium text-gray-700">{formatTimestamp(item.deletedAt)}</p>
            ),
          },
          {
            key: 'deletedByName',
            label: 'Deleted By',
            render: (_value, item: RecycleBinItem) => (
              <div>
                <p className="text-sm font-medium text-gray-700">{item.deletedByName || item.deletedBy || 'Unknown'}</p>
                {item.createdByName && (
                  <p className="mt-1 text-xs font-medium text-gray-500">
                    Created by {item.createdByName}
                  </p>
                )}
              </div>
            ),
          },
          {
            key: 'id',
            label: 'Actions',
            align: 'right',
            render: (_value, item: RecycleBinItem) => (
              <div className="flex justify-end gap-2" onClick={(event) => event.stopPropagation()}>
                {canRestoreRecords && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isMutating}
                    onClick={() => handleRestore(item)}
                  >
                    Restore
                  </Button>
                )}
                {canDeletePermanent && (
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={isMutating}
                    icon={ICONS.Delete}
                    onClick={() => handleDeleteForever(item)}
                  >
                    Delete Forever
                  </Button>
                )}
              </div>
            ),
          },
        ]}
        data={filteredItems}
        hover={false}
        loading={isPending || isFetching}
        emptyMessage={deferredSearchQuery || typeFilter !== 'all' ? 'No deleted items match the current filters.' : 'Recycle bin is empty.'}
      />

      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-gray-500">
          Showing {totalItems === 0 ? 0 : (page - 1) * pageSize + 1}
          {' - '}
          {Math.min(page * pageSize, totalItems)} of {totalItems} deleted items
        </p>
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} disabled={isPending || isFetching} />
      </div>
    </div>
  );
};

export default RecycleBin;
