
import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../db';
import { Product, UserRole, isEmployeeRole } from '../types';
import { Button } from '../components';
import { theme } from '../theme';
import { useProduct, useCategories } from '../src/hooks/useQueries';
import { useCreateProduct, useUpdateProduct } from '../src/hooks/useMutations';

const ProductForm: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const user = db.currentUser;

  // Safety check
  if (!user) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Not Authenticated</h2>
        <p className="text-gray-500 mb-6">Please log in first.</p>
        <Button onClick={() => navigate('/login')} variant="primary">Back to Login</Button>
      </div>
    );
  }

  // Restrict employees from editing products
  if (isEdit && isEmployeeRole(user.role)) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h2>
        <p className="text-gray-500 mb-6">Employees cannot edit products. Contact an administrator for assistance.</p>
        <Button onClick={() => navigate('/products')} variant="primary">Back to Products</Button>
      </div>
    );
  }

  // Query data
  const { data: existingProduct } = useProduct(isEdit ? id : undefined);
  const { data: categories = [], isPending: loadingCategories } = useCategories('Product');
  
  // Mutations
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();

  // Form state
  const [form, setForm] = useState<Partial<Product>>({
    name: '',
    category: '',
    image: '',
    salePrice: 0,
    purchasePrice: 0,
    stock: 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize form with existing product data when loaded
  React.useEffect(() => {
    if (existingProduct) {
      setForm(existingProduct);
    }
  }, [existingProduct]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setForm({...form, image: reader.result as string});
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.category) {
      setError('Name and category are required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const productData: Omit<Product, 'id'> = {
        name: form.name || '',
        category: form.category || '',
        image: form.image || '/uploads/Empty_product.png',
        salePrice: form.salePrice || 0,
        purchasePrice: form.purchasePrice || 0,
        stock: Math.max(0, Number(form.stock || 0)),
      };

      if (isEdit) {
        await updateMutation.mutateAsync({ id: id!, updates: productData });
        navigate('/products');
      } else {
        // Trigger mutation and navigate immediately (don't wait for background tasks)
        createMutation.mutateAsync(productData as any).then(
          () => {
            navigate('/products');
          },
          (err) => {
            setSaving(false);
            setError(err instanceof Error ? err.message : 'Failed to create product');
          }
        );
      }
    } catch (err) {
      console.error('Failed to save product:', err);
      setError(err instanceof Error ? err.message : 'Failed to save product');
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Product' : 'Add Product'}</h2>
        <button onClick={() => navigate('/products')} className="px-4 py-2 border rounded-xl text-gray-500 font-bold bg-white hover:bg-gray-50">
          Cancel
        </button>
      </div>

      <div className="bg-white p-8 rounded-lg border border-gray-100 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Product Name</label>
            <input 
              type="text" 
              className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]`}
              value={form.name}
              onChange={e => setForm({...form, name: e.target.value})}
              placeholder="e.g. Cotton Polo T-Shirt"
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Category</label>
            <select 
              className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-emerald-500"
              value={form.category}
              onChange={e => setForm({...form, category: e.target.value})}
              disabled={loadingCategories}
            >
              <option value="">{loadingCategories ? 'Loading...' : 'Select Category...'}</option>
              {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Product Image</label>
          <div className="flex items-center gap-6">
            <div className="w-24 h-24 rounded-lg border border-dashed border-gray-300 flex items-center justify-center overflow-hidden bg-gray-50">
              {form.image ? (
                <img src={form.image} className="w-full h-full object-cover" />
              ) : (
                <span className="text-gray-300 text-xs text-center p-2">No image</span>
              )}
            </div>
            <div className="flex-1">
              <input 
                type="file" 
                id="product-image"
                className="hidden"
                onChange={handleFileUpload}
              />
              <label 
                htmlFor="product-image"
                className="inline-block px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl cursor-pointer transition-all"
              >
                Upload File
              </label>
              <p className="text-[10px] text-gray-400 mt-2 font-medium">Recommended size: 500x500px. JPG, PNG supported.</p>
            </div>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Sale Price (BDT)</label>
            <input 
              type="number" 
              className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] font-bold`}
              value={form.salePrice}
              onChange={e => setForm({...form, salePrice: parseFloat(e.target.value) || 0})}
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Purchase Price (BDT)</label>
            <input 
              type="number" 
              className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] text-gray-600 font-bold`}
              value={form.purchasePrice}
              onChange={e => setForm({...form, purchasePrice: parseFloat(e.target.value) || 0})}
            />
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">{isEdit ? 'Stock' : 'Opening Stock'}</label>
            <input
              type="number"
              min="0"
              step="1"
              className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] font-bold"
              value={form.stock ?? 0}
              onChange={e => setForm({ ...form, stock: Math.max(0, parseInt(e.target.value || '0', 10) || 0) })}
            />
          </div>
        </div>

<div className="pt-6 space-y-4">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm font-bold text-red-600">{String(error)}</p>
            </div>
          )}
          <Button 
            onClick={handleSave}
            variant="primary"
            size="lg"
            className="w-full"
            disabled={saving}
          >
            {saving ? 'Saving...' : isEdit ? 'Update Product Item' : 'Create Product Item'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProductForm;
