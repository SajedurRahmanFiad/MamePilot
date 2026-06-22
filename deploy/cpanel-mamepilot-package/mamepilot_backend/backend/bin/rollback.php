<?php

declare(strict_types=1);

use App\Config;
use App\RollbackManager;

require_once dirname(__DIR__) . '/bootstrap.php';

$config = Config::load(dirname(__DIR__, 2));
$manager = new RollbackManager($config);
$backupRoot = null;

foreach ($argv as $index => $arg) {
    if ($arg === '--backup' && isset($argv[$index + 1])) {
        $backupRoot = $argv[$index + 1];
    }
}

try {
    echo json_encode($manager->rollback($backupRoot), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, $exception->getMessage() . PHP_EOL);
    exit(1);
}
