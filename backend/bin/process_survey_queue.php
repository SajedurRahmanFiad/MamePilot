<?php

declare(strict_types=1);

/**
 * Background Survey Queue Processor
 *
 * Processes pending voice survey calls and due retries.
 * Designed to be triggered via register_shutdown_function from order creation,
 * or run as a CLI cron job.
 *
 * Usage:
 *   php backend/bin/process_survey_queue.php
 */

require_once dirname(__DIR__) . '/bootstrap.php';

use App\Config;
use App\Database;
use App\Auth;
use App\AutoCallApi;

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$auth = new Auth($config, $database);
$autoCall = new AutoCallApi($database, $auth, $config);
$databaseName = trim((string) ($config->get('DB_NAME', 'mamepilot') ?? 'mamepilot'));
$lockName = 'mamepilot_auto_call_' . substr(hash('sha256', $databaseName), 0, 32);
$lockAcquired = false;

try {
    $lock = $database->fetchOne('SELECT GET_LOCK(:lock_name, 0) AS acquired', [':lock_name' => $lockName]);
    if ((int) ($lock['acquired'] ?? 0) !== 1) {
        if (php_sapi_name() === 'cli') {
            echo json_encode(['processed' => 0, 'message' => 'Another survey worker is active.']) . "\n";
        }
        exit(0);
    }
    $lockAcquired = true;

    $startedAt = time();
    $processed = 0;
    $runOnce = in_array('--once', $argv ?? [], true);
    $watchSeconds = 600;
    foreach ($argv ?? [] as $argument) {
        if (preg_match('/^--watch-seconds=(\d+)$/', (string) $argument, $matches) === 1) {
            $watchSeconds = max(60, min(86400, (int) $matches[1]));
            break;
        }
    }
    do {
        $result = $autoCall->processSurveyQueue();
        $processed += (int) ($result['processed'] ?? 0);
        if ($runOnce || (time() - $startedAt) >= $watchSeconds) {
            break;
        }
        sleep(60);
    } while (true);

    $database->fetchOne('SELECT RELEASE_LOCK(:lock_name) AS released', [':lock_name' => $lockName]);
    $lockAcquired = false;

    if (php_sapi_name() === 'cli') {
        echo json_encode(['processed' => $processed]) . "\n";
    }
} catch (\Throwable $e) {
    if ($lockAcquired) {
        try {
            $database->fetchOne('SELECT RELEASE_LOCK(:lock_name) AS released', [':lock_name' => $lockName]);
        } catch (\Throwable $ignored) {
        }
    }
    error_log('Automatic calling worker failed: ' . $e->getMessage());
    if (php_sapi_name() === 'cli') {
        echo "Error: " . $e->getMessage() . "\n";
        exit(1);
    }
}
