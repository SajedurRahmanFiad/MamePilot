import React, { useEffect, useMemo, useState } from 'react';
import type { DashboardConfiguration, DashboardItemSetting, DashboardSettings, OrderKpiTimeBasis } from '../types';
import {
  DASHBOARD_KPI_DEFINITIONS,
  DASHBOARD_WIDGET_DEFINITIONS,
  ORDER_KPI_TIME_BASIS_OPTIONS,
  cloneDashboardSettings,
  normalizeDashboardConfiguration,
} from '../src/dashboardConfig';
import { ICONS } from '../constants';
import { Button } from './Button';

interface DashboardSettingsPanelProps {
  value: DashboardSettings;
  onChange: (next: DashboardSettings) => void;
  hasUnsavedChanges?: boolean;
  lowStockThreshold?: number;
  onLowStockThresholdChange?: (value: number) => void;
}

interface OrderedChecklistProps {
  title: string;
  description: string;
  items: DashboardItemSetting[];
  definitions: typeof DASHBOARD_KPI_DEFINITIONS;
  onChange: (items: DashboardItemSetting[]) => void;
  headerExtra?: React.ReactNode;
  showWidth?: boolean;
}

const OrderedChecklist: React.FC<OrderedChecklistProps> = ({ title, description, items, definitions, onChange, headerExtra, showWidth }) => {
  const definitionByKey = useMemo(() => new Map(definitions.map((definition) => [definition.key, definition])), [definitions]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [widthDrafts, setWidthDrafts] = useState<Record<string, string>>({});

  const moveItem = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || toIndex < 0 || toIndex >= items.length) return;
    const next = items.map((item) => ({ ...item }));
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onChange(next);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h4 className="text-base font-black text-gray-900">{title}</h4>
            <p className="mt-1 text-xs font-medium leading-5 text-gray-500">{description}</p>
          </div>
          {headerExtra}
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {items.map((item, index) => {
          const definition = definitionByKey.get(item.key);
          if (!definition) return null;
          return (
            <div
              key={item.key}
              draggable
              onDragStart={() => setDraggedIndex(index)}
              onDragEnd={() => setDraggedIndex(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => {
                if (draggedIndex !== null) moveItem(draggedIndex, index);
                setDraggedIndex(null);
              }}
              className={`flex items-center gap-3 px-4 py-3 transition ${draggedIndex === index ? 'bg-[#f2f7fc] opacity-60' : 'bg-white hover:bg-gray-50'}`}
            >
              <span className="cursor-grab select-none text-lg font-black tracking-[-0.2em] text-gray-300 active:cursor-grabbing" title="Drag to reorder" aria-hidden="true">••</span>
              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={item.enabled}
                  onChange={() => onChange(items.map((candidate) => candidate.key === item.key ? { ...candidate, enabled: !candidate.enabled } : { ...candidate }))}
                  className="mt-1 h-4 w-4 rounded border-gray-300 accent-[var(--primary-color,#0f2f57)]"
                />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">{definition.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${definition.scope === 'admin' ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-600'}`}>
                      {definition.scope}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs font-medium leading-5 text-gray-500">{definition.description}</span>
                </span>
              </label>
              <div className="flex shrink-0 items-center gap-1 sm:hidden">
                <button type="button" onClick={() => moveItem(index, index - 1)} disabled={index === 0} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-25" aria-label={`Move ${definition.label} up`}>↑</button>
                <button type="button" onClick={() => moveItem(index, index + 1)} disabled={index === items.length - 1} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 disabled:opacity-25" aria-label={`Move ${definition.label} down`}>↓</button>
              </div>
              {showWidth && item.enabled && (
                <div className="flex shrink-0 items-center gap-1.5">
                  <input
                    type="number"
                    min={10}
                    max={100}
                    step={5}
                    value={widthDrafts[item.key] ?? String(item.widthPercent ?? 50)}
                    onChange={(e) => setWidthDrafts((prev) => ({ ...prev, [item.key]: e.target.value }))}
                    onBlur={(e) => {
                      const raw = e.target.value;
                      const num = parseInt(raw, 10);
                      const val = isNaN(num) ? 50 : Math.min(100, Math.max(10, num));
                      setWidthDrafts((prev) => { const next = { ...prev }; delete next[item.key]; return next; });
                      if (val !== (item.widthPercent ?? 50)) {
                        onChange(items.map((candidate) => candidate.key === item.key ? { ...candidate, widthPercent: val } : { ...candidate }));
                      }
                    }}
                    className="w-16 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-center text-xs font-bold outline-none focus:border-[#3c5a82] focus:bg-white"
                    title="Widget width %"
                  />
                  <span className="text-[10px] font-bold text-gray-400">%</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};

const DashboardSettingsPanel: React.FC<DashboardSettingsPanelProps> = ({ value, onChange, hasUnsavedChanges = false, lowStockThreshold = 10, onLowStockThresholdChange }) => {
  const [selectedDashboardId, setSelectedDashboardId] = useState(value.dashboards[0]?.id || '');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newDashboardName, setNewDashboardName] = useState('');
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    if (value.dashboards.some((dashboard) => dashboard.id === selectedDashboardId)) return;
    setSelectedDashboardId(value.dashboards[0]?.id || '');
  }, [selectedDashboardId, value.dashboards]);

  const selectedDashboard = value.dashboards.find((dashboard) => dashboard.id === selectedDashboardId) || null;
  const updateSelected = (updater: (dashboard: DashboardConfiguration) => DashboardConfiguration) => {
    const next = cloneDashboardSettings(value);
    next.dashboards = next.dashboards.map((dashboard) => dashboard.id === selectedDashboardId ? updater(dashboard) : dashboard);
    onChange(next);
  };

  const closeCreate = () => {
    setIsCreateOpen(false);
    setNewDashboardName('');
    setCreateError('');
  };

  const createDashboard = () => {
    const name = newDashboardName.replace(/\s+/g, ' ').trim();
    if (!name) {
      setCreateError('Enter a dashboard name.');
      return;
    }
    if (value.dashboards.some((dashboard) => dashboard.name.localeCompare(name, undefined, { sensitivity: 'accent' }) === 0)) {
      setCreateError('Dashboard names must be unique.');
      return;
    }
    const generatedId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `dashboard-${crypto.randomUUID()}`
      : `dashboard-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const dashboard = normalizeDashboardConfiguration({ id: generatedId, name, isSystem: false, systemKey: null });
    const next = cloneDashboardSettings(value);
    next.dashboards.push(dashboard);
    onChange(next);
    setSelectedDashboardId(generatedId);
    closeCreate();
  };

  const removeSelectedDashboard = () => {
    if (!selectedDashboard || selectedDashboard.isSystem) return;
    if (!window.confirm(`Remove dashboard "${selectedDashboard.name}"? Roles using it will fall back to Employee Dashboard (Default) when you save.`)) return;
    const next = cloneDashboardSettings(value);
    next.dashboards = next.dashboards.filter((dashboard) => dashboard.id !== selectedDashboard.id);
    onChange(next);
    setSelectedDashboardId(next.dashboards[0]?.id || '');
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="rounded-2xl border border-[#dbe8f5] bg-[#f8fbff] px-5 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-black text-gray-900">Dashboard layouts</h3>
              {hasUnsavedChanges && <span className="rounded-full bg-amber-100 px-2 py-1 text-[9px] font-black uppercase tracking-wider text-amber-700">Unsaved</span>}
            </div>
            <p className="mt-1 text-sm font-medium text-gray-500">Choose which cards and widgets appear, then drag them into the exact display order.</p>
          </div>
          <Button onClick={() => setIsCreateOpen(true)} variant="primary" size="md" icon={ICONS.Plus}>Add Dashboard</Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="h-fit overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Dashboards</div>
          <div className="space-y-1 p-2">
            {value.dashboards.map((dashboard) => (
              <button
                key={dashboard.id}
                type="button"
                onClick={() => setSelectedDashboardId(dashboard.id)}
                className={`w-full rounded-xl px-3 py-3 text-left transition ${dashboard.id === selectedDashboardId ? 'bg-[var(--primary-color,#0f2f57)] text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <span className="block text-sm font-black leading-5">{dashboard.name}</span>
                <span className={`mt-1 block text-[9px] font-black uppercase tracking-wider ${dashboard.id === selectedDashboardId ? 'text-white/65' : 'text-gray-400'}`}>
                  {dashboard.isSystem ? 'Fixed dashboard' : 'Custom dashboard'}
                </span>
              </button>
            ))}
          </div>
        </aside>

        {selectedDashboard ? (
          <div className="space-y-5">
            <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <label className="min-w-0 flex-1 space-y-2">
                  <span className="text-xs font-black uppercase tracking-[0.16em] text-gray-400">Dashboard Name</span>
                  <input
                    type="text"
                    value={selectedDashboard.name}
                    readOnly={selectedDashboard.isSystem}
                    onChange={(event) => updateSelected((dashboard) => ({ ...dashboard, name: event.target.value }))}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-900 outline-none focus:border-[#3c5a82] focus:bg-white read-only:cursor-not-allowed read-only:text-gray-500"
                  />
                </label>
                {!selectedDashboard.isSystem && <Button onClick={removeSelectedDashboard} variant="danger" size="md" icon={ICONS.Delete}>Remove</Button>}
              </div>
              {selectedDashboard.isSystem && <p className="mt-3 text-xs font-medium text-gray-500">The default dashboard name and record are fixed, but its cards, widgets, and order can be customized.</p>}
            </div>

            <OrderedChecklist
              title="KPI Cards"
              description="Enabled cards are rendered first in this exact order. Returned Orders is available here as an additional card."
              items={selectedDashboard.kpiCards}
              definitions={DASHBOARD_KPI_DEFINITIONS}
              onChange={(items) => updateSelected((dashboard) => ({ ...dashboard, kpiCards: items }))}
              headerExtra={
                <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="flex min-w-[240px] flex-1 flex-col gap-1.5">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">Order KPI time basis</span>
                    <select
                      value={selectedDashboard.orderKpiTimeBasis}
                      onChange={(event) => updateSelected((dashboard) => ({ ...dashboard, orderKpiTimeBasis: event.target.value as OrderKpiTimeBasis }))}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-[#3c5a82]"
                    >
                      {ORDER_KPI_TIME_BASIS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <span className="text-[11px] font-medium leading-4 text-gray-400">
                      {ORDER_KPI_TIME_BASIS_OPTIONS.find((option) => option.value === selectedDashboard.orderKpiTimeBasis)?.description}
                    </span>
                  </label>
                  <label className="flex min-w-[120px] flex-col gap-1.5">
                    <span className="text-[10px] font-black uppercase tracking-[0.16em] text-gray-400">Low stock threshold</span>
                    <input
                      type="number"
                      min={1}
                      max={99999}
                      value={lowStockThreshold}
                      onChange={(event) => onLowStockThresholdChange?.(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-800 outline-none focus:border-[#3c5a82]"
                    />
                    <span className="text-[11px] font-medium leading-4 text-gray-400">Items at or below this stock amount count as low.</span>
                  </label>
                </div>
              }
            />
            <OrderedChecklist
              title="Widgets"
              description="Enabled widgets are rendered after the KPI cards in this exact order. Set the width % for each widget (desktop only)."
              items={selectedDashboard.widgets}
              definitions={DASHBOARD_WIDGET_DEFINITIONS}
              onChange={(items) => updateSelected((dashboard) => ({ ...dashboard, widgets: items }))}
              showWidth
            />
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-8 py-16 text-center text-sm font-medium text-gray-500">Add a dashboard to begin configuring it.</div>
        )}
      </div>

      {isCreateOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={closeCreate} />
          <div className="relative z-10 w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-7 py-6">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Custom Dashboard</p>
              <h3 className="mt-2 text-2xl font-black text-gray-900">Create a dashboard</h3>
              <p className="mt-2 text-sm font-medium text-gray-500">It starts with every card and widget disabled so you can build the exact layout you need.</p>
            </div>
            <div className="space-y-3 px-7 py-6">
              <label className="text-xs font-black uppercase tracking-[0.16em] text-gray-400">Dashboard Name</label>
              <input autoFocus type="text" value={newDashboardName} onChange={(event) => { setNewDashboardName(event.target.value); setCreateError(''); }} onKeyDown={(event) => { if (event.key === 'Enter') createDashboard(); }} className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 font-bold outline-none focus:border-[#3c5a82] focus:bg-white" placeholder="Example: Sales Team Dashboard" />
              {createError && <p className="text-sm font-semibold text-red-600">{createError}</p>}
            </div>
            <div className="flex gap-3 border-t border-gray-100 px-7 py-5">
              <Button onClick={closeCreate} variant="ghost" className="flex-1">Cancel</Button>
              <Button onClick={createDashboard} variant="primary" className="flex-1">Create Dashboard</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardSettingsPanel;
