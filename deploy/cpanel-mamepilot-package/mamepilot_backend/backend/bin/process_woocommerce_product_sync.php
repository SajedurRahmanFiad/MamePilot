<?php

declare(strict_types=1);

ignore_user_abort(true);
set_time_limit(0);

require_once dirname(__DIR__) . '/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\FeatureAccess;
use App\OperationsApi;
use App\ServiceLifecycle;
use App\WooCommerceApi;
use App\WooCommerceProductSyncScheduler;

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$lockAcquired = false;
$databaseName = trim((string) ($config->get('DB_NAME', 'mamepilot') ?? 'mamepilot'));
$lockName = 'mamepilot_woo_product_sync_' . substr(hash('sha256', $databaseName), 0, 24);

try {
    $lock = $database->fetchOne('SELECT GET_LOCK(:lock_name, 0) AS acquired', [':lock_name' => $lockName]);
    if ((int) ($lock['acquired'] ?? 0) !== 1) exit(0);
    $lockAcquired = true;

    $baseAuth = new Auth($config, $database);
    $adminUsers = $database->fetchAll(
        "SELECT id FROM users WHERE deleted_at IS NULL AND role IN ('Admin', 'Developer') ORDER BY created_at ASC"
    );
    $adminAuth = null;
    foreach ($adminUsers as $adminUser) {
        try {
            $adminAuth = $baseAuth->forUserId((string) ($adminUser['id'] ?? ''));
            break;
        } catch (\Throwable $exception) {
            continue;
        }
    }
    if (!$adminAuth instanceof Auth) {
        throw new RuntimeException('No active administrator is available for the scheduled WooCommerce product sync.');
    }

    $featureAccess = new FeatureAccess($database, $adminAuth);
    $featureAccess->assertActionAllowed('syncWooCommerceProducts');
    $lifecycle = new ServiceLifecycle($database, $config);
    $lifecycle->assertActionAllowed('syncWooCommerceProducts');

    $cutoff = gmdate('Y-m-d H:i:s', time() - WooCommerceProductSyncScheduler::SYNC_INTERVAL_SECONDS);
    $stores = $database->fetchAll(
        'SELECT id FROM woocommerce_stores
         WHERE enabled = 1 AND (last_products_synced_at IS NULL OR last_products_synced_at <= :cutoff)
         ORDER BY last_products_synced_at ASC, created_at ASC',
        [':cutoff' => $cutoff]
    );
    $woocommerce = new WooCommerceApi(
        $database,
        $adminAuth,
        $config,
        new OperationsApi($database, $adminAuth, $config)
    );

    foreach ($stores as $store) {
        $storeId = trim((string) ($store['id'] ?? ''));
        if ($storeId === '') continue;

        try {
            $featureAccess->assertActionAllowed('syncWooCommerceProducts', ['id' => $storeId]);
            $lifecycle->assertActionAllowed('syncWooCommerceProducts');
            $result = $woocommerce->syncWooCommerceProducts(['id' => $storeId]);
            echo (string) ($result['message'] ?? ('WooCommerce product sync finished for store ' . $storeId)) . PHP_EOL;
        } catch (\Throwable $exception) {
            error_log('Scheduled WooCommerce product sync failed for store ' . $storeId . ': ' . $exception->getMessage());
        }
    }
} catch (\Throwable $exception) {
    error_log('WooCommerce product-sync worker failed: ' . $exception->getMessage());
    if (PHP_SAPI === 'cli') {
        fwrite(STDERR, $exception->getMessage() . PHP_EOL);
        exit(1);
    }
} finally {
    if ($lockAcquired) {
        try {
            $database->fetchOne('SELECT RELEASE_LOCK(:lock_name) AS released', [':lock_name' => $lockName]);
        } catch (\Throwable $ignored) {
        }
    }
}