<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/bootstrap.php';

use App\Config;
use App\Database;

if ($argc < 2) {
    fwrite(STDERR, "Usage: php register_migration.php migration-filename.sql\n");
    exit(2);
}

$filename = $argv[1];
$path = (dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'migrations' . DIRECTORY_SEPARATOR . $filename);
if (!is_file($path)) {
    fwrite(STDERR, "Migration file not found: {$path}\n");
    exit(2);
}

$config = Config::load(dirname(__DIR__, 2));
$db = new Database($config);
$pdo = $db->connect();

$checksum = hash_file('sha256', $path);
if ($checksum === false) {
    fwrite(STDERR, "Failed to compute checksum for {$path}\n");
    exit(1);
}

// Ensure table exists
$pdo->exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(191) NOT NULL,
                checksum VARCHAR(64) NOT NULL,
                applied_at DATETIME NOT NULL,
                PRIMARY KEY (version),
                KEY idx_schema_migrations_applied_at (applied_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
);

// Insert or ignore
$stmt = $pdo->prepare('SELECT version FROM schema_migrations WHERE version = :version LIMIT 1');
$stmt->execute([':version' => $filename]);
if ($stmt->fetch()) {
    echo "Migration {$filename} already registered.\n";
    exit(0);
}

$stmt = $pdo->prepare('INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (:version, :checksum, :applied_at)');
$stmt->execute([':version' => $filename, ':checksum' => $checksum, ':applied_at' => gmdate('Y-m-d H:i:s')]);

echo "Registered migration: {$filename}\n";
exit(0);
