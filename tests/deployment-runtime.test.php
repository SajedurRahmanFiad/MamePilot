<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\UpdateScheduler;
use App\UpdateManager;

function assertDeploymentRuntime(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$setupSource = (string) file_get_contents($root . '/backend/bin/setup.php');
$updateManagerSource = (string) file_get_contents($root . '/backend/src/UpdateManager.php');
$legacyTriggerSource = (string) file_get_contents($root . '/deploy/cpanel-template/public_html/api/trigger_update.php');
$packageScriptSource = (string) file_get_contents($root . '/scripts/prepare-cpanel-deploy.ps1');
$updateWrapperSource = (string) file_get_contents($root . '/deploy/cpanel-template/public_html/api/update.php');
$appSource = (string) file_get_contents($root . '/App.tsx');
$gitDispatcherHookSource = (string) file_get_contents($root . '/src/hooks/useGitUpdateDispatcher.ts');
$backendRouterSource = (string) file_get_contents($root . '/backend/public/index.php');
$packageRouterSource = (string) file_get_contents($root . '/deploy/cpanel-template/public_html/api/index.php');
$appRootResolverPath = $root . '/deploy/cpanel-template/public_html/api/app-root.php';
$appRootResolverSource = (string) file_get_contents($appRootResolverPath);
$publicEnvExamplePath = $root . '/deploy/cpanel-template/public_html/.env.example';
$publicEnvExampleSource = (string) file_get_contents($publicEnvExamplePath);
$publicHtaccessSource = (string) file_get_contents($root . '/deploy/cpanel-template/public_html/.htaccess');

require_once $appRootResolverPath;

putenv('MAMEPILOT_APP_ROOT');
putenv('BDHATBELA_APP_ROOT');
putenv('MAMEPILOT_BACKEND_FOLDER');
assertDeploymentRuntime(
    basename(mamepilotResolveAppRoot()) === 'mamepilot_backend',
    'The public API resolver must default the backend folder to mamepilot_backend.'
);
assertDeploymentRuntime(
    basename(mamepilotResolveAppRoot($root . '/tests/fixtures/public-backend-folder.env')) === 'customer_backend',
    'The public API resolver must read the deployment-specific public_html/.env file.'
);
putenv('MAMEPILOT_BACKEND_FOLDER=customer_backend');
assertDeploymentRuntime(
    basename(mamepilotResolveAppRoot()) === 'customer_backend',
    'The public API resolver must honor a configured backend folder name.'
);
putenv('MAMEPILOT_BACKEND_FOLDER=../unsafe');
assertDeploymentRuntime(
    basename(mamepilotResolveAppRoot()) === 'mamepilot_backend',
    'The public API resolver must reject paths and retain the safe default.'
);
putenv('MAMEPILOT_BACKEND_FOLDER');

assertDeploymentRuntime(
    str_contains($publicEnvExampleSource, 'MAMEPILOT_BACKEND_FOLDER=mamepilot_backend')
        && str_contains($packageScriptSource, "public_html\\.env.example")
        && str_contains($appRootResolverSource, "getenv('MAMEPILOT_BACKEND_FOLDER')")
        && str_contains($appRootResolverSource, "DIRECTORY_SEPARATOR . '.env'")
        && str_contains($publicHtaccessSource, '<FilesMatch "^\\.">')
        && str_contains($updateManagerSource, "['.env', '.env.local']"),
    'The public backend locator must be packaged, protected, and preserved during updates.'
);

assertDeploymentRuntime(
    str_contains($setupSource, 'new UpdateScheduler')
        && str_contains($updateManagerSource, "'automaticUpdateSchedule'")
        && str_contains($updateManagerSource, 'new UpdateScheduler'),
    'Fresh setup and normal update runs must install or repair the automatic update schedule.'
);

assertDeploymentRuntime(
    UpdateManager::normalizeReleaseFolderName(
        '/home/example/domains/example.com/public_html/admin',
        'public_html'
    ) === 'public_html',
    'Legacy absolute document-root paths must resolve to the release package document-root folder.'
);
assertDeploymentRuntime(
    UpdateManager::normalizeReleaseFolderName(
        '/home/example/domains/example.com/public_html/mamepilot_backend',
        'mamepilot_backend'
    ) === 'mamepilot_backend',
    'Legacy absolute backend paths must resolve to the release package backend folder.'
);
assertDeploymentRuntime(
    UpdateManager::normalizeReleaseFolderName('custom_backend', 'mamepilot_backend') === 'custom_backend',
    'Valid custom release folder names must be preserved.'
);

$mergedCrontab = UpdateScheduler::mergeCrontab(
    "15 * * * * php /home/example/another-task.php\n"
        . "*/30 * * * * php /old/backend/bin/update.php # mamepilot-automatic-update\n"
        . "*/20 * * * * php /home/another-site/backend/bin/update.php # mamepilot-automatic-update:aabbccddeeff\n",
    "*/15 * * * * '/usr/local/bin/php' '/old/backend/bin/update.php' >> '/home/example/mamepilot-update.log' 2>&1 # mamepilot-automatic-update:112233445566"
);
assertDeploymentRuntime(substr_count($mergedCrontab, '# mamepilot-automatic-update:112233445566') === 1, 'Update schedule repair must not create duplicate entries.');
assertDeploymentRuntime(str_contains($mergedCrontab, 'another-task.php'), 'Update schedule repair must preserve unrelated entries.');
assertDeploymentRuntime(str_contains($mergedCrontab, '/home/another-site/backend/bin/update.php'), 'Update schedule repair must preserve other MamePilot deployments.');

$gitCrontab = UpdateScheduler::removeManagedEntry(
    $mergedCrontab,
    "*/15 * * * * '/usr/local/bin/php' '/old/backend/bin/update.php' >> '/home/example/mamepilot-update.log' 2>&1 # mamepilot-automatic-update:112233445566"
);
assertDeploymentRuntime(!str_contains($gitCrontab, '# mamepilot-automatic-update:112233445566'), 'Git mode must remove this deployment\'s managed updater cron.');
assertDeploymentRuntime(str_contains($gitCrontab, 'another-task.php'), 'Git cron removal must preserve unrelated cron jobs.');
assertDeploymentRuntime(str_contains($gitCrontab, '/home/another-site/backend/bin/update.php'), 'Git cron removal must preserve other MamePilot deployments.');

assertDeploymentRuntime(
    str_contains($legacyTriggerSource, 'http_response_code(410)')
        && !str_contains($legacyTriggerSource, 'exec(')
        && !str_contains($legacyTriggerSource, 'Access-Control-Allow-Origin'),
    'The legacy unauthenticated update trigger must remain disabled.'
);
assertDeploymentRuntime(
    is_file($root . '/src/hooks/useGitUpdateDispatcher.ts')
        && str_contains($appSource, 'useGitUpdateDispatcher')
        && str_contains($gitDispatcherHookSource, "triggerGitUpdate")
        && str_contains($gitDispatcherHookSource, "response.status === 'cron_only'")
        && str_contains($backendRouterSource, "\$auth->requireUser()")
        && str_contains($backendRouterSource, "\$action === 'triggerGitUpdate'")
        && str_contains($packageRouterSource, "\$action === 'triggerGitUpdate'"),
    'Authenticated browser sessions must dispatch only Git updates through both normal API routers.'
);
assertDeploymentRuntime(
    str_contains($packageScriptSource, "public_html\\api\\trigger_update.php")
        && str_contains($packageScriptSource, "public_html\\api\\app-root.php"),
    'Release packages must overwrite unsafe legacy trigger files with the tombstone.'
);
$bootstrapErrorPosition = strpos($updateWrapperSource, 'http_response_code(500)');
$bootstrapRequirePosition = strpos($updateWrapperSource, 'require_once $bootstrapPath');
assertDeploymentRuntime(
    $bootstrapErrorPosition !== false
        && $bootstrapRequirePosition !== false
        && $bootstrapErrorPosition < $bootstrapRequirePosition,
    'The update wrapper must report missing bootstrap files without calling unloaded application classes.'
);

echo "Deployment runtime tests passed.\n";
