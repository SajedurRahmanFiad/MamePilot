<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class AgentActionBundle
{
    /** @param array<int, array<string, mixed>> $items */
    public static function immutableHash(string $runId, string $userId, array $items): string
    {
        $normalized = [];
        foreach (array_values($items) as $index => $item) {
            $normalized[] = [
                'position' => $index + 1,
                'toolName' => (string) ($item['toolName'] ?? $item['tool_name'] ?? ''),
                'toolVersion' => (string) ($item['toolVersion'] ?? $item['tool_version'] ?? '1.0.0'),
                'arguments' => self::canonicalize($item['arguments'] ?? $item['input'] ?? []),
                'dependencies' => self::canonicalize($item['dependencies'] ?? []),
                'idempotencyKey' => (string) ($item['idempotencyKey'] ?? $item['idempotency_key'] ?? ''),
            ];
        }
        return hash('sha256', json_encode([
            'runId' => $runId,
            'userId' => $userId,
            'items' => $normalized,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    public static function confirmationToken(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    public static function confirmationTokenHash(string $token): string
    {
        return hash('sha256', trim($token));
    }

    /** @param array<int, array<string, mixed>> $completedResults */
    public static function resolveReferences(mixed $value, array $completedResults): mixed
    {
        if (is_array($value)) {
            if (isset($value['$fromStep'])) {
                $step = max(1, (int) $value['$fromStep']);
                $path = trim((string) ($value['path'] ?? ''));
                return self::valueAtPath($completedResults[$step] ?? null, $path);
            }
            $resolved = [];
            foreach ($value as $key => $child) $resolved[$key] = self::resolveReferences($child, $completedResults);
            return $resolved;
        }
        if (is_string($value) && preg_match('/^\{\{step:(\d+):result(?:\.([A-Za-z0-9_.-]+))?\}\}$/', trim($value), $matches) === 1) {
            return self::valueAtPath($completedResults[(int) $matches[1]] ?? null, (string) ($matches[2] ?? ''));
        }
        return $value;
    }

    private static function valueAtPath(mixed $value, string $path): mixed
    {
        if ($path === '') return $value;
        foreach (explode('.', $path) as $segment) {
            if (!is_array($value) || !array_key_exists($segment, $value)) throw new RuntimeException('An action dependency could not be resolved.');
            $value = $value[$segment];
        }
        return $value;
    }

    private static function canonicalize(mixed $value): mixed
    {
        if (!is_array($value)) return $value;
        if (array_is_list($value)) return array_map([self::class, 'canonicalize'], $value);
        ksort($value, SORT_STRING);
        foreach ($value as $key => $child) $value[$key] = self::canonicalize($child);
        return $value;
    }
}
