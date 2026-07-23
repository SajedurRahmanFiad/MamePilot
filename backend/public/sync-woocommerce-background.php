<?php

declare(strict_types=1);

use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;
use App\OrderPostCreateEffects;
use App\FeatureAccess;
use App\AutoCallApi;
use App\WooCommerceApi;

require_once dirname(__DIR__) . '/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    echo json_encode(['ok' => true]);
    exit;
}

$lockFile = __DIR__ . '/sync-woocommerce-background.lock';
$cooldownSeconds = 240; // 4 minutes — shorter than the 5-minute poll to avoid overlap

if (file_exists($lockFile)) {
    $lastRunTime = filemtime($lockFile);
    $elapsed = time() - $lastRunTime;
    if ($elapsed < $cooldownSeconds) {
        echo json_encode([
            'status' => 'skipped',
            'message' => 'Background sync ran ' . $elapsed . 's ago. Cooldown: ' . $cooldownSeconds . 's.',
            'elapsed' => $elapsed,
            'cooldown' => $cooldownSeconds,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
}

touch($lockFile);

try {
    $config = Config::load(dirname(__DIR__, 2));
    $database = new Database($config);
    $auth = new Auth($config, $database);
    $operations = new OperationsApi($database, $auth, $config);
    $featureAccess = new FeatureAccess($database, $auth);
    $autoCall = new AutoCallApi($database, $auth, $config);
    $postCreateEffects = new OrderPostCreateEffects($featureAccess, $autoCall);
    $woocommerce = new WooCommerceApi($database, $auth, $config, $operations, $postCreateEffects);

    $result = $woocommerce->syncAllStoresBackground(['maxOrders' => 50]);

    echo json_encode([
        'status' => $result['success'] ? 'success' : 'warning',
        ...$result,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $exception) {
    http_response_code(500);
    echo json_encode([
        'status' => 'error',
        'message' => 'WooCommerce background sync failed: ' . $exception->getMessage(),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
