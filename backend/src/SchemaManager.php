<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class SchemaManager
{
    private Config $config;
    private Database $database;

    public function __construct(Config $config, Database $database)
    {
        $this->config = $config;
        $this->database = $database;
    }

    public function databaseName(): string
    {
        return $this->config->get('DB_NAME', 'mamepilot') ?? 'mamepilot';
    }

    public function provision(bool $fresh = false, ?string $schemaPath = null, ?string $seedPath = null, bool $includeSeedData = true): void
    {
        $dbName = $this->databaseName();
        $server = $this->database->connectServer();

        if ($fresh) {
            $server->exec('DROP DATABASE IF EXISTS `' . str_replace('`', '``', $dbName) . '`');
        }

        $server->exec(
            'CREATE DATABASE IF NOT EXISTS `' . str_replace('`', '``', $dbName) . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
        );

        $schema = $schemaPath ?? dirname(__DIR__) . '/database/schema.sql';
        $this->runSqlFile($schema, false);

        if ($includeSeedData) {
            $seed = $seedPath ?? dirname(__DIR__) . '/database/seed.sql';
            if (is_file($seed)) {
                $this->runSqlFile($seed, true);
            }
        }
    }

    public function runSqlFile(string $path, bool $includeSeedData = true): void
    {
        if (!is_file($path)) {
            throw new RuntimeException("SQL file not found: {$path}");
        }

        $sql = file_get_contents($path);
        if ($sql === false) {
            throw new RuntimeException("Failed to read SQL file: {$path}");
        }

        $statements = preg_split('/;\s*(?:\r?\n|$)/', $sql) ?: [];
        $errors = [];
        foreach ($statements as $statement) {
            $trimmed = trim($statement);
            if ($trimmed === '') {
                continue;
            }
            if (!$includeSeedData && $this->shouldSkipSeedStatement($trimmed)) {
                continue;
            }
            try {
                $this->database->connect()->exec($trimmed);
            } catch (\PDOException $e) {
                // 1060 = Duplicate column name, 1061 = Duplicate key name,
                // 1050 = Table already exists, 1051 = Unknown table,
                // 1062 = Duplicate entry, 1146 = Table/view not found (from DROP VIEW IF EXISTS on missing view)
                // These are safe to ignore during idempotent schema re-runs.
                $code = (int) $e->getCode();
                $safeCodes = [1050, 1051, 1060, 1061, 1062, 1146];
                if (in_array($code, $safeCodes, true)) {
                    continue;
                }
                // MySQL < 8.0.29 does not support IF NOT EXISTS on ALTER TABLE ADD COLUMN.
                // Treat the syntax error as non-fatal so subsequent statements (e.g. CREATE VIEW) still run.
                if ($code === 1064 && stripos($trimmed, 'ALTER TABLE') === 0) {
                    $errors[] = $e->getMessage();
                    continue;
                }
                throw $e;
            }
        }
    }

    private function shouldSkipSeedStatement(string $statement): bool
    {
        return stripos($statement, 'INSERT INTO ') === 0;
    }
}
