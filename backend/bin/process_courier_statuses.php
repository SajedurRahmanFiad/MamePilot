<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/bootstrap.php';

use App\Auth;
use App\Config;
use App\CourierApi;
use App\Database;
use App\OperationsApi;

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$auth = new Auth($config, $database);
$operations = new OperationsApi($database, $auth, $config);
$courier = new CourierApi($database, $auth, $config, $operations);
$databaseName = trim((string) ($config->get('DB_NAME', 'mamepilot') ?? 'mamepilot'));
$lockName = 'mamepilot_courier_poll_' . substr(hash('sha256', $databaseName), 0, 32);
$lockAcquired = false;

try {
    $database->execute("CREATE TABLE IF NOT EXISTS courier_poll_worker_state (
        provider VARCHAR(32) NOT NULL,
        row_offset INT UNSIGNED NOT NULL DEFAULT 0,
        last_run_at DATETIME NULL,
        last_success_at DATETIME NULL,
        last_error_at DATETIME NULL,
        last_error TEXT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (provider)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    $lock = $database->fetchOne('SELECT GET_LOCK(:lock_name, 0) AS acquired', [':lock_name' => $lockName]);
    if ((int) ($lock['acquired'] ?? 0) !== 1) exit(0);
    $lockAcquired = true;

    $providers = ['carrybee', 'paperfly', 'steadfast', 'pathao', 'exchange'];
    $slot = intdiv(time(), 300) + abs((int) crc32($databaseName));
    $provider = $providers[$slot % count($providers)];
    $limit = $provider === 'exchange' ? 2 : 10;
    $state = $database->fetchOne('SELECT row_offset FROM courier_poll_worker_state WHERE provider = :provider LIMIT 1', [':provider' => $provider]);
    $offset = max(0, (int) ($state['row_offset'] ?? 0));
    $params = ['limit' => $limit, 'offset' => $offset, 'timeoutSeconds' => 8];
    $webhookReconciliation = $provider === 'exchange'
        ? ['checked' => 0, 'matched' => 0, 'updated' => 0, 'failed' => 0]
        : $courier->reconcileUnmatchedWebhookEvents(['provider' => $provider, 'limit' => 3]);

    $result = match ($provider) {
        'carrybee' => $courier->syncCarryBeeTransferStatuses($params),
        'paperfly' => $courier->syncPaperflyOrderStatuses($params),
        'steadfast' => $courier->syncSteadfastDeliveryStatuses($params),
        'pathao' => $courier->syncPathaoDeliveryStatuses($params),
        'exchange' => $courier->syncExchangeConsignmentStatuses($params),
    };
    if (!empty($result['error'])) throw new RuntimeException((string) $result['error']);
    $checked = max(0, (int) ($result['checked'] ?? 0));
    $failed = isset($result['errors']) && is_array($result['errors'])
        ? count($result['errors'])
        : max(0, (int) ($result['failed'] ?? 0));
    if ($checked > 0 && $failed >= $checked) throw new RuntimeException('Every courier API confirmation in this batch failed.');
    $nextOffset = $checked >= $limit ? $offset + $limit : 0;
    $now = $database->nowUtc();
    $database->execute(
        "INSERT INTO courier_poll_worker_state (provider, row_offset, last_run_at, last_success_at, last_error_at, last_error, updated_at)
         VALUES (:provider, :row_offset, :now, :now, NULL, NULL, :now)
         ON DUPLICATE KEY UPDATE row_offset = VALUES(row_offset), last_run_at = VALUES(last_run_at),
             last_success_at = VALUES(last_success_at), last_error_at = NULL, last_error = NULL, updated_at = VALUES(updated_at)",
        [':provider' => $provider, ':row_offset' => $nextOffset, ':now' => $now]
    );
    if (php_sapi_name() === 'cli') echo json_encode(['provider' => $provider, 'offset' => $offset, 'nextOffset' => $nextOffset, 'webhookReconciliation' => $webhookReconciliation] + $result) . "\n";
} catch (\Throwable $exception) {
    $now = $database->nowUtc();
    if (isset($provider)) {
        try {
            $database->execute(
                "INSERT INTO courier_poll_worker_state (provider, row_offset, last_run_at, last_error_at, last_error, updated_at)
                 VALUES (:provider, :row_offset, :now, :now, :error, :now)
                 ON DUPLICATE KEY UPDATE last_run_at = VALUES(last_run_at), last_error_at = VALUES(last_error_at),
                     last_error = VALUES(last_error), updated_at = VALUES(updated_at)",
                [':provider' => $provider, ':row_offset' => $offset ?? 0, ':now' => $now, ':error' => mb_substr($exception->getMessage(), 0, 1000)]
            );
        } catch (\Throwable $ignored) {
        }
    }
    error_log('Courier status confirmation worker failed: ' . $exception->getMessage());
    if (php_sapi_name() === 'cli') {
        echo 'Error: ' . $exception->getMessage() . "\n";
        exit(1);
    }
} finally {
    if ($lockAcquired) {
        try { $database->fetchOne('SELECT RELEASE_LOCK(:lock_name) AS released', [':lock_name' => $lockName]); } catch (\Throwable $ignored) {}
    }
}
