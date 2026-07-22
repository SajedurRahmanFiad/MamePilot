<?php

declare(strict_types=1);

use App\Config;
use App\Database;
use App\MigrationManager;
use App\SchemaManager;
use App\AutoCallScheduler;

require_once dirname(__DIR__) . '/bootstrap.php';

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$schemaManager = new SchemaManager($config, $database);
$dbName = $schemaManager->databaseName();
$fresh = in_array('--fresh', $argv, true) || in_array('--reset', $argv, true);
$noSeed = in_array('--no-seed', $argv, true);
$schemaPath = getOption('--schema');
$seedPath = getOption('--seed');
$skipMigrations = in_array('--skip-migrations', $argv, true);

$schemaManager->provision($fresh, $schemaPath, $seedPath, !$noSeed);

echo 'MariaDB schema applied successfully to ' . $dbName . ($fresh ? ' (fresh reset).' : '.') . "\n";

if (!$skipMigrations) {
    $migrationManager = new MigrationManager($config, $database);
    $migrationResult = $migrationManager->run();
    echo 'Migrations: ' . $migrationResult['message'] . "\n";
}

$autoCallSchedule = (new AutoCallScheduler($config))->ensureInstalled();
echo 'Automatic calling schedule: ' . $autoCallSchedule['message'] . "\n";

function getOption(string $name): ?string
{
    global $argv;

    foreach ($argv as $index => $arg) {
        if ($arg === $name && isset($argv[$index + 1])) {
            return $argv[$index + 1];
        }
        if (str_starts_with($arg, $name . '=')) {
            return substr($arg, strlen($name) + 1);
        }
    }

    return null;
}
