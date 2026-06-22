<?php

declare(strict_types=1);

use App\Config;
use App\Database;
use App\Http;
use App\UpdateManager;

$configuredRoot = getenv('MAMEPILOT_APP_ROOT') ?: getenv('BDHATBELA_APP_ROOT');
$appRoot = is_string($configuredRoot) && trim($configuredRoot) !== ''
    ? rtrim($configuredRoot, DIRECTORY_SEPARATOR)
    : dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'mamepilot_backend';

$bootstrapPath = $appRoot . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'bootstrap.php';
if (!is_file($bootstrapPath)) {
    Http::error(500, 'Backend bootstrap not found.', ['expected' => $bootstrapPath]);
    exit;
}

require_once $bootstrapPath;

if (Http::method() === 'OPTIONS') {
    Http::ok(['ok' => true]);
    exit;
}

$config = Config::load($appRoot);
$expectedSecret = $config->get('UPDATE_CRON_SECRET');
$providedSecret = $_GET['secret'] ?? $_POST['secret'] ?? '';
if ($expectedSecret === null || trim($expectedSecret) === '' || !hash_equals(trim($expectedSecret), (string) $providedSecret)) {
    Http::error(403, 'Update endpoint disabled or secret mismatch.');
    exit;
}

try {
    $database = new Database($config);
    $manager = new UpdateManager($config, $database);
    $action = trim((string) ($_GET['action'] ?? $_POST['action'] ?? 'update'));

    if ($action === 'check') {
        Http::ok($manager->check());
        exit;
    }

    if ($action !== 'update') {
        Http::error(400, 'Unsupported update action.');
        exit;
    }

    $force = in_array(strtolower((string) ($_GET['force'] ?? $_POST['force'] ?? '')), ['1', 'true', 'yes'], true);
    Http::ok($manager->update($force));
} catch (Throwable $exception) {
    Http::error(500, $exception->getMessage());
}
