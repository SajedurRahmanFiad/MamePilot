<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class AuditLog
{
    private Config $config;

    public function __construct(Config $config)
    {
        $this->config = $config;
    }

    /**
     * @param array<string, mixed> $payload
     */
    public function append(string $event, array $payload = []): void
    {
        $path = $this->path();
        $directory = dirname($path);
        if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
            throw new RuntimeException("Failed to create audit log directory: {$directory}");
        }

        $line = json_encode(array_merge([
            'time' => gmdate('c'),
            'event' => $event,
        ], $payload), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        if ($line === false) {
            throw new RuntimeException('Failed to encode audit log entry.');
        }

        if (file_put_contents($path, $line . PHP_EOL, FILE_APPEND | LOCK_EX) === false) {
            throw new RuntimeException("Failed to write audit log: {$path}");
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function recent(int $limit = 20): array
    {
        $path = $this->path();
        if (!is_file($path)) {
            return [];
        }

        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines === false) {
            return [];
        }

        $lines = array_slice($lines, -$limit);
        $entries = [];
        foreach ($lines as $line) {
            $decoded = json_decode($line, true);
            if (is_array($decoded)) {
                $entries[] = $decoded;
            }
        }

        return $entries;
    }

    private function path(): string
    {
        $configured = trim((string) $this->config->get('AUDIT_LOG_FILE', ''));
        if ($configured !== '') {
            return $configured;
        }

        return dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'audit' . DIRECTORY_SEPARATOR . 'update-log.jsonl';
    }
}
