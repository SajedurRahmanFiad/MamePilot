
import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Product, hasAdminAccess, isEmployeeRole } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { Button, Table, TableCell, IconButton } from '../components';
import DynamicFilterBar from '../components/DynamicFilterBar';
import Pagination from '../src/components/Pagination';
import { theme } from '../theme';
import { useProductImagesByIds, useProductsPage, useSystemDefaults, useUsers } from '../src/hooks/useQueries';
import { useAuth } from '../src/contexts/AuthProvider';
import { DEFAULT_PAGE_SIZE } from '../src/services/supabaseQueries';
import { useDeleteProduct } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import FilterBar, { FilterRange } from '../components/FilterBar';
import { useSearch } from '../src/contexts/SearchContext';
import { useResettablePage } from '../src/hooks/useResettablePage';
import { useRolePermissions } from '../src/hooks/useRolePermissions';

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

  const [createdByFilter, setCreatedByFilter] = useState<string>('all');

  const createdByIds = useMemo(() => {
    if (createdByFilter === 'all') return undefined;
    if (createdByFilter === 'admins') return users.filter((u) => u.role === 'Admin').map((u) => u.id);
    if (createdByFilter === 'employees') return users.filter((u) => isEmployeeRole(u.role)).map((u) => u.id);
    return [createdByFilter];
  }, [createdByFilter, users]);

  const pageResetKey = useMemo(
    () => JSON.stringify({ searchQuery, createdByFilter, createdByIds }),
    [searchQuery, createdByFilter, createdByIds]
  );
  const effectivePage = useResettablePage(page, setPage, pageResetKey);

  const { data: productsPage, isFetching } = useProductsPage(effectivePage, pageSize, searchQuery, undefined, createdByIds, {
    enabled: canLoadProducts,
  });
  const products = productsPage?.data ?? [];
  const productIds = useMemo(() => products.map((product) => product.id), [products]);
  const { data: productImages = {} } = useProductImagesByIds(productIds);
  const total = productsPage?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
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

  const categoryOptions = useMemo(() => {
    return Array.from(new Set(products.map((p) => p.category).filter(Boolean))) as string[];
  }, [products]);

  const nameOptions = useMemo(() => {
    return Array.from(new Set(products.map((p) => p.name).filter(Boolean))) as string[];
  }, [products]);

  const productFilterDefinitions = useMemo(() => {
    const userOptions = [
      { value: 'admins', label: 'Admins' },
      { value: 'employees', label: 'Employees' },
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
    if (createdByFilter !== 'all') {
      const user = users.find((u) => u.id === createdByFilter);
      const display = createdByFilter === 'admins' ? 'Admins'
        : createdByFilter === 'employees' ? 'Employees'
        : user ? `${user.role}: ${user.name}` : createdByFilter;
      filters.push({ id: 'created-by', type: 'Created by', operator: '=' as const, value: createdByFilter, display });
    }
    if (categoryFilter) {
      filters.push({ id: 'category', type: 'Category', operator: '=' as const, value: categoryFilter });
    }
    if (categoryNotFilter) {
      filters.push({ id: 'category-not', type: 'Category', operator: '≠' as const, value: categoryNotFilter });
    }
    if (nameFilter) {
      filters.push({ id: 'name', type: 'Name', operator: '=' as const, value: nameFilter });
    }
    if (nameNotFilter) {
      filters.push({ id: 'name-not', type: 'Name', operator: '≠' as const, value: nameNotFilter });
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
  }, [createdByFilter, categoryFilter, categoryNotFilter, nameFilter, nameNotFilter, stockFilter, salePriceFilter, purchasePriceFilter, users]);

  // Reset page to 1 when any filter changes to avoid 416 Range Not Satisfiable errors
  useEffect(() => {
    setPage(1);
  }, [searchQuery, createdByFilter, categoryFilter, categoryNotFilter, nameFilter, nameNotFilter, stockFilter, salePriceFilter, purchasePriceFilter]);

  // Server-side search via paginated hook + client-side filters
  const filteredProducts = useMemo(() => {
    let filtered = products;

    if (categoryFilter) {
      filtered = filtered.filter((p) => p.category?.toLowerCase().includes(categoryFilter.toLowerCase()));
    }
    if (categoryNotFilter) {
      filtered = filtered.filter((p) => !p.category?.toLowerCase().includes(categoryNotFilter.toLowerCase()));
    }
    if (nameFilter) {
      filtered = filtered.filter((p) => p.name?.toLowerCase().includes(nameFilter.toLowerCase()));
    }
    if (nameNotFilter) {
      filtered = filtered.filter((p) => !p.name?.toLowerCase().includes(nameNotFilter.toLowerCase()));
    }

    // Numeric filters
    if (stockFilter) {
      const val = Number(stockFilter.value);
      if (!isNaN(val)) {
        filtered = filtered.filter((p) => {
          switch (stockFilter.operator) {
            case '=': return p.stock === val;
            case '≠': return p.stock !== val;
            case '<': return p.stock < val;
            case '>': return p.stock > val;
            default: return true;
          }
        });
      }
    }
    if (salePriceFilter) {
      const val = Number(salePriceFilter.value);
      if (!isNaN(val)) {
        filtered = filtered.filter((p) => {
          switch (salePriceFilter.operator) {
            case '=': return p.salePrice === val;
            case '≠': return p.salePrice !== val;
            case '<': return p.salePrice < val;
            case '>': return p.salePrice > val;
            default: return true;
          }
        });
      }
    }
    if (purchasePriceFilter) {
      const val = Number(purchasePriceFilter.value);
      if (!isNaN(val)) {
        filtered = filtered.filter((p) => {
          switch (purchasePriceFilter.operator) {
            case '=': return p.purchasePrice === val;
            case '≠': return p.purchasePrice !== val;
            case '<': return p.purchasePrice < val;
            case '>': return p.purchasePrice > val;
            default: return true;
          }
        });
      }
    }

    return filtered;
  }, [products, categoryFilter, categoryNotFilter, nameFilter, nameNotFilter, stockFilter, salePriceFilter, purchasePriceFilter]);

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

              const createdByFilter = appliedFilters.find((f) => f.type === 'Created by' && f.operator === '=');
              const createdByNotFilter = appliedFilters.find((f) => f.type === 'Created by' && f.operator === '≠');
              setCreatedByFilter(createdByFilter?.value ?? 'all');

              const categoryFilter = appliedFilters.find((f) => f.type === 'Category' && f.operator === '=');
              const categoryNotFilter = appliedFilters.find((f) => f.type === 'Category' && f.operator === '≠');
              setCategoryFilter(categoryFilter?.value ?? '');
              setCategoryNotFilter(categoryNotFilter?.value ?? '');

              const nameFilter = appliedFilters.find((f) => f.type === 'Name' && f.operator === '=');
              const nameNotFilter = appliedFilters.find((f) => f.type === 'Name' && f.operator === '≠');
              setNameFilter(nameFilter?.value ?? '');
              setNameNotFilter(nameNotFilter?.value ?? '');

              const stockFilter = appliedFilters.find((f) => f.type === 'Stock');
              setStockFilter(stockFilter ? { operator: stockFilter.operator, value: stockFilter.value } : null);

              const salePriceFilter = appliedFilters.find((f) => f.type === 'Sale Price');
              setSalePriceFilter(salePriceFilter ? { operator: salePriceFilter.operator, value: salePriceFilter.value } : null);

              const purchasePriceFilter = appliedFilters.find((f) => f.type === 'Purchase Price');
              setPurchasePriceFilter(purchasePriceFilter ? { operator: purchasePriceFilter.operator, value: purchasePriceFilter.value } : null);
            }}
          />
        </div>
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
