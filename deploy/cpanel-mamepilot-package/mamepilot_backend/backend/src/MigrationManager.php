<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class MigrationManager
{
    private Config $config;
    private Database $database;

    public function __construct(Config $config, Database $database)
    {
        $this->config = $config;
        $this->database = $database;
    }

    public function run(?string $migrationPath = null, bool $dryRun = false): array
    {
        $path = $migrationPath ?? $this->migrationPath();
        $this->ensureMigrationTable();

        $pending = $this->pendingMigrations($path);
        if ($dryRun) {
            return [
                'applied' => [],
                'pending' => $pending,
                'message' => count($pending) === 0 ? 'No pending migrations.' : 'Pending migrations: ' . count($pending),
            ];
        }

        $applied = [];
        foreach ($pending as $migration) {
            $this->applyMigration($migration);
            $applied[] = $migration['name'];
        }

        return [
            'applied' => $applied,
            'pending' => [],
            'message' => count($applied) === 0 ? 'No pending migrations.' : 'Applied ' . count($applied) . ' migration(s).',
        ];
    }

    /**
     * @return list<array{name: string, path: string, checksum: string}>
     */
    public function pendingMigrations(string $path): array
    {
        if (!is_dir($path)) {
            throw new RuntimeException("Migration directory not found: {$path}");
        }

        $files = glob($path . DIRECTORY_SEPARATOR . '*.sql');
        if ($files === false) {
            throw new RuntimeException("Failed to read migration directory: {$path}");
        }

        sort($files, SORT_STRING);
        $applied = $this->appliedMigrations();
        $pending = [];

        foreach ($files as $file) {
            $name = basename($file);
            if (isset($applied[$name])) {
                $stored = $applied[$name];
                $currentChecksum = hash_file('sha256', $file);
                if ($currentChecksum !== false && $stored['checksum'] !== $currentChecksum) {
                    throw new RuntimeException("Migration checksum mismatch for {$name}. Applied migrations must not be edited.");
                }
                continue;
            }

            $checksum = hash_file('sha256', $file);
            if ($checksum === false) {
                throw new RuntimeException("Failed to calculate checksum for {$name}");
            }

            $pending[] = [
                'name' => $name,
                'path' => $file,
                'checksum' => $checksum,
            ];
        }

        return $pending;
    }

    /**
     * @return array<string, array{name: string, checksum: string, applied_at: string}>
     */
    public function appliedMigrations(): array
    {
        $this->ensureMigrationTable();
        $rows = $this->database->fetchAll(
            'SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version ASC'
        );

        $applied = [];
        foreach ($rows as $row) {
            $applied[(string) $row['version']] = [
                'name' => (string) $row['version'],
                'checksum' => (string) $row['checksum'],
                'applied_at' => (string) $row['applied_at'],
            ];
        }

        return $applied;
    }

    /**
     * @param array{name: string, path: string, checksum: string} $migration
     */
    private function applyMigration(array $migration): void
    {
        $sql = file_get_contents($migration['path']);
        if ($sql === false) {
            throw new RuntimeException("Failed to read migration: {$migration['path']}");
        }

        $pdo = $this->database->connect();
        $startedTransaction = false;
        if (!$pdo->inTransaction()) {
            $pdo->beginTransaction();
            $startedTransaction = true;
        }

        try {
            $pdo->exec("SET NAMES utf8mb4");
            foreach ($this->statements($sql) as $statement) {
                $pdo->exec($statement);
            }

            $pdo->prepare(
                'INSERT INTO schema_migrations (version, checksum, applied_at)
                 VALUES (:version, :checksum, :applied_at)'
            )->execute([
                ':version' => $migration['name'],
                ':checksum' => $migration['checksum'],
                ':applied_at' => gmdate('Y-m-d H:i:s'),
            ]);

            if ($startedTransaction && $pdo->inTransaction()) {
                $pdo->commit();
            }
        } catch (\Throwable $exception) {
            if ($startedTransaction && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw new RuntimeException("Migration failed: {$migration['name']} - " . $exception->getMessage(), 0, $exception);
        }
    }

    private function ensureMigrationTable(): void
    {
        $this->database->connect()->exec(
            'CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(191) NOT NULL,
                checksum VARCHAR(64) NOT NULL,
                applied_at DATETIME NOT NULL,
                PRIMARY KEY (version),
                KEY idx_schema_migrations_applied_at (applied_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
    }

    /**
     * @return list<string>
     */
    private function statements(string $sql): array
    {
        $statements = preg_split('/;\s*(?:\r?\n|$)/', $sql) ?: [];
        $clean = [];
        foreach ($statements as $statement) {
            $trimmed = trim($statement);
            if ($trimmed === '') {
                continue;
            }
            $clean[] = $trimmed;
        }

        return $clean;
    }

    private function migrationPath(): string
    {
        return $this->config->get('MIGRATION_PATH', dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'migrations');
    }
}
