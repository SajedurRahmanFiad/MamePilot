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
             WHERE deleted_at IS NULL AND role IN ('Admin', 'Developer')
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
        if (!$this->columnExists('customers', 'fraud_check_result')) {
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
        if ($baseUrl === '' || trim((string) ($params['apiKey'] ?? '')) === '' || trim((string) ($params['secretKey'] ?? '')) === '' || trim((string) ($params['invoice'] ?? '')) === '') {
            return ['error' => 'Missing required parameters'];
        }

        $response = $this->request(
            'POST',
            $baseUrl . '/create_order',
            [
                'Api-Key' => trim((string) ($params['apiKey'] ?? '')),
                'Secret-Key' => trim((string) ($params['secretKey'] ?? '')),
            ],
            [
                'invoice' => trim((string) ($params['invoice'] ?? '')),
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
            $trackingCode = trim((string) ($row['steadfast_consignment_id'] ?? ''));
            if ($trackingCode === '') {
                continue;
            }
            $checked += 1;

            $details = $this->fetchSteadfastStatusByTrackingCode([
                'baseUrl' => $baseUrl,
                'apiKey' => $apiKey,
                'secretKey' => $secretKey,
                'trackingCode' => $trackingCode,
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
     * Multi-step exchange flow: Exchange processing → Exchange picked → Exchange delivered → Completed.
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
                $trackingCode = trim((string) ($row['exchange_steadfast_consignment_id'] ?? ''));
                if ($trackingCode === '') continue;
                $checked += 1;

                $details = $this->fetchSteadfastStatusByTrackingCode([
                    'baseUrl' => $steadfastBaseUrl,
                    'apiKey' => $steadfastApiKey,
                    'secretKey' => $steadfastSecretKey,
                    'trackingCode' => $trackingCode,
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

        if ($recipientName === '' || $recipientPhone === '' || $recipientAddress === '') {
            return ['error' => 'Missing required order fields: recipient name, phone, or address'];
        }

        $payload = [
            'store_id' => $storeId,
            'recipient_name' => $recipientName,
            'recipient_phone' => $recipientPhone,
            'recipient_address' => $recipientAddress,
            'delivery_type' => (int) ($params['deliveryType'] ?? 48),
            'item_type' => (int) ($params['itemType'] ?? 2),
            'item_quantity' => (int) ($params['itemQuantity'] ?? 1),
            'item_weight' => (float) ($params['itemWeight'] ?? 1.0),
            'amount_to_collect' => max(0, (int) round((float) ($params['amountToCollect'] ?? 0))),
        ];

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
