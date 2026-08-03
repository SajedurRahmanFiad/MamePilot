<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\MasterDataApi;

function subCapabilityAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$config = Config::load($root);
$database = new Database($config);
$auth = new Auth($config, $database);
$master = new MasterDataApi($database, $auth, $config);
$pdo = $database->connect();

$developer = $database->fetchOne(
    "SELECT id, name, phone, role FROM users WHERE role = 'Developer' AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1"
);
if ($developer === null) {
    throw new RuntimeException('Local Developer test actor is unavailable.');
}
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($developer);

$pdo->beginTransaction();
try {
    $current = $master->fetchCapabilitySettings();
    $capabilities = $current['capabilities'];
    $capabilities['human_resources'] = true;
    $capabilities['banking'] = true;
    $capabilities['courier_automation'] = true;
    $capabilities['recycle_bin_undoer'] = true;

    $expected = [
        'hr_management' => true,
        'payroll' => false,
        'accounts' => true,
        'transactions' => false,
        'transfer' => true,
        'steadfast_courier' => true,
        'carrybee_courier' => false,
        'paperfly_courier' => false,
        'pathao_courier' => true,
        'recycle_bin' => true,
        'undoer' => false,
    ];

    $saved = $master->updateCapabilitySettings([
        'capabilities' => $capabilities,
        'subCapabilities' => $expected,
    ]);
    subCapabilityAssert(($saved['subCapabilities'] ?? null) === $expected, 'Saved settings did not return the selected sub-capabilities.');
    subCapabilityAssert(($saved['capabilities']['subCapabilities'] ?? null) === $expected, 'Saved capabilities did not retain the nested runtime map.');

    $reloaded = $master->fetchCapabilitySettings();
    subCapabilityAssert(($reloaded['subCapabilities'] ?? null) === $expected, 'Reloaded settings reset the selected sub-capabilities.');

    $row = $database->fetchOne('SELECT capabilities FROM app_capability_settings LIMIT 1');
    $stored = json_decode((string) ($row['capabilities'] ?? ''), true);
    subCapabilityAssert(is_array($stored), 'Stored capability JSON is invalid.');
    subCapabilityAssert(($stored['subCapabilities'] ?? null) === $expected, 'The selected sub-capabilities were not persisted locally.');

    $developerPage = (string) file_get_contents($root . '/pages/DeveloperSubscriptions.tsx');
    subCapabilityAssert(
        str_contains($developerPage, 'subCapabilities: overrideSubCapabilities'),
        'Developer Subscriptions does not send the sub-capability override explicitly.'
    );

    $settingsPage = (string) file_get_contents($root . '/pages/Settings.tsx');
    $ordersPage = (string) file_get_contents($root . '/pages/Orders.tsx');
    $orderDetailsPage = (string) file_get_contents($root . '/pages/OrderDetails.tsx');
    subCapabilityAssert(
        str_contains($settingsPage, "if (canUseSteadfast) enabledCourierSettings.steadfast")
            && str_contains($settingsPage, "{canUsePathao && ("),
        'Courier Settings does not limit its save payload and panels to enabled providers.'
    );
    subCapabilityAssert(
        str_contains($ordersPage, "canUseCourierAutomation\n      && canAccessRecord")
            && str_contains($ordersPage, "canUseCarryBee && isCourierConfigured('carrybee')"),
        'The Orders courier picker does not enforce the parent and provider capabilities.'
    );
    subCapabilityAssert(
        str_contains($orderDetailsPage, "canUsePaperfly && isCourierConfigured('paperfly')"),
        'Order Details does not hide disabled courier providers.'
    );

    $appRouter = (string) file_get_contents($root . '/App.tsx');
    subCapabilityAssert(
        str_contains($appRouter, "can('accounts.view') && hasSubCapability('accounts')")
            && str_contains($appRouter, "can('transactions.view') && hasSubCapability('transactions')")
            && str_contains($appRouter, "can('transfers.create') && hasSubCapability('transfer')")
            && str_contains($appRouter, "can('recycleBin.view') && hasSubCapability('recycle_bin')")
            && str_contains($appRouter, "can('undoer.view') && hasSubCapability('undoer')"),
        'Direct routes do not enforce all grouped sub-capabilities.'
    );
    subCapabilityAssert(
        str_contains($settingsPage, 'useWalletSettings({ enabled: canUsePayroll })')
            && str_contains($settingsPage, 'useAccounts({ enabled: canUseAccounts })'),
        'Settings still loads disabled grouped-feature APIs.'
    );

    $backend = (string) file_get_contents($root . '/backend/src/MasterDataApi.php');
    subCapabilityAssert(
        str_contains($backend, "'sub_capabilities' => \$subCapabilities")
            && str_contains($backend, "\$payload['sub_capabilities'] ?? \$payload['subCapabilities']"),
        'The deployment backend does not round-trip central sub-capability overrides.'
    );

    $centralApi = (string) file_get_contents($root . '/deploy/Central Server/api.php');
    $centralSchema = (string) file_get_contents($root . '/deploy/Central Server/central-db.sql');
    subCapabilityAssert(
        str_contains($centralApi, 'sub_capability_overrides = :sub_capability_overrides')
            && str_contains($centralApi, "'sub_capabilities' => \$overrideEnabled ? \$subCapabilityOverrides : []"),
        'The central license API does not persist and resolve sub-capability overrides.'
    );
    subCapabilityAssert(
        str_contains($centralSchema, 'ADD COLUMN IF NOT EXISTS sub_capability_overrides LONGTEXT NULL'),
        'The central database upgrade is missing sub-capability storage.'
    );

    echo "Developer subscription sub-capability persistence checks passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
