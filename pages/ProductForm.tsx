
import React, { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../db';
import { Product, DynamicPricingRule, UserRole, isEmployeeRole } from '../types';
import { Button, NumericInput } from '../components';
import { theme } from '../theme';
import { compressImage } from '../utils';
import { useProduct, useCategories, useUnits } from '../src/hooks/useQueries';
import { useCreateProduct, useUpdateProduct } from '../src/hooks/useMutations';
import { useRolePermissions } from '../src/hooks/useRolePermissions';

const ProductForm: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const user = db.currentUser;
  const { canCreateProducts, canEditProducts } = useRolePermissions();

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
  if (isEdit && !canEditProducts) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h2>
        <p className="text-gray-500 mb-6">You don't have permission to edit products. Contact an administrator for assistance.</p>
        <Button onClick={() => navigate('/products')} variant="primary">Back to Products</Button>
      </div>
    );
  }

  // Restrict users from creating products
  if (!isEdit && !canCreateProducts) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Access Denied</h2>
        <p className="text-gray-500 mb-6">You don't have permission to create products. Contact an administrator for assistance.</p>
        <Button onClick={() => navigate('/products')} variant="primary">Back to Products</Button>
      </div>
    );
  }

  // Query data
  const { data: existingProduct } = useProduct(isEdit ? id : undefined);
  const { data: categories = [], isPending: loadingCategories } = useCategories('Product');
  const { data: units = [] } = useUnits();
  
  // Mutations
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();

  // Form state
  const [form, setForm] = useState<Partial<Product>>({
    name: '',
    category: '',
    image: '',
    unitId: undefined,
    salePrice: 0,
    purchasePrice: 0,
    stock: 0,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dynamic pricing state
  const [dynamicPricingEnabled, setDynamicPricingEnabled] = useState(false);
  const [pricingRules, setPricingRules] = useState<DynamicPricingRule[]>([]);

  // Determine if selected unit allows fractional stock
  const selectedUnit = useMemo(() => units.find(u => u.id === form.unitId), [units, form.unitId]);
  const allowDecimals = selectedUnit?.isFraction ?? true;

  // Dynamic pricing validation
  const pricingValidation = useMemo(() => {
    if (!dynamicPricingEnabled || pricingRules.length === 0) return { valid: true, error: null };

    // Check for incomplete rules
    for (const rule of pricingRules) {
      if (!rule.operator || rule.quantity <= 0 || !rule.action || rule.amount <= 0) {
        return { valid: false, error: 'All pricing rules must be complete (operator, quantity, action, and amount are required).' };
      }
    }

    // Check for contradictions: same operator and quantity with different actions or amounts
    const seen = new Map<string, DynamicPricingRule>();
    for (const rule of pricingRules) {
      const key = `${rule.operator}-${rule.quantity}`;
      const existing = seen.get(key);
      if (existing) {
        if (existing.action !== rule.action || existing.amount !== rule.amount) {
          return { valid: false, error: `Contradictory rules found: multiple rules for quantity ${rule.operator} ${rule.quantity} with different outcomes.` };
        }
      } else {
        seen.set(key, rule);
      }
    }

    return { valid: true, error: null };
  }, [dynamicPricingEnabled, pricingRules]);

  // Check if save should be disabled
  const isSaveDisabled = saving || (dynamicPricingEnabled && !pricingValidation.valid);

  // Initialize form with existing product data when loaded
  React.useEffect(() => {
    if (existingProduct) {
      setForm(existingProduct);
      // Parse dynamic pricing if exists
      if (existingProduct.dynamicPricing) {
        try {
          const rules = JSON.parse(existingProduct.dynamicPricing);
          if (Array.isArray(rules) && rules.length > 0) {
            setDynamicPricingEnabled(true);
            setPricingRules(rules);
          }
        } catch {
          // Ignore invalid JSON
        }
      }
    }
  }, [existingProduct]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file, { maxWidth: 1200, maxHeight: 1200, quality: 0.82 });
      setForm((prev) => ({ ...prev, image: compressed }));
    } catch {
      const reader = new FileReader();
      reader.onload = () => setForm((prev) => ({ ...prev, image: reader.result as string }));
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
        unitId: form.unitId || undefined,
        salePrice: form.salePrice || 0,
        purchasePrice: form.purchasePrice || 0,
        stock: Math.max(0, Number(form.stock || 0)),
        dynamicPricing: dynamicPricingEnabled && pricingRules.length > 0
          ? JSON.stringify(pricingRules)
          : undefined,
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

  // Dynamic pricing helpers
  const addPricingRule = () => {
    setPricingRules(prev => [...prev, {
      id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
      operator: '=',
      quantity: 0,
      action: 'discount',
      amount: 0,
    }]);
  };

  const updatePricingRule = (id: string, updates: Partial<DynamicPricingRule>) => {
    setPricingRules(prev => prev.map(rule =>
      rule.id === id ? { ...rule, ...updates } : rule
    ));
  };

  const removePricingRule = (id: string) => {
    setPricingRules(prev => prev.filter(rule => rule.id !== id));
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

        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Unit</label>
            <select
              className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-emerald-500"
              value={form.unitId || ''}
              onChange={e => setForm({...form, unitId: e.target.value || undefined})}
            >
              <option value="">No Unit</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div className="flex-1" />
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
            <NumericInput 
              value={form.salePrice}
              onChange={value => setForm({...form, salePrice: value})}
              className="bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] px-4 py-3"
              allowDecimals={true}
              decimalPlaces={2}
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Purchase Price (BDT)</label>
            <NumericInput 
              value={form.purchasePrice}
              onChange={value => setForm({...form, purchasePrice: value})}
              className="bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] text-gray-600 px-4 py-3"
              allowDecimals={true}
              decimalPlaces={2}
            />
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">{isEdit ? 'Stock' : 'Opening Stock'}</label>
            <NumericInput
              value={form.stock ?? 0}
              onChange={value => setForm({ ...form, stock: Math.max(0, value) })}
              className="bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] px-4 py-3"
              allowDecimals={allowDecimals}
            />
          </div>
        </div>

        {/* Dynamic Pricing Section */}
        <div className="space-y-4 border-t pt-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={dynamicPricingEnabled}
              onChange={e => {
                setDynamicPricingEnabled(e.target.checked);
                if (!e.target.checked) {
                  setPricingRules([]);
                }
              }}
              className="w-5 h-5 rounded border-gray-300 text-[#3c5a82] focus:ring-[#3c5a82]"
            />
            <span className="text-sm font-bold text-gray-700">Enable Dynamic Pricing</span>
          </label>

          {dynamicPricingEnabled && (
            <div className="space-y-4 pl-8">
              <p className="text-xs text-gray-500">
                Define pricing rules based on quantity. Rules are checked in order.
              </p>

              {pricingRules.map((rule) => (
                <div key={rule.id} className="flex flex-wrap items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl p-3">
                  {/* Badge 1: "If quantity" (fixed) */}
                  <span className="inline-flex items-center bg-white px-3 py-1.5 rounded-full border border-gray-200 text-sm font-bold text-gray-600">
                    If quantity
                  </span>

                  {/* Badge 2: Operator dropdown */}
                  <select
                    value={rule.operator}
                    onChange={e => updatePricingRule(rule.id, { operator: e.target.value as '=' | '<' | '>' })}
                    className="bg-white border border-gray-200 rounded-full px-3 py-1.5 text-sm font-bold focus:ring-2 focus:ring-[#3c5a82] cursor-pointer"
                  >
                    <option value="=">{'='}</option>
                    <option value="<">{'<'}</option>
                    <option value=">">{'>'}</option>
                  </select>

                  {/* Badge 3: Quantity input */}
                  <span className="inline-flex items-center bg-white px-2 py-1 rounded-full border border-gray-200">
                    <input
                      type="number"
                      value={rule.quantity || ''}
                      onChange={e => updatePricingRule(rule.id, { quantity: Number(e.target.value) })}
                      placeholder="Qty"
                      className="w-16 text-sm font-bold text-center outline-none bg-transparent"
                      min="0"
                    />
                  </span>

                  {/* Badge 4: Action dropdown */}
                  <select
                    value={rule.action}
                    onChange={e => updatePricingRule(rule.id, { action: e.target.value as 'discount' | 'setRate' })}
                    className="bg-white border border-gray-200 rounded-full px-3 py-1.5 text-sm font-bold focus:ring-2 focus:ring-[#3c5a82] cursor-pointer"
                  >
                    <option value="discount">Discount</option>
                    <option value="setRate">Set rate</option>
                  </select>

                  {/* Badge 5: Amount input with BDT sign */}
                  <span className="inline-flex items-center bg-white px-2 py-1 rounded-full border border-gray-200 gap-1">
                    <span className="text-sm font-bold text-gray-500">৳</span>
                    <input
                      type="number"
                      value={rule.amount || ''}
                      onChange={e => updatePricingRule(rule.id, { amount: Number(e.target.value) })}
                      placeholder="Amount"
                      className="w-20 text-sm font-bold text-center outline-none bg-transparent"
                      min="0"
                    />
                  </span>

                  {/* Delete rule button */}
                  <button
                    type="button"
                    onClick={() => removePricingRule(rule.id)}
                    className="ml-2 text-gray-400 hover:text-red-500 transition-colors"
                  >
                    ×
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={addPricingRule}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-bold text-[#3c5a82] bg-[#ebf4ff] rounded-xl hover:bg-[#d4e8ff] transition-colors"
              >
                + Add Rule
              </button>

              {/* Validation error */}
              {dynamicPricingEnabled && !pricingValidation.valid && pricingValidation.error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm font-medium text-red-600">{pricingValidation.error}</p>
                </div>
              )}
            </div>
          )}
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
            disabled={isSaveDisabled}
          >
            {saving ? 'Saving...' : isEdit ? 'Update Product Item' : 'Create Product Item'}
          </Button>
          {dynamicPricingEnabled && !pricingValidation.valid && (
            <p className="text-sm text-red-500 text-center">Please fix the pricing rules above before saving.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProductForm;
