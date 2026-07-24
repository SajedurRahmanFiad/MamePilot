<?php

declare(strict_types=1);

namespace App;

final class Auth
{
    private Config $config;
    private Database $database;
    /** @var array<string, mixed>|null */
    private ?array $resolvedUser = null;
    private ?string $resolvedToken = null;
    private bool $hasResolvedToken = false;
    private ?array $backgroundUser = null;

    public function __construct(Config $config, Database $database)
    {
        $this->config = $config;
        $this->database = $database;
    }

    /**
     * @param array<string, mixed> $user
     */
    public function issueToken(array $user): string
    {
        $header = $this->base64UrlEncode(json_encode(['alg' => 'HS256', 'typ' => 'JWT']) ?: '{}');
        $payload = $this->base64UrlEncode(json_encode([
            'sub' => $user['id'] ?? null,
            'phone' => $user['phone'] ?? null,
            'role' => $user['role'] ?? null,
            'iat' => time(),
            'exp' => time() + (60 * 60 * 24 * 30),
        ]) ?: '{}');

        $signature = hash_hmac('sha256', $header . '.' . $payload, $this->jwtSecret(), true);
        return $header . '.' . $payload . '.' . $this->base64UrlEncode($signature);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function userFromToken(?string $token): ?array
    {
        if ($token === null || trim($token) === '') {
            return null;
        }

        if ($this->hasResolvedToken && $this->resolvedToken === $token) {
            return $this->resolvedUser;
        }

        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            $this->resolvedToken = $token;
            $this->resolvedUser = null;
            $this->hasResolvedToken = true;
            return null;
        }

        [$header, $payload, $signature] = $parts;
        $expected = $this->base64UrlEncode(hash_hmac('sha256', $header . '.' . $payload, $this->jwtSecret(), true));
        if (!hash_equals($expected, $signature)) {
            $this->resolvedToken = $token;
            $this->resolvedUser = null;
            $this->hasResolvedToken = true;
            return null;
        }

        $decodedPayload = json_decode($this->base64UrlDecode($payload), true);
        if (!is_array($decodedPayload)) {
            $this->resolvedToken = $token;
            $this->resolvedUser = null;
            $this->hasResolvedToken = true;
            return null;
        }

        if (($decodedPayload['exp'] ?? 0) < time()) {
            $this->resolvedToken = $token;
            $this->resolvedUser = null;
            $this->hasResolvedToken = true;
            return null;
        }

        $userId = (string) ($decodedPayload['sub'] ?? '');
        if ($userId === '') {
            $this->resolvedToken = $token;
            $this->resolvedUser = null;
            $this->hasResolvedToken = true;
            return null;
        }

        $this->resolvedToken = $token;
        $this->resolvedUser = $this->database->fetchOne(
            'SELECT id, name, phone, role, image, created_at, deleted_at, deleted_by FROM users WHERE id = :id AND deleted_at IS NULL LIMIT 1',
            [':id' => $userId]
        );
        $this->hasResolvedToken = true;

        return $this->resolvedUser;
    }

    public function requireUser(): array
    {
        if ($this->backgroundUser !== null) {
            return $this->backgroundUser;
        }

        $user = $this->userFromToken(Http::bearerToken());
        if ($user === null) {
            throw new \RuntimeException('Authentication required.');
        }

        return $user;
    }

    /**
     * Build an authentication context for a durable background job. The
     * original browser token is intentionally never persisted or replayed.
     */
    public function forUserId(string $userId): self
    {
        $normalized = trim($userId);
        if ($normalized === '') {
            throw new \RuntimeException('Background user id is required.');
        }

        $user = $this->database->fetchOne(
            'SELECT id, name, phone, role, image, created_at, deleted_at, deleted_by
             FROM users
             WHERE id = :id AND deleted_at IS NULL
             LIMIT 1',
            [':id' => $normalized]
        );
        if ($user === null) {
            throw new \RuntimeException('The user who started this run no longer exists or is disabled.');
        }

        if ($this->userIsExplicitlyDisabled($normalized)) {
            throw new \RuntimeException('The user who started this run is disabled.');
        }

        $context = new self($this->config, $this->database);
        $context->backgroundUser = $user;
        return $context;
    }

    public function requireAdmin(): array
    {
        $user = $this->requireUser();
        $role = trim((string) ($user['role'] ?? ''));
        if (!in_array($role, ['Admin', 'Developer'], true)) {
            throw new \RuntimeException('Admin access required.');
        }

        return $user;
    }

    private function jwtSecret(): string
    {
        return $this->config->get('APP_JWT_SECRET', 'bdhatbela-change-this-secret') ?? 'bdhatbela-change-this-secret';
    }

    private function userIsExplicitlyDisabled(string $userId): bool
    {
        $column = $this->database->fetchOne(
            "SELECT COLUMN_NAME
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'users'
               AND COLUMN_NAME IN ('is_active', 'enabled', 'disabled_at')
             ORDER BY FIELD(COLUMN_NAME, 'is_active', 'enabled', 'disabled_at')
             LIMIT 1"
        );
        $columnName = (string) ($column['COLUMN_NAME'] ?? '');
        if ($columnName === '') {
            return false;
        }

        $row = $this->database->fetchOne(
            'SELECT `' . $columnName . '` AS state_value FROM users WHERE id = :id LIMIT 1',
            [':id' => $userId]
        );
        $value = $row['state_value'] ?? null;
        if ($columnName === 'disabled_at') {
            return $value !== null && trim((string) $value) !== '';
        }

        return (int) $value !== 1;
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $value): string
    {
        $padding = strlen($value) % 4;
        if ($padding !== 0) {
            $value .= str_repeat('=', 4 - $padding);
        }

        $decoded = base64_decode(strtr($value, '-_', '+/'), true);
        return $decoded === false ? '' : $decoded;
    }
}
