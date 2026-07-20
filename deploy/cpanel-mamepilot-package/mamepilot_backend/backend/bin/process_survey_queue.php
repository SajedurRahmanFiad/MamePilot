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

try {
    $lock = $database->fetchOne("SELECT GET_LOCK('mamepilot_auto_call_queue', 0) AS acquired");
    if ((int) ($lock['acquired'] ?? 0) !== 1) {
        if (php_sapi_name() === 'cli') {
            echo json_encode(['processed' => 0, 'message' => 'Another survey worker is active.']) . "\n";
        }
        exit(0);
    }

    $startedAt = time();
    $processed = 0;
    $runOnce = in_array('--once', $argv ?? [], true);
    do {
        $result = $autoCall->processSurveyQueue();
        $processed += (int) ($result['processed'] ?? 0);
        if ($runOnce || (time() - $startedAt) >= 600) {
            break;
        }
        sleep(60);
    } while (true);

    $database->fetchOne("SELECT RELEASE_LOCK('mamepilot_auto_call_queue') AS released");

    if (php_sapi_name() === 'cli') {
        echo json_encode(['processed' => $processed]) . "\n";
    }
} catch (\Throwable $e) {
    try {
        $database->fetchOne("SELECT RELEASE_LOCK('mamepilot_auto_call_queue') AS released");
    } catch (\Throwable $ignored) {
    }
    if (php_sapi_name() === 'cli') {
        echo "Error: " . $e->getMessage() . "\n";
        exit(1);
    }
}
