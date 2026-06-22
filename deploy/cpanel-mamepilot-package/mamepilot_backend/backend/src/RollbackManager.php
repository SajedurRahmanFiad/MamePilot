<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class RollbackManager
{
    private Config $config;

    public function __construct(Config $config)
    {
        $this->config = $config;
    }

    public function rollback(?string $backupRoot = null): array
    {
        $resolvedBackupRoot = $this->resolveBackupRoot($backupRoot);
        try {
            $appRoot = $this->config->get('UPDATE_APP_ROOT', dirname(__DIR__, 2));
            $publicRoot = $this->config->get('UPDATE_PUBLIC_ROOT', '');
            $backendBackup = $resolvedBackupRoot . DIRECTORY_SEPARATOR . 'backend';
            if (!is_dir($backendBackup)) {
                throw new RuntimeException("Backend backup not found in {$resolvedBackupRoot}");
            }

            $this->copyDirectory($backendBackup, $appRoot, ['.env', '.env.local']);

            $publicBackup = $resolvedBackupRoot . DIRECTORY_SEPARATOR . 'public';
            if ($publicRoot !== '' && is_dir($publicBackup)) {
                $this->copyDirectory($publicBackup, $publicRoot, []);
            }

            $result = [
                'rolledBack' => true,
                'backupRoot' => $resolvedBackupRoot,
                'appRoot' => $appRoot,
                'publicRoot' => $publicRoot === '' ? null : $publicRoot,
                'database' => [
                    'note' => 'Database rollback is not automatic. Use database backups or migration down-scripts if you need to revert data changes.',
                    'migrationsStillApplied' => true,
                ],
                'rolledBackAt' => gmdate('c'),
            ];
            (new AuditLog($this->config))->append('rollback.success', $result);

            return $result;
        } catch (\Throwable $exception) {
            $this->auditFailure('rollback.failed', $resolvedBackupRoot, $exception);
            throw $exception;
        }
    }

    private function auditFailure(string $event, string $backupRoot, \Throwable $exception): void
    {
        try {
            (new AuditLog($this->config))->append($event, [
                'backupRoot' => $backupRoot,
                'error' => $exception->getMessage(),
            ]);
        } catch (\Throwable) {
            // Audit logging should never hide the original rollback failure.
        }
    }

    private function resolveBackupRoot(?string $backupRoot): string
    {
        if ($backupRoot !== null && trim($backupRoot) !== '') {
            $backupRoot = rtrim(trim($backupRoot), DIRECTORY_SEPARATOR);
            if (is_dir($backupRoot)) {
                return $backupRoot;
            }
            throw new RuntimeException("Backup root not found: {$backupRoot}");
        }

        $configured = trim((string) $this->config->get('UPDATE_ROLLBACK_ROOT', ''));
        if ($configured !== '') {
            $configured = rtrim($configured, DIRECTORY_SEPARATOR);
            if (is_dir($configured)) {
                return $configured;
            }
            throw new RuntimeException("UPDATE_ROLLBACK_ROOT not found: {$configured}");
        }

        $backupRoot = trim((string) $this->config->get('UPDATE_BACKUP_ROOT', ''));
        if ($backupRoot === '') {
            throw new RuntimeException('No backup root was provided. Set UPDATE_ROLLBACK_ROOT or UPDATE_BACKUP_ROOT.');
        }

        $latestFile = $backupRoot . DIRECTORY_SEPARATOR . 'latest.txt';
        if (is_file($latestFile)) {
            $latest = trim((string) file_get_contents($latestFile));
            if ($latest !== '' && is_dir($latest)) {
                return $latest;
            }
        }

        $latest = $this->latestBackupDirectory($backupRoot);
        if ($latest !== null) {
            return $latest;
        }

        throw new RuntimeException("No backup found in {$backupRoot}");
    }

    private function latestBackupDirectory(string $backupRoot): ?string
    {
        if (!is_dir($backupRoot)) {
            return null;
        }

        $items = [];
        foreach (scandir($backupRoot) ?: [] as $item) {
            if ($item === '.' || $item === '..' || $item === 'latest.txt' || $item === 'latest.json') {
                continue;
            }

            $path = $backupRoot . DIRECTORY_SEPARATOR . $item;
            if (is_dir($path)) {
                $items[] = $path;
            }
        }

        if ($items === []) {
            return null;
        }

        usort($items, static fn(string $a, string $b): int => strcmp(basename($b), basename($a)));
        return $items[0];
    }

    /**
     * @param list<string> $excludeNames
     */
    private function copyDirectory(string $source, string $destination, array $excludeNames = []): void
    {
        if (!is_dir($source)) {
            throw new RuntimeException("Source directory not found: {$source}");
        }
        if (!is_dir($destination) && !mkdir($destination, 0755, true) && !is_dir($destination)) {
            throw new RuntimeException("Failed to create destination directory: {$destination}");
        }

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($source, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST
        );

        foreach ($iterator as $item) {
            $relative = $iterator->getSubPathName();
            $baseName = basename($relative);
            if (in_array($baseName, $excludeNames, true)) {
                continue;
            }

            $target = $destination . DIRECTORY_SEPARATOR . $relative;
            if ($item->isDir()) {
                if (!is_dir($target) && !mkdir($target, 0755, true) && !is_dir($target)) {
                    throw new RuntimeException("Failed to create directory: {$target}");
                }
                continue;
            }

            $parent = dirname($target);
            if (!is_dir($parent) && !mkdir($parent, 0755, true) && !is_dir($parent)) {
                throw new RuntimeException("Failed to create directory: {$parent}");
            }
            if (!copy($item->getPathname(), $target)) {
                throw new RuntimeException("Failed to copy {$item->getPathname()} to {$target}");
            }
        }
    }
}
