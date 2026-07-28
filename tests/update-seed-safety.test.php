<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Config;
use App\Database;

function updateSeedSafetyAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$managerSource = (string) file_get_contents($root . '/backend/src/UpdateManager.php');
$seedSource = (string) file_get_contents($root . '/backend/database/seed.sql');
$packageManagerPath = $root . '/deploy/cpanel-mamepilot-package/mamepilot_backend/backend/src/UpdateManager.php';
$packageSeedPath = $root . '/deploy/cpanel-mamepilot-package/mamepilot_backend/backend/database/seed.sql';

updateSeedSafetyAssert(
    !str_contains($managerSource, 'runSqlFile($seedPath, true)')
        && str_contains($managerSource, 'Skipped seed.sql: automatic updates preserve existing data.'),
    'Automatic updates must never execute seed.sql, even when an older .env still enables UPDATE_RUN_SEED.'
);

$seedStatements = preg_split('/;\s*(?:\r?\n|$)/', $seedSource) ?: [];
$insertCount = 0;
foreach ($seedStatements as $statement) {
    if (preg_match('/\bINSERT\s+INTO\s+([a-z0-9_]+)/i', $statement, $matches) !== 1) {
        continue;
    }

    $insertCount++;
    $table = $matches[1];
    updateSeedSafetyAssert(
        preg_match('/ON\s+DUPLICATE\s+KEY\s+UPDATE\s+id\s*=\s*id\s*$/is', trim($statement)) === 1,
        "Seed data for {$table} must insert missing defaults without updating an existing row."
    );
}

updateSeedSafetyAssert($insertCount >= 10, 'The seed safety test did not inspect the expected default-data statements.');

if (is_file($packageManagerPath) || is_file($packageSeedPath)) {
    updateSeedSafetyAssert(
        is_file($packageManagerPath)
            && is_file($packageSeedPath)
            && hash_file('sha256', $packageManagerPath) === hash('sha256', $managerSource)
            && hash_file('sha256', $packageSeedPath) === hash('sha256', $seedSource),
        'The generated cPanel package does not contain the source update/seed preservation fix.'
    );
}

// When the local test database is available, verify the no-op duplicate clause
// against the same MariaDB engine used by production. The temporary table is
// connection-scoped and never touches application data.
try {
    $pdo = (new Database(Config::load($root)))->connect();
} catch (Throwable) {
    $pdo = null;
}

if ($pdo instanceof PDO) {
    $table = 'seed_noop_' . bin2hex(random_bytes(6));
    $pdo->exec("CREATE TEMPORARY TABLE {$table} (id VARCHAR(32) PRIMARY KEY, value_text VARCHAR(32) NOT NULL)");
    $pdo->exec("INSERT INTO {$table} (id, value_text) VALUES ('row-1', 'saved')");
    $pdo->exec(
        "INSERT INTO {$table} (id, value_text) VALUES ('row-1', 'reset') "
        . 'ON DUPLICATE KEY UPDATE id = id'
    );
    $row = $pdo->query("SELECT value_text FROM {$table} WHERE id = 'row-1'")->fetch(PDO::FETCH_ASSOC);
    updateSeedSafetyAssert(
        ($row['value_text'] ?? null) === 'saved',
        'The MariaDB no-op seed clause changed an existing value.'
    );
}

echo "Automatic update and seed data preservation tests passed.\n";
