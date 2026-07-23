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

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$auth = new Auth($config, $database);
$operations = new OperationsApi($database, $auth, $config);
$featureAccess = new FeatureAccess($database, $auth);
$autoCall = new AutoCallApi($database, $auth, $config);
$postCreateEffects = new OrderPostCreateEffects($featureAccess, $autoCall);
$woocommerce = new WooCommerceApi($database, $auth, $config, $operations, $postCreateEffects);

$maxOrders = 50;
foreach ($argv ?? [] as $arg) {
    if (str_starts_with($arg, '--max-orders=')) {
        $maxOrders = max(1, min(100, (int) substr($arg, 13)));
    }
}

try {
    $result = $woocommerce->syncAllStoresBackground(['maxOrders' => $maxOrders]);
    echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    exit($result['success'] ? 0 : 1);
} catch (Throwable $exception) {
    fwrite(STDERR, 'WooCommerce background sync error: ' . $exception->getMessage() . PHP_EOL);
    exit(1);
}
