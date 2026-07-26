<?php

declare(strict_types=1);

function maintenanceLoginAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$backendSource = (string) file_get_contents($root . '/backend/src/MasterDataApi.php');
$loginSource = (string) file_get_contents($root . '/pages/Login.tsx');
$appSource = (string) file_get_contents($root . '/App.tsx');

$loginMethodStart = strpos($backendSource, 'public function loginUser(array $params): array');
$maintenanceMethodStart = strpos($backendSource, 'public function fetchMaintenanceStatus(array $params = []): array');
maintenanceLoginAssert(
    $loginMethodStart !== false && $maintenanceMethodStart !== false && $maintenanceMethodStart > $loginMethodStart,
    'Unable to locate the backend login and maintenance methods.'
);

$loginMethod = substr($backendSource, $loginMethodStart, $maintenanceMethodStart - $loginMethodStart);
maintenanceLoginAssert(
    !str_contains($loginMethod, 'fetchMaintenanceStatus')
        && !str_contains($loginMethod, 'Server under maintenance'),
    'Maintenance mode must not reject otherwise valid login credentials.'
);
maintenanceLoginAssert(
    !str_contains($loginSource, 'useMaintenanceStatus')
        && !str_contains($loginSource, 'Server under maintenance'),
    'The login page must remain available without showing a maintenance error.'
);
maintenanceLoginAssert(
    str_contains($appSource, 'maintenanceEnabled && !isDeveloper && !isLoginRoute && !isMaintenanceRoute')
        && str_contains($appSource, '<Navigate to="/maintenance" replace />'),
    'Authenticated non-developers must still be redirected to the maintenance page.'
);

$packageRoot = $root . '/deploy/cpanel-mamepilot-package';
$packagedBackendPath = $packageRoot . '/mamepilot_backend/backend/src/MasterDataApi.php';
if (is_file($packagedBackendPath)) {
    maintenanceLoginAssert(
        hash('sha256', $backendSource) === hash_file('sha256', $packagedBackendPath),
        'The packaged backend does not include the maintenance login behavior.'
    );
}

$packagedLoginFiles = glob($packageRoot . '/public_html/assets/Login-*.js') ?: [];
if ($packagedLoginFiles !== []) {
    maintenanceLoginAssert(
        count($packagedLoginFiles) === 1
            && !str_contains((string) file_get_contents($packagedLoginFiles[0]), 'Server under maintenance'),
        'The packaged login page still displays a maintenance error.'
    );
}

echo "Maintenance login behavior tests passed.\n";
