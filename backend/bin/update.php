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

try {
    if ($checkOnly) {
        echo json_encode($manager->check(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
        exit(0);
    }

    $result = $manager->update($force);
    echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, $exception->getMessage() . PHP_EOL);
    exit(1);
}
