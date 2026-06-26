<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/bootstrap.php';

use App\Config;
use App\Database;
use App\MigrationManager;

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$migrationManager = new MigrationManager($config, $database);

try {
    $pending = $migrationManager->pendingMigrations($config->get('MIGRATION_PATH', dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'migrations'));
    $applied = $migrationManager->appliedMigrations();
    echo json_encode(['applied' => array_keys($applied), 'pending' => array_map(fn($p) => $p['name'], $pending)], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'Failed to list migrations: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
