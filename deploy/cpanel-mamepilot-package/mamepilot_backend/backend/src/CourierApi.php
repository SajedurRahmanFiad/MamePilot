<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class CourierApi extends BaseService
{
    private OperationsApi $operations;

    public function __construct(Database $database, Auth $auth, Config $config, OperationsApi $operations)
    {
        parent::__construct($database, $auth, $config);
        $this->operations = $operations;
    }

    /**
     * @return array<string, mixed>
     */
    private function courierSystemActor(): array
    {
        $actor = $this->database->fetchOne(
            "SELECT id, name, phone, role
             FROM users
             WHERE deleted_at IS NULL AND COALESCE(is_system, 0) = 0 AND role IN ('Admin', 'Developer')
             ORDER BY CASE WHEN role = 'Developer' THEN 0 ELSE 1 END, created_at ASC
             LIMIT 1"
        );

        if ($actor === null) {
            throw new RuntimeException('No admin-access user is available for courier sync.');
        }

        return $actor;
    }

    /**
     * @param array<string, mixed> $params
     * @return array<string, mixed>|null
     */
    private function updateOrderAsCourierSystem(array $params): ?array
    {
        $actor = $this->courierSystemActor();
        $token = $this->auth->issueToken($actor);
        $previousAuthorization = $_SERVER['HTTP_AUTHORIZATION'] ?? null;
        $previousAuthorizationAlt = $_SERVER['Authorization'] ?? null;
        $headerValue = 'Bearer ' . $token;

        $_SERVER['HTTP_AUTHORIZATION'] = $headerValue;
        $_SERVER['Authorization'] = $headerValue;

        try {
            return $this->operations->updateOrder($params);
        } finally {
            if ($previousAuthorization !== null) {
                $_SERVER['HTTP_AUTHORIZATION'] = $previousAuthorization;
            } else {
                unset($_SERVER['HTTP_AUTHORIZATION']);
            }

            if ($previousAuthorizationAlt !== null) {
                $_SERVER['Authorization'] = $previousAuthorizationAlt;
            } else {
                unset($_SERVER['Authorization']);
            }
        }
    }

    /**
     * @return array{status:int, body:string, json:mixed}
     */
    private function request(string $method, string $url, array $headers = [], ?array $jsonBody = null): array
    {
        $body = $jsonBody !== null ? json_encode($jsonBody, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;

        if (function_exists('curl_init')) {
            $handle = curl_init($url);
            if ($handle === false) {
                throw new RuntimeException('Failed to initialize HTTP request.');
            }

            $headerList = [];
            foreach ($headers as $name => $value) {
                $headerList[] = $name . ': ' . $value;
            }
            if ($body !== null) {
                $headerList[] = 'Content-Type: application/json';
            }

            curl_setopt_array($handle, [
                CURLOPT_CUSTOMREQUEST => strtoupper($method),
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => $headerList,
                CURLOPT_TIMEOUT => 30,
                CURLOPT_CONNECTTIMEOUT => 15,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
            ]);

            if ($body !== null) {
                curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
            }

            $responseBody = curl_exec($handle);
            if ($responseBody === false) {
                $message = curl_error($handle) ?: 'Unknown cURL error';
                curl_close($handle);
                throw new RuntimeException($message);
            }

            $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            curl_close($handle);
        } else {
            $headerList = [];
            foreach ($headers as $name => $value) {
                $headerList[] = $name . ': ' . $value;
            }
            if ($body !== null) {
                $headerList[] = 'Content-Type: application/json';
            }

            $context = stream_context_create([
                'http' => [
                    'method' => strtoupper($method),
                    'header' => implode("\r\n", $headerList),
                    'content' => $body ?? '',
                    'timeout' => 30,
                    'ignore_errors' => true,
                ],
            ]);

            $responseBody = file_get_contents($url, false, $context);
            if ($responseBody === false) {
                throw new RuntimeException('HTTP request failed.');
            }

            $status = 200;
            foreach (($http_response_header ?? []) as $headerLine) {
                if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $headerLine, $matches) === 1) {
                    $status = (int) $matches[1];
                    break;
                }
            }
        }

        $decoded = json_decode($responseBody, true);
        return [
            'status' => $status,
            'body' => $responseBody,
            'json' => $decoded,
        ];
    }

    private function carryBeeHeaders(array $params): array
    {
        return [
            'Client-ID' => trim((string) ($params['clientId'] ?? '')),
            'Client-Secret' => trim((string) ($params['clientSecret'] ?? '')),
            'Client-Context' => trim((string) ($params['clientContext'] ?? '')),
        ];
    }

    private function trimBaseUrl(array $params, string $field = 'baseUrl'): string
    {
        return rtrim(trim((string) ($params[$field] ?? '')), '/');
    }

    private function normalizeBanglaDigits(string $value): string
    {
        return strtr($value, [
            '০' => '0',
            '১' => '1',
            '২' => '2',
            '৩' => '3',
            '৪' => '4',
            '৫' => '5',
            '৬' => '6',
            '৭' => '7',
            '৮' => '8',
            '৯' => '9',
        ]);
    }

    private function normalizeFraudCheckerPhone(string $value): string
    {
        $normalized = $this->normalizeBanglaDigits(trim($value));
        return preg_replace('/[^0-9]/', '', $normalized) ?? '';
    }

    /**
     * @param array<string, mixed> $payload
     * @return array<string, mixed>
     */
    private function mapFraudCheckResponse(array $payload, string $phone): array
    {
        $data = is_array($payload['data'] ?? null) ? $payload['data'] : [];
        $couriers = [];

        foreach ($data as $key => $value) {
            if ($key === 'summary' || !is_array($value)) {
                continue;
            }

            $couriers[] = [
                'key' => (string) $key,
                'name' => (string) ($value['name'] ?? $key),
                'logo' => (string) ($value['logo'] ?? ''),
                'totalParcel' => (int) ($value['total_parcel'] ?? 0),
                'successParcel' => (int) ($value['success_parcel'] ?? 0),
                'cancelledParcel' => (int) ($value['cancelled_parcel'] ?? 0),
                'successRatio' => round((float) ($value['success_ratio'] ?? 0), 2),
            ];
        }

        usort($couriers, static function (array $left, array $right): int {
            return ($right['totalParcel'] <=> $left['totalParcel']) ?: strcmp((string) $left['name'], (string) $right['name']);
        });

        $summaryPayload = is_array($data['summary'] ?? null) ? $data['summary'] : [];
        $summary = [
            'totalParcel' => (int) ($summaryPayload['total_parcel'] ?? array_sum(array_map(static fn (array $row): int => (int) ($row['totalParcel'] ?? 0), $couriers))),
            'successParcel' => (int) ($summaryPayload['success_parcel'] ?? array_sum(array_map(static fn (array $row): int => (int) ($row['successParcel'] ?? 0), $couriers))),
            'cancelledParcel' => (int) ($summaryPayload['cancelled_parcel'] ?? array_sum(array_map(static fn (array $row): int => (int) ($row['cancelledParcel'] ?? 0), $couriers))),
            'successRatio' => round((float) ($summaryPayload['success_ratio'] ?? 0), 2),
        ];

        if ($summary['totalParcel'] > 0) {
            $summary['successRatio'] = round(($summary['successParcel'] / $summary['totalParcel']) * 100, 2);
        }

        $reports = [];
        foreach ((is_array($payload['reports'] ?? null) ? $payload['reports'] : []) as $report) {
            if (!is_array($report)) {
                continue;
            }

            $reports[] = [
                'id' => (string) ($report['id'] ?? ''),
                'name' => (string) ($report['name'] ?? ''),
                'details' => (string) ($report['details'] ?? ''),
                'createdAt' => $this->toIso($report['created_at'] ?? null) ?? (string) ($report['created_at'] ?? ''),
                'courierLogo' => (string) ($report['courierLogo'] ?? ''),
                'courierName' => (string) ($report['courierName'] ?? ''),
            ];
        }

        usort($reports, static function (array $left, array $right): int {
            return strcmp((string) ($right['createdAt'] ?? ''), (string) ($left['createdAt'] ?? ''));
        });

        return [
            'status' => (string) ($payload['status'] ?? 'success'),
            'phone' => $phone,
            'couriers' => $couriers,
            'summary' => $summary,
            'reports' => $reports,
        ];
    }

    /**
     * @return array<int, array{id:string, name:string}>
     */
    private function carryBeeCollectionResponse(array $response, string $collectionKey): array
    {
        if ($response['status'] < 200 || $response['status'] >= 300) {
            return [];
        }

        $payload = $response['json'];
        $collection = [];
        if (is_array($payload['data'][$collectionKey] ?? null)) {
            $collection = $payload['data'][$collectionKey];
        } elseif (is_array($payload[$collectionKey] ?? null)) {
            $collection = $payload[$collectionKey];
        } elseif (is_array($payload)) {
            $collection = $payload;
        }

        $mapped = [];
        foreach ($collection as $row) {
            if (!is_array($row)) {
                continue;
            }
            $mapped[] = [
                'id' => (string) ($row['id'] ?? ''),
                'name' => (string) ($row['name'] ?? ''),
            ];
        }

        return $mapped;
    }

    public function fetchCarryBeeStores(array $params): array
    {
        if ($this->trimBaseUrl($params) === '' || trim((string) ($params['clientId'] ?? '')) === '' || trim((string) ($params['clientSecret'] ?? '')) === '' || trim((string) ($params['clientContext'] ?? '')) === '') {
            return [];
        }

        $response = $this->request(
            'GET',
            $this->trimBaseUrl($params) . '/api/v2/stores',
            $this->carryBeeHeaders($params)
        );

        return $this->carryBeeCollectionResponse($response, 'stores');
    }

    public function checkFraudCourierHistory(array $params): array
    {
        $user = $this->currentUser();
        if (!$this->roleHasPermission((string) ($user['role'] ?? ''), 'fraudChecker.check')) {
            throw new RuntimeException('You do not have permission to use the Fraud Checker.');
        }

        if (!$this->columnExists('courier_settings', 'fraud_checker_api_key')) {
            throw new RuntimeException('Fraud Checker settings are missing. Run the fraud checker migration first.');
        }

        $phone = $this->normalizeFraudCheckerPhone((string) ($params['phone'] ?? ''));
        if (preg_match('/^0\d{10}$/', $phone) !== 1) {
            throw new RuntimeException('Enter a valid 11-digit phone number starting with 0.');
        }

        $result = $this->performFraudCheck($phone);
        $this->persistCustomerFraudSnapshot(
            trim((string) ($params['customerId'] ?? '')),
            $phone,
            $result
        );

        return $result;
    }

    /**
     * CLI-only entry point used by the post-order background worker.
     */
    public function processCustomerFraudCheck(array $params): array
    {
        if (PHP_SAPI !== 'cli') {
            throw new RuntimeException('Background fraud checks are available only from CLI.');
        }

        $customerId = trim((string) ($params['customerId'] ?? ''));
        if ($customerId === '') {
            throw new RuntimeException('Customer ID is required.');
        }

        $customer = $this->database->fetchOne(
            'SELECT id, phone FROM customers WHERE id = :id AND deleted_at IS NULL LIMIT 1',
            [':id' => $customerId]
        );
        if ($customer === null) {
            throw new RuntimeException('Customer not found.');
        }

        $phone = $this->normalizeFraudCheckerPhone((string) ($customer['phone'] ?? ''));
        if (preg_match('/^0\d{10}$/', $phone) !== 1) {
            throw new RuntimeException('Customer phone is not valid for a fraud check.');
        }

        $result = $this->performFraudCheck($phone);
        $this->persistCustomerFraudSnapshot($customerId, $phone, $result);
        return $result;
    }

    private function performFraudCheck(string $phone): array
    {
        $settings = $this->database->fetchOne('SELECT fraud_checker_api_key FROM courier_settings LIMIT 1');
        $apiKey = trim((string) ($settings['fraud_checker_api_key'] ?? ''));
        if ($apiKey === '') {
            throw new RuntimeException('Fraud Checker API key is not configured in Settings.');
        }

        $response = $this->request(
            'POST',
            'https://api.bdcourier.com/courier-check',
            [
                'Authorization' => 'Bearer ' . $apiKey,
                'Accept' => 'application/json',
            ],
            ['phone' => $phone]
        );

        $payload = is_array($response['json']) ? $response['json'] : [];
        if ($response['status'] < 200 || $response['status'] >= 300) {
            throw new RuntimeException((string) ($payload['message'] ?? $payload['error'] ?? ('Fraud Checker request failed with HTTP ' . $response['status'] . '.')));
        }
        if (($payload['status'] ?? 'success') !== 'success' && !is_array($payload['data'] ?? null)) {
            throw new RuntimeException((string) ($payload['message'] ?? $payload['error'] ?? 'Fraud Checker request failed.'));
        }

        return $this->mapFraudCheckResponse($payload, $phone);
    }

    private function persistCustomerFraudSnapshot(string $customerId, string $phone, array $result): void
    {
        foreach (['fraud_check_result', 'fraud_check_percentage', 'fraud_check_phone', 'fraud_checked_at'] as $column) {
            if ($this->columnExists('customers', $column)) {
                continue;
            }
            throw new RuntimeException('Customer fraud snapshot columns are missing. Run schema-only.sql first.');
        }

        $customer = null;
        if ($customerId !== '') {
            $customer = $this->database->fetchOne(
                'SELECT id FROM customers WHERE id = :id AND deleted_at IS NULL LIMIT 1',
                [':id' => $customerId]
            );
        }
        if ($customer === null) {
            $customer = $this->database->fetchOne(
                'SELECT id FROM customers WHERE phone = :phone AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1',
                [':phone' => $phone]
            );
        }
        if ($customer === null) {
            return;
        }

        $percentage = max(0, min(100, (float) ($result['summary']['successRatio'] ?? 0)));
        $this->touchUpdate('customers', (string) $customer['id'], [
            'fraud_check_result' => $this->jsonEncode($result),
            'fraud_check_percentage' => $percentage,
            'fraud_check_phone' => $phone,
            'fraud_checked_at' => $this->database->nowUtc(),
        ]);
    }

    public function fetchCarryBeeCities(array $params): array
    {
        if ($this->trimBaseUrl($params) === '' || trim((string) ($params['clientId'] ?? '')) === '' || trim((string) ($params['clientSecret'] ?? '')) === '' || trim((string) ($params['clientContext'] ?? '')) === '') {
            return [];
        }

        $response = $this->request(
            'GET',
            $this->trimBaseUrl($params) . '/api/v2/cities',
            $this->carryBeeHeaders($params)
        );

        return $this->carryBeeCollectionResponse($response, 'cities');
    }

    public function fetchCarryBeeZones(array $params): array
    {
        $cityId = trim((string) ($params['cityId'] ?? ''));
        if ($this->trimBaseUrl($params) === '' || $cityId === '') {
            return [];
        }

        $response = $this->request(
            'GET',
            $this->trimBaseUrl($params) . '/api/v2/cities/' . rawurlencode($cityId) . '/zones',
            $this->carryBeeHeaders($params)
        );

        return $this->carryBeeCollectionResponse($response, 'zones');
    }

    public function fetchCarryBeeAreas(array $params): array
    {
        $cityId = trim((string) ($params['cityId'] ?? ''));
        $zoneId = trim((string) ($params['zoneId'] ?? ''));
        if ($this->trimBaseUrl($params) === '' || $cityId === '' || $zoneId === '') {
            return [];
        }

        $response = $this->request(
            'GET',
            $this->trimBaseUrl($params) . '/api/v2/cities/' . rawurlencode($cityId) . '/zones/' . rawurlencode($zoneId) . '/areas',
            $this->carryBeeHeaders($params)
        );

        return $this->carryBeeCollectionResponse($response, 'areas');
    }

    public function submitCarryBeeOrder(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        if (
            $baseUrl === '' ||
            trim((string) ($params['clientId'] ?? '')) === '' ||
            trim((string) ($params['clientSecret'] ?? '')) === '' ||
            trim((string) ($params['clientContext'] ?? '')) === '' ||
            trim((string) ($params['storeId'] ?? '')) === '' ||
            trim((string) ($params['recipientPhone'] ?? '')) === '' ||
            trim((string) ($params['recipientName'] ?? '')) === '' ||
            trim((string) ($params['recipientAddress'] ?? '')) === '' ||
            trim((string) ($params['cityId'] ?? '')) === '' ||
            trim((string) ($params['zoneId'] ?? '')) === ''
        ) {
            return ['error' => 'Missing required parameters'];
        }

        $payload = [
            'store_id' => trim((string) ($params['storeId'] ?? '')),
            'delivery_type' => (int) ($params['deliveryType'] ?? 0),
            'product_type' => (int) ($params['productType'] ?? 0),
            'recipient_phone' => trim((string) ($params['recipientPhone'] ?? '')),
            'recipient_name' => trim((string) ($params['recipientName'] ?? '')),
            'recipient_address' => trim((string) ($params['recipientAddress'] ?? '')),
            'city_id' => trim((string) ($params['cityId'] ?? '')),
            'zone_id' => trim((string) ($params['zoneId'] ?? '')),
            'item_weight' => (float) ($params['itemWeight'] ?? 0),
            'collectable_amount' => (float) ($params['collectableAmount'] ?? 0),
        ];
        $merchantOrderId = trim((string) ($params['merchantOrderId'] ?? ''));
        if ($merchantOrderId !== '') {
            $payload['merchant_order_id'] = $merchantOrderId;
        }
        if (!empty($params['areaId'])) {
            $payload['area_id'] = trim((string) $params['areaId']);
        }

        $response = $this->request(
            'POST',
            $baseUrl . '/api/v2/orders',
            $this->carryBeeHeaders($params),
            $payload
        );

        if ($response['status'] < 200 || $response['status'] >= 300) {
            return ['error' => 'HTTP ' . $response['status']];
        }

        $payload = is_array($response['json']) ? $response['json'] : [];
        if (!empty($payload['error'])) {
            return ['error' => (string) $payload['error']];
        }

        return $payload;
    }

    /**
     * Create an exchange consignment under an existing CarryBee order.
     * POST /api/v2/orders/{consignment_id}/exchange
     */
    public function submitCarryBeeExchangeOrder(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        $consignmentId = trim((string) ($params['consignmentId'] ?? ''));
        if (
            $baseUrl === '' ||
            trim((string) ($params['clientId'] ?? '')) === '' ||
            trim((string) ($params['clientSecret'] ?? '')) === '' ||
            trim((string) ($params['clientContext'] ?? '')) === '' ||
            $consignmentId === ''
        ) {
            return ['error' => 'Missing required parameters'];
        }

        $payload = [];
        if (isset($params['collectableAmount']) && (int) $params['collectableAmount'] > 0) {
            $payload['collectable_amount'] = (int) $params['collectableAmount'];
        }
        if (isset($params['itemQuantity']) && (int) $params['itemQuantity'] > 0) {
            $payload['item_quantity'] = (int) $params['itemQuantity'];
        }

        $response = $this->request(
            'POST',
            $baseUrl . '/api/v2/orders/' . rawurlencode($consignmentId) . '/exchange',
            $this->carryBeeHeaders($params),
            $payload
        );

        if ($response['status'] < 200 || $response['status'] >= 300) {
            return ['error' => 'HTTP ' . $response['status']];
        }

        $result = is_array($response['json']) ? $response['json'] : [];
        if (!empty($result['error'])) {
            return ['error' => (string) $result['error']];
        }

        return $result;
    }

    public function fetchCarryBeeOrderDetails(array $params): array
    {
        $consignmentId = trim((string) ($params['consignmentId'] ?? ''));
        if ($this->trimBaseUrl($params) === '' || $consignmentId === '') {
            return ['error' => 'Missing required parameters'];
        }

        $response = $this->request(
            'GET',
            $this->trimBaseUrl($params) . '/api/v2/orders/' . rawurlencode($consignmentId) . '/details',
            $this->carryBeeHeaders($params)
        );

        if ($response['status'] < 200 || $response['status'] >= 300) {
            return ['error' => 'HTTP ' . $response['status']];
        }

        return ['data' => $response['json']];
    }

    private function classifyCarryBeeStatus(array $payload): array
    {
        $rawStatus = '';
        foreach ([
            $payload['data']['data']['transfer_status'] ?? null,
            $payload['data']['transfer_status'] ?? null,
            $payload['transfer_status'] ?? null,
        ] as $candidate) {
            if ($candidate !== null && trim((string) $candidate) !== '') {
                $rawStatus = trim((string) $candidate);
                break;
            }
        }

        $normalized = strtolower($rawStatus);
        $isPickedOrBeyond = false;
        $mappedStatus = null;

        if ($normalized !== '') {
            if (strpos($normalized, 'delivered') !== false) {
                $mappedStatus = 'Delivered';
            } elseif (strpos($normalized, 'return') !== false || strpos($normalized, 'paid return') !== false) {
                $mappedStatus = 'Returned';
            } elseif (strpos($normalized, 'cancel') !== false) {
                $mappedStatus = 'Cancelled';
            }

            $pickedOrBeyond = [
                'at the sorting hub',
                'at central warehouse',
                'at the destination hub',
                'assigned for delivery',
                'out for delivery',
                'in transit',
                'on the way to central warehouse',
                'on the way to last mile hub',
                'received at last mile hub',
                'delivered',
                'exchange',
                'partial delivery',
                'return',
                'paid return',
            ];
            $isPickedOrBeyond = in_array($normalized, $pickedOrBeyond, true) || $mappedStatus !== null;

            if ($mappedStatus === null && $isPickedOrBeyond) {
                $mappedStatus = 'Picked';
            }
        }

        return [
            'rawStatus' => $rawStatus,
            'normalizedStatus' => $normalized,
            'status' => $mappedStatus,
            'isPickedOrBeyond' => $isPickedOrBeyond,
        ];
    }

    public function syncCarryBeeTransferStatuses(array $params = []): array
    {
        $settings = $this->database->fetchOne('SELECT * FROM courier_settings LIMIT 1');
        $baseUrl = rtrim(trim((string) ($settings['carrybee_base_url'] ?? '')), '/');
        $clientId = trim((string) ($settings['carrybee_client_id'] ?? ''));
        $clientSecret = trim((string) ($settings['carrybee_client_secret'] ?? ''));
        $clientContext = trim((string) ($settings['carrybee_client_context'] ?? ''));
        if ($baseUrl === '' || $clientId === '' || $clientSecret === '' || $clientContext === '') {
            return ['checked' => 0, 'updated' => 0, 'hasMore' => false, 'nextCursorCreatedAt' => null, 'statusCounts' => [], 'errors' => [], 'updatedOrders' => []];
        }

        $mode = ($params['mode'] ?? '') === 'backfill' ? 'backfill' : 'incremental';
        $limit = max(1, min(500, (int) ($params['limit'] ?? ($mode === 'backfill' ? 100 : 250))));
        $sql = "SELECT id, order_number, status, history, items, carrybee_consignment_id, created_at
                FROM orders
                WHERE deleted_at IS NULL
                  AND carrybee_consignment_id IS NOT NULL
                  AND carrybee_consignment_id <> ''
                  AND status IN ('On Hold', 'Processing', 'Courier assigned', 'Picked')";
        $bindings = [];
        if (!empty($params['orderId'])) {
            $sql .= ' AND id = :id';
            $bindings[':id'] = trim((string) $params['orderId']);
        } elseif ($mode === 'backfill' && !empty($params['cursorCreatedAt'])) {
            $sql .= ' AND created_at > :cursor';
            $bindings[':cursor'] = $this->normalizeDateTimeInput((string) $params['cursorCreatedAt']);
        }
        $sql .= $mode === 'backfill' ? ' ORDER BY created_at ASC' : ' ORDER BY created_at DESC';
        $sql .= ' LIMIT ' . $limit;

        $rows = $this->database->fetchAll($sql, $bindings);
        $statusCounts = [];
        $errors = [];
        $updatedOrders = [];
        $updated = 0;

        foreach ($rows as $row) {
            try {
                $details = $this->fetchCarryBeeOrderDetails([
                    'baseUrl' => $baseUrl,
                    'clientId' => $clientId,
                    'clientSecret' => $clientSecret,
                    'clientContext' => $clientContext,
                    'consignmentId' => (string) ($row['carrybee_consignment_id'] ?? ''),
                ]);
                if (!empty($details['error']) || !is_array($details['data'] ?? null)) {
                    $errors[] = ['orderId' => $row['id'], 'orderNumber' => $row['order_number'], 'error' => $details['error'] ?? 'Unknown error'];
                    continue;
                }

                $statusInfo = $this->classifyCarryBeeStatus($details['data']);
                $statusKey = (string) ($statusInfo['normalizedStatus'] ?? 'unknown');
                $statusCounts[$statusKey] = ($statusCounts[$statusKey] ?? 0) + 1;

                if (empty($statusInfo['rawStatus']) || $statusInfo['status'] === null) {
                    continue;
                }

                $history = is_array(json_decode((string) ($row['history'] ?? ''), true)) ? json_decode((string) $row['history'], true) : [];
                $updates = [
                    'history' => $history,
                ];

                if ($statusInfo['status'] === 'Delivered') {
                    $updates['status'] = 'Completed';
                    $updates['history']['completed'] = 'Marked delivered automatically from CarryBee transfer status "' . $statusInfo['rawStatus'] . '" on ' . gmdate('c');
                } elseif ($statusInfo['status'] === 'Returned') {
                    $updates['status'] = 'Returned';
                    $updates['history']['returned'] = 'Marked returned automatically from CarryBee transfer status "' . $statusInfo['rawStatus'] . '" on ' . gmdate('c');
                } elseif ($statusInfo['status'] === 'Cancelled') {
                    $updates['status'] = 'Cancelled';
                    $updates['history']['cancelled'] = 'Marked cancelled automatically from CarryBee transfer status "' . $statusInfo['rawStatus'] . '" on ' . gmdate('c');
                } else {
                    $updates['status'] = 'Picked';
                    $updates['history']['picked'] = $updates['history']['picked'] ?? ('Marked picked automatically from CarryBee transfer status "' . $statusInfo['rawStatus'] . '" on ' . gmdate('c'));
                }

                $this->updateOrderAsCourierSystem([
                    'id' => (string) $row['id'],
                    'updates' => $updates,
                ]);
                $updated += 1;
                $updatedOrders[] = [
                    'orderId' => $row['id'],
                    'orderNumber' => $row['order_number'],
                    'rawStatus' => $statusInfo['rawStatus'],
                ];
            } catch (\Throwable $exception) {
                $errors[] = [
                    'orderId' => $row['id'],
                    'orderNumber' => $row['order_number'],
                    'error' => $exception->getMessage(),
                ];
            }
        }

        $lastRow = $rows === [] ? null : $rows[count($rows) - 1];
        return [
            'checked' => count($rows),
            'updated' => $updated,
            'hasMore' => empty($params['orderId']) && count($rows) === $limit,
            'nextCursorCreatedAt' => $lastRow['created_at'] ?? null,
            'statusCounts' => $statusCounts,
            'errors' => $errors,
            'updatedOrders' => $updatedOrders,
        ];
    }

    public function submitSteadfastOrder(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        $invoice = trim((string) ($params['invoice'] ?? ''));
        if ($baseUrl === '' || trim((string) ($params['apiKey'] ?? '')) === '' || trim((string) ($params['secretKey'] ?? '')) === '' || $invoice === '') {
            return ['error' => 'Missing required parameters'];
        }
        if (strlen($invoice) > 100 || preg_match('/^[A-Za-z0-9_-]+$/', $invoice) !== 1) {
            return ['error' => 'Invoice must be unique and can only contain letters, numbers, hyphens, and underscores'];
        }
        $orderId = trim((string) ($params['orderId'] ?? ''));
        if ($orderId !== '') {
            $duplicate = $this->database->fetchOne(
                'SELECT id FROM orders
                 WHERE steadfast_invoice = :invoice AND deleted_at IS NULL AND id <> :order_id
                 LIMIT 1',
                [':invoice' => $invoice, ':order_id' => $orderId]
            );
            if ($duplicate !== null) {
                return ['error' => 'Invoice must be unique; this value is already used by another order'];
            }
        }

        $response = $this->request(
            'POST',
            $baseUrl . '/create_order',
            [
                'Api-Key' => trim((string) ($params['apiKey'] ?? '')),
                'Secret-Key' => trim((string) ($params['secretKey'] ?? '')),
            ],
            [
                'invoice' => $invoice,
                'recipient_name' => trim((string) ($params['recipientName'] ?? '')),
                'recipient_phone' => trim((string) ($params['recipientPhone'] ?? '')),
                'recipient_address' => trim((string) ($params['recipientAddress'] ?? '')),
                'cod_amount' => (float) ($params['codAmount'] ?? 0),
            ]
        );

        if ($response['status'] < 200 || $response['status'] >= 300) {
            return ['error' => 'HTTP ' . $response['status']];
        }

        return is_array($response['json']) ? $response['json'] : ['error' => 'Invalid response'];
    }

    public function fetchSteadfastStatusByTrackingCode(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        $trackingCode = trim((string) ($params['trackingCode'] ?? ''));
        if ($baseUrl === '' || trim((string) ($params['apiKey'] ?? '')) === '' || trim((string) ($params['secretKey'] ?? '')) === '' || $trackingCode === '') {
            return ['error' => 'Missing required parameters'];
        }

        $response = $this->request(
            'GET',
            $baseUrl . '/status_by_trackingcode/' . rawurlencode($trackingCode),
            [
                'Api-Key' => trim((string) ($params['apiKey'] ?? '')),
                'Secret-Key' => trim((string) ($params['secretKey'] ?? '')),
            ]
        );

        if ($response['status'] < 200 || $response['status'] >= 300) {
            return ['error' => 'HTTP ' . $response['status']];
        }

        return ['data' => $response['json']];
    }

    public function fetchSteadfastStatusByConsignmentId(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        $consignmentId = trim((string) ($params['consignmentId'] ?? ''));
        if ($baseUrl === '' || trim((string) ($params['apiKey'] ?? '')) === '' || trim((string) ($params['secretKey'] ?? '')) === '' || $consignmentId === '') {
            return ['error' => 'Missing required parameters'];
        }

        $response = $this->request(
            'GET',
            $baseUrl . '/status_by_cid/' . rawurlencode($consignmentId),
            [
                'Api-Key' => trim((string) ($params['apiKey'] ?? '')),
                'Secret-Key' => trim((string) ($params['secretKey'] ?? '')),
            ]
        );

        if ($response['status'] < 200 || $response['status'] >= 300) {
            return ['error' => 'HTTP ' . $response['status']];
        }

        return ['data' => $response['json']];
    }

    public function submitPaperflyOrder(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        $username = trim((string) ($params['username'] ?? ''));
        $password = trim((string) ($params['password'] ?? ''));
        $paperflyKey = trim((string) ($params['paperflyKey'] ?? ''));
        if ($baseUrl === '' || $username === '' || $password === '' || $paperflyKey === '') {
            return ['error' => 'Missing required parameters'];
        }

        $response = $this->request(
            'POST',
            $baseUrl . '/merchant/api/service/new_order_v2.php',
            [
                'Authorization' => 'Basic ' . base64_encode($username . ':' . $password),
                'paperflykey' => $paperflyKey,
            ],
            [
                'merchantOrderReference' => trim((string) ($params['merchantOrderReference'] ?? '')),
                'storeName' => trim((string) ($params['storeName'] ?? '')),
                'productBrief' => trim((string) ($params['productBrief'] ?? '')),
                'packagePrice' => (string) ($params['packagePrice'] ?? ''),
                'max_weight' => (string) ($params['maxWeightKg'] ?? ''),
                'customerName' => trim((string) ($params['customerName'] ?? '')),
                'customerAddress' => trim((string) ($params['customerAddress'] ?? '')),
                'customerPhone' => trim((string) ($params['customerPhone'] ?? '')),
            ]
        );

        if ($response['status'] < 200 || $response['status'] >= 300) {
            return ['error' => 'HTTP ' . $response['status']];
        }

        return is_array($response['json']) ? $response['json'] : ['error' => 'Invalid response'];
    }

    /**
     * Create an exchange order via Paperfly.
     * POST /merchant/api/service/new_order_v2.php with orderType=Exchange
     */
    public function submitPaperflyExchangeOrder(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        $username = trim((string) ($params['username'] ?? ''));
        $password = trim((string) ($params['password'] ?? ''));
        $paperflyKey = trim((string) ($params['paperflyKey'] ?? ''));
        if ($baseUrl === '' || $username === '' || $password === '' || $paperflyKey === '') {
            return ['error' => 'Missing required parameters'];
        }

        $response = $this->request(
            'POST',
            $baseUrl . '/merchant/api/service/new_order_v2.php',
            [
                'Authorization' => 'Basic ' . base64_encode($username . ':' . $password),
                'paperflykey' => $paperflyKey,
            ],
            [
                'merchantOrderReference' => trim((string) ($params['merchantOrderReference'] ?? '')),
                'storeName' => trim((string) ($params['storeName'] ?? '')),
                'productBrief' => trim((string) ($params['productBrief'] ?? '')),
                'packagePrice' => (string) ($params['packagePrice'] ?? ''),
                'max_weight' => (string) ($params['maxWeightKg'] ?? ''),
                'customerName' => trim((string) ($params['customerName'] ?? '')),
                'customerAddress' => trim((string) ($params['customerAddress'] ?? '')),
                'customerPhone' => trim((string) ($params['customerPhone'] ?? '')),
                'orderType' => 'Exchange',
                'exchangeDescription' => trim((string) ($params['exchangeDescription'] ?? 'Exchange product')),
                'exchangePrice' => (string) ($params['exchangePrice'] ?? '0'),
                'exchangeWeight' => (string) ($params['exchangeWeightKg'] ?? '0.5'),
            ]
        );

        if ($response['status'] < 200 || $response['status'] >= 300) {
            return ['error' => 'HTTP ' . $response['status']];
        }

        return is_array($response['json']) ? $response['json'] : ['error' => 'Invalid response'];
    }

    public function fetchPaperflyOrderTracking(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        $username = trim((string) ($params['username'] ?? ''));
        $password = trim((string) ($params['password'] ?? ''));
        $paperflyKey = trim((string) ($params['paperflyKey'] ?? ''));
        $referenceNumber = trim((string) ($params['referenceNumber'] ?? ''));
        if ($baseUrl === '' || $username === '' || $password === '' || $paperflyKey === '' || $referenceNumber === '') {
            return ['error' => 'Missing required parameters'];
        }

        $response = $this->request(
            'POST',
            $baseUrl . '/API-Order-Tracking',
            [
                'Authorization' => 'Basic ' . base64_encode($username . ':' . $password),
                'paperflykey' => $paperflyKey,
            ],
            ['ReferenceNumber' => $referenceNumber]
        );

        if ($response['status'] < 200 || $response['status'] >= 300) {
            return ['error' => 'HTTP ' . $response['status']];
        }

        return ['data' => $response['json']];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function extractPaperflyTrackingEntries(array $payload): array
    {
        foreach ([
            $payload['success']['trackingStatus'] ?? null,
            $payload['trackingStatus'] ?? null,
            $payload['data']['trackingStatus'] ?? null,
            $payload['data']['success']['trackingStatus'] ?? null,
        ] as $candidate) {
            if (!is_array($candidate)) {
                continue;
            }

            $entries = array_values(array_filter($candidate, static fn ($entry): bool => is_array($entry)));
            if ($entries !== []) {
                /** @var array<int, array<string, mixed>> $entries */
                return $entries;
            }
        }

        return [];
    }

    private function extractPaperflyTrackingStatusEntry(array $payload): ?array
    {
        $entries = $this->extractPaperflyTrackingEntries($payload);
        return $entries[0] ?? null;
    }

    private function classifyPaperflyTrackingStatus(array $payload): array
    {
        $entries = $this->extractPaperflyTrackingEntries($payload);
        $rawStatus = '';
        $normalizedValues = [];
        $directPickupMarkers = [];

        foreach ($entries as $entry) {
            foreach ($entry as $key => $value) {
                if (!is_scalar($value)) {
                    continue;
                }

                $text = trim((string) $value);
                if ($text === '') {
                    continue;
                }

                $normalizedKey = strtolower(trim((string) $key));
                if (in_array($normalizedKey, ['pick', 'pickup', 'picked'], true)) {
                    $directPickupMarkers[] = $text;
                }

                $normalizedValues[] = strtolower($text);
                if ($rawStatus === '' && in_array($normalizedKey, ['status', 'currentstatus', 'current_status', 'remarks', 'remark', 'pickup', 'pick'], true)) {
                    $rawStatus = $text;
                }
            }
        }

        foreach ($directPickupMarkers as $marker) {
            $normalizedMarker = strtolower($marker);
            if (!in_array($normalizedMarker, ['0', 'false', 'no', 'n/a', 'na', 'null', 'none', 'pending'], true)) {
                $rawStatus = $rawStatus !== '' ? $rawStatus : $marker;
                break;
            }
        }

        if ($rawStatus === '') {
            foreach ($entries as $entry) {
                $parts = [];
                foreach ($entry as $value) {
                    if (!is_scalar($value)) {
                        continue;
                    }

                    $text = trim((string) $value);
                    if ($text !== '') {
                        $parts[] = $text;
                    }
                }

                if ($parts !== []) {
                    $rawStatus = implode(' | ', $parts);
                    break;
                }
            }
        }

        $normalized = strtolower($rawStatus);
        $status = null;

        if (strpos($normalized, 'delivered') !== false) {
            $status = 'Delivered';
        } elseif (strpos($normalized, 'returned') !== false || strpos($normalized, 'return') !== false) {
            $status = 'Returned';
        } elseif (strpos($normalized, 'cancel') !== false) {
            $status = 'Cancelled';
        }

        $hasPositiveSignal = false;
        $positivePatterns = [
            '/\bpicked\b/',
            '/\bpickup\b/',
            '/\bpicked up\b/',
            '/\bcollected\b/',
            '/\bin transit\b/',
            '/\bshipped\b/',
            '/\bdelivered\b/',
            '/\breturned\b/',
            '/\breturn\b/',
            '/\bdispatch(?:ed)?\b/',
            '/\breceived\b/',
        ];
        foreach ($positivePatterns as $pattern) {
            if (preg_match($pattern, $normalized) === 1) {
                $hasPositiveSignal = true;
                break;
            }
        }

        $hasNegativeSignal = false;
        $negativePatterns = [
            '/\bnot picked\b/',
            '/\bnot pickup\b/',
            '/\bpending\b/',
            '/\bbooked\b/',
            '/\border placed\b/',
            '/\bcreated\b/',
        ];
        foreach ($negativePatterns as $pattern) {
            if (preg_match($pattern, $normalized) === 1) {
                $hasNegativeSignal = true;
                break;
            }
        }

        if ($status === null && $hasPositiveSignal && !$hasNegativeSignal) {
            $status = 'Picked';
        }

        return [
            'rawStatus' => $rawStatus,
            'normalizedStatus' => $normalized,
            'status' => $status,
            'isPickedOrBeyond' => $status !== null && $status !== 'Cancelled',
        ];
    }

    private function classifySteadfastDeliveryStatus(array $payload): array
    {
        $rawStatus = '';
        foreach ([
            $payload['data']['delivery_status'] ?? null,
            $payload['delivery_status'] ?? null,
        ] as $candidate) {
            if ($candidate !== null && trim((string) $candidate) !== '') {
                $rawStatus = trim((string) $candidate);
                break;
            }
        }

        $normalized = strtolower($rawStatus);
        $status = null;

        if ($normalized !== '') {
            if (strpos($normalized, 'delivered') !== false) {
                $status = 'Delivered';
            } elseif (strpos($normalized, 'returned') !== false || strpos($normalized, 'cancelled_approval_pending') !== false) {
                $status = 'Returned';
            } elseif (strpos($normalized, 'cancel') !== false && strpos($normalized, 'cancelled_approval_pending') === false) {
                $status = 'Cancelled';
            } else {
                $status = 'Picked';
            }
        }

        return [
            'rawStatus' => $rawStatus,
            'normalizedStatus' => $normalized,
            'status' => $status,
            'isPickedOrBeyond' => $status !== null && $status !== 'Cancelled',
        ];
    }

    public function syncPaperflyOrderStatuses(array $params = []): array
    {
        $settings = $this->database->fetchOne('SELECT * FROM courier_settings LIMIT 1');
        $baseUrl = rtrim(trim((string) ($settings['paperfly_base_url'] ?? '')), '/');
        $username = trim((string) ($settings['paperfly_username'] ?? ''));
        $password = trim((string) ($settings['paperfly_password'] ?? ''));
        $paperflyKey = trim((string) ($settings['paperfly_key'] ?? ''));
        if ($baseUrl === '' || $username === '' || $password === '' || $paperflyKey === '') {
            return ['checked' => 0, 'updated' => 0];
        }

        $rows = $this->database->fetchAll(
            "SELECT id, order_number, status, history, paperfly_tracking_number
             FROM orders
             WHERE deleted_at IS NULL
               AND paperfly_tracking_number IS NOT NULL
               AND paperfly_tracking_number <> ''
               AND status IN ('On Hold', 'Processing', 'Courier assigned', 'Picked')"
        );

        $checked = 0;
        $updated = 0;
        foreach ($rows as $row) {
            $referenceNumber = trim((string) ($row['paperfly_tracking_number'] ?? ''));
            if ($referenceNumber === '') {
                $referenceNumber = trim((string) ($row['order_number'] ?? ''));
            }

            if ($referenceNumber === '') {
                continue;
            }
            $checked += 1;

            $details = $this->fetchPaperflyOrderTracking([
                'baseUrl' => $baseUrl,
                'username' => $username,
                'password' => $password,
                'paperflyKey' => $paperflyKey,
                'referenceNumber' => $referenceNumber,
            ]);

            if (!empty($details['error']) || !is_array($details['data'] ?? null)) {
                continue;
            }

            $statusInfo = $this->classifyPaperflyTrackingStatus($details['data']);
            if (empty($statusInfo['status'])) {
                continue;
            }

            $history = is_array(json_decode((string) ($row['history'] ?? ''), true)) ? json_decode((string) $row['history'], true) : [];
            $updates = ['history' => $history];

            if ($statusInfo['status'] === 'Delivered') {
                $updates['status'] = 'Completed';
                $updates['history']['completed'] = 'Marked delivered automatically from Paperfly tracking status "' . $statusInfo['rawStatus'] . '" using reference "' . $referenceNumber . '" on ' . gmdate('c');
            } elseif ($statusInfo['status'] === 'Returned') {
                $updates['status'] = 'Returned';
                $updates['history']['returned'] = 'Marked returned automatically from Paperfly tracking status "' . $statusInfo['rawStatus'] . '" using reference "' . $referenceNumber . '" on ' . gmdate('c');
            } elseif ($statusInfo['status'] === 'Cancelled') {
                $updates['status'] = 'Cancelled';
                $updates['history']['cancelled'] = 'Marked cancelled automatically from Paperfly tracking status "' . $statusInfo['rawStatus'] . '" using reference "' . $referenceNumber . '" on ' . gmdate('c');
            } else {
                $updates['status'] = 'Picked';
                $updates['history']['picked'] = 'Marked picked automatically from Paperfly tracking status "' . $statusInfo['rawStatus'] . '" using reference "' . $referenceNumber . '" on ' . gmdate('c');
            }

            $this->updateOrderAsCourierSystem([
                'id' => (string) $row['id'],
                'updates' => $updates,
            ]);
            $updated += 1;
        }

        return ['checked' => $checked, 'updated' => $updated];
    }

    public function syncSteadfastDeliveryStatuses(array $params = []): array
    {
        $settings = $this->database->fetchOne('SELECT * FROM courier_settings LIMIT 1');
        $baseUrl = rtrim(trim((string) ($settings['steadfast_base_url'] ?? '')), '/');
        $apiKey = trim((string) ($settings['steadfast_api_key'] ?? ''));
        $secretKey = trim((string) ($settings['steadfast_secret_key'] ?? ''));
        if ($baseUrl === '' || $apiKey === '' || $secretKey === '') {
            return ['checked' => 0, 'updated' => 0];
        }

        $rows = $this->database->fetchAll(
            "SELECT id, status, history, steadfast_consignment_id
             FROM orders
             WHERE deleted_at IS NULL
               AND steadfast_consignment_id IS NOT NULL
               AND steadfast_consignment_id <> ''
               AND status IN ('On Hold', 'Processing', 'Courier assigned', 'Picked')"
        );

        $checked = 0;
        $updated = 0;
        foreach ($rows as $row) {
            $consignmentId = trim((string) ($row['steadfast_consignment_id'] ?? ''));
            if ($consignmentId === '') {
                continue;
            }
            $checked += 1;

            $details = $this->fetchSteadfastStatusByConsignmentId([
                'baseUrl' => $baseUrl,
                'apiKey' => $apiKey,
                'secretKey' => $secretKey,
                'consignmentId' => $consignmentId,
            ]);
            if (!empty($details['error']) || !is_array($details['data'] ?? null)) {
                continue;
            }

            $statusInfo = $this->classifySteadfastDeliveryStatus($details['data']);
            if (empty($statusInfo['rawStatus']) || empty($statusInfo['status'])) {
                continue;
            }

            $history = is_array(json_decode((string) ($row['history'] ?? ''), true)) ? json_decode((string) $row['history'], true) : [];
            $updates = ['history' => $history];

            if ($statusInfo['status'] === 'Delivered') {
                $updates['status'] = 'Completed';
                $updates['history']['completed'] = 'Marked delivered automatically from Steadfast delivery status "' . $statusInfo['rawStatus'] . '" on ' . gmdate('c');
            } elseif ($statusInfo['status'] === 'Returned') {
                $updates['status'] = 'Returned';
                $updates['history']['returned'] = 'Marked returned automatically from Steadfast delivery status "' . $statusInfo['rawStatus'] . '" on ' . gmdate('c');
            } elseif ($statusInfo['status'] === 'Cancelled') {
                $updates['status'] = 'Cancelled';
                $updates['history']['cancelled'] = 'Marked cancelled automatically from Steadfast delivery status "' . $statusInfo['rawStatus'] . '" on ' . gmdate('c');
            } else {
                $updates['status'] = 'Picked';
                $updates['history']['picked'] = $updates['history']['picked'] ?? ('Marked picked automatically from Steadfast delivery status "' . $statusInfo['rawStatus'] . '" on ' . gmdate('c'));
            }

            $this->updateOrderAsCourierSystem([
                'id' => (string) $row['id'],
                'updates' => $updates,
            ]);
            $updated += 1;
        }

        return ['checked' => $checked, 'updated' => $updated];
    }

    /**
     * Sync exchange consignment statuses for all couriers.
     * Multi-step exchange flow: Exchange processing → Exchange picked → Exchange delivered.
     */
    public function syncExchangeConsignmentStatuses(array $params = []): array
    {
        $settings = $this->database->fetchOne('SELECT * FROM courier_settings LIMIT 1');
        $checked = 0;
        $updated = 0;

        // Steadfast exchange consignments
        $steadfastBaseUrl = rtrim(trim((string) ($settings['steadfast_base_url'] ?? '')), '/');
        $steadfastApiKey = trim((string) ($settings['steadfast_api_key'] ?? ''));
        $steadfastSecretKey = trim((string) ($settings['steadfast_secret_key'] ?? ''));
        if ($steadfastBaseUrl !== '' && $steadfastApiKey !== '' && $steadfastSecretKey !== '') {
            $rows = $this->database->fetchAll(
                "SELECT id, status, history, exchange_steadfast_consignment_id
                 FROM orders
                 WHERE deleted_at IS NULL
                   AND exchange_steadfast_consignment_id IS NOT NULL
                   AND exchange_steadfast_consignment_id <> ''
                   AND status IN ('Exchange processing', 'Exchange picked')"
            );
            foreach ($rows as $row) {
                $consignmentId = trim((string) ($row['exchange_steadfast_consignment_id'] ?? ''));
                if ($consignmentId === '') continue;
                $checked += 1;

                $details = $this->fetchSteadfastStatusByConsignmentId([
                    'baseUrl' => $steadfastBaseUrl,
                    'apiKey' => $steadfastApiKey,
                    'secretKey' => $steadfastSecretKey,
                    'consignmentId' => $consignmentId,
                ]);
                if (!empty($details['error']) || !is_array($details['data'] ?? null)) continue;

                $statusInfo = $this->classifySteadfastDeliveryStatus($details['data']);
                if (empty($statusInfo['rawStatus']) || empty($statusInfo['status'])) continue;

                $currentStatus = trim((string) ($row['status'] ?? ''));
                $history = is_array(json_decode((string) ($row['history'] ?? ''), true)) ? json_decode((string) $row['history'], true) : [];
                $updates = ['history' => $history];

                if ($statusInfo['status'] === 'Delivered') {
                    $updates['history']['exchangeDelivered'] = 'Exchange delivered via Steadfast (' . $statusInfo['rawStatus'] . ') on ' . gmdate('c');
                    $updates['status'] = 'Exchange delivered';
                    $updates['history']['exchangeCourier'] = ($updates['history']['exchangeCourier'] ?? '') . ' | Exchange delivered via Steadfast (' . $statusInfo['rawStatus'] . ') on ' . gmdate('c');
                } elseif ($statusInfo['status'] === 'Returned' || $statusInfo['status'] === 'Cancelled') {
                    $updates['history']['exchangeCourier'] = ($updates['history']['exchangeCourier'] ?? '') . ' | Exchange returned/cancelled via Steadfast (' . $statusInfo['rawStatus'] . ') on ' . gmdate('c');
                } elseif ($statusInfo['status'] === 'Picked' && $currentStatus === 'Exchange processing') {
                    $updates['status'] = 'Exchange picked';
                    $updates['history']['exchangePicked'] = 'Exchange picked up by Steadfast (' . $statusInfo['rawStatus'] . ') on ' . gmdate('c');
                } else {
                    continue;
                }

                $this->updateOrderAsCourierSystem(['id' => (string) $row['id'], 'updates' => $updates]);
                $updated += 1;
            }
        }

        // CarryBee exchange consignments
        $carrybeeBaseUrl = rtrim(trim((string) ($settings['carrybee_base_url'] ?? '')), '/');
        $carrybeeClientId = trim((string) ($settings['carrybee_client_id'] ?? ''));
        $carrybeeClientSecret = trim((string) ($settings['carrybee_client_secret'] ?? ''));
        $carrybeeClientContext = trim((string) ($settings['carrybee_client_context'] ?? ''));
        if ($carrybeeBaseUrl !== '' && $carrybeeClientId !== '' && $carrybeeClientSecret !== '') {
            $rows = $this->database->fetchAll(
                "SELECT id, status, history, exchange_carrybee_consignment_id
                 FROM orders
                 WHERE deleted_at IS NULL
                   AND exchange_carrybee_consignment_id IS NOT NULL
                   AND exchange_carrybee_consignment_id <> ''
                   AND status IN ('Exchange processing', 'Exchange picked')"
            );
            foreach ($rows as $row) {
                $consignmentId = trim((string) ($row['exchange_carrybee_consignment_id'] ?? ''));
                if ($consignmentId === '') continue;
                $checked += 1;

                $details = $this->fetchCarryBeeOrderDetails([
                    'baseUrl' => $carrybeeBaseUrl,
                    'clientId' => $carrybeeClientId,
                    'clientSecret' => $carrybeeClientSecret,
                    'clientContext' => $carrybeeClientContext,
                    'consignmentId' => $consignmentId,
                ]);
                if (!empty($details['error']) || !is_array($details['data'] ?? null)) continue;

                $rawStatus = strtolower(trim((string) (
                    $details['data']['order_status'] ??
                    $details['data']['data']['order_status'] ??
                    $details['data']['status'] ??
                    ''
                )));
                if ($rawStatus === '') continue;

                $currentStatus = trim((string) ($row['status'] ?? ''));
                $history = is_array(json_decode((string) ($row['history'] ?? ''), true)) ? json_decode((string) $row['history'], true) : [];
                $updates = ['history' => $history];

                if (strpos($rawStatus, 'delivered') !== false || strpos($rawStatus, 'complete') !== false) {
                    $updates['history']['exchangeDelivered'] = 'Exchange delivered via CarryBee (' . $rawStatus . ') on ' . gmdate('c');
                    $updates['status'] = 'Exchange delivered';
                    $updates['history']['exchangeCourier'] = ($updates['history']['exchangeCourier'] ?? '') . ' | Exchange delivered via CarryBee (' . $rawStatus . ') on ' . gmdate('c');
                } elseif (strpos($rawStatus, 'return') !== false || strpos($rawStatus, 'cancel') !== false) {
                    $updates['history']['exchangeCourier'] = ($updates['history']['exchangeCourier'] ?? '') . ' | Exchange returned/cancelled via CarryBee (' . $rawStatus . ') on ' . gmdate('c');
                } elseif ($currentStatus === 'Exchange processing') {
                    $updates['status'] = 'Exchange picked';
                    $updates['history']['exchangePicked'] = 'Exchange picked up by CarryBee (' . $rawStatus . ') on ' . gmdate('c');
                } else {
                    continue;
                }

                $this->updateOrderAsCourierSystem(['id' => (string) $row['id'], 'updates' => $updates]);
                $updated += 1;
            }
        }

        // Paperfly exchange consignments
        $paperflyBaseUrl = rtrim(trim((string) ($settings['paperfly_base_url'] ?? '')), '/');
        $paperflyUsername = trim((string) ($settings['paperfly_username'] ?? ''));
        $paperflyPassword = trim((string) ($settings['paperfly_password'] ?? ''));
        $paperflyKey = trim((string) ($settings['paperfly_key'] ?? ''));
        if ($paperflyBaseUrl !== '' && $paperflyUsername !== '' && $paperflyPassword !== '') {
            $rows = $this->database->fetchAll(
                "SELECT id, status, history, exchange_paperfly_tracking_number
                 FROM orders
                 WHERE deleted_at IS NULL
                   AND exchange_paperfly_tracking_number IS NOT NULL
                   AND exchange_paperfly_tracking_number <> ''
                   AND status IN ('Exchange processing', 'Exchange picked')"
            );
            foreach ($rows as $row) {
                $referenceNumber = trim((string) ($row['exchange_paperfly_tracking_number'] ?? ''));
                if ($referenceNumber === '') continue;
                $checked += 1;

                $details = $this->fetchPaperflyOrderTracking([
                    'baseUrl' => $paperflyBaseUrl,
                    'username' => $paperflyUsername,
                    'password' => $paperflyPassword,
                    'paperflyKey' => $paperflyKey,
                    'referenceNumber' => $referenceNumber,
                ]);
                if (!empty($details['error']) || !is_array($details['data'] ?? null)) continue;

                $trackingData = $details['data'];
                $entries = [];
                if (isset($trackingData['data']) && is_array($trackingData['data'])) {
                    $entries = $trackingData['data'];
                } elseif (isset($trackingData['success']) && is_array($trackingData['success'])) {
                    $entries = $trackingData['success'];
                }

                $isDelivered = false;
                $isReturned = false;
                $isPicked = false;
                foreach ($entries as $entry) {
                    $status = strtolower(trim((string) ($entry['status'] ?? $entry['delivery_status'] ?? '')));
                    if (strpos($status, 'delivered') !== false || strpos($status, 'complete') !== false) {
                        $isDelivered = true;
                    }
                    if (strpos($status, 'return') !== false) {
                        $isReturned = true;
                    }
                    if ($status !== '' && strpos($status, 'delivered') === false && strpos($status, 'complete') === false && strpos($status, 'return') === false) {
                        $isPicked = true;
                    }
                }

                if (!$isDelivered && !$isReturned && !$isPicked) continue;

                $currentStatus = trim((string) ($row['status'] ?? ''));
                $history = is_array(json_decode((string) ($row['history'] ?? ''), true)) ? json_decode((string) $row['history'], true) : [];
                $updates = ['history' => $history];

                if ($isDelivered) {
                    $updates['history']['exchangeDelivered'] = 'Exchange delivered via Paperfly on ' . gmdate('c');
                    $updates['status'] = 'Exchange delivered';
                    $updates['history']['exchangeCourier'] = ($updates['history']['exchangeCourier'] ?? '') . ' | Exchange delivered via Paperfly on ' . gmdate('c');
                } elseif ($isReturned) {
                    $updates['history']['exchangeCourier'] = ($updates['history']['exchangeCourier'] ?? '') . ' | Exchange returned via Paperfly on ' . gmdate('c');
                } elseif ($isPicked && $currentStatus === 'Exchange processing') {
                    $updates['status'] = 'Exchange picked';
                    $updates['history']['exchangePicked'] = 'Exchange picked up by Paperfly on ' . gmdate('c');
                } else {
                    continue;
                }

                $this->updateOrderAsCourierSystem(['id' => (string) $row['id'], 'updates' => $updates]);
                $updated += 1;
            }
        }

        // Pathao exchange consignments
        $pathaoBaseUrl = rtrim(trim((string) ($settings['pathao_base_url'] ?? '')), '/');
        $pathaoClientId = trim((string) ($settings['pathao_client_id'] ?? ''));
        $pathaoClientSecret = trim((string) ($settings['pathao_client_secret'] ?? ''));
        $pathaoUsername = trim((string) ($settings['pathao_username'] ?? ''));
        $pathaoPassword = trim((string) ($settings['pathao_password'] ?? ''));
        if ($pathaoBaseUrl !== '' && $pathaoClientId !== '' && $pathaoClientSecret !== '') {
            // Get or refresh the access token
            $pathaoAccessToken = trim((string) ($settings['pathao_access_token'] ?? ''));
            $pathaoTokenExpiresAt = trim((string) ($settings['pathao_token_expires_at'] ?? ''));
            $pathaoRefreshToken = trim((string) ($settings['pathao_refresh_token'] ?? ''));
            $pathaoTokenExpired = $pathaoTokenExpiresAt !== '' && strtotime($pathaoTokenExpiresAt) < time();

            if ($pathaoAccessToken === '' || $pathaoTokenExpired) {
                if ($pathaoRefreshToken !== '') {
                    $tokenResult = $this->refreshPathaoToken([
                        'baseUrl' => $pathaoBaseUrl, 'clientId' => $pathaoClientId,
                        'clientSecret' => $pathaoClientSecret, 'refreshToken' => $pathaoRefreshToken,
                    ]);
                } elseif ($pathaoUsername !== '' && $pathaoPassword !== '') {
                    $tokenResult = $this->generatePathaoToken([
                        'baseUrl' => $pathaoBaseUrl, 'clientId' => $pathaoClientId,
                        'clientSecret' => $pathaoClientSecret, 'username' => $pathaoUsername, 'password' => $pathaoPassword,
                    ]);
                } else {
                    $tokenResult = ['error' => 'No Pathao token available'];
                }

                if (!empty($tokenResult['error'])) {
                    // Skip Pathao exchange sync if token generation fails
                } else {
                    $pathaoAccessToken = $tokenResult['accessToken'];
                    $expiresIn = $tokenResult['expiresIn'] ?? 86400;
                    $this->saveSingletonQuiet('courier_settings', 'courier-default', [
                        'pathao_access_token' => $pathaoAccessToken,
                        'pathao_refresh_token' => $tokenResult['refreshToken'] ?? $pathaoRefreshToken,
                        'pathao_token_expires_at' => gmdate('c', time() + $expiresIn),
                    ]);
                }
            }

            if (isset($pathaoAccessToken) && $pathaoAccessToken !== '') {
                $rows = $this->database->fetchAll(
                    "SELECT id, status, history, exchange_pathao_consignment_id
                     FROM orders
                     WHERE deleted_at IS NULL
                       AND exchange_pathao_consignment_id IS NOT NULL
                       AND exchange_pathao_consignment_id <> ''
                       AND status IN ('Exchange processing', 'Exchange picked')"
                );
                foreach ($rows as $row) {
                    $consignmentId = trim((string) ($row['exchange_pathao_consignment_id'] ?? ''));
                    if ($consignmentId === '') continue;
                    $checked += 1;

                    $details = $this->fetchPathaoOrderInfo([
                        'baseUrl' => $pathaoBaseUrl,
                        'accessToken' => $pathaoAccessToken,
                        'consignmentId' => $consignmentId,
                    ]);
                    if (!empty($details['error']) || !is_array($details['data'] ?? null)) continue;

                    $responseData = $details['data'];
                    $orderData = is_array($responseData['data'] ?? null) ? $responseData['data'] : $responseData;
                    $orderStatusSlug = strtolower(trim((string) ($orderData['order_status_slug'] ?? $orderData['order_status'] ?? '')));
                    if ($orderStatusSlug === '') continue;

                    $currentStatus = trim((string) ($row['status'] ?? ''));
                    $history = is_array(json_decode((string) ($row['history'] ?? ''), true)) ? json_decode((string) $row['history'], true) : [];
                    $updates = ['history' => $history];

                    if (strpos($orderStatusSlug, 'delivered') !== false) {
                        $updates['history']['exchangeDelivered'] = 'Exchange delivered via Pathao (' . $orderStatusSlug . ') on ' . gmdate('c');
                        $updates['status'] = 'Exchange delivered';
                        $updates['history']['exchangeCourier'] = ($updates['history']['exchangeCourier'] ?? '') . ' | Exchange delivered via Pathao (' . $orderStatusSlug . ') on ' . gmdate('c');
                    } elseif (strpos($orderStatusSlug, 'return') !== false || strpos($orderStatusSlug, 'cancel') !== false) {
                        $updates['history']['exchangeCourier'] = ($updates['history']['exchangeCourier'] ?? '') . ' | Exchange returned/cancelled via Pathao (' . $orderStatusSlug . ') on ' . gmdate('c');
                    } elseif (strpos($orderStatusSlug, 'picked') !== false && $currentStatus === 'Exchange processing') {
                        $updates['status'] = 'Exchange picked';
                        $updates['history']['exchangePicked'] = 'Exchange picked up by Pathao (' . $orderStatusSlug . ') on ' . gmdate('c');
                    } else {
                        continue;
                    }

                    $this->updateOrderAsCourierSystem(['id' => (string) $row['id'], 'updates' => $updates]);
                    $updated += 1;
                }
            }
        }

        return ['checked' => $checked, 'updated' => $updated];
    }

    // ===== Pathao Courier Methods =====

    /**
     * @return array<int, array{id: string, name: string}>
     */
    private function pathaoLocationCollection(array $response, string $idKey, string $nameKey): array
    {
        $payload = is_array($response['json'] ?? null) ? $response['json'] : [];
        if ($response['status'] < 200 || $response['status'] >= 300) {
            throw new RuntimeException((string) ($payload['message'] ?? $payload['error'] ?? ('Pathao location request failed with HTTP ' . $response['status'] . '.')));
        }

        $rows = $payload['data']['data'] ?? $payload['data'] ?? [];
        if (!is_array($rows)) {
            return [];
        }

        $locations = [];
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $id = trim((string) ($row[$idKey] ?? $row['id'] ?? ''));
            $name = trim((string) ($row[$nameKey] ?? $row['name'] ?? ''));
            if ($id === '' || $name === '') {
                continue;
            }
            $locations[] = ['id' => $id, 'name' => $name];
        }

        return $locations;
    }

    /** GET {baseUrl}/aladdin/api/v1/city-list */
    public function fetchPathaoCities(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        $accessToken = trim((string) ($params['accessToken'] ?? ''));
        if ($baseUrl === '' || $accessToken === '') {
            throw new RuntimeException('Pathao access token is not configured.');
        }

        return $this->pathaoLocationCollection($this->request(
            'GET',
            $baseUrl . '/aladdin/api/v1/city-list',
            ['Authorization' => 'Bearer ' . $accessToken, 'Accept' => 'application/json']
        ), 'city_id', 'city_name');
    }

    /** GET {baseUrl}/aladdin/api/v1/cities/{cityId}/zone-list */
    public function fetchPathaoZones(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        $accessToken = trim((string) ($params['accessToken'] ?? ''));
        $cityId = trim((string) ($params['cityId'] ?? ''));
        if ($baseUrl === '' || $accessToken === '' || $cityId === '') {
            throw new RuntimeException('Select a Pathao city before loading zones.');
        }

        return $this->pathaoLocationCollection($this->request(
            'GET',
            $baseUrl . '/aladdin/api/v1/cities/' . rawurlencode($cityId) . '/zone-list',
            ['Authorization' => 'Bearer ' . $accessToken, 'Accept' => 'application/json']
        ), 'zone_id', 'zone_name');
    }

    /** GET {baseUrl}/aladdin/api/v1/zones/{zoneId}/area-list */
    public function fetchPathaoAreas(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        $accessToken = trim((string) ($params['accessToken'] ?? ''));
        $zoneId = trim((string) ($params['zoneId'] ?? ''));
        if ($baseUrl === '' || $accessToken === '' || $zoneId === '') {
            throw new RuntimeException('Select a Pathao zone before loading areas.');
        }

        return $this->pathaoLocationCollection($this->request(
            'GET',
            $baseUrl . '/aladdin/api/v1/zones/' . rawurlencode($zoneId) . '/area-list',
            ['Authorization' => 'Bearer ' . $accessToken, 'Accept' => 'application/json']
        ), 'area_id', 'area_name');
    }

    /**
     * Generate a Pathao OAuth2 access token using the password grant.
     * POST {baseUrl}/aladdin/api/v1/issue-token
     */
    public function generatePathaoToken(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        $clientId = trim((string) ($params['clientId'] ?? ''));
        $clientSecret = trim((string) ($params['clientSecret'] ?? ''));
        $username = trim((string) ($params['username'] ?? ''));
        $password = trim((string) ($params['password'] ?? ''));

        if ($baseUrl === '' || $clientId === '' || $clientSecret === '') {
            return ['error' => 'Missing required Pathao credentials (baseUrl, clientId, clientSecret)'];
        }
        if ($username === '' || $password === '') {
            return ['error' => 'Missing Pathao username or password for token generation'];
        }

        $response = $this->request(
            'POST',
            $baseUrl . '/aladdin/api/v1/issue-token',
            ['Accept' => 'application/json'],
            [
                'client_id' => $clientId,
                'client_secret' => $clientSecret,
                'grant_type' => 'password',
                'username' => $username,
                'password' => $password,
            ]
        );

        if ($response['status'] < 200 || $response['status'] >= 300) {
            return ['error' => 'HTTP ' . $response['status'], 'raw' => $response['json'] ?? $response['body']];
        }

        $json = $response['json'];
        if (!is_array($json) || empty($json['access_token'])) {
            return ['error' => 'Pathao token response was missing required fields'];
        }

        return [
            'accessToken' => $json['access_token'],
            'refreshToken' => $json['refresh_token'] ?? '',
            'expiresIn' => (int) ($json['expires_in'] ?? 86400),
        ];
    }

    /**
     * Refresh a Pathao OAuth2 access token using the refresh_token grant.
     * POST {baseUrl}/aladdin/api/v1/issue-token
     */
    public function refreshPathaoToken(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        $clientId = trim((string) ($params['clientId'] ?? ''));
        $clientSecret = trim((string) ($params['clientSecret'] ?? ''));
        $refreshToken = trim((string) ($params['refreshToken'] ?? ''));

        if ($baseUrl === '' || $clientId === '' || $clientSecret === '') {
            return ['error' => 'Missing required Pathao credentials (baseUrl, clientId, clientSecret)'];
        }
        if ($refreshToken === '') {
            return ['error' => 'Missing Pathao refresh token'];
        }

        $response = $this->request(
            'POST',
            $baseUrl . '/aladdin/api/v1/issue-token',
            ['Accept' => 'application/json'],
            [
                'client_id' => $clientId,
                'client_secret' => $clientSecret,
                'grant_type' => 'refresh_token',
                'refresh_token' => $refreshToken,
            ]
        );

        if ($response['status'] < 200 || $response['status'] >= 300) {
            return ['error' => 'HTTP ' . $response['status'], 'raw' => $response['json'] ?? $response['body']];
        }

        $json = $response['json'];
        if (!is_array($json) || empty($json['access_token'])) {
            return ['error' => 'Pathao token response was missing required fields'];
        }

        return [
            'accessToken' => $json['access_token'],
            'refreshToken' => $json['refresh_token'] ?? '',
            'expiresIn' => (int) ($json['expires_in'] ?? 86400),
        ];
    }

    /**
     * Create a Pathao delivery order.
     * POST {baseUrl}/aladdin/api/v1/orders
     */
    public function submitPathaoOrder(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        $accessToken = trim((string) ($params['accessToken'] ?? ''));
        $storeId = trim((string) ($params['storeId'] ?? ''));

        if ($baseUrl === '' || $accessToken === '' || $storeId === '') {
            return ['error' => 'Missing required Pathao parameters (baseUrl, accessToken, storeId)'];
        }

        $recipientName = trim((string) ($params['recipientName'] ?? ''));
        $recipientPhone = trim((string) ($params['recipientPhone'] ?? ''));
        $recipientAddress = trim((string) ($params['recipientAddress'] ?? ''));
        $recipientCity = trim((string) ($params['recipientCity'] ?? ''));
        $recipientZone = trim((string) ($params['recipientZone'] ?? ''));
        $recipientArea = trim((string) ($params['recipientArea'] ?? ''));

        if ($recipientName === '' || $recipientPhone === '' || $recipientAddress === '' || $recipientCity === '' || $recipientZone === '') {
            return ['error' => 'Missing required order fields: recipient name, phone, address, city, or zone'];
        }

        $payload = [
            'store_id' => $storeId,
            'recipient_name' => $recipientName,
            'recipient_phone' => $recipientPhone,
            'recipient_address' => $recipientAddress,
            'recipient_city' => (int) $recipientCity,
            'recipient_zone' => (int) $recipientZone,
            'delivery_type' => (int) ($params['deliveryType'] ?? 48),
            'item_type' => (int) ($params['itemType'] ?? 2),
            'item_quantity' => (int) ($params['itemQuantity'] ?? 1),
            'item_weight' => (float) ($params['itemWeight'] ?? 1.0),
            'amount_to_collect' => max(0, (int) round((float) ($params['amountToCollect'] ?? 0))),
        ];
        $merchantOrderId = trim((string) ($params['merchantOrderId'] ?? ''));
        if ($merchantOrderId !== '') {
            $payload['merchant_order_id'] = $merchantOrderId;
        }
        if ($recipientArea !== '') {
            $payload['recipient_area'] = (int) $recipientArea;
        }

        $specialInstruction = trim((string) ($params['specialInstruction'] ?? ''));
        if ($specialInstruction !== '') {
            $payload['special_instruction'] = $specialInstruction;
        }

        $response = $this->request(
            'POST',
            $baseUrl . '/aladdin/api/v1/orders',
            [
                'Authorization' => 'Bearer ' . $accessToken,
                'Accept' => 'application/json',
            ],
            $payload
        );

        if ($response['status'] < 200 || $response['status'] >= 300) {
            return ['error' => 'HTTP ' . $response['status'], 'raw' => $response['json'] ?? $response['body']];
        }

        return is_array($response['json']) ? $response['json'] : ['error' => 'Invalid response'];
    }

    /**
     * Fetch Pathao order info (used for auto pickup/delivery status check).
     * POST {baseUrl}/aladdin/api/v1/orders/{consignmentId}/info
     */
    public function fetchPathaoOrderInfo(array $params): array
    {
        $baseUrl = $this->trimBaseUrl($params);
        $accessToken = trim((string) ($params['accessToken'] ?? ''));
        $consignmentId = trim((string) ($params['consignmentId'] ?? ''));

        if ($baseUrl === '' || $accessToken === '' || $consignmentId === '') {
            return ['error' => 'Missing required Pathao parameters (baseUrl, accessToken, consignmentId)'];
        }

        $response = $this->request(
            'POST',
            $baseUrl . '/aladdin/api/v1/orders/' . rawurlencode($consignmentId) . '/info',
            [
                'Authorization' => 'Bearer ' . $accessToken,
                'Accept' => 'application/json',
            ]
        );

        if ($response['status'] < 200 || $response['status'] >= 300) {
            return ['error' => 'HTTP ' . $response['status'], 'raw' => $response['json'] ?? $response['body']];
        }

        return ['data' => $response['json']];
    }

    /**
     * Classify a Pathao order status slug into a normalized status.
     * Keywords: "picked" → Picked, "delivered" → Delivered, "returned" → Returned, "cancelled" → Cancelled
     */
    private function classifyPathaoStatus(string $orderStatusSlug): array
    {
        $normalized = strtolower(trim($orderStatusSlug));
        $status = null;

        if ($normalized !== '') {
            if (strpos($normalized, 'delivered') !== false) {
                $status = 'Delivered';
            } elseif (strpos($normalized, 'returned') !== false) {
                $status = 'Returned';
            } elseif (strpos($normalized, 'cancelled') !== false || strpos($normalized, 'canceled') !== false) {
                $status = 'Cancelled';
            } elseif (strpos($normalized, 'picked') !== false) {
                $status = 'Picked';
            } else {
                // Any other non-empty status means the order is in transit
                $status = 'Picked';
            }
        }

        return [
            'rawStatus' => $orderStatusSlug,
            'normalizedStatus' => $normalized,
            'status' => $status,
            'isPickedOrBeyond' => $status !== null && $status !== 'Cancelled',
        ];
    }

    /**
     * Sync delivery statuses for all Pathao orders.
     * Checks order_status_slug via the /info endpoint for keywords: picked, delivered.
     */
    public function syncPathaoDeliveryStatuses(array $params = []): array
    {
        $settings = $this->database->fetchOne('SELECT * FROM courier_settings LIMIT 1');
        $baseUrl = rtrim(trim((string) ($settings['pathao_base_url'] ?? '')), '/');
        $clientId = trim((string) ($settings['pathao_client_id'] ?? ''));
        $clientSecret = trim((string) ($settings['pathao_client_secret'] ?? ''));
        $username = trim((string) ($settings['pathao_username'] ?? ''));
        $password = trim((string) ($settings['pathao_password'] ?? ''));

        if ($baseUrl === '' || $clientId === '' || $clientSecret === '') {
            return ['checked' => 0, 'updated' => 0];
        }

        // Get or refresh the access token
        $accessToken = trim((string) ($settings['pathao_access_token'] ?? ''));
        $tokenExpiresAt = trim((string) ($settings['pathao_token_expires_at'] ?? ''));
        $refreshToken = trim((string) ($settings['pathao_refresh_token'] ?? ''));

        $tokenExpired = $tokenExpiresAt !== '' && strtotime($tokenExpiresAt) < time();

        if ($accessToken === '' || $tokenExpired) {
            // Try refresh first, then password grant
            if ($refreshToken !== '') {
                $tokenResult = $this->refreshPathaoToken([
                    'baseUrl' => $baseUrl,
                    'clientId' => $clientId,
                    'clientSecret' => $clientSecret,
                    'refreshToken' => $refreshToken,
                ]);
            } elseif ($username !== '' && $password !== '') {
                $tokenResult = $this->generatePathaoToken([
                    'baseUrl' => $baseUrl,
                    'clientId' => $clientId,
                    'clientSecret' => $clientSecret,
                    'username' => $username,
                    'password' => $password,
                ]);
            } else {
                return ['checked' => 0, 'updated' => 0, 'error' => 'No valid Pathao token and no credentials to generate one'];
            }

            if (!empty($tokenResult['error'])) {
                return ['checked' => 0, 'updated' => 0, 'error' => $tokenResult['error']];
            }

            $accessToken = $tokenResult['accessToken'];
            $expiresIn = $tokenResult['expiresIn'] ?? 86400;
            $newRefreshToken = $tokenResult['refreshToken'] ?? $refreshToken;
            $newExpiresAt = gmdate('c', time() + $expiresIn);

            // Persist the new token
            $this->saveSingletonQuiet('courier_settings', 'courier-default', [
                'pathao_access_token' => $accessToken,
                'pathao_refresh_token' => $newRefreshToken,
                'pathao_token_expires_at' => $newExpiresAt,
            ]);
        }

        $rows = $this->database->fetchAll(
            "SELECT id, order_number, status, history, pathao_consignment_id
             FROM orders
             WHERE deleted_at IS NULL
               AND pathao_consignment_id IS NOT NULL
               AND pathao_consignment_id <> ''
               AND status IN ('On Hold', 'Processing', 'Courier assigned', 'Picked')"
        );

        $checked = 0;
        $updated = 0;
        foreach ($rows as $row) {
            $consignmentId = trim((string) ($row['pathao_consignment_id'] ?? ''));
            if ($consignmentId === '') {
                continue;
            }
            $checked += 1;

            $details = $this->fetchPathaoOrderInfo([
                'baseUrl' => $baseUrl,
                'accessToken' => $accessToken,
                'consignmentId' => $consignmentId,
            ]);

            if (!empty($details['error']) || !is_array($details['data'] ?? null)) {
                continue;
            }

            $responseData = $details['data'];
            // The response may have data nested under 'data' key
            $orderData = is_array($responseData['data'] ?? null) ? $responseData['data'] : $responseData;
            $orderStatusSlug = trim((string) ($orderData['order_status_slug'] ?? $orderData['order_status'] ?? ''));

            if ($orderStatusSlug === '') {
                continue;
            }

            $statusInfo = $this->classifyPathaoStatus($orderStatusSlug);
            if (empty($statusInfo['status'])) {
                continue;
            }

            $history = is_array(json_decode((string) ($row['history'] ?? ''), true)) ? json_decode((string) $row['history'], true) : [];
            $updates = ['history' => $history];

            if ($statusInfo['status'] === 'Delivered') {
                $updates['status'] = 'Completed';
                $updates['history']['completed'] = 'Marked delivered automatically from Pathao order status "' . $statusInfo['rawStatus'] . '" on ' . gmdate('c');
            } elseif ($statusInfo['status'] === 'Returned') {
                $updates['status'] = 'Returned';
                $updates['history']['returned'] = 'Marked returned automatically from Pathao order status "' . $statusInfo['rawStatus'] . '" on ' . gmdate('c');
            } elseif ($statusInfo['status'] === 'Cancelled') {
                $updates['status'] = 'Cancelled';
                $updates['history']['cancelled'] = 'Marked cancelled automatically from Pathao order status "' . $statusInfo['rawStatus'] . '" on ' . gmdate('c');
            } else {
                $updates['status'] = 'Picked';
                $updates['history']['picked'] = $updates['history']['picked'] ?? ('Marked picked automatically from Pathao order status "' . $statusInfo['rawStatus'] . '" on ' . gmdate('c'));
            }

            $this->updateOrderAsCourierSystem([
                'id' => (string) $row['id'],
                'updates' => $updates,
            ]);
            $updated += 1;
        }

        return ['checked' => $checked, 'updated' => $updated];
    }

    /**
     * Receive one signed provider event. Exact retries are idempotent and the
     * entire status/charge/expense operation shares one database transaction.
     *
     * @param array<string, string> $headers
     * @return array<string, mixed>
     */
    public function handleWebhook(string $provider, string $rawBody, array $headers): array
    {
        $provider = strtolower(trim($provider));
        if (!in_array($provider, ['carrybee', 'paperfly', 'steadfast', 'pathao'], true)) {
            throw new RuntimeException('Unsupported courier webhook provider.');
        }
        if (!$this->tableExists('courier_webhook_events') || !$this->tableExists('courier_order_charges')) {
            throw new RuntimeException('Courier webhook database upgrade has not been applied.');
        }

        $settings = $this->database->fetchOne('SELECT * FROM courier_settings LIMIT 1') ?? [];
        $this->verifyWebhookRequest($provider, $headers, $settings);

        try {
            $payload = json_decode($rawBody, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException $exception) {
            throw new RuntimeException('Invalid courier webhook JSON.');
        }
        if (!is_array($payload)) {
            throw new RuntimeException('Invalid courier webhook payload.');
        }

        $details = $this->webhookDetails($provider, $payload);
        $eventKey = hash('sha256', $provider . '|' . $rawBody);
        $now = $this->database->nowUtc();

        return $this->database->transaction(function () use (
            $provider,
            $rawBody,
            $details,
            $eventKey,
            $now
        ): array {
            $candidateId = $this->uuid4();
            $this->database->execute(
                "INSERT INTO courier_webhook_events (
                    id, provider, event_key, event_name, merchant_reference, consignment_id,
                    event_at, payload, processing_status, received_at
                 ) VALUES (
                    :id, :provider, :event_key, :event_name, :merchant_reference, :consignment_id,
                    :event_at, :payload, 'received', :received_at
                 ) ON DUPLICATE KEY UPDATE event_key = VALUES(event_key)",
                [
                    ':id' => $candidateId,
                    ':provider' => $provider,
                    ':event_key' => $eventKey,
                    ':event_name' => $details['eventName'],
                    ':merchant_reference' => $details['merchantReference'] !== '' ? $details['merchantReference'] : null,
                    ':consignment_id' => $details['consignmentId'] !== '' ? $details['consignmentId'] : null,
                    ':event_at' => $details['eventAt'],
                    ':payload' => $rawBody,
                    ':received_at' => $now,
                ]
            );
            $eventRow = $this->database->fetchOne(
                'SELECT * FROM courier_webhook_events WHERE provider = :provider AND event_key = :event_key LIMIT 1 FOR UPDATE',
                [':provider' => $provider, ':event_key' => $eventKey]
            );
            if ($eventRow === null) {
                throw new RuntimeException('Courier webhook event could not be stored.');
            }
            if ((string) ($eventRow['processing_status'] ?? '') === 'processed') {
                return [
                    'status' => 'success',
                    'provider' => $provider,
                    'event' => $details['eventName'],
                    'duplicate' => true,
                ];
            }

            $orderMatch = $this->findWebhookOrder(
                $provider,
                $details['consignmentId'],
                $details['merchantReference'],
                $details['eventName']
            );
            $orderId = trim((string) ($orderMatch['id'] ?? ''));
            $charge = $this->upsertWebhookCharge(
                $provider,
                $details,
                (string) $eventRow['id'],
                $orderId
            );

            if ($orderId === '') {
                $message = 'No local order matched the courier identifiers.';
                $this->finishWebhookEvent((string) $eventRow['id'], 'unmatched', $message, null);
                return [
                    'status' => 'success',
                    'provider' => $provider,
                    'event' => $details['eventName'],
                    'duplicate' => false,
                    'orderMatched' => false,
                ];
            }

            $updates = $this->buildWebhookOrderUpdates(
                $provider,
                $details,
                $orderMatch,
                $charge
            );
            $updated = false;
            if ($updates !== []) {
                $this->updateOrderAsCourierSystem(['id' => $orderId, 'updates' => $updates]);
                $updated = true;
            }

            $chargeAfter = $charge === null ? null : $this->database->fetchOne(
                'SELECT expense_status FROM courier_order_charges WHERE id = :id LIMIT 1',
                [':id' => (string) $charge['id']]
            );
            $message = $updates === [] ? 'Event stored; no safe order status change was required.' : 'Order updated from courier webhook.';
            $this->finishWebhookEvent((string) $eventRow['id'], 'processed', $message, $orderId);

            return [
                'status' => 'success',
                'provider' => $provider,
                'event' => $details['eventName'],
                'duplicate' => false,
                'orderMatched' => true,
                'orderUpdated' => $updated,
                'expenseRecorded' => (string) ($chargeAfter['expense_status'] ?? '') === 'recorded',
            ];
        });
    }

    /** @param array<string, string> $headers @param array<string, mixed> $settings */
    private function verifyWebhookRequest(string $provider, array $headers, array $settings): void
    {
        $authorization = $this->webhookHeader($headers, 'Authorization');
        if ($provider === 'carrybee') {
            $expected = trim((string) ($settings['carrybee_webhook_signature'] ?? ''));
            $provided = $this->webhookHeader($headers, 'X-Carrybee-Webhook-Signature');
        } elseif ($provider === 'steadfast') {
            $expected = trim((string) ($settings['steadfast_api_key'] ?? ''));
            $provided = preg_replace('/^Bearer\s+/i', '', $authorization) ?? '';
        } elseif ($provider === 'paperfly') {
            $expected = trim((string) ($settings['paperfly_webhook_secret'] ?? ''));
            $provided = '';
            foreach (['X-Paperfly-Webhook-Secret', 'X-Webhook-Secret', 'Secret-Key'] as $headerName) {
                $candidate = $this->webhookHeader($headers, $headerName);
                if ($candidate !== '') {
                    $provided = $candidate;
                    break;
                }
            }
            if ($provided === '' && $authorization !== '') {
                $provided = preg_replace('/^Bearer\s+/i', '', $authorization) ?? '';
            }
        } else {
            $expected = trim((string) ($settings['pathao_webhook_secret'] ?? ''));
            $headerName = trim((string) ($settings['pathao_webhook_header'] ?? '')) ?: 'X-MamePilot-Webhook-Secret';
            $provided = $this->webhookHeader($headers, $headerName);
        }

        if ($expected === '' || $provided === '' || !hash_equals($expected, trim($provided))) {
            throw new RuntimeException('Invalid courier webhook signature.');
        }
    }

    /** @param array<string, string> $headers */
    private function webhookHeader(array $headers, string $name): string
    {
        foreach ($headers as $key => $value) {
            if (strcasecmp((string) $key, $name) === 0) {
                return trim((string) $value);
            }
        }
        return '';
    }

    /** @return array<string, mixed> */
    private function webhookDetails(string $provider, array $payload): array
    {
        $data = is_array($payload['data'] ?? null) ? $payload['data'] : [];
        $containers = [$payload, $data];
        $eventName = $this->firstWebhookValue($containers, ['event', 'notification_type', 'event_type', 'type']);
        if ($eventName === '') {
            $eventName = 'status.update';
        }
        $consignmentId = $this->firstWebhookValue($containers, [
            'consignment_id', 'consignmentId', 'order_number', 'tracking_code', 'tracking_number', 'barcode',
        ]);
        $merchantReference = $this->firstWebhookValue($containers, [
            'merchant_order_id', 'merchant_order_reference', 'merchantOrderReference', 'invoice', 'merchant_order_ref',
        ]);
        $eventAtRaw = $this->firstWebhookValue($containers, [
            'timestamptz', 'timestamp', 'updated_at', 'action_date_time', 'action_datetime', 'event_at',
        ]);
        $eventAt = null;
        if ($eventAtRaw !== '' && strtotime($eventAtRaw) !== false) {
            $eventAt = gmdate('Y-m-d H:i:s', (int) strtotime($eventAtRaw));
        }

        $codFee = $this->firstWebhookNumber($containers, ['cod_fee', 'cod_charge', 'collection_charge', 'collection_fee']);
        $deliveryFee = $this->firstWebhookNumber($containers, ['delivery_fee', 'delivery_charge', 'shipping_fee', 'shipping_charge']);
        $directTotal = $this->firstWebhookNumber($containers, ['total_charge', 'courier_charge', 'shipping_cost']);
        $totalCharge = round($codFee + $deliveryFee, 2);
        if ($totalCharge <= 0 && $directTotal > 0) {
            $totalCharge = round($directTotal, 2);
        }

        $rawStatus = $this->firstWebhookValue($containers, [
            'order_status_slug', 'order_status', 'delivery_status', 'status', 'tracking_status',
        ]);
        $mappedStatus = $this->mapWebhookStatus($provider, $eventName, $rawStatus);

        return [
            'eventName' => $eventName,
            'consignmentId' => $consignmentId,
            'merchantReference' => $merchantReference,
            'eventAt' => $eventAt,
            'codFee' => max(0, round($codFee, 2)),
            'deliveryFee' => max(0, round($deliveryFee, 2)),
            'totalCharge' => max(0, $totalCharge),
            'currency' => strtoupper($this->firstWebhookValue($containers, ['currency'])) ?: 'BDT',
            'rawStatus' => $rawStatus !== '' ? $rawStatus : $eventName,
            'mappedStatus' => $mappedStatus,
        ];
    }

    /** @param array<int, array<string, mixed>> $containers @param array<int, string> $keys */
    private function firstWebhookValue(array $containers, array $keys): string
    {
        foreach ($containers as $container) {
            foreach ($keys as $key) {
                if (isset($container[$key]) && is_scalar($container[$key])) {
                    $value = trim((string) $container[$key]);
                    if ($value !== '') {
                        return $value;
                    }
                }
            }
        }
        return '';
    }

    /** @param array<int, array<string, mixed>> $containers @param array<int, string> $keys */
    private function firstWebhookNumber(array $containers, array $keys): float
    {
        foreach ($containers as $container) {
            foreach ($keys as $key) {
                if (isset($container[$key]) && is_numeric($container[$key])) {
                    return max(0, (float) $container[$key]);
                }
            }
        }
        return 0.0;
    }

    private function mapWebhookStatus(string $provider, string $eventName, string $rawStatus): ?string
    {
        $event = strtolower(trim($eventName));
        $status = strtolower(trim($rawStatus));
        $combined = $event . ' ' . $status;

        if ($provider === 'carrybee') {
            return match ($event) {
                'order.picked' => 'Picked',
                'order.delivered' => 'Delivered',
                'order.returned' => 'Returned',
                'order.cancelled', 'order.canceled' => 'Cancelled',
                default => null,
            };
        }
        if ($provider === 'paperfly') {
            if (in_array($event, ['parcel.delivered', 'parcel.exchange'], true)) return 'Delivered';
            if (in_array($event, ['parcel.return', 'parcel.return_to_merchant'], true)) return 'Returned';
            if ($event === 'parcel.cancelled') return 'Cancelled';
            if (in_array($event, [
                'parcel.picked_up', 'parcel.in_transit', 'parcel.received_at_point',
                'parcel.assigned_for_delivery', 'parcel.partial', 'parcel.return_transit',
            ], true)) return 'Picked';
            return null;
        }
        if ($provider === 'steadfast' && $event === 'tracking_update') {
            return null;
        }
        if (str_contains($combined, 'cancel') || str_contains($combined, 'canceled')) return 'Cancelled';
        if (str_contains($combined, 'return')) return 'Returned';
        if (
            str_contains($status, 'deliver')
            || preg_match('/(^|[._ -])delivered?($|[._ -])/', $event) === 1
        ) return 'Delivered';
        if (
            str_contains($combined, 'pick') || str_contains($combined, 'transit')
            || str_contains($combined, 'assigned') || str_contains($combined, 'out for delivery')
            || str_contains($combined, 'received at')
        ) return 'Picked';
        return null;
    }

    /** @return array<string, mixed>|null */
    private function findWebhookOrder(
        string $provider,
        string $consignmentId,
        string $merchantReference,
        string $eventName
    ): ?array {
        $columns = match ($provider) {
            'carrybee' => ['carrybee_consignment_id', 'exchange_carrybee_consignment_id'],
            'paperfly' => ['paperfly_tracking_number', 'exchange_paperfly_tracking_number'],
            'steadfast' => ['steadfast_consignment_id', 'exchange_steadfast_consignment_id'],
            'pathao' => ['pathao_consignment_id', 'exchange_pathao_consignment_id'],
        };
        $conditions = [];
        $bindings = [];
        if ($consignmentId !== '') {
            $conditions[] = "({$columns[0]} = :consignment_main OR {$columns[1]} = :consignment_exchange)";
            $bindings[':consignment_main'] = $consignmentId;
            $bindings[':consignment_exchange'] = $consignmentId;
        }
        if ($merchantReference !== '') {
            $conditions[] = '(order_number = :merchant_order_number OR id = :merchant_order_id)';
            $bindings[':merchant_order_number'] = $merchantReference;
            $bindings[':merchant_order_id'] = $merchantReference;
        }
        if ($conditions === []) {
            return null;
        }

        $row = $this->database->fetchOne(
            'SELECT * FROM orders WHERE deleted_at IS NULL AND (' . implode(' OR ', $conditions) . ')
             ORDER BY created_at DESC LIMIT 1 FOR UPDATE',
            $bindings
        );
        if ($row === null) {
            return null;
        }
        $mainId = trim((string) ($row[$columns[0]] ?? ''));
        $exchangeId = trim((string) ($row[$columns[1]] ?? ''));
        $isExchange = $consignmentId !== '' && $exchangeId === $consignmentId && $mainId !== $consignmentId;
        if ($provider === 'paperfly' && strtolower($eventName) === 'parcel.exchange') {
            $isExchange = true;
        }
        $consignmentDidNotIdentifyMain = $consignmentId === '' || $mainId !== $consignmentId;
        if (
            !$isExchange
            && $consignmentDidNotIdentifyMain
            && $exchangeId !== ''
            && in_array((string) ($row['status'] ?? ''), ['Exchange processing', 'Exchange picked'], true)
        ) {
            $isExchange = true;
        }
        $row['isExchange'] = $isExchange;
        return $row;
    }

    /** @return array<string, mixed>|null */
    private function upsertWebhookCharge(
        string $provider,
        array $details,
        string $eventId,
        string $orderId
    ): ?array {
        $reference = $details['consignmentId'] !== '' ? $details['consignmentId'] : $details['merchantReference'];
        if ($reference === '') {
            return null;
        }
        // A provider may quote a fee using only the merchant reference, then
        // reveal the consignment number later. Claim that still-unassigned row
        // when the consignment arrives, but never merge two already identified
        // main/exchange consignments that share one merchant order reference.
        $existingCharge = null;
        if ($details['consignmentId'] !== '') {
            $conditions = ['consignment_id = :match_consignment'];
            $matchBindings = [
                ':match_provider' => $provider,
                ':match_consignment' => $details['consignmentId'],
                ':rank_consignment' => $details['consignmentId'],
            ];
            if ($details['merchantReference'] !== '') {
                $conditions[] = '(merchant_reference = :match_merchant AND consignment_id IS NULL)';
                $matchBindings[':match_merchant'] = $details['merchantReference'];
            }
            $existingCharge = $this->database->fetchOne(
                'SELECT * FROM courier_order_charges
                 WHERE provider = :match_provider AND (' . implode(' OR ', $conditions) . ')
                 ORDER BY CASE WHEN consignment_id = :rank_consignment THEN 0 ELSE 1 END,
                          created_at ASC, id ASC
                 LIMIT 1 FOR UPDATE',
                $matchBindings
            );
        } elseif ($details['merchantReference'] !== '') {
            $existingCharge = $this->database->fetchOne(
                'SELECT * FROM courier_order_charges
                 WHERE provider = :match_provider AND merchant_reference = :match_merchant
                 ORDER BY CASE WHEN consignment_id IS NULL THEN 0 ELSE 1 END,
                          created_at ASC, id ASC
                 LIMIT 1 FOR UPDATE',
                [
                    ':match_provider' => $provider,
                    ':match_merchant' => $details['merchantReference'],
                ]
            );
        }
        $chargeKey = trim((string) ($existingCharge['charge_key'] ?? ''));
        if ($chargeKey === '') {
            $chargeKey = hash('sha256', $provider . '|' . $reference);
        }
        $id = $this->uuid4();
        $this->database->execute(
            "INSERT INTO courier_order_charges (
                id, provider, charge_key, order_id, consignment_id, merchant_reference,
                cod_fee, delivery_fee, total_charge, currency, source_event_id,
                provider_updated_at, created_at, updated_at
             ) VALUES (
                :id, :provider, :charge_key, :order_id, :consignment_id, :merchant_reference,
                :cod_fee, :delivery_fee, :total_charge, :currency, :source_event_id,
                :provider_updated_at, :created_at, :updated_at
             ) ON DUPLICATE KEY UPDATE
                order_id = COALESCE(VALUES(order_id), order_id),
                consignment_id = COALESCE(VALUES(consignment_id), consignment_id),
                merchant_reference = COALESCE(VALUES(merchant_reference), merchant_reference),
                cod_fee = IF(VALUES(cod_fee) > 0, VALUES(cod_fee), cod_fee),
                delivery_fee = IF(VALUES(delivery_fee) > 0, VALUES(delivery_fee), delivery_fee),
                total_charge = IF(VALUES(total_charge) > 0, VALUES(total_charge), total_charge),
                currency = VALUES(currency), source_event_id = VALUES(source_event_id),
                provider_updated_at = COALESCE(VALUES(provider_updated_at), provider_updated_at),
                updated_at = VALUES(updated_at)",
            [
                ':id' => $id,
                ':provider' => $provider,
                ':charge_key' => $chargeKey,
                ':order_id' => $orderId !== '' ? $orderId : null,
                ':consignment_id' => $details['consignmentId'] !== '' ? $details['consignmentId'] : null,
                ':merchant_reference' => $details['merchantReference'] !== '' ? $details['merchantReference'] : null,
                ':cod_fee' => $this->formatMoney($details['codFee']),
                ':delivery_fee' => $this->formatMoney($details['deliveryFee']),
                ':total_charge' => $this->formatMoney($details['totalCharge']),
                ':currency' => $details['currency'],
                ':source_event_id' => $eventId,
                ':provider_updated_at' => $details['eventAt'],
                ':created_at' => $this->database->nowUtc(),
                ':updated_at' => $this->database->nowUtc(),
            ]
        );
        $this->database->execute(
            'UPDATE courier_order_charges
             SET total_charge = CASE
                 WHEN cod_fee > 0 OR delivery_fee > 0 THEN ROUND(cod_fee + delivery_fee, 2)
                 ELSE total_charge
             END
             WHERE provider = :provider AND charge_key = :charge_key',
            [':provider' => $provider, ':charge_key' => $chargeKey]
        );
        return $this->database->fetchOne(
            'SELECT * FROM courier_order_charges WHERE provider = :provider AND charge_key = :charge_key LIMIT 1 FOR UPDATE',
            [':provider' => $provider, ':charge_key' => $chargeKey]
        );
    }

    /** @return array<string, mixed> */
    private function buildWebhookOrderUpdates(string $provider, array $details, array $order, ?array $charge): array
    {
        $mapped = $details['mappedStatus'];
        $current = (string) ($order['status'] ?? '');
        $isExchange = (bool) ($order['isExchange'] ?? false);
        $chargeId = trim((string) ($charge['id'] ?? ''));
        $hasCharge = (float) ($charge['total_charge'] ?? 0) > 0;
        $providerLabel = match ($provider) {
            'carrybee' => 'CarryBee',
            'paperfly' => 'Paperfly',
            'steadfast' => 'Steadfast',
            'pathao' => 'Pathao',
        };
        $when = (string) ($details['eventAt'] ?? $this->database->nowUtc());
        $raw = trim((string) ($details['rawStatus'] ?? $details['eventName']));
        $updates = [];
        $history = is_array(json_decode((string) ($order['history'] ?? ''), true))
            ? json_decode((string) $order['history'], true)
            : [];

        if ($mapped !== null) {
            $terminal = ['Completed', 'Returned', 'Cancelled', 'Exchange delivered'];
            $mainEventDuringExchange = !$isExchange
                && in_array($current, ['Exchange processing', 'Exchange picked'], true);
            $target = match ($mapped) {
                'Delivered' => $isExchange ? 'Exchange delivered' : 'Completed',
                'Returned' => $isExchange ? null : 'Returned',
                'Cancelled' => $isExchange ? null : 'Cancelled',
                'Picked' => $isExchange ? 'Exchange picked' : 'Picked',
                default => null,
            };
            if (
                $target !== null
                && !$mainEventDuringExchange
                && (!in_array($current, $terminal, true) || $current === $target)
            ) {
                if ($current !== $target) {
                    $updates['status'] = $target;
                    if ($mapped === 'Delivered') {
                        $key = $isExchange ? 'exchangeDelivered' : 'completed';
                        $history[$key] = sprintf(
                            'Marked delivered automatically from %s webhook event "%s" on %s.',
                            $providerLabel,
                            $raw,
                            $when
                        );
                    } elseif ($mapped === 'Returned') {
                        $history['returned'] = sprintf(
                            'Marked returned automatically from %s webhook event "%s" on %s.',
                            $providerLabel,
                            $raw,
                            $when
                        );
                    } elseif ($mapped === 'Cancelled') {
                        $history['cancelled'] = sprintf(
                            'Marked cancelled automatically from %s webhook event "%s" on %s.',
                            $providerLabel,
                            $raw,
                            $when
                        );
                    } else {
                        $key = $isExchange ? 'exchangePicked' : 'picked';
                        $history[$key] = $history[$key] ?? sprintf(
                            'Marked picked automatically from %s webhook event "%s" on %s.',
                            $providerLabel,
                            $raw,
                            $when
                        );
                    }
                    $updates['history'] = $history;
                }
            } elseif ($isExchange && in_array($mapped, ['Returned', 'Cancelled'], true)) {
                $history['exchangeCourier'] = trim((string) ($history['exchangeCourier'] ?? ''))
                    . sprintf(' | Exchange returned/cancelled from %s webhook event "%s" on %s.', $providerLabel, $raw, $when);
                $updates['history'] = $history;
            }
        }

        $effectiveTarget = (string) ($updates['status'] ?? $current);
        if ($chargeId !== '' && $hasCharge && in_array($effectiveTarget, ['Completed', 'Exchange delivered'], true)) {
            $updates['courierAutomaticExpense'] = [
                'chargeId' => $chargeId,
                'provider' => $provider,
                'recordedAt' => $details['eventAt'] ?? $this->database->nowUtc(),
            ];
        }
        return $updates;
    }

    private function finishWebhookEvent(string $eventId, string $status, string $message, ?string $orderId): void
    {
        $this->database->execute(
            'UPDATE courier_webhook_events
             SET order_id = :order_id, processing_status = :processing_status,
                 processing_message = :processing_message, processed_at = :processed_at
             WHERE id = :id',
            [
                ':order_id' => $orderId,
                ':processing_status' => $status,
                ':processing_message' => $message,
                ':processed_at' => $this->database->nowUtc(),
                ':id' => $eventId,
            ]
        );
    }

    /**
     * Quietly save settings without requiring admin auth (used for token persistence during sync).
     */
    private function saveSingletonQuiet(string $table, string $id, array $updates): void
    {
        $existing = $this->database->fetchOne("SELECT id FROM {$table} WHERE id = ?", [$id]);
        if ($existing === null) {
            $columns = array_keys($updates);
            $columns[] = 'id';
            $placeholders = array_fill(0, count($columns), '?');
            $sql = "INSERT INTO {$table} (" . implode(', ', $columns) . ') VALUES (' . implode(', ', $placeholders) . ')';
            $values = array_values($updates);
            $values[] = $id;
            $this->database->execute($sql, $values);
        } else {
            $setClauses = [];
            $values = [];
            foreach ($updates as $column => $value) {
                $setClauses[] = "{$column} = ?";
                $values[] = $value;
            }
            $sql = "UPDATE {$table} SET " . implode(', ', $setClauses) . ' WHERE id = ?';
            $values[] = $id;
            $this->database->execute($sql, $values);
        }
    }
}
