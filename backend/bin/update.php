<?php

declare(strict_types=1);

use App\Config;
use App\Database;
use App\MigrationManager;
use App\UpdateManager;

require_once dirname(__DIR__) . '/bootstrap.php';

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$manager = new UpdateManager($config, $database);
$migrationManager = new MigrationManager($config, $database);

$force = in_array('--force', $argv, true);
$checkOnly = in_array('--check', $argv, true) || in_array('-c', $argv, true);
$runningFromCli = PHP_SAPI === 'cli';
$logPath = $config->get('UPDATE_CRON_LOG', dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'mamepilot-update.log');
$lockPath = $config->get('UPDATE_CRON_LOCK', rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'mamepilot-update.lock');

$log = static function (string $message) use ($runningFromCli, $logPath): void {
    if (!$runningFromCli) {
        return;
    }

    $line = '[' . gmdate('c') . '] ' . $message . PHP_EOL;
    @file_put_contents($logPath, $line, FILE_APPEND | LOCK_EX);
};

$lockHandle = null;
if (!$checkOnly) {
    $lockHandle = @fopen($lockPath, 'c');
    if ($lockHandle === false) {
        fwrite(STDERR, 'Could not open update lock file: ' . $lockPath . PHP_EOL);
        exit(1);
    }
    if (!flock($lockHandle, LOCK_EX | LOCK_NB)) {
        $log('Another update process is already running.');
        echo json_encode(['updated' => false, 'message' => 'Another update process is already running.'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
        exit(0);
    }
}

try {
    $log($checkOnly ? 'Update check started.' : 'Update run started.');
    if ($checkOnly) {
        $result = $manager->check();
        $log('Update check completed: local=' . ($result['localVersion'] ?? '') . ', remote=' . ($result['remoteVersion'] ?? '') . ', available=' . (!empty($result['updateAvailable']) ? 'yes' : 'no') . '.');
        echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
        exit(0);
    }

    $result = $manager->update($force);
    $log('Update run completed: updated=' . (!empty($result['updated']) ? 'yes' : 'no') . ', local=' . ($result['localVersion'] ?? '') . ', remote=' . ($result['remoteVersion'] ?? '') . '.');
    echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    exit(0);
} catch (Throwable $exception) {
    $log('Update failed: ' . $exception->getMessage());
    fwrite(STDERR, $exception->getMessage() . PHP_EOL);
    exit(1);
} finally {
    if (is_resource($lockHandle)) {
        flock($lockHandle, LOCK_UN);
        fclose($lockHandle);
    }
}
