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

$column = $database->fetchOne(
    "SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_capability_settings' AND COLUMN_NAME = 'client_name' LIMIT 1"
);
subscriptionClientNameAssert($column !== null, 'app_capability_settings.client_name is missing from the active database.');

$pdo->beginTransaction();
try {
    $expected = 'Subscription Client ' . str_replace('.', '', uniqid('', true));
    $saved = $master->updateCapabilitySettings(['clientName' => $expected]);
    subscriptionClientNameAssert(($saved['clientName'] ?? '') === $expected, 'Saved capability settings did not return the client name.');

    $reloaded = $master->fetchCapabilitySettings();
    subscriptionClientNameAssert(($reloaded['clientName'] ?? '') === $expected, 'Reloaded capability settings did not preserve the client name.');

    $stored = $database->fetchOne('SELECT client_name FROM app_capability_settings LIMIT 1');
    subscriptionClientNameAssert(($stored['client_name'] ?? '') === $expected, 'The client name was not persisted in app_capability_settings.');

    $page = (string) file_get_contents($root . '/pages/DeveloperSubscriptions.tsx');
    subscriptionClientNameAssert(
        str_contains($page, "setClientName(capabilitySettings.clientName || '')"),
        'Developer Subscriptions does not hydrate the client-name field after reload.'
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

    echo "Developer subscription client-name persistence passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
