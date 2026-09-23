<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/bootstrap.php';

use App\Config;
use App\Database;
use App\SchemaManager;

if ($argc < 2) {
    fwrite(STDERR, "Usage: php apply_sql_file.php path/to/file.sql\n");
    exit(2);
}

$path = $argv[1];
if (!is_file($path)) {
    fwrite(STDERR, "SQL file not found: {$path}\n");
    exit(2);
}

$config = Config::load(dirname(__DIR__, 2));
$db = new Database($config);
try {
    (new SchemaManager($config, $db))->runSqlFile($path, false);
    echo "Applied {$path}\n";
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, "Failed to apply SQL file: " . $e->getMessage() . "\n");
    exit(1);
}
