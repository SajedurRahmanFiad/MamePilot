<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class AutoCallApi extends BaseService
{
    private const SURVEY_API_BASE = 'https://api.awajdigital.com/api/surveys';
    private const SURVEY_STATUSES_PENDING = ['pending'];
    private const SURVEY_STATUSES_ACTIVE = ['initiated', 'triggered'];
    private const SURVEY_STATUSES_FINAL = ['completed', 'failed', 'skipped'];

    // ── Settings ──────────────────────────────────────────────────────

    public function fetchVoiceSurveySettings(array $params = []): array
    {
        $this->requireAdmin();
        $row = $this->fetchSettingsRow();

        $triggerStatuses = $this->normalizeTriggerStatuses(
            json_decode((string) ($row['trigger_statuses'] ?? '[]'), true)
        );

        return [
            'enabled' => (bool) ($row['enabled'] ?? false),
            'delayMinutes' => (int) ($row['delay_minutes'] ?? 5),
            'missedCallRetryMinutes' => (int) ($row['missed_call_retry_minutes'] ?? 30),
            'missedCallRetryCount' => (int) ($row['missed_call_retry_count'] ?? 3),
            'noKeyRetryMinutes' => (int) ($row['no_key_retry_minutes'] ?? 10),
            'noKeyRetryCount' => (int) ($row['no_key_retry_count'] ?? 2),
            'triggerStatuses' => $triggerStatuses,
            'workerHealth' => $this->buildWorkerHealth($row ?? []),
        ];
    }

    public function updateVoiceSurveySettings(array $params): array
    {
        $this->requireAdmin();
        $existing = $this->fetchSettingsRow();

        $triggerStatuses = array_key_exists('triggerStatuses', $params)
            ? $this->normalizeTriggerStatuses($params['triggerStatuses'])
            : $this->normalizeTriggerStatuses(json_decode((string) ($existing['trigger_statuses'] ?? '[]'), true));

        $data = [
            'enabled' => isset($params['enabled']) ? (int) (bool) $params['enabled'] : (int) ($existing['enabled'] ?? 0),
            'delay_minutes' => (int) ($params['delayMinutes'] ?? $existing['delay_minutes'] ?? 5),
            'api_token' => $this->nullableString($existing['api_token'] ?? null),
            'sender' => $this->nullableString($existing['sender'] ?? null),
            'template_name' => $this->nullableString($existing['template_name'] ?? null),
            'webhook_secret' => $this->nullableString($existing['webhook_secret'] ?? null),
            'max_survey_time_seconds' => (int) ($existing['max_survey_time_seconds'] ?? 120),
            'missed_call_retry_minutes' => (int) ($params['missedCallRetryMinutes'] ?? $existing['missed_call_retry_minutes'] ?? 30),
            'missed_call_retry_count' => (int) ($params['missedCallRetryCount'] ?? $existing['missed_call_retry_count'] ?? 3),
            'no_key_retry_minutes' => (int) ($params['noKeyRetryMinutes'] ?? $existing['no_key_retry_minutes'] ?? 10),
            'no_key_retry_count' => (int) ($params['noKeyRetryCount'] ?? $existing['no_key_retry_count'] ?? 2),
            'trigger_statuses' => $this->jsonEncode($triggerStatuses),
        ];

        if ($existing === null) {
            $id = $this->stringId(null);
            $now = $this->database->nowUtc();
            $insertParams = $this->insertBindings($data);
            $this->database->execute(
                'INSERT INTO voice_survey_settings (id, enabled, delay_minutes, api_token, sender, template_name, webhook_secret, max_survey_time_seconds, missed_call_retry_minutes, missed_call_retry_count, no_key_retry_minutes, no_key_retry_count, trigger_statuses, created_at, updated_at) VALUES (:id, :enabled, :delay_minutes, :api_token, :sender, :template_name, :webhook_secret, :max_survey_time_seconds, :missed_call_retry_minutes, :missed_call_retry_count, :no_key_retry_minutes, :no_key_retry_count, :trigger_statuses, :created_at, :updated_at)',
                array_merge($insertParams, [':id' => $id, ':created_at' => $now, ':updated_at' => $now])
            );
        } else {
            [$setClause, $setParams] = $this->database->buildSetClause($data);
            $this->database->execute(
                "UPDATE voice_survey_settings SET {$setClause}, updated_at = :updated_at WHERE id = :id",
                array_merge($setParams, [':updated_at' => $this->database->nowUtc(), ':id' => $existing['id']])
            );
        }

        return $this->fetchVoiceSurveySettings();
    }

    public function fetchVoiceSurveyIntegrationSettings(array $params = []): array
    {
        $this->requireDeveloperUser();
        $row = $this->fetchSettingsRow();

        return [
            'apiToken' => (string) ($row['api_token'] ?? ''),
            'sender' => (string) ($row['sender'] ?? ''),
            'templateName' => (string) ($row['template_name'] ?? ''),
            'webhookSecret' => (string) ($row['webhook_secret'] ?? ''),
            'webhookUrl' => $this->buildWebhookUrl($row ?? []),
        ];
    }

    public function updateVoiceSurveyIntegrationSettings(array $params): array
    {
        $this->requireDeveloperUser();
        $existing = $this->fetchSettingsRow();
        $existingWebhookSecret = trim((string) ($existing['webhook_secret'] ?? ''));
        $webhookSecret = $this->nullableString($params['webhookSecret'] ?? $existing['webhook_secret'] ?? null);
        if ($webhookSecret === null) {
            $webhookSecret = bin2hex(random_bytes(32));
        }
        $webhookUrl = $this->nullableString($params['webhookUrl'] ?? null);
        $secretChanged = !hash_equals($existingWebhookSecret, $webhookSecret);
        if ($webhookUrl === null || ($secretChanged && strpos($webhookUrl, urlencode($webhookSecret)) === false)) {
            $webhookUrl = $this->deriveWebhookUrl($webhookSecret);
        }
        $this->assertWebhookUrlValid($webhookUrl, $webhookSecret);

        $data = [
            'api_token' => $this->nullableString($params['apiToken'] ?? $existing['api_token'] ?? null),
            'sender' => $this->nullableString($params['sender'] ?? $existing['sender'] ?? null),
            'template_name' => $this->nullableString($params['templateName'] ?? $existing['template_name'] ?? null),
            'webhook_secret' => $webhookSecret,
            'webhook_url' => $webhookUrl,
        ];

        if ($existing === null) {
            $now = $this->database->nowUtc();
            $insertParams = $this->insertBindings($data);
            $this->database->execute(
                'INSERT INTO voice_survey_settings (id, enabled, delay_minutes, api_token, sender, template_name, webhook_secret, webhook_url, max_survey_time_seconds, missed_call_retry_minutes, missed_call_retry_count, no_key_retry_minutes, no_key_retry_count, trigger_statuses, created_at, updated_at) VALUES (:id, 0, 5, :api_token, :sender, :template_name, :webhook_secret, :webhook_url, 120, 30, 3, 10, 2, :trigger_statuses, :created_at, :updated_at)',
                array_merge($insertParams, [':id' => $this->stringId(null), ':trigger_statuses' => '["On Hold"]', ':created_at' => $now, ':updated_at' => $now])
            );
        } else {
            [$setClause, $setParams] = $this->database->buildSetClause($data);
            $this->database->execute(
                "UPDATE voice_survey_settings SET {$setClause}, updated_at = :updated_at WHERE id = :id",
                array_merge($setParams, [':updated_at' => $this->database->nowUtc(), ':id' => $existing['id']])
            );
        }

        return $this->fetchVoiceSurveyIntegrationSettings();
    }

    public function queueOrderIfEligible(string $orderId, string $status): bool
    {
        if (!$this->tableExists('voice_survey_settings') || !$this->columnExists('orders', 'survey_status')) {
            return false;
        }
        $settings = $this->fetchSettingsRow();
        if ($settings === null || !($settings['enabled'] ?? false)) {
            return false;
        }
        if (!in_array($status, $this->getTriggerStatuses($settings), true)) {
            return false;
        }

        $queued = $this->database->execute(
            "UPDATE orders SET survey_status = 'pending', survey_next_retry_at = NULL, survey_retry_count = 0, survey_call_status = NULL, survey_response = NULL, confirmation_status = NULL, updated_at = :now WHERE id = :id AND deleted_at IS NULL AND (survey_status IS NULL OR survey_status = '')",
            [':now' => $this->database->nowUtc(), ':id' => $orderId]
        );
        if ($queued === 1) {
            $this->logSurveyEvent($orderId, 'queued', null, 'pending', null, 'Automatic survey queued.');
        }
        return $queued === 1;
    }

    // ── Survey Actions ────────────────────────────────────────────────

    public function triggerSurveyCall(array $params): array
    {
        $this->requireAdmin();
        $orderId = trim((string) ($params['orderId'] ?? ''));
        if ($orderId === '') {
            throw new RuntimeException('Order ID is required.');
        }

        $order = $this->fetchOrderRow($orderId);
        if ($order === null) {
            throw new RuntimeException('Order not found.');
        }

        $settings = $this->fetchSettingsRow();
        $this->assertSurveyEnabled($settings);

        $phone = $this->resolveCustomerPhone($order);
        if ($phone === null) {
            throw new RuntimeException('Customer phone number not found.');
        }

        $this->database->execute(
            "UPDATE orders SET survey_status = 'pending', survey_next_retry_at = NULL, survey_retry_count = 0, survey_call_status = NULL, survey_response = NULL, confirmation_status = NULL, updated_at = :updated_at WHERE id = :id",
            [':updated_at' => $this->database->nowUtc(), ':id' => $orderId]
        );
        $this->logSurveyEvent($orderId, 'queued', null, 'pending', null, 'Survey queued manually.');

        if (!$this->initiateSurveyCall($order, $settings)) {
            throw new RuntimeException('Survey call could not be started. Check the customer phone number and call status.');
        }

        return ['success' => true, 'message' => 'Survey call triggered.'];
    }

    public function retrySurveyCall(array $params): array
    {
        $this->requireAdmin();
        $orderId = trim((string) ($params['orderId'] ?? ''));
        if ($orderId === '') {
            throw new RuntimeException('Order ID is required.');
        }

        $order = $this->fetchOrderRow($orderId);
        if ($order === null) {
            throw new RuntimeException('Order not found.');
        }

        $settings = $this->fetchSettingsRow();
        $this->assertSurveyEnabled($settings);

        $this->database->execute(
            "UPDATE orders SET survey_status = 'pending', survey_next_retry_at = NULL, survey_id = NULL, updated_at = :updated_at WHERE id = :id AND survey_status IN ('completed', 'failed', 'initiated', 'triggered')",
            [':updated_at' => $this->database->nowUtc(), ':id' => $orderId]
        );

        $freshOrder = $this->fetchOrderRow($orderId);
        $this->logSurveyEvent($orderId, 'retry_initiated', null, 'triggered', null, 'Manual retry initiated.');
        if ($freshOrder !== null) {
            $freshOrder['survey_retry_count'] = 0;
        }
        if ($freshOrder === null || !$this->initiateSurveyCall($freshOrder, $settings)) {
            throw new RuntimeException('Survey call retry could not be started.');
        }

        return ['success' => true, 'message' => 'Survey call retry triggered.'];
    }

    public function cancelSurveyCall(array $params): array
    {
        $this->requireAdmin();
        $orderId = trim((string) ($params['orderId'] ?? ''));
        if ($orderId === '') {
            throw new RuntimeException('Order ID is required.');
        }

        $this->database->execute(
            "UPDATE orders SET survey_status = 'skipped', survey_next_retry_at = NULL, updated_at = :updated_at WHERE id = :id AND survey_status NOT IN ('completed', 'skipped')",
            [':updated_at' => $this->database->nowUtc(), ':id' => $orderId]
        );
        $this->logSurveyEvent($orderId, 'cancelled', null, 'skipped', null, 'Survey cancelled manually.');

        return ['success' => true, 'message' => 'Survey call cancelled.'];
    }

    public function fetchOrderSurveyStatus(array $params): array
    {
        $orderId = trim((string) ($params['orderId'] ?? ''));
        if ($orderId === '') {
            throw new RuntimeException('Order ID is required.');
        }

        $order = $this->fetchOrderRow($orderId);
        if ($order === null) {
            throw new RuntimeException('Order not found.');
        }

        $events = [];
        if ($this->tableExists('voice_survey_events')) {
            $rows = $this->database->fetchAll(
                'SELECT id, survey_id, event_type, call_status, response, details, created_at
                 FROM voice_survey_events
                 WHERE order_id = :order_id
                 ORDER BY created_at ASC, id ASC',
                [':order_id' => $orderId]
            );
            $events = array_map(fn (array $event): array => [
                'id' => (string) $event['id'],
                'surveyId' => $this->nullableString($event['survey_id'] ?? null),
                'eventType' => (string) ($event['event_type'] ?? ''),
                'callStatus' => $this->nullableString($event['call_status'] ?? null),
                'response' => $this->nullableString($event['response'] ?? null),
                'details' => $this->nullableString($event['details'] ?? null),
                'createdAt' => $this->toIso($event['created_at'] ?? null) ?? '',
            ], $rows);
        }

        return [
            'surveyId' => $order['survey_id'] ?? null,
            'surveyStatus' => $order['survey_status'] ?? null,
            'surveyResponse' => $order['survey_response'] ?? null,
            'surveyCallStatus' => $order['survey_call_status'] ?? null,
            'confirmationStatus' => $order['confirmation_status'] ?? null,
            'surveyRetryCount' => (int) ($order['survey_retry_count'] ?? 0),
            'surveyNextRetryAt' => $this->toIso($order['survey_next_retry_at'] ?? null),
            'surveyTriggeredAt' => $this->toIso($order['survey_triggered_at'] ?? null),
            'surveyLastRetryReason' => $order['survey_last_retry_reason'] ?? null,
            'surveyLastRetryAt' => $this->toIso($order['survey_last_retry_at'] ?? null),
            'surveyEvents' => $events,
        ];
    }

    // ── AwajDigital API ───────────────────────────────────────────────

    public function fetchSurveyBalance(array $params = []): array
    {
        $this->requireAdmin();
        $settings = $this->fetchSettingsRow();
        $token = (string) ($settings['api_token'] ?? '');
        if ($token === '') {
            return ['success' => false, 'balance' => 0, 'message' => 'Balance is unavailable until automatic calling is set up.'];
        }

        $ch = curl_init('https://api.awajdigital.com/api/balance');
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $token,
                'Accept: application/json',
            ],
        ]);
        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($response === false || $httpCode >= 400) {
            return ['success' => false, 'balance' => 0, 'message' => 'Balance is temporarily unavailable.'];
        }

        $decoded = json_decode((string) $response, true);
        if (!is_array($decoded)) {
            return ['success' => false, 'balance' => 0, 'message' => 'Balance is temporarily unavailable.'];
        }

        return [
            'success' => (bool) ($decoded['success'] ?? false),
            'balance' => (float) ($decoded['balance'] ?? 0),
        ];
    }

    public function fetchSurveyHistory(array $params): array
    {
        $this->requireAdmin();
        $page = max(1, (int) ($params['page'] ?? 1));
        $pageSize = min(100, max(1, (int) ($params['pageSize'] ?? 25)));
        $startDate = trim((string) ($params['startDate'] ?? ''));
        $endDate = trim((string) ($params['endDate'] ?? ''));

        if (!$this->columnExists('orders', 'survey_status')) {
            return [
                'success' => true,
                'history' => [],
                'pagination' => ['page' => $page, 'pageSize' => $pageSize, 'total' => 0, 'totalPages' => 1],
                'dateRange' => ['startDate' => $startDate, 'endDate' => $endDate],
            ];
        }

        $localTimezone = new \DateTimeZone($this->config->timezone());
        $parseDate = static function (string $value) use ($localTimezone): ?\DateTimeImmutable {
            if ($value === '') {
                return null;
            }

            $date = \DateTimeImmutable::createFromFormat('!Y-m-d', $value, $localTimezone);
            return $date instanceof \DateTimeImmutable && $date->format('Y-m-d') === $value ? $date : null;
        };

        $start = $parseDate($startDate);
        $end = $parseDate($endDate);
        if (($startDate !== '' && $start === null) || ($endDate !== '' && $end === null)) {
            throw new ApiException('Choose a valid date range.', 422, 'INVALID_SURVEY_HISTORY_DATE');
        }
        if ($start instanceof \DateTimeImmutable && $end instanceof \DateTimeImmutable && $start > $end) {
            throw new ApiException('The start date cannot be after the end date.', 422, 'INVALID_SURVEY_HISTORY_RANGE');
        }

        $where = ["o.survey_status IS NOT NULL", "o.survey_status != ''", 'o.deleted_at IS NULL'];
        $bindings = [];
        $activityAt = 'COALESCE(o.survey_triggered_at, o.created_at)';
        if ($start instanceof \DateTimeImmutable) {
            $where[] = "{$activityAt} >= :history_start";
            $bindings[':history_start'] = $start->setTimezone($this->utcTimezone())->format('Y-m-d H:i:s');
        }
        if ($end instanceof \DateTimeImmutable) {
            $where[] = "{$activityAt} < :history_end";
            $bindings[':history_end'] = $end->modify('+1 day')->setTimezone($this->utcTimezone())->format('Y-m-d H:i:s');
        }

        $whereSql = implode(' AND ', $where);
        $countRow = $this->database->fetchOne("SELECT COUNT(*) AS total FROM orders o WHERE {$whereSql}", $bindings);
        $total = (int) ($countRow['total'] ?? 0);
        $totalPages = max(1, (int) ceil($total / $pageSize));
        $offset = ($page - 1) * $pageSize;

        $rows = $this->database->fetchAll(
            "SELECT o.id AS order_id, o.order_number, o.survey_id, o.survey_status, o.survey_call_status,
                    o.confirmation_status, o.survey_triggered_at, o.created_at, c.name AS customer_name
             FROM orders o
             LEFT JOIN customers c ON c.id = o.customer_id
             WHERE {$whereSql}
             ORDER BY {$activityAt} DESC, o.created_at DESC
             LIMIT {$pageSize} OFFSET {$offset}",
            $bindings
        );

        $history = array_map(function (array $row): array {
            return [
                'id' => (string) ($row['survey_id'] ?? ''),
                'orderId' => (string) ($row['order_id'] ?? ''),
                'orderNumber' => (string) ($row['order_number'] ?? ''),
                'customerName' => (string) ($row['customer_name'] ?? ''),
                'status' => strtolower(trim((string) ($row['survey_status'] ?? ''))),
                'callStatus' => strtolower(trim((string) ($row['survey_call_status'] ?? ''))),
                'confirmationStatus' => strtolower(trim((string) ($row['confirmation_status'] ?? ''))),
                'createdAt' => $this->toIso($row['survey_triggered_at'] ?? $row['created_at'] ?? null),
            ];
        }, $rows);

        return [
            'success' => true,
            'history' => $history,
            'pagination' => [
                'page' => $page,
                'pageSize' => $pageSize,
                'total' => $total,
                'totalPages' => $totalPages,
            ],
            'dateRange' => ['startDate' => $startDate, 'endDate' => $endDate],
        ];
    }

    /**
     * @deprecated Kept for compatibility with clients deployed before call history became local-first.
     */
    public function fetchSurveyBroadcasts(array $params): array
    {
        $result = $this->fetchSurveyHistory($params);
        $result['broadcasts'] = array_map(static function (array $entry): array {
            return [
                'id' => (string) ($entry['id'] ?? ''),
                'name' => 'Order #' . (string) ($entry['orderNumber'] ?? ''),
                'status' => (string) ($entry['status'] ?? ''),
                'createdAt' => (string) ($entry['createdAt'] ?? ''),
            ];
        }, $result['history'] ?? []);

        return $result;
    }

    public function fetchSurveySummary(array $params = []): array
    {
        $this->requireAdmin();
        $settings = $this->fetchSettingsRow() ?? [];

        if (!$this->columnExists('orders', 'survey_status')) {
            return [
                'totalCalls' => 0,
                'pendingCalls' => 0,
                'sender' => (string) ($settings['sender'] ?? ''),
                'workerHealth' => $this->buildWorkerHealth($settings),
            ];
        }

        $totalCalls = (int) $this->database->fetchOne(
            "SELECT COUNT(*) AS cnt FROM orders WHERE survey_status IS NOT NULL AND survey_status != '' AND deleted_at IS NULL",
            []
        )['cnt'];

        $pendingCalls = (int) $this->database->fetchOne(
            "SELECT COUNT(*) AS cnt FROM orders WHERE survey_status IN ('pending', 'triggered', 'initiated') AND deleted_at IS NULL",
            []
        )['cnt'];

        $sender = (string) ($settings['sender'] ?? '');

        return [
            'totalCalls' => $totalCalls,
            'pendingCalls' => $pendingCalls,
            'sender' => $sender,
            'workerHealth' => $this->buildWorkerHealth($settings),
        ];
    }

    public function initiateRechargeCheckout(array $params): array
    {
        $user = $this->requireAdmin();
        $amount = max(0.0, (float) ($params['amount'] ?? 0));
        if ($amount <= 0) {
            throw new \RuntimeException('Recharge amount must be greater than zero.');
        }

        $gateway = $this->database->fetchOne('SELECT * FROM payment_gateway_settings LIMIT 1');
        if (!is_array($gateway)) {
            throw new \RuntimeException('Payment gateway is not configured.');
        }

        $baseUrl = rtrim((string) ($gateway['piprapay_base_url'] ?? ''), '/');
        $apiKey = trim((string) ($gateway['piprapay_api_key'] ?? ''));
        if ($baseUrl === '' || $apiKey === '') {
            throw new \RuntimeException('PipraPay gateway is not configured. Check Developer Settings > Payment Gateway.');
        }

        $reference = 'RCH-' . strtoupper(substr($this->stringId(null), 0, 12));
        $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
        $forwardedProto = strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0]));
        $scheme = $forwardedProto === 'https' || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $returnBase = $scheme . '://' . $host;

        $metadataArray = [
            'local_reference' => $reference,
            'type' => 'auto_calling_recharge',
            'payment_datetime' => gmdate('c'),
            'domain' => $host,
        ];

        $configuredWebhookUrl = trim((string) ($gateway['piprapay_webhook_url'] ?? ''));
        if ($configuredWebhookUrl === '') {
            $configuredWebhookUrl = $returnBase . '/api/?action=handlePipraPayIpn';
        }
        $configuredReturnUrl = $this->appendUrlQueryParameter($returnBase . '/#/auto-calling', 'reference', $reference);

        $payload = [
            'full_name' => (string) ($user['name'] ?? 'Admin'),
            'email_address' => (string) (($user['email'] ?? null) ?: 'admin@example.com'),
            'mobile_number' => (string) (($user['phone'] ?? null) ?: '01700000000'),
            'amount' => number_format(round($amount, 2), 2, '.', ''),
            'currency' => 'BDT',
            'metadata' => json_encode($metadataArray),
            'return_url' => $configuredReturnUrl,
            'webhook_url' => $configuredWebhookUrl,
        ];

        $response = $this->httpJson('POST', $this->pipraPayApiUrl($baseUrl, 'checkout/redirect'), [
            'MHS-PIPRAPAY-API-KEY' => $apiKey,
            'Accept' => 'application/json',
        ], $payload);

        if ($response['status'] < 200 || $response['status'] >= 300 || !is_array($response['json'])) {
            throw new \RuntimeException('PipraPay checkout initialization failed (HTTP ' . (int) $response['status'] . ').');
        }

        $body = $response['json'];
        $checkoutUrl = (string) ($body['pp_url'] ?? $body['checkout_url'] ?? $body['url'] ?? $body['data']['pp_url'] ?? $body['data']['checkout_url'] ?? '');
        $gatewayPaymentId = (string) ($body['pp_id'] ?? $body['payment_id'] ?? $body['data']['pp_id'] ?? '');
        if ($checkoutUrl === '') {
            throw new \RuntimeException('PipraPay did not return a checkout URL.');
        }

        // Store recharge record
        $id = $this->stringId(null);
        $now = $this->database->nowUtc();
        $this->ensureRechargeTable();
        $this->database->execute(
            'INSERT INTO auto_calling_recharges (id, local_reference, gateway_payment_id, amount, status, submitted_by, submitted_at, created_at, updated_at) VALUES (:id, :ref, :gw_id, :amount, :status, :user_id, :submitted_at, :created_at, :updated_at)',
            [
                ':id' => $id,
                ':ref' => $reference,
                ':gw_id' => $gatewayPaymentId ?: null,
                ':amount' => $this->formatMoney($amount),
                ':status' => 'processing',
                ':user_id' => (string) ($user['id'] ?? ''),
                ':submitted_at' => $now,
                ':created_at' => $now,
                ':updated_at' => $now,
            ]
        );

        return [
            'checkoutUrl' => $checkoutUrl,
            'localReference' => $reference,
            'gatewayPaymentId' => $gatewayPaymentId ?: null,
        ];
    }

    public function fetchRechargeHistory(array $params = []): array
    {
        $this->requireAdmin();
        $this->ensureRechargeTable();
        $rows = $this->database->fetchAll(
            'SELECT * FROM auto_calling_recharges ORDER BY created_at DESC LIMIT 100'
        );
        return array_map(fn(array $r) => [
            'id' => $r['id'],
            'localReference' => $r['local_reference'],
            'gatewayPaymentId' => $r['gateway_payment_id'],
            'amount' => (float) $r['amount'],
            'status' => $r['status'],
            'submittedAt' => $this->toIso($r['submitted_at']),
            'processedAt' => $this->toIso($r['processed_at']),
            'createdAt' => $this->toIso($r['created_at']),
        ], $rows);
    }

    private function ensureRechargeTable(): void
    {
        $this->database->execute(
            'CREATE TABLE IF NOT EXISTS auto_calling_recharges (
                id VARCHAR(64) NOT NULL,
                local_reference VARCHAR(64) NULL,
                gateway_payment_id VARCHAR(255) NULL,
                amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
                status VARCHAR(32) NOT NULL DEFAULT \'processing\',
                submitted_by VARCHAR(64) NULL,
                submitted_at DATETIME NULL,
                processed_at DATETIME NULL,
                raw_payload LONGTEXT NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_auto_calling_recharges_reference (local_reference),
                KEY idx_recharges_status (status),
                KEY idx_recharges_gateway_payment (gateway_payment_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
    }

    private function httpJson(string $method, string $url, array $headers, array $body = null): array
    {
        $ch = curl_init($url);
        $headerStrings = [];
        foreach ($headers as $key => $value) {
            $headerStrings[] = $key . ': ' . $value;
        }
        if ($body !== null) {
            $headerStrings[] = 'Content-Type: application/json';
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_HTTPHEADER => $headerStrings,
        ]);
        if ($method === 'POST' && $body !== null) {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }
        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);
        if ($response === false) {
            throw new RuntimeException($error !== '' ? $error : 'PipraPay request failed.');
        }
        $json = json_decode((string) $response, true);
        return ['status' => $httpCode, 'json' => is_array($json) ? $json : null, 'body' => $response];
    }

    // ── Background Processing ─────────────────────────────────────────

    public function processSurveyQueue(array $params = []): array
    {
        if (PHP_SAPI !== 'cli') {
            $this->requireAdmin();
        }

        $settings = $this->fetchSettingsRow();
        if (!($settings['enabled'] ?? false)) {
            return ['processed' => 0, 'message' => 'Voice survey is disabled.'];
        }

        $now = $this->database->nowUtc();
        $this->recordWorkerRuntime($settings, ['cron_last_run' => $now]);

        try {
            $this->assertSurveyEnabled($settings);

            $processed = 0;
            $processed += $this->processPendingCalls($settings);
            $processed += $this->processDueRetries($settings);
            $processed += $this->recoverStuckOrders();

            $this->recordWorkerRuntime($settings, [
                'cron_last_success_at' => $this->database->nowUtc(),
                'cron_last_error' => null,
                'cron_last_processed_count' => $processed,
            ]);

            return ['processed' => $processed];
        } catch (\Throwable $exception) {
            $this->recordWorkerRuntime($settings, [
                'cron_last_error' => mb_substr($exception->getMessage(), 0, 1000),
                'cron_last_processed_count' => 0,
            ]);
            throw $exception;
        }
    }

    // ── Webhook Handler ───────────────────────────────────────────────

    /**
     * Trigger background survey processing after order creation.
     * Spawns process_survey_queue.php as a background process.
     */
    public function triggerSurveyBackgroundProcess(array $params = []): array
    {
        $settings = $this->fetchSettingsRow();
        if ($settings === null || !($settings['enabled'] ?? false)) {
            return ['triggered' => false, 'reason' => 'disabled'];
        }

        $lastRun = $settings['cron_last_run'] ?? null;
        if ($lastRun !== null) {
            $lastRunTs = strtotime($lastRun);
            if ($lastRunTs !== false && (time() - $lastRunTs) < 60) {
                return ['triggered' => false, 'reason' => 'rate_limited'];
            }
        }

        // Existing installations can receive this worker through an update before
        // their updater knows how to register the recurring schedule. Self-heal
        // when the next eligible order is created; detached execution remains the
        // immediate fast path even if the host does not expose user crontabs.
        (new AutoCallScheduler($this->config))->ensureInstalled();

        $script = dirname(__DIR__) . '/bin/process_survey_queue.php';
        if (!is_file($script)) {
            return ['triggered' => false, 'reason' => 'script_not_found'];
        }

        $phpBinary = PHP_BINARY ?: 'php';
        $logPath = (string) ($this->config->get(
            'AUTO_CALL_WORKER_LOG',
            dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'mamepilot-auto-call.log'
        ) ?? '');
        $watchArgument = '--watch-seconds=' . $this->backgroundWorkerLifetimeSeconds($settings);

        if (DIRECTORY_SEPARATOR === '\\') {
            $cmd = 'cmd /c start "" /B ' . escapeshellarg($phpBinary) . ' ' . escapeshellarg($script)
                . ' ' . $watchArgument
                . ' >> ' . escapeshellarg($logPath) . ' 2>&1';
        } else {
            $cmd = 'nohup ' . escapeshellarg($phpBinary) . ' ' . escapeshellarg($script)
                . ' ' . $watchArgument
                . ' >> ' . escapeshellarg($logPath) . ' 2>&1 < /dev/null &';
        }

        if (function_exists('popen')) {
            $process = @popen($cmd, 'r');
            if (is_resource($process)) {
                @pclose($process);
                return ['triggered' => true];
            }
        } elseif (function_exists('shell_exec')) {
            @shell_exec($cmd);
            return ['triggered' => true];
        }

        return ['triggered' => false, 'reason' => 'process_launch_unavailable'];
    }

    private function backgroundWorkerLifetimeSeconds(array $settings): int
    {
        $delayMinutes = max(0, (int) ($settings['delay_minutes'] ?? 5));
        $missedRetryWindow = max(0, (int) ($settings['missed_call_retry_minutes'] ?? 30))
            * max(0, (int) ($settings['missed_call_retry_count'] ?? 3));
        $noKeyRetryWindow = max(0, (int) ($settings['no_key_retry_minutes'] ?? 10))
            * max(0, (int) ($settings['no_key_retry_count'] ?? 2));
        $watchMinutes = $delayMinutes + max($missedRetryWindow, $noKeyRetryWindow) + 5;

        return max(600, min(86400, $watchMinutes * 60));
    }

    public function handleWebhookCallback(array $payload): array
    {
        $results = is_array($payload['results'] ?? null) ? $payload['results'] : [];
        $metadata = $payload['metadata'] ?? [];
        $orderId = is_array($metadata) ? trim((string) ($metadata['order_id'] ?? '')) : '';
        $surveyId = trim((string) ($payload['survey_id'] ?? ''));

        if (empty($results)) {
            return ['success' => false, 'error' => 'No results in payload.'];
        }

        $settings = $this->fetchSettingsRow();
        if ($settings === null) {
            return ['success' => false, 'error' => 'Voice survey settings are missing.'];
        }

        if ($orderId === '' && $surveyId !== '') {
            $matchedOrder = $this->database->fetchOne(
                "SELECT id FROM orders WHERE survey_id = :survey_id AND survey_status IN ('initiated', 'triggered') AND deleted_at IS NULL LIMIT 1",
                [':survey_id' => $surveyId]
            );
            $orderId = trim((string) ($matchedOrder['id'] ?? ''));
        }
        if ($orderId === '') {
            return ['success' => false, 'error' => 'Webhook could not be matched to an order.'];
        }

        foreach ($results as $result) {
            if (!is_array($result)) {
                continue;
            }
            $status = strtolower(trim((string) ($result['status'] ?? '')));
            $response = $result['response'] ?? (($result['responses'][0] ?? null));

            $confirmationStatus = 'waiting';
            $surveyCallStatus = $status;

            if ($status === 'answered' && $response !== null && trim((string) $response) !== '') {
                switch ((string) $response) {
                    case '1':
                        $confirmationStatus = 'confirmed';
                        break;
                    case '2':
                        $confirmationStatus = 'cancelled';
                        break;
                    default:
                        $confirmationStatus = 'on_hold';
                        break;
                }
            } elseif ($status !== 'answered') {
                $surveyCallStatus = 'not_answered';
            }

            $surveyMatchSql = $surveyId !== '' ? ' AND survey_id = :survey_id' : '';
            $bindings = [
                ':response' => $this->nullableString($response !== null ? (string) $response : null),
                ':call_status' => $surveyCallStatus,
                ':confirmation' => $confirmationStatus,
                ':updated_at' => $this->database->nowUtc(),
                ':id' => $orderId,
            ];
            if ($surveyId !== '') {
                $bindings[':survey_id'] = $surveyId;
            }
            $updated = $this->database->execute(
                "UPDATE orders SET survey_status = 'completed', survey_response = :response, survey_call_status = :call_status, confirmation_status = :confirmation, updated_at = :updated_at WHERE id = :id AND survey_status IN ('initiated', 'triggered'){$surveyMatchSql}",
                $bindings
            );

            if ($updated === 1) {
                $details = $confirmationStatus === 'confirmed'
                    ? 'Customer confirmed the order.'
                    : ($confirmationStatus === 'cancelled'
                        ? 'Customer cancelled the order.'
                        : ($confirmationStatus === 'on_hold'
                            ? 'Customer requested follow-up.'
                            : ($surveyCallStatus === 'not_answered' ? 'Customer did not pick up.' : 'Customer answered without pressing a key.')));
                $this->logSurveyEvent($orderId, 'result_received', $surveyId, $surveyCallStatus, $response !== null ? (string) $response : null, $details);
            }

            // Only the first delivery for the active survey may schedule a retry.
            if ($updated === 1 && $confirmationStatus === 'waiting') {
                $reason = $surveyCallStatus === 'not_answered' ? 'missed_call' : 'answered_no_key';
                $this->handleWebhookRetry($orderId, $reason, $settings);
            }
        }

        return ['success' => true];
    }

    // ── Internal Methods ──────────────────────────────────────────────

    private function initiateSurveyCall(array $order, array $settings): bool
    {
        $phone = $this->resolveCustomerPhone($order);
        if ($phone === null) {
            return false;
        }

        $normalizedPhone = $this->normalizePhone($phone);
        $orderId = (string) $order['id'];
        if (preg_match('/^01[3-9][0-9]{8}$/', $normalizedPhone) !== 1) {
            $this->database->execute(
                "UPDATE orders SET survey_status = 'failed', survey_call_status = 'invalid_phone', confirmation_status = 'on_hold', updated_at = :now WHERE id = :id",
                [':now' => $this->database->nowUtc(), ':id' => $orderId]
            );
            $this->logSurveyEvent($orderId, 'failed', null, 'invalid_phone', null, 'Customer phone number is invalid.');
            return false;
        }
        $requestId = 'mame_' . substr(hash('sha256', $orderId . '|' . $normalizedPhone . '|' . microtime(true)), 0, 40);

        $webhookUrl = $this->buildWebhookUrl($settings);

        $payload = [
            'request_id' => $requestId,
            'template_name' => (string) ($settings['template_name'] ?? ''),
            'sender' => (string) ($settings['sender'] ?? ''),
            'phone_numbers' => [$normalizedPhone],
            'metadata' => [
                'order_id' => $orderId,
            ],
            'webhook_url' => $webhookUrl,
        ];

        $claimedAt = $this->database->nowUtc();
        $claimed = $this->database->execute(
            "UPDATE orders SET survey_status = 'triggered', survey_triggered_at = :triggered_at, updated_at = :updated_at WHERE id = :id AND survey_status = 'pending'",
            [':triggered_at' => $claimedAt, ':updated_at' => $claimedAt, ':id' => $orderId]
        );
        if ($claimed !== 1) {
            return false;
        }

        if ((int) ($order['survey_retry_count'] ?? 0) > 0) {
            $this->logSurveyEvent($orderId, 'retry_initiated', null, 'triggered', null, 'Scheduled retry initiated.');
        }

        $response = $this->httpPost(self::SURVEY_API_BASE, $payload, $settings);

        if ($response['success']) {
            $surveyId = $response['id'] ?? null;
            if ($surveyId === null || $surveyId === '') {
                $this->database->execute(
                    "UPDATE orders SET survey_status = 'completed', survey_call_status = 'api_error: missing survey id', updated_at = :now WHERE id = :id AND survey_status = 'triggered'",
                    [':now' => $this->database->nowUtc(), ':id' => $orderId]
                );
                $this->logSurveyEvent($orderId, 'failed', null, 'api_error', null, 'AwajDigital accepted no survey identifier.');
                $this->handleWebhookRetry($orderId, 'missed_call', $settings);
                return false;
            }
            $this->database->execute(
                "UPDATE orders SET survey_status = 'initiated', survey_id = :survey_id, survey_call_status = 'api_success', updated_at = :now WHERE id = :id AND survey_status = 'triggered'",
                [':survey_id' => $surveyId, ':now' => $this->database->nowUtc(), ':id' => $orderId]
            );
            $this->logSurveyEvent($orderId, 'initiated', (string) $surveyId, 'initiated', null, 'AwajDigital survey started; awaiting webhook result.');
        } else {
            $error = $response['error'] ?? 'Unknown error';
            $this->database->execute(
                "UPDATE orders SET survey_status = 'completed', survey_call_status = :error, updated_at = :now WHERE id = :id AND survey_status = 'triggered'",
                [':error' => 'api_error: ' . mb_substr($error, 0, 200), ':now' => $this->database->nowUtc(), ':id' => $orderId]
            );
            $this->logSurveyEvent($orderId, 'failed', null, 'api_error', null, mb_substr((string) $error, 0, 500));
            $this->handleWebhookRetry($orderId, 'missed_call', $settings);
            return false;
        }
        return true;
    }

    private function processPendingCalls(array $settings): int
    {
        $delayMinutes = (int) ($settings['delay_minutes'] ?? 5);
        $statusPlaceholders = $this->buildStatusInClause($settings);
        $orders = $this->database->fetchAll(
            "SELECT o.*, c.name AS customer_name, c.phone AS customer_phone FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.status IN ({$statusPlaceholders}) AND o.survey_status = 'pending' AND o.survey_next_retry_at IS NULL AND o.deleted_at IS NULL AND o.created_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL :delay MINUTE) ORDER BY o.created_at ASC LIMIT 50",
            array_merge($this->statusBindings($settings), [':delay' => $delayMinutes])
        );

        $count = 0;
        foreach ($orders as $order) {
            if ($this->initiateSurveyCall($order, $settings)) {
                $count++;
            }
        }
        return $count;
    }

    private function processDueRetries(array $settings): int
    {
        $statusPlaceholders = $this->buildStatusInClause($settings);
        $orders = $this->database->fetchAll(
            "SELECT o.*, c.name AS customer_name, c.phone AS customer_phone FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.status IN ({$statusPlaceholders}) AND o.survey_status = 'pending' AND o.survey_next_retry_at IS NOT NULL AND o.survey_next_retry_at <= UTC_TIMESTAMP() AND o.deleted_at IS NULL ORDER BY o.survey_next_retry_at ASC LIMIT 50",
            $this->statusBindings($settings)
        );

        $count = 0;
        foreach ($orders as $order) {
            if ($this->initiateSurveyCall($order, $settings)) {
                $count++;
            }
        }
        return $count;
    }

    private function buildStatusInClause(array $settings): string
    {
        $statuses = $this->getTriggerStatuses($settings);
        $placeholders = [];
        foreach ($statuses as $i => $status) {
            $placeholders[] = ':ts_' . $i;
        }
        return implode(', ', $placeholders);
    }

    private function statusBindings(array $settings): array
    {
        $statuses = $this->getTriggerStatuses($settings);
        $bindings = [];
        foreach ($statuses as $i => $status) {
            $bindings[':ts_' . $i] = $status;
        }
        return $bindings;
    }

    private function getTriggerStatuses(array $settings): array
    {
        $raw = $settings['trigger_statuses'] ?? null;
        return $this->normalizeTriggerStatuses(
            $raw !== null ? json_decode((string) $raw, true) : null
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function buildWorkerHealth(array $settings): array
    {
        $enabled = !empty($settings['enabled']);
        $pendingCount = 0;
        $overdueCount = 0;

        if ($this->columnExists('orders', 'survey_status')) {
            $pendingCount = (int) ($this->database->fetchOne(
                "SELECT COUNT(*) AS cnt FROM orders WHERE survey_status IN ('pending', 'triggered', 'initiated') AND deleted_at IS NULL"
            )['cnt'] ?? 0);

            if ($enabled) {
                $statusPlaceholders = $this->buildStatusInClause($settings);
                $overdueCount = (int) ($this->database->fetchOne(
                    "SELECT COUNT(*) AS cnt
                     FROM orders
                     WHERE status IN ({$statusPlaceholders})
                       AND survey_status = 'pending'
                       AND deleted_at IS NULL
                       AND (
                         (survey_next_retry_at IS NULL AND created_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL :worker_delay MINUTE))
                         OR (survey_next_retry_at IS NOT NULL AND survey_next_retry_at <= UTC_TIMESTAMP())
                       )",
                    array_merge($this->statusBindings($settings), [
                        ':worker_delay' => max(0, (int) ($settings['delay_minutes'] ?? 5)),
                    ])
                )['cnt'] ?? 0);
            }
        }

        $lastRun = trim((string) ($settings['cron_last_run'] ?? ''));
        $lastSuccess = trim((string) ($settings['cron_last_success_at'] ?? ''));
        $lastError = trim((string) ($settings['cron_last_error'] ?? ''));
        $lastRunTimestamp = $lastRun !== '' ? strtotime($lastRun . ' UTC') : false;
        $secondsSinceLastRun = $lastRunTimestamp !== false ? max(0, time() - $lastRunTimestamp) : null;

        $missingConfiguration = [];
        foreach (['api_token', 'sender', 'template_name', 'webhook_secret', 'webhook_url'] as $field) {
            if (trim((string) ($settings[$field] ?? '')) === '') {
                $missingConfiguration[] = $field;
            }
        }

        if (!$enabled) {
            $status = 'disabled';
            $message = 'Auto-calling is disabled.';
        } elseif ($missingConfiguration !== []) {
            $status = 'configuration_error';
            $message = 'Automatic calling needs setup. Ask a developer to review the connection.';
        } elseif ($lastError !== '') {
            $status = 'error';
            $message = 'Automatic calling needs attention. Ask a developer to review the connection.';
        } elseif ($secondsSinceLastRun === null || $secondsSinceLastRun > 180) {
            $status = 'stopped';
            $message = $overdueCount > 0
                ? sprintf('%d overdue call%s waiting. Automatic calling needs attention.', $overdueCount, $overdueCount === 1 ? ' is' : 's are')
                : 'Automatic calling is temporarily unavailable. Ask a developer to review the service.';
        } else {
            $status = 'healthy';
            $message = $overdueCount > 0
                ? sprintf('%d due call%s will be processed shortly.', $overdueCount, $overdueCount === 1 ? '' : 's')
                : 'Automatic calling is running normally.';
        }

        return [
            'status' => $status,
            'message' => $message,
            'lastRunAt' => $this->toIso($lastRun !== '' ? $lastRun : null),
            'lastSuccessAt' => $this->toIso($lastSuccess !== '' ? $lastSuccess : null),
            'lastProcessedCount' => (int) ($settings['cron_last_processed_count'] ?? 0),
            'pendingCount' => $pendingCount,
            'overdueCount' => $overdueCount,
        ];
    }

    /** @param array<string, mixed> $values */
    private function recordWorkerRuntime(array $settings, array $values): void
    {
        $settingsId = trim((string) ($settings['id'] ?? ''));
        if ($settingsId === '') {
            return;
        }

        $available = [];
        foreach ($values as $column => $value) {
            if ($this->columnExists('voice_survey_settings', (string) $column)) {
                $available[(string) $column] = $value;
            }
        }
        if ($available === []) {
            return;
        }

        [$setClause, $bindings] = $this->database->buildSetClause($available);
        $this->database->execute(
            "UPDATE voice_survey_settings SET {$setClause} WHERE id = :worker_settings_id",
            array_merge($bindings, [':worker_settings_id' => $settingsId])
        );
    }

    private function recoverStuckOrders(): int
    {
        return $this->database->execute(
            "UPDATE orders SET survey_status = 'pending', updated_at = :now WHERE survey_status = 'triggered' AND (survey_id IS NULL OR survey_id = '') AND survey_triggered_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 MINUTE) AND deleted_at IS NULL",
            [':now' => $this->database->nowUtc()]
        );
    }

    private function handleWebhookRetry(string $orderId, string $reason, array $settings): void
    {
        $retryCount = 0;
        $order = $this->fetchOrderRow($orderId);
        if ($order !== null) {
            $retryCount = (int) ($order['survey_retry_count'] ?? 0);
        }

        $maxRetries = $reason === 'missed_call'
            ? (int) ($settings['missed_call_retry_count'] ?? 3)
            : (int) ($settings['no_key_retry_count'] ?? 2);
        $retryMinutes = $reason === 'missed_call'
            ? (int) ($settings['missed_call_retry_minutes'] ?? 30)
            : (int) ($settings['no_key_retry_minutes'] ?? 10);

        if ($retryCount >= $maxRetries) {
            $this->database->execute(
                "UPDATE orders SET survey_status = 'failed', survey_last_retry_reason = :reason, updated_at = :now WHERE id = :id",
                [':reason' => $reason, ':now' => $this->database->nowUtc(), ':id' => $orderId]
            );
            $this->logSurveyEvent($orderId, 'failed', null, $reason, null, 'Retry limit reached.');
            return;
        }

        $nextRetry = gmdate('Y-m-d H:i:s', time() + ($retryMinutes * 60));
        $retriedAt = $this->database->nowUtc();
        $this->database->execute(
            "UPDATE orders SET survey_status = 'pending', survey_id = NULL, survey_next_retry_at = :next_retry, survey_retry_count = survey_retry_count + 1, survey_last_retry_reason = :reason, survey_last_retry_at = :last_retry_at, confirmation_status = NULL, updated_at = :updated_at WHERE id = :id",
            [
                ':next_retry' => $nextRetry,
                ':reason' => $reason,
                ':last_retry_at' => $retriedAt,
                ':updated_at' => $retriedAt,
                ':id' => $orderId,
            ]
        );
        $this->logSurveyEvent(
            $orderId,
            'retry_scheduled',
            null,
            $reason,
            null,
            'Retry scheduled for ' . gmdate('c', strtotime($nextRetry) ?: time()) . '.'
        );
    }

    private function httpPost(string $url, array $body, array $settings): array
    {
        $token = (string) ($settings['api_token'] ?? '');
        $jsonData = $this->jsonEncode($body);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $jsonData,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_HTTPHEADER => [
                'Authorization: Bearer ' . $token,
                'Accept: application/json',
                'Content-Type: application/json',
            ],
        ]);

        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($response === false || $httpCode >= 400) {
            return ['success' => false, 'error' => $error ?: "HTTP {$httpCode}: " . ($response ?: 'No response')];
        }

        $decoded = json_decode((string) $response, true);
        if (!is_array($decoded)) {
            return ['success' => false, 'error' => 'Invalid JSON response.'];
        }
        if (($decoded['success'] ?? true) !== true) {
            return ['success' => false, 'error' => (string) ($decoded['message'] ?? $decoded['error'] ?? 'AwajDigital rejected the survey request.')];
        }

        $surveyId = $decoded['survey']['id'] ?? $decoded['data']['id'] ?? $decoded['id'] ?? null;
        return ['success' => true, 'id' => $surveyId ? (string) $surveyId : null];
    }

    private function fetchSettingsRow(): ?array
    {
        if (!$this->tableExists('voice_survey_settings')) {
            $this->ensureSettingsTable();
        }
        return $this->database->fetchOne('SELECT * FROM voice_survey_settings LIMIT 1');
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private function insertBindings(array $data): array
    {
        $bindings = [];
        foreach ($data as $column => $value) {
            $bindings[':' . $column] = $value;
        }
        return $bindings;
    }

    private function ensureSettingsTable(): void
    {
        $this->database->execute(
            "CREATE TABLE IF NOT EXISTS voice_survey_settings (
                id VARCHAR(64) NOT NULL,
                enabled TINYINT(1) NOT NULL DEFAULT 0,
                delay_minutes INT NOT NULL DEFAULT 5,
                api_token TEXT NULL,
                sender VARCHAR(64) NULL,
                template_name VARCHAR(191) NULL,
                webhook_secret VARCHAR(255) NULL,
                webhook_url VARCHAR(1000) NULL,
                max_survey_time_seconds INT NOT NULL DEFAULT 120,
                missed_call_retry_minutes INT NOT NULL DEFAULT 30,
                missed_call_retry_count INT NOT NULL DEFAULT 3,
                no_key_retry_minutes INT NOT NULL DEFAULT 10,
                no_key_retry_count INT NOT NULL DEFAULT 2,
                trigger_statuses TEXT NULL,
                cron_last_run DATETIME NULL,
                cron_last_success_at DATETIME NULL,
                cron_last_error TEXT NULL,
                cron_last_processed_count INT NOT NULL DEFAULT 0,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
        );
    }

    private function logSurveyEvent(
        string $orderId,
        string $eventType,
        ?string $surveyId = null,
        ?string $callStatus = null,
        ?string $response = null,
        ?string $details = null
    ): void {
        if (!$this->tableExists('voice_survey_events')) {
            return;
        }

        $this->database->execute(
            'INSERT INTO voice_survey_events (order_id, survey_id, event_type, call_status, response, details, created_at)
             VALUES (:order_id, :survey_id, :event_type, :call_status, :response, :details, :created_at)',
            [
                ':order_id' => $orderId,
                ':survey_id' => $this->nullableString($surveyId),
                ':event_type' => $eventType,
                ':call_status' => $this->nullableString($callStatus),
                ':response' => $this->nullableString($response),
                ':details' => $this->nullableString($details),
                ':created_at' => $this->database->nowUtc(),
            ]
        );
    }

    private function requireDeveloperUser(): array
    {
        $user = $this->currentUser();
        if (trim((string) ($user['role'] ?? '')) !== 'Developer') {
            throw new ApiException('Developer access required.', 403, 'DEVELOPER_ACCESS_REQUIRED');
        }

        return $user;
    }

    /**
     * Exactly one order status may trigger automatic calls.
     *
     * @return array<int, string>
     */
    private function normalizeTriggerStatuses(mixed $statuses): array
    {
        $allowed = ['On Hold', 'Processing'];
        if (is_array($statuses)) {
            foreach ($statuses as $status) {
                $normalized = trim((string) $status);
                if ($normalized === 'Created') {
                    return ['On Hold'];
                }
                if (in_array($normalized, $allowed, true)) {
                    return [$normalized];
                }
            }
        }

        return ['On Hold'];
    }

    private function fetchOrderRow(string $id): ?array
    {
        return $this->database->fetchOne(
            'SELECT o.*, c.name AS customer_name, c.phone AS customer_phone FROM orders o LEFT JOIN customers c ON c.id = o.customer_id WHERE o.id = :id',
            [':id' => $id]
        );
    }

    private function resolveCustomerPhone(array $order): ?string
    {
        $phone = trim((string) ($order['customer_phone'] ?? ''));
        if ($phone === '') {
            return null;
        }
        return $phone;
    }

    private function normalizePhone(string $phone): string
    {
        $phone = preg_replace('/[^0-9]/', '', $phone);
        if (strlen($phone) === 11 && $phone[0] === '0') {
            return $phone;
        }
        if (strlen($phone) === 10 && $phone[0] !== '0') {
            return '0' . $phone;
        }
        if (strlen($phone) === 13 && substr($phone, 0, 3) === '880') {
            return '0' . substr($phone, 3);
        }
        return $phone;
    }

    private function buildWebhookUrl(array $settings): string
    {
        $configured = trim((string) ($settings['webhook_url'] ?? ''));
        if ($configured !== '') {
            return $configured;
        }

        if (PHP_SAPI === 'cli') {
            throw new RuntimeException('Survey webhook URL is not configured. Save AwajDigital settings from Developer Settings.');
        }

        return $this->deriveWebhookUrl((string) ($settings['webhook_secret'] ?? ''));
    }

    private function deriveWebhookUrl(string $secret): string
    {
        $forwardedProto = strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0]));
        $protocol = $forwardedProto === 'https' || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $host = $_SERVER['HTTP_HOST'] ?? $_SERVER['SERVER_NAME'] ?? 'localhost';
        $basePath = dirname($_SERVER['SCRIPT_NAME'] ?? '/');
        $basePath = rtrim($basePath, '/');

        return sprintf('%s://%s%s/webhook-survey.php?token=%s', $protocol, $host, $basePath, urlencode($secret));
    }

    private function assertSurveyEnabled(?array $settings): void
    {
        if ($settings === null || !($settings['enabled'] ?? false)) {
            throw new RuntimeException('Voice survey is not enabled. Enable it in Settings → Voice Survey.');
        }
        if (
            empty($settings['api_token'])
            || empty($settings['template_name'])
            || empty($settings['sender'])
            || empty($settings['webhook_secret'])
            || (empty($settings['webhook_url']) && PHP_SAPI === 'cli')
        ) {
            throw new RuntimeException('Automatic calling is not ready. Ask a developer to review the connection settings.');
        }
        if (!empty($settings['webhook_url'])) {
            $this->assertWebhookUrlValid((string) $settings['webhook_url'], (string) $settings['webhook_secret']);
        }
    }

    private function assertWebhookUrlValid(string $url, string $secret): void
    {
        if (filter_var($url, FILTER_VALIDATE_URL) === false) {
            throw new RuntimeException('Enter a valid public survey webhook URL.');
        }

        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        if ($scheme !== 'https' && !in_array($host, ['localhost', '127.0.0.1', '::1'], true)) {
            throw new RuntimeException('The survey webhook URL must use HTTPS.');
        }

        $query = [];
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $token = trim((string) ($query['token'] ?? ''));
        if ($token === '' || !hash_equals($secret, $token)) {
            throw new RuntimeException('The survey webhook URL token must match the webhook secret.');
        }
    }
}
