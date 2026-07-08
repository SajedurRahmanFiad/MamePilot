import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import PortalMenu from '../components/PortalMenu';
import { Transaction, hasAdminAccess, isEmployeeRole } from '../types';
import { formatCurrency, ICONS } from '../constants';
import FilterBar, { FilterRange } from '../components/FilterBar';
import DynamicFilterBar from '../components/DynamicFilterBar';
import { Button, TableLoadingSkeleton } from '../components';
import { useTransactionsPage, useUsers, useCategories, useSystemDefaults } from '../src/hooks/useQueries';
import Pagination from '../src/components/Pagination';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { useUrlSyncedSearchQuery } from '../src/hooks/useUrlSyncedSearchQuery';
import { buildHistoryBackState, getPositivePageParam } from '../src/utils/navigation';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useDeleteTransaction, useReviewTransactionApproval } from '../src/hooks/useMutations';
import { formatDateTimeParts, getDateTimeFilters, openAttachmentPreview } from '../utils';

const Transactions: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const toast = useToastNotifications();
  const { can, isAdminAccessUser } = useRolePermissions();
  const canCreateTransactions = can('transactions.create');
  const canEditTransactions = can('transactions.edit');
  const canDeleteTransactions = can('transactions.delete');
  const canReviewApprovals = isAdminAccessUser;
  const {
    data: systemDefaults,
    isPending: systemDefaultsLoading,
    isError: systemDefaultsError,
  } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const canLoadTransactions = !systemDefaultsLoading || !!systemDefaults || systemDefaultsError;
  const [searchParams, setSearchParams] = useSearchParams();
  const currentSearchParams = searchParams.toString();
  const urlPage = getPositivePageParam(searchParams.get('page'));
  const urlFilterRange = (searchParams.get('range') as FilterRange | null) || 'All Time';
  const urlCustomDates = {
    from: searchParams.get('from') || '',
    to: searchParams.get('to') || '',
  };
  const urlTypeTab = (searchParams.get('type') as 'All' | 'Income' | 'Expense' | 'Transfer' | null) || 'All';
  const urlCreatedByFilter = searchParams.get('createdBy') || 'all';
  const urlCategoryFilter = searchParams.get('category') || 'all';
  const urlAccountFilter = searchParams.get('account') || '';
  const urlAccountNotFilter = searchParams.get('accountNot') || '';
  const urlContactFilter = searchParams.get('contact') || '';
  const urlContactNotFilter = searchParams.get('contactNot') || '';
  const urlPaymentMethodFilter = searchParams.get('paymentMethod') || '';
  const urlPaymentMethodNotFilter = searchParams.get('paymentMethodNot') || '';
  const urlApprovalStatusFilter = searchParams.get('approvalStatus') || '';
  const urlApprovalStatusNotFilter = searchParams.get('approvalStatusNot') || '';
  const { searchQuery } = useUrlSyncedSearchQuery(searchParams.get('search') || '');
  const [syncedSearchParams, setSyncedSearchParams] = useState<string | null>(null);
  const shouldHydrateFromUrl = syncedSearchParams !== currentSearchParams;
  const [filterRange, setFilterRange] = useState<FilterRange>(urlFilterRange);
  const [customDates, setCustomDates] = useState(urlCustomDates);
  const [typeTab, setTypeTab] = useState<'All' | 'Income' | 'Expense' | 'Transfer'>(urlTypeTab);
  const [createdByFilter, setCreatedByFilter] = useState<string>(urlCreatedByFilter);
  const [categoryFilter, setCategoryFilter] = useState<string>(urlCategoryFilter);
  const [accountFilter, setAccountFilter] = useState<string>(urlAccountFilter);
  const [accountNotFilter, setAccountNotFilter] = useState<string>(urlAccountNotFilter);
  const [contactFilter, setContactFilter] = useState<string>(urlContactFilter);
  const [contactNotFilter, setContactNotFilter] = useState<string>(urlContactNotFilter);
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<string>(urlPaymentMethodFilter);
  const [paymentMethodNotFilter, setPaymentMethodNotFilter] = useState<string>(urlPaymentMethodNotFilter);
  const [approvalStatusFilter, setApprovalStatusFilter] = useState<string>(urlApprovalStatusFilter);
  const [approvalStatusNotFilter, setApprovalStatusNotFilter] = useState<string>(urlApprovalStatusNotFilter);
  const [typeNotFilter, setTypeNotFilter] = useState<string>('');
  const [categoryNotFilter, setCategoryNotFilter] = useState<string>('');
  const [page, setPage] = useState<number>(urlPage);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [openActionsMenu, setOpenActionsMenu] = useState<string | null>(null);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const highlightedTransactionId = searchParams.get('highlightTx') || '';
  const previousSearchQueryRef = React.useRef(searchQuery);

  const { data: users = [] } = useUsers();
  const { data: allCategories = [] } = useCategories();

  useEffect(() => {
    if (!shouldHydrateFromUrl) return;

    setPage(urlPage);
    setFilterRange(urlFilterRange);
    setCustomDates(urlCustomDates);
    setTypeTab(urlTypeTab);
    setCreatedByFilter(urlCreatedByFilter);
    setCategoryFilter(urlCategoryFilter);
    setAccountFilter(urlAccountFilter);
    setAccountNotFilter(urlAccountNotFilter);
    setContactFilter(urlContactFilter);
    setContactNotFilter(urlContactNotFilter);
    setPaymentMethodFilter(urlPaymentMethodFilter);
    setPaymentMethodNotFilter(urlPaymentMethodNotFilter);
    setApprovalStatusFilter(urlApprovalStatusFilter);
    setApprovalStatusNotFilter(urlApprovalStatusNotFilter);
    setSyncedSearchParams(currentSearchParams);
  }, [
    shouldHydrateFromUrl,
    urlPage,
    urlFilterRange,
    urlCustomDates,
    urlTypeTab,
    urlCreatedByFilter,
    urlCategoryFilter,
    urlAccountFilter,
    urlAccountNotFilter,
    urlContactFilter,
    urlContactNotFilter,
    urlPaymentMethodFilter,
    urlPaymentMethodNotFilter,
    urlApprovalStatusFilter,
    urlApprovalStatusNotFilter,
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
  const effectiveTypeTab = shouldHydrateFromUrl ? urlTypeTab : typeTab;
  const effectiveCreatedByFilter = shouldHydrateFromUrl ? urlCreatedByFilter : createdByFilter;
  const effectiveCategoryFilter = shouldHydrateFromUrl ? urlCategoryFilter : categoryFilter;
  const effectiveAccountFilter = shouldHydrateFromUrl ? urlAccountFilter : accountFilter;
  const effectiveAccountNotFilter = shouldHydrateFromUrl ? urlAccountNotFilter : accountNotFilter;
  const effectiveContactFilter = shouldHydrateFromUrl ? urlContactFilter : contactFilter;
  const effectiveContactNotFilter = shouldHydrateFromUrl ? urlContactNotFilter : contactNotFilter;
  const effectivePaymentMethodFilter = shouldHydrateFromUrl ? urlPaymentMethodFilter : paymentMethodFilter;
  const effectivePaymentMethodNotFilter = shouldHydrateFromUrl ? urlPaymentMethodNotFilter : paymentMethodNotFilter;
  const effectiveApprovalStatusFilter = shouldHydrateFromUrl ? urlApprovalStatusFilter : approvalStatusFilter;
  const effectiveApprovalStatusNotFilter = shouldHydrateFromUrl ? urlApprovalStatusNotFilter : approvalStatusNotFilter;
  const effectiveTypeNotFilter = typeNotFilter;
  const effectiveCategoryNotFilter = categoryNotFilter;
  const timeFilters = useMemo(
    () => getDateTimeFilters(effectiveFilterRange, effectiveCustomDates),
    [effectiveFilterRange, effectiveCustomDates]
  );
  const categoryNameMap = useMemo(
    () => new Map(allCategories.map((category) => [category.id, category.name || category.id])),
    [allCategories]
  );

  const createdByIds = useMemo(() => {
    if (effectiveCreatedByFilter === 'all') return undefined;
    if (effectiveCreatedByFilter === 'admins') {
      return users.filter((user) => user.role === 'Admin').map((user) => user.id);
    }
    if (effectiveCreatedByFilter === 'employees') {
      return users.filter((user) => isEmployeeRole(user.role)).map((user) => user.id);
    }
    if (effectiveCreatedByFilter === 'developers') {
      return users.filter((user) => user.role === 'Developer').map((user) => user.id);
    }
    return [effectiveCreatedByFilter];
  }, [effectiveCreatedByFilter, users]);
  const categoryOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    const categoryTypes = effectiveTypeTab === 'All'
      ? ['Income', 'Expense']
      : effectiveTypeTab === 'Transfer'
        ? []
        : [effectiveTypeTab];

    allCategories
      .filter((category) => categoryTypes.includes(category.type))
      .forEach((category) => {
        optionMap.set(category.id, category.name || category.id);
      });

    if (effectiveTypeTab === 'All' || effectiveTypeTab === 'Transfer') {
      optionMap.set('Transfer', 'Transfer');
    }

    if (effectiveTypeTab === 'All' || effectiveTypeTab === 'Expense') {
      optionMap.set('expense_purchases', optionMap.get('expense_purchases') || 'Purchases');
    }

    return Array.from(optionMap.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [allCategories, effectiveTypeTab]);

  const allCategoryOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    allCategories.forEach((category) => {
      optionMap.set(category.id, category.name || category.id);
    });
    optionMap.set('Transfer', 'Transfer');
    optionMap.set('expense_purchases', optionMap.get('expense_purchases') || 'Purchases');
    return Array.from(optionMap.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [allCategories]);

  const { data: transactionsPage, isFetching: transactionsLoading } = useTransactionsPage(effectivePage, pageSize, {
    type: effectiveTypeTab === 'All' ? undefined : effectiveTypeTab,
    category: effectiveCategoryFilter === 'all' ? undefined : effectiveCategoryFilter,
    from: timeFilters.from,
    to: timeFilters.to,
    search: searchQuery,
    createdByIds,
  }, {
    enabled: canLoadTransactions,
  });
  const transactions = transactionsPage?.data ?? [];
  const showTransactionsTableLoading = !canLoadTransactions || transactionsLoading;
  const totalTransactions = transactionsPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalTransactions / pageSize));
  const deleteTransactionMutation = useDeleteTransaction();
  const reviewTransactionApprovalMutation = useReviewTransactionApproval();

  const accountOptions = useMemo(() => {
    return Array.from(new Set(transactions.map((t) => t.accountName).filter(Boolean))) as string[];
  }, [transactions]);

  const contactOptions = useMemo(() => {
    return Array.from(new Set(transactions.map((t) => t.contactName).filter(Boolean))) as string[];
  }, [transactions]);

  const paymentMethodOptions = useMemo(() => {
    return Array.from(new Set(transactions.map((t) => t.paymentMethod).filter(Boolean))) as string[];
  }, [transactions]);

  const transactionFilterDefinitions = useMemo(() => {
    const userOptions = [
      { value: 'admins', label: 'Admins' },
      { value: 'employees', label: 'Employees' },
      { value: 'developers', label: 'Developers' },
      ...users
        .slice()
        .sort((a, b) => a.role.localeCompare(b.role))
        .map((u) => ({ value: u.id, label: `${u.role}: ${u.name}` })),
    ];

    return [
      {
        type: 'Created by',
        operators: ['=', '≠'] as const,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return normalized
            ? userOptions.filter((option) => option.label.toLowerCase().includes(normalized))
            : userOptions;
        },
      },
      {
        type: 'Category',
        operators: ['=', '≠'] as const,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return normalized
            ? allCategoryOptions.filter((option) => option.label.toLowerCase().includes(normalized))
            : allCategoryOptions;
        },
      },
      {
        type: 'Type',
        operators: ['=', '≠'] as const,
        values: ['Income', 'Expense', 'Transfer'],
      },
      {
        type: 'Account',
        operators: ['=', '≠'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return accountOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Contact',
        operators: ['=', '≠'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return contactOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Payment Method',
        operators: ['=', '≠'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return paymentMethodOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
      },
      {
        type: 'Approval Status',
        operators: ['=', '≠'] as const,
        values: ['approved', 'pending', 'declined'],
      },
    ];
  }, [users, allCategoryOptions, accountOptions, contactOptions, paymentMethodOptions]);

  const initialFilters = useMemo(() => {
    const filters = [];
    if (effectiveCreatedByFilter !== 'all') {
      const user = users.find((u) => u.id === effectiveCreatedByFilter);
      const display = effectiveCreatedByFilter === 'admins' ? 'Admins'
        : effectiveCreatedByFilter === 'employees' ? 'Employees'
        : effectiveCreatedByFilter === 'developers' ? 'Developers'
        : user ? `${user.role}: ${user.name}` : effectiveCreatedByFilter;
      filters.push({ id: 'created-by', type: 'Created by', operator: '=' as const, value: effectiveCreatedByFilter, display });
    }
    if (effectiveCategoryFilter !== 'all') {
      const category = allCategoryOptions.find((c) => c.value === effectiveCategoryFilter);
      filters.push({ id: 'category', type: 'Category', operator: '=' as const, value: effectiveCategoryFilter, display: category?.label || effectiveCategoryFilter });
    }
    if (effectiveCategoryNotFilter) {
      filters.push({ id: 'category-not', type: 'Category', operator: '≠' as const, value: effectiveCategoryNotFilter });
    }
    if (effectiveTypeTab !== 'All') {
      filters.push({ id: 'type', type: 'Type', operator: '=' as const, value: effectiveTypeTab });
    }
    if (effectiveTypeNotFilter) {
      filters.push({ id: 'type-not', type: 'Type', operator: '≠' as const, value: effectiveTypeNotFilter });
    }
    if (effectiveAccountFilter) {
      filters.push({ id: 'account', type: 'Account', operator: '=' as const, value: effectiveAccountFilter });
    }
    if (effectiveAccountNotFilter) {
      filters.push({ id: 'account-not', type: 'Account', operator: '≠' as const, value: effectiveAccountNotFilter });
    }
    if (effectiveContactFilter) {
      filters.push({ id: 'contact', type: 'Contact', operator: '=' as const, value: effectiveContactFilter });
    }
    if (effectiveContactNotFilter) {
      filters.push({ id: 'contact-not', type: 'Contact', operator: '≠' as const, value: effectiveContactNotFilter });
    }
    if (effectivePaymentMethodFilter) {
      filters.push({ id: 'payment-method', type: 'Payment Method', operator: '=' as const, value: effectivePaymentMethodFilter });
    }
    if (effectivePaymentMethodNotFilter) {
      filters.push({ id: 'payment-method-not', type: 'Payment Method', operator: '≠' as const, value: effectivePaymentMethodNotFilter });
    }
    if (effectiveApprovalStatusFilter) {
      filters.push({ id: 'approval-status', type: 'Approval Status', operator: '=' as const, value: effectiveApprovalStatusFilter });
    }
    if (effectiveApprovalStatusNotFilter) {
      filters.push({ id: 'approval-status-not', type: 'Approval Status', operator: '≠' as const, value: effectiveApprovalStatusNotFilter });
    }
    return filters;
  }, [
    effectiveCreatedByFilter,
    effectiveCategoryFilter,
    effectiveCategoryNotFilter,
    effectiveTypeTab,
    effectiveTypeNotFilter,
    effectiveAccountFilter,
    effectiveAccountNotFilter,
    effectiveContactFilter,
    effectiveContactNotFilter,
    effectivePaymentMethodFilter,
    effectivePaymentMethodNotFilter,
    effectiveApprovalStatusFilter,
    effectiveApprovalStatusNotFilter,
    users,
    allCategoryOptions,
  ]);

  useEffect(() => {
    if (shouldHydrateFromUrl || categoryFilter === 'all') return;
    if (categoryOptions.some((option) => option.value === categoryFilter)) return;

    setPage(1);
    setCategoryFilter('all');
  }, [categoryFilter, categoryOptions, shouldHydrateFromUrl]);

  useEffect(() => {
    if (shouldHydrateFromUrl) return;

    const params: Record<string, string> = {};
    if (effectivePage > 1) params.page = String(effectivePage);
    if (effectiveTypeTab !== 'All') params.type = effectiveTypeTab;
    if (effectiveFilterRange !== 'All Time') params.range = effectiveFilterRange;
    if (effectiveCustomDates.from) params.from = effectiveCustomDates.from;
    if (effectiveCustomDates.to) params.to = effectiveCustomDates.to;
    if (effectiveCreatedByFilter !== 'all') params.createdBy = effectiveCreatedByFilter;
    if (effectiveCategoryFilter !== 'all') params.category = effectiveCategoryFilter;
    if (effectiveAccountFilter) params.account = effectiveAccountFilter;
    if (effectiveAccountNotFilter) params.accountNot = effectiveAccountNotFilter;
    if (effectiveContactFilter) params.contact = effectiveContactFilter;
    if (effectiveContactNotFilter) params.contactNot = effectiveContactNotFilter;
    if (effectivePaymentMethodFilter) params.paymentMethod = effectivePaymentMethodFilter;
    if (effectivePaymentMethodNotFilter) params.paymentMethodNot = effectivePaymentMethodNotFilter;
    if (effectiveApprovalStatusFilter) params.approvalStatus = effectiveApprovalStatusFilter;
    if (effectiveApprovalStatusNotFilter) params.approvalStatusNot = effectiveApprovalStatusNotFilter;
    if (searchQuery) params.search = searchQuery;

    if (new URLSearchParams(params).toString() !== currentSearchParams) {
      setSearchParams(params, { replace: true });
    }
  }, [
    shouldHydrateFromUrl,
    effectivePage,
    effectiveTypeTab,
    effectiveFilterRange,
    effectiveCustomDates.from,
    effectiveCustomDates.to,
    effectiveCreatedByFilter,
    effectiveCategoryFilter,
    effectiveAccountFilter,
    effectiveAccountNotFilter,
    effectiveContactFilter,
    effectiveContactNotFilter,
    effectivePaymentMethodFilter,
    effectivePaymentMethodNotFilter,
    effectiveApprovalStatusFilter,
    effectiveApprovalStatusNotFilter,
    searchQuery,
    currentSearchParams,
    setSearchParams,
  ]);

  useEffect(() => {
    if (!highlightedTransactionId || showTransactionsTableLoading) return;

    const row = document.getElementById(`transaction-row-${highlightedTransactionId}`);
    if (!row) return;

    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const timer = window.setTimeout(() => {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('highlightTx');
      setSearchParams(nextParams, { replace: true });
    }, 4500);

    return () => window.clearTimeout(timer);
  }, [highlightedTransactionId, searchParams, setSearchParams, showTransactionsTableLoading]);

  const handleTypeTabChange = (type: 'All' | 'Income' | 'Expense' | 'Transfer') => {
    setPage(1);
    setTypeTab(type);
  };

  const handleFilterRangeChange = (range: FilterRange) => {
    setPage(1);
    setFilterRange(range);
    if (range !== 'Custom') {
      setCustomDates({ from: '', to: '' });
    }
  };

  const handleCustomDatesChange = (dates: { from: string; to: string }) => {
    setPage(1);
    setCustomDates(dates);
  };

  const userMap = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);

  const getCreatorName = (transaction: Transaction) => {
    if (!transaction.createdBy?.trim()) return null;
    const user = userMap.get(transaction.createdBy);
    if (user?.name) return user.name;

    if (transaction.history?.created) {
      const match = transaction.history.created.match(/Created by (.+?) on/);
      if (match) return match[1];
    }

    return null;
  };

  const getContactName = (contactId: string, transaction?: Transaction) => {
    if (transaction?.contactName) {
      return {
        name: transaction.contactName,
        type: transaction.contactType || 'Customer',
      };
    }
    if (!contactId) return null;

    const customer = queryClient.getQueryData<any>(['customer', contactId]);
    if (customer) return { name: customer.name, type: 'Customer' };

    const vendor = queryClient.getQueryData<any>(['vendor', contactId]);
    if (vendor) return { name: vendor.name, type: 'Vendor' };

    return null;
  };

  // Active filters are applied server-side so counts stay consistent across pages.
  // Client-side filters for fields not supported server-side.
  const displayedTransactions = useMemo(() => {
    let filtered = transactions;

    if (effectiveTypeNotFilter) {
      filtered = filtered.filter((t) => t.type !== effectiveTypeNotFilter);
    }
    if (effectiveCategoryNotFilter) {
      filtered = filtered.filter((t) => {
        const categoryName = categoryNameMap.get(t.category) || t.category;
        return categoryName !== effectiveCategoryNotFilter && t.category !== effectiveCategoryNotFilter;
      });
    }
    if (effectiveAccountFilter) {
      filtered = filtered.filter((t) => t.accountName?.toLowerCase().includes(effectiveAccountFilter.toLowerCase()));
    }
    if (effectiveAccountNotFilter) {
      filtered = filtered.filter((t) => !t.accountName?.toLowerCase().includes(effectiveAccountNotFilter.toLowerCase()));
    }
    if (effectiveContactFilter) {
      filtered = filtered.filter((t) => t.contactName?.toLowerCase().includes(effectiveContactFilter.toLowerCase()));
    }
    if (effectiveContactNotFilter) {
      filtered = filtered.filter((t) => !t.contactName?.toLowerCase().includes(effectiveContactNotFilter.toLowerCase()));
    }
    if (effectivePaymentMethodFilter) {
      filtered = filtered.filter((t) => t.paymentMethod?.toLowerCase().includes(effectivePaymentMethodFilter.toLowerCase()));
    }
    if (effectivePaymentMethodNotFilter) {
      filtered = filtered.filter((t) => !t.paymentMethod?.toLowerCase().includes(effectivePaymentMethodNotFilter.toLowerCase()));
    }
    if (effectiveApprovalStatusFilter) {
      filtered = filtered.filter((t) => t.approvalStatus === effectiveApprovalStatusFilter);
    }
    if (effectiveApprovalStatusNotFilter) {
      filtered = filtered.filter((t) => t.approvalStatus !== effectiveApprovalStatusNotFilter);
    }

    return filtered;
  }, [
    transactions,
    effectiveTypeNotFilter,
    effectiveCategoryNotFilter,
    categoryNameMap,
    effectiveAccountFilter,
    effectiveAccountNotFilter,
    effectiveContactFilter,
    effectiveContactNotFilter,
    effectivePaymentMethodFilter,
    effectivePaymentMethodNotFilter,
    effectiveApprovalStatusFilter,
    effectiveApprovalStatusNotFilter,
  ]);

  const transactionSummary = useMemo(() => {
    const summary = displayedTransactions.reduce(
      (acc, transaction) => {
        if (transaction.type === 'Income') acc.income += transaction.amount;
        if (transaction.type === 'Expense') acc.expense += transaction.amount;
        if (transaction.type === 'Transfer') acc.transfer += transaction.amount;
        return acc;
      },
      { income: 0, expense: 0, transfer: 0 }
    );

    return {
      count: totalTransactions,
      income: summary.income,
      expense: summary.expense,
      transfer: summary.transfer,
      net: summary.income - summary.expense,
    };
  }, [displayedTransactions, totalTransactions]);

  const formatDateAndTime = (dateString?: string, createdAt?: string) => {
    const candidate = (dateString && dateString.toString().length > 10) ? dateString : (createdAt || dateString || '');
    return formatDateTimeParts(candidate);
  };

  const handleRowClick = (transaction: Transaction) => {
    if (!transaction.referenceId) return;

    if (transaction.type === 'Income') {
      navigate(`/orders/${transaction.referenceId}`, { state: buildHistoryBackState(location) });
      return;
    }

    if (transaction.type === 'Expense' && transaction.category === 'expense_purchases') {
      navigate(`/bills/${transaction.referenceId}`, { state: buildHistoryBackState(location) });
    }
  };

  const canEditTransaction = (transaction: Transaction) => canEditTransactions && !transaction.referenceId && transaction.type !== 'Transfer';
  const canDeleteTransaction = (transaction: Transaction) => canDeleteTransactions && !transaction.referenceId && transaction.type !== 'Transfer';
  const canViewAttachment = (transaction: Transaction) => Boolean(transaction.attachmentUrl?.trim());
  const hasRowActions = (transaction: Transaction) => canEditTransaction(transaction) || canDeleteTransaction(transaction) || canViewAttachment(transaction);

  const closeActionsMenu = () => {
    setOpenActionsMenu(null);
    setAnchorEl(null);
  };

  const handleEditTransaction = (transaction: Transaction) => {
    navigate(`/transactions/edit/${transaction.id}`, { state: buildHistoryBackState(location) });
  };

  const handleViewAttachment = (transaction: Transaction) => {
    if (!transaction.attachmentUrl || !openAttachmentPreview(transaction.attachmentUrl)) {
      toast.error('Attachment could not be opened.');
    }
  };

  const handleDeleteTransaction = async (transaction: Transaction) => {
    if (!canDeleteTransaction(transaction)) {
      toast.error('You do not have permission to delete this transaction.');
      return;
    }
    if (!confirm('Move this transaction to the recycle bin? You can restore it later.')) return;

    try {
      await deleteTransactionMutation.mutateAsync(transaction.id);
      toast.success('Transaction moved to the recycle bin');
      closeActionsMenu();
    } catch (error) {
      console.error('Failed to delete transaction:', error);
      toast.error('Failed to delete transaction');
    }
  };

  const handleReviewTransaction = async (transaction: Transaction, decision: 'approve' | 'decline') => {
    if (transaction.approvalStatus !== 'pending') {
      toast.warning('This transaction is no longer pending approval.');
      return;
    }

    try {
      await reviewTransactionApprovalMutation.mutateAsync({
        transactionId: transaction.id,
        decision,
      });
      toast.success(
        decision === 'approve'
          ? 'Transaction approved successfully.'
          : 'Transaction declined and any pending effect was cancelled.'
      );
      closeActionsMenu();
    } catch (error) {
      console.error('Failed to review transaction:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to review transaction.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4 w-full sm:w-auto">
          <div className="hidden sm:block">
            <FilterBar
              title="Transactions"
              filterRange={effectiveFilterRange}
              setFilterRange={handleFilterRangeChange}
              customDates={effectiveCustomDates}
              setCustomDates={handleCustomDatesChange}
              compact={true}
            />
          </div>
        </div>
        {canCreateTransactions && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigate('/transactions/new/income')} variant="primary" size="md" icon={ICONS.Plus}>Income</Button>
            <Button onClick={() => navigate('/transactions/new/expense')} variant="danger" size="md" icon={ICONS.Minus}>Expense</Button>
          </div>
        )}
      </div>
      <div className="sm:hidden">
        <FilterBar
          title="Transactions"
          filterRange={effectiveFilterRange}
          setFilterRange={handleFilterRangeChange}
          customDates={effectiveCustomDates}
          setCustomDates={handleCustomDatesChange}
        />
      </div>

      <DynamicFilterBar
        filterDefinitions={transactionFilterDefinitions}
        initialFilters={initialFilters}
        users={users}
        onApply={(appliedFilters) => {
          setPage(1);

          const createdByFilter = appliedFilters.find((f) => f.type === 'Created by');
          setCreatedByFilter(createdByFilter?.value ?? 'all');

          const categoryEqFilter = appliedFilters.find((f) => f.type === 'Category' && f.operator === '=');
          const categoryNeFilter = appliedFilters.find((f) => f.type === 'Category' && f.operator === '≠');
          setCategoryFilter(categoryEqFilter?.value ?? 'all');
          setCategoryNotFilter(categoryNeFilter?.value ?? '');

          const typeEqFilter = appliedFilters.find((f) => f.type === 'Type' && f.operator === '=');
          const typeNeFilter = appliedFilters.find((f) => f.type === 'Type' && f.operator === '≠');
          if (typeEqFilter) {
            setTypeTab(typeEqFilter.value as 'All' | 'Income' | 'Expense' | 'Transfer');
            setTypeNotFilter('');
          } else if (typeNeFilter) {
            setTypeTab('All');
            setTypeNotFilter(typeNeFilter.value);
          } else {
            setTypeTab('All');
            setTypeNotFilter('');
          }

          const accountFilter = appliedFilters.find((f) => f.type === 'Account' && f.operator === '=');
          const accountNotFilter = appliedFilters.find((f) => f.type === 'Account' && f.operator === '≠');
          setAccountFilter(accountFilter?.value ?? '');
          setAccountNotFilter(accountNotFilter?.value ?? '');

          const contactFilter = appliedFilters.find((f) => f.type === 'Contact' && f.operator === '=');
          const contactNotFilter = appliedFilters.find((f) => f.type === 'Contact' && f.operator === '≠');
          setContactFilter(contactFilter?.value ?? '');
          setContactNotFilter(contactNotFilter?.value ?? '');

          const paymentMethodFilter = appliedFilters.find((f) => f.type === 'Payment Method' && f.operator === '=');
          const paymentMethodNotFilter = appliedFilters.find((f) => f.type === 'Payment Method' && f.operator === '≠');
          setPaymentMethodFilter(paymentMethodFilter?.value ?? '');
          setPaymentMethodNotFilter(paymentMethodNotFilter?.value ?? '');

          const approvalStatusFilter = appliedFilters.find((f) => f.type === 'Approval Status' && f.operator === '=');
          const approvalStatusNotFilter = appliedFilters.find((f) => f.type === 'Approval Status' && f.operator === '≠');
          setApprovalStatusFilter(approvalStatusFilter?.value ?? '');
          setApprovalStatusNotFilter(approvalStatusNotFilter?.value ?? '');
        }}
      />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-visible">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Date</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Type</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest">Contact</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest"><>Category <br></br> Notes</></th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest text-center">Amount</th>
                <th className="px-6 py-4 text-[10px] font-black text-gray-400 uppercase tracking-widest sm:hidden">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {showTransactionsTableLoading ? (
                <TableLoadingSkeleton columns={5} rows={8} />
              ) : displayedTransactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-16 text-center text-gray-400 italic font-medium">No transactions found.</td>
                </tr>
              ) : (
                displayedTransactions.map((transaction) => {
                  const contact = transaction.contactId ? getContactName(transaction.contactId, transaction) : null;
                  const creator = getCreatorName(transaction);
                  const hasLink = Boolean(transaction.referenceId) && (
                    transaction.type === 'Income' ||
                    (transaction.type === 'Expense' && transaction.category === 'expense_purchases')
                  );
                  const isLinkedTransaction = Boolean(transaction.referenceId);
                  const canEdit = canEditTransaction(transaction);
                  const canDelete = canDeleteTransaction(transaction);
                  const canPreviewAttachment = canViewAttachment(transaction);
                  const showActions = hasRowActions(transaction);
                  const { date: dateStr, time: timeStr } = formatDateAndTime(transaction.date, transaction.createdAt);

                  return (
                    <tr
                      id={`transaction-row-${transaction.id}`}
                      key={transaction.id}
                      onMouseEnter={() => setHoveredRow(transaction.id)}
                      onMouseLeave={() => setHoveredRow(null)}
                      onClick={() => handleRowClick(transaction)}
                      className={`group relative transition-all ${hasLink ? 'cursor-pointer' : ''} ${
                        highlightedTransactionId === transaction.id
                          ? 'bg-amber-50 ring-2 ring-amber-300'
                          : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-6 py-5 text-sm font-bold text-gray-700">
                        <div className="flex flex-col">
                          <span className="font-bold text-gray-900">{dateStr}</span>
                          <span className="text-[11px] text-gray-400 font-medium">{timeStr}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex flex-col gap-2">
                          <span className={`inline-flex w-fit px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest ${transaction.type === 'Income' ? 'bg-[#ebf4ff]' : transaction.type === 'Expense' ? 'bg-red-50 text-red-600' : 'bg-[#e6f0ff]'}`}>
                            {transaction.type}
                          </span>
                          {transaction.approvalStatus && transaction.approvalStatus !== 'approved' && (
                            <span
                              className={`inline-flex w-fit rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.18em] ${
                                transaction.approvalStatus === 'pending'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-gray-200 text-gray-600'
                              }`}
                            >
                              {transaction.approvalStatus}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        {isLinkedTransaction ? (
                          contact ? (
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-gray-900">{contact.name}</span>
                              <span className="text-[9px] text-gray-400 uppercase font-bold tracking-widest">{contact.type}</span>
                            </div>
                          ) : (
                            <span className="text-gray-300 font-bold text-xs">-</span>
                          )
                        ) : creator ? (
                          <div className="flex flex-col">
                            <span className="text-sm font-bold text-gray-900">{creator}</span>
                            <span className="text-[9px] text-gray-400 uppercase font-bold tracking-widest">Created By</span>
                          </div>
                        ) : (
                          <span className="text-gray-300 font-bold text-xs">-</span>
                        )}
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex flex-col">
                          <p className="text-sm font-bold text-gray-800">{categoryNameMap.get(transaction.category) || transaction.category || 'Uncategorized'}</p>
                          <p className="text-xs text-gray-400 italic max-w-xs truncate">{transaction.description}</p>
                          {transaction.approvalStatus === 'pending' && (
                            <p className="mt-1 text-[11px] font-bold text-amber-700">Awaiting admin approval</p>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-5 text-center">
                        <span className={`font-black text-base ${transaction.type === 'Income' ? 'text-emerald-600' : transaction.type === 'Expense' ? 'text-red-600' : 'text-black'}`}>
                          {transaction.type === 'Income' ? '+' : transaction.type === 'Expense' ? '-' : ''}
                          {formatCurrency(transaction.amount)}
                        </span>
                      </td>

                      <td className="px-6 py-5 sm:hidden relative z-[999]" onClick={(event) => event.stopPropagation()}>
                        {showActions && (
                          <div className="relative z-[999]">
                            <button
                              onClick={(event) => {
                                const target = event.currentTarget as HTMLElement;
                                if (openActionsMenu === transaction.id) {
                                  closeActionsMenu();
                                } else {
                                  setOpenActionsMenu(transaction.id);
                                  setAnchorEl(target);
                                }
                              }}
                              className="p-2 text-gray-400 hover:text-[#0f2f57] hover:bg-[#ebf4ff] rounded-lg transition-all"
                            >
                              {ICONS.More}
                            </button>
                            <PortalMenu anchorEl={anchorEl} open={openActionsMenu === transaction.id} onClose={closeActionsMenu}>
                              <>
                                {canReviewApprovals && transaction.approvalStatus === 'pending' && (
                                  <>
                                    <button
                                      onClick={() => handleReviewTransaction(transaction, 'approve')}
                                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-emerald-50 flex items-center gap-2 font-bold text-emerald-700"
                                    >
                                      {ICONS.Check} Approve
                                    </button>
                                    <button
                                      onClick={() => handleReviewTransaction(transaction, 'decline')}
                                      className="w-full text-left px-4 py-2.5 text-sm hover:bg-red-50 flex items-center gap-2 font-bold text-red-600"
                                    >
                                      {ICONS.Close} Decline
                                    </button>
                                    {(canEdit || canDelete || canPreviewAttachment) && <div className="border-t my-1"></div>}
                                  </>
                                )}
                                {canEdit && (
                                  <button
                                    onClick={() => {
                                      handleEditTransaction(transaction);
                                      closeActionsMenu();
                                    }}
                                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-gray-700"
                                  >
                                    {ICONS.Edit} Edit
                                  </button>
                                )}
                                {canDelete && (
                                  <button
                                    onClick={() => handleDeleteTransaction(transaction)}
                                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-red-50 flex items-center gap-2 font-bold text-red-600"
                                  >
                                    {ICONS.Delete} Delete
                                  </button>
                                )}
                                {(canEdit || canDelete) && canPreviewAttachment && <div className="border-t my-1"></div>}
                                {canPreviewAttachment && (
                                  <button
                                    onClick={() => {
                                      handleViewAttachment(transaction);
                                      closeActionsMenu();
                                    }}
                                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2 font-bold text-[#0f2f57]"
                                  >
                                    {ICONS.View} View Attachment
                                  </button>
                                )}
                              </>
                            </PortalMenu>
                          </div>
                        )}
                      </td>

                      {hoveredRow === transaction.id && showActions && (
                        <td
                          className="absolute right-6 top-1/2 -translate-y-1/2 z-10 animate-in fade-in slide-in-from-right-2 duration-200 hidden sm:table-cell"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <div className="flex items-center gap-1.5 bg-white p-1.5 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-[#ebf4ff]">
                            {canReviewApprovals && transaction.approvalStatus === 'pending' && (
                              <>
                                <button
                                  onClick={() => handleReviewTransaction(transaction, 'approve')}
                                  className="p-2.5 text-gray-400 hover:text-emerald-700 hover:bg-emerald-50 rounded-xl transition-all"
                                  title="Approve"
                                >
                                  {ICONS.Check}
                                </button>
                                <button
                                  onClick={() => handleReviewTransaction(transaction, 'decline')}
                                  className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                  title="Decline"
                                >
                                  {ICONS.Close}
                                </button>
                                {(canEdit || canDelete || canPreviewAttachment) && <div className="h-5 w-px bg-gray-100 mx-1"></div>}
                              </>
                            )}
                            {canEdit && (
                              <button
                                onClick={() => handleEditTransaction(transaction)}
                                className="p-2.5 text-gray-400 hover:text-[#0f2f57] hover:bg-[#ebf4ff] rounded-xl transition-all"
                                title="Edit"
                              >
                                {ICONS.Edit}
                              </button>
                            )}
                            {canDelete && (
                              <button
                                onClick={() => handleDeleteTransaction(transaction)}
                                className="p-2.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all"
                                title="Delete"
                              >
                                {ICONS.Delete}
                              </button>
                            )}
                            {(canEdit || canDelete) && canPreviewAttachment && <div className="h-5 w-px bg-gray-100 mx-1"></div>}
                            {canPreviewAttachment && (
                              <button
                                onClick={() => handleViewAttachment(transaction)}
                                className="p-2.5 text-[#0f2f57] hover:bg-[#ebf4ff] rounded-xl transition-all"
                                title="View attachment"
                              >
                                {ICONS.View}
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Filtered Transactions</p>
          <p className="mt-3 text-lg font-black text-gray-900">{transactionSummary.count}</p>
          <p className="mt-2 text-sm font-medium text-gray-500">Matching records across all filtered pages.</p>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Total Income</p>
          <p className="mt-3 text-lg font-black text-emerald-600">{formatCurrency(transactionSummary.income)}</p>
          <p className="mt-2 text-sm font-medium text-gray-500">Sum of all income transactions in view.</p>
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Total Expense</p>
          <p className="mt-3 text-lg font-black text-red-600">{formatCurrency(transactionSummary.expense)}</p>
          <p className="mt-2 text-sm font-medium text-gray-500">Sum of all expense transactions in view.</p>
        </div>
        <div className={`rounded-2xl border p-5 shadow-sm ${transactionSummary.net >= 0 ? 'border-emerald-100 bg-emerald-50' : 'border-red-100 bg-red-50'}`}>
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Net Total</p>
          <p className={`mt-3 text-lg font-black ${transactionSummary.net >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {transactionSummary.net >= 0 ? '' : '-'}{formatCurrency(Math.abs(transactionSummary.net))}
          </p>
          <p className="mt-2 text-sm font-medium text-gray-500">Income minus expenses for filtered transactions.</p>
        </div>
      </section>

      <div className="mt-4 flex items-center justify-between">
        <div className="text-sm text-gray-600">
          {`Showing ${Math.min((effectivePage - 1) * pageSize + 1, totalTransactions || 0)} - ${Math.min(effectivePage * pageSize, totalTransactions || 0)} of ${totalTransactions} transactions`}
        </div>
        <Pagination page={effectivePage} totalPages={totalPages} onPageChange={(nextPage) => setPage(nextPage)} disabled={transactionsLoading} />
      </div>
    </div>
  );
};

export default Transactions;
