import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ICONS } from '../constants';
import { Button } from './Button';
import type { DashboardConfiguration, PermissionKey, PermissionsSettings, RolePermissionMap } from '../types';
import {
  PERMISSION_DEFINITIONS,
  STORED_PERMISSION_KEYS,
  clonePermissionsSettings,
  getDefaultPermissionsForRole,
  getPermissionRoles,
  isReservedPermissionRole,
  normalizeRoleName,
} from '../src/utils/permissions';
import { EMPLOYEE_DEFAULT_DASHBOARD_ID, dashboardHasScope } from '../src/dashboardConfig';

type PermissionsSettingsPanelProps = {
  value: PermissionsSettings;
  onChange: (next: PermissionsSettings) => void;
  dashboards: DashboardConfiguration[];
  hasUnsavedChanges?: boolean;
};

const SECTION_ORDER = ['Overview', 'Orders', 'Customers', 'Bills', 'Transactions', 'Inventory & Banking', 'Other Modules', 'Marketing', 'Settings'];

const checkboxClassName =
  'h-4 w-4 rounded border border-gray-300 accent-[var(--primary-color,#0f2f57)] focus:ring-[var(--primary-medium,#3c5a82)] focus:ring-offset-0';

const DISPLAYED_PERMISSION_KEYS = STORED_PERMISSION_KEYS.filter((key) => key !== 'dashboard.viewAdmin' && key !== 'dashboard.viewEmployee');

const PermissionsSettingsPanel: React.FC<PermissionsSettingsPanelProps> = ({ value, onChange, dashboards, hasUnsavedChanges = false }) => {
  const roles = useMemo(() => getPermissionRoles(value), [value]);
  const groupedDefinitions = useMemo(() => {
    return SECTION_ORDER.map((section) => ({
      section,
      items: PERMISSION_DEFINITIONS.filter((definition) => definition.section === section
        && definition.key !== 'dashboard.viewAdmin'
        && definition.key !== 'dashboard.viewEmployee'),
    })).filter((group) => group.items.length > 0);
  }, []);

  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [draftRoleName, setDraftRoleName] = useState('');
  const [draftPermissions, setDraftPermissions] = useState<RolePermissionMap>(() =>
    getDefaultPermissionsForRole('Employee'),
  );
  const [draftDashboardId, setDraftDashboardId] = useState(EMPLOYEE_DEFAULT_DASHBOARD_ID);
  const [roleError, setRoleError] = useState('');
  const [rolePendingRemoval, setRolePendingRemoval] = useState<string | null>(null);
  const [roleRemovalConfirmText, setRoleRemovalConfirmText] = useState('');
  const [roleRemovalError, setRoleRemovalError] = useState('');
  const [selectedRoleName, setSelectedRoleName] = useState(() => roles[0]?.roleName || '');
  const [roleSearch, setRoleSearch] = useState('');
  const [permissionSearch, setPermissionSearch] = useState('');
  const [expandedSections, setExpandedSections] = useState<Set<string>>(() => new Set([SECTION_ORDER[0]]));

  const selectedRole = roles.find((role) => role.roleName === selectedRoleName) || roles[0] || null;
  const filteredRoles = useMemo(() => {
    const query = roleSearch.trim().toLowerCase();
    if (!query) return roles;
    return roles.filter((role) => role.roleName.toLowerCase().includes(query));
  }, [roleSearch, roles]);
  const visibleGroups = useMemo(() => {
    const query = permissionSearch.trim().toLowerCase();
    return groupedDefinitions
      .map((group) => ({
        ...group,
        items: group.items.filter((definition) => {
          if (definition.key === 'allPrivileges') return false;
          if (!query) return true;
          return `${group.section} ${definition.label} ${definition.description}`.toLowerCase().includes(query);
        }),
      }))
      .filter((group) => group.items.length > 0);
  }, [groupedDefinitions, permissionSearch]);
  const enabledPermissionCount = selectedRole
    ? DISPLAYED_PERMISSION_KEYS.filter((key) => selectedRole.permissions[key]).length
    : 0;

  useEffect(() => {
    if (selectedRole && selectedRole.roleName === selectedRoleName) return;
    setSelectedRoleName(roles[0]?.roleName || '');
  }, [roles, selectedRole, selectedRoleName]);

  useEffect(() => {
    if (!permissionSearch.trim()) return;
    setExpandedSections((current) => {
      const next = new Set(current);
      visibleGroups.forEach((group) => next.add(group.section));
      return next;
    });
  }, [permissionSearch, visibleGroups]);

  const toggleExpandedSection = (section: string) => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const areVisibleSectionsExpanded = visibleGroups.length > 0
    && visibleGroups.every((group) => expandedSections.has(group.section));

  const toggleVisibleSections = () => {
    setExpandedSections((current) => {
      const next = new Set(current);
      if (areVisibleSectionsExpanded) {
        visibleGroups.forEach((group) => next.delete(group.section));
      } else {
        visibleGroups.forEach((group) => next.add(group.section));
      }
      return next;
    });
  };

  const updateRolePermissions = (roleName: string, updater: (current: RolePermissionMap) => RolePermissionMap) => {
    const next = clonePermissionsSettings(value);
    next.roles = next.roles.map((role) =>
      role.roleName === roleName
        ? {
            ...role,
            permissions: updater({ ...role.permissions }),
          }
        : role,
    );
    onChange(next);
  };

  const togglePermission = (roleName: string, permissionKey: PermissionKey) => {
    updateRolePermissions(roleName, (current) => ({
      ...current,
      [permissionKey]: !current[permissionKey],
    }));
  };

  const toggleSection = (roleName: string, permissionKeys: PermissionKey[]) => {
    updateRolePermissions(roleName, (current) => {
      const shouldEnable = !permissionKeys.every((key) => current[key]);
      const next = { ...current };
      for (const key of permissionKeys) next[key] = shouldEnable;
      return next;
    });
  };

  const updateRoleDashboard = (roleName: string, dashboardId: string) => {
    const dashboard = dashboards.find((candidate) => candidate.id === dashboardId);
    if (!dashboard) return;
    const next = clonePermissionsSettings(value);
    next.roles = next.roles.map((role) => role.roleName === roleName
      ? {
          ...role,
          dashboardId,
          permissions: {
            ...role.permissions,
            'dashboard.viewAdmin': dashboardHasScope(dashboard, 'admin'),
            'dashboard.viewEmployee': dashboardHasScope(dashboard, 'employee'),
          },
        }
      : role);
    onChange(next);
  };

  const resetRoleModal = () => {
    setDraftRoleName('');
    setDraftPermissions(getDefaultPermissionsForRole('Employee'));
    setDraftDashboardId(dashboards.some((dashboard) => dashboard.id === EMPLOYEE_DEFAULT_DASHBOARD_ID)
      ? EMPLOYEE_DEFAULT_DASHBOARD_ID
      : dashboards[0]?.id || '');
    setRoleError('');
    setIsRoleModalOpen(false);
  };

  const toggleDraftPermission = (permissionKey: PermissionKey) => {
    setDraftPermissions((current) => ({
      ...current,
      [permissionKey]: !current[permissionKey],
    }));
  };

  const handleCreateRole = () => {
    const normalizedRoleName = normalizeRoleName(draftRoleName);
    const normalizedExistingRoles = new Set(roles.map((role) => role.roleName.toLowerCase()));

    if (!normalizedRoleName) {
      setRoleError('Please enter a role name.');
      return;
    }

    if (isReservedPermissionRole(normalizedRoleName)) {
      setRoleError('Admin and Developer are managed separately and cannot be added here.');
      return;
    }

    if (normalizedExistingRoles.has(normalizedRoleName.toLowerCase())) {
      setRoleError('That role already exists.');
      return;
    }

    const selectedDashboard = dashboards.find((dashboard) => dashboard.id === draftDashboardId);
    if (!selectedDashboard) {
      setRoleError('Please select a dashboard for the new role.');
      return;
    }

    const next = clonePermissionsSettings(value);
    next.roles.push({
      roleName: normalizedRoleName,
      isCustom: true,
      dashboardId: draftDashboardId,
      permissions: {
        ...draftPermissions,
        'dashboard.viewAdmin': dashboardHasScope(selectedDashboard, 'admin'),
        'dashboard.viewEmployee': dashboardHasScope(selectedDashboard, 'employee'),
      },
      createdAt: null,
      updatedAt: null,
    });
    next.roles.sort((left, right) => {
      if (left.isCustom !== right.isCustom) {
        return left.isCustom ? 1 : -1;
      }
      return left.roleName.localeCompare(right.roleName);
    });

    onChange(next);
    setSelectedRoleName(normalizedRoleName);
    setRoleSearch('');
    resetRoleModal();
  };

  const openRoleRemovalModal = (roleName: string) => {
    setRolePendingRemoval(roleName);
    setRoleRemovalConfirmText('');
    setRoleRemovalError('');
  };

  const closeRoleRemovalModal = () => {
    setRolePendingRemoval(null);
    setRoleRemovalConfirmText('');
    setRoleRemovalError('');
  };

  const handleRemoveRole = () => {
    if (!rolePendingRemoval) {
      return;
    }

    if (roleRemovalConfirmText !== rolePendingRemoval) {
      setRoleRemovalError('Type the exact role name to confirm removal.');
      return;
    }

    const next = clonePermissionsSettings(value);
    next.roles = next.roles.filter((role) => role.roleName !== rolePendingRemoval);
    onChange(next);
    if (selectedRoleName === rolePendingRemoval) {
      setSelectedRoleName(next.roles[0]?.roleName || '');
    }
    closeRoleRemovalModal();
  };

  return (
    <div className="min-w-0 space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="mt-2 text-xl font-black text-gray-900">Role-based access</h3>
          <p className="mt-2 max-w-2xl text-sm font-medium text-gray-500">
            Choose one role, then adjust its access below. Changes apply only after you save.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {hasUnsavedChanges && (
            <span className="rounded-full bg-amber-50 px-3 py-1.5 text-xs font-black text-amber-700 ring-1 ring-amber-200">
              Unsaved changes
            </span>
          )}
          <Button onClick={() => setIsRoleModalOpen(true)} variant="primary" size="md">
            Add Custom Role
          </Button>
        </div>
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="min-w-0 self-start rounded-2xl border border-gray-100 bg-white p-4 shadow-sm lg:sticky lg:top-6">
          <label className="relative hidden lg:block">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{ICONS.Search}</span>
            <input
              type="search"
              value={roleSearch}
              onChange={(event) => setRoleSearch(event.target.value)}
              placeholder="Find a role"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-3 text-sm font-medium text-gray-800 outline-none transition focus:border-[var(--primary-medium,#3c5a82)] focus:bg-white focus:ring-4 focus:ring-[var(--primary-soft,#ebf4ff)]"
            />
          </label>

          <label className="mt-4 block lg:hidden">
            <span className="sr-only">Choose a role</span>
            <select
              value={selectedRole?.roleName || ''}
              onChange={(event) => setSelectedRoleName(event.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-bold text-gray-900 outline-none focus:border-[var(--primary-medium,#3c5a82)] focus:ring-4 focus:ring-[var(--primary-soft,#ebf4ff)]"
            >
              {roles.map((role) => <option key={role.roleName} value={role.roleName}>{role.roleName}</option>)}
            </select>
          </label>

          <div className="mt-4 hidden max-h-[68vh] space-y-1 overflow-y-auto pr-1 lg:block">
            {filteredRoles.map((role) => {
              const enabledCount = DISPLAYED_PERMISSION_KEYS.filter((key) => role.permissions[key]).length;
              const isSelected = selectedRole?.roleName === role.roleName;
              return (
                <button
                  key={role.roleName}
                  type="button"
                  onClick={() => setSelectedRoleName(role.roleName)}
                  className={`w-full rounded-xl px-3 py-3 text-left transition ${
                    isSelected
                      ? 'bg-[var(--primary-color,#0f2f57)] text-white shadow-sm'
                      : 'text-gray-700 hover:bg-[var(--primary-soft,#ebf4ff)] hover:text-[var(--primary-color,#0f2f57)]'
                  }`}
                >
                  <span className="block truncate text-sm font-black">{role.roleName}</span>
                  <span className={`mt-1 block text-xs font-semibold ${isSelected ? 'text-white/75' : 'text-gray-400'}`}>
                    {enabledCount} of {DISPLAYED_PERMISSION_KEYS.length} enabled
                  </span>
                </button>
              );
            })}
            {filteredRoles.length === 0 && (
              <p className="px-3 py-6 text-center text-sm font-medium text-gray-400">No roles found.</p>
            )}
          </div>
        </aside>

        <section className="min-w-0 rounded-2xl border border-gray-100 bg-white shadow-sm">
          {selectedRole ? (
            <>
              <div className="border-b border-gray-100 p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Editing role</p>
                    <h4 className="mt-2 truncate text-xl font-black text-gray-900">{selectedRole.roleName}</h4>
                    <p className="mt-1 text-sm font-medium text-gray-500">
                      {enabledPermissionCount} of {DISPLAYED_PERMISSION_KEYS.length} permissions enabled
                    </p>
                  </div>
                  {selectedRole.isCustom && (
                    <Button onClick={() => openRoleRemovalModal(selectedRole.roleName)} variant="danger" size="sm">
                      Remove Role
                    </Button>
                  )}
                </div>

                <label className="mt-5 block space-y-2">
                  <span className="text-xs font-black uppercase tracking-[0.16em] text-gray-400">Dashboard</span>
                  <select
                    value={selectedRole.dashboardId}
                    onChange={(event) => updateRoleDashboard(selectedRole.roleName, event.target.value)}
                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-900 outline-none transition focus:border-[var(--primary-medium,#3c5a82)] focus:bg-white focus:ring-4 focus:ring-[var(--primary-soft,#ebf4ff)]"
                  >
                    {dashboards.map((dashboard) => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}
                  </select>
                  <span className="block text-xs font-medium text-gray-500">This single selection replaces the Admin Dashboard and Employee Dashboard permission checkboxes.</span>
                </label>

                <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
                  <label className="relative block min-w-0 flex-1">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{ICONS.Search}</span>
                    <input
                      type="search"
                      value={permissionSearch}
                      onChange={(event) => setPermissionSearch(event.target.value)}
                      placeholder="Search permissions"
                      className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-3 text-sm font-medium text-gray-800 outline-none transition focus:border-[var(--primary-medium,#3c5a82)] focus:bg-white focus:ring-4 focus:ring-[var(--primary-soft,#ebf4ff)]"
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={toggleVisibleSections}
                      className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-black text-[var(--primary-color,#0f2f57)] transition hover:border-[var(--primary-medium,#3c5a82)] hover:bg-[var(--primary-soft,#ebf4ff)]"
                    >
                      {areVisibleSectionsExpanded ? 'Collapse sections' : 'Expand sections'}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-3 p-5 sm:p-6">
                {visibleGroups.map((group) => {
                  const permissionKeys = group.items.map((definition) => definition.key as PermissionKey);
                  const sectionEnabled = permissionKeys.every((key) => selectedRole.permissions[key]);
                  const enabledInSection = permissionKeys.filter((key) => selectedRole.permissions[key]).length;
                  const isExpanded = expandedSections.has(group.section);
                  const sectionPanelId = `permissions-section-${group.section.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
                  return (
                    <div key={group.section} className="min-w-0 overflow-hidden rounded-2xl border border-gray-200 bg-white transition hover:border-[var(--primary-medium,#3c5a82)]">
                      <div className="flex items-stretch bg-gray-50/80">
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          aria-controls={sectionPanelId}
                          onClick={() => toggleExpandedSection(group.section)}
                          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-4 text-left outline-none transition hover:bg-[var(--primary-soft,#ebf4ff)] focus-visible:bg-[var(--primary-soft,#ebf4ff)] sm:px-5"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[var(--primary-color,#0f2f57)] shadow-sm ring-1 ring-gray-200">
                            <ChevronDown size={18} className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-black uppercase tracking-[0.14em] text-[var(--primary-color,#0f2f57)]">{group.section}</span>
                            <span className="mt-1 block text-xs font-semibold text-gray-500">
                              {enabledInSection} of {permissionKeys.length} enabled
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleSection(selectedRole.roleName, permissionKeys)}
                          className="m-2 shrink-0 self-center rounded-xl border border-transparent px-3 py-2 text-xs font-black text-[var(--primary-color,#0f2f57)] transition hover:border-[var(--primary-medium,#3c5a82)] hover:bg-[var(--primary-soft,#ebf4ff)] sm:mr-3"
                        >
                          {sectionEnabled ? 'Clear section' : 'Enable section'}
                        </button>
                      </div>
                      {isExpanded && (
                        <div id={sectionPanelId} className="divide-y divide-gray-100 border-t border-gray-200 px-3 py-2 sm:px-4">
                          {group.items.map((definition) => {
                            const permissionKey = definition.key as PermissionKey;
                            return (
                              <label key={definition.key} className="flex cursor-pointer items-start gap-3 rounded-xl px-3 py-3.5 transition hover:bg-[var(--primary-soft,#ebf4ff)]">
                                <input
                                  type="checkbox"
                                  className={`${checkboxClassName} mt-0.5 shrink-0`}
                                  checked={selectedRole.permissions[permissionKey]}
                                  onChange={() => togglePermission(selectedRole.roleName, permissionKey)}
                                />
                                <span className="min-w-0">
                                  <span className="block text-sm font-bold text-gray-900">{definition.label}</span>
                                  <span className="mt-1 block text-xs font-medium leading-5 text-gray-500">{definition.description}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {visibleGroups.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-gray-200 px-6 py-12 text-center">
                    <p className="text-sm font-bold text-gray-700">No permissions match your search.</p>
                    <button type="button" onClick={() => setPermissionSearch('')} className="mt-2 text-sm font-black text-[var(--primary-color,#0f2f57)]">
                      Clear search
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="px-6 py-16 text-center text-sm font-medium text-gray-500">Add a role to start configuring permissions.</div>
          )}
        </section>
      </div>

      {isRoleModalOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={resetRoleModal} />
          <div className="relative z-10 flex h-full w-full max-h-[90vh] max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl flex-col">
            <div className="border-b border-gray-100 px-8 py-6">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Custom Role</p>
              <h3 className="mt-2 text-2xl font-black text-gray-900">Add a role with its own permission set</h3>
            </div>

            <div className="flex-1 overflow-y-auto px-8 py-6">
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Role Name</label>
                  <input
                    type="text"
                    value={draftRoleName}
                    onChange={(event) => {
                      setDraftRoleName(event.target.value);
                      setRoleError('');
                    }}
                    placeholder="Example: Support Manager"
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition-all focus:border-[var(--primary-medium,#3c5a82)] focus:bg-white focus:ring-4 focus:ring-[var(--primary-soft,#ebf4ff)]"
                  />
                  <p className="text-xs font-medium text-gray-500">
                    New roles start from the current Employee defaults so you can adjust from a practical baseline.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Dashboard</label>
                  <select
                    value={draftDashboardId}
                    onChange={(event) => { setDraftDashboardId(event.target.value); setRoleError(''); }}
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-900 outline-none transition-all focus:border-[var(--primary-medium,#3c5a82)] focus:bg-white focus:ring-4 focus:ring-[var(--primary-soft,#ebf4ff)]"
                  >
                    {dashboards.map((dashboard) => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}
                  </select>
                </div>

                {roleError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                    {roleError}
                  </div>
                )}

                <div className="rounded-2xl border border-gray-100">
                  <div className="grid gap-6 px-6 py-6">
                    {groupedDefinitions.map((group) => (
                      <div key={group.section} className="space-y-4 rounded-2xl border border-gray-100 p-5">
                        <h4 className="text-sm font-black uppercase tracking-[0.16em] text-[var(--primary-color,#0f2f57)]">{group.section}</h4>
                        <div className="space-y-3">
                          {group.items
                            .filter((definition) => definition.key !== 'allPrivileges')
                            .map((definition) => {
                              const permissionKey = definition.key as PermissionKey;
                              return (
                                <label key={definition.key} className="flex items-start gap-3">
                                  <input
                                    type="checkbox"
                                    className={`${checkboxClassName} mt-1`}
                                    checked={draftPermissions[permissionKey]}
                                    onChange={() => toggleDraftPermission(permissionKey)}
                                  />
                                  <span>
                                    <span className="block text-sm font-bold text-gray-900">{definition.label}</span>
                                    <span className="mt-1 block text-xs font-medium text-gray-500">{definition.description}</span>
                                  </span>
                                </label>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-3 border-t border-gray-100 px-8 py-5">
              <Button onClick={resetRoleModal} variant="ghost" className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleCreateRole} variant="primary" size="md" className="flex-1">
                Add Role
              </Button>
            </div>
          </div>
        </div>
      )}

      {rolePendingRemoval && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={closeRoleRemovalModal} />
          <div className="relative z-10 w-full max-w-lg rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-gray-100 px-8 py-6">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-red-400">Critical Action</p>
              <h3 className="mt-2 text-2xl font-black text-gray-900">Remove Role</h3>
              <p className="mt-2 text-sm font-medium text-gray-500">
                Type <span className="font-black text-gray-900">{rolePendingRemoval}</span> exactly to remove this role and its saved permission set.
              </p>
            </div>

            <div className="space-y-4 px-8 py-6">
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                Users already assigned to this role will no longer have a saved permission profile for it.
              </div>

              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Confirm Role Name</label>
                <input
                  type="text"
                  value={roleRemovalConfirmText}
                  onChange={(event) => {
                    setRoleRemovalConfirmText(event.target.value);
                    setRoleRemovalError('');
                  }}
                  placeholder={rolePendingRemoval}
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition-all focus:border-[var(--primary-medium,#3c5a82)] focus:bg-white focus:ring-4 focus:ring-[var(--primary-soft,#ebf4ff)]"
                />
              </div>

              {roleRemovalError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                  {roleRemovalError}
                </div>
              )}
            </div>

            <div className="flex gap-3 border-t border-gray-100 px-8 py-5">
              <Button onClick={closeRoleRemovalModal} variant="ghost" className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleRemoveRole} variant="danger" size="md" className="flex-1">
                Remove Role
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PermissionsSettingsPanel;
