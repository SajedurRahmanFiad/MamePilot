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

    public function provision(bool $fresh = false, ?string $schemaPath = null, bool $includeSeedData = true): void
    {
        $dbName = $this->databaseName();
        $server = $this->database->connectServer();

        if ($fresh) {
            $server->exec('DROP DATABASE IF EXISTS `' . str_replace('`', '``', $dbName) . '`');
        }

        $server->exec(
            'CREATE DATABASE IF NOT EXISTS `' . str_replace('`', '``', $dbName) . '` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci'
        );

        $path = $schemaPath ?? dirname(__DIR__) . '/database/schema.sql';
        $this->runSqlFile($path, $includeSeedData);
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
        foreach ($statements as $statement) {
            $trimmed = trim($statement);
            if ($trimmed === '') {
                continue;
            }
            if (!$includeSeedData && $this->shouldSkipSeedStatement($trimmed)) {
                continue;
            }
            $this->database->connect()->exec($trimmed);
        }
    }

    private function shouldSkipSeedStatement(string $statement): bool
    {
        $seedPrefixes = [
            'INSERT INTO payment_methods ',
            'INSERT INTO units ',
            'INSERT INTO categories ',
            'INSERT INTO company_settings ',
            'INSERT INTO order_settings ',
            'INSERT INTO invoice_settings ',
            'INSERT INTO system_defaults ',
            'INSERT INTO courier_settings ',
            'INSERT INTO payroll_settings ',
        ];

        foreach ($seedPrefixes as $prefix) {
            if (stripos($statement, $prefix) === 0) {
                return true;
            }
        }

        return false;
    }
}
