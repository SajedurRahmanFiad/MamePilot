<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\MasterDataApi;

function subscriptionClientNameAssert(bool $condition, string $message): void
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

$masterReflection = new ReflectionClass($master);
$ensureColumns = $masterReflection->getMethod('ensureCapabilitySettingsRuntimeColumns');
$ensureColumns->invoke($master);

$columns = $database->fetchAll(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'app_capability_settings'
       AND COLUMN_NAME IN ('client_name', 'tier_key', 'show_inactive_subscription_features')"
);
$columnNames = array_column($columns, 'COLUMN_NAME');
subscriptionClientNameAssert(in_array('client_name', $columnNames, true), 'app_capability_settings.client_name is missing from the active database.');
subscriptionClientNameAssert(in_array('tier_key', $columnNames, true), 'app_capability_settings.tier_key is missing from the active database.');
subscriptionClientNameAssert(in_array('show_inactive_subscription_features', $columnNames, true), 'The subscription feature-visibility column is missing from the active database.');

$pdo->beginTransaction();
try {
    $expected = 'Subscription Client ' . str_replace('.', '', uniqid('', true));
    $expectedTierKey = 'test-tier-' . strtolower(bin2hex(random_bytes(4)));
    $saved = $master->updateCapabilitySettings([
        'clientName' => $expected,
        'tierKey' => $expectedTierKey,
        'showInactiveSubscriptionFeatures' => false,
    ]);
    subscriptionClientNameAssert(($saved['clientName'] ?? '') === $expected, 'Saved capability settings did not return the client name.');
    subscriptionClientNameAssert(($saved['tierKey'] ?? '') === $expectedTierKey, 'Saved capability settings did not return the selected tier key.');
    subscriptionClientNameAssert(($saved['showInactiveSubscriptionFeatures'] ?? true) === false, 'Saved capability settings did not return the feature-visibility preference.');

    $reloaded = $master->fetchCapabilitySettings();
    subscriptionClientNameAssert(($reloaded['clientName'] ?? '') === $expected, 'Reloaded capability settings did not preserve the client name.');
    subscriptionClientNameAssert(($reloaded['tierKey'] ?? '') === $expectedTierKey, 'Reloaded capability settings did not preserve the selected tier key.');
    subscriptionClientNameAssert(($reloaded['showInactiveSubscriptionFeatures'] ?? true) === false, 'Reloaded capability settings did not preserve the feature-visibility preference.');

    $stored = $database->fetchOne('SELECT client_name, tier_key, show_inactive_subscription_features FROM app_capability_settings LIMIT 1');
    subscriptionClientNameAssert(($stored['client_name'] ?? '') === $expected, 'The client name was not persisted in app_capability_settings.');
    subscriptionClientNameAssert(($stored['tier_key'] ?? '') === $expectedTierKey, 'The selected tier key was not persisted in app_capability_settings.');
    subscriptionClientNameAssert((int) ($stored['show_inactive_subscription_features'] ?? 1) === 0, 'The feature-visibility preference was not persisted in app_capability_settings.');

    $page = (string) file_get_contents($root . '/pages/DeveloperSubscriptions.tsx');
    subscriptionClientNameAssert(
        str_contains($page, "setClientName(capabilitySettings.clientName || '')"),
        'Developer Subscriptions does not hydrate the client-name field after reload.'
    );
    subscriptionClientNameAssert(
        str_contains($page, 'tier.tierName.trim().toLowerCase() === normalizedPlanName')
            && str_contains($page, 'showInactiveSubscriptionFeatures'),
        'Developer Subscriptions does not recover the selected tier or expose the feature-visibility control.'
    );

    $adminPage = (string) file_get_contents($root . '/pages/AdminSubscriptions.tsx');
    subscriptionClientNameAssert(
        str_contains($adminPage, 'capabilitySettings?.showInactiveSubscriptionFeatures !== false && inactiveKeys.length > 0'),
        'The customer Subscriptions page does not honor the feature-visibility preference.'
    );

    $migration = (string) file_get_contents($root . '/migrations/2026-07-26_subscription_feature_visibility.sql');
    subscriptionClientNameAssert(
        str_contains($migration, 'ADD COLUMN IF NOT EXISTS `tier_key`')
            && str_contains($migration, 'ADD COLUMN IF NOT EXISTS `show_inactive_subscription_features`'),
        'The additive subscription compatibility migration is incomplete.'
    );

    $masterSource = (string) file_get_contents($root . '/backend/src/MasterDataApi.php');
    subscriptionClientNameAssert(
        str_contains($masterSource, "'clientName' => \$payload['client_name'] ?? \$payload['clientName'] ?? \$existingRow['client_name'] ?? null"),
        'Resolved central license responses do not persist client_name locally.'
    );
    subscriptionClientNameAssert(
        str_contains($masterSource, "'resolve_license'") && str_contains($masterSource, "['client_name' => \$remoteClientName]"),
        'Existing central client names are not backfilled into an empty local setting.'
    );

    echo "Developer subscription persistence and display controls passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
