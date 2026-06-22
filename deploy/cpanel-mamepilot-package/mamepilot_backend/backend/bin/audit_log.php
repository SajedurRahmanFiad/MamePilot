<?php

declare(strict_types=1);

use App\AuditLog;
use App\Config;

require_once dirname(__DIR__) . '/bootstrap.php';

$config = Config::load(dirname(__DIR__, 2));
$log = new AuditLog($config);
$limit = 20;

foreach ($argv as $index => $arg) {
    if ($arg === '--limit' && isset($argv[$index + 1])) {
        $limit = max(1, min(200, (int) $argv[$index + 1]));
    }
}

echo json_encode($log->recent($limit), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
