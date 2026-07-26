<?php

declare(strict_types=1);

function permissionsSettingsAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$panelSource = (string) file_get_contents($root . '/components/PermissionsSettingsPanel.tsx');
$settingsSource = (string) file_get_contents($root . '/pages/Settings.tsx');
$mutationsSource = (string) file_get_contents($root . '/src/hooks/useMutations.ts');
$backendSource = (string) file_get_contents($root . '/backend/src/MasterDataApi.php');

permissionsSettingsAssert(
    str_contains($panelSource, 'selectedRoleName')
        && str_contains($panelSource, 'Find a role')
        && str_contains($panelSource, 'Search permissions')
        && str_contains($panelSource, 'Enable section')
        && str_contains($panelSource, 'Collapse sections')
        && str_contains($panelSource, 'aria-expanded={isExpanded}')
        && str_contains($panelSource, 'space-y-3 p-5 sm:p-6')
        && str_contains($panelSource, "bg-[var(--primary-color,#0f2f57)] text-white")
        && str_contains($panelSource, "isSelected ? 'text-white/75' : 'text-gray-400'")
        && !str_contains($panelSource, '<table')
        && !str_contains($panelSource, 'overflow-x-auto')
        && !str_contains($panelSource, 'xl:grid-cols-2')
        && !str_contains($panelSource, "isSelected ? 'text-blue-100'"),
    'Permissions must use a theme-aware, searchable, one-role-at-a-time accordion without a two-column privilege grid.'
);

$handleSaveStart = strpos($settingsSource, 'const handleSave = async () =>');
$handleSaveEnd = strpos($settingsSource, 'const handleSaveBeSmart = async () =>');
permissionsSettingsAssert(
    $handleSaveStart !== false && $handleSaveEnd !== false && $handleSaveEnd > $handleSaveStart,
    'Unable to locate the settings save workflow.'
);
$handleSaveSource = substr($settingsSource, $handleSaveStart, $handleSaveEnd - $handleSaveStart);
permissionsSettingsAssert(
    str_contains($handleSaveSource, "activeTab === 'permissions'")
        && str_contains($handleSaveSource, 'await updatePermissionsSettingsMutation.mutateAsync')
        && str_contains($handleSaveSource, "queryClient.setQueryData(['settings', 'permissions'], persistedPermissions)")
        && !str_contains($handleSaveSource, 'updates.permissions ='),
    'Permissions must save through the dedicated awaited mutation and stay out of broad settings saves.'
);
permissionsSettingsAssert(
    str_contains($settingsSource, 'permissionsDirtyRef.current')
        && str_contains($settingsSource, 'onChange={handlePermissionsChange}')
        && str_contains($settingsSource, 'hasUnsavedChanges={permissionsDirty}'),
    'Unsaved permission edits must be protected from background query refreshes.'
);

$mutationStart = strpos($mutationsSource, 'export function useUpdatePermissionsSettings()');
$mutationEnd = strpos($mutationsSource, 'export function useUpdatePayrollSettings()');
permissionsSettingsAssert(
    $mutationStart !== false && $mutationEnd !== false && $mutationEnd > $mutationStart,
    'Unable to locate the dedicated permissions mutation.'
);
$mutationSource = substr($mutationsSource, $mutationStart, $mutationEnd - $mutationStart);
permissionsSettingsAssert(
    str_contains($mutationSource, 'onSuccess: (savedSettings)')
        && str_contains($mutationSource, "queryClient.setQueryData(['settings', 'permissions'], savedSettings)")
        && !str_contains($mutationSource, 'invalidateQueries'),
    'The successful mutation must retain the server-confirmed permission payload instead of replacing it via invalidation.'
);
permissionsSettingsAssert(
    str_contains($backendSource, 'INSERT INTO role_permissions (role_name, permissions, is_custom, created_at, updated_at)')
        && str_contains($backendSource, 'permissions = VALUES(permissions)')
        && str_contains($backendSource, '$this->permissionsSettingsPayloadCache = null;')
        && str_contains($backendSource, 'return $this->fetchPermissionsSettings();'),
    'The backend must upsert permission JSON and return a fresh persisted payload.'
);

$packageRoot = $root . '/deploy/cpanel-mamepilot-package';
$packagedSettingsFiles = glob($packageRoot . '/public_html/assets/Settings-*.js') ?: [];
if ($packagedSettingsFiles !== []) {
    $packagedSettingsSource = count($packagedSettingsFiles) === 1
        ? (string) file_get_contents($packagedSettingsFiles[0])
        : '';
    permissionsSettingsAssert(
        str_contains($packagedSettingsSource, 'Find a role')
            && str_contains($packagedSettingsSource, 'Search permissions')
            && str_contains($packagedSettingsSource, 'Permissions saved successfully!'),
        'The packaged Settings bundle does not include the permissions UX and persistence fixes.'
    );
}

echo "Permissions settings UX and persistence tests passed.\n";
