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

try {
    $backupRoot = configValue($config, 'DB_BACKUP_ROOT', dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'backups' . DIRECTORY_SEPARATOR . 'db');
    $dumpPath = configValue($config, 'DB_DUMP_PATH', 'mysqldump');
    $dbName = requiredConfigValue($config, 'DB_NAME');
    $dbHost = configValue($config, 'DB_HOST', '127.0.0.1');
    $dbPort = configValue($config, 'DB_PORT', '3306');
    $dbUser = requiredConfigValue($config, 'DB_USER');
    $dbPass = $config->get('DB_PASS', '') ?? '';

    if (!is_dir($backupRoot) && !mkdir($backupRoot, 0700, true) && !is_dir($backupRoot)) {
        throw new RuntimeException("Failed to create database backup directory: {$backupRoot}");
    }

    $filename = 'db-' . $dbName . '-' . gmdate('Ymd-His') . '.sql';
    $sqlPath = $backupRoot . DIRECTORY_SEPARATOR . $filename;

    $command = [
        $dumpPath,
        '--single-transaction',
        '--routines',
        '--triggers',
        '--hex-blob',
        '--quick',
        '--set-gtid-purged=OFF',
        '--host=' . $dbHost,
        '--port=' . $dbPort,
        '--user=' . $dbUser,
    ];

    if ($dbPass !== '') {
        $command[] = '--password=' . $dbPass;
    }

    $command[] = $dbName;

    $descriptorSpec = [
        0 => ['pipe', 'r'],
        1 => ['file', $sqlPath, 'w'],
        2 => ['file', $sqlPath . '.error.log', 'w'],
    ];

    $process = proc_open(implode(' ', array_map('escapeshellarg', $command)), $descriptorSpec, $pipes);
    if (!is_resource($process)) {
        throw new RuntimeException("Failed to start {$dumpPath}. Check DB_DUMP_PATH.");
    }

    fclose($pipes[0]);
    $exitCode = proc_close($process);

    if ($exitCode !== 0) {
        $error = is_file($sqlPath . '.error.log') ? trim((string) file_get_contents($sqlPath . '.error.log')) : 'unknown error';
        throw new RuntimeException("mysqldump failed with exit code {$exitCode}: {$error}");
    }

    if (function_exists('gzencode') && filesize($sqlPath) > 0) {
        $contents = file_get_contents($sqlPath);
        if ($contents === false) {
            throw new RuntimeException("Failed to read SQL backup before compression: {$sqlPath}");
        }

        $gzPath = $sqlPath . '.gz';
        if (file_put_contents($gzPath, gzencode($contents, 9)) === false) {
            throw new RuntimeException("Failed to write compressed backup: {$gzPath}");
        }
        @unlink($sqlPath);
        $sqlPath = $gzPath;
    }

    echo json_encode([
        'backedUp' => true,
        'database' => $dbName,
        'backupPath' => $sqlPath,
        'backupRoot' => $backupRoot,
        'createdAt' => gmdate('c'),
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
} catch (Throwable $exception) {
    fwrite(STDERR, $exception->getMessage() . PHP_EOL);
    exit(1);
}
