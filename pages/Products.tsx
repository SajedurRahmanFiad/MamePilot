
import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Product, hasAdminAccess, isEmployeeRole } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { Button, Table, TableCell, IconButton } from '../components';
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
    if (createdByFilter === 'admins') return users.filter(u => hasAdminAccess(u.role)).map(u => u.id);
    if (createdByFilter === 'employees') return users.filter(u => isEmployeeRole(u.role)).map(u => u.id);
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
  const [customDates, setCustomDates] = useState({ from: '', to: '' });

  // Reset page to 1 when any filter changes to avoid 416 Range Not Satisfiable errors
  useEffect(() => {
    setPage(1);
  }, [searchQuery, createdByFilter]);

  // Wrapper function that resets page AND applies filter (atomic operation)
  const handleCreatedByFilterChange = (filter: string) => {
    setPage(1);
    setCreatedByFilter(filter);
  };

  // Server-side search via paginated hook
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="md:text-2xl text-xl font-bold text-gray-900">Products Catalog</h2>
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
