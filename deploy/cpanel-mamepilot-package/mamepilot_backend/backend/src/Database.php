<?php

declare(strict_types=1);

namespace App;

use PDO;
use PDOException;
use PDOStatement;

final class Database
{
    private Config $config;
    private ?PDO $pdo = null;
    private ?PDO $serverPdo = null;

    public function __construct(Config $config)
    {
        $this->config = $config;
    }

    public function config(): Config
    {
        return $this->config;
    }

    public function connect(): PDO
    {
        if ($this->pdo instanceof PDO) {
            return $this->pdo;
        }

        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
            $this->config->get('DB_HOST', '127.0.0.1'),
            $this->config->get('DB_PORT', '3306'),
            $this->config->get('DB_NAME', 'mamepilot'),
        );

        $this->pdo = new PDO(
            $dsn,
            $this->config->get('DB_USER', 'root') ?? 'root',
            $this->config->get('DB_PASS', '') ?? '',
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_TIMEOUT => 5,
            ]
        );

        $this->pdo->exec("SET time_zone = '+00:00'");
        $this->pdo->exec("SET NAMES utf8mb4");

        return $this->pdo;
    }

    public function connectServer(): PDO
    {
        if ($this->serverPdo instanceof PDO) {
            return $this->serverPdo;
        }

        $dsn = sprintf(
            'mysql:host=%s;port=%s;charset=utf8mb4',
            $this->config->get('DB_HOST', '127.0.0.1'),
            $this->config->get('DB_PORT', '3306'),
        );

        $this->serverPdo = new PDO(
            $dsn,
            $this->config->get('DB_USER', 'root') ?? 'root',
            $this->config->get('DB_PASS', '') ?? '',
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_TIMEOUT => 5,
            ]
        );

        $this->serverPdo->exec("SET time_zone = '+00:00'");
        $this->serverPdo->exec("SET NAMES utf8mb4");

        return $this->serverPdo;
    }

    /**
     * @param array<int|string, mixed> $params
     * @return array<int, array<string, mixed>>
     */
    public function fetchAll(string $sql, array $params = []): array
    {
        $statement = $this->run($sql, $params);
        return $statement->fetchAll();
    }

    /**
     * @param array<int|string, mixed> $params
     * @return array<string, mixed>|null
     */
    public function fetchOne(string $sql, array $params = []): ?array
    {
        $statement = $this->run($sql, $params);
        $row = $statement->fetch();
        return $row === false ? null : $row;
    }

    /**
     * @param array<int|string, mixed> $params
     */
    public function execute(string $sql, array $params = []): int
    {
        $statement = $this->run($sql, $params);
        return $statement->rowCount();
    }

    /**
     * @param array<int|string, mixed> $params
     */
    public function run(string $sql, array $params = []): PDOStatement
    {
        $statement = $this->connect()->prepare($sql);
        $statement->execute($params);
        return $statement;
    }

    /**
     * @template T
     * @param callable(PDO): T $callback
     * @return T
     */
    public function transaction(callable $callback)
    {
        $pdo = $this->connect();
        $started = false;

        if (!$pdo->inTransaction()) {
            $pdo->beginTransaction();
            $started = true;
        }

        try {
            $result = $callback($pdo);
            if ($started) {
                $pdo->commit();
            }
            return $result;
        } catch (\Throwable $exception) {
            if ($started && $pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $exception;
        }
    }

    public function lastInsertId(): string
    {
        return $this->connect()->lastInsertId();
    }

    /**
     * @param list<string> $values
     */
    public function placeholders(array $values, string $prefix = 'p'): array
    {
        $params = [];
        $names = [];
        foreach ($values as $index => $value) {
            $name = ':' . $prefix . $index;
            $names[] = $name;
            $params[$name] = $value;
        }

        return [$names, $params];
    }

    /**
     * @param array<string, mixed> $data
     * @return array{0: string, 1: array<string, mixed>}
     */
    public function buildSetClause(array $data): array
    {
        $parts = [];
        $params = [];

        foreach ($data as $column => $value) {
            $param = ':set_' . $column;
            $parts[] = sprintf('%s = %s', $column, $param);
            $params[$param] = $value;
        }

        return [implode(', ', $parts), $params];
    }

    public function nowUtc(): string
    {
        return gmdate('Y-m-d H:i:s');
    }

    public function dateOnlyFromMixed(?string $value): ?string
    {
        if ($value === null || trim($value) === '') {
            return null;
        }

        $timestamp = strtotime($value);
        if ($timestamp === false) {
            return null;
        }

        return gmdate('Y-m-d', $timestamp);
    }
}
