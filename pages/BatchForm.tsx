
import React, { useState, useMemo } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Batch, AgeComponents } from '../types';
import { Button, NumericInput } from '../components';
import { theme } from '../theme';
import { useBatch, useBatchCategories } from '../src/hooks/useQueries';
import { useCreateBatch, useUpdateBatch } from '../src/hooks/useMutations';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { getPreservedRouteState } from '../src/utils/navigation';
import { ageToDays, daysToAge, formatAge } from '../src/utils/batchUtils';
import { useCapabilities } from '../src/hooks/useCapabilities';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const BatchForm: React.FC = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isEdit = Boolean(id);
  const { can } = useRolePermissions();
  const { hasSubCapability } = useCapabilities(true);
  const canCreateBatches = can('batches.create') && hasSubCapability('batch_management');
  const canEditBatches = can('batches.edit') && hasSubCapability('batch_management');

  const handleClose = () => {
    const navState = getPreservedRouteState(location.state);
    if (navState.backMode === 'history' && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(navState.from || '/batches');
  };

  const { data: existingBatch } = useBatch(isEdit ? id : undefined);
  const { data: batchCategories = [], isPending: loadingCategories } = useBatchCategories();

  const createMutation = useCreateBatch();
  const updateMutation = useUpdateBatch();

  const [form, setForm] = useState<Partial<Batch>>({
    name: '',
    slug: '',
    sku: '',
    categoryId: '',
    image: '',
    population: 0,
    averageAgeDays: 0,
    salePrice: 0,
    purchasePrice: 0,
    description: '',
  });

  const [ageInput, setAgeInput] = useState<AgeComponents>({ years: 0, months: 0, days: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slugTouched, setSlugTouched] = useState(false);

  React.useEffect(() => {
    if (existingBatch) {
      setForm(existingBatch);
      setAgeInput(daysToAge(existingBatch.averageAgeDays));
      if (existingBatch.slug) {
        setSlugTouched(true);
      }
    }
  }, [existingBatch]);

  React.useEffect(() => {
    const days = ageToDays(ageInput);
    setForm(prev => ({ ...prev, averageAgeDays: days }));
  }, [ageInput]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm(prev => ({ ...prev, image: reader.result as string }));
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    if (!form.name || !form.categoryId) {
      setError('Name and category are required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const batchData: Omit<Batch, 'id'> = {
        name: form.name || '',
        slug: form.slug ? slugify(form.slug) : undefined,
        sku: form.sku?.trim() || undefined,
        categoryId: form.categoryId || '',
        image: form.image || '/uploads/Empty_product.png',
        population: Math.max(0, Number(form.population || 0)),
        averageAgeDays: form.averageAgeDays || 0,
        salePrice: form.salePrice || 0,
        purchasePrice: form.purchasePrice || 0,
        description: form.description || undefined,
      };

      if (isEdit) {
        await updateMutation.mutateAsync({ id: id!, updates: batchData });
        handleClose();
      } else {
        createMutation.mutateAsync(batchData as any).then(
          () => {
            handleClose();
          },
          (err) => {
            setSaving(false);
            setError(err instanceof Error ? err.message : 'Failed to create batch');
          }
        );
      }
    } catch (err) {
      console.error('Failed to save batch:', err);
      setError(err instanceof Error ? err.message : 'Failed to save batch');
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-gray-900">{isEdit ? 'Edit Batch' : 'Add Batch'}</h2>
        <button onClick={handleClose} className="px-4 py-2 border rounded-xl text-gray-500 font-bold bg-white hover:bg-gray-50">
          Cancel
        </button>
      </div>

      <div className="bg-white p-8 rounded-lg border border-gray-100 shadow-sm space-y-6">
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Batch Name</label>
            <input
              type="text"
              className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]`}
              value={form.name}
              onChange={e => setForm({...form, name: e.target.value})}
              onBlur={() => {
                if (!slugTouched && form.name) {
                  setForm(prev => ({ ...prev, slug: slugify(prev.name || '') }));
                }
              }}
              placeholder="e.g. Broiler Batch #1"
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Category</label>
            <select
              className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-emerald-500"
              value={form.categoryId}
              onChange={e => setForm({...form, categoryId: e.target.value})}
              disabled={loadingCategories}
            >
              <option value="">{loadingCategories ? 'Loading...' : 'Select Category...'}</option>
              {batchCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">SKU</label>
          <input
            type="text"
            className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]"
            value={form.sku || ''}
            onChange={e => setForm({ ...form, sku: e.target.value })}
            placeholder="e.g. BROILER-001"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Slug</label>
          <input
            type="text"
            className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82]"
            value={form.slug || ''}
            onChange={e => {
              setSlugTouched(true);
              setForm({...form, slug: e.target.value});
            }}
            placeholder="auto-generated-from-name"
          />
        </div>

        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Opening Population</label>
            <NumericInput
              value={form.population ?? 0}
              onChange={value => setForm({ ...form, population: Math.max(0, value) })}
              className="bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] px-4 py-3"
              allowDecimals={false}
            />
          </div>
          <div className="flex-1 space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Average Age</label>
            <div className="flex gap-2">
              <div className="flex-1">
                <input
                  type="number"
                  className="w-full px-3 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] text-center"
                  value={ageInput.years || ''}
                  onChange={e => setAgeInput(prev => ({ ...prev, years: Math.max(0, parseInt(e.target.value) || 0) }))}
                  placeholder="Y"
                  min="0"
                />
                <p className="text-[10px] text-center text-gray-400 mt-1">Years</p>
              </div>
              <div className="flex-1">
                <input
                  type="number"
                  className="w-full px-3 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] text-center"
                  value={ageInput.months || ''}
                  onChange={e => setAgeInput(prev => ({ ...prev, months: Math.max(0, parseInt(e.target.value) || 0) }))}
                  placeholder="M"
                  min="0"
                  max="11"
                />
                <p className="text-[10px] text-center text-gray-400 mt-1">Months</p>
              </div>
              <div className="flex-1">
                <input
                  type="number"
                  className="w-full px-3 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] text-center"
                  value={ageInput.days || ''}
                  onChange={e => setAgeInput(prev => ({ ...prev, days: Math.max(0, parseInt(e.target.value) || 0) }))}
                  placeholder="D"
                  min="0"
                  max="29"
                />
                <p className="text-[10px] text-center text-gray-400 mt-1">Days</p>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">= {formatAge(ageToDays(ageInput))}</p>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Batch Image</label>
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
                id="batch-image"
                className="hidden"
                onChange={handleFileUpload}
              />
              <label
                htmlFor="batch-image"
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

        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Description</label>
          <textarea
            className="w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] min-h-[100px]"
            value={form.description || ''}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="Optional batch notes..."
          />
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
            {saving ? 'Saving...' : isEdit ? 'Update Batch' : 'Create Batch'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BatchForm;
