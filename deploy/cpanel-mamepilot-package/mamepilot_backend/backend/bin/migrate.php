<?php

declare(strict_types=1);

use App\Config;
use App\Database;
use App\MigrationManager;

require_once dirname(__DIR__) . '/bootstrap.php';

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$manager = new MigrationManager($config, $database);

$dryRun = in_array('--dry-run', $argv, true);
$migrationPath = null;
foreach ($argv as $index => $arg) {
    if ($arg === '--path' && isset($argv[$index + 1])) {
        $migrationPath = $argv[$index + 1];
    }
}

try {
    $result = $manager->run($migrationPath, $dryRun);
    echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, $exception->getMessage() . PHP_EOL);
    exit(1);
}
