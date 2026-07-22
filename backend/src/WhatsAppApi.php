<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

/**
 * Meta WhatsApp Cloud API integration.
 *
 * Meta is the source of truth for transport. Webhook events are mirrored into
 * the local tables so the app can provide a searchable, durable inbox.
 */
final class WhatsAppApi extends BaseService
{
    private const SETTINGS_ID = 'whatsapp-default';
    private const DEFAULT_GRAPH_VERSION = 'v25.0';
    private const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
    private const STATUS_RANK = [
        'received' => 1,
        'sent' => 2,
        'delivered' => 3,
        'read' => 4,
        'failed' => 99,
    ];

    public function fetchWhatsAppSettings(array $params = []): array
    {
        $this->requireAdmin();
        $this->ensureTables();
        return $this->settingsResponse($this->settingsRow());
    }

    public function updateWhatsAppSettings(array $params): array
    {
        $this->requireAdmin();
        $this->ensureTables();
        $existing = $this->settingsRow() ?? [];
        $updates = [
            'access_token' => $this->stringOrNull($params['accessToken'] ?? ($existing['access_token'] ?? null)),
            'phone_number_id' => $this->stringOrNull($params['phoneNumberId'] ?? ($existing['phone_number_id'] ?? null)),
            'business_account_id' => $this->stringOrNull($params['businessAccountId'] ?? ($existing['business_account_id'] ?? null)),
            'verify_token' => $this->stringOrNull($params['verifyToken'] ?? ($existing['verify_token'] ?? null)),
            'app_secret' => $this->stringOrNull($params['appSecret'] ?? ($existing['app_secret'] ?? null)),
            'graph_version' => $this->normalizeGraphVersion($params['graphVersion'] ?? ($existing['graph_version'] ?? self::DEFAULT_GRAPH_VERSION)),
        ];

        $this->upsertSettings($updates);
        return $this->settingsResponse($this->settingsRow());
    }

    public function updateWhatsAppWelcomeExperience(array $params): array
    {
        $this->requireAdmin();
        $this->ensureTables();
        $this->requireConfiguredSettings();
        $message = trim((string) ($params['welcomeMessage'] ?? ''));
        if ($message === '') throw new RuntimeException('Add a welcome message first.');
        if (mb_strlen($message) > 1024) throw new RuntimeException('The welcome message can be up to 1,024 characters.');
        $getStarted = !empty($params['getStartedEnabled']);
        $availableChoices = $getStarted ? 2 : 3;
        $iceBreakers = [];
        foreach ((array) ($params['iceBreakers'] ?? []) as $value) {
            $title = trim((string) $value);
            if ($title === '') continue;
            if (mb_strlen($title) > 20) throw new RuntimeException('Each conversation starter can be up to 20 characters.');
            $iceBreakers[] = $title;
        }
        if (count($iceBreakers) > $availableChoices) {
            throw new RuntimeException($getStarted ? 'You can add up to two conversation starters when Get Started is shown.' : 'You can add up to three conversation starters.');
        }
        $this->upsertSettings([
            'welcome_message' => $message,
            'get_started_enabled' => $getStarted ? 1 : 0,
            'ice_breakers_json' => $this->jsonEncode($iceBreakers),
        ]);
        return $this->settingsResponse($this->settingsRow());
    }

    public function testWhatsAppConnection(array $params = []): array
    {
        $this->requireAdmin();
        $this->ensureTables();
        $settings = $this->requireConfiguredSettings();
        $phoneId = (string) $settings['phone_number_id'];
        $response = $this->graphRequest('GET', '/' . rawurlencode($phoneId), null, $settings, [
            'fields' => 'id,display_phone_number,verified_name,quality_rating,platform_type',
        ]);

        $this->database->execute(
            'UPDATE whatsapp_settings
             SET display_phone_number = :phone, verified_name = :name, quality_rating = :quality, updated_at = :updated
             WHERE id = :id',
            [
                ':phone' => $this->stringOrNull($response['display_phone_number'] ?? null),
                ':name' => $this->stringOrNull($response['verified_name'] ?? null),
                ':quality' => $this->stringOrNull($response['quality_rating'] ?? null),
                ':updated' => $this->database->nowUtc(),
                ':id' => self::SETTINGS_ID,
            ]
        );

        return [
            'ok' => true,
            'phoneNumberId' => (string) ($response['id'] ?? $phoneId),
            'displayPhoneNumber' => (string) ($response['display_phone_number'] ?? ''),
            'verifiedName' => (string) ($response['verified_name'] ?? ''),
            'qualityRating' => (string) ($response['quality_rating'] ?? ''),
        ];
    }

    /** @return array<string, mixed> */
    public function fetchWhatsAppContacts(array $params = []): array
    {
        $this->currentUser();
        $this->ensureTables();
        $page = max(1, (int) ($params['page'] ?? 1));
        $pageSize = min(100, max(10, (int) ($params['pageSize'] ?? 50)));
        $search = trim((string) ($params['search'] ?? ''));
        $filter = trim((string) ($params['filter'] ?? 'all'));
        $where = [];
        $bindings = [];
        if ($search !== '') {
            $where[] = '(name LIKE :search OR profile_name LIKE :search_profile OR wa_id LIKE :search_wa OR last_message_preview LIKE :search_preview)';
            $bindings[':search'] = '%' . $search . '%';
            $bindings[':search_profile'] = '%' . $search . '%';
            $bindings[':search_wa'] = '%' . $search . '%';
            $bindings[':search_preview'] = '%' . $search . '%';
        }
        if ($filter === 'unread') {
            $where[] = 'unread_count > 0';
        }
        $whereSql = $where === [] ? '' : 'WHERE ' . implode(' AND ', $where);
        $countRow = $this->database->fetchOne('SELECT COUNT(*) AS total FROM whatsapp_contacts ' . $whereSql, $bindings);
        $offset = ($page - 1) * $pageSize;
        $rows = $this->database->fetchAll(
            'SELECT id, wa_id, phone_number, name, profile_name, unread_count, last_message_preview,
                    last_message_type, last_message_at, created_at, updated_at
             FROM whatsapp_contacts ' . $whereSql . ' ORDER BY last_message_at DESC, updated_at DESC LIMIT ' . $pageSize . ' OFFSET ' . $offset,
            $bindings
        );

        return [
            'data' => array_map(fn(array $row): array => $this->mapContact($row), $rows),
            'count' => (int) ($countRow['total'] ?? 0),
            'configured' => $this->isConfigured($this->settingsRow()),
        ];
    }

    /** @return array<string, mixed> */
    public function fetchWhatsAppMessages(array $params): array
    {
        $this->currentUser();
        $this->ensureTables();
        $contactId = trim((string) ($params['contactId'] ?? ''));
        if ($contactId === '') {
            throw new RuntimeException('A WhatsApp contact is required.');
        }
        $contact = $this->database->fetchOne('SELECT * FROM whatsapp_contacts WHERE id = :id LIMIT 1', [':id' => $contactId]);
        if ($contact === null) {
            throw new RuntimeException('WhatsApp contact not found.');
        }
        $limit = min(200, max(20, (int) ($params['limit'] ?? 100)));
        $rows = $this->database->fetchAll(
            'SELECT * FROM whatsapp_messages WHERE contact_id = :contact_id ORDER BY message_at DESC, created_at DESC LIMIT ' . $limit,
            [':contact_id' => $contactId]
        );
        $rows = array_reverse($rows);
        return [
            'contact' => $this->mapContact($contact),
            'data' => array_map(fn(array $row): array => $this->mapMessage($row), $rows),
        ];
    }

    /** @return array<string, mixed> */
    public function createWhatsAppConversation(array $params): array
    {
        $this->currentUser();
        $this->ensureTables();
        $phone = $this->normalizePhone($params['phoneNumber'] ?? $params['to'] ?? '');
        if (strlen($phone) < 7 || strlen($phone) > 15) {
            throw new RuntimeException('Enter a WhatsApp number with country code, for example 8801XXXXXXXXX.');
        }
        $name = trim((string) ($params['name'] ?? ''));
        $existing = $this->database->fetchOne('SELECT * FROM whatsapp_contacts WHERE wa_id = :wa_id LIMIT 1', [':wa_id' => $phone]);
        if ($existing === null) {
            $now = $this->database->nowUtc();
            $this->database->execute(
                'INSERT INTO whatsapp_contacts (id, wa_id, phone_number, name, profile_name, created_at, updated_at)
                 VALUES (:id, :wa_id, :phone, :name, :profile, :created, :updated)',
                [
                    ':id' => $this->uuid4(), ':wa_id' => $phone, ':phone' => $phone,
                    ':name' => $name !== '' ? $name : null, ':profile' => $name !== '' ? $name : null,
                    ':created' => $now, ':updated' => $now,
                ]
            );
            $existing = $this->database->fetchOne('SELECT * FROM whatsapp_contacts WHERE wa_id = :wa_id LIMIT 1', [':wa_id' => $phone]);
        } elseif ($name !== '' && trim((string) ($existing['name'] ?? '')) === '') {
            $this->database->execute('UPDATE whatsapp_contacts SET name = :name, profile_name = :profile, updated_at = :updated WHERE id = :id', [
                ':name' => $name, ':profile' => $name, ':updated' => $this->database->nowUtc(), ':id' => $existing['id'],
            ]);
            $existing['name'] = $name;
            $existing['profile_name'] = $name;
        }
        return $this->mapContact($existing ?: []);
    }

    /** @return array<string, mixed> */
    public function markWhatsAppConversationRead(array $params): array
    {
        $this->currentUser();
        $this->ensureTables();
        $contactId = trim((string) ($params['contactId'] ?? ''));
        $contact = $this->database->fetchOne('SELECT * FROM whatsapp_contacts WHERE id = :id LIMIT 1', [':id' => $contactId]);
        if ($contact === null) {
            throw new RuntimeException('WhatsApp contact not found.');
        }
        $unread = $this->database->fetchAll(
            "SELECT wa_message_id FROM whatsapp_messages WHERE contact_id = :contact_id AND direction = 'inbound' AND status <> 'read' AND wa_message_id IS NOT NULL ORDER BY message_at ASC LIMIT 50",
            [':contact_id' => $contactId]
        );
        $settings = $this->settingsRow();
        foreach ($unread as $row) {
            try {
                if ($this->isConfigured($settings)) {
                    $this->graphRequest('POST', '/' . rawurlencode((string) $settings['phone_number_id']) . '/messages', [
                        'messaging_product' => 'whatsapp', 'status' => 'read', 'message_id' => (string) $row['wa_message_id'],
                    ], $settings);
                }
                $this->database->execute('UPDATE whatsapp_messages SET status = \'read\', updated_at = :updated WHERE wa_message_id = :message_id', [
                    ':updated' => $this->database->nowUtc(), ':message_id' => $row['wa_message_id'],
                ]);
            } catch (\Throwable $exception) {
                // Local read state remains usable even if an old Meta message has expired.
            }
        }
        $this->database->execute('UPDATE whatsapp_contacts SET unread_count = 0, updated_at = :updated WHERE id = :id', [
            ':updated' => $this->database->nowUtc(), ':id' => $contactId,
        ]);
        return ['ok' => true, 'contactId' => $contactId];
    }

    /** @return array<string, mixed> */
    public function sendWhatsAppMessage(array $params): array
    {
        $user = $this->currentUser();
        $this->ensureTables();
        $contact = $this->resolveContact($params);
        $text = trim((string) ($params['text'] ?? ''));
        if ($text === '') {
            throw new RuntimeException('Message text cannot be empty.');
        }
        if (mb_strlen($text) > 4096) {
            throw new RuntimeException('WhatsApp text messages are limited to 4,096 characters.');
        }
        $settings = $this->requireConfiguredSettings();
        $response = $this->graphRequest('POST', '/' . rawurlencode((string) $settings['phone_number_id']) . '/messages', [
            'messaging_product' => 'whatsapp',
            'recipient_type' => 'individual',
            'to' => (string) $contact['wa_id'],
            'type' => 'text',
            'text' => ['preview_url' => false, 'body' => $text],
        ], $settings);
        $messageId = (string) (($response['messages'][0]['id'] ?? '') ?: $this->uuid4());
        $row = $this->storeOutboundMessage($contact, $messageId, 'text', $text, null, null, null, 'accepted', $user['id'] ?? null);
        return $this->mapMessage($row);
    }

    /** @return array<string, mixed> */
    public function sendWhatsAppMediaMessage(array $params): array
    {
        $user = $this->currentUser();
        $this->ensureTables();
        $contact = $this->resolveContact($params);
        $dataUrl = trim((string) ($params['dataUrl'] ?? ''));
        $fileName = trim((string) ($params['fileName'] ?? 'attachment'));
        $mime = strtolower(trim((string) ($params['mimeType'] ?? 'application/octet-stream')));
        $decoded = $this->decodeDataUrl($dataUrl);
        if ($decoded === null) {
            throw new RuntimeException('The selected WhatsApp file could not be read.');
        }
        [$decodedMime, $bytes] = $decoded;
        if ($mime === 'application/octet-stream' || $mime === '') {
            $mime = $decodedMime;
        }
        if (strlen($bytes) > self::MAX_MEDIA_BYTES) {
            throw new RuntimeException('WhatsApp media is limited to 16 MB in this inbox.');
        }
        $messageType = $this->mediaMessageType($mime);
        $settings = $this->requireConfiguredSettings();
        $mediaId = $this->uploadMedia($bytes, $mime, $fileName, $settings);
        $body = [
            'messaging_product' => 'whatsapp',
            'recipient_type' => 'individual',
            'to' => (string) $contact['wa_id'],
            'type' => $messageType,
            $messageType => array_filter([
                'id' => $mediaId,
                'caption' => trim((string) ($params['caption'] ?? '')) ?: null,
                'filename' => $messageType === 'document' ? $fileName : null,
            ], static fn($value): bool => $value !== null && $value !== ''),
        ];
        $response = $this->graphRequest('POST', '/' . rawurlencode((string) $settings['phone_number_id']) . '/messages', $body, $settings);
        $messageId = (string) (($response['messages'][0]['id'] ?? '') ?: $this->uuid4());
        $localUrl = $this->saveUploadedFileFromDataUrl('data:' . $mime . ';base64,' . base64_encode($bytes), 'whatsapp', $fileName);
        $caption = trim((string) ($params['caption'] ?? ''));
        $row = $this->storeOutboundMessage($contact, $messageId, $messageType, $caption, $caption, $mediaId, $localUrl, 'accepted', $user['id'] ?? null, $mime, $fileName);
        return $this->mapMessage($row);
    }

    /** @return array<string, mixed> */
    public function fetchWhatsAppTemplates(array $params = []): array
    {
        $this->currentUser();
        $this->ensureTables();
        $settings = $this->requireConfiguredSettings();
        $wabaId = trim((string) ($settings['business_account_id'] ?? ''));
        if ($wabaId === '') {
            throw new RuntimeException('Saved WhatsApp messages are not available yet. Ask an administrator to finish the setup.');
        }
        $response = $this->graphRequest('GET', '/' . rawurlencode($wabaId) . '/message_templates', null, $settings, [
            'fields' => 'id,name,language,status,category,components', 'status' => 'APPROVED', 'limit' => 100,
        ]);
        return ['data' => array_values(array_filter($response['data'] ?? [], 'is_array'))];
    }

    /** @return array<string, mixed> */
    public function sendWhatsAppTemplate(array $params): array
    {
        $user = $this->currentUser();
        $this->ensureTables();
        $contact = $this->resolveContact($params);
        $name = trim((string) ($params['templateName'] ?? ''));
        $language = trim((string) ($params['languageCode'] ?? 'en_US')) ?: 'en_US';
        if ($name === '') {
            throw new RuntimeException('Choose an approved WhatsApp template.');
        }
        $settings = $this->requireConfiguredSettings();
        $components = is_array($params['components'] ?? null) ? $params['components'] : [];
        $response = $this->graphRequest('POST', '/' . rawurlencode((string) $settings['phone_number_id']) . '/messages', [
            'messaging_product' => 'whatsapp', 'recipient_type' => 'individual', 'to' => (string) $contact['wa_id'],
            'type' => 'template', 'template' => ['name' => $name, 'language' => ['code' => $language], 'components' => $components],
        ], $settings);
        $messageId = (string) (($response['messages'][0]['id'] ?? '') ?: $this->uuid4());
        $row = $this->storeOutboundMessage($contact, $messageId, 'template', 'Template: ' . $name, null, null, null, 'accepted', $user['id'] ?? null, null, null, ['templateName' => $name, 'languageCode' => $language, 'components' => $components]);
        return $this->mapMessage($row);
    }

    /** Called only by the public Meta webhook endpoint. */
    public function webhookVerification(string $mode, string $token, string $challenge): ?string
    {
        $this->ensureTables();
        $settings = $this->settingsRow();
        if ($mode !== 'subscribe' || $token === '' || $challenge === '' || $settings === null) {
            return null;
        }
        $expected = trim((string) ($settings['verify_token'] ?? ''));
        return $expected !== '' && hash_equals($expected, $token) ? $challenge : null;
    }

    /** @return array<string, mixed> */
    public function handleWebhook(string $rawBody, ?string $signature): array
    {
        $this->ensureTables();
        $settings = $this->settingsRow();
        $secret = trim((string) ($settings['app_secret'] ?? ''));
        if ($secret === '' || $signature === null || !hash_equals('sha256=' . hash_hmac('sha256', $rawBody, $secret), trim($signature))) {
            throw new RuntimeException('Invalid WhatsApp webhook signature.');
        }
        $payload = json_decode($rawBody, true);
        if (!is_array($payload)) {
            throw new RuntimeException('Invalid WhatsApp webhook JSON.');
        }
        $processed = 0;
        foreach (($payload['entry'] ?? []) as $entry) {
            if (!is_array($entry)) continue;
            foreach (($entry['changes'] ?? []) as $change) {
                if (!is_array($change) || (string) ($change['field'] ?? '') !== 'messages') continue;
                $value = is_array($change['value'] ?? null) ? $change['value'] : [];
                foreach (($value['statuses'] ?? []) as $status) {
                    if (is_array($status)) $this->handleStatus($status);
                }
                $profiles = [];
                foreach (($value['contacts'] ?? []) as $contact) {
                    if (is_array($contact) && trim((string) ($contact['wa_id'] ?? '')) !== '') {
                        $profiles[(string) $contact['wa_id']] = (string) (($contact['profile']['name'] ?? '') ?: '');
                    }
                }
                foreach (($value['messages'] ?? []) as $message) {
                    if (is_array($message)) {
                        $this->handleIncomingMessage($message, $profiles[(string) ($message['from'] ?? '')] ?? null, $settings);
                        $processed++;
                    }
                }
            }
        }
        return ['ok' => true, 'processed' => $processed];
    }

    /** @return array<string, mixed>|null */
    private function settingsRow(): ?array
    {
        $row = $this->database->fetchOne('SELECT * FROM whatsapp_settings WHERE id = :id LIMIT 1', [':id' => self::SETTINGS_ID]);
        if ($row !== null) return $row;
        $envValues = [
            'access_token' => $this->config->get('WHATSAPP_ACCESS_TOKEN'),
            'phone_number_id' => $this->config->get('WHATSAPP_PHONE_NUMBER_ID'),
            'business_account_id' => $this->config->get('WHATSAPP_BUSINESS_ACCOUNT_ID'),
            'verify_token' => $this->config->get('WHATSAPP_VERIFY_TOKEN'),
            'app_secret' => $this->config->get('WHATSAPP_APP_SECRET'),
            'graph_version' => $this->config->get('WHATSAPP_GRAPH_VERSION', self::DEFAULT_GRAPH_VERSION),
        ];
        return array_filter($envValues, static fn($value): bool => $value !== null && trim((string) $value) !== '') === [] ? null : $envValues;
    }

    /** @return array<string, mixed> */
    private function settingsResponse(?array $row): array
    {
        $row = $row ?? [];
        $webhookUrl = trim((string) ($this->config->get('WHATSAPP_WEBHOOK_URL', '') ?? '')) ?: $this->inferredWebhookUrl();
        return [
            'accessToken' => (string) ($row['access_token'] ?? ''),
            'phoneNumberId' => (string) ($row['phone_number_id'] ?? ''),
            'businessAccountId' => (string) ($row['business_account_id'] ?? ''),
            'verifyToken' => (string) ($row['verify_token'] ?? ''),
            'appSecret' => (string) ($row['app_secret'] ?? ''),
            'graphVersion' => $this->normalizeGraphVersion($row['graph_version'] ?? self::DEFAULT_GRAPH_VERSION),
            'displayPhoneNumber' => (string) ($row['display_phone_number'] ?? ''),
            'verifiedName' => (string) ($row['verified_name'] ?? ''),
            'qualityRating' => (string) ($row['quality_rating'] ?? ''),
            'webhookUrl' => $webhookUrl,
            'configured' => $this->isConfigured($row),
            'webhookConfigured' => trim((string) ($row['verify_token'] ?? '')) !== '' && trim((string) ($row['app_secret'] ?? '')) !== '',
            'welcomeMessage' => (string) ($row['welcome_message'] ?? ''),
            'getStartedEnabled' => !empty($row['get_started_enabled']),
            'iceBreakers' => array_values(array_filter(array_map('strval', $this->jsonDecodeList($row['ice_breakers_json'] ?? null)))),
            'welcomeActive' => trim((string) ($row['welcome_message'] ?? '')) !== '',
        ];
    }

    private function inferredWebhookUrl(): string
    {
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host = (string) ($_SERVER['HTTP_HOST'] ?? 'localhost');
        $script = strtok((string) ($_SERVER['SCRIPT_NAME'] ?? '/api/index.php'), '?') ?: '/api/index.php';
        $directory = trim(str_replace('\\', '/', dirname($script)), '/.');
        return $scheme . '://' . $host . ($directory !== '' ? '/' . $directory : '') . '/whatsapp-webhook.php';
    }

    private function normalizeGraphVersion($value): string
    {
        $value = trim((string) ($value ?? ''));
        return preg_match('/^v\d+(?:\.\d+)?$/i', $value) === 1 ? $value : self::DEFAULT_GRAPH_VERSION;
    }

    private function isConfigured(?array $settings): bool
    {
        return $settings !== null && trim((string) ($settings['access_token'] ?? '')) !== '' && trim((string) ($settings['phone_number_id'] ?? '')) !== '';
    }

    /** @return array<string, mixed> */
    private function requireConfiguredSettings(): array
    {
        $settings = $this->settingsRow();
        if (!$this->isConfigured($settings)) {
            throw new RuntimeException('WhatsApp is not ready yet. Ask an administrator to finish the setup in Settings.');
        }
        return $settings;
    }

    private function upsertSettings(array $updates): void
    {
        $now = $this->database->nowUtc();
        $row = $this->settingsRow();
        if ($row !== null && isset($row['id']) && (string) $row['id'] === self::SETTINGS_ID) {
            $sets = [];
            $bindings = [':id' => self::SETTINGS_ID, ':updated' => $now];
            foreach ($updates as $column => $value) {
                $sets[] = $column . ' = :' . $column;
                $bindings[':' . $column] = $value;
            }
            $sets[] = 'updated_at = :updated';
            $this->database->execute('UPDATE whatsapp_settings SET ' . implode(', ', $sets) . ' WHERE id = :id', $bindings);
            return;
        }
        $columns = ['id', 'created_at', 'updated_at'];
        $values = [':id', ':created', ':updated'];
        $bindings = [':id' => self::SETTINGS_ID, ':created' => $now, ':updated' => $now];
        foreach ($updates as $column => $value) {
            $columns[] = $column; $values[] = ':' . $column; $bindings[':' . $column] = $value;
        }
        $this->database->execute('INSERT INTO whatsapp_settings (' . implode(', ', $columns) . ') VALUES (' . implode(', ', $values) . ')', $bindings);
    }

    private function resolveContact(array $params): array
    {
        $contactId = trim((string) ($params['contactId'] ?? ''));
        if ($contactId !== '') {
            $contact = $this->database->fetchOne('SELECT * FROM whatsapp_contacts WHERE id = :id LIMIT 1', [':id' => $contactId]);
            if ($contact !== null) return $contact;
        }
        $phone = $this->normalizePhone($params['to'] ?? $params['phoneNumber'] ?? '');
        if ($phone !== '') {
            $contact = $this->database->fetchOne('SELECT * FROM whatsapp_contacts WHERE wa_id = :wa_id LIMIT 1', [':wa_id' => $phone]);
            if ($contact !== null) return $contact;
        }
        throw new RuntimeException('WhatsApp contact not found. Start a conversation first.');
    }

    private function normalizePhone($value): string
    {
        return preg_replace('/[^0-9]/', '', (string) ($value ?? '')) ?: '';
    }

    private function mediaMessageType(string $mime): string
    {
        if (str_starts_with($mime, 'image/')) return 'image';
        if (str_starts_with($mime, 'video/')) return 'video';
        if (str_starts_with($mime, 'audio/')) return 'audio';
        return 'document';
    }

    /** @return array<string, mixed> */
    private function storeOutboundMessage(array $contact, string $messageId, string $type, ?string $text, ?string $caption, ?string $mediaId, ?string $mediaUrl, string $status, $createdBy, ?string $mime = null, ?string $fileName = null, ?array $payload = null): array
    {
        $now = $this->database->nowUtc();
        $this->database->execute(
            'INSERT INTO whatsapp_messages (id, contact_id, wa_message_id, direction, message_type, message_text, caption, media_id, media_url, media_mime_type, file_name, status, payload_json, message_at, created_by, created_at, updated_at)
             VALUES (:id, :contact_id, :wa_id, \'outbound\', :type, :text, :caption, :media_id, :media_url, :mime, :file_name, :status, :payload, :message_at, :created_by, :created_at, :updated_at)',
            [
                ':id' => $this->uuid4(), ':contact_id' => $contact['id'], ':wa_id' => $messageId, ':type' => $type,
                ':text' => $text, ':caption' => $caption, ':media_id' => $mediaId, ':media_url' => $mediaUrl,
                ':mime' => $mime, ':file_name' => $fileName, ':status' => $status, ':payload' => $payload === null ? null : json_encode($payload),
                ':message_at' => $now, ':created_by' => $createdBy, ':created_at' => $now, ':updated_at' => $now,
            ]
        );
        $this->database->execute('UPDATE whatsapp_contacts SET last_message_preview = :preview, last_message_type = :type, last_message_at = :at, updated_at = :updated WHERE id = :id', [
            ':preview' => $this->preview($text ?: $caption ?: ucfirst($type)), ':type' => $type, ':at' => $now, ':updated' => $now, ':id' => $contact['id'],
        ]);
        return $this->database->fetchOne('SELECT * FROM whatsapp_messages WHERE wa_message_id = :id LIMIT 1', [':id' => $messageId]) ?: [];
    }

    private function uploadMedia(string $bytes, string $mime, string $fileName, array $settings): string
    {
        if (!function_exists('curl_init')) {
            throw new RuntimeException('PHP cURL is required for WhatsApp media uploads.');
        }
        $temporary = tempnam(sys_get_temp_dir(), 'mamepilot-wa-');
        if ($temporary === false || file_put_contents($temporary, $bytes) === false) {
            throw new RuntimeException('Could not prepare the WhatsApp attachment.');
        }
        try {
            $handle = curl_init($this->graphBaseUrl($settings) . '/' . rawurlencode((string) $settings['phone_number_id']) . '/media');
            curl_setopt_array($handle, [
                CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_TIMEOUT => 90,
                CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . (string) $settings['access_token']],
                CURLOPT_POSTFIELDS => [
                    'messaging_product' => 'whatsapp', 'type' => $mime,
                    'file' => new \CURLFile($temporary, $mime, $fileName),
                ],
            ]);
            $raw = curl_exec($handle);
            $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
            $error = curl_error($handle);
            curl_close($handle);
            if ($raw === false || $error !== '') throw new RuntimeException('WhatsApp media upload failed: ' . $error);
            $decoded = json_decode((string) $raw, true);
            if ($status < 200 || $status >= 300 || !is_array($decoded) || empty($decoded['id'])) {
                throw new RuntimeException($this->metaError($decoded, 'WhatsApp media upload failed.'));
            }
            return (string) $decoded['id'];
        } finally {
            @unlink($temporary);
        }
    }

    /** @return array<string, mixed> */
    private function graphRequest(string $method, string $path, ?array $body, array $settings, array $query = []): array
    {
        $url = $this->graphBaseUrl($settings) . $path;
        if ($query !== []) $url .= '?' . http_build_query($query);
        if (!function_exists('curl_init')) {
            $contextOptions = ['http' => ['method' => $method, 'timeout' => 30, 'ignore_errors' => true, 'header' => "Authorization: Bearer {$settings['access_token']}\r\nContent-Type: application/json\r\n"]];
            if ($body !== null) $contextOptions['http']['content'] = json_encode($body);
            $raw = file_get_contents($url, false, stream_context_create($contextOptions));
            $decoded = json_decode((string) $raw, true);
            if (!is_array($decoded) || isset($decoded['error'])) throw new RuntimeException($this->metaError($decoded, 'Meta WhatsApp API request failed.'));
            return $decoded;
        }
        $handle = curl_init($url);
        $options = [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 15, CURLOPT_TIMEOUT => 45, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . (string) $settings['access_token'], 'Content-Type: application/json']];
        if ($body !== null) $options[CURLOPT_POSTFIELDS] = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        curl_setopt_array($handle, $options);
        $raw = curl_exec($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
        $error = curl_error($handle);
        curl_close($handle);
        $decoded = json_decode((string) $raw, true);
        if ($raw === false || $error !== '' || $status < 200 || $status >= 300 || !is_array($decoded) || isset($decoded['error'])) {
            throw new RuntimeException($this->metaError($decoded, 'Meta WhatsApp API request failed.') . ($status > 0 ? ' (HTTP ' . $status . ')' : ''));
        }
        return $decoded;
    }

    private function graphBaseUrl(array $settings): string
    {
        return 'https://graph.facebook.com/' . $this->normalizeGraphVersion($settings['graph_version'] ?? self::DEFAULT_GRAPH_VERSION);
    }

    private function metaError($decoded, string $fallback): string
    {
        if (is_array($decoded) && is_array($decoded['error'] ?? null)) {
            $error = $decoded['error'];
            $message = trim((string) ($error['message'] ?? ''));
            $code = trim((string) ($error['code'] ?? ''));
            return $message !== '' ? $message . ($code !== '' ? ' [' . $code . ']' : '') : $fallback;
        }
        return $fallback;
    }

    private function handleStatus(array $status): void
    {
        $waId = trim((string) ($status['id'] ?? ''));
        if ($waId === '') return;
        $next = strtolower(trim((string) ($status['status'] ?? '')));
        if ($next === '') return;
        $row = $this->database->fetchOne('SELECT status FROM whatsapp_messages WHERE wa_message_id = :id LIMIT 1', [':id' => $waId]);
        if ($row === null) return;
        $current = strtolower((string) ($row['status'] ?? ''));
        if (($next !== 'failed') && ((self::STATUS_RANK[$next] ?? 0) < (self::STATUS_RANK[$current] ?? 0))) return;
        $error = is_array($status['errors'][0] ?? null) ? $status['errors'][0] : [];
        $this->database->execute('UPDATE whatsapp_messages SET status = :status, error_code = :code, error_message = :message, updated_at = :updated WHERE wa_message_id = :id', [
            ':status' => $next, ':code' => $this->stringOrNull($error['code'] ?? null), ':message' => $this->stringOrNull($error['title'] ?? ($error['message'] ?? null)), ':updated' => $this->database->nowUtc(), ':id' => $waId,
        ]);
    }

    private function handleIncomingMessage(array $message, ?string $profileName, ?array $settings): void
    {
        $waId = trim((string) ($message['from'] ?? ''));
        $messageId = trim((string) ($message['id'] ?? ''));
        if ($waId === '' || $messageId === '') return;
        if ($this->database->fetchOne('SELECT id FROM whatsapp_messages WHERE wa_message_id = :id LIMIT 1', [':id' => $messageId]) !== null) return;
        $contact = $this->upsertInboundContact($waId, $profileName);
        $type = trim((string) ($message['type'] ?? 'text')) ?: 'text';
        $text = null; $caption = null; $mediaId = null; $mime = null; $fileName = null; $localUrl = null;
        if ($type === 'text') $text = (string) ($message['text']['body'] ?? '');
        elseif (in_array($type, ['image', 'video', 'audio', 'document', 'sticker'], true)) {
            $media = is_array($message[$type] ?? null) ? $message[$type] : [];
            $mediaId = $this->stringOrNull($media['id'] ?? null); $mime = $this->stringOrNull($media['mime_type'] ?? null); $caption = $this->stringOrNull($media['caption'] ?? null); $fileName = $this->stringOrNull($media['filename'] ?? null);
            if ($mediaId !== null) $localUrl = $this->downloadMedia($mediaId, $mime ?? 'application/octet-stream', $fileName ?? ($type . '-' . $messageId));
            $text = $caption;
        } elseif ($type === 'interactive') {
            $interactive = is_array($message['interactive'] ?? null) ? $message['interactive'] : [];
            $reply = $interactive['button_reply']['title'] ?? $interactive['list_reply']['title'] ?? null;
            $text = $reply !== null ? (string) $reply : json_encode($interactive, JSON_UNESCAPED_UNICODE);
        } elseif ($type === 'button') $text = (string) ($message['button']['text'] ?? '');
        elseif ($type === 'reaction') $text = 'Reaction ' . (string) ($message['reaction']['emoji'] ?? '');
        elseif ($type === 'location') $text = trim((string) (($message['location']['name'] ?? '') . ' ' . ($message['location']['address'] ?? '') . ' (' . ($message['location']['latitude'] ?? '') . ', ' . ($message['location']['longitude'] ?? '') . ')'));
        else $text = json_encode($message[$type] ?? $message, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $timestamp = (int) ($message['timestamp'] ?? time());
        $messageAt = gmdate('Y-m-d H:i:s', $timestamp > 0 ? $timestamp : time());
        $now = $this->database->nowUtc();
        $this->database->execute(
            'INSERT INTO whatsapp_messages (id, contact_id, wa_message_id, direction, message_type, message_text, caption, media_id, media_url, media_mime_type, file_name, status, payload_json, message_at, created_at, updated_at)
             VALUES (:id, :contact_id, :wa_id, \'inbound\', :type, :text, :caption, :media_id, :media_url, :mime, :file_name, \'received\', :payload, :message_at, :created_at, :updated_at)',
            [':id' => $this->uuid4(), ':contact_id' => $contact['id'], ':wa_id' => $messageId, ':type' => $type, ':text' => $text, ':caption' => $caption, ':media_id' => $mediaId, ':media_url' => $localUrl, ':mime' => $mime, ':file_name' => $fileName, ':payload' => json_encode($message, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), ':message_at' => $messageAt, ':created_at' => $now, ':updated_at' => $now]
        );
        $this->database->execute('UPDATE whatsapp_contacts SET unread_count = unread_count + 1, last_message_preview = :preview, last_message_type = :type, last_message_at = :at, updated_at = :updated WHERE id = :id', [
            ':preview' => $this->preview($text ?: ucfirst($type)), ':type' => $type, ':at' => $messageAt, ':updated' => $now, ':id' => $contact['id'],
        ]);
        $this->sendAutomaticWelcomeIfNeeded($contact, $message, $settings);
    }

    private function sendAutomaticWelcomeIfNeeded(array $contact, array $incomingMessage, ?array $settings): void
    {
        $welcome = trim((string) ($settings['welcome_message'] ?? ''));
        $type = trim((string) ($incomingMessage['type'] ?? ''));
        if ($welcome === '' || !$this->isConfigured($settings) || $type === 'reaction') return;
        $claimed = $this->database->execute(
            'UPDATE whatsapp_contacts SET welcome_sent_at = :sent, updated_at = :updated WHERE id = :id AND welcome_sent_at IS NULL',
            [':sent' => $this->database->nowUtc(), ':updated' => $this->database->nowUtc(), ':id' => $contact['id']]
        );
        if ($claimed < 1) return;
        try {
            $buttons = [];
            if (!empty($settings['get_started_enabled'])) $buttons[] = 'Get Started';
            foreach ($this->jsonDecodeList($settings['ice_breakers_json'] ?? null) as $title) {
                $title = trim((string) $title);
                if ($title === '' || count($buttons) >= 3) continue;
                $buttons[] = mb_substr($title, 0, 20);
            }
            $body = [
                'messaging_product' => 'whatsapp',
                'recipient_type' => 'individual',
                'to' => (string) $contact['wa_id'],
            ];
            $messageType = 'text';
            if ($buttons === []) {
                $body['type'] = 'text';
                $body['text'] = ['preview_url' => false, 'body' => $welcome];
            } else {
                $messageType = 'interactive';
                $body['type'] = 'interactive';
                $body['interactive'] = [
                    'type' => 'button',
                    'body' => ['text' => $welcome],
                    'action' => ['buttons' => array_map(static fn(string $title, int $index): array => [
                        'type' => 'reply',
                        'reply' => ['id' => 'mamepilot_welcome_' . ($index + 1), 'title' => $title],
                    ], $buttons, array_keys($buttons))],
                ];
            }
            $response = $this->graphRequest('POST', '/' . rawurlencode((string) $settings['phone_number_id']) . '/messages', $body, $settings);
            $messageId = (string) (($response['messages'][0]['id'] ?? '') ?: $this->uuid4());
            $this->storeOutboundMessage($contact, $messageId, $messageType, $welcome, null, null, null, 'accepted', null, null, null, ['automaticWelcome' => true, 'buttons' => $buttons]);
        } catch (\Throwable $exception) {
            $this->database->execute('UPDATE whatsapp_contacts SET welcome_sent_at = NULL WHERE id = :id', [':id' => $contact['id']]);
            error_log('WhatsApp welcome could not be sent: ' . $exception->getMessage());
        }
    }

    private function upsertInboundContact(string $waId, ?string $profileName): array
    {
        $existing = $this->database->fetchOne('SELECT * FROM whatsapp_contacts WHERE wa_id = :wa_id LIMIT 1', [':wa_id' => $waId]);
        if ($existing !== null) {
            if ($profileName !== null && trim($profileName) !== '') $this->database->execute('UPDATE whatsapp_contacts SET profile_name = :profile, name = IF(name IS NULL OR name = \'\', :name, name), updated_at = :updated WHERE id = :id', [':profile' => $profileName, ':name' => $profileName, ':updated' => $this->database->nowUtc(), ':id' => $existing['id']]);
            return $existing;
        }
        $now = $this->database->nowUtc(); $id = $this->uuid4();
        $this->database->execute('INSERT INTO whatsapp_contacts (id, wa_id, phone_number, name, profile_name, created_at, updated_at) VALUES (:id, :wa_id, :phone, :name, :profile, :created, :updated)', [':id' => $id, ':wa_id' => $waId, ':phone' => $waId, ':name' => $profileName, ':profile' => $profileName, ':created' => $now, ':updated' => $now]);
        return $this->database->fetchOne('SELECT * FROM whatsapp_contacts WHERE id = :id LIMIT 1', [':id' => $id]) ?: ['id' => $id, 'wa_id' => $waId, 'phone_number' => $waId, 'name' => $profileName];
    }

    private function downloadMedia(string $mediaId, string $mime, string $fileName): ?string
    {
        try {
            $settings = $this->requireConfiguredSettings();
            $metadata = $this->graphRequest('GET', '/' . rawurlencode($mediaId), null, $settings);
            $url = trim((string) ($metadata['url'] ?? ''));
            if ($url === '' || !function_exists('curl_init')) return null;
            $handle = curl_init($url); curl_setopt_array($handle, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60, CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $settings['access_token']]]); $bytes = curl_exec($handle); $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE); curl_close($handle);
            if ($bytes === false || $status < 200 || $status >= 300 || !is_string($bytes)) return null;
            $urlPath = $this->uploadPublicPath('whatsapp'); if (!is_dir($urlPath)) @mkdir($urlPath, 0755, true); $file = $urlPath . DIRECTORY_SEPARATOR . $this->uniqueUploadFilename($this->extensionFromMimeType($mime, $fileName), $fileName); if (file_put_contents($file, $bytes) === false) return null;
            return '/uploads/whatsapp/' . basename($file);
        } catch (\Throwable $exception) { return null; }
    }

    /** @return array<string, mixed> */
    private function mapContact(array $row): array
    {
        $name = trim((string) ($row['name'] ?? '')) ?: trim((string) ($row['profile_name'] ?? '')) ?: (string) ($row['wa_id'] ?? 'Unknown contact');
        return ['id' => (string) ($row['id'] ?? ''), 'waId' => (string) ($row['wa_id'] ?? ''), 'phoneNumber' => (string) ($row['phone_number'] ?? $row['wa_id'] ?? ''), 'name' => $name, 'profileName' => (string) ($row['profile_name'] ?? ''), 'unreadCount' => (int) ($row['unread_count'] ?? 0), 'lastMessagePreview' => (string) ($row['last_message_preview'] ?? ''), 'lastMessageType' => (string) ($row['last_message_type'] ?? ''), 'lastMessageAt' => $this->toIso($row['last_message_at'] ?? null), 'createdAt' => $this->toIso($row['created_at'] ?? null), 'updatedAt' => $this->toIso($row['updated_at'] ?? null)];
    }

    /** @return array<string, mixed> */
    private function mapMessage(array $row): array
    {
        return ['id' => (string) ($row['id'] ?? ''), 'waMessageId' => (string) ($row['wa_message_id'] ?? ''), 'contactId' => (string) ($row['contact_id'] ?? ''), 'direction' => (string) ($row['direction'] ?? ''), 'type' => (string) ($row['message_type'] ?? 'text'), 'text' => (string) ($row['message_text'] ?? ''), 'caption' => (string) ($row['caption'] ?? ''), 'mediaId' => (string) ($row['media_id'] ?? ''), 'mediaUrl' => (string) ($row['media_url'] ?? ''), 'mimeType' => (string) ($row['media_mime_type'] ?? ''), 'fileName' => (string) ($row['file_name'] ?? ''), 'status' => (string) ($row['status'] ?? ''), 'errorCode' => (string) ($row['error_code'] ?? ''), 'errorMessage' => (string) ($row['error_message'] ?? ''), 'messageAt' => $this->toIso($row['message_at'] ?? null), 'createdAt' => $this->toIso($row['created_at'] ?? null)];
    }

    private function preview(string $text): string
    {
        $text = trim(preg_replace('/\s+/', ' ', $text) ?: '');
        return mb_strlen($text) > 500 ? mb_substr($text, 0, 497) . '...' : $text;
    }

    private function stringOrNull($value): ?string
    {
        $value = trim((string) ($value ?? ''));
        return $value === '' ? null : $value;
    }

    private function ensureTables(): void
    {
        if (!$this->tableExists('whatsapp_settings')) $this->database->execute("CREATE TABLE IF NOT EXISTS whatsapp_settings (id VARCHAR(64) NOT NULL, access_token TEXT NULL, phone_number_id VARCHAR(64) NULL, business_account_id VARCHAR(64) NULL, verify_token VARCHAR(255) NULL, app_secret VARCHAR(500) NULL, graph_version VARCHAR(16) NOT NULL DEFAULT 'v25.0', display_phone_number VARCHAR(64) NULL, verified_name VARCHAR(191) NULL, quality_rating VARCHAR(32) NULL, welcome_message TEXT NULL, get_started_enabled TINYINT(1) NOT NULL DEFAULT 0, ice_breakers_json LONGTEXT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        if (!$this->tableExists('whatsapp_contacts')) $this->database->execute("CREATE TABLE IF NOT EXISTS whatsapp_contacts (id VARCHAR(64) NOT NULL, wa_id VARCHAR(32) NOT NULL, phone_number VARCHAR(32) NOT NULL, name VARCHAR(191) NULL, profile_name VARCHAR(191) NULL, unread_count INT NOT NULL DEFAULT 0, last_message_preview VARCHAR(500) NULL, last_message_type VARCHAR(32) NULL, last_message_at DATETIME NULL, welcome_sent_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY uq_whatsapp_contacts_wa_id (wa_id), KEY idx_whatsapp_contacts_last_message_at (last_message_at), KEY idx_whatsapp_contacts_unread (unread_count), KEY idx_whatsapp_contacts_welcome_sent (welcome_sent_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        if (!$this->tableExists('whatsapp_messages')) $this->database->execute("CREATE TABLE IF NOT EXISTS whatsapp_messages (id VARCHAR(64) NOT NULL, contact_id VARCHAR(64) NOT NULL, wa_message_id VARCHAR(255) NULL, direction VARCHAR(16) NOT NULL, message_type VARCHAR(32) NOT NULL DEFAULT 'text', message_text LONGTEXT NULL, caption TEXT NULL, media_id VARCHAR(255) NULL, media_url VARCHAR(500) NULL, media_mime_type VARCHAR(127) NULL, file_name VARCHAR(255) NULL, status VARCHAR(32) NOT NULL DEFAULT 'received', error_code VARCHAR(64) NULL, error_message TEXT NULL, reply_to_message_id VARCHAR(255) NULL, payload_json LONGTEXT NULL, message_at DATETIME NOT NULL, created_by VARCHAR(64) NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, PRIMARY KEY (id), UNIQUE KEY uq_whatsapp_messages_wa_message_id (wa_message_id), KEY idx_whatsapp_messages_contact_time (contact_id, message_at), KEY idx_whatsapp_messages_status (status)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        if (!$this->columnExists('whatsapp_settings', 'welcome_message')) $this->database->execute('ALTER TABLE whatsapp_settings ADD COLUMN welcome_message TEXT NULL AFTER quality_rating');
        if (!$this->columnExists('whatsapp_settings', 'get_started_enabled')) $this->database->execute('ALTER TABLE whatsapp_settings ADD COLUMN get_started_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER welcome_message');
        if (!$this->columnExists('whatsapp_settings', 'ice_breakers_json')) $this->database->execute('ALTER TABLE whatsapp_settings ADD COLUMN ice_breakers_json LONGTEXT NULL AFTER get_started_enabled');
        if (!$this->columnExists('whatsapp_contacts', 'welcome_sent_at')) $this->database->execute('ALTER TABLE whatsapp_contacts ADD COLUMN welcome_sent_at DATETIME NULL AFTER last_message_at');
    }
}
