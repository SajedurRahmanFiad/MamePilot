<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class AgentSqlGuard
{
    private const FORBIDDEN_SCHEMAS = ['information_schema', 'mysql', 'performance_schema', 'sys'];
    private const FORBIDDEN_TABLE_PARTS = [
        'llm', 'agent_', 'setting', 'credential', 'secret', 'token', 'webhook',
        'audit', 'migration', 'deployment', 'license', 'notification_receipt',
        'payment_gateway', 'service_subscription', 'update_', 'backup',
    ];
    private const FORBIDDEN_COLUMN_PARTS = [
        'password', 'secret', 'token', 'api_key', 'access_key', 'private_key',
        'authorization', 'credential', 'webhook', 'raw_payload', 'payload_json',
        'owner_token', 'license_key', 'password_hash', 'session',
    ];

    public function __construct(private Database $database)
    {
    }

    /**
     * @param array<string, array<int, string>> $allowedDatasets
     * @return array{originalSql:string,normalizedSql:string,tables:array<int,string>,safety:array<string,mixed>}
     */
    public static function validate(string $sql, array $allowedDatasets, int $rowLimit = 100): array
    {
        $original = trim($sql);
        if ($original === '') throw new RuntimeException('The business-data query is empty.');
        if (strlen($original) > 30000) throw new RuntimeException('The business-data query is too large.');
        if (preg_match('/(--|#|\/\*)/', $original) === 1) throw new RuntimeException('SQL comments are not allowed.');

        $normalized = rtrim($original);
        if (str_ends_with($normalized, ';')) $normalized = rtrim(substr($normalized, 0, -1));
        if (str_contains($normalized, ';')) throw new RuntimeException('Only one SQL statement is allowed.');
        if (preg_match('/^(SELECT\b|WITH\b)/i', $normalized) !== 1) throw new RuntimeException('Only SELECT or WITH ... SELECT queries are allowed.');
        if (preg_match('/\b(INSERT|UPDATE|DELETE|REPLACE|MERGE|DROP|ALTER|CREATE|TRUNCATE|RENAME|GRANT|REVOKE|CALL|DO|HANDLER|LOAD\s+DATA|LOCK\s+TABLES|UNLOCK\s+TABLES|START\s+TRANSACTION|COMMIT|ROLLBACK|SAVEPOINT|SET\s+(?:SESSION|GLOBAL|LOCAL|TRANSACTION)|INTO\s+(?:OUTFILE|DUMPFILE)|FOR\s+UPDATE|LOCK\s+IN\s+SHARE\s+MODE)\b/i', $normalized) === 1) {
            throw new RuntimeException('Writes, DDL, transactions, locking, and session changes are not allowed.');
        }
        if (preg_match('/\b(SLEEP|BENCHMARK|LOAD_FILE|GET_LOCK|RELEASE_LOCK|IS_USED_LOCK|MASTER_POS_WAIT|UUID_SHORT)\s*\(/i', $normalized) === 1) {
            throw new RuntimeException('Unsafe SQL functions are not allowed.');
        }
        if (preg_match('/(^|[^@])@[A-Za-z_]/', $normalized) === 1 || str_contains($normalized, '@@')) {
            throw new RuntimeException('SQL user and system variables are not allowed.');
        }
        foreach (self::FORBIDDEN_SCHEMAS as $schema) {
            if (preg_match('/\b`?' . preg_quote($schema, '/') . '`?\s*\./i', $normalized) === 1) {
                throw new RuntimeException('System schemas are not available to Mame AI.');
            }
        }

        $cteNames = [];
        if (preg_match('/^WITH\s+(?:RECURSIVE\s+)?(.+?)\bSELECT\b/is', $normalized, $cteBlock) === 1) {
            if (preg_match_all('/(?:^|,)\s*`?([A-Za-z_][A-Za-z0-9_]*)`?\s+AS\s*\(/i', $cteBlock[1], $cteMatches)) {
                $cteNames = array_map('strtolower', $cteMatches[1]);
            }
        }

        preg_match_all('/\b(?:FROM|JOIN)\s+`?([A-Za-z_][A-Za-z0-9_]*)`?/i', $normalized, $matches);
        $tables = [];
        foreach ($matches[1] ?? [] as $table) {
            $lower = strtolower((string) $table);
            if (in_array($lower, $cteNames, true)) continue;
            if (!array_key_exists($lower, $allowedDatasets)) {
                throw new RuntimeException('The query requested a dataset that this user cannot access: ' . $table . '.');
            }
            foreach (self::FORBIDDEN_TABLE_PARTS as $part) {
                if (str_contains($lower, $part)) throw new RuntimeException('That internal dataset is not available to Mame AI.');
            }
            $tables[$lower] = true;
        }
        if ($tables === []) throw new RuntimeException('The query must read from an allowed business dataset.');

        // Verify every qualified base-table column against the server-owned
        // column allowlist. CTE result columns are intentionally validated by
        // their underlying base-table references instead.
        $aliases = [];
        if (preg_match_all('/\b(?:FROM|JOIN)\s+`?([A-Za-z_][A-Za-z0-9_]*)`?(?:\s+(?:AS\s+)?`?([A-Za-z_][A-Za-z0-9_]*)`?)?/i', $normalized, $sourceMatches, PREG_SET_ORDER)) {
            $reservedAliases = ['where', 'join', 'left', 'right', 'inner', 'outer', 'cross', 'on', 'group', 'order', 'limit', 'having', 'union'];
            foreach ($sourceMatches as $source) {
                $table = strtolower((string) ($source[1] ?? ''));
                $alias = strtolower((string) ($source[2] ?? ''));
                if ($table === '' || in_array($table, $cteNames, true)) continue;
                $aliases[$table] = $table;
                if ($alias !== '' && !in_array($alias, $reservedAliases, true)) $aliases[$alias] = $table;
            }
        }
        $withoutStrings = preg_replace('/\'(?:\'\'|[^\'])*\'|"(?:""|[^"])*"/s', "''", $normalized) ?: $normalized;
        if (preg_match('/\b`?[A-Za-z_][A-Za-z0-9_]*`?\s*\.\s*\*/', $withoutStrings) === 1) {
            throw new RuntimeException('Wildcard columns are not allowed. Select only the fields needed for the answer.');
        }
        if (preg_match_all('/\b`?([A-Za-z_][A-Za-z0-9_]*)`?\s*\.\s*`?([A-Za-z_][A-Za-z0-9_]*)`?\b/', $withoutStrings, $columnMatches, PREG_SET_ORDER)) {
            foreach ($columnMatches as $columnMatch) {
                $qualifier = strtolower((string) ($columnMatch[1] ?? ''));
                $column = strtolower((string) ($columnMatch[2] ?? ''));
                if (in_array($qualifier, $cteNames, true) || !isset($aliases[$qualifier])) continue;
                $table = $aliases[$qualifier];
                $allowedColumns = array_map('strtolower', $allowedDatasets[$table] ?? []);
                if (!in_array($column, $allowedColumns, true)) {
                    throw new RuntimeException('The query requested a column that this user cannot access: ' . $column . '.');
                }
            }
        }

        $lowerSql = strtolower($normalized);
        foreach (self::FORBIDDEN_COLUMN_PARTS as $part) {
            if (str_contains($lowerSql, strtolower($part))) {
                throw new RuntimeException('The query referenced a private or credential-related field.');
            }
        }
        if (preg_match('/SELECT\s+(?:DISTINCT\s+)?(?:`?[A-Za-z_][A-Za-z0-9_]*`?\.)?\*/i', $normalized) === 1) {
            throw new RuntimeException('Wildcard columns are not allowed. Select only the fields needed for the answer.');
        }

        $limit = max(1, min(1000, $rowLimit));
        if (preg_match('/\bLIMIT\s+(\d+)(?:\s*,\s*(\d+))?\s*$/i', $normalized, $limitMatch) === 1) {
            $requested = isset($limitMatch[2]) && $limitMatch[2] !== '' ? (int) $limitMatch[2] : (int) $limitMatch[1];
            if ($requested > $limit) {
                $normalized = preg_replace('/\bLIMIT\s+\d+(?:\s*,\s*\d+)?\s*$/i', 'LIMIT ' . $limit, $normalized) ?: $normalized;
            }
        } else {
            $normalized .= ' LIMIT ' . $limit;
        }

        return [
            'originalSql' => $original,
            'normalizedSql' => $normalized,
            'tables' => array_keys($tables),
            'safety' => [
                'singleStatement' => true,
                'readOnly' => true,
                'commentsRejected' => true,
                'variablesRejected' => true,
                'datasetsChecked' => array_keys($tables),
                'columnsChecked' => true,
                'rowLimit' => $limit,
            ],
        ];
    }

    /**
     * @param array<string, array<int, string>> $allowedDatasets
     * @return array<string, mixed>
     */
    public function execute(
        string $sql,
        array $allowedDatasets,
        string $userId,
        ?string $runId,
        ?string $toolCallId,
        int $rowLimit,
        int $timeoutMs,
        int $maxColumns = 30,
        int $maxBytes = 100000
    ): array {
        try {
            $checked = self::validate($sql, $allowedDatasets, $rowLimit);
        } catch (\Throwable $exception) {
            $this->auditRejected($sql, $userId, $runId, $toolCallId, $allowedDatasets, $exception->getMessage());
            throw $exception;
        }
        $startedAt = microtime(true);
        $timeoutSeconds = max(1, $timeoutMs) / 1000;
        try {
            $rows = $this->database->fetchAll('SET STATEMENT max_statement_time=' . number_format($timeoutSeconds, 3, '.', '') . ' FOR ' . $checked['normalizedSql']);
        } catch (\Throwable $exception) {
            if (preg_match('/syntax|1064|SET STATEMENT/i', $exception->getMessage()) !== 1) throw $exception;
            $rows = $this->database->fetchAll($checked['normalizedSql']);
        }
        $durationMs = (int) round((microtime(true) - $startedAt) * 1000);
        if ($durationMs > max(1000, $timeoutMs)) {
            throw new RuntimeException('The business-data query exceeded its execution-time budget.');
        }

        $columns = $rows !== [] ? array_keys($rows[0]) : [];
        if (count($columns) > max(1, $maxColumns)) throw new RuntimeException('The query returned too many columns.');
        foreach ($columns as $column) {
            $lower = strtolower((string) $column);
            foreach (self::FORBIDDEN_COLUMN_PARTS as $part) {
                if (str_contains($lower, $part)) throw new RuntimeException('The query returned a private field.');
            }
        }

        $compacted = [];
        $bytes = 0;
        $truncated = false;
        foreach ($rows as $row) {
            $safe = self::redactRow($row);
            $encoded = json_encode($safe, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}';
            if ($bytes + strlen($encoded) > max(1000, $maxBytes)) {
                $truncated = true;
                break;
            }
            $compacted[] = $safe;
            $bytes += strlen($encoded);
        }

        $this->audit($checked, $userId, $runId, $toolCallId, count($rows), $durationMs, $columns);
        return [
            'rows' => $compacted,
            'rowCount' => count($rows),
            'columns' => $columns,
            'truncated' => $truncated || count($compacted) < count($rows),
            'durationMs' => $durationMs,
            'datasets' => $checked['tables'],
        ];
    }

    /** @return array<string, array<int, string>> */
    public function datasetColumns(array $tables): array
    {
        $result = [];
        foreach ($tables as $table) {
            $name = strtolower(trim((string) $table));
            if ($name === '') continue;
            $rows = $this->database->fetchAll(
                'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table ORDER BY ORDINAL_POSITION',
                [':table' => $name]
            );
            $columns = [];
            foreach ($rows as $row) {
                $column = (string) ($row['COLUMN_NAME'] ?? '');
                $lower = strtolower($column);
                $blocked = false;
                foreach (self::FORBIDDEN_COLUMN_PARTS as $part) {
                    if (str_contains($lower, $part)) { $blocked = true; break; }
                }
                if (!$blocked && $column !== '') $columns[] = $column;
            }
            if ($columns !== []) $result[$name] = $columns;
        }
        return $result;
    }

    private static function redactRow(array $row): array
    {
        $safe = [];
        foreach ($row as $key => $value) {
            $lower = strtolower((string) $key);
            $blocked = false;
            foreach (self::FORBIDDEN_COLUMN_PARTS as $part) {
                if (str_contains($lower, $part)) { $blocked = true; break; }
            }
            if ($blocked) continue;
            if (is_string($value) && strlen($value) > 2000) $value = mb_substr($value, 0, 2000) . '...';
            $safe[(string) $key] = $value;
        }
        return $safe;
    }

    private function audit(array $checked, string $userId, ?string $runId, ?string $toolCallId, int $rowCount, int $durationMs, array $columns): void
    {
        $this->database->execute(
            'INSERT INTO agent_db_query_audit
                (id, run_id, tool_call_id, user_id, sql_text, normalized_sql, allowed_datasets_json, returned_columns_json, decision, row_count, duration_ms, safety_flags_json, created_at)
             VALUES
                (:id, :run_id, :tool_call_id, :user_id, :sql_text, :normalized_sql, :datasets, :columns, \'allowed\', :row_count, :duration_ms, :safety_flags_json, :created_at)',
            [
                ':id' => self::uuid4(),
                ':run_id' => $runId,
                ':tool_call_id' => $toolCallId,
                ':user_id' => $userId,
                ':sql_text' => $checked['originalSql'],
                ':normalized_sql' => $checked['normalizedSql'],
                ':datasets' => json_encode($checked['tables'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]',
                ':columns' => json_encode($columns, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]',
                ':row_count' => $rowCount,
                ':duration_ms' => $durationMs,
                ':safety_flags_json' => json_encode($checked['safety'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
                ':created_at' => $this->database->nowUtc(),
            ]
        );
    }

    private function auditRejected(string $sql, string $userId, ?string $runId, ?string $toolCallId, array $allowedDatasets, string $error): void
    {
        $this->database->execute(
            'INSERT INTO agent_db_query_audit
                (id, run_id, tool_call_id, user_id, sql_text, normalized_sql, allowed_datasets_json, returned_columns_json, decision, row_count, duration_ms, safety_flags_json, error_message, created_at)
             VALUES
                (:id, :run_id, :tool_call_id, :user_id, :sql_text, NULL, :datasets, \'[]\', \'rejected\', 0, 0, :safety, :error, :created_at)',
            [
                ':id' => self::uuid4(), ':run_id' => $runId, ':tool_call_id' => $toolCallId, ':user_id' => $userId,
                ':sql_text' => $sql, ':datasets' => json_encode(array_keys($allowedDatasets), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '[]',
                ':safety' => json_encode(['readOnly' => false, 'rejected' => true], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '{}',
                ':error' => mb_substr($error, 0, 2000), ':created_at' => $this->database->nowUtc(),
            ]
        );
    }

    private static function uuid4(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }
}
