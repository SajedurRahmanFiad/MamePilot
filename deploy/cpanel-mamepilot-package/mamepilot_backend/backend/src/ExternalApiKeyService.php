<?php

declare(strict_types=1);

namespace App;

use DateTimeImmutable;
use DateTimeZone;

final class ExternalApiKeyService
{
    private const RATE_LIMIT_PER_MINUTE = 120;

    private const ALLOWED_SCOPES = [
        'orders.read',
        'customers.read',
        'transactions.read',
        'bills.read',
        'vendors.read',
        'accounts.read',
        'accounts.read_balance',
    ];

    public function __construct(
        private Database $database,
        private Auth $auth,
        private Config $config,
    ) {
    }

    public function handleManagementRequest(string $method, ?string $keyId, array $payload = []): array
    {
        $this->auth->requireAdmin();

        if ($method === 'POST' && $keyId === null) {
            return $this->createKey($payload);
        }
        if ($method === 'GET' && $keyId === null) {
            return ['data' => $this->listKeys()];
        }
        if ($method === 'DELETE' && $keyId !== null) {
            return $this->revokeKey($keyId);
        }

        throw new ApiException('Unsupported API-key management method.', 405, 'METHOD_NOT_ALLOWED');
    }

    /** @return array{auth: Auth, id: string, scopes: list<string>} */
    public function authenticate(string $secret, string $resource = 'unknown'): array
    {
        if (!str_starts_with($secret, 'mp_live_') || strlen($secret) < 40) {
            throw new ApiException('Invalid API key.', 401, 'INVALID_API_KEY');
        }

        $prefix = substr($secret, 0, 24);
        $row = $this->database->fetchOne(
            'SELECT id, created_by, key_hash, scopes, expires_at
             FROM external_api_keys
             WHERE key_prefix = :key_prefix AND revoked_at IS NULL
             LIMIT 1',
            [':key_prefix' => $prefix]
        );
        if ($row === null || !hash_equals((string) $row['key_hash'], $this->hashSecret($secret))) {
            throw new ApiException('Invalid API key.', 401, 'INVALID_API_KEY');
        }

        $expiresAt = trim((string) ($row['expires_at'] ?? ''));
        if ($expiresAt !== '' && $expiresAt <= gmdate('Y-m-d H:i:s')) {
            throw new ApiException('API key has expired.', 401, 'EXPIRED_API_KEY');
        }

        try {
            $keyAuth = $this->auth->forUserId((string) ($row['created_by'] ?? ''));
            $issuer = $keyAuth->requireUser();
        } catch (\Throwable) {
            throw new ApiException('API key issuer is no longer active.', 401, 'INACTIVE_API_KEY_ISSUER');
        }
        if (!in_array((string) ($issuer['role'] ?? ''), ['Admin', 'Developer'], true)) {
            throw new ApiException('API key issuer is no longer authorized.', 401, 'INACTIVE_API_KEY_ISSUER');
        }

        $scopes = json_decode((string) ($row['scopes'] ?? '[]'), true);
        if (!is_array($scopes)) {
            throw new ApiException('API key has invalid scope configuration.', 401, 'INVALID_API_KEY');
        }
        $scopes = array_values(array_intersect(self::ALLOWED_SCOPES, array_map('strval', $scopes)));
        $now = gmdate('Y-m-d H:i:s');
        $this->database->execute(
            'UPDATE external_api_keys
             SET last_used_at = :last_used_at,
                 rate_count = CASE
                     WHEN rate_window_started_at IS NULL OR rate_window_started_at <= DATE_SUB(:rate_check_at, INTERVAL 1 MINUTE) THEN 1
                     ELSE rate_count + 1
                 END,
                 rate_window_started_at = CASE
                     WHEN rate_window_started_at IS NULL OR rate_window_started_at <= DATE_SUB(:rate_reset_at, INTERVAL 1 MINUTE) THEN :rate_window_start
                     ELSE rate_window_started_at
                 END
             WHERE id = :id',
            [
                ':last_used_at' => $now,
                ':rate_check_at' => $now,
                ':rate_reset_at' => $now,
                ':rate_window_start' => $now,
                ':id' => (string) $row['id'],
            ]
        );
        $rateRow = $this->database->fetchOne(
            'SELECT rate_count FROM external_api_keys WHERE id = :id LIMIT 1',
            [':id' => (string) $row['id']]
        );
        if ((int) ($rateRow['rate_count'] ?? 0) > self::RATE_LIMIT_PER_MINUTE) {
            $this->logRequest((string) $row['id'], $resource, Http::method(), 429);
            throw new ApiException('API key rate limit exceeded.', 429, 'RATE_LIMIT_EXCEEDED');
        }

        return ['auth' => $keyAuth, 'id' => (string) $row['id'], 'scopes' => $scopes];
    }

    public function logRequest(string $keyId, string $resource, string $method, int $status): void
    {
        try {
            $this->database->execute(
                'INSERT INTO external_api_request_logs (key_id, resource, request_method, response_status, occurred_at)
                 VALUES (:key_id, :resource, :request_method, :response_status, :occurred_at)',
                [
                    ':key_id' => $keyId,
                    ':resource' => substr($resource, 0, 32),
                    ':request_method' => substr($method, 0, 10),
                    ':response_status' => $status,
                    ':occurred_at' => gmdate('Y-m-d H:i:s'),
                ]
            );
        } catch (\Throwable) {
            error_log('External API audit insert failed for key ' . $keyId . '.');
        }
    }

    /** @return array<string, mixed> */
    private function createKey(array $payload): array
    {
        $labelInput = $payload['label'] ?? null;
        $label = is_string($labelInput) ? trim($labelInput) : '';
        if ($label === '' || strlen($label) > 100) {
            throw new ApiException('label is required and must be at most 100 characters.', 422, 'INVALID_API_KEY_LABEL');
        }

        $scopes = $payload['scopes'] ?? null;
        if (!is_array($scopes) || $scopes === [] || count($scopes) > count(self::ALLOWED_SCOPES)) {
            throw new ApiException('At least one API scope is required.', 422, 'INVALID_API_KEY_SCOPES');
        }
        foreach ($scopes as $scope) {
            if (!is_string($scope)) {
                throw new ApiException('API scopes must be strings.', 422, 'INVALID_API_KEY_SCOPES');
            }
        }
        $scopes = array_values(array_unique(array_map('strval', $scopes)));
        if (array_diff($scopes, self::ALLOWED_SCOPES) !== []) {
            throw new ApiException('One or more API scopes are not supported.', 422, 'INVALID_API_KEY_SCOPES');
        }
        if (in_array('accounts.read_balance', $scopes, true) && !in_array('accounts.read', $scopes, true)) {
            throw new ApiException('accounts.read_balance requires accounts.read.', 422, 'INVALID_API_KEY_SCOPES');
        }

        $expiresAt = null;
        if (isset($payload['expires_at']) && $payload['expires_at'] !== '' && !is_string($payload['expires_at'])) {
            throw new ApiException('expires_at must be an ISO-8601 timestamp.', 422, 'INVALID_API_KEY_EXPIRY');
        }
        if (isset($payload['expires_at']) && trim((string) $payload['expires_at']) !== '') {
            $expiryInput = trim((string) $payload['expires_at']);
            if (preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/', $expiryInput) !== 1) {
                throw new ApiException('expires_at must be an ISO-8601 timestamp with a timezone.', 422, 'INVALID_API_KEY_EXPIRY');
            }
            try {
                $expiry = new DateTimeImmutable($expiryInput);
            } catch (\Throwable) {
                throw new ApiException('expires_at must be a valid ISO-8601 timestamp.', 422, 'INVALID_API_KEY_EXPIRY');
            }
            $expiry = $expiry->setTimezone(new DateTimeZone('UTC'));
            if ($expiry->getTimestamp() <= time()) {
                throw new ApiException('expires_at must be in the future.', 422, 'INVALID_API_KEY_EXPIRY');
            }
            $expiresAt = $expiry->format('Y-m-d H:i:s');
        }

        $creator = $this->auth->requireAdmin();
        $id = $this->uuid4();
        $secret = 'mp_live_' . $this->base64UrlEncode(random_bytes(32));
        $this->database->execute(
            'INSERT INTO external_api_keys
                (id, label, key_prefix, key_hash, created_by, scopes, created_at, expires_at)
             VALUES
                (:id, :label, :key_prefix, :key_hash, :created_by, :scopes, :created_at, :expires_at)',
            [
                ':id' => $id,
                ':label' => $label,
                ':key_prefix' => substr($secret, 0, 24),
                ':key_hash' => $this->hashSecret($secret),
                ':created_by' => (string) $creator['id'],
                ':scopes' => json_encode($scopes, JSON_UNESCAPED_SLASHES),
                ':created_at' => gmdate('Y-m-d H:i:s'),
                ':expires_at' => $expiresAt,
            ]
        );

        return [
            'id' => $id,
            'label' => $label,
            'key_prefix' => substr($secret, 0, 12) . '...',
            'scopes' => $scopes,
            'created_at' => gmdate('Y-m-d H:i:s'),
            'expires_at' => $expiresAt,
            'api_key' => $secret,
        ];
    }

    /** @return list<array<string, mixed>> */
    private function listKeys(): array
    {
        $rows = $this->database->fetchAll(
            'SELECT id, label, key_prefix, created_by, scopes, created_at, expires_at, revoked_at, last_used_at
             FROM external_api_keys ORDER BY created_at DESC, id DESC'
        );
        foreach ($rows as &$row) {
            $row['key_prefix'] = substr((string) $row['key_prefix'], 0, 12) . '...';
            $row['scopes'] = json_decode((string) $row['scopes'], true) ?: [];
        }
        unset($row);

        return $rows;
    }

    /** @return array{id: string, revoked: bool} */
    private function revokeKey(string $keyId): array
    {
        $keyId = trim($keyId);
        if ($keyId === '') {
            throw new ApiException('API key id is required.', 422, 'INVALID_API_KEY_ID');
        }
        $this->database->execute(
            'UPDATE external_api_keys SET revoked_at = :revoked_at WHERE id = :id AND revoked_at IS NULL',
            [':revoked_at' => gmdate('Y-m-d H:i:s'), ':id' => $keyId]
        );
        $exists = $this->database->fetchOne('SELECT id FROM external_api_keys WHERE id = :id LIMIT 1', [':id' => $keyId]);
        if ($exists === null) {
            throw new ApiException('API key not found.', 404, 'API_KEY_NOT_FOUND');
        }

        return ['id' => $keyId, 'revoked' => true];
    }

    private function hashSecret(string $secret): string
    {
        $pepper = $this->config->get('APP_API_KEY_PEPPER', '');
        if ($pepper === null || strlen($pepper) < 32) {
            throw new ApiException('APP_API_KEY_PEPPER must be configured with at least 32 random bytes.', 503, 'API_KEY_PEPPER_NOT_CONFIGURED');
        }

        return hash_hmac('sha256', $secret, $pepper);
    }

    private function uuid4(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }
}