<?php

declare(strict_types=1);

use App\Config;

require_once dirname(__DIR__) . '/bootstrap.php';

$config = Config::load(dirname(__DIR__, 2));

function configValue(Config $config, string $key, string $default): string
{
    $value = $config->get($key, $default);
    return trim((string) $value);
}

function requiredConfigValue(Config $config, string $key): string
{
    $value = $config->get($key);
    if ($value === null || trim((string) $value) === '') {
        throw new RuntimeException("Missing required config value: {$key}");
    }

    return trim((string) $value);
}

$file = null;
foreach ($argv as $index => $arg) {
    if ($arg === '--file' && isset($argv[$index + 1])) {
        $file = $argv[$index + 1];
    }
}

if ($file === null) {
    fwrite(STDERR, "Usage: php backend/bin/restore_db.php --file /path/to/backup.sql.gz\n");
    exit(1);
}

try {
    if (!is_file($file)) {
        throw new RuntimeException("Backup file not found: {$file}");
    }

    $mysqlPath = configValue($config, 'DB_MYSQL_PATH', 'mysql');
    $dbName = requiredConfigValue($config, 'DB_NAME');
    $dbHost = configValue($config, 'DB_HOST', '127.0.0.1');
    $dbPort = configValue($config, 'DB_PORT', '3306');
    $dbUser = requiredConfigValue($config, 'DB_USER');
    $dbPass = $config->get('DB_PASS', '') ?? '';

    $command = [
        $mysqlPath,
        '--host=' . $dbHost,
        '--port=' . $dbPort,
        '--user=' . $dbUser,
        $dbName,
    ];

    if ($dbPass !== '') {
        $command[] = '--password=' . $dbPass;
    }

    $descriptorSpec = [
        0 => ['file', $file, 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ];

    $process = proc_open(implode(' ', array_map('escapeshellarg', $command)), $descriptorSpec, $pipes);
    if (!is_resource($process)) {
        throw new RuntimeException("Failed to start {$mysqlPath}. Check DB_MYSQL_PATH.");
    }

    $stdout = stream_get_contents($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);
    $exitCode = proc_close($process);

    if ($exitCode !== 0) {
        throw new RuntimeException("mysql restore failed with exit code {$exitCode}: " . trim((string) $stderr));
    }

    echo json_encode([
        'restored' => true,
        'database' => $dbName,
        'backupPath' => $file,
        'restoredAt' => gmdate('c'),
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
} catch (Throwable $exception) {
    fwrite(STDERR, $exception->getMessage() . PHP_EOL);
    exit(1);
}
