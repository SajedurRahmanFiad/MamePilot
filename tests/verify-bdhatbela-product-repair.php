<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Config;
use App\Database;

$root = dirname(__DIR__);
$dumpPath = $argv[1] ?? (__DIR__ . '/bdhatbela_rifababyshop.sql');
$repairPath = $argv[2] ?? (__DIR__ . '/bdhatbela_rifababyshop_product_repair.sql');
$mysqlPath = 'C:\\xampp\\mysql\\bin\\mysql.exe';
if (!is_file($dumpPath) || !is_file($repairPath) || !is_file($mysqlPath)) {
    throw new RuntimeException('Dump, repair SQL, or local MariaDB client is missing.');
}

$config = Config::load($root);
$database = new Database($config);
$server = $database->connectServer();
$databaseName = 'mamepilot_repair_verify_' . substr(hash('sha256', uniqid('', true)), 0, 16);
$quotedDatabase = '`' . str_replace('`', '``', $databaseName) . '`';
$defaultsPath = tempnam(sys_get_temp_dir(), 'mamepilot-mysql-');
if ($defaultsPath === false) {
    throw new RuntimeException('Could not create a temporary MariaDB client configuration.');
}

$defaults = "[client]\n"
    . 'host=' . ($config->get('DB_HOST', '127.0.0.1') ?? '127.0.0.1') . "\n"
    . 'port=' . ($config->get('DB_PORT', '3306') ?? '3306') . "\n"
    . 'user=' . ($config->get('DB_USER', 'root') ?? 'root') . "\n"
    . 'password=' . ($config->get('DB_PASS', '') ?? '') . "\n"
    . "default-character-set=utf8mb4\n";
if (file_put_contents($defaultsPath, $defaults) === false) {
    throw new RuntimeException('Could not write the temporary MariaDB client configuration.');
}

/** Execute a SQL file through the MariaDB client without exposing credentials. */
function executeSqlFile(string $mysqlPath, string $defaultsPath, string $databaseName, string $sqlPath): void
{
    $command = escapeshellarg($mysqlPath)
        . ' --defaults-extra-file=' . escapeshellarg($defaultsPath)
        . ' --database=' . escapeshellarg($databaseName)
        . ' --default-character-set=utf8mb4';
    $input = fopen($sqlPath, 'rb');
    if ($input === false) throw new RuntimeException("Could not open SQL file: {$sqlPath}");
    $pipes = [];
    $process = proc_open($command, [$input, ['pipe', 'w'], ['pipe', 'w']], $pipes);
    if (!is_resource($process)) {
        fclose($input);
        throw new RuntimeException('Could not start the MariaDB client.');
    }
    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $exitCode = proc_close($process);
    if ($exitCode !== 0) {
        throw new RuntimeException("MariaDB client failed for {$sqlPath}: " . trim((string) $stderr . "\n" . (string) $stdout));
    }
}

try {
    $server->exec("CREATE DATABASE {$quotedDatabase} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    executeSqlFile($mysqlPath, $defaultsPath, $databaseName, $dumpPath);
    // The checked-in dump has maintenance disabled in its current snapshot;
    // production execution intentionally requires the operator to enable it.
    $temporaryDatabase = new PDO(
        sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $config->get('DB_HOST', '127.0.0.1'), $config->get('DB_PORT', '3306'), $databaseName),
        $config->get('DB_USER', 'root') ?? 'root',
        $config->get('DB_PASS', '') ?? '',
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
    );
    $temporaryDatabase->exec('UPDATE app_capability_settings SET maintenance_enabled = 1');
    executeSqlFile($mysqlPath, $defaultsPath, $databaseName, $repairPath);

    $verifyConfig = new Config([
        'DB_HOST' => $config->get('DB_HOST', '127.0.0.1') ?? '127.0.0.1',
        'DB_PORT' => $config->get('DB_PORT', '3306') ?? '3306',
        'DB_NAME' => $databaseName,
        'DB_USER' => $config->get('DB_USER', 'root') ?? 'root',
        'DB_PASS' => $config->get('DB_PASS', '') ?? '',
    ]);
    $verify = new Database($verifyConfig);

    $badMappings = (int) (($verify->fetchOne(
        "SELECT COUNT(*) AS total
         FROM orders o JOIN seq_0_to_10000 s
           ON s.seq < CASE WHEN JSON_VALID(o.items) THEN JSON_LENGTH(o.items) ELSE 0 END
         WHERE CONCAT(
             JSON_UNQUOTE(JSON_EXTRACT(o.items, CONCAT('$[', s.seq, '].productId'))), '|',
             JSON_UNQUOTE(JSON_EXTRACT(o.items, CONCAT('$[', s.seq, '].productName')))
         ) IN (
             '1479f38f-0894-4961-b955-4d8895d06ad0|30×32~~ 10 পিস',
             '6d803061-7344-4a5b-85ad-a49b58bc6bec|30×32~~ ৬ পিস',
             '85442186-0d1d-4d17-98a1-d6270c28a144|22×32~~ 6 পিস',
             'ce3a2f25-53d1-4350-9e9b-7620077d51e0|22×32~~ 10 পিস',
             'c43bf8de-87c6-4f05-bdb6-2c341b1f9e6d|26×32~~ 6 পিস',
             'c46fb035-994e-40a8-9e22-22faebc58763|26×32~~ 10 পিস'
         )"
    ) ?? [])['total'] ?? -1);
    if ($badMappings !== 0) throw new RuntimeException("{$badMappings} repurposed order-item mappings remain after repair.");

    $invalidJson = (int) (($verify->fetchOne(
        "SELECT
            (SELECT COUNT(*) FROM orders WHERE JSON_VALID(items) = 0)
          + (SELECT COUNT(*) FROM order_status_undo_events WHERE JSON_VALID(before_snapshot) = 0 OR JSON_VALID(after_snapshot) = 0)
          + (SELECT COUNT(*) FROM order_cogs_expenses WHERE breakdown IS NOT NULL AND JSON_VALID(breakdown) = 0) AS total"
    ) ?? [])['total'] ?? -1);
    if ($invalidJson !== 0) throw new RuntimeException("{$invalidJson} invalid JSON rows remain after repair.");

    $cogsMismatch = (int) (($verify->fetchOne(
        "SELECT COUNT(*) AS total
         FROM order_cogs_expenses c
         JOIN transactions t ON t.id = c.transaction_id
         WHERE ABS(c.amount - t.amount) > 0.01"
    ) ?? [])['total'] ?? -1);
    if ($cogsMismatch !== 0) throw new RuntimeException("{$cogsMismatch} COGS rows differ from their transactions after repair.");

    echo "Disposable MariaDB repair verification passed.\n";
} finally {
    try {
        $server->exec("DROP DATABASE IF EXISTS {$quotedDatabase}");
    } catch (Throwable) {
    }
    @unlink($defaultsPath);
}
