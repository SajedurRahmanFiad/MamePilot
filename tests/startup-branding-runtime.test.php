<?php

declare(strict_types=1);

function startupBrandingAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$indexSource = (string) file_get_contents($root . '/index.html');
$appSource = (string) file_get_contents($root . '/App.tsx');
$providerSource = (string) file_get_contents($root . '/src/contexts/BrandingProvider.tsx');
$layoutSource = (string) file_get_contents($root . '/components/Layout.tsx');
$loginSource = (string) file_get_contents($root . '/pages/Login.tsx');

startupBrandingAssert(
    str_contains($indexSource, '<title>Loading...</title>')
        && str_contains($indexSource, 'data:image/svg+xml')
        && !str_contains($indexSource, '<title>Mame Pilot - Management</title>')
        && !str_contains($indexSource, '<link rel="icon" href="/uploads/Avatar.png">'),
    'The HTML shell must stay neutral before runtime settings resolve.'
);

startupBrandingAssert(
    str_contains($appSource, "import { BrandingProvider }")
        && str_contains($appSource, '<BrandingProvider>')
        && str_contains($appSource, '</BrandingProvider>'),
    'The app must resolve branding once above public and authenticated routes.'
);

startupBrandingAssert(
    str_contains($providerSource, "useSystemDefaults()")
        && str_contains($providerSource, 'verifySystemDefaults()')
        && str_contains($providerSource, 'whiteLabelEnabled')
        && str_contains($providerSource, 'verifyGlobalBranding()')
        && strpos($providerSource, 'verifySystemDefaults()') < strpos($providerSource, 'verifyGlobalBranding()')
        && str_contains($providerSource, "mode: 'loading'")
        && str_contains($providerSource, "mode: 'mamepilot'")
        && str_contains($providerSource, "mode: 'white-label'")
        && str_contains($providerSource, "mode: 'unavailable'")
        && str_contains($providerSource, 'TRANSPARENT_ICON'),
    'Branding must remain neutral until live defaults and, when enabled, global branding are verified in order.'
);

startupBrandingAssert(
    str_contains($layoutSource, 'useAppBranding()')
        && str_contains($layoutSource, 'brandLoading || brandUnavailable')
        && str_contains($layoutSource, 'Loading workspace branding')
        && !str_contains($layoutSource, 'useGlobalBranding(')
        && !str_contains($layoutSource, 'companySettings')
        && !str_contains($layoutSource, 'document.title'),
    'Authenticated navigation must use the shared resolved branding state without applying metadata itself.'
);

startupBrandingAssert(
    str_contains($loginSource, 'useAppBranding()')
        && str_contains($loginSource, 'brandLoading || brandUnavailable')
        && str_contains($loginSource, 'Loading workspace branding')
        && !str_contains($loginSource, 'fetchSystemDefaults')
        && !str_contains($loginSource, 'fetchCompanySettings')
        && !str_contains($loginSource, 'document.title'),
    'The login screen must share the same neutral-first branding resolution as the authenticated app.'
);

$packageIndex = $root . '/deploy/cpanel-mamepilot-package/public_html/index.html';
if (is_file($packageIndex) && filemtime($packageIndex) >= filemtime($root . '/index.html')) {
    $packageIndexSource = (string) file_get_contents($packageIndex);
    startupBrandingAssert(
        str_contains($packageIndexSource, '<title>Loading...</title>')
            && str_contains($packageIndexSource, 'data:image/svg+xml')
            && !str_contains($packageIndexSource, '<title>Mame Pilot - Management</title>'),
        'The packaged HTML shell must also remain neutral before runtime settings resolve.'
    );
}

echo "Startup branding resolution tests passed.\n";
