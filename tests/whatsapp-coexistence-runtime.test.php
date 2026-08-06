<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\ApiException;
use App\Config;
use App\Database;
use App\WhatsAppApi;

function whatsappCoexistenceAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = dirname(__DIR__);
$config = Config::load($root);
$database = new Database($config);
$auth = new Auth($config, $database);
$actor = $database->fetchOne("SELECT id, phone, role FROM users WHERE role = 'Developer' AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1");
if ($actor === null) throw new RuntimeException('Local Developer test actor is unavailable.');
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);
$whatsapp = new WhatsAppApi($database, $auth, $config);
// Run lazy, row-preserving schema initialization before opening the test
// transaction. MySQL DDL implicitly commits, so doing this inside the
// transaction could let the test fixtures escape rollback on an older schema.
$whatsapp->fetchWhatsAppSettings();
$pdo = $database->connect();
$pdo->beginTransaction();
try {
    $stamp = substr(hash('sha256', uniqid('whatsapp-coexistence-', true)), 0, 18);
    $admin = $database->fetchOne("SELECT id, phone, role FROM users WHERE role = 'Admin' AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1");
    if ($admin !== null) {
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($admin);
        $adminRejected = false;
        try {
            $whatsapp->updateWhatsAppEmbeddedSignupConfiguration([
                'embeddedSignupAppId' => '123456789012345',
                'embeddedSignupConfigId' => '987654321098765',
                'appSecret' => 'must-not-save',
                'webhookUrl' => 'https://example.com/api/whatsapp-webhook.php',
                'verifyToken' => 'must-not-save-verify-token',
                'graphVersion' => 'v25.0',
            ]);
        } catch (ApiException $exception) {
            $adminRejected = $exception->httpStatus() === 403 && $exception->errorCode() === 'DEVELOPER_ACCESS_REQUIRED';
        }
        whatsappCoexistenceAssert($adminRejected, 'An Admin was allowed to change developer-owned Embedded Signup credentials.');
        $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);
    }
    $embeddedConfiguration = $whatsapp->updateWhatsAppEmbeddedSignupConfiguration([
        'embeddedSignupAppId' => '123456789012345',
        'embeddedSignupConfigId' => '987654321098765',
        'appSecret' => 'coexistence-embedded-app-secret',
        'webhookUrl' => 'https://example.com/api/whatsapp-webhook.php',
        'verifyToken' => 'meta-token',
        'graphVersion' => 'v25.0',
    ]);
    whatsappCoexistenceAssert(($embeddedConfiguration['appSecret'] ?? null) === '' && ($embeddedConfiguration['verifyToken'] ?? null) === '', 'Embedded Signup secrets leaked through the settings response.');
    whatsappCoexistenceAssert(!empty($embeddedConfiguration['hasAppSecret']) && !empty($embeddedConfiguration['hasVerifyToken']), 'Embedded Signup secret-presence flags were not returned.');
    whatsappCoexistenceAssert(!empty($embeddedConfiguration['embeddedSignupConfigurationUpdatedAt']), 'Embedded Signup save confirmation time was not returned.');
    $storedConfiguration = $database->fetchOne('SELECT embedded_signup_app_id, embedded_signup_config_id, app_secret, webhook_url, verify_token FROM whatsapp_settings WHERE id = :id', [':id' => 'whatsapp-default']);
    whatsappCoexistenceAssert(($storedConfiguration['embedded_signup_app_id'] ?? '') === '123456789012345' && ($storedConfiguration['embedded_signup_config_id'] ?? '') === '987654321098765', 'Embedded Signup identifiers were not persisted.');
    whatsappCoexistenceAssert(($storedConfiguration['app_secret'] ?? '') === 'coexistence-embedded-app-secret' && ($storedConfiguration['verify_token'] ?? '') === 'meta-token', 'Embedded Signup write-only secrets were not persisted, including a valid short Meta verify token.');
    $whatsapp->updateWhatsAppEmbeddedSignupConfiguration([
        'embeddedSignupAppId' => '123456789012345',
        'embeddedSignupConfigId' => '987654321098765',
        'appSecret' => '',
        'webhookUrl' => 'https://example.com/api/whatsapp-webhook.php',
        'verifyToken' => '',
        'graphVersion' => 'v25.0',
    ]);
    $preservedConfiguration = $database->fetchOne('SELECT app_secret, verify_token FROM whatsapp_settings WHERE id = :id', [':id' => 'whatsapp-default']);
    whatsappCoexistenceAssert(($preservedConfiguration['app_secret'] ?? '') === 'coexistence-embedded-app-secret' && ($preservedConfiguration['verify_token'] ?? '') === 'meta-token', 'Blank Embedded Signup secrets did not preserve stored values.');
    $savedSettings = $whatsapp->updateWhatsAppSettings([
        'accessToken' => 'coexistence-test-token', 'phoneNumberId' => '8801700000000',
        'businessAccountId' => '8801700000001', 'verifyToken' => 'coexistence-verify-token',
        'appSecret' => 'coexistence-app-secret', 'graphVersion' => 'v25.0',
    ]);
    whatsappCoexistenceAssert(($savedSettings['accessToken'] ?? null) === '' && ($savedSettings['appSecret'] ?? null) === '' && ($savedSettings['verifyToken'] ?? null) === '', 'WhatsApp credentials leaked through the settings response.');
    whatsappCoexistenceAssert(!empty($savedSettings['hasAccessToken']) && !empty($savedSettings['hasAppSecret']), 'WhatsApp credential-presence flags were not preserved.');
    $database->execute('UPDATE whatsapp_settings SET display_phone_number = :phone, platform_type = :platform, is_on_biz_app = 1, connection_status = \'connected\' WHERE id = :id', [
        ':phone' => '8801700000000', ':platform' => 'CLOUD_API', ':id' => 'whatsapp-default',
    ]);

    $payload = [
        'entry' => [[
            'changes' => [
                ['field' => 'messages', 'value' => ['contacts' => [['wa_id' => '8801800000000', 'profile' => ['name' => 'Inbound customer']]], 'messages' => [['from' => '8801800000000', 'id' => 'wamid.in.' . $stamp, 'timestamp' => (string) time(), 'type' => 'text', 'text' => ['body' => 'Hello from customer']]]]],
                ['field' => 'smb_message_echoes', 'value' => ['messages' => [['from' => '8801700000000', 'to' => '8801800000000', 'id' => 'wamid.echo.' . $stamp, 'timestamp' => (string) time(), 'type' => 'text', 'text' => ['body' => 'Sent from Business app']]]]],
            ],
        ]],
    ];
    $raw = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (!is_string($raw)) throw new RuntimeException('Could not encode WhatsApp test payload.');
    $signature = 'sha256=' . hash_hmac('sha256', $raw, 'coexistence-app-secret');
    $rejected = false;
    try { $whatsapp->handleWebhook($raw, 'sha256=wrong'); }
    catch (RuntimeException $exception) { $rejected = str_contains($exception->getMessage(), 'signature'); }
    whatsappCoexistenceAssert($rejected, 'Invalid WhatsApp signature was accepted or failed for the wrong reason.');
    $result = $whatsapp->handleWebhook($raw, $signature);
    whatsappCoexistenceAssert((int) ($result['processed'] ?? 0) === 2, 'Inbound and Business app echo messages were not both processed.');
    $whatsapp->handleWebhook($raw, $signature);
    $rows = $database->fetchAll('SELECT direction, message_text FROM whatsapp_messages WHERE wa_message_id LIKE :prefix ORDER BY direction ASC', [':prefix' => 'wamid.%.' . $stamp]);
    whatsappCoexistenceAssert(count($rows) === 2, 'WhatsApp webhook messages were not persisted exactly once.');
    whatsappCoexistenceAssert(($rows[0]['direction'] ?? '') === 'inbound' && ($rows[1]['direction'] ?? '') === 'outbound', 'Business app echo direction was not preserved.');

    $disconnectPayload = ['entry' => [['changes' => [['field' => 'account_update', 'value' => ['event' => 'PARTNER_REMOVED']]]]]];
    $disconnectRaw = json_encode($disconnectPayload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if (!is_string($disconnectRaw)) throw new RuntimeException('Could not encode WhatsApp disconnect payload.');
    $whatsapp->handleWebhook($disconnectRaw, 'sha256=' . hash_hmac('sha256', $disconnectRaw, 'coexistence-app-secret'));
    $disconnectedSettings = $whatsapp->fetchWhatsAppSettings();
    whatsappCoexistenceAssert(($disconnectedSettings['connectionStatus'] ?? '') === 'disconnected' && empty($disconnectedSettings['isOnBizApp']), 'WhatsApp Business app disconnect state was not persisted.');
    $pdo->rollBack();
    echo "WhatsApp Coexistence runtime checks passed.\n";
} catch (Throwable $exception) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    throw $exception;
}
