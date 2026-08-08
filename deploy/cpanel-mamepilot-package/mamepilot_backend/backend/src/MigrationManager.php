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
                try {
                    if ($this->executeCompatibilityStatement($pdo, $statement)) {
                        continue;
                    }
                    $pdo->exec($statement);
                } catch (\PDOException $e) {
                    $code = (int) ($e->errorInfo[1] ?? $e->getCode());
                    $safeCodes = [1050, 1051, 1060, 1061, 1062, 1146];
                    if (in_array($code, $safeCodes, true)) {
                        continue;
                    }
                    if ($code === 1064 && stripos($statement, 'ALTER TABLE') === 0) {
                        continue;
                    }
                    throw $e;
                }
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

    /**
     * A small number of packaged migrations use the schema-only helper name
     * sp_add_col. Execute that operation directly when running migrations so
     * fresh installs do not depend on a temporary stored procedure.
     */
    private function executeCompatibilityStatement(\PDO $pdo, string $statement): bool
    {
        $normalized = preg_replace('/\A(?:\s*--[^\r\n]*(?:\r?\n|$))+/', '', $statement) ?? $statement;
        if (preg_match(
            "/^\s*CALL\s+sp_add_col\(\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*\)\s*$/is",
            $normalized,
            $matches
        ) !== 1) {
            return false;
        }

        $table = str_replace("''", "'", $matches[1]);
        $column = str_replace("''", "'", $matches[2]);
        $definition = str_replace("''", "'", $matches[3]);
        if (!preg_match('/^[A-Za-z0-9_]+$/', $table) || !preg_match('/^[A-Za-z0-9_]+$/', $column)) {
            throw new RuntimeException('Invalid identifier in sp_add_col compatibility migration.');
        }

        $check = $pdo->prepare(
            'SELECT 1 FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column LIMIT 1'
        );
        $check->execute([':table' => $table, ':column' => $column]);
        if ($check->fetchColumn() !== false) return true;

        $pdo->exec(sprintf(
            'ALTER TABLE `%s` ADD COLUMN `%s` %s',
            str_replace('`', '``', $table),
            str_replace('`', '``', $column),
            $definition
        ));
        return true;
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
