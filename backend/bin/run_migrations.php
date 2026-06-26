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
    $result = $migrationManager->run(null, false);
    echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'Migration failed: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}
