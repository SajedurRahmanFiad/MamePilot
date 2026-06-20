import React, { useMemo, useState } from 'react';
import { ICONS } from '../constants';
import { Button } from './Button';
import type { PermissionKey, PermissionsSettings, RolePermissionMap } from '../types';
import {
  PERMISSION_DEFINITIONS,
  STORED_PERMISSION_KEYS,
  areAllPrivilegesEnabled,
  clonePermissionsSettings,
  createBlankPermissionMap,
  getDefaultPermissionsForRole,
  getPermissionRoles,
  isReservedPermissionRole,
  normalizeRoleName,
} from '../src/utils/permissions';

type PermissionsSettingsPanelProps = {
  value: PermissionsSettings;
  onChange: (next: PermissionsSettings) => void;
};

const SECTION_ORDER = ['Overview', 'Orders', 'Customers', 'Bills', 'Transactions', 'Inventory & Banking', 'Other Modules'];

const checkboxClassName =
  'h-4 w-4 rounded border border-gray-300 text-[#0f2f57] focus:ring-[#0f2f57] focus:ring-offset-0';

const PermissionsSettingsPanel: React.FC<PermissionsSettingsPanelProps> = ({ value, onChange }) => {
  const roles = useMemo(() => getPermissionRoles(value), [value]);
  const groupedDefinitions = useMemo(() => {
    return SECTION_ORDER.map((section) => ({
      section,
      items: PERMISSION_DEFINITIONS.filter((definition) => definition.section === section),
    })).filter((group) => group.items.length > 0);
  }, []);

  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [draftRoleName, setDraftRoleName] = useState('');
  const [draftPermissions, setDraftPermissions] = useState<RolePermissionMap>(() =>
    getDefaultPermissionsForRole('Employee'),
  );
  const [roleError, setRoleError] = useState('');
  const [rolePendingRemoval, setRolePendingRemoval] = useState<string | null>(null);
  const [roleRemovalConfirmText, setRoleRemovalConfirmText] = useState('');
  const [roleRemovalError, setRoleRemovalError] = useState('');

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

  const toggleAllPrivileges = (roleName: string) => {
    updateRolePermissions(roleName, (current) => {
      const nextValue = !areAllPrivilegesEnabled(current);
      const next = { ...current };
      for (const key of STORED_PERMISSION_KEYS) {
        next[key] = nextValue;
      }
      return next;
    });
  };

  const resetRoleModal = () => {
    setDraftRoleName('');
    setDraftPermissions(getDefaultPermissionsForRole('Employee'));
    setRoleError('');
    setIsRoleModalOpen(false);
  };

  const toggleDraftPermission = (permissionKey: PermissionKey) => {
    setDraftPermissions((current) => ({
      ...current,
      [permissionKey]: !current[permissionKey],
    }));
  };

  const toggleDraftAllPrivileges = () => {
    const shouldEnable = !areAllPrivilegesEnabled(draftPermissions);
    const next = createBlankPermissionMap();
    for (const key of STORED_PERMISSION_KEYS) {
      next[key] = shouldEnable;
    }
    setDraftPermissions(next);
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

    if (!draftPermissions['dashboard.viewAdmin'] && !draftPermissions['dashboard.viewEmployee']) {
      setRoleError('Please enable at least one dashboard permission for the new role.');
      return;
    }

    const next = clonePermissionsSettings(value);
    next.roles.push({
      roleName: normalizedRoleName,
      isCustom: true,
      permissions: { ...draftPermissions },
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
    closeRoleRemovalModal();
  };

  return (
    <div className="min-w-0 space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col gap-4 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="mt-2 text-xl font-black text-gray-900">Role-based access</h3>
        </div>
        <Button onClick={() => setIsRoleModalOpen(true)} variant="primary" size="md">
          Add Custom Role
        </Button>
      </div>

      <div className="w-full max-w-full overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="max-w-full overflow-x-auto pb-2">
          <table className="w-max min-w-full border-collapse">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                <th className="sticky left-0 z-10 min-w-[280px] bg-gray-50 px-6 py-4 text-left text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
                  Permission
                </th>
                {roles.map((role) => (
                  <th key={role.roleName} className="min-w-[128px] px-4 py-4 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-sm font-black text-gray-900">{role.roleName}</span>
                      {role.isCustom && (
                        <button
                          type="button"
                          onClick={() => openRoleRemovalModal(role.roleName)}
                          className="flex h-7 w-7 items-center justify-center rounded-full text-red-500 transition-all hover:bg-red-50"
                          title={`Remove ${role.roleName}`}
                          aria-label={`Remove ${role.roleName}`}
                        >
                          {ICONS.Delete}
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groupedDefinitions.map((group) => (
                <React.Fragment key={group.section}>
                  <tr className="border-b border-gray-100 bg-[#f8fbff]">
                    <td
                      colSpan={roles.length + 1}
                      className="px-6 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-[#0f2f57]"
                    >
                      {group.section}
                    </td>
                  </tr>
                  {group.items.map((definition) => (
                    <tr key={definition.key} className="border-b border-gray-100 last:border-b-0">
                      <td className="sticky left-0 z-[1] min-w-[280px] bg-white px-6 py-4 align-top">
                        <div>
                          <p className="text-sm font-bold text-gray-900">{definition.label}</p>
                          <p className="mt-1 text-xs font-medium text-gray-500">{definition.description}</p>
                        </div>
                      </td>
                      {roles.map((role) => {
                        if (definition.key === 'allPrivileges') {
                          return (
                            <td key={`${role.roleName}-${definition.key}`} className="px-4 py-4 text-center align-middle">
                              <div className="flex items-center justify-center">
                                <input
                                  type="checkbox"
                                  className={checkboxClassName}
                                  checked={areAllPrivilegesEnabled(role.permissions)}
                                  onChange={() => toggleAllPrivileges(role.roleName)}
                                />
                              </div>
                            </td>
                          );
                        }

                        const permissionKey = definition.key as PermissionKey;
                        return (
                          <td key={`${role.roleName}-${definition.key}`} className="px-4 py-4 text-center align-middle">
                            <div className="flex items-center justify-center">
                              <input
                                type="checkbox"
                                className={checkboxClassName}
                                checked={role.permissions[permissionKey]}
                                onChange={() => togglePermission(role.roleName, permissionKey)}
                              />
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
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
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition-all focus:border-[#0f2f57] focus:bg-white"
                  />
                  <p className="text-xs font-medium text-gray-500">
                    New roles start from the current Employee defaults so you can adjust from a practical baseline.
                  </p>
                </div>

                {roleError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-600">
                    {roleError}
                  </div>
                )}

                <div className="rounded-2xl border border-gray-100">
                  <div className="border-b border-gray-100 bg-gray-50 px-6 py-4">
                    <label className="flex items-center gap-3 text-sm font-black text-gray-900">
                      <input
                        type="checkbox"
                        className={checkboxClassName}
                        checked={areAllPrivilegesEnabled(draftPermissions)}
                        onChange={toggleDraftAllPrivileges}
                      />
                      All Privileges
                    </label>
                  </div>
                  <div className="grid gap-6 px-6 py-6">
                    {groupedDefinitions.map((group) => (
                      <div key={group.section} className="space-y-4 rounded-2xl border border-gray-100 p-5">
                        <h4 className="text-sm font-black uppercase tracking-[0.16em] text-[#0f2f57]">{group.section}</h4>
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
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-medium text-gray-800 outline-none transition-all focus:border-[#0f2f57] focus:bg-white"
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
