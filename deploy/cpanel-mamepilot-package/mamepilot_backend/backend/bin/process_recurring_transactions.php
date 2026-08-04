<?php

declare(strict_types=1);

use App\Auth;
use App\Config;
use App\Database;
use App\FeatureAccess;
use App\RecurringTransactionProcessor;

require_once dirname(__DIR__) . '/bootstrap.php';

ignore_user_abort(true);
set_time_limit(0);

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$auth = new Auth($config, $database);
$processor = new RecurringTransactionProcessor($database, $auth, $config);
$databaseName = trim((string) ($config->get('DB_NAME', 'mamepilot') ?? 'mamepilot'));
$lockName = 'mamepilot_recurring_worker_' . substr(hash('sha256', $databaseName), 0, 32);
$lockAcquired = false;
$runOnce = in_array('--once', $argv ?? [], true);

try {
    $lock = $database->fetchOne('SELECT GET_LOCK(:lock_name, 0) AS acquired', [':lock_name' => $lockName]);
    if ((int) ($lock['acquired'] ?? 0) !== 1) exit(0);
    $lockAcquired = true;

    do {
        $capabilities = (new FeatureAccess($database, $auth))->fetchCapabilities();
        if (empty($capabilities['recurring_transactions']) || !$processor->hasActiveSchedules()) break;

        $processor->heartbeat();
        $result = $processor->processDueBatch(25);
        if ($runOnce) {
            fwrite(STDOUT, json_encode($result, JSON_UNESCAPED_SLASHES) . PHP_EOL);
            break;
        }
        sleep($processor->secondsUntilNextCheck());
    } while (true);

    $database->fetchOne('SELECT RELEASE_LOCK(:lock_name) AS released', [':lock_name' => $lockName]);
    $lockAcquired = false;
} catch (\Throwable $exception) {
    try {
        $processor->heartbeat(mb_substr($exception->getMessage(), 0, 2000));
    } catch (\Throwable $ignored) {
    }
    if ($lockAcquired) {
        try {
            $database->fetchOne('SELECT RELEASE_LOCK(:lock_name) AS released', [':lock_name' => $lockName]);
        } catch (\Throwable $ignored) {
        }
    }
    error_log('Recurring transaction worker failed: ' . $exception->getMessage());
    if ($runOnce) {
        fwrite(STDERR, $exception->getMessage() . PHP_EOL);
    }
    exit(1);
}
