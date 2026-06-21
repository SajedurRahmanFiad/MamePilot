<?php

declare(strict_types=1);

/**
 * MamePilot central tier/license API.
 *
 * Upload this single file to a separate subdomain as api.php, configure the
 * constants, run the MySQL SQL below once, then point each client installation
 * to the full URL, for example:
 *
 *   https://license.your-domain.com/api.php
 *
 * You can prepare the correctly named upload file with:
 *
 *   npm run deploy:central-license:prepare
 *
 * Opening api.php in a browser should return a JSON "POST required" response.
 * A 404 means the file is not uploaded at that exact path.
 *
 * CREATE TABLE license_tiers (
 *   id INT AUTO_INCREMENT PRIMARY KEY,
 *   tier_key VARCHAR(64) NOT NULL UNIQUE,
 *   tier_name VARCHAR(255) NOT NULL,
 *   monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0,
 *   yearly_price DECIMAL(10,2) NOT NULL DEFAULT 0,
 *   capabilities LONGTEXT NOT NULL,
 *   is_active TINYINT(1) NOT NULL DEFAULT 1,
 *   sort_order INT NOT NULL DEFAULT 0,
 *   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 *   updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 * );
 *
 * CREATE TABLE licenses (
 *   license_key VARCHAR(255) NOT NULL PRIMARY KEY,
 *   client_name VARCHAR(255) NOT NULL,
 *   domain VARCHAR(255) NULL,
 *   tier_key VARCHAR(64) NOT NULL,
 *   status VARCHAR(64) NOT NULL DEFAULT 'active',
 *   renewal_date DATETIME NULL,
 *   capability_overrides LONGTEXT NULL,
 *   override_enabled TINYINT(1) NOT NULL DEFAULT 0,
 *   notes TEXT NULL,
 *   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 *   updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 * );
 *
 * CREATE TABLE notifications (
 *   id VARCHAR(255) NOT NULL PRIMARY KEY,
 *   subject VARCHAR(255) NOT NULL,
 *   content_html LONGTEXT NOT NULL,
 *   target_roles LONGTEXT NOT NULL,
 *   starts_at DATETIME NULL,
 *   ends_at DATETIME NULL,
 *   action_config LONGTEXT NULL,
 *   metadata LONGTEXT NULL,
 *   created_by VARCHAR(255) NULL,
 *   is_active TINYINT(1) NOT NULL DEFAULT 1,
 *   is_system_generated TINYINT(1) NOT NULL DEFAULT 0,
 *   created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 *   updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
 * );
 *
 * INSERT INTO license_tiers (tier_key, tier_name, monthly_price, yearly_price, capabilities, sort_order) VALUES
 * ('starter', 'Starter', 1990, 19900, '["dashboard","inventory","sales"]', 1),
 * ('growth', 'Growth', 2990, 29900, '["dashboard","inventory","sales","purchases","banking","fraud_checker","courier_automation","recycle_bin_undoer"]', 2),
 * ('advanced', 'Advanced', 4990, 49900, '["dashboard","inventory","sales","recycle_bin_undoer","purchases","banking","human_resources","advanced_reports","fraud_checker","whitelabel","custom_roles","courier_automation"]', 3);
 */

const LICENSE_DB_DSN = 'mysql:host=localhost;dbname=zomesnze_mamepilotlicense;charset=utf8mb4';
const LICENSE_DB_USER = 'zomesnze_admin';
const LICENSE_DB_PASS = 'admin@crossintbd';
const CENTRAL_OWNER_TOKEN = 'fthderthynersgjsyrhgrdryhrtfjutfjdshnrxethmezrejt';
const RESPONSE_SIGNING_SECRET = 'syghbaweoiwnfouvyzsnruvygebrgyhusbdrgvhjsdnrzubgjhyrdngb';

function respond(int $status, array $payload): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (RESPONSE_SIGNING_SECRET !== '') {
        header('X-MamePilot-Signature: ' . hash_hmac('sha256', (string) $body, RESPONSE_SIGNING_SECRET));
    }
    echo $body;
    exit;
}

function requestBody(): array
{
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        respond(405, ['error' => 'POST required.']);
    }

    $raw = file_get_contents('php://input') ?: '';
    $body = json_decode($raw, true);
    if (!is_array($body)) {
        respond(400, ['error' => 'Invalid JSON body.']);
    }

    return $body;
}

function db(): PDO
{
    return new PDO(LICENSE_DB_DSN, LICENSE_DB_USER, LICENSE_DB_PASS, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
}

function requireOwnerToken(): void
{
    $provided = trim((string) ($_SERVER['HTTP_X_MAMEPILOT_OWNER_TOKEN'] ?? ''));
    if (CENTRAL_OWNER_TOKEN === '' || $provided === '' || !hash_equals(CENTRAL_OWNER_TOKEN, $provided)) {
        respond(401, ['error' => 'Valid owner token required.']);
    }
}

function capabilitiesFrom($value): array
{
    $decoded = is_array($value) ? $value : json_decode((string) $value, true);
    if (!is_array($decoded)) {
        return [];
    }

    return array_values(array_filter(array_map(static fn($item): string => trim((string) $item), $decoded)));
}

function tierPayload(array $row): array
{
    return [
        'tier_key' => (string) $row['tier_key'],
        'tier_name' => (string) $row['tier_name'],
        'monthly_price' => (float) $row['monthly_price'],
        'yearly_price' => (float) $row['yearly_price'],
        'capabilities' => capabilitiesFrom($row['capabilities'] ?? '[]'),
    ];
}

function notificationPayload(array $row): array
{
    return [
        'id' => (string) ($row['id'] ?? ''),
        'subject' => (string) ($row['subject'] ?? ''),
        'contentHtml' => (string) ($row['content_html'] ?? $row['contentHtml'] ?? ''),
        'targetRoles' => capabilitiesFrom($row['target_roles'] ?? $row['targetRoles'] ?? '[]'),
        'startsAt' => $row['starts_at'] ?? $row['startsAt'] ?? null,
        'endsAt' => $row['ends_at'] ?? $row['endsAt'] ?? null,
        'createdAt' => $row['created_at'] ?? $row['createdAt'] ?? null,
        'updatedAt' => $row['updated_at'] ?? $row['updatedAt'] ?? null,
        'createdBy' => $row['created_by'] ?? $row['createdBy'] ?? null,
        'createdByName' => $row['created_by'] ?? $row['createdByName'] ?? null,
        'isActive' => (int) ($row['is_active'] ?? $row['isActive'] ?? 1) === 1,
        'isSystemGenerated' => (int) ($row['is_system_generated'] ?? $row['isSystemGenerated'] ?? 0) === 1,
        'systemKey' => $row['system_key'] ?? $row['systemKey'] ?? null,
        'isRead' => false,
        'readAt' => null,
        'actionResult' => null,
        'actedAt' => null,
        'actionConfig' => is_array($row['action_config'] ?? $row['actionConfig'] ?? null) ? ($row['action_config'] ?? $row['actionConfig'] ?? []) : json_decode((string) ($row['action_config'] ?? $row['actionConfig'] ?? '[]'), true),
        'metadata' => is_array($row['metadata'] ?? null) ? $row['metadata'] : json_decode((string) ($row['metadata'] ?? '[]'), true),
    ];
}

function activeTiers(PDO $pdo): array
{
    $rows = $pdo->query('SELECT * FROM license_tiers WHERE is_active = 1 ORDER BY sort_order ASC, tier_name ASC')->fetchAll();
    return array_map('tierPayload', $rows);
}

function fetchTier(PDO $pdo, string $tierKey): ?array
{
    $statement = $pdo->prepare('SELECT * FROM license_tiers WHERE tier_key = :tier_key AND is_active = 1 LIMIT 1');
    $statement->execute([':tier_key' => $tierKey]);
    $row = $statement->fetch();
    return $row ?: null;
}

function resolveLicense(PDO $pdo, string $licenseKey): array
{
    $statement = $pdo->prepare('SELECT * FROM licenses WHERE license_key = :license_key LIMIT 1');
    $statement->execute([':license_key' => $licenseKey]);
    $license = $statement->fetch();
    if (!$license) {
        respond(404, ['error' => 'License not found.', 'status' => 'not_found', 'capabilities' => []]);
    }

    $tier = fetchTier($pdo, (string) $license['tier_key']);
    if (!$tier) {
        respond(404, ['error' => 'License tier not found or inactive.', 'status' => 'tier_not_found', 'capabilities' => []]);
    }

    $tierCapabilities = capabilitiesFrom($tier['capabilities'] ?? '[]');
    $overrideEnabled = (int) ($license['override_enabled'] ?? 0) === 1;
    $overrideCapabilities = capabilitiesFrom($license['capability_overrides'] ?? '[]');
    $resolvedCapabilities = $overrideEnabled ? $overrideCapabilities : $tierCapabilities;

    return [
        'license_key' => $licenseKey,
        'client_name' => $license['client_name'] ?? null,
        'domain' => $license['domain'] ?? null,
        'status' => $license['status'] ?? 'active',
        'tier_key' => $tier['tier_key'],
        'plan_name' => $tier['tier_name'],
        'renewal_date' => $license['renewal_date'] ?? null,
        'override_enabled' => $overrideEnabled,
        'capabilities' => $resolvedCapabilities,
        'tier_capabilities' => $tierCapabilities,
        'pricing_metadata' => [
            'monthly' => (float) $tier['monthly_price'],
            'yearly' => (float) $tier['yearly_price'],
        ],
        'available_tiers' => activeTiers($pdo),
        'updated_at' => $license['updated_at'] ?? gmdate('c'),
    ];
}

function generateLicenseKey(): string
{
    return 'MP-' . strtoupper(bin2hex(random_bytes(8)));
}

function generateNotificationId(): string
{
    return 'NT-' . strtoupper(bin2hex(random_bytes(8)));
}

$body = requestBody();
$action = trim((string) ($body['action'] ?? 'resolve_license'));

try {
    $pdo = db();

    if ($action === 'list_tiers') {
        respond(200, ['tiers' => activeTiers($pdo)]);
    }

    if ($action === 'resolve_license') {
        $licenseKey = trim((string) ($body['license_key'] ?? ''));
        if ($licenseKey === '') {
            respond(400, ['error' => 'license_key is required.']);
        }
        respond(200, resolveLicense($pdo, $licenseKey));
    }

    if ($action === 'list_notifications') {
        $targetRoles = capabilitiesFrom($body['targetRoles'] ?? $body['target_roles'] ?? []);
        $sql = 'SELECT * FROM notifications WHERE is_active = 1';
        $bindings = [];
        if ($targetRoles !== []) {
            $clauses = [];
            foreach ($targetRoles as $index => $role) {
                $clauses[] = 'target_roles LIKE :role_' . $index;
                $bindings[':role_' . $index] = '%"' . $role . '"%';
            }
            $sql .= ' AND (' . implode(' OR ', $clauses) . ')';
        }
        $sql .= ' ORDER BY COALESCE(starts_at, created_at) DESC, created_at DESC LIMIT 500';
        $statement = $pdo->prepare($sql);
        $statement->execute($bindings);
        $items = [];
        while ($row = $statement->fetch()) {
            $items[] = notificationPayload($row);
        }
        respond(200, ['notifications' => $items]);
    }

    if ($action === 'fetch_notification_by_id') {
        $notificationId = trim((string) ($body['id'] ?? ''));
        if ($notificationId === '') {
            respond(400, ['error' => 'id is required.']);
        }
        $statement = $pdo->prepare('SELECT * FROM notifications WHERE id = :id LIMIT 1');
        $statement->execute([':id' => $notificationId]);
        $row = $statement->fetch();
        if (!$row) {
            respond(404, ['error' => 'Notification not found.']);
        }
        respond(200, ['notification' => notificationPayload($row)]);
    }

    if ($action === 'create_notification') {
        $subject = trim((string) ($body['subject'] ?? ''));
        $contentHtml = trim((string) ($body['contentHtml'] ?? $body['content_html'] ?? ''));
        $targetRoles = capabilitiesFrom($body['targetRoles'] ?? $body['target_roles'] ?? []);
        if ($subject === '') {
            respond(400, ['error' => 'Notification subject is required.']);
        }
        if ($contentHtml === '') {
            respond(400, ['error' => 'Notification content is required.']);
        }
        if ($targetRoles === []) {
            respond(400, ['error' => 'At least one target role is required.']);
        }

        $startsAt = trim((string) ($body['startsAt'] ?? $body['starts_at'] ?? '')) ?: null;
        $endsAt = trim((string) ($body['endsAt'] ?? $body['ends_at'] ?? '')) ?: null;
        $actionConfig = $body['actionConfig'] ?? $body['action_config'] ?? [];
        if (!is_array($actionConfig)) {
            $actionConfig = json_decode((string) $actionConfig, true) ?: [];
        }
        $metadata = $body['metadata'] ?? [];
        if (!is_array($metadata)) {
            $metadata = json_decode((string) $metadata, true) ?: [];
        }

        $notificationId = generateNotificationId();
        $statement = $pdo->prepare(
            'INSERT INTO notifications (
                 id, subject, content_html, target_roles, starts_at, ends_at,
                 action_config, metadata, created_by, is_active, is_system_generated, created_at, updated_at
             ) VALUES (
                 :id, :subject, :content_html, :target_roles, :starts_at, :ends_at,
                 :action_config, :metadata, :created_by, 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
             )'
        );
        $statement->execute([
            ':id' => $notificationId,
            ':subject' => $subject,
            ':content_html' => $contentHtml,
            ':target_roles' => json_encode($targetRoles, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ':starts_at' => $startsAt !== '' ? $startsAt : null,
            ':ends_at' => $endsAt !== '' ? $endsAt : null,
            ':action_config' => json_encode($actionConfig, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ':metadata' => json_encode($metadata, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ':created_by' => null,
        ]);

        $created = $pdo->prepare('SELECT * FROM notifications WHERE id = :id LIMIT 1');
        $created->execute([':id' => $notificationId]);
        $row = $created->fetch();
        respond(200, ['notification' => notificationPayload($row ?: [])]);
    }

    requireOwnerToken();

    if ($action === 'create_or_update_license') {
        $tierKey = trim((string) ($body['tier_key'] ?? ''));
        if ($tierKey === '' || !fetchTier($pdo, $tierKey)) {
            respond(400, ['error' => 'A valid tier_key is required.']);
        }

        $licenseKey = trim((string) ($body['license_key'] ?? ''));
        if ($licenseKey === '') {
            $licenseKey = generateLicenseKey();
        }

        $clientName = trim((string) ($body['client_name'] ?? ''));
        $domain = trim((string) ($body['domain'] ?? ''));
        if ($clientName === '') {
            $clientName = $domain !== '' ? $domain : 'MamePilot Client';
        }

        $existing = $pdo->prepare('SELECT license_key FROM licenses WHERE license_key = :license_key LIMIT 1');
        $existing->execute([':license_key' => $licenseKey]);
        if ($existing->fetch()) {
            $statement = $pdo->prepare(
                'UPDATE licenses
                 SET client_name = :client_name, domain = :domain, tier_key = :tier_key, status = :status, renewal_date = :renewal_date, updated_at = CURRENT_TIMESTAMP
                 WHERE license_key = :license_key'
            );
        } else {
            $statement = $pdo->prepare(
                'INSERT INTO licenses (license_key, client_name, domain, tier_key, status, renewal_date)
                 VALUES (:license_key, :client_name, :domain, :tier_key, :status, :renewal_date)'
            );
        }

        $statement->execute([
            ':license_key' => $licenseKey,
            ':client_name' => $clientName,
            ':domain' => $domain !== '' ? $domain : null,
            ':tier_key' => $tierKey,
            ':status' => trim((string) ($body['status'] ?? 'active')) ?: 'active',
            ':renewal_date' => trim((string) ($body['renewal_date'] ?? '')) ?: null,
        ]);

        respond(200, resolveLicense($pdo, $licenseKey));
    }

    if ($action === 'update_license_override') {
        $licenseKey = trim((string) ($body['license_key'] ?? ''));
        if ($licenseKey === '') {
            respond(400, ['error' => 'license_key is required.']);
        }

        $capabilities = capabilitiesFrom($body['capabilities'] ?? []);
        $statement = $pdo->prepare(
            'UPDATE licenses
             SET capability_overrides = :capability_overrides, override_enabled = 1, updated_at = CURRENT_TIMESTAMP
             WHERE license_key = :license_key'
        );
        $statement->execute([
            ':license_key' => $licenseKey,
            ':capability_overrides' => json_encode($capabilities, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);

        respond(200, resolveLicense($pdo, $licenseKey));
    }

    if ($action === 'reset_license_override') {
        $licenseKey = trim((string) ($body['license_key'] ?? ''));
        if ($licenseKey === '') {
            respond(400, ['error' => 'license_key is required.']);
        }

        $statement = $pdo->prepare(
            'UPDATE licenses
             SET capability_overrides = NULL, override_enabled = 0, updated_at = CURRENT_TIMESTAMP
             WHERE license_key = :license_key'
        );
        $statement->execute([':license_key' => $licenseKey]);

        respond(200, resolveLicense($pdo, $licenseKey));
    }

    respond(400, ['error' => 'Unknown action.']);
} catch (Throwable $exception) {
    respond(500, ['error' => 'License API failed.', 'details' => $exception->getMessage()]);
}
