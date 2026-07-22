
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Product, hasAdminAccess, isEmployeeRole } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { Button, Table, TableCell, IconButton } from '../components';
import DynamicFilterBar from '../components/DynamicFilterBar';
import Pagination from '../src/components/Pagination';
import { theme } from '../theme';
import { useProductImagesByIds, useProductsPage, useSystemDefaults, useUsers, useProductFilterOptions, useUnits } from '../src/hooks/useQueries';
import { useAuth } from '../src/contexts/AuthProvider';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { useDeleteProduct } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import FilterBar, { FilterRange } from '../components/FilterBar';
import { useSearch } from '../src/contexts/SearchContext';
import { useResettablePage } from '../src/hooks/useResettablePage';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { decodeDynamicTextFilterValue, encodeDynamicTextFilterValue } from '../utils';

const Products: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToastNotifications();
  const { searchQuery } = useSearch();
  const { user } = useAuth();
  const {
    data: systemDefaults,
    isPending: systemDefaultsLoading,
    isError: systemDefaultsError,
  } = useSystemDefaults();
  const pageSize = systemDefaults?.recordsPerPage || DEFAULT_PAGE_SIZE;
  const canLoadProducts = !systemDefaultsLoading || !!systemDefaults || systemDefaultsError;
  const [page, setPage] = useState<number>(1);
  const { data: users = [] } = useUsers();
  const { data: units = [] } = useUnits();

  const [createdByFilter, setCreatedByFilter] = useState<string>('all');
  const [createdByNotFilter, setCreatedByNotFilter] = useState<string>('');

  const createdByIds = useMemo(() => {
    const requireMatch = (ids: string[]) => ids.length > 0 ? ids : ['__no_matching_creator__'];
    if (createdByFilter === 'all') return undefined;
    if (createdByFilter === 'admins') return requireMatch(users.filter((u) => u.role === 'Admin').map((u) => u.id));
    if (createdByFilter === 'employees') return requireMatch(users.filter((u) => isEmployeeRole(u.role)).map((u) => u.id));
    if (createdByFilter === 'developers') return requireMatch(users.filter((u) => u.role === 'Developer').map((u) => u.id));
    return [createdByFilter];
  }, [createdByFilter, users]);
  const createdByNotIds = useMemo(() => {
    if (!createdByNotFilter) return undefined;
    if (createdByNotFilter === 'admins') return users.filter((u) => u.role === 'Admin').map((u) => u.id);
    if (createdByNotFilter === 'employees') return users.filter((u) => isEmployeeRole(u.role)).map((u) => u.id);
    if (createdByNotFilter === 'developers') return users.filter((u) => u.role === 'Developer').map((u) => u.id);
    return [createdByNotFilter];
  }, [createdByNotFilter, users]);

  const pageResetKey = useMemo(
    () => JSON.stringify({ searchQuery, createdByFilter, createdByIds }),
    [searchQuery, createdByFilter, createdByIds]
  );
  const effectivePage = useResettablePage(page, setPage, pageResetKey);

  const handleRefreshProducts = useCallback(() => {
    queryClient.refetchQueries({ queryKey: ['products'], exact: false, type: 'active' });
  }, [queryClient]);
  const { data: productFilterOpts } = useProductFilterOptions();
  const deleteProductMutation = useDeleteProduct();
  const isAdmin = hasAdminAccess(user?.role);
  const { can } = useRolePermissions();
  const canCreateProducts = can('products.create');
  const canEditProducts = can('products.edit');
  const canDeleteProducts = can('products.delete');
  
  const [filterRange, setFilterRange] = useState<FilterRange>('All Time');
  const [nameFilter, setNameFilter] = useState<string>('');
  const [nameNotFilter, setNameNotFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [categoryNotFilter, setCategoryNotFilter] = useState<string>('');
  const [stockFilter, setStockFilter] = useState<{ operator: string; value: string } | null>(null);
  const [salePriceFilter, setSalePriceFilter] = useState<{ operator: string; value: string } | null>(null);
  const [purchasePriceFilter, setPurchasePriceFilter] = useState<{ operator: string; value: string } | null>(null);
  const [customDates, setCustomDates] = useState({ from: '', to: '' });
  const { data: productsPage, isFetching } = useProductsPage(effectivePage, pageSize, searchQuery, undefined, createdByIds, {
    createdByNotIds,
    category: categoryFilter || undefined,
    categoryNot: categoryNotFilter || undefined,
    name: nameFilter || undefined,
    nameNot: nameNotFilter || undefined,
    stock: stockFilter || undefined,
    salePrice: salePriceFilter || undefined,
    purchasePrice: purchasePriceFilter || undefined,
  }, { enabled: canLoadProducts });
  const products = productsPage?.data ?? [];
  const productIds = useMemo(() => products.map((product) => product.id), [products]);
  const { data: productImages = {} } = useProductImagesByIds(productIds);
  const total = productsPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const categoryOptions = useMemo(() => {
    return productFilterOpts?.categories || [];
  }, [productFilterOpts]);

  const nameOptions = useMemo(() => {
    return productFilterOpts?.names || [];
  }, [productFilterOpts]);

  const productFilterDefinitions = useMemo(() => {
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
        operators: ['=', '≠', 'contains', 'does not contain'] as const,
        allowCustomValue: true,
        renderOptions: (query: string) => {
          const normalized = query.trim().toLowerCase();
          return categoryOptions
            .filter((value) => value.toLowerCase().includes(normalized))
            .map((value) => ({ value, label: value }));
        },
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
        type: 'Stock',
        operators: ['=', '≠', '<', '>'] as const,
        valueType: 'number' as const,
        allowCustomValue: true,
      },
      {
        type: 'Sale Price',
        operators: ['=', '≠', '<', '>'] as const,
        valueType: 'number' as const,
        allowCustomValue: true,
      },
      {
        type: 'Purchase Price',
        operators: ['=', '≠', '<', '>'] as const,
        valueType: 'number' as const,
        allowCustomValue: true,
      },
    ];
  }, [users, categoryOptions, nameOptions]);

  const initialFilters = useMemo(() => {
    const filters = [];
    const decodeText = (encoded: string, negative = false) => {
      const { contains, value } = decodeDynamicTextFilterValue(encoded);
      return { operator: contains ? (negative ? 'does not contain' : 'contains') : (negative ? '≠' : '='), value };
    };
    if (createdByFilter !== 'all') {
      const user = users.find((u) => u.id === createdByFilter);
      const display = createdByFilter === 'admins' ? 'Admins'
        : createdByFilter === 'employees' ? 'Employees'
        : user ? `${user.role}: ${user.name}` : createdByFilter;
      filters.push({ id: 'created-by', type: 'Created by', operator: '=' as const, value: createdByFilter, display });
    }
    if (createdByNotFilter) {
      const user = users.find((u) => u.id === createdByNotFilter);
      const display = createdByNotFilter === 'admins' ? 'Admins'
        : createdByNotFilter === 'employees' ? 'Employees'
          : createdByNotFilter === 'developers' ? 'Developers'
            : user ? `${user.role}: ${user.name}` : createdByNotFilter;
      filters.push({ id: 'created-by-not', type: 'Created by', operator: '≠' as const, value: createdByNotFilter, display });
    }
    if (categoryFilter) {
      filters.push({ id: 'category', type: 'Category', ...decodeText(categoryFilter) });
    }
    if (categoryNotFilter) {
      filters.push({ id: 'category-not', type: 'Category', ...decodeText(categoryNotFilter, true) });
    }
    if (nameFilter) {
      filters.push({ id: 'name', type: 'Name', ...decodeText(nameFilter) });
    }
    if (nameNotFilter) {
      filters.push({ id: 'name-not', type: 'Name', ...decodeText(nameNotFilter, true) });
    }
    if (stockFilter) {
      filters.push({ id: 'stock', type: 'Stock', operator: stockFilter.operator as any, value: stockFilter.value });
    }
    if (salePriceFilter) {
      filters.push({ id: 'sale-price', type: 'Sale Price', operator: salePriceFilter.operator as any, value: salePriceFilter.value });
    }
    if (purchasePriceFilter) {
      filters.push({ id: 'purchase-price', type: 'Purchase Price', operator: purchasePriceFilter.operator as any, value: purchasePriceFilter.value });
    }
    return filters;
  }, [createdByFilter, createdByNotFilter, categoryFilter, categoryNotFilter, nameFilter, nameNotFilter, stockFilter, salePriceFilter, purchasePriceFilter, users]);

  // Reset page to 1 when any filter changes to avoid 416 Range Not Satisfiable errors
  useEffect(() => {
    setPage(1);
  }, [searchQuery, createdByFilter, createdByNotFilter, categoryFilter, categoryNotFilter, nameFilter, nameNotFilter, stockFilter, salePriceFilter, purchasePriceFilter]);

  const filteredProducts = products;

  const handleDelete = async (productId: string) => {
    if (!confirm('Move this product to the recycle bin? You can restore it later.')) return;
    try {
      await deleteProductMutation.mutateAsync(productId);
      // Cache updated deterministically by mutation hook
      toast.success('Product moved to the recycle bin');
    } catch (err) {
      console.error('Failed to delete product:', err);
      toast.error('Failed to delete product');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex-1 min-w-0">
          <DynamicFilterBar
            filterDefinitions={productFilterDefinitions}
            initialFilters={initialFilters}
            users={users}
            onApply={(appliedFilters) => {
              setPage(1);
              const encodeTextValue = (filter: { operator: string; value: string }) =>
                encodeDynamicTextFilterValue(filter.value, filter.operator.includes('contain'));

              const createdByFilter = appliedFilters.find((f) => f.type === 'Created by' && f.operator === '=');
              const createdByNotFilter = appliedFilters.find((f) => f.type === 'Created by' && f.operator === '≠');
              setCreatedByFilter(createdByFilter?.value ?? 'all');
              setCreatedByNotFilter(createdByNotFilter?.value ?? '');

              const categoryFilter = appliedFilters.find((f) => f.type === 'Category' && (f.operator === '=' || f.operator === 'contains'));
              const categoryNotFilter = appliedFilters.find((f) => f.type === 'Category' && (f.operator === '≠' || f.operator === 'does not contain'));
              setCategoryFilter(categoryFilter ? encodeTextValue(categoryFilter) : '');
              setCategoryNotFilter(categoryNotFilter ? encodeTextValue(categoryNotFilter) : '');

              const nameFilter = appliedFilters.find((f) => f.type === 'Name' && (f.operator === '=' || f.operator === 'contains'));
              const nameNotFilter = appliedFilters.find((f) => f.type === 'Name' && (f.operator === '≠' || f.operator === 'does not contain'));
              setNameFilter(nameFilter ? encodeTextValue(nameFilter) : '');
              setNameNotFilter(nameNotFilter ? encodeTextValue(nameNotFilter) : '');

              const stockFilter = appliedFilters.find((f) => f.type === 'Stock');
              setStockFilter(stockFilter ? { operator: stockFilter.operator, value: stockFilter.value } : null);

              const salePriceFilter = appliedFilters.find((f) => f.type === 'Sale Price');
              setSalePriceFilter(salePriceFilter ? { operator: salePriceFilter.operator, value: salePriceFilter.value } : null);

              const purchasePriceFilter = appliedFilters.find((f) => f.type === 'Purchase Price');
              setPurchasePriceFilter(purchasePriceFilter ? { operator: purchasePriceFilter.operator, value: purchasePriceFilter.value } : null);
            }}
          />
        </div>
        <button
          onClick={handleRefreshProducts}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold text-gray-500 bg-white border border-gray-100 shadow-sm hover:bg-gray-50 transition-all disabled:opacity-50"
          title="Refresh"
        >
          <svg className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          Refresh
        </button>
        {canCreateProducts && (
          <Button
            onClick={() => navigate('/products/new')}
            variant="primary"
            size="md"
            icon={ICONS.Plus}
          >
            Add Product
          </Button>
        )}
      </div>
      <Table
        columns={[
          {
            key: 'name',
            label: 'Name',
            render: (_, product) => (
              <div className="flex items-center gap-4">
                <img
                  src={productImages[product.id] || '/uploads/Empty_product.png'}
                  alt={product.name}
                  className="w-12 h-12 rounded-full object-cover border border-gray-100 shadow-sm"
                />
                <div>
                  <p className="font-bold text-gray-900">{product.name}</p>
                </div>
              </div>
            ),
          },
          {
            key: 'category',
            label: 'Category',
            render: (category) => (
              <span className={`px-2.5 py-1 bg-[#ebf4ff] rounded-lg text-[10px] font-black uppercase tracking-widest`}>
                {category}
              </span>
            ),
          },
          {
            key: 'unitId',
            label: 'Unit',
            render: (unitId) => {
              const unit = units.find(u => u.id === unitId);
              return unit ? (
                <span className="text-sm font-medium text-gray-700">{unit.name}</span>
              ) : (
                <span className="text-gray-300">—</span>
              );
            },
          },
          {
            key: 'salePrice',
            label: isAdmin ? 'Sale Price / Purchase Price' : 'Sale Price',
            render: (salePrice, product) => (
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold`}>{formatCurrency(product.salePrice)}</span>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-bold text-gray-600">{formatCurrency(product.purchasePrice)}</span>
                  </div>
                )}
              </div>
            ),
          },
          {
            key: 'stock',
            label: 'Stock',
            align: 'right' as const,
            render: (_stock, product) => (
              <span className={`font-black ${product.stock <= 0 ? 'text-red-600' : product.stock <= 5 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {product.stock}
              </span>
            ),
          },
          ...(canEditProducts || canDeleteProducts ? [{
              key: 'id',
              label: 'Actions',
              align: 'right' as const,
              render: (productId: string) => (
                <div className="justify-end flex items-center gap-2">
                  {canEditProducts && (
                    <IconButton
                      icon={ICONS.Edit}
                      variant="primary"
                      title="Edit"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/products/edit/${productId}`);
                      }}
                    />
                  )}
                  {canDeleteProducts && (
                    <IconButton
                      icon={ICONS.Delete}
                      variant="danger"
                      title="Delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(productId);
                      }}
                    />
                  )}
                </div>
              ),
            }] : []),
        ]}
        data={filteredProducts}
        loading={!canLoadProducts || isFetching}
        emptyMessage="No products found"
      />
      <Pagination page={effectivePage} totalPages={totalPages} onPageChange={(p) => setPage(p)} disabled={isFetching} />
    </div>
  );
};

export default Products;
