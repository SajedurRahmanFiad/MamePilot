<?php

declare(strict_types=1);

namespace App;

use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;
use Throwable;

final class ChatPushService
{
    public function __construct(private Database $database, private Config $config)
    {
    }

    public function settingsForDevice(string $userId, string $channel, string $endpoint): array
    {
        $keys = $this->vapidKeys();
        $enabled = false;
        if ($endpoint !== '') {
            $row = $this->database->fetchOne(
                'SELECT messenger_enabled, whatsapp_enabled FROM chat_push_subscriptions WHERE user_id = :user_id AND endpoint_hash = :endpoint_hash LIMIT 1',
                [':user_id' => $userId, ':endpoint_hash' => hash('sha256', $endpoint)]
            );
            $enabled = $channel === 'messenger'
                ? !empty($row['messenger_enabled'])
                : !empty($row['whatsapp_enabled']);
        }

        return [
            'supported' => $keys !== null && function_exists('openssl_sign'),
            'vapidPublicKey' => $keys['publicKey'] ?? '',
            'enabled' => $enabled,
        ];
    }

    public function updateDevicePreference(string $userId, string $channel, array $subscription, bool $enabled): array
    {
        $keys = $this->vapidKeys();
        if ($enabled && $keys === null) {
            throw new \RuntimeException('Browser push is not configured on this server.');
        }
        if (!in_array($channel, ['messenger', 'whatsapp'], true)) {
            throw new \RuntimeException('Invalid chat notification channel.');
        }

        $endpoint = trim((string) ($subscription['endpoint'] ?? ''));
        $subscriptionKeys = is_array($subscription['keys'] ?? null) ? $subscription['keys'] : [];
        $publicKey = trim((string) ($subscriptionKeys['p256dh'] ?? ''));
        $authSecret = trim((string) ($subscriptionKeys['auth'] ?? ''));
        if (strlen($endpoint) > 4000 || !$this->isAllowedEndpoint($endpoint) || $publicKey === '' || $authSecret === '') {
            throw new \RuntimeException('The browser push subscription is invalid. Please enable notifications again.');
        }

        $now = $this->database->nowUtc();
        $endpointHash = hash('sha256', $endpoint);
        $this->database->execute(
            'INSERT INTO chat_push_subscriptions (id, user_id, endpoint_hash, endpoint, p256dh_key, auth_secret, messenger_enabled, whatsapp_enabled, last_seen_at, created_at, updated_at)
             VALUES (:id, :user_id, :endpoint_hash, :endpoint, :p256dh, :auth_secret, 0, 0, :last_seen, :created_at, :updated_at)
             ON DUPLICATE KEY UPDATE endpoint = VALUES(endpoint), p256dh_key = VALUES(p256dh_key), auth_secret = VALUES(auth_secret), last_seen_at = VALUES(last_seen_at), updated_at = VALUES(updated_at)',
            [
                ':id' => $this->uuid4(), ':user_id' => $userId, ':endpoint_hash' => $endpointHash,
                ':endpoint' => $endpoint, ':p256dh' => $publicKey, ':auth_secret' => $authSecret,
                ':last_seen' => $now, ':created_at' => $now, ':updated_at' => $now,
            ]
        );
        $column = $channel === 'messenger' ? 'messenger_enabled' : 'whatsapp_enabled';
        $this->database->execute(
            'UPDATE chat_push_subscriptions SET ' . $column . ' = :enabled, last_seen_at = :last_seen, updated_at = :updated WHERE user_id = :user_id AND endpoint_hash = :endpoint_hash',
            [':enabled' => $enabled ? 1 : 0, ':last_seen' => $now, ':updated' => $now, ':user_id' => $userId, ':endpoint_hash' => $endpointHash]
        );

        return $this->settingsForDevice($userId, $channel, $endpoint);
    }

    public function notifyInboundMessage(string $channel, string $messageId, string $contactId, string $customerName, string $preview): void
    {
        if (!in_array($channel, ['messenger', 'whatsapp'], true) || $messageId === '' || $contactId === '') return;
        $keys = $this->vapidKeys();
        if ($keys === null) return;

        try {
            $channelColumn = $channel . '_enabled';
            $subscriptions = $this->database->fetchAll(
                'SELECT s.* FROM chat_push_subscriptions s INNER JOIN users u ON u.id = s.user_id WHERE s.' . $channelColumn . ' = 1 AND u.deleted_at IS NULL'
            );
            $webPush = new WebPush([
                'VAPID' => [
                    'subject' => $keys['subject'],
                    'publicKey' => $keys['publicKey'],
                    'privateKey' => $keys['privateKey'],
                ],
            ], ['TTL' => 60, 'urgency' => 'high']);

            $platformName = $channel === 'messenger' ? 'Messenger' : 'WhatsApp';
            $customerLabel = trim($customerName) !== '' ? trim($customerName) : 'New contact';
            $title = $platformName . ': ' . $customerLabel;
            $body = preg_replace('/\s+/u', ' ', trim($preview)) ?? trim($preview);
            if ($body === '') $body = 'New ' . $platformName . ' message';
            $body = mb_substr($body, 0, 120);
            $payload = json_encode([
                'title' => mb_substr($title, 0, 120),
                'body' => $body,
                'channel' => $channel,
                'contactId' => $contactId,
                'messageId' => $messageId,
                'url' => '/#/' . $channel . '?contactId=' . rawurlencode($contactId),
                'tag' => 'mamepilot-' . $channel . '-' . $contactId,
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            if (!is_string($payload)) return;

            foreach ($subscriptions as $row) {
                $deliveryId = $this->uuid4();
                $now = $this->database->nowUtc();
                $inserted = $this->database->execute(
                    'INSERT IGNORE INTO chat_push_deliveries (id, subscription_id, channel, message_id, status, created_at, updated_at)
                     VALUES (:id, :subscription_id, :channel, :message_id, \'queued\', :created_at, :updated_at)',
                    [':id' => $deliveryId, ':subscription_id' => (string) $row['id'], ':channel' => $channel, ':message_id' => $messageId, ':created_at' => $now, ':updated_at' => $now]
                );
                if ($inserted < 1) continue;

                try {
                    $subscription = Subscription::create([
                        'endpoint' => (string) $row['endpoint'],
                        'keys' => ['p256dh' => (string) $row['p256dh_key'], 'auth' => (string) $row['auth_secret']],
                    ]);
                    $report = $webPush->sendOneNotification($subscription, $payload);
                    $success = $report->isSuccess();
                    $this->database->execute(
                        'UPDATE chat_push_deliveries SET status = :status, detail = :detail, sent_at = :sent_at, updated_at = :updated_at WHERE id = :id',
                        [
                            ':status' => $success ? 'sent' : 'failed',
                            ':detail' => $success ? null : mb_substr((string) $report->getReason(), 0, 1000),
                            ':sent_at' => $success ? $this->database->nowUtc() : null,
                            ':updated_at' => $this->database->nowUtc(), ':id' => $deliveryId,
                        ]
                    );
                    if (!$success && $report->isSubscriptionExpired()) {
                        $this->database->execute('DELETE FROM chat_push_subscriptions WHERE id = :id', [':id' => (string) $row['id']]);
                    }
                } catch (Throwable $exception) {
                    $this->database->execute(
                        'UPDATE chat_push_deliveries SET status = \'failed\', detail = :detail, updated_at = :updated_at WHERE id = :id',
                        [':detail' => mb_substr($exception->getMessage(), 0, 1000), ':updated_at' => $this->database->nowUtc(), ':id' => $deliveryId]
                    );
                }
            }
        } catch (Throwable $exception) {
            error_log('[ChatPush] ' . $exception->getMessage());
        }
    }

    private function vapidKeys(): ?array
    {
        $publicKey = trim((string) $this->config->get('WEB_PUSH_VAPID_PUBLIC_KEY', ''));
        $privateKey = trim((string) $this->config->get('WEB_PUSH_VAPID_PRIVATE_KEY', ''));
        $subject = trim((string) $this->config->get('WEB_PUSH_VAPID_SUBJECT', ''));
        if ($publicKey === '' || $privateKey === '' || $subject === '') return null;
        return ['publicKey' => $publicKey, 'privateKey' => $privateKey, 'subject' => $subject];
    }

    private function isAllowedEndpoint(string $endpoint): bool
    {
        $parts = parse_url($endpoint);
        $host = strtolower((string) ($parts['host'] ?? ''));
        if (($parts['scheme'] ?? '') !== 'https' || $host === '' || isset($parts['user']) || isset($parts['pass'])) return false;
        if (isset($parts['port']) && (int) $parts['port'] !== 443) return false;

        foreach (['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'] as $allowedHost) {
            if ($host === $allowedHost || str_ends_with($host, '.' . $allowedHost)) return true;
        }
        return false;
    }

    private function uuid4(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        $hex = bin2hex($bytes);
        return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20);
    }
}