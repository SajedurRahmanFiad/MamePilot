<?php

declare(strict_types=1);

function themeSettingsAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$settingsSource = (string) file_get_contents($root . '/pages/Settings.tsx');
$queriesSource = (string) file_get_contents($root . '/src/hooks/useQueries.ts');

$queryStart = strpos($queriesSource, 'export function useSystemDefaults()');
$queryEnd = strpos($queriesSource, 'export function useCapabilitySettings(');
themeSettingsAssert(
    $queryStart !== false && $queryEnd !== false && $queryEnd > $queryStart,
    'Unable to locate the system-defaults query.'
);
$querySource = substr($queriesSource, $queryStart, $queryEnd - $queryStart);
themeSettingsAssert(
    str_contains($querySource, 'staleTime: 5 * 60 * 1000')
        && str_contains($querySource, 'retry: 3')
        && str_contains($querySource, 'refetchOnWindowFocus: true')
        && str_contains($querySource, 'refetchOnReconnect: true')
        && str_contains($querySource, 'writeSystemDefaultsCache(data)'),
    'System defaults must recover after a transient update reload and retain the last live value in startup cache.'
);

$handleSaveStart = strpos($settingsSource, 'const handleSave = async () =>');
$handleSaveEnd = strpos($settingsSource, 'const handleSaveBeSmart = async () =>');
themeSettingsAssert(
    $handleSaveStart !== false && $handleSaveEnd !== false && $handleSaveEnd > $handleSaveStart,
    'Unable to locate the settings save workflow.'
);
$handleSaveSource = substr($settingsSource, $handleSaveStart, $handleSaveEnd - $handleSaveStart);

foreach (['company', 'order', 'defaults', 'wallet', 'courier'] as $section) {
    themeSettingsAssert(
        str_contains($handleSaveSource, "case '{$section}':"),
        "The {$section} tab must have an isolated save branch."
    );
}

themeSettingsAssert(
    str_contains($handleSaveSource, 'Array.from(systemDefaultsDirtyFieldsRef.current)')
        && str_contains($handleSaveSource, 'payload[field] = systemDefaults[field]')
        && !str_contains($handleSaveSource, 'updates.defaults = systemDefaults')
        && !str_contains($handleSaveSource, 'updates.company = normalizedCompany,')
        && !str_contains($handleSaveSource, 'updates.wallet = walletSettings,'),
    'Defaults must submit only edited fields, and an active-tab save must not recreate the old all-sections payload.'
);

themeSettingsAssert(
    str_contains($handleSaveSource, 'writeSystemDefaultsCache(response.defaults)')
        && str_contains($handleSaveSource, 'if (updates.defaults)')
        && str_contains($handleSaveSource, 'systemDefaultsDirtyFieldsRef.current.clear()')
        && str_contains($handleSaveSource, "queryClient.invalidateQueries({ queryKey: ['settings'], exact: false })"),
    'Server-confirmed defaults must refresh browser caches without clearing a draft saved from another tab.'
);

themeSettingsAssert(
    str_contains($settingsSource, "setSystemDefaultField('themeColor', e.target.value)")
        && !str_contains($settingsSource, 'setSystemDefaults({...systemDefaults, themeColor: e.target.value})'),
    'Changing the theme must participate in field-level dirty tracking.'
);

$packageAssets = $root . '/deploy/cpanel-mamepilot-package/public_html/assets';
if (is_dir($packageAssets)) {
    $mainBundles = glob($packageAssets . '/index-*.js') ?: [];
    $settingsBundles = glob($packageAssets . '/Settings-*.js') ?: [];
    themeSettingsAssert(
        count($mainBundles) === 1 && count($settingsBundles) === 1,
        'The generated package must contain exactly one main bundle and one Settings bundle.'
    );

    $mainBundle = (string) file_get_contents($mainBundles[0]);
    $settingsBundle = (string) file_get_contents($settingsBundles[0]);
    themeSettingsAssert(
        str_contains($mainBundle, 'style.setProperty("--primary-color"')
            && str_contains($mainBundle, 'retry:3')
            && str_contains($mainBundle, 'refetchOnReconnect:!0'),
        'The packaged main bundle does not include global theme hydration and transient-failure recovery.'
    );
    themeSettingsAssert(
        str_contains($settingsBundle, 'No default-setting changes to save.')
            && str_contains($settingsBundle, 'Saving settings...')
            && str_contains($settingsBundle, 'Changes on this tab are saved when you make them.'),
        'The packaged Settings bundle does not include isolated active-tab saves.'
    );
}

echo "Theme and settings persistence regression tests passed.\n";
