<?php

declare(strict_types=1);

namespace App;

abstract class BaseService
{
    protected const DEFAULT_PAGE_SIZE = 25;
    protected const DEFAULT_PAYROLL_STATUSES = ['On Hold', 'Processing', 'Courier assigned', 'Picked', 'Completed', 'Exchange delivered', 'Cancelled'];
    protected const ORDER_STOCK_STATUSES = ['Processing', 'Courier assigned', 'Picked', 'Exchange processing', 'Exchange picked', 'Exchange delivered', 'Completed'];
    protected const BILL_STOCK_STATUSES = ['Received', 'Paid'];
    protected const DEFAULT_WALLET_CUTOFF_DATE = '2026-04-01';
    protected const DEFAULT_WALLET_CUTOFF_AT_UTC = '2026-03-31 18:00:00';
    protected const RESERVED_PERMISSION_ROLES = ['Admin', 'Developer'];
    protected const BUILT_IN_PERMISSION_ROLES = ['Employee'];
    protected const ROLE_PERMISSION_KEYS = [
        'dashboard.viewAdmin',
        'dashboard.viewEmployee',
        'orders.view',
        'orders.create',
        'orders.editOwn',
        'orders.editAny',
        'orders.deleteOwn',
        'orders.deleteAny',
        'orders.cancelOwn',
        'orders.cancelAny',
        'orders.moveOnHoldToProcessingOwn',
        'orders.moveOnHoldToProcessingAny',
        'orders.sendToCourierOwn',
        'orders.sendToCourierAny',
        'orders.moveToPickedOwn',
        'orders.moveToPickedAny',
        'orders.markCompletedOwn',
        'orders.markCompletedAny',
        'orders.markReturnedOwn',
        'orders.markReturnedAny',
        'orders.processReturnExchangeOwn',
        'orders.processReturnExchangeAny',
        'customers.view',
        'customers.create',
        'customers.edit',
        'customers.delete',
        'bills.view',
        'bills.create',
        'bills.editOwn',
        'bills.editAny',
        'bills.deleteOwn',
        'bills.deleteAny',
        'bills.cancelOwn',
        'bills.cancelAny',
        'bills.moveOnHoldToProcessingOwn',
        'bills.moveOnHoldToProcessingAny',
        'bills.markReceivedOwn',
        'bills.markReceivedAny',
        'bills.markPaidOwn',
        'bills.markPaidAny',
        'bills.processReturnOwn',
        'bills.processReturnAny',
        'transactions.view',
        'transactions.create',
        'transactions.edit',
        'transactions.delete',
        'vendors.view',
        'vendors.create',
        'vendors.edit',
        'vendors.delete',
        'products.view',
        'products.create',
        'products.edit',
        'products.delete',
        'accounts.view',
        'accounts.create',
        'accounts.edit',
        'accounts.delete',
        'fraudChecker.check',
        'transfers.create',
        'reports.view',
        'wallet.view',
        'payroll.view',
        'recycleBin.view',
        'users.view',
    ];
    protected const DEFAULT_ROLE_PERMISSIONS = [
        'Employee' => [
            'dashboard.viewEmployee' => true,
            'orders.view' => true,
            'orders.create' => true,
            'orders.editOwn' => true,
            'customers.view' => true,
            'customers.create' => true,
            'customers.edit' => true,
            'products.view' => true,
            'wallet.view' => true,
        ],
    ];
    protected const LEGACY_SCOPED_PERMISSION_KEYS = [
        ['legacy' => 'orders.edit', 'own' => 'orders.editOwn', 'any' => 'orders.editAny'],
        ['legacy' => 'orders.delete', 'own' => 'orders.deleteOwn', 'any' => 'orders.deleteAny'],
        ['legacy' => 'orders.cancel', 'own' => 'orders.cancelOwn', 'any' => 'orders.cancelAny'],
        [
            'legacy' => 'orders.moveOnHoldToProcessing',
            'own' => 'orders.moveOnHoldToProcessingOwn',
            'any' => 'orders.moveOnHoldToProcessingAny',
        ],
        ['legacy' => 'orders.sendToCourier', 'own' => 'orders.sendToCourierOwn', 'any' => 'orders.sendToCourierAny'],
        ['legacy' => 'orders.moveToPicked', 'own' => 'orders.moveToPickedOwn', 'any' => 'orders.moveToPickedAny'],
        ['legacy' => 'orders.markCompleted', 'own' => 'orders.markCompletedOwn', 'any' => 'orders.markCompletedAny'],
        ['legacy' => 'orders.markReturned', 'own' => 'orders.markReturnedOwn', 'any' => 'orders.markReturnedAny'],
        ['legacy' => 'bills.edit', 'own' => 'bills.editOwn', 'any' => 'bills.editAny'],
        ['legacy' => 'bills.delete', 'own' => 'bills.deleteOwn', 'any' => 'bills.deleteAny'],
        ['legacy' => 'bills.cancel', 'own' => 'bills.cancelOwn', 'any' => 'bills.cancelAny'],
        [
            'legacy' => 'bills.moveOnHoldToProcessing',
            'own' => 'bills.moveOnHoldToProcessingOwn',
            'any' => 'bills.moveOnHoldToProcessingAny',
        ],
        ['legacy' => 'bills.markReceived', 'own' => 'bills.markReceivedOwn', 'any' => 'bills.markReceivedAny'],
        ['legacy' => 'bills.markPaid', 'own' => 'bills.markPaidOwn', 'any' => 'bills.markPaidAny'],
        [
            'legacy' => 'orders.processReturnExchange',
            'own' => 'orders.processReturnExchangeOwn',
            'any' => 'orders.processReturnExchangeAny',
        ],
        [
            'legacy' => 'bills.processReturn',
            'own' => 'bills.processReturnOwn',
            'any' => 'bills.processReturnAny',
        ],
    ];

    protected Database $database;
    protected Auth $auth;
    protected Config $config;
    private ?ServiceLifecycle $serviceLifecycleInstance = null;
    /** @var array<string, bool> */
    private array $tableExistsCache = [];
    /** @var array<string, bool> */
    private array $columnExistsCache = [];
    /** @var array<string, mixed>|null */
    protected ?array $permissionsSettingsPayloadCache = null;

    public function __construct(Database $database, Auth $auth, Config $config)
    {
        $this->database = $database;
        $this->auth = $auth;
        $this->config = $config;
    }

    protected function currentUser(): array
    {
        return $this->auth->requireUser();
    }

    protected function serviceLifecycle(): ServiceLifecycle
    {
        if (!$this->serviceLifecycleInstance instanceof ServiceLifecycle) {
            $this->serviceLifecycleInstance = new ServiceLifecycle($this->database, $this->config);
        }

        return $this->serviceLifecycleInstance;
    }

    protected function requireAdmin(): array
    {
        return $this->auth->requireAdmin();
    }

    /**
     * @param array<int, string> $values
     * @return array{0: array<int, string>, 1: array<string, string>}
     */
    protected function inClause(array $values, string $prefix): array
    {
        $placeholders = [];
        $bindings = [];
        foreach (array_values($values) as $index => $value) {
            $name = ':' . $prefix . '_' . $index;
            $placeholders[] = $name;
            $bindings[$name] = $value;
        }

        return [$placeholders, $bindings];
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     * @return array<string, array<string, mixed>>
     */
    protected function keyBy(array $rows, string $column): array
    {
        $map = [];
        foreach ($rows as $row) {
            $key = (string) ($row[$column] ?? '');
            if ($key !== '') {
                $map[$key] = $row;
            }
        }

        return $map;
    }

    protected function stringId($value): string
    {
        $string = trim((string) ($value ?? ''));
        if ($string !== '') {
            return $string;
        }

        return $this->uuid4();
    }

    protected function uuid4(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);

        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }

    protected function normalizeDateOnly(string $value): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return '';
        }

        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $trimmed) === 1) {
            return $trimmed;
        }

        $timestamp = strtotime($trimmed);
        return $timestamp === false ? '' : gmdate('Y-m-d', $timestamp);
    }

    protected function normalizeUploadedFileValue(?string $value, string $category, ?string $originalFileName = null): ?string
    {
        $trimmed = trim((string) ($value ?? ''));
        if ($trimmed === '') {
            return null;
        }

        if (!$this->isDataUrl($trimmed)) {
            return $trimmed;
        }

        return $this->saveUploadedFileFromDataUrl($trimmed, $category, $originalFileName);
    }

    protected function isDataUrl(string $value): bool
    {
        return preg_match('/^\s*data:[^;]+;base64,/', $value) === 1;
    }

    protected function decodeDataUrl(string $value): ?array
    {
        if (!preg_match('/^\s*data:([^;]+);base64,(.+)$/i', trim($value), $matches)) {
            return null;
        }

        $mimeType = strtolower(trim($matches[1]));
        $payload = preg_replace('/\s+/', '', $matches[2]);
        $decoded = base64_decode($payload, true);
        if ($decoded === false) {
            return null;
        }

        return [$mimeType, $decoded];
    }

    protected function saveUploadedFileFromDataUrl(string $dataUrl, string $category, ?string $originalFileName = null): string
    {
        $decoded = $this->decodeDataUrl($dataUrl);
        if ($decoded === null) {
            return trim($dataUrl);
        }

        [$mimeType, $data] = $decoded;
        $uploadDir = $this->uploadPublicPath($category);
        if (!is_dir($uploadDir) && !mkdir($uploadDir, 0755, true) && !is_dir($uploadDir)) {
            throw new \RuntimeException(sprintf('Failed to create upload directory: %s', $uploadDir));
        }

        $fileName = $this->uniqueUploadFilename($this->extensionFromMimeType($mimeType, $originalFileName), $originalFileName);
        $targetPath = $uploadDir . DIRECTORY_SEPARATOR . $fileName;

        if ($this->isImageMimeType($mimeType)) {
            $webpFileName = $this->uniqueUploadFilename('webp', $originalFileName);
            $webpTargetPath = $uploadDir . DIRECTORY_SEPARATOR . $webpFileName;
            if ($this->saveImageAsWebp($data, $webpTargetPath)) {
                return '/uploads/' . trim($category, '/') . '/' . $webpFileName;
            }
        }

        if (file_put_contents($targetPath, $data) === false) {
            throw new \RuntimeException(sprintf('Failed to save uploaded file to %s', $targetPath));
        }

        return '/uploads/' . trim($category, '/') . '/' . $fileName;
    }

    protected function uploadPublicPath(string $category): string
    {
        // Save uploads to the web-accessible uploads directory.
        // Resolution order:
        //   1. {project_root}/public/uploads/{category}/  — local dev (Vite serves public/ at root)
        //   2. {web_root}/public_html/uploads/{category}/ — cPanel deploy (Apache serves public_html/)
        //   3. {backend}/public/uploads/{category}/        — last resort fallback
        $projectRoot = dirname(dirname(__DIR__)); // backend/src → backend → project root
        $categoryPath = 'uploads' . DIRECTORY_SEPARATOR . trim($category, '/');

        // During an HTTP request, the active site's document root is authoritative for
        // absolute /uploads URLs. This also avoids writing a subdomain's files into a
        // parent public_html directory when updater paths are stale or too broad.
        $requestPublicRoot = $this->requestPublicRoot();
        if ($requestPublicRoot !== null) {
            return $requestPublicRoot . DIRECTORY_SEPARATOR . $categoryPath;
        }

        // Package releases publish to UPDATE_PUBLIC_ROOT; git releases publish to
        // UPDATE_DOCUMENT_ROOT. Prefer the path that matches the configured mode.
        $useGitUpdates = filter_var($this->config->get('UPDATE_USE_GIT', '0'), FILTER_VALIDATE_BOOLEAN);
        $configKeys = $useGitUpdates
            ? ['UPDATE_DOCUMENT_ROOT', 'UPDATE_PUBLIC_ROOT']
            : ['UPDATE_PUBLIC_ROOT', 'UPDATE_DOCUMENT_ROOT'];
        foreach ($configKeys as $configKey) {
            $configuredRoot = trim((string) $this->config->get($configKey, ''));
            if ($configuredRoot !== '' && is_dir($configuredRoot)) {
                return rtrim($configuredRoot, '/\\') . DIRECTORY_SEPARATOR . $categoryPath;
            }
        }

        // 1. Local dev: project_root/public/uploads/
        $publicDir = $projectRoot . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . $categoryPath;
        if (is_dir(dirname($publicDir)) || is_dir($projectRoot . DIRECTORY_SEPARATOR . 'public')) {
            return $publicDir;
        }

        $serverDocumentRoot = trim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''));
        if ($serverDocumentRoot !== '' && is_dir($serverDocumentRoot)) {
            return rtrim($serverDocumentRoot, '/\\') . DIRECTORY_SEPARATOR . $categoryPath;
        }

        // 2. cPanel deploy: walk up from project root to find public_html/
        //    Typical layout: /home/user/public_html/mamepilot_backend/backend/...
        //    The web root is /home/user/public_html/
        $checkDir = $projectRoot;
        for ($i = 0; $i < 5; $i++) {
            if (strtolower(basename($checkDir)) === 'public_html' && is_dir($checkDir)) {
                return $checkDir . DIRECTORY_SEPARATOR . $categoryPath;
            }

            $candidate = $checkDir . DIRECTORY_SEPARATOR . 'public_html';
            if (is_dir($candidate) && (is_file($candidate . DIRECTORY_SEPARATOR . '.htaccess') || is_file($candidate . DIRECTORY_SEPARATOR . 'index.html'))) {
                return $candidate . DIRECTORY_SEPARATOR . $categoryPath;
            }
            $parent = dirname($checkDir);
            if ($parent === $checkDir) {
                break;
            }
            $checkDir = $parent;
        }

        // 3. Fallback: backend/public/uploads/
        return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . $categoryPath;
    }

    protected function ensurePublicUploadedFileValue(string $value): string
    {
        $trimmed = trim($value);
        if (preg_match('#^/uploads/([a-zA-Z0-9_-]+)/([a-zA-Z0-9_.-]+)$#', $trimmed, $matches) !== 1) {
            return $trimmed;
        }

        $targetDirectory = $this->uploadPublicPath($matches[1]);
        $targetPath = $targetDirectory . DIRECTORY_SEPARATOR . $matches[2];
        if (is_file($targetPath)) {
            return $trimmed;
        }

        // Recover files saved by older deployments under backend/public/uploads.
        $legacyDirectories = [
            dirname(__DIR__) . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . $matches[1],
            dirname(dirname(__DIR__)) . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'uploads' . DIRECTORY_SEPARATOR . $matches[1],
        ];
        foreach (array_unique($legacyDirectories) as $legacyDirectory) {
            $legacyPath = $legacyDirectory . DIRECTORY_SEPARATOR . $matches[2];
            if (!is_file($legacyPath) || $legacyPath === $targetPath) {
                continue;
            }

            if (!is_dir($targetDirectory) && !mkdir($targetDirectory, 0755, true) && !is_dir($targetDirectory)) {
                return $trimmed;
            }

            if (@copy($legacyPath, $targetPath)) {
                break;
            }
        }

        return $trimmed;
    }

    private function requestPublicRoot(): ?string
    {
        // The PHP development server handles API calls from backend/public while Vite
        // serves the frontend's public directory, so its document root is intentionally
        // ignored here and the local-project branch below remains in control.
        if (PHP_SAPI === 'cli' || PHP_SAPI === 'cli-server') {
            return null;
        }

        $scriptFilename = trim((string) ($_SERVER['SCRIPT_FILENAME'] ?? ''));
        if ($scriptFilename !== '' && strtolower(basename(dirname($scriptFilename))) === 'api') {
            $gatewayRoot = dirname(dirname($scriptFilename));
            if (is_dir($gatewayRoot)) {
                return rtrim($gatewayRoot, '/\\');
            }
        }

        $serverDocumentRoot = trim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''));
        if ($serverDocumentRoot !== '' && is_dir($serverDocumentRoot)) {
            return rtrim($serverDocumentRoot, '/\\');
        }

        return null;
    }

    protected function uniqueUploadFilename(string $extension, ?string $originalFileName = null): string
    {
        $baseName = $this->sanitizeFileName(pathinfo((string) ($originalFileName ?? ''), PATHINFO_FILENAME));
        if ($baseName === '') {
            $baseName = $this->uuid4();
        }

        return sprintf('%s-%s.%s', $baseName, bin2hex(random_bytes(4)), $extension);
    }

    protected function extensionFromMimeType(string $mimeType, ?string $originalFileName = null): string
    {
        $extensionMap = [
            'image/jpeg' => 'jpg',
            'image/pjpeg' => 'jpg',
            'image/png' => 'png',
            'image/gif' => 'gif',
            'image/webp' => 'webp',
            'image/svg+xml' => 'svg',
            'application/pdf' => 'pdf',
            'text/plain' => 'txt',
            'application/msword' => 'doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document' => 'docx',
            'application/vnd.ms-excel' => 'xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' => 'xlsx',
            'application/zip' => 'zip',
            'application/octet-stream' => 'bin',
        ];

        if (isset($extensionMap[$mimeType])) {
            return $extensionMap[$mimeType];
        }

        $originalExtension = strtolower(pathinfo((string) ($originalFileName ?? ''), PATHINFO_EXTENSION));
        if ($originalExtension !== '' && preg_match('/^[a-z0-9]+$/', $originalExtension) === 1) {
            return $originalExtension;
        }

        $parts = explode('/', $mimeType, 2);
        if (count($parts) === 2 && preg_match('/^[a-z0-9]+$/', $parts[1]) === 1) {
            return $parts[1];
        }

        return 'bin';
    }

    protected function sanitizeFileName(string $fileName): string
    {
        $fileName = preg_replace('/[^a-zA-Z0-9-_\.]/', '_', $fileName) ?: '';
        return trim($fileName, '._-');
    }

    protected function saveImageAsWebp(string $data, string $targetPath): bool
    {
        if (function_exists('imagecreatefromstring') && function_exists('imagewebp')) {
            $image = @imagecreatefromstring($data);
            if ($image !== false) {
                $result = imagewebp($image, $targetPath, 85);
                imagedestroy($image);
                return $result !== false;
            }
        }

        if (class_exists('\Imagick')) {
            try {
                $imagick = new \Imagick();
                $imagick->readImageBlob($data);
                $imagick->setImageFormat('webp');
                $imagick->setOption('webp:lossless', 'false');
                $imagick->setImageCompressionQuality(85);
                $result = $imagick->writeImage($targetPath);
                $imagick->clear();
                $imagick->destroy();
                return $result;
            } catch (\ImagickException $exception) {
                // Fallback to raw save below if conversion fails.
            }
        }

        return false;
    }

    protected function isImageMimeType(string $mimeType): bool
    {
        return str_starts_with($mimeType, 'image/');
    }

    protected function utcTimezone(): \DateTimeZone
    {
        static $timezone = null;
        if (!$timezone instanceof \DateTimeZone) {
            $timezone = new \DateTimeZone('UTC');
        }

        return $timezone;
    }

    protected function parseDateTimeValue(string $value, ?\DateTimeZone $naiveTimezone = null): ?\DateTimeImmutable
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return null;
        }

        $timezone = $naiveTimezone ?? $this->utcTimezone();

        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $trimmed) === 1) {
            $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $trimmed, $timezone);
            return $date instanceof \DateTimeImmutable ? $date : null;
        }

        if (preg_match('/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/', $trimmed) === 1) {
            $normalized = str_replace('T', ' ', $trimmed);
            $format = str_contains($normalized, '.') ? 'Y-m-d H:i:s.u' : 'Y-m-d H:i:s';
            $date = \DateTimeImmutable::createFromFormat($format, $normalized, $timezone);
            return $date instanceof \DateTimeImmutable ? $date : null;
        }

        try {
            return new \DateTimeImmutable($trimmed);
        } catch (\Exception) {
            return null;
        }
    }

    protected function normalizeDateTimeInput(string $value): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return $this->database->nowUtc();
        }

        $dateTime = $this->parseDateTimeValue($trimmed, $this->utcTimezone());
        return $dateTime instanceof \DateTimeImmutable
            ? $dateTime->setTimezone($this->utcTimezone())->format('Y-m-d H:i:s')
            : $this->database->nowUtc();
    }

    protected function normalizeDateTimeInputWithCurrentLocalTime(string $value): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return $this->database->nowUtc();
        }

        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $trimmed) === 1) {
            $localTimezone = new \DateTimeZone($this->config->timezone());
            $utcTimezone = new \DateTimeZone('UTC');
            $localNow = new \DateTimeImmutable('now', $localTimezone);
            $localDateTime = \DateTimeImmutable::createFromFormat(
                'Y-m-d H:i:s',
                $trimmed . ' ' . $localNow->format('H:i:s'),
                $localTimezone
            );

            if ($localDateTime instanceof \DateTimeImmutable) {
                return $localDateTime->setTimezone($utcTimezone)->format('Y-m-d H:i:s');
            }
        }

        return $this->normalizeDateTimeInput($trimmed);
    }

    protected function toIso(?string $value): ?string
    {
        $trimmed = trim((string) ($value ?? ''));
        if ($trimmed === '') {
            return null;
        }

        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $trimmed) === 1) {
            return $trimmed;
        }

        $dateTime = $this->parseDateTimeValue($trimmed, $this->utcTimezone());
        return $dateTime instanceof \DateTimeImmutable
            ? $dateTime->setTimezone($this->utcTimezone())->format('Y-m-d\TH:i:s\Z')
            : $trimmed;
    }

    /**
     * @param mixed $value
     */
    protected function money($value): float
    {
        return round((float) $value, 2);
    }

    protected function formatMoney($value): string
    {
        return number_format((float) $value, 2, '.', '');
    }

    /**
     * @param mixed $value
     */
    protected function nullableTrimmedString($value): ?string
    {
        $string = trim((string) ($value ?? ''));
        return $string === '' ? null : $string;
    }

    /**
     * @param mixed $value
     */
    protected function nullableString($value): ?string
    {
        if ($value === null) {
            return null;
        }

        $string = (string) $value;
        return $string === '' ? null : $string;
    }

    /**
     * @param mixed $value
     */
    protected function jsonEncode($value): ?string
    {
        if ($value === null) {
            return null;
        }

        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * @param mixed $value
     * @return array<int, mixed>
     */
    protected function jsonDecodeList($value): array
    {
        if (is_array($value)) {
            return array_values($value);
        }

        if ($value === null || trim((string) $value) === '') {
            return [];
        }

        $decoded = json_decode((string) $value, true);
        return is_array($decoded) ? array_values($decoded) : [];
    }

    /**
     * @param mixed $value
     * @return array<string, mixed>
     */
    protected function jsonDecodeAssoc($value): array
    {
        if (is_array($value)) {
            return $value;
        }

        if ($value === null || trim((string) $value) === '') {
            return [];
        }

        $decoded = json_decode((string) $value, true);
        return is_array($decoded) ? $decoded : [];
    }

    /**
     * @param array<string, mixed> $updates
     */
    protected function touchUpdate(string $table, string $id, array $updates): void
    {
        if ($updates === []) {
            return;
        }

        $updates['updated_at'] = $this->database->nowUtc();
        [$setClause, $bindings] = $this->database->buildSetClause($updates);
        $bindings[':id'] = $id;
        $this->database->execute("UPDATE {$table} SET {$setClause} WHERE id = :id", $bindings);
    }

    protected function softDelete(string $table, string $id): void
    {
        $actor = $this->currentUser();
        $deletedAt = $this->database->nowUtc();
        $this->database->execute(
            "UPDATE {$table} SET deleted_at = :deleted_at, deleted_by = :deleted_by, updated_at = :updated_at WHERE id = :id AND deleted_at IS NULL",
            [
                ':deleted_at' => $deletedAt,
                ':deleted_by' => (string) $actor['id'],
                ':updated_at' => $deletedAt,
                ':id' => $id,
            ]
        );
    }

    protected function restoreSoftDeletedRow(string $table, string $id): void
    {
        $this->database->execute(
            "UPDATE {$table} SET deleted_at = NULL, deleted_by = NULL, updated_at = :updated_at WHERE id = :id AND deleted_at IS NOT NULL",
            [
                ':updated_at' => $this->database->nowUtc(),
                ':id' => $id,
            ]
        );
    }

    protected function permanentlyDeleteSoftDeletedRow(string $table, string $id): void
    {
        $this->database->execute(
            "DELETE FROM {$table} WHERE id = :id AND deleted_at IS NOT NULL",
            [':id' => $id]
        );
    }

    protected function saveSingleton(string $table, string $id, array $updates, callable $resolver): array
    {
        $row = $this->database->fetchOne("SELECT id FROM {$table} LIMIT 1");
        $existingId = (string) ($row['id'] ?? $id);
        $filtered = [];

        foreach ($updates as $column => $value) {
            if ($value !== null) {
                $filtered[$column] = is_string($value) ? trim($value) : $value;
            }
        }

        if ($row !== null) {
            $this->touchUpdate($table, $existingId, $filtered);
            return $resolver();
        }

        $filtered['id'] = $existingId;
        $filtered['created_at'] = $this->database->nowUtc();
        $filtered['updated_at'] = $this->database->nowUtc();
        $columns = implode(', ', array_keys($filtered));
        $placeholders = implode(', ', array_map(static fn(string $column): string => ':' . $column, array_keys($filtered)));
        $bindings = [];
        foreach ($filtered as $column => $value) {
            $bindings[':' . $column] = $value;
        }
        $this->database->execute("INSERT INTO {$table} ({$columns}) VALUES ({$placeholders})", $bindings);
        return $resolver();
    }

    /**
     * @param array<string, mixed> $fallback
     * @return array<string, mixed>
     */
    protected function normalizeCompanyPage($value, int $index = 0, array $fallback = []): array
    {
        $page = is_array($value) ? $value : [];
        $fallbackName = trim((string) ($fallback['name'] ?? '')) ?: ($index === 0 ? 'Mame Pilot' : 'Page ' . ($index + 1));
        $id = trim((string) ($page['id'] ?? $fallback['id'] ?? ''));

        if ($id === '') {
            $id = $index === 0 ? 'company-default-page' : 'company-page-' . ($index + 1);
        }

        return [
            'id' => $id,
            'name' => trim((string) ($page['name'] ?? $fallback['name'] ?? '')) ?: $fallbackName,
            'logo' => $this->normalizeUploadedFileValue($page['logo'] ?? $fallback['logo'] ?? null, 'logos', null) ?? '',
            'phone' => (string) ($page['phone'] ?? $fallback['phone'] ?? '+880'),
            'email' => (string) ($page['email'] ?? $fallback['email'] ?? 'info@company.com'),
            'address' => (string) ($page['address'] ?? $fallback['address'] ?? ''),
            'isGlobalBranding' => (bool) ($page['isGlobalBranding'] ?? $page['is_global_branding'] ?? $fallback['isGlobalBranding'] ?? $fallback['is_global_branding'] ?? false),
        ];
    }

    /**
     * @param array<string, mixed> $legacyRow
     * @return array<int, array<string, mixed>>
     */
    protected function normalizeCompanyPages($value, array $legacyRow = []): array
    {
        $fallbackPage = $this->normalizeCompanyPage(
            [
                'id' => $legacyRow['id'] ?? 'company-default-page',
                'name' => $legacyRow['name'] ?? 'Mame Pilot',
                'logo' => $legacyRow['logo'] ?? '/uploads/Avatar.png',
                'phone' => $legacyRow['phone'] ?? '+880',
                'email' => $legacyRow['email'] ?? 'info@company.com',
                'address' => $legacyRow['address'] ?? '',
                'isGlobalBranding' => true,
            ],
            0
        );

        $rawPages = $this->jsonDecodeList($value);
        $pages = [];

        foreach ($rawPages as $index => $page) {
            if (!is_array($page)) {
                continue;
            }

            $pages[] = $this->normalizeCompanyPage($page, $index, $index === 0 ? $fallbackPage : []);
        }

        if ($pages === []) {
            $pages[] = $fallbackPage;
        }

        $foundGlobal = false;
        foreach ($pages as $index => $page) {
            $isGlobal = (bool) ($page['isGlobalBranding'] ?? false) && !$foundGlobal;
            if ($isGlobal) {
                $foundGlobal = true;
            }
            $pages[$index]['isGlobalBranding'] = $isGlobal;
        }

        if (!$foundGlobal && isset($pages[0])) {
            $pages[0]['isGlobalBranding'] = true;
        }

        return array_values($pages);
    }

    /**
     * @param array<int, array<string, mixed>> $pages
     * @return array<string, mixed>
     */
    protected function getGlobalCompanyPage(array $pages): array
    {
        foreach ($pages as $index => $page) {
            if (!is_array($page)) {
                continue;
            }

            if ((bool) ($page['isGlobalBranding'] ?? false)) {
                return $this->normalizeCompanyPage($page, $index);
            }
        }

        return isset($pages[0]) && is_array($pages[0])
            ? $this->normalizeCompanyPage($pages[0], 0)
            : $this->normalizeCompanyPage([], 0);
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapCustomer(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'name' => (string) ($row['name'] ?? ''),
            'phone' => (string) ($row['phone'] ?? ''),
            'address' => (string) ($row['address'] ?? ''),
            'totalOrders' => (int) ($row['total_orders'] ?? 0),
            'dueAmount' => (float) ($row['due_amount'] ?? 0),
            'createdBy' => $this->nullableString($row['created_by'] ?? null),
            'createdAt' => $this->toIso($row['created_at'] ?? null),
            'deletedAt' => $this->toIso($row['deleted_at'] ?? null),
            'deletedBy' => $this->nullableString($row['deleted_by'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapVendor(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'name' => (string) ($row['name'] ?? ''),
            'phone' => (string) ($row['phone'] ?? ''),
            'address' => (string) ($row['address'] ?? ''),
            'totalPurchases' => (int) ($row['total_purchases'] ?? 0),
            'dueAmount' => (float) ($row['due_amount'] ?? 0),
            'createdBy' => $this->nullableString($row['created_by'] ?? null),
            'createdAt' => $this->toIso($row['created_at'] ?? null),
            'deletedAt' => $this->toIso($row['deleted_at'] ?? null),
            'deletedBy' => $this->nullableString($row['deleted_by'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapProduct(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'name' => (string) ($row['name'] ?? ''),
            'image' => $this->ensurePublicUploadedFileValue((string) ($row['image'] ?? '')),
            'category' => (string) ($row['category'] ?? ''),
            'unitId' => $this->nullableString($row['unit_id'] ?? null),
            'salePrice' => (float) ($row['sale_price'] ?? $row['salePrice'] ?? 0),
            'purchasePrice' => (float) ($row['purchase_price'] ?? $row['purchasePrice'] ?? 0),
            'stock' => (int) ($row['stock'] ?? 0),
            'dynamicPricing' => $this->nullableString($row['dynamic_pricing'] ?? null),
            'createdBy' => $this->nullableString($row['created_by'] ?? null),
            'createdAt' => $this->toIso($row['created_at'] ?? null),
            'deletedAt' => $this->toIso($row['deleted_at'] ?? null),
            'deletedBy' => $this->nullableString($row['deleted_by'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapAccount(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'name' => (string) ($row['name'] ?? ''),
            'type' => (string) ($row['type'] ?? 'Bank'),
            'openingBalance' => (float) ($row['opening_balance'] ?? 0),
            'currentBalance' => (float) ($row['current_balance'] ?? 0),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapUser(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'name' => (string) ($row['name'] ?? ''),
            'phone' => (string) ($row['phone'] ?? ''),
            'role' => (string) ($row['role'] ?? ''),
            'image' => (string) ($row['image'] ?? ''),
            'email' => $this->nullableString($row['email'] ?? null),
            'address' => $this->nullableString($row['address'] ?? null),
            'birthday' => $this->nullableString($row['birthday'] ?? null),
            'nidPassportCopy' => $this->nullableString($row['nid_passport_copy'] ?? $row['nidPassportCopy'] ?? null),
            'gender' => $this->nullableString($row['gender'] ?? null),
            'bloodGroup' => $this->nullableString($row['blood_group'] ?? $row['bloodGroup'] ?? null),
            'nationality' => $this->nullableString($row['nationality'] ?? null),
            'cv' => $this->nullableString($row['cv'] ?? null),
            'isCommissionBased' => !empty($row['is_commission_based'] ?? $row['isCommissionBased'] ?? false),
            'fixedSalary' => isset($row['fixed_salary']) || isset($row['fixedSalary'])
                ? (float) ($row['fixed_salary'] ?? $row['fixedSalary'] ?? 0)
                : null,
            'createdAt' => $this->toIso($row['created_at'] ?? null),
            'deletedAt' => $this->toIso($row['deleted_at'] ?? null),
            'deletedBy' => $this->nullableString($row['deleted_by'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapOrder(array $row): array
    {
        $pageSnapshot = $this->jsonDecodeAssoc($row['page_snapshot'] ?? $row['pageSnapshot'] ?? []);

        return [
            'id' => (string) $row['id'],
            'orderNumber' => (string) ($row['order_number'] ?? $row['orderNumber'] ?? ''),
            'orderDate' => (string) ($row['order_date'] ?? $row['orderDate'] ?? ''),
            'customerId' => (string) ($row['customer_id'] ?? $row['customerId'] ?? ''),
            'createdBy' => (string) ($row['created_by'] ?? $row['createdBy'] ?? ''),
            'status' => (string) ($row['status'] ?? ''),
            'items' => $this->jsonDecodeList($row['items'] ?? []),
            'subtotal' => (float) ($row['subtotal'] ?? 0),
            'discount' => (float) ($row['discount'] ?? 0),
            'shipping' => (float) ($row['shipping'] ?? 0),
            'total' => (float) ($row['total'] ?? $row['amount'] ?? 0),
            'notes' => $this->nullableString($row['notes'] ?? null),
            'pageId' => $this->nullableString($row['page_id'] ?? $row['pageId'] ?? null),
            'pageSnapshot' => $pageSnapshot !== [] ? $pageSnapshot : null,
            'carrybeeConsignmentId' => $this->nullableString($row['carrybee_consignment_id'] ?? $row['carrybeeConsignmentId'] ?? null),
            'steadfastConsignmentId' => $this->nullableString($row['steadfast_consignment_id'] ?? $row['steadfastConsignmentId'] ?? null),
            'paperflyTrackingNumber' => $this->nullableString($row['paperfly_tracking_number'] ?? $row['paperflyTrackingNumber'] ?? null),
            'pathaoConsignmentId' => $this->nullableString($row['pathao_consignment_id'] ?? $row['pathaoConsignmentId'] ?? null),
            'exchangeCourier' => $this->nullableString($row['exchange_courier'] ?? $row['exchangeCourier'] ?? null),
            'exchangeSteadfastConsignmentId' => $this->nullableString($row['exchange_steadfast_consignment_id'] ?? $row['exchangeSteadfastConsignmentId'] ?? null),
            'exchangeCarrybeeConsignmentId' => $this->nullableString($row['exchange_carrybee_consignment_id'] ?? $row['exchangeCarrybeeConsignmentId'] ?? null),
            'exchangePaperflyTrackingNumber' => $this->nullableString($row['exchange_paperfly_tracking_number'] ?? $row['exchangePaperflyTrackingNumber'] ?? null),
            'exchangePathaoConsignmentId' => $this->nullableString($row['exchange_pathao_consignment_id'] ?? $row['exchangePathaoConsignmentId'] ?? null),
            'exchangeCourierHistory' => $this->nullableString($row['exchange_courier_history'] ?? $row['exchangeCourierHistory'] ?? null),
            'sourceAd' => $this->nullableString($row['source_ad'] ?? $row['sourceAd'] ?? null),
            'history' => $this->jsonDecodeAssoc($row['history'] ?? []),
            'paidAmount' => (float) ($row['paid_amount'] ?? $row['paidAmount'] ?? 0),
            'customerName' => $this->nullableString($row['customer_name'] ?? $row['customerName'] ?? null),
            'customerPhone' => $this->nullableString($row['customer_phone'] ?? $row['customerPhone'] ?? null),
            'customerAddress' => $this->nullableString($row['customer_address'] ?? $row['customerAddress'] ?? null),
            'creatorName' => $this->nullableString($row['creator_name'] ?? $row['creatorName'] ?? null),
            'pendingTransactionCount' => (int) ($row['pending_transaction_count'] ?? $row['pendingTransactionCount'] ?? 0),
            'pendingTransactionIds' => $this->jsonDecodeList($row['pending_transaction_ids'] ?? $row['pendingTransactionIds'] ?? []),
            'createdAt' => $this->toIso($row['created_at'] ?? $row['createdAt'] ?? null),
            'deletedAt' => $this->toIso($row['deleted_at'] ?? $row['deletedAt'] ?? null),
            'deletedBy' => $this->nullableString($row['deleted_by'] ?? $row['deletedBy'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapBill(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'billNumber' => (string) ($row['bill_number'] ?? $row['billNumber'] ?? ''),
            'billDate' => (string) ($row['bill_date'] ?? $row['billDate'] ?? ''),
            'vendorId' => (string) ($row['vendor_id'] ?? $row['vendorId'] ?? ''),
            'createdBy' => (string) ($row['created_by'] ?? $row['createdBy'] ?? ''),
            'status' => (string) ($row['status'] ?? ''),
            'items' => $this->jsonDecodeList($row['items'] ?? []),
            'subtotal' => (float) ($row['subtotal'] ?? 0),
            'discount' => (float) ($row['discount'] ?? 0),
            'shipping' => (float) ($row['shipping'] ?? 0),
            'total' => (float) ($row['total'] ?? 0),
            'notes' => $this->nullableString($row['notes'] ?? null),
            'paidAmount' => (float) ($row['paid_amount'] ?? $row['paidAmount'] ?? 0),
            'history' => $this->jsonDecodeAssoc($row['history'] ?? []),
            'vendorName' => $this->nullableString($row['vendor_name'] ?? $row['vendorName'] ?? null),
            'vendorPhone' => $this->nullableString($row['vendor_phone'] ?? $row['vendorPhone'] ?? null),
            'vendorAddress' => $this->nullableString($row['vendor_address'] ?? $row['vendorAddress'] ?? null),
            'creatorName' => $this->nullableString($row['creator_name'] ?? $row['creatorName'] ?? null),
            'createdAt' => $this->toIso($row['created_at'] ?? $row['createdAt'] ?? null),
            'deletedAt' => $this->toIso($row['deleted_at'] ?? $row['deletedAt'] ?? null),
            'deletedBy' => $this->nullableString($row['deleted_by'] ?? $row['deletedBy'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapTransaction(array $row): array
    {
        $dateValue = $row['date'] ?? $row['date_string'] ?? $row['created_at'] ?? $row['createdAt'] ?? null;

        return [
            'id' => (string) $row['id'],
            'date' => $this->toIso($dateValue) ?? (string) ($dateValue ?? ''),
            'type' => (string) ($row['type'] ?? ''),
            'category' => (string) ($row['category'] ?? ''),
            'accountId' => (string) ($row['account_id'] ?? $row['accountId'] ?? ''),
            'toAccountId' => $this->nullableString($row['to_account_id'] ?? $row['toAccountId'] ?? null),
            'amount' => (float) ($row['amount'] ?? 0),
            'description' => (string) ($row['description'] ?? ''),
            'referenceId' => $this->nullableString($row['reference_id'] ?? $row['referenceId'] ?? null),
            'contactId' => $this->nullableString($row['contact_id'] ?? $row['contactId'] ?? null),
            'paymentMethod' => (string) ($row['payment_method'] ?? $row['paymentMethod'] ?? ''),
            'attachmentName' => $this->nullableString($row['attachment_name'] ?? $row['attachmentName'] ?? null),
            'attachmentUrl' => $this->nullableString($row['attachment_url'] ?? $row['attachmentUrl'] ?? null),
            'createdBy' => (string) ($row['created_by'] ?? $row['createdBy'] ?? ''),
            'createdAt' => $this->toIso($row['created_at'] ?? $row['createdAt'] ?? null),
            'accountName' => $this->nullableString($row['account_name'] ?? $row['accountName'] ?? null),
            'contactName' => $this->nullableString($row['contact_name'] ?? $row['contactName'] ?? null),
            'contactType' => $this->nullableString($row['contact_type'] ?? $row['contactType'] ?? null),
            'creatorName' => $this->nullableString($row['creator_name'] ?? $row['creatorName'] ?? null),
            'approvalStatus' => (string) ($row['approval_status'] ?? $row['approvalStatus'] ?? 'approved'),
            'accountEffectApplied' => ((int) ($row['account_effect_applied'] ?? $row['accountEffectApplied'] ?? 1)) === 1,
            'approvalRequestedAt' => $this->toIso($row['approval_requested_at'] ?? $row['approvalRequestedAt'] ?? null),
            'approvedAt' => $this->toIso($row['approved_at'] ?? $row['approvedAt'] ?? null),
            'declinedAt' => $this->toIso($row['declined_at'] ?? $row['declinedAt'] ?? null),
            'approvalNote' => $this->nullableString($row['approval_note'] ?? $row['approvalNote'] ?? null),
            'deletedAt' => $this->toIso($row['deleted_at'] ?? $row['deletedAt'] ?? null),
            'deletedBy' => $this->nullableString($row['deleted_by'] ?? $row['deletedBy'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapCategory(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'name' => (string) ($row['name'] ?? ''),
            'type' => (string) ($row['type'] ?? ''),
            'color' => (string) ($row['color'] ?? '#3B82F6'),
            'isSystem' => (bool) ($row['is_system'] ?? $row['isSystem'] ?? false),
            'parentId' => $this->nullableString($row['parent_id'] ?? $row['parentId'] ?? null),
            'createdAt' => $this->toIso($row['created_at'] ?? $row['createdAt'] ?? null),
            'updatedAt' => $this->toIso($row['updated_at'] ?? $row['updatedAt'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapPaymentMethod(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'name' => (string) ($row['name'] ?? ''),
            'description' => $this->nullableString($row['description'] ?? null),
            'isActive' => (bool) ($row['is_active'] ?? $row['isActive'] ?? false),
            'createdAt' => $this->toIso($row['created_at'] ?? $row['createdAt'] ?? null),
            'updatedAt' => $this->toIso($row['updated_at'] ?? $row['updatedAt'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapUnit(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'name' => (string) ($row['name'] ?? ''),
            'shortName' => (string) ($row['short_name'] ?? $row['shortName'] ?? ''),
            'description' => $this->nullableString($row['description'] ?? null),
            'isFraction' => (bool) ($row['is_fraction'] ?? false),
            'createdAt' => $this->toIso($row['created_at'] ?? $row['createdAt'] ?? null),
            'updatedAt' => $this->toIso($row['updated_at'] ?? $row['updatedAt'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function defaultPayrollSettings(): array
    {
        return [
            'unitAmount' => 0.0,
            'countedStatuses' => self::DEFAULT_PAYROLL_STATUSES,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapPayrollSettings(array $row): array
    {
        return [
            'unitAmount' => (float) ($row['unit_amount'] ?? $row['unitAmount'] ?? 0),
            'countedStatuses' => $this->normalizePayrollStatuses(
                $this->jsonDecodeList($row['counted_statuses'] ?? $row['countedStatuses'] ?? []),
                true
            ),
        ];
    }

    /**
     * @param array<string, array<string, mixed>> $userMap
     * @return array<string, mixed>
     */
    protected function mapPayrollPayment(array $row, array $userMap = []): array
    {
        $employee = $userMap[(string) ($row['employee_id'] ?? '')] ?? null;
        $payer = $userMap[(string) ($row['paid_by'] ?? '')] ?? null;

        return [
            'id' => (string) $row['id'],
            'employeeId' => (string) ($row['employee_id'] ?? ''),
            'employeeName' => $this->nullableString($row['employee_name'] ?? ($employee['name'] ?? null)),
            'employeeRole' => $this->nullableString($row['employee_role'] ?? ($employee['role'] ?? null)),
            'periodStart' => (string) ($row['period_start'] ?? ''),
            'periodEnd' => (string) ($row['period_end'] ?? ''),
            'periodKind' => (string) ($row['period_kind'] ?? ''),
            'periodLabel' => (string) ($row['period_label'] ?? (($row['period_start'] ?? '') . ' - ' . ($row['period_end'] ?? ''))),
            'unitAmountSnapshot' => (float) ($row['unit_amount_snapshot'] ?? 0),
            'countedStatusesSnapshot' => $this->normalizePayrollStatuses(
                $this->jsonDecodeList($row['counted_statuses_snapshot'] ?? []),
                true
            ),
            'orderCountSnapshot' => (int) ($row['order_count_snapshot'] ?? 0),
            'amountSnapshot' => (float) ($row['amount_snapshot'] ?? 0),
            'paidAt' => $this->toIso($row['paid_at'] ?? null) ?? (string) ($row['paid_at'] ?? ''),
            'paidBy' => (string) ($row['paid_by'] ?? ''),
            'paidByName' => $this->nullableString($row['paid_by_name'] ?? ($payer['name'] ?? null)),
            'note' => $this->nullableString($row['note'] ?? null) ?? '',
            'createdAt' => $this->toIso($row['created_at'] ?? $row['createdAt'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapWalletBalanceCard(array $row): array
    {
        return [
            'employeeId' => (string) ($row['employee_id'] ?? $row['employeeId'] ?? ''),
            'employeeName' => (string) ($row['employee_name'] ?? $row['employeeName'] ?? 'Unknown Employee'),
            'employeeRole' => (string) ($row['employee_role'] ?? $row['employeeRole'] ?? 'Employee'),
            'currentBalance' => (float) ($row['current_balance'] ?? $row['currentBalance'] ?? 0),
            'totalEarned' => (float) ($row['total_earned'] ?? $row['totalEarned'] ?? 0),
            'totalPaid' => (float) ($row['total_paid'] ?? $row['totalPaid'] ?? 0),
            'creditedOrders' => (int) ($row['credited_orders'] ?? $row['creditedOrders'] ?? 0),
            'lastActivityAt' => $this->toIso($row['last_activity_at'] ?? $row['lastActivityAt'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapWalletActivityEntry(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'employeeId' => (string) ($row['employee_id'] ?? $row['employeeId'] ?? ''),
            'employeeName' => $this->nullableString($row['employee_name'] ?? $row['employeeName'] ?? null),
            'employeeRole' => $this->nullableString($row['employee_role'] ?? $row['employeeRole'] ?? null),
            'entryType' => (string) ($row['entry_type'] ?? $row['entryType'] ?? 'order_credit'),
            'amountDelta' => (float) ($row['amount_delta'] ?? $row['amountDelta'] ?? 0),
            'unitAmountSnapshot' => ($row['unit_amount_snapshot'] ?? $row['unitAmountSnapshot'] ?? null) !== null
                ? (float) ($row['unit_amount_snapshot'] ?? $row['unitAmountSnapshot'])
                : null,
            'orderId' => $this->nullableString($row['order_id'] ?? $row['orderId'] ?? null),
            'orderNumber' => $this->nullableString($row['order_number'] ?? $row['orderNumber'] ?? null),
            'payoutId' => $this->nullableString($row['payout_id'] ?? $row['payoutId'] ?? null),
            'transactionId' => $this->nullableString($row['transaction_id'] ?? $row['transactionId'] ?? null),
            'accountId' => $this->nullableString($row['account_id'] ?? $row['accountId'] ?? null),
            'accountName' => $this->nullableString($row['account_name'] ?? $row['accountName'] ?? null),
            'paymentMethod' => $this->nullableString($row['payment_method'] ?? $row['paymentMethod'] ?? null),
            'categoryId' => $this->nullableString($row['category_id'] ?? $row['categoryId'] ?? null),
            'categoryName' => $this->nullableString($row['category_name'] ?? $row['categoryName'] ?? null),
            'note' => $this->nullableString($row['note'] ?? null),
            'createdAt' => $this->toIso($row['created_at'] ?? $row['createdAt'] ?? null) ?? (string) ($row['created_at'] ?? ''),
            'createdBy' => $this->nullableString($row['created_by'] ?? $row['createdBy'] ?? null),
            'createdByName' => $this->nullableString($row['created_by_name'] ?? $row['createdByName'] ?? null),
            'paidAt' => $this->toIso($row['paid_at'] ?? $row['paidAt'] ?? null),
            'paidBy' => $this->nullableString($row['paid_by'] ?? $row['paidBy'] ?? null),
            'paidByName' => $this->nullableString($row['paid_by_name'] ?? $row['paidByName'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    protected function mapWalletPayout(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'employeeId' => (string) ($row['employee_id'] ?? $row['employeeId'] ?? ''),
            'amount' => (float) ($row['amount'] ?? 0),
            'accountId' => (string) ($row['account_id'] ?? $row['accountId'] ?? ''),
            'paymentMethod' => (string) ($row['payment_method'] ?? $row['paymentMethod'] ?? ''),
            'categoryId' => (string) ($row['category_id'] ?? $row['categoryId'] ?? ''),
            'transactionId' => (string) ($row['transaction_id'] ?? $row['transactionId'] ?? ''),
            'paidAt' => $this->toIso($row['paid_at'] ?? $row['paidAt'] ?? null) ?? (string) ($row['paid_at'] ?? ''),
            'paidBy' => (string) ($row['paid_by'] ?? $row['paidBy'] ?? ''),
            'paidByName' => $this->nullableString($row['paid_by_name'] ?? $row['paidByName'] ?? null),
            'note' => $this->nullableString($row['note'] ?? null),
        ];
    }

    protected function tableExists(string $table): bool
    {
        if (array_key_exists($table, $this->tableExistsCache)) {
            return $this->tableExistsCache[$table];
        }

        $row = $this->database->fetchOne(
            'SELECT 1 AS present
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = :table
             LIMIT 1',
            [':table' => $table]
        );

        $this->tableExistsCache[$table] = $row !== null;
        return $this->tableExistsCache[$table];
    }

    protected function columnExists(string $table, string $column): bool
    {
        $cacheKey = $table . '.' . $column;
        if (array_key_exists($cacheKey, $this->columnExistsCache)) {
            return $this->columnExistsCache[$cacheKey];
        }

        $row = $this->database->fetchOne(
            'SELECT 1 AS present
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = :table
               AND COLUMN_NAME = :column
             LIMIT 1',
            [
                ':table' => $table,
                ':column' => $column,
            ]
        );

        $this->columnExistsCache[$cacheKey] = $row !== null;
        return $this->columnExistsCache[$cacheKey];
    }

    protected function normalizeRoleName(string $role): string
    {
        $normalized = preg_replace('/\s+/', ' ', trim($role));
        return $normalized !== null ? trim($normalized) : trim($role);
    }

    protected function isReservedPermissionRole(string $role): bool
    {
        return in_array($this->normalizeRoleName($role), self::RESERVED_PERMISSION_ROLES, true);
    }

    protected function isBuiltInPermissionRole(string $role): bool
    {
        return in_array($this->normalizeRoleName($role), self::BUILT_IN_PERMISSION_ROLES, true);
    }

    protected function legacyPermissionGrantsAnyAccess(string $role): bool
    {
        return !$this->isBuiltInPermissionRole($role);
    }

    /**
     * @return array<string, bool>
     */
    protected function blankRolePermissions(): array
    {
        $permissions = [];
        foreach (self::ROLE_PERMISSION_KEYS as $key) {
            $permissions[$key] = false;
        }

        return $permissions;
    }

    /**
     * @return array<string, bool>
     */
    protected function allEnabledRolePermissions(): array
    {
        $permissions = [];
        foreach (self::ROLE_PERMISSION_KEYS as $key) {
            $permissions[$key] = true;
        }

        return $permissions;
    }

    /**
     * @return array<string, bool>
     */
    protected function defaultRolePermissions(string $role): array
    {
        $normalizedRole = $this->normalizeRoleName($role);
        if ($this->isReservedPermissionRole($normalizedRole)) {
            return $this->allEnabledRolePermissions();
        }

        $permissions = $this->blankRolePermissions();
        $defaults = self::DEFAULT_ROLE_PERMISSIONS[$normalizedRole] ?? [];
        foreach ($defaults as $key => $enabled) {
            if (in_array($key, self::ROLE_PERMISSION_KEYS, true)) {
                $permissions[$key] = (bool) $enabled;
            }
        }

        return $permissions;
    }

    /**
     * @param mixed $value
     * @param array<string, bool>|null $fallback
     * @return array<string, bool>
     */
    protected function normalizeRolePermissions($value, ?array $fallback = null, ?string $roleName = null): array
    {
        $raw = is_array($value) ? $value : $this->jsonDecodeAssoc($value);
        $permissions = $this->blankRolePermissions();
        $normalizedRole = $this->normalizeRoleName((string) ($roleName ?? ''));

        foreach (self::ROLE_PERMISSION_KEYS as $key) {
            if (array_key_exists($key, $raw)) {
                $permissions[$key] = (bool) $raw[$key];
                continue;
            }

            if ($fallback !== null && array_key_exists($key, $fallback)) {
                $permissions[$key] = (bool) $fallback[$key];
            }
        }

        foreach (self::LEGACY_SCOPED_PERMISSION_KEYS as $config) {
            $legacyKey = (string) ($config['legacy'] ?? '');
            $ownKey = (string) ($config['own'] ?? '');
            $anyKey = (string) ($config['any'] ?? '');

            if ($legacyKey === '' || !array_key_exists($legacyKey, $raw) || !is_bool($raw[$legacyKey])) {
                continue;
            }

            if ($ownKey !== '' && !array_key_exists($ownKey, $raw)) {
                $permissions[$ownKey] = (bool) $raw[$legacyKey];
            }

            if ($anyKey !== '' && !array_key_exists($anyKey, $raw)) {
                $permissions[$anyKey] = (bool) $raw[$legacyKey] && $this->legacyPermissionGrantsAnyAccess($normalizedRole);
            }
        }

        return $permissions;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    protected function fetchStoredRolePermissionRows(): array
    {
        if (!$this->tableExists('role_permissions')) {
            return [];
        }

        return $this->database->fetchAll(
            'SELECT role_name, permissions, is_custom, created_at, updated_at
             FROM role_permissions
             ORDER BY is_custom ASC, role_name ASC'
        );
    }

    /**
     * @return array<string, mixed>
     */
    protected function buildPermissionsSettingsPayload(): array
    {
        if ($this->permissionsSettingsPayloadCache !== null) {
            return $this->permissionsSettingsPayloadCache;
        }

        $rolesByName = [];

        foreach (self::BUILT_IN_PERMISSION_ROLES as $roleName) {
            $rolesByName[$roleName] = [
                'roleName' => $roleName,
                'isCustom' => false,
                'permissions' => $this->defaultRolePermissions($roleName),
                'createdAt' => null,
                'updatedAt' => null,
            ];
        }

        foreach ($this->fetchStoredRolePermissionRows() as $row) {
            $roleName = $this->normalizeRoleName((string) ($row['role_name'] ?? ''));
            if ($roleName === '' || $this->isReservedPermissionRole($roleName)) {
                continue;
            }

            if ($roleName === 'Employee1') {
                // Employee1 was removed as a built-in role, so ignore any stale stored entries.
                continue;
            }

            $isCustomRow = (int) ($row['is_custom'] ?? 0) === 1;
            if (!$this->isBuiltInPermissionRole($roleName) && !$isCustomRow) {
                // Ignore stale stored rows for roles that used to be built-in but are no longer defined.
                continue;
            }

            $defaultPermissions = isset($rolesByName[$roleName]['permissions']) && is_array($rolesByName[$roleName]['permissions'])
                ? $rolesByName[$roleName]['permissions']
                : $this->defaultRolePermissions($roleName);

            $rolesByName[$roleName] = [
                'roleName' => $roleName,
                'isCustom' => !$this->isBuiltInPermissionRole($roleName),
                'permissions' => $this->normalizeRolePermissions($row['permissions'] ?? null, $defaultPermissions, $roleName),
                'createdAt' => $this->toIso($row['created_at'] ?? null),
                'updatedAt' => $this->toIso($row['updated_at'] ?? null),
            ];
        }

        $roles = array_values($rolesByName);
        usort($roles, static function (array $left, array $right): int {
            if ((bool) ($left['isCustom'] ?? false) !== (bool) ($right['isCustom'] ?? false)) {
                return (bool) ($left['isCustom'] ?? false) ? 1 : -1;
            }

            return strcmp((string) ($left['roleName'] ?? ''), (string) ($right['roleName'] ?? ''));
        });

        $this->permissionsSettingsPayloadCache = ['roles' => $roles];
        return $this->permissionsSettingsPayloadCache;
    }

    /**
     * @return array<string, bool>
     */
    protected function permissionsForRole(string $role): array
    {
        $normalizedRole = $this->normalizeRoleName($role);
        if ($normalizedRole === '') {
            return $this->blankRolePermissions();
        }

        if ($this->isReservedPermissionRole($normalizedRole)) {
            return $this->allEnabledRolePermissions();
        }

        $settings = $this->buildPermissionsSettingsPayload();
        $roles = is_array($settings['roles'] ?? null) ? $settings['roles'] : [];
        foreach ($roles as $roleConfig) {
            if ($this->normalizeRoleName((string) ($roleConfig['roleName'] ?? '')) === $normalizedRole) {
                return $this->normalizeRolePermissions(
                    $roleConfig['permissions'] ?? null,
                    $this->defaultRolePermissions($normalizedRole),
                    $normalizedRole
                );
            }
        }

        return $this->defaultRolePermissions($normalizedRole);
    }

    protected function roleHasPermission(string $role, string $permission): bool
    {
        if (!in_array($permission, self::ROLE_PERMISSION_KEYS, true)) {
            return false;
        }

        $permissions = $this->permissionsForRole($role);
        return (bool) ($permissions[$permission] ?? false);
    }

    protected function currentUserHasPermission(string $permission): bool
    {
        $user = $this->currentUser();
        return $this->roleHasPermission((string) ($user['role'] ?? ''), $permission);
    }

    /**
     * @param array<string, mixed> $user
     */
    protected function userHasScopedPermissionForRecord(array $user, ?string $createdBy, string $ownPermission, string $anyPermission): bool
    {
        $role = (string) ($user['role'] ?? '');
        if ($this->roleHasPermission($role, $anyPermission)) {
            return true;
        }

        $normalizedCreatedBy = trim((string) ($createdBy ?? ''));
        return $normalizedCreatedBy !== ''
            && $normalizedCreatedBy === (string) ($user['id'] ?? '')
            && $this->roleHasPermission($role, $ownPermission);
    }

    protected function currentUserHasScopedPermissionForRecord(?string $createdBy, string $ownPermission, string $anyPermission): bool
    {
        return $this->userHasScopedPermissionForRecord($this->currentUser(), $createdBy, $ownPermission, $anyPermission);
    }

    protected function isEmployeeRole(string $role): bool
    {
        return in_array($role, ['Employee'], true);
    }

    protected function hasAdminAccess(string $role): bool
    {
        return in_array($role, ['Admin', 'Developer'], true);
    }

    /**
     * @param array<int, mixed> $statuses
     * @return array<int, string>
     */
    protected function normalizePayrollStatuses(array $statuses, bool $fallbackToDefault): array
    {
        $allowed = self::DEFAULT_PAYROLL_STATUSES;
        $normalized = [];
        foreach ($statuses as $status) {
            $statusText = trim((string) $status);
            if ($statusText !== '' && in_array($statusText, $allowed, true) && !in_array($statusText, $normalized, true)) {
                $normalized[] = $statusText;
            }
        }

        if ($normalized !== []) {
            return $normalized;
        }

        return $fallbackToDefault ? self::DEFAULT_PAYROLL_STATUSES : [];
    }

    protected function isWalletEligibleOrderDate(string $orderDate, string $createdAt): bool
    {
        $activityDate = $this->walletEligibleLocalDate($orderDate, $createdAt);
        return $activityDate !== '' && $activityDate >= $this->walletCutoffDate();
    }

    protected function walletCutoffDate(): string
    {
        return $this->config->get('WALLET_CUTOFF_DATE', self::DEFAULT_WALLET_CUTOFF_DATE)
            ?? self::DEFAULT_WALLET_CUTOFF_DATE;
    }

    protected function walletCutoffAtUtc(): string
    {
        return $this->normalizeDateTimeInput(
            $this->config->get('WALLET_CUTOFF_AT_UTC', self::DEFAULT_WALLET_CUTOFF_AT_UTC)
            ?? self::DEFAULT_WALLET_CUTOFF_AT_UTC
        );
    }

    protected function localDateFromUtc(?string $value): string
    {
        $trimmed = trim((string) $value);
        if ($trimmed === '') {
            return '';
        }

        $date = $this->parseDateTimeValue($trimmed, $this->utcTimezone());
        if (!$date instanceof \DateTimeImmutable) {
            return '';
        }

        $timezone = new \DateTimeZone($this->config->timezone());
        return $date->setTimezone($timezone)->format('Y-m-d');
    }

    protected function walletEligibleLocalDate(string $orderDate, string $createdAt): string
    {
        $createdLocalDate = $this->localDateFromUtc($createdAt);
        if ($createdLocalDate !== '') {
            return $createdLocalDate;
        }

        return $this->normalizeDateOnly($orderDate);
    }
}
