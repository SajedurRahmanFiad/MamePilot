import React, { useState } from 'react';
import { BatchCategory } from '../types';
import { useBatchCategories } from '../src/hooks/useQueries';
import { useCreateBatchCategory, useUpdateBatchCategory, useDeleteBatchCategory } from '../src/hooks/useMutations';
import { Button } from '../components';
import { ICONS } from '../constants';
import { theme } from '../theme';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { useToastNotifications } from '../src/contexts/ToastContext';

const BatchCategoriesSettingsPanel: React.FC = () => {
  const { data: categories = [], isPending } = useBatchCategories();
  const createMutation = useCreateBatchCategory();
  const updateMutation = useUpdateBatchCategory();
  const deleteMutation = useDeleteBatchCategory();
  const { can } = useRolePermissions();
  const toast = useToastNotifications();
  const canEdit = can('settings.editCategories');

  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formColor, setFormColor] = useState('#ebf4ff');

  const resetForm = () => {
    setFormName('');
    setFormDescription('');
    setFormColor('#ebf4ff');
    setIsAdding(false);
    setEditingId(null);
  };

  const handleAdd = async () => {
    if (!formName.trim()) return;
    try {
      await createMutation.mutateAsync({
        name: formName.trim(),
        description: formDescription.trim() || undefined,
        color: formColor,
      });
      toast.success('Batch category created');
      resetForm();
    } catch (err) {
      toast.error('Failed to create batch category');
    }
  };

  const handleUpdate = async (id: string) => {
    if (!formName.trim()) return;
    try {
      await updateMutation.mutateAsync({
        id,
        updates: {
          name: formName.trim(),
          description: formDescription.trim() || undefined,
          color: formColor,
        },
      });
      toast.success('Batch category updated');
      resetForm();
    } catch (err) {
      toast.error('Failed to update batch category');
    }
  };

  const handleDelete = async (id: string, name: string, isSystem: boolean) => {
    if (isSystem) {
      toast.error('Cannot delete system categories');
      return;
    }
    if (!confirm(`Delete batch category "${name}"? This cannot be undone.`)) return;
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Batch category deleted');
    } catch (err) {
      toast.error('Failed to delete batch category');
    }
  };

  const startEdit = (cat: BatchCategory) => {
    setEditingId(cat.id);
    setFormName(cat.name);
    setFormDescription(cat.description || '');
    setFormColor(cat.color || '#ebf4ff');
    setIsAdding(false);
  };

  if (isPending) {
    return <div className="text-center py-8 text-gray-500">Loading batch categories...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className={`text-lg font-black ${theme.colors.text.primary}`}>Batch Categories</h3>
          <p className={`text-sm ${theme.colors.text.secondary}`}>Manage categories for living product batches.</p>
        </div>
        {canEdit && !isAdding && !editingId && (
          <Button variant="primary" size="md" icon={ICONS.Plus} onClick={() => setIsAdding(true)}>
            Add Category
          </Button>
        )}
      </div>

      {(isAdding || editingId) && canEdit && (
        <div className={`p-4 border ${theme.colors.border.primary} rounded-xl bg-gray-50 space-y-3`}>
          <div className="flex gap-3">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Name</label>
              <input
                type="text"
                className={`w-full px-4 py-2.5 bg-white border rounded-xl focus:ring-2 focus:ring-[#3c5a82] ${theme.colors.text.primary}`}
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="Category name"
                autoFocus
              />
            </div>
            <div className="w-24 space-y-1">
              <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Color</label>
              <input
                type="color"
                className="w-full h-[42px] border rounded-xl cursor-pointer"
                value={formColor}
                onChange={e => setFormColor(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Description</label>
            <input
              type="text"
              className={`w-full px-4 py-2.5 bg-white border rounded-xl focus:ring-2 focus:ring-[#3c5a82] ${theme.colors.text.primary}`}
              value={formDescription}
              onChange={e => setFormDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" size="sm" onClick={resetForm}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => editingId ? handleUpdate(editingId) : handleAdd()}
              disabled={!formName.trim() || createMutation.isPending || updateMutation.isPending}
            >
              {editingId ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      )}

      <div className={`border ${theme.colors.border.primary} rounded-xl overflow-hidden`}>
        <table className="w-full">
          <thead>
            <tr className={`border-b ${theme.colors.border.primary} bg-gray-50`}>
              <th className="text-left px-4 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Color</th>
              <th className="text-left px-4 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Name</th>
              <th className="text-left px-4 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Description</th>
              <th className="text-left px-4 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Type</th>
              {canEdit && <th className="text-right px-4 py-3 text-xs font-bold text-gray-400 uppercase tracking-widest">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {categories.map(cat => (
              <tr key={cat.id} className={`border-b ${theme.colors.border.primary} last:border-0 hover:bg-gray-50`}>
                <td className="px-4 py-3">
                  <div className="w-6 h-6 rounded-full border border-gray-200" style={{ backgroundColor: cat.color }} />
                </td>
                <td className={`px-4 py-3 font-bold ${theme.colors.text.primary}`}>{cat.name}</td>
                <td className={`px-4 py-3 text-sm ${theme.colors.text.secondary}`}>{cat.description || '—'}</td>
                <td className="px-4 py-3">
                  {cat.isSystem ? (
                    <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold">System</span>
                  ) : (
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs font-bold">Custom</span>
                  )}
                </td>
                {canEdit && (
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => startEdit(cat)}
                        className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 transition-colors"
                        title="Edit"
                      >
                        {ICONS.Edit}
                      </button>
                      {!cat.isSystem && (
                        <button
                          onClick={() => handleDelete(cat.id, cat.name, !!cat.isSystem)}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                          title="Delete"
                        >
                          {ICONS.Delete}
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {categories.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">No batch categories found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BatchCategoriesSettingsPanel;
