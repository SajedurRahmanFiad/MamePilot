<?php

declare(strict_types=1);

use App\Config;
use App\Database;
use App\GitUpdateDispatcher;
use App\Http;
use App\UpdateManager;

require_once __DIR__ . DIRECTORY_SEPARATOR . 'app-root.php';

$appRoot = mamepilotResolveAppRoot();

$bootstrapPath = $appRoot . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'bootstrap.php';
if (!is_file($bootstrapPath)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => 'Backend bootstrap not found.',
        'expected' => $bootstrapPath,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
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

    if ($action === 'dispatch') {
        $dispatcher = new GitUpdateDispatcher($config);
        Http::ok($dispatcher->dispatch());
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
