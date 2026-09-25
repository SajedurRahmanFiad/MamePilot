<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class SmsApi extends BaseService
{
    private const BALANCE_URL = 'https://api.sms.net.bd/user/balance/';
    private const SEND_URL = 'https://api.sms.net.bd/sendsms';

    public function fetchSmsSettings(array $params = []): array
    {
        $this->requireAdmin();
        $row = $this->settingsRow();
        return $this->settingsPayload($row);
    }

    public function updateSmsSettings(array $params): array
    {
        $this->requireAdmin();
        $row = $this->settingsRow();
        $data = [
            'api_key' => trim((string) ($params['apiKey'] ?? $row['api_key'] ?? '')) ?: null,
            'auto_enabled' => (int) (bool) ($params['autoEnabled'] ?? $row['auto_enabled'] ?? false),
            'send_timing' => in_array(($params['sendTiming'] ?? $row['send_timing'] ?? 'after_order'), ['after_order', 'after_call'], true)
                ? (string) ($params['sendTiming'] ?? $row['send_timing'] ?? 'after_order') : 'after_order',
            'call_statuses' => $this->jsonEncode(array_values(array_intersect((array) ($params['callStatuses'] ?? json_decode((string) ($row['call_statuses'] ?? '[]'), true)), ['confirmed', 'cancelled', 'unreachable']))),
            'templates' => $this->jsonEncode((array) ($params['templates'] ?? json_decode((string) ($row['templates'] ?? '{}'), true))),
        ];
        if ($row === null) {
            $now = $this->database->nowUtc();
            $this->database->execute(
                'INSERT INTO sms_settings (id, api_key, auto_enabled, send_timing, call_statuses, templates, created_at, updated_at) VALUES (:id, :api_key, :auto_enabled, :send_timing, :call_statuses, :templates, :created_at, :updated_at)',
                [
                    ':id' => $this->stringId(null),
                    ':api_key' => $data['api_key'],
                    ':auto_enabled' => $data['auto_enabled'],
                    ':send_timing' => $data['send_timing'],
                    ':call_statuses' => $data['call_statuses'],
                    ':templates' => $data['templates'],
                    ':created_at' => $now,
                    ':updated_at' => $now,
                ]
            );
        } else {
            [$set, $bindings] = $this->database->buildSetClause($data);
            $this->database->execute("UPDATE sms_settings SET {$set}, updated_at = :updated_at WHERE id = :id", array_merge($bindings, [':updated_at' => $this->database->nowUtc(), ':id' => $row['id']]));
        }
        return $this->settingsPayload($this->settingsRow());
    }

    public function fetchSmsBalance(array $params = []): array
    {
        $this->requireAdmin();
        $key = $this->apiKey();
        if ($key === '') return ['success' => false, 'balance' => 0, 'message' => 'SMS API key is not configured.'];
        $response = $this->httpJson('GET', self::BALANCE_URL . '?api_key=' . rawurlencode($key), ['Accept' => 'application/json']);
        $body = is_array($response['json']) ? $response['json'] : [];
        return ['success' => (int) ($body['error'] ?? 1) === 0, 'balance' => (float) ($body['data']['balance'] ?? 0), 'message' => (string) ($body['msg'] ?? '')];
    }

    public function sendSms(array $params): array
    {
        $this->requireAdmin();
        $message = trim((string) ($params['message'] ?? ''));
        $customerIds = array_values(array_filter(array_map('strval', (array) ($params['customerIds'] ?? []))));
        if ($message === '' || $customerIds === []) throw new RuntimeException('Customers and message are required.');
        $customers = $this->database->fetchAll('SELECT id, name, phone FROM customers WHERE id IN (' . implode(',', array_fill(0, count($customerIds), '?')) . ') AND deleted_at IS NULL', $customerIds);
        $numbers = array_values(array_filter(array_map(fn(array $customer) => $this->normalizePhone((string) ($customer['phone'] ?? '')), $customers)));
        if ($numbers === []) throw new RuntimeException('No valid customer phone numbers found.');
        $response = $this->httpJson('POST', self::SEND_URL, ['Accept' => 'application/json'], ['api_key' => $this->apiKey(), 'msg' => $message, 'to' => implode(',', $numbers)]);
        $body = is_array($response['json']) ? $response['json'] : [];
        $status = (int) ($body['error'] ?? 1) === 0 ? 'success' : 'failed';
        $this->ensureTables();
        $this->database->execute('INSERT INTO sms_history (id, customer_ids, recipients, message, status, response, created_at) VALUES (:id, :customer_ids, :recipients, :message, :status, :response, :created_at)', [':id' => $this->stringId(null), ':customer_ids' => $this->jsonEncode($customerIds), ':recipients' => implode(',', $numbers), ':message' => $message, ':status' => $status, ':response' => $this->jsonEncode($body), ':created_at' => $this->database->nowUtc()]);
        if ($status !== 'success') throw new RuntimeException((string) ($body['msg'] ?? 'SMS could not be sent.'));
        return ['success' => true, 'message' => (string) ($body['msg'] ?? 'SMS sent successfully.'), 'recipients' => count($numbers)];
    }

    public function queueOrderIfEligible(string $orderId): bool
    {
        if ($orderId === '' || !$this->tableExists('sms_settings')) return false;
        $settings = $this->settingsRow();
        if ($settings === null || empty($settings['auto_enabled']) || ($settings['send_timing'] ?? 'after_order') !== 'after_order') return false;
        $template = (array) (json_decode((string) ($settings['templates'] ?? '{}'), true) ?: []);
        $message = trim((string) ($template['default'] ?? ''));
        if ($message === '') return false;
        $order = $this->database->fetchOne('SELECT o.id, o.order_number, o.total_amount, c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = :id AND o.deleted_at IS NULL', [':id' => $orderId]);
        if (!is_array($order) || trim((string) ($order['customer_id'] ?? '')) === '') return false;
        $values = ['Customer Name' => $order['customer_name'] ?? '', 'Customer Phone' => $order['customer_phone'] ?? '', 'Customer Address' => $order['customer_address'] ?? '', 'Total Price' => $order['total_amount'] ?? '', 'Order Number' => $order['order_number'] ?? ''];
        foreach ($values as $key => $value) $message = str_replace('{{' . $key . '}}', (string) $value, $message);
        try { $this->sendSms(['customerIds' => [(string) $order['customer_id']], 'message' => $message]); return true; } catch (\Throwable $exception) { error_log('Could not send automatic SMS for order ' . $orderId . ': ' . $exception->getMessage()); return false; }
    }

    public function sendAfterCallIfEligible(string $orderId, string $confirmationStatus, string $callStatus): bool
    {
        if ($orderId === '' || !$this->tableExists('sms_settings')) return false;
        $settings = $this->settingsRow();
        if ($settings === null || empty($settings['auto_enabled']) || ($settings['send_timing'] ?? '') !== 'after_call') return false;
        $outcome = $confirmationStatus === 'confirmed' ? 'confirmed' : ($confirmationStatus === 'cancelled' ? 'cancelled' : 'unreachable');
        $statuses = json_decode((string) ($settings['call_statuses'] ?? '[]'), true) ?: [];
        if (!in_array($outcome, $statuses, true)) return false;
        $templates = json_decode((string) ($settings['templates'] ?? '{}'), true) ?: [];
        $message = trim((string) ($templates[$outcome] ?? ''));
        if ($message === '') return false;
        $order = $this->database->fetchOne('SELECT o.order_number, o.total_amount, c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = :id AND o.deleted_at IS NULL', [':id' => $orderId]);
        if (!is_array($order) || trim((string) ($order['customer_id'] ?? '')) === '') return false;
        foreach (['Customer Name' => $order['customer_name'] ?? '', 'Customer Phone' => $order['customer_phone'] ?? '', 'Customer Address' => $order['customer_address'] ?? '', 'Total Price' => $order['total_amount'] ?? '', 'Order Number' => $order['order_number'] ?? ''] as $key => $value) $message = str_replace('{{' . $key . '}}', (string) $value, $message);
        try { $this->sendSms(['customerIds' => [(string) $order['customer_id']], 'message' => $message]); return true; } catch (\Throwable $exception) { error_log('Could not send after-call SMS for order ' . $orderId . ': ' . $exception->getMessage()); return false; }
    }

    public function fetchSmsHistory(array $params = []): array
    {
        $this->requireAdmin(); $this->ensureTables();
        return $this->database->fetchAll('SELECT * FROM sms_history ORDER BY created_at DESC LIMIT 100');
    }

    public function fetchSmsSummary(array $params = []): array
    {
        $this->requireAdmin(); $this->ensureTables();
        $row = $this->database->fetchOne("SELECT COUNT(*) AS total, SUM(status = 'pending') AS pending, MAX(created_at) AS last_sent FROM sms_history");
        $recharge = $this->database->fetchOne("SELECT MAX(created_at) AS last_recharge FROM sms_recharges WHERE status IN ('success', 'completed', 'processing')");
        return ['totalSms' => (int) ($row['total'] ?? 0), 'pendingSms' => (int) ($row['pending'] ?? 0), 'lastSms' => $row['last_sent'] ?? null, 'lastRecharge' => $recharge['last_recharge'] ?? null];
    }

    public function fetchSmsRechargeHistory(array $params = []): array
    {
        $this->requireAdmin(); $this->ensureTables();
        return $this->database->fetchAll('SELECT * FROM sms_recharges ORDER BY created_at DESC LIMIT 100');
    }

    public function initiateSmsRechargeCheckout(array $params): array
    {
        $this->requireAdmin();
        $amount = max(0, (float) ($params['amount'] ?? 0));
        if ($amount <= 0) throw new RuntimeException('Recharge amount must be greater than zero.');
        $gateway = $this->database->fetchOne('SELECT * FROM payment_gateway_settings LIMIT 1') ?: [];
        $baseUrl = rtrim((string) ($gateway['piprapay_base_url'] ?? ''), '/'); $apiKey = trim((string) ($gateway['piprapay_api_key'] ?? ''));
        if ($baseUrl === '' || $apiKey === '') throw new RuntimeException('PipraPay gateway is not configured.');
        $reference = 'SMS-' . strtoupper(substr($this->stringId(null), 0, 12)); $now = $this->database->nowUtc(); $this->ensureTables();
        $returnUrl = $this->absoluteUrl('/#/sms', ['reference' => $reference]);
        $response = $this->httpJson('POST', $baseUrl . '/checkout/redirect', ['MHS-PIPRAPAY-API-KEY' => $apiKey, 'Accept' => 'application/json'], ['full_name' => 'Admin', 'email_address' => 'admin@example.com', 'mobile_number' => '01700000000', 'amount' => number_format($amount, 2, '.', ''), 'currency' => 'BDT', 'metadata' => json_encode(['local_reference' => $reference, 'type' => 'sms_recharge']), 'return_url' => $returnUrl, 'webhook_url' => trim((string) ($gateway['piprapay_webhook_url'] ?? ''))]);
        $body = is_array($response['json']) ? $response['json'] : []; $checkout = (string) ($body['pp_url'] ?? $body['checkout_url'] ?? $body['data']['pp_url'] ?? '');
        if ($checkout === '') throw new RuntimeException('PipraPay did not return a checkout URL.');
        $this->database->execute('INSERT INTO sms_recharges (id, local_reference, gateway_payment_id, amount, status, created_at, updated_at) VALUES (:id, :reference, :gateway_payment_id, :amount, :status, :created_at, :updated_at)', [':id' => $this->stringId(null), ':reference' => $reference, ':gateway_payment_id' => (string) ($body['pp_id'] ?? $body['payment_id'] ?? ''), ':amount' => $amount, ':status' => 'processing', ':created_at' => $now, ':updated_at' => $now]);
        return ['checkoutUrl' => $checkout, 'localReference' => $reference];
    }

    private function apiKey(): string { return trim((string) (($this->settingsRow() ?: [])['api_key'] ?? '')); }
    private function settingsRow(): ?array { $this->ensureTables(); return $this->database->fetchOne('SELECT * FROM sms_settings LIMIT 1'); }
    private function settingsPayload(?array $row): array { return ['apiKey' => (string) ($row['api_key'] ?? ''), 'autoEnabled' => (bool) ($row['auto_enabled'] ?? false), 'sendTiming' => (string) ($row['send_timing'] ?? 'after_order'), 'callStatuses' => json_decode((string) ($row['call_statuses'] ?? '[]'), true) ?: [], 'templates' => json_decode((string) ($row['templates'] ?? '{}'), true) ?: []]; }
    private function normalizePhone(string $phone): string { $phone = preg_replace('/\D+/', '', $phone) ?? ''; return str_starts_with($phone, '880') ? '0' . substr($phone, 3) : $phone; }
    private function ensureTables(): void { $this->database->execute("CREATE TABLE IF NOT EXISTS sms_settings (id VARCHAR(64) NOT NULL, api_key TEXT NULL, auto_enabled TINYINT(1) NOT NULL DEFAULT 0, send_timing VARCHAR(32) NOT NULL DEFAULT 'after_order', call_statuses TEXT NULL, templates LONGTEXT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, PRIMARY KEY (id))"); $this->database->execute("CREATE TABLE IF NOT EXISTS sms_history (id VARCHAR(64) NOT NULL, customer_ids LONGTEXT NULL, recipients TEXT NULL, message TEXT NOT NULL, status VARCHAR(32) NOT NULL, response LONGTEXT NULL, created_at DATETIME NOT NULL, PRIMARY KEY (id))"); $this->database->execute("CREATE TABLE IF NOT EXISTS sms_recharges (id VARCHAR(64) NOT NULL, local_reference VARCHAR(64) NULL, gateway_payment_id VARCHAR(255) NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 0, status VARCHAR(32) NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, PRIMARY KEY (id))"); }
    private function absoluteUrl(string $path, array $query): string { $host = (string) ($_SERVER['HTTP_HOST'] ?? ''); $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http'; return $scheme . '://' . $host . $path . '?' . http_build_query($query); }
}