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
        $availableOutcomes = $this->responseDictionaryOutcomeKeys();
        if (array_key_exists('rules', $params)) {
            $rules = $this->normalizeSmsRuleList($params['rules'], $availableOutcomes);
        } elseif (array_key_exists('sendTiming', $params) || array_key_exists('callStatuses', $params) || array_key_exists('templates', $params)) {
            $legacyRow = $row ?? [];
            if (array_key_exists('sendTiming', $params)) $legacyRow['send_timing'] = $params['sendTiming'];
            if (array_key_exists('callStatuses', $params)) $legacyRow['call_statuses'] = $this->jsonEncode((array) $params['callStatuses']);
            if (array_key_exists('templates', $params)) $legacyRow['templates'] = $this->jsonEncode((array) $params['templates']);
            $rules = $this->normalizeStoredSmsRules($legacyRow, $availableOutcomes);
        } else {
            $rules = $this->normalizeStoredSmsRules($row, $availableOutcomes);
        }
        $firstRule = $rules[0] ?? ['sendTiming' => 'after_order', 'callStatuses' => []];
        $callStatuses = [];
        foreach ($rules as $rule) {
            if ($rule['sendTiming'] === 'after_call') {
                $callStatuses = array_merge($callStatuses, $rule['callStatuses']);
            }
        }
        $data = [
            'api_key' => trim((string) ($params['apiKey'] ?? $row['api_key'] ?? '')) ?: null,
            'auto_enabled' => (int) (bool) ($params['autoEnabled'] ?? $row['auto_enabled'] ?? false),
            'send_timing' => $firstRule['sendTiming'],
            'call_statuses' => $this->jsonEncode(array_values(array_unique($callStatuses))),
            'templates' => $this->jsonEncode(['rules' => $rules]),
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
        return $this->sendSmsToCustomers($customerIds, $message);
    }

    /** @param array<int, string> $customerIds */
    private function sendSmsToCustomers(array $customerIds, string $message): array
    {
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

    public function queueOrderIfEligible(string $orderId, string $sendTiming = 'after_order'): bool
    {
        if ($orderId === '' || !$this->tableExists('sms_settings')) return false;
        $settings = $this->settingsRow();
        if ($settings === null || empty($settings['auto_enabled'])) return false;
        $sent = false;
        foreach ($this->normalizeStoredSmsRules($settings, $this->responseDictionaryOutcomeKeys()) as $rule) {
            if ($rule['sendTiming'] !== $sendTiming) continue;
            $message = trim((string) ($rule['templates']['default'] ?? ''));
            if ($message !== '') $sent = $this->sendAutomaticOrderMessage($orderId, $message) || $sent;
        }
        return $sent;
    }

    public function sendAfterCallIfEligible(string $orderId, string $outcomeKey): bool
    {
        if ($orderId === '' || !$this->tableExists('sms_settings')) return false;
        $settings = $this->settingsRow();
        if ($settings === null || empty($settings['auto_enabled'])) return false;
        if (!in_array($outcomeKey, $this->responseDictionaryOutcomeKeys(), true)) return false;
        $sent = false;
        foreach ($this->normalizeStoredSmsRules($settings, $this->responseDictionaryOutcomeKeys()) as $rule) {
            if ($rule['sendTiming'] !== 'after_call' || !in_array($outcomeKey, $rule['callStatuses'], true)) continue;
            $message = trim((string) ($rule['templates'][$outcomeKey] ?? ''));
            if ($message !== '') $sent = $this->sendAutomaticOrderMessage($orderId, $message) || $sent;
        }
        return $sent;
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

    private function sendAutomaticOrderMessage(string $orderId, string $message): bool
    {
        $order = $this->database->fetchOne(
            'SELECT o.id, o.order_number, o.total_amount, c.id AS customer_id, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address
             FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
             WHERE o.id = :id AND o.deleted_at IS NULL',
            [':id' => $orderId]
        );
        if (!is_array($order) || trim((string) ($order['customer_id'] ?? '')) === '') return false;
        foreach ([
            'Customer Name' => $order['customer_name'] ?? '',
            'Customer Phone' => $order['customer_phone'] ?? '',
            'Customer Address' => $order['customer_address'] ?? '',
            'Total Price' => $order['total_amount'] ?? '',
            'Order Number' => $order['order_number'] ?? '',
        ] as $key => $value) {
            $message = str_replace('{{' . $key . '}}', (string) $value, $message);
        }
        try {
            $this->sendSmsToCustomers([(string) $order['customer_id']], $message);
            return true;
        } catch (\Throwable $exception) {
            error_log('Could not send automatic SMS for order ' . $orderId . ': ' . $exception->getMessage());
            return false;
        }
    }

    /** @return array<string, string> */
    private function responseDictionary(): array
    {
        if (!$this->tableExists('voice_survey_settings')) return [];
        $row = $this->database->fetchOne('SELECT response_dictionary FROM voice_survey_settings LIMIT 1');
        $dictionary = json_decode((string) ($row['response_dictionary'] ?? '{}'), true);
        if (!is_array($dictionary)) return [];
        $normalized = [];
        foreach ($dictionary as $key => $translation) {
            $key = trim((string) $key);
            $translation = trim((string) $translation);
            if ($translation === '' || (!preg_match('/^[0-9*#]$/', $key) && !in_array($key, ['not_answered', 'answered_no_key'], true))) continue;
            $normalized[$key] = $translation;
        }
        return $normalized;
    }

    /** @return array<int, string> */
    private function responseDictionaryOutcomeKeys(): array
    {
        return array_values(array_map('strval', array_keys($this->responseDictionary())));
    }

    /** @param array<int, string> $availableOutcomes
     *  @return array<int, array{id: string, sendTiming: string, callStatuses: array<int, string>, templates: array<string, string>}> */
    private function normalizeSmsRuleList(mixed $value, array $availableOutcomes): array
    {
        if (!is_array($value)) return [];
        $availableOutcomes = array_values(array_map('strval', $availableOutcomes));
        $normalized = [];
        $seenIds = [];
        foreach (array_slice(array_values($value), 0, 100) as $index => $candidate) {
            if (!is_array($candidate)) continue;
            $sendTiming = (string) ($candidate['sendTiming'] ?? 'after_order');
            if (!in_array($sendTiming, ['after_order', 'after_courier_assigned', 'after_call'], true)) $sendTiming = 'after_order';
            $id = trim((string) ($candidate['id'] ?? ''));
            if ($id === '' || isset($seenIds[$id])) $id = 'sms-rule-' . substr(hash('sha256', $index . ':' . serialize($candidate)), 0, 24);
            $seenIds[$id] = true;
            $candidateTemplates = is_array($candidate['templates'] ?? null) ? $candidate['templates'] : [];
            if ($sendTiming === 'after_call') {
                $statuses = array_values(array_unique(array_filter(
                    array_map('strval', (array) ($candidate['callStatuses'] ?? [])),
                    static fn(string $status): bool => in_array($status, $availableOutcomes, true)
                )));
                $templates = [];
                foreach ($statuses as $status) $templates[$status] = (string) ($candidateTemplates[$status] ?? '');
            } else {
                $statuses = [];
                $templates = ['default' => (string) ($candidateTemplates['default'] ?? '')];
            }
            $normalized[] = ['id' => $id, 'sendTiming' => $sendTiming, 'callStatuses' => $statuses, 'templates' => $templates];
        }
        return $normalized;
    }

    /** @param array<string, mixed>|null $row
     *  @param array<int, string> $availableOutcomes
     *  @return array<int, array{id: string, sendTiming: string, callStatuses: array<int, string>, templates: array<string, string>}> */
    private function normalizeStoredSmsRules(?array $row, array $availableOutcomes): array
    {
        $availableOutcomes = array_values(array_map('strval', $availableOutcomes));
        $storedTemplates = json_decode((string) ($row['templates'] ?? '{}'), true);
        if (is_array($storedTemplates) && array_key_exists('rules', $storedTemplates) && is_array($storedTemplates['rules'])) {
            return $this->normalizeSmsRuleList($storedTemplates['rules'], $availableOutcomes);
        }

        $sendTiming = (string) ($row['send_timing'] ?? 'after_order');
        if (!in_array($sendTiming, ['after_order', 'after_courier_assigned', 'after_call'], true)) $sendTiming = 'after_order';
        $legacyTemplates = is_array($storedTemplates) ? $storedTemplates : [];
        $legacyStatuses = json_decode((string) ($row['call_statuses'] ?? '[]'), true);
        $statuses = [];
        $templates = ['default' => (string) ($legacyTemplates['default'] ?? '')];
        if ($sendTiming === 'after_call') {
            $legacyOutcomeKeys = ['confirmed' => '1', 'cancelled' => '2', 'unreachable' => 'not_answered'];
            foreach (is_array($legacyStatuses) ? $legacyStatuses : [] as $legacyStatus) {
                $legacyStatus = (string) $legacyStatus;
                $outcomeKey = $legacyOutcomeKeys[$legacyStatus] ?? $legacyStatus;
                if (!in_array($outcomeKey, $availableOutcomes, true)) continue;
                $statuses[] = $outcomeKey;
                $templates[$outcomeKey] = (string) ($legacyTemplates[$legacyStatus] ?? $legacyTemplates[$outcomeKey] ?? '');
            }
        }
        return $this->normalizeSmsRuleList([[
            'id' => 'sms-rule-legacy',
            'sendTiming' => $sendTiming,
            'callStatuses' => $statuses,
            'templates' => $templates,
        ]], $availableOutcomes);
    }

    private function apiKey(): string { return trim((string) (($this->settingsRow() ?: [])['api_key'] ?? '')); }
    private function settingsRow(): ?array { $this->ensureTables(); return $this->database->fetchOne('SELECT * FROM sms_settings LIMIT 1'); }
    private function settingsPayload(?array $row): array
    {
        $availableOutcomes = $this->responseDictionaryOutcomeKeys();
        $rules = $this->normalizeStoredSmsRules($row, $availableOutcomes);
        $firstRule = $rules[0] ?? ['sendTiming' => 'after_order', 'callStatuses' => [], 'templates' => ['default' => '']];
        return [
            'apiKey' => (string) ($row['api_key'] ?? ''),
            'autoEnabled' => (bool) ($row['auto_enabled'] ?? false),
            'rules' => $rules,
            'sendTiming' => $firstRule['sendTiming'],
            'callStatuses' => $firstRule['callStatuses'],
            'templates' => $firstRule['templates'],
        ];
    }
    private function normalizePhone(string $phone): string { $phone = preg_replace('/\D+/', '', $phone) ?? ''; return str_starts_with($phone, '880') ? '0' . substr($phone, 3) : $phone; }
    private function ensureTables(): void { $this->database->execute("CREATE TABLE IF NOT EXISTS sms_settings (id VARCHAR(64) NOT NULL, api_key TEXT NULL, auto_enabled TINYINT(1) NOT NULL DEFAULT 0, send_timing VARCHAR(32) NOT NULL DEFAULT 'after_order', call_statuses TEXT NULL, templates LONGTEXT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, PRIMARY KEY (id))"); $this->database->execute("CREATE TABLE IF NOT EXISTS sms_history (id VARCHAR(64) NOT NULL, customer_ids LONGTEXT NULL, recipients TEXT NULL, message TEXT NOT NULL, status VARCHAR(32) NOT NULL, response LONGTEXT NULL, created_at DATETIME NOT NULL, PRIMARY KEY (id))"); $this->database->execute("CREATE TABLE IF NOT EXISTS sms_recharges (id VARCHAR(64) NOT NULL, local_reference VARCHAR(64) NULL, gateway_payment_id VARCHAR(255) NULL, amount DECIMAL(12,2) NOT NULL DEFAULT 0, status VARCHAR(32) NOT NULL, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL, PRIMARY KEY (id))"); }
    private function absoluteUrl(string $path, array $query): string { $host = (string) ($_SERVER['HTTP_HOST'] ?? ''); $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http'; return $scheme . '://' . $host . $path . '?' . http_build_query($query); }
}