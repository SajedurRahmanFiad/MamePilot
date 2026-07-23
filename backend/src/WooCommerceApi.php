<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class WooCommerceApi extends BaseService
{
    private const SYSTEM_USER_ID = 'woocommerce-system';
    private const SYSTEM_USER_PHONE = '__woocommerce__';
    private const DEFAULT_SYNC_LIMIT = 250;

    private OperationsApi $operations;
    private OrderPostCreateEffects $postCreateEffects;
    /** @var array<string, array<string, mixed>>|null */
    private ?array $customersByNormalizedPhone = null;

    public function __construct(
        Database $database,
        Auth $auth,
        Config $config,
        OperationsApi $operations,
        ?OrderPostCreateEffects $postCreateEffects = null
    )
    {
        parent::__construct($database, $auth, $config);
        $this->operations = $operations;
        $this->postCreateEffects = $postCreateEffects
            ?? new OrderPostCreateEffects(
                new FeatureAccess($database, $auth),
                new AutoCallApi($database, $auth, $config)
            );
    }

    public function fetchWooCommerceStores(array $params = []): array
    {
        $this->requireAdmin();
        $this->assertSchema();

        $rows = $this->database->fetchAll('SELECT * FROM woocommerce_stores ORDER BY created_at ASC, store_name ASC');
        return array_map(fn(array $row): array => $this->mapStore($row), $rows);
    }

    public function saveWooCommerceStore(array $params): array
    {
        $this->requireAdmin();
        $this->assertSchema();

        $id = trim((string) ($params['id'] ?? '')) ?: $this->uuid4();
        $existing = $this->database->fetchOne('SELECT * FROM woocommerce_stores WHERE id = :id LIMIT 1', [':id' => $id]);
        $storeName = trim((string) ($params['storeName'] ?? $params['store_name'] ?? ($existing['store_name'] ?? '')));
        $storeUrl = $this->normalizeStoreUrl((string) ($params['storeUrl'] ?? $params['store_url'] ?? ($existing['store_url'] ?? '')));
        $consumerKey = trim((string) ($params['consumerKey'] ?? $params['consumer_key'] ?? ($existing['consumer_key'] ?? '')));
        $consumerSecret = trim((string) ($params['consumerSecret'] ?? $params['consumer_secret'] ?? ($existing['consumer_secret'] ?? '')));
        $webhookSecret = trim((string) ($params['webhookSecret'] ?? $params['webhook_secret'] ?? ($existing['webhook_secret'] ?? '')));
        $webhookBaseUrl = $this->normalizeWebhookBaseUrl((string) ($params['webhookBaseUrl'] ?? $params['webhook_base_url'] ?? ($existing['webhook_base_url'] ?? '')));
        $companyPageId = trim((string) ($params['companyPageId'] ?? $params['company_page_id'] ?? ($existing['company_page_id'] ?? '')));
        $enabled = array_key_exists('enabled', $params) ? !empty($params['enabled']) : (bool) ($existing['enabled'] ?? true);

        if ($storeName === '') {
            throw new RuntimeException('Store name is required.');
        }
        if ($storeUrl === '') {
            throw new RuntimeException('A valid WooCommerce website URL is required.');
        }
        if ($consumerKey === '' || $consumerSecret === '') {
            throw new RuntimeException('WooCommerce consumer key and consumer secret are required.');
        }
        if ($companyPageId === '' || !$this->companyPageExists($companyPageId)) {
            throw new RuntimeException('Select a valid company for this WooCommerce website.');
        }
        if ($webhookSecret === '') {
            $webhookSecret = bin2hex(random_bytes(32));
        }
        if (
            trim((string) ($params['webhookBaseUrl'] ?? $params['webhook_base_url'] ?? '')) !== ''
            && $webhookBaseUrl === ''
        ) {
            throw new RuntimeException('Enter a valid public delivery base URL for WooCommerce.');
        }

        $now = $this->database->nowUtc();
        if ($existing !== null) {
            $this->database->execute(
                'UPDATE woocommerce_stores
                 SET store_name = :store_name, store_url = :store_url, consumer_key = :consumer_key,
                     consumer_secret = :consumer_secret, webhook_secret = :webhook_secret, webhook_base_url = :webhook_base_url,
                     company_page_id = :company_page_id, enabled = :enabled, updated_at = :updated_at
                 WHERE id = :id',
                [
                    ':store_name' => $storeName, ':store_url' => $storeUrl, ':consumer_key' => $consumerKey,
                    ':consumer_secret' => $consumerSecret, ':webhook_secret' => $webhookSecret,
                    ':webhook_base_url' => $webhookBaseUrl !== '' ? $webhookBaseUrl : null,
                    ':company_page_id' => $companyPageId, ':enabled' => $enabled ? 1 : 0,
                    ':updated_at' => $now, ':id' => $id,
                ]
            );
        } else {
            $this->database->execute(
                'INSERT INTO woocommerce_stores
                    (id, store_name, store_url, consumer_key, consumer_secret, webhook_secret, webhook_base_url, company_page_id, enabled, created_at, updated_at)
                 VALUES
                    (:id, :store_name, :store_url, :consumer_key, :consumer_secret, :webhook_secret, :webhook_base_url, :company_page_id, :enabled, :created_at, :updated_at)',
                [
                    ':id' => $id, ':store_name' => $storeName, ':store_url' => $storeUrl,
                    ':consumer_key' => $consumerKey, ':consumer_secret' => $consumerSecret,
                    ':webhook_secret' => $webhookSecret, ':company_page_id' => $companyPageId,
                    ':webhook_base_url' => $webhookBaseUrl !== '' ? $webhookBaseUrl : null,
                    ':enabled' => $enabled ? 1 : 0, ':created_at' => $now, ':updated_at' => $now,
                ]
            );
        }

        return $this->fetchStoreForResponse($id);
    }

    public function deleteWooCommerceStore(array $params): array
    {
        $this->requireAdmin();
        $this->assertSchema();
        $store = $this->requireStore((string) ($params['id'] ?? $params['storeId'] ?? ''));
        $warning = null;

        if ((int) ($store['webhook_id'] ?? 0) > 0 && $this->hasCredentials($store)) {
            try {
                $this->storeRequest($store, 'DELETE', '/wp-json/wc/v3/webhooks/' . (int) $store['webhook_id'], ['force' => true]);
            } catch (\Throwable $exception) {
                $warning = 'The local connection was removed, but its WooCommerce webhook could not be deleted: ' . $exception->getMessage();
            }
        }

        $this->database->execute('DELETE FROM woocommerce_stores WHERE id = :id', [':id' => $store['id']]);
        return ['success' => true, 'warning' => $warning];
    }

    public function testWooCommerceStore(array $params): array
    {
        $this->requireAdmin();
        $store = $this->requireStore((string) ($params['id'] ?? $params['storeId'] ?? ''));
        $result = $this->storeRequest($store, 'GET', '/wp-json/wc/v3/orders', ['per_page' => 1]);
        return [
            'success' => true,
            'message' => 'Connected to ' . (string) $store['store_name'] . ' successfully.',
            'ordersVisible' => is_array($result['json']),
        ];
    }

    public function registerWooCommerceWebhook(array $params): array
    {
        $this->requireAdmin();
        $store = $this->requireStore((string) ($params['id'] ?? $params['storeId'] ?? ''));
        $deliveryUrl = $this->webhookUrl((string) $store['id'], (string) ($store['webhook_base_url'] ?? ''));
        $this->assertPublicWebhookUrl($deliveryUrl);
        $body = [
            'name' => 'MamePilot order sync',
            'topic' => 'order.created',
            'delivery_url' => $deliveryUrl,
            'secret' => (string) $store['webhook_secret'],
            'status' => 'active',
        ];

        $remoteWebhooks = $this->fetchRemoteWebhooks($store);
        $webhookId = $this->resolveRemoteWebhookId($store, $remoteWebhooks, $deliveryUrl);
        $path = '/wp-json/wc/v3/webhooks' . ($webhookId > 0 ? '/' . $webhookId : '');
        try {
            $result = $this->storeRequest($store, $webhookId > 0 ? 'PUT' : 'POST', $path, [], $body);
        } catch (RuntimeException $exception) {
            if ($webhookId <= 0 || !str_contains(strtolower($exception->getMessage()), 'not found')) {
                throw $exception;
            }
            $result = $this->storeRequest($store, 'POST', '/wp-json/wc/v3/webhooks', [], $body);
        }

        $createdId = (int) (($result['json']['id'] ?? null) ?: 0);
        if ($createdId <= 0) {
            throw new RuntimeException('WooCommerce did not return the registered webhook id.');
        }

        $this->removeDuplicateRemoteWebhooks($store, $remoteWebhooks, $createdId);

        $this->database->execute(
            'UPDATE woocommerce_stores SET webhook_id = :webhook_id, last_sync_status = :status, last_sync_message = :message, updated_at = :updated_at WHERE id = :id',
            [
                ':webhook_id' => $createdId, ':status' => 'ready',
                ':message' => 'Order-created webhook registered successfully.',
                ':updated_at' => $this->database->nowUtc(), ':id' => $store['id'],
            ]
        );

        return $this->fetchStoreForResponse((string) $store['id']);
    }

    public function syncWooCommerceOrders(array $params): array
    {
        $this->requireAdmin();
        $store = $this->requireStore((string) ($params['id'] ?? $params['storeId'] ?? ''));
        if (empty($store['enabled'])) {
            throw new RuntimeException('Enable this WooCommerce connection before syncing orders.');
        }

        $maxOrders = max(1, min(1000, (int) ($params['maxOrders'] ?? self::DEFAULT_SYNC_LIMIT)));
        return $this->syncStoreOrders($store, $maxOrders);
    }

    /**
     * Background sync: pull recent orders from all enabled WooCommerce stores.
     * Does not require admin auth — intended for CLI / background endpoint use.
     */
    public function syncAllStoresBackground(array $params = []): array
    {
        $this->assertSchema();
        $stores = $this->database->fetchAll('SELECT * FROM woocommerce_stores WHERE enabled = 1');
        if ($stores === []) {
            return ['success' => true, 'message' => 'No enabled WooCommerce stores.', 'stores' => 0, 'results' => []];
        }

        $maxOrders = max(1, min(100, (int) ($params['maxOrders'] ?? 50)));
        $results = [];
        $totalImported = 0;
        $totalFailed = 0;

        foreach ($stores as $store) {
            try {
                $result = $this->syncStoreOrders($store, $maxOrders);
                $results[] = ['storeId' => (string) $store['id'], 'storeName' => (string) $store['store_name'], ...$result];
                $totalImported += (int) ($result['imported'] ?? 0);
                $totalFailed += (int) ($result['failed'] ?? 0);
            } catch (\Throwable $exception) {
                $results[] = [
                    'storeId' => (string) $store['id'],
                    'storeName' => (string) $store['store_name'],
                    'success' => false,
                    'message' => $exception->getMessage(),
                    'imported' => 0, 'skipped' => 0, 'failed' => 0,
                ];
                $totalFailed++;
                error_log('WooCommerce background sync failed for store ' . (string) $store['store_name'] . ': ' . $exception->getMessage());
            }
        }

        $message = sprintf('Background sync complete: %d store(s), %d new order(s), %d failure(s).', count($stores), $totalImported, $totalFailed);
        return [
            'success' => $totalFailed === 0,
            'message' => $message,
            'stores' => count($stores),
            'imported' => $totalImported,
            'failed' => $totalFailed,
            'results' => $results,
        ];
    }

    /**
     * Shared order-sync logic used by both manual and background sync.
     * Fetches recent orders for a single store and imports them.
     */
    private function syncStoreOrders(array $store, int $maxOrders): array
    {
        if (empty($store['enabled'])) {
            return ['success' => true, 'message' => 'Store is disabled.', 'processed' => 0, 'imported' => 0, 'skipped' => 0, 'failed' => 0, 'errors' => []];
        }

        $page = 1;
        $processed = 0;
        $imported = 0;
        $skipped = 0;
        $failed = 0;
        $errors = [];

        while ($processed < $maxOrders) {
            $perPage = min(100, $maxOrders - $processed);
            $response = $this->storeRequest($store, 'GET', '/wp-json/wc/v3/orders', [
                'per_page' => $perPage, 'page' => $page, 'orderby' => 'date', 'order' => 'desc',
            ]);
            $orders = is_array($response['json']) ? $response['json'] : [];
            if ($orders === []) {
                break;
            }

            foreach ($orders as $order) {
                if (!is_array($order)) {
                    continue;
                }
                $processed++;
                try {
                    $result = $this->importOrder($store, $order);
                    if (!empty($result['skipped'])) {
                        $skipped++;
                    } else {
                        $imported++;
                    }
                } catch (\Throwable $exception) {
                    $failed++;
                    $errors[] = 'Order ' . ((string) ($order['number'] ?? $order['id'] ?? '?')) . ': ' . $exception->getMessage();
                    $this->recordImportFailure($store, $order, $exception->getMessage());
                }
            }

            if (count($orders) < $perPage) {
                break;
            }
            $page++;
        }

        $message = sprintf('Sync finished: %d imported, %d already present, %d failed.', $imported, $skipped, $failed);
        $this->updateStoreSyncState((string) $store['id'], $failed > 0 ? 'warning' : 'success', $message);
        return [
            'success' => $failed === 0, 'message' => $message, 'processed' => $processed,
            'imported' => $imported, 'skipped' => $skipped, 'failed' => $failed,
            'errors' => array_slice($errors, 0, 20),
        ];
    }

    public function handleWebhook(string $storeId, string $rawBody, ?string $signature, ?string $topic = null): array
    {
        $this->assertSchema();
        $store = $this->requireStore($storeId);
        if (empty($store['enabled'])) {
            throw new ApiException('This WooCommerce connection is disabled.', 403, 'WOOCOMMERCE_STORE_DISABLED');
        }
        $featureAccess = new FeatureAccess($this->database, $this->auth);
        if (empty($featureAccess->fetchCapabilities()['woocommerce'])) {
            throw new ApiException('WooCommerce integration is not enabled for this installation.', 403, 'FEATURE_LOCKED');
        }
        $this->serviceLifecycle()->assertActionAllowed('syncWooCommerceOrders');

        $expected = base64_encode(hash_hmac('sha256', $rawBody, (string) $store['webhook_secret'], true));
        if ($signature === null || trim($signature) === '' || !hash_equals($expected, trim($signature))) {
            throw new ApiException('Invalid WooCommerce webhook signature.', 401, 'INVALID_WEBHOOK_SIGNATURE');
        }
        if ($topic !== null && trim($topic) !== '' && trim($topic) !== 'order.created') {
            return ['success' => true, 'ignored' => true, 'message' => 'Webhook topic ignored.'];
        }

        $order = json_decode($rawBody, true);
        if (!is_array($order) || (int) ($order['id'] ?? 0) <= 0) {
            throw new ApiException('Invalid WooCommerce order payload.', 422, 'INVALID_WEBHOOK_PAYLOAD');
        }

        try {
            $result = $this->importOrder($store, $order);
            $message = !empty($result['skipped'])
                ? 'WooCommerce order was already imported.'
                : 'WooCommerce order imported successfully.';
            $this->updateStoreSyncState((string) $store['id'], 'success', $message);
            return ['success' => true, ...$result, 'message' => $message];
        } catch (\Throwable $exception) {
            $this->recordImportFailure($store, $order, $exception->getMessage());
            $this->updateStoreSyncState((string) $store['id'], 'error', $exception->getMessage());
            throw $exception;
        }
    }

    private function importOrder(array $store, array $wcOrder): array
    {
        $wcOrderId = (int) ($wcOrder['id'] ?? 0);
        if ($wcOrderId <= 0) {
            throw new RuntimeException('WooCommerce order id is missing.');
        }
        $existingLink = $this->database->fetchOne(
            'SELECT order_id, status FROM woocommerce_order_links WHERE store_id = :store_id AND wc_order_id = :wc_order_id LIMIT 1',
            [':store_id' => $store['id'], ':wc_order_id' => $wcOrderId]
        );
        if ($existingLink !== null && (string) ($existingLink['status'] ?? '') === 'imported' && trim((string) ($existingLink['order_id'] ?? '')) !== '') {
            return ['skipped' => true, 'orderId' => (string) $existingLink['order_id'], 'wcOrderId' => $wcOrderId];
        }

        $customerLockName = $this->acquireCustomerLock($wcOrder);
        try {
            $result = $this->database->transaction(function () use ($store, $wcOrder, $wcOrderId): array {
                $lockedLink = $this->database->fetchOne(
                'SELECT order_id, status FROM woocommerce_order_links WHERE store_id = :store_id AND wc_order_id = :wc_order_id LIMIT 1 FOR UPDATE',
                [':store_id' => $store['id'], ':wc_order_id' => $wcOrderId]
            );
            if ($lockedLink !== null && (string) ($lockedLink['status'] ?? '') === 'imported' && trim((string) ($lockedLink['order_id'] ?? '')) !== '') {
                return ['skipped' => true, 'orderId' => (string) $lockedLink['order_id'], 'wcOrderId' => $wcOrderId];
            }

            $systemUser = $this->ensureSystemUser();
            $customer = $this->upsertCustomer($wcOrder, (string) $systemUser['id']);
            $items = $this->mapOrderItems($store, $wcOrder, (string) $systemUser['id']);
            if ($items === []) {
                throw new RuntimeException('WooCommerce order does not contain any valid product line items.');
            }

            $subtotal = round(array_reduce($items, static fn(float $sum, array $item): float => $sum + (float) $item['amount'], 0.0), 2);
            $total = max(0.0, round((float) ($wcOrder['total'] ?? 0), 2));
            $discount = min($subtotal, max(0.0, round((float) ($wcOrder['discount_total'] ?? 0), 2)));
            $shipping = round($total - $subtotal + $discount, 2);
            if ($shipping < 0) {
                $shipping = 0.0;
                $discount = min($subtotal, max(0.0, round($subtotal - $total, 2)));
            }
            $expectedTotal = round($subtotal - $discount + $shipping, 2);
            if (abs($expectedTotal - $total) > 0.01) {
                $shipping = max(0.0, round($total - $subtotal + $discount, 2));
                $total = round($subtotal - $discount + $shipping, 2);
            }

            $createdAt = trim((string) ($wcOrder['date_created_gmt'] ?? $wcOrder['date_created'] ?? ''));
            $createdTimestamp = $createdAt !== '' ? strtotime($createdAt) : false;
            $orderDate = $createdTimestamp !== false ? gmdate('Y-m-d', $createdTimestamp) : gmdate('Y-m-d');
            $wcNumber = trim((string) ($wcOrder['number'] ?? $wcOrderId));
            $wcStatus = trim((string) ($wcOrder['status'] ?? 'unknown'));
            $customerNote = trim(strip_tags((string) ($wcOrder['customer_note'] ?? '')));
            $notes = 'WooCommerce order #' . $wcNumber . ' from ' . (string) $store['store_name'] . '. WooCommerce status: ' . $wcStatus . '.';
            if ($customerNote !== '') {
                $notes .= "\nCustomer note: " . $customerNote;
            }
            $paidAt = trim((string) ($wcOrder['date_paid_gmt'] ?? $wcOrder['date_paid'] ?? ''));
            $totalRefunded = max(0.0, (float) ($wcOrder['total_refunded'] ?? 0));
            $paidAmount = $paidAt !== '' ? max(0.0, min($total, round($total - $totalRefunded, 2))) : 0.0;
            $historyTime = $createdTimestamp !== false ? gmdate('c', $createdTimestamp) : gmdate('c');

            $order = $this->withSystemUser($systemUser, fn(): array => $this->operations->createOrder([
                'customerId' => $customer['id'],
                'pageId' => (string) $store['company_page_id'],
                'orderDate' => $orderDate,
                'status' => 'On Hold',
                'items' => $items,
                'subtotal' => $subtotal,
                'discount' => $discount,
                'shipping' => $shipping,
                'total' => $total,
                'paidAmount' => $paidAmount,
                'notes' => $notes,
                'sourceAd' => 'WooCommerce',
                'history' => ['created' => 'Imported from WooCommerce by WooCommerce on ' . $historyTime . '.'],
            ]));

            $now = $this->database->nowUtc();
            $bindings = [
                ':id' => $this->uuid4(), ':store_id' => $store['id'], ':wc_order_id' => $wcOrderId,
                ':wc_order_number' => $wcNumber, ':order_id' => $order['id'], ':status' => 'imported',
                ':message' => 'Imported successfully.', ':payload_hash' => $this->payloadHash($wcOrder),
                ':created_at' => $now, ':updated_at' => $now,
            ];
            $this->database->execute(
                'INSERT INTO woocommerce_order_links
                    (id, store_id, wc_order_id, wc_order_number, order_id, status, message, payload_hash, created_at, updated_at)
                 VALUES
                    (:id, :store_id, :wc_order_id, :wc_order_number, :order_id, :status, :message, :payload_hash, :created_at, :updated_at)
                 ON DUPLICATE KEY UPDATE wc_order_number = VALUES(wc_order_number), order_id = VALUES(order_id),
                    status = VALUES(status), message = VALUES(message), payload_hash = VALUES(payload_hash), updated_at = VALUES(updated_at)',
                $bindings
            );
            $this->database->execute(
                'UPDATE woocommerce_stores SET orders_synced = orders_synced + 1, last_synced_at = :last_synced_at, updated_at = :updated_at WHERE id = :id',
                [':last_synced_at' => $now, ':updated_at' => $now, ':id' => $store['id']]
            );

                return [
                    'skipped' => false,
                    'orderId' => (string) $order['id'],
                    'wcOrderId' => $wcOrderId,
                    'order' => $order,
                ];
            });
        } catch (\Throwable $exception) {
            // Customer cache entries written during a rolled-back import must
            // never be reused by the next order in a bulk synchronization.
            $this->customersByNormalizedPhone = null;
            throw $exception;
        } finally {
            $this->releaseCustomerLock($customerLockName);
        }

        if (empty($result['skipped']) && is_array($result['order'] ?? null)) {
            $this->postCreateEffects->schedule($result['order']);
        }
        unset($result['order']);
        return $result;
    }

    private function upsertCustomer(array $wcOrder, string $systemUserId): array
    {
        $billing = is_array($wcOrder['billing'] ?? null) ? $wcOrder['billing'] : [];
        $shipping = is_array($wcOrder['shipping'] ?? null) ? $wcOrder['shipping'] : [];
        $phone = trim((string) ($billing['phone'] ?? ''));
        $phoneKey = $this->normalizePhone($phone);
        if ($phoneKey === '') {
            throw new RuntimeException('Customer phone number is missing in the WooCommerce billing address.');
        }

        $name = trim(implode(' ', array_filter([
            trim((string) ($billing['first_name'] ?? $shipping['first_name'] ?? '')),
            trim((string) ($billing['last_name'] ?? $shipping['last_name'] ?? '')),
        ])));
        if ($name === '') {
            $name = trim((string) ($billing['company'] ?? $shipping['company'] ?? '')) ?: 'WooCommerce Customer';
        }
        $addressSource = array_filter($shipping, static fn($value): bool => trim((string) $value) !== '') !== [] ? $shipping : $billing;
        $address = $this->formatAddress($addressSource);

        if ($this->customersByNormalizedPhone === null) {
            $this->customersByNormalizedPhone = [];
            foreach ($this->database->fetchAll('SELECT id, name, phone, address FROM customers WHERE deleted_at IS NULL ORDER BY created_at ASC') as $row) {
                $normalized = $this->normalizePhone((string) ($row['phone'] ?? ''));
                if ($normalized !== '' && !isset($this->customersByNormalizedPhone[$normalized])) {
                    $this->customersByNormalizedPhone[$normalized] = $row;
                }
            }
        }
        $existing = $this->customersByNormalizedPhone[$phoneKey] ?? null;
        $now = $this->database->nowUtc();
        if ($existing !== null) {
            $this->database->execute(
                'UPDATE customers SET name = :name, address = :address, updated_at = :updated_at WHERE id = :id',
                [':name' => $name, ':address' => $address, ':updated_at' => $now, ':id' => $existing['id']]
            );
            $customer = ['id' => (string) $existing['id'], 'name' => $name, 'phone' => (string) $existing['phone'], 'address' => $address];
            $this->customersByNormalizedPhone[$phoneKey] = $customer;
            return $customer;
        }

        $id = $this->uuid4();
        $this->database->execute(
            'INSERT INTO customers (id, name, phone, address, total_orders, due_amount, created_by, created_at, updated_at)
             VALUES (:id, :name, :phone, :address, 0, 0, :created_by, :created_at, :updated_at)',
            [
                ':id' => $id, ':name' => $name, ':phone' => $phone, ':address' => $address,
                ':created_by' => $systemUserId, ':created_at' => $now, ':updated_at' => $now,
            ]
        );
        $customer = ['id' => $id, 'name' => $name, 'phone' => $phone, 'address' => $address];
        $this->customersByNormalizedPhone[$phoneKey] = $customer;
        return $customer;
    }

    private function mapOrderItems(array $store, array $wcOrder, string $systemUserId): array
    {
        $result = [];
        $lineItems = is_array($wcOrder['line_items'] ?? null) ? $wcOrder['line_items'] : [];
        foreach ($lineItems as $line) {
            if (!is_array($line)) {
                continue;
            }
            $quantity = max(0, (int) ($line['quantity'] ?? 0));
            if ($quantity <= 0) {
                continue;
            }
            $product = $this->resolveProduct($store, $line, $systemUserId, $quantity);
            $lineSubtotal = max(0.0, (float) ($line['subtotal'] ?? $line['total'] ?? 0));
            $rate = round($lineSubtotal / $quantity, 2);
            $amount = round($rate * $quantity, 2);
            $result[] = [
                'productId' => (string) $product['id'],
                'productName' => trim((string) ($line['name'] ?? $product['name'] ?? 'WooCommerce Product')) ?: 'WooCommerce Product',
                'rate' => $rate, 'quantity' => $quantity, 'amount' => $amount,
            ];
        }
        return $result;
    }

    private function fetchWcProduct(array $store, int $wcProductId): ?array
    {
        if ($wcProductId <= 0) {
            return null;
        }
        try {
            $response = $this->storeRequest($store, 'GET', '/wp-json/wc/v3/products/' . $wcProductId);
            $product = $response['json'] ?? null;
            return is_array($product) ? $product : null;
        } catch (\Throwable $exception) {
            error_log('WooCommerce: Could not fetch product #' . $wcProductId . ': ' . $exception->getMessage());
            return null;
        }
    }

    private function downloadAndSaveImage(string $imageUrl, string $category = 'product-images'): ?string
    {
        $url = trim($imageUrl);
        if ($url === '') {
            return null;
        }

        $ch = curl_init($url);
        if ($ch === false) {
            return null;
        }
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_TIMEOUT => 30,
            CURLOPT_CONNECTTIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
        ]);
        $data = curl_exec($ch);
        $contentType = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_close($ch);

        if ($data === false || strlen($data) === 0) {
            return null;
        }

        $uploadDir = $this->uploadPublicPath($category);
        if (!is_dir($uploadDir) && !mkdir($uploadDir, 0755, true) && !is_dir($uploadDir)) {
            return null;
        }

        $mimeType = strtolower(trim(explode(';', $contentType)[0] ?? ''));
        $extension = $this->extensionFromMimeType($mimeType, null);

        // Try WebP conversion for images
        if ($this->isImageMimeType($mimeType)) {
            $webpFileName = $this->uniqueUploadFilename('webp');
            $webpTargetPath = $uploadDir . DIRECTORY_SEPARATOR . $webpFileName;
            if ($this->saveImageAsWebp($data, $webpTargetPath)) {
                return '/uploads/' . trim($category, '/') . '/' . $webpFileName;
            }
        }

        $fileName = $this->uniqueUploadFilename($extension);
        $targetPath = $uploadDir . DIRECTORY_SEPARATOR . $fileName;
        if (file_put_contents($targetPath, $data) === false) {
            return null;
        }

        return '/uploads/' . trim($category, '/') . '/' . $fileName;
    }

    private function resolveCategoryFromWc(array $wcCategories, string $systemUserId): string
    {
        if (empty($wcCategories) || !is_array($wcCategories)) {
            return 'WooCommerce';
        }

        // Try to match the first WC category by name against local categories
        foreach ($wcCategories as $wcCat) {
            if (!is_array($wcCat)) {
                continue;
            }
            $catName = trim((string) ($wcCat['name'] ?? ''));
            if ($catName === '') {
                continue;
            }

            $existing = $this->database->fetchOne(
                'SELECT name FROM categories WHERE name = :name AND type = :type LIMIT 1',
                [':name' => $catName, ':type' => 'Product']
            );
            if ($existing !== null) {
                return (string) $existing['name'];
            }

            // Category doesn't exist locally — create it
            $catId = $this->uuid4();
            try {
                $this->database->execute(
                    'INSERT INTO categories (id, name, type, color, is_system, created_at, updated_at)
                     VALUES (:id, :name, :type, :color, 0, :created_at, :updated_at)',
                    [
                        ':id' => $catId, ':name' => $catName, ':type' => 'Product', ':color' => '#3B82F6',
                        ':created_at' => $this->database->nowUtc(), ':updated_at' => $this->database->nowUtc(),
                    ]
                );
                return $catName;
            } catch (\Throwable $exception) {
                // Likely a duplicate key race — just use the name
                error_log('WooCommerce: Could not create category "' . $catName . '": ' . $exception->getMessage());
                return $catName;
            }
        }

        return 'WooCommerce';
    }

    private function resolveProduct(array $store, array $line, string $systemUserId, int $orderedQuantity): array
    {
        $wcProductId = (int) ($line['product_id'] ?? 0);
        $wcVariationId = (int) ($line['variation_id'] ?? 0);
        if ($wcProductId <= 0) {
            $wcProductId = -max(1, (int) ($line['id'] ?? random_int(1, PHP_INT_MAX)));
        }

        // Step 1: Check for existing product link
        $link = $this->database->fetchOne(
            'SELECT p.id, p.name, p.stock, l.auto_created
             FROM woocommerce_product_links l
             JOIN products p ON p.id = l.product_id AND p.deleted_at IS NULL
             WHERE l.store_id = :store_id AND l.wc_product_id = :wc_product_id AND l.wc_variation_id = :wc_variation_id
             LIMIT 1',
            [':store_id' => $store['id'], ':wc_product_id' => $wcProductId, ':wc_variation_id' => $wcVariationId]
        );
        if ($link !== null) {
            if ((int) ($link['auto_created'] ?? 0) === 1) {
                $this->database->execute(
                    'UPDATE products SET stock = stock + :quantity, updated_at = :updated_at WHERE id = :id AND deleted_at IS NULL',
                    [':quantity' => $orderedQuantity, ':updated_at' => $this->database->nowUtc(), ':id' => $link['id']]
                );
                $link['stock'] = (int) ($link['stock'] ?? 0) + $orderedQuantity;
            }
            return $link;
        }

        // Step 2: Fetch full product data from WooCommerce API
        $wcProduct = $this->fetchWcProduct($store, $wcProductId);
        $name = trim((string) ($line['name'] ?? '')) ?: 'WooCommerce Product ' . abs($wcProductId);
        $slug = '';
        $imageUrl = null;
        $wcCategories = [];

        if ($wcProduct !== null) {
            $slug = trim((string) ($wcProduct['slug'] ?? ''));
            $wcImages = is_array($wcProduct['images'] ?? null) ? $wcProduct['images'] : [];
            if (!empty($wcImages[0]['src'])) {
                $imageUrl = (string) $wcImages[0]['src'];
            }
            $wcCategories = is_array($wcProduct['categories'] ?? null) ? $wcProduct['categories'] : [];
        }

        // Generate slug from name if not available from WC
        if ($slug === '') {
            $slug = strtolower(trim($name));
            $slug = preg_replace('/[^a-z0-9]+/', '-', $slug) ?? '';
            $slug = trim($slug, '-');
        }

        // Step 3: Match by slug
        $product = null;
        if ($slug !== '') {
            $product = $this->database->fetchOne(
                'SELECT id, name, stock FROM products WHERE deleted_at IS NULL AND slug = :slug ORDER BY created_at ASC LIMIT 1',
                [':slug' => $slug]
            );
        }

        // Step 4: If no slug match, fall back to name match
        if ($product === null) {
            $product = $this->database->fetchOne(
                'SELECT id, name, stock FROM products WHERE deleted_at IS NULL AND name = :name ORDER BY created_at ASC LIMIT 1',
                [':name' => $name]
            );
        }

        // Step 5: Create new product if no match found
        $autoCreated = false;
        if ($product === null) {
            $autoCreated = true;
            $productId = $this->uuid4();
            $now = $this->database->nowUtc();
            $salePrice = max(0.0, round((float) ($line['price'] ?? 0), 2));

            // Download and save product image
            $imagePath = null;
            if ($imageUrl !== null) {
                $imagePath = $this->downloadAndSaveImage($imageUrl);
            }

            // Resolve category from WooCommerce categories
            $category = $this->resolveCategoryFromWc($wcCategories, $systemUserId);

            $this->database->execute(
                'INSERT INTO products (id, name, slug, image, category, sale_price, purchase_price, stock, created_by, created_at, updated_at)
                 VALUES (:id, :name, :slug, :image, :category, :sale_price, 0, :stock, :created_by, :created_at, :updated_at)',
                [
                    ':id' => $productId, ':name' => $name, ':slug' => $slug !== '' ? $slug : null,
                    ':image' => $imagePath, ':category' => $category, ':sale_price' => $salePrice,
                    ':stock' => $orderedQuantity, ':created_by' => $systemUserId, ':created_at' => $now, ':updated_at' => $now,
                ]
            );
            $product = ['id' => $productId, 'name' => $name, 'stock' => $orderedQuantity];
        }

        $this->database->execute(
            'INSERT INTO woocommerce_product_links
                (id, store_id, wc_product_id, wc_variation_id, sku, product_id, auto_created, created_at, updated_at)
             VALUES
                (:id, :store_id, :wc_product_id, :wc_variation_id, :sku, :product_id, :auto_created, :created_at, :updated_at)',
            [
                ':id' => $this->uuid4(), ':store_id' => $store['id'], ':wc_product_id' => $wcProductId,
                ':wc_variation_id' => $wcVariationId, ':sku' => $this->nullableString($line['sku'] ?? null),
                ':product_id' => $product['id'], ':auto_created' => $autoCreated ? 1 : 0,
                ':created_at' => $this->database->nowUtc(), ':updated_at' => $this->database->nowUtc(),
            ]
        );
        return $product;
    }

    private function ensureSystemUser(): array
    {
        $existing = $this->database->fetchOne('SELECT * FROM users WHERE id = :id LIMIT 1', [':id' => self::SYSTEM_USER_ID]);
        if ($existing !== null) {
            if ((string) ($existing['name'] ?? '') !== 'WooCommerce' || (int) ($existing['is_system'] ?? 0) !== 1) {
                $this->database->execute(
                    'UPDATE users SET name = :name, role = :role, is_system = 1, deleted_at = NULL, deleted_by = NULL, updated_at = :updated_at WHERE id = :id',
                    [':name' => 'WooCommerce', ':role' => 'Admin', ':updated_at' => $this->database->nowUtc(), ':id' => self::SYSTEM_USER_ID]
                );
            }
            return $this->database->fetchOne('SELECT * FROM users WHERE id = :id LIMIT 1', [':id' => self::SYSTEM_USER_ID]) ?? $existing;
        }

        $now = $this->database->nowUtc();
        $this->database->execute(
            'INSERT INTO users (id, name, phone, role, is_system, password_hash, created_at, updated_at)
             VALUES (:id, :name, :phone, :role, 1, :password_hash, :created_at, :updated_at)',
            [
                ':id' => self::SYSTEM_USER_ID, ':name' => 'WooCommerce', ':phone' => self::SYSTEM_USER_PHONE,
                ':role' => 'Admin', ':password_hash' => password_hash(bin2hex(random_bytes(32)), PASSWORD_BCRYPT),
                ':created_at' => $now, ':updated_at' => $now,
            ]
        );
        return $this->database->fetchOne('SELECT * FROM users WHERE id = :id LIMIT 1', [':id' => self::SYSTEM_USER_ID])
            ?? throw new RuntimeException('Could not create the WooCommerce system user.');
    }

    private function withSystemUser(array $systemUser, callable $callback)
    {
        $previousAuthorization = $_SERVER['HTTP_AUTHORIZATION'] ?? null;
        $previousAuthorizationAlt = $_SERVER['Authorization'] ?? null;
        $authorization = 'Bearer ' . $this->auth->issueToken($systemUser);
        $_SERVER['HTTP_AUTHORIZATION'] = $authorization;
        $_SERVER['Authorization'] = $authorization;
        try {
            return $callback();
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

    private function storeRequest(array $store, string $method, string $path, array $query = [], ?array $jsonBody = null): array
    {
        if (!$this->hasCredentials($store)) {
            throw new RuntimeException('WooCommerce API credentials are incomplete.');
        }
        $url = rtrim((string) $store['store_url'], '/') . '/' . ltrim($path, '/');
        if ($query !== []) {
            $url .= '?' . http_build_query($query);
        }
        $requestBody = $jsonBody === null ? null : json_encode($jsonBody, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $headers = [
            'Authorization: Basic ' . base64_encode((string) $store['consumer_key'] . ':' . (string) $store['consumer_secret']),
            'Accept: application/json',
        ];
        if ($requestBody !== null) {
            $headers[] = 'Content-Type: application/json';
        }

        if (function_exists('curl_init')) {
            $handle = curl_init($url);
            if ($handle === false) {
                throw new RuntimeException('Could not initialize the WooCommerce request.');
            }
            curl_setopt_array($handle, [
                CURLOPT_CUSTOMREQUEST => strtoupper($method), CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 45, CURLOPT_CONNECTTIMEOUT => 15,
                CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3,
                CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            ]);
            if ($requestBody !== null) {
                curl_setopt($handle, CURLOPT_POSTFIELDS, $requestBody);
            }
            $body = curl_exec($handle);
            if ($body === false) {
                $error = curl_error($handle) ?: 'Connection failed.';
                curl_close($handle);
                error_log('WooCommerce transport error for ' . (string) ($store['store_url'] ?? '') . ': ' . $error);
                throw new ApiException(
                    'MamePilot could not connect to the WooCommerce website. Check the website URL and the app server outbound HTTPS connection.',
                    502,
                    'WOOCOMMERCE_CONNECTION_FAILED'
                );
            }
            $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            curl_close($handle);
        } else {
            $context = stream_context_create(['http' => [
                'method' => strtoupper($method), 'header' => implode("\r\n", $headers),
                'content' => $requestBody ?? '', 'timeout' => 45, 'ignore_errors' => true,
            ]]);
            $body = file_get_contents($url, false, $context);
            if ($body === false) {
                throw new ApiException(
                    'MamePilot could not connect to the WooCommerce website. Check the website URL and the app server outbound HTTPS connection.',
                    502,
                    'WOOCOMMERCE_CONNECTION_FAILED'
                );
            }
            $status = 200;
            foreach (($http_response_header ?? []) as $headerLine) {
                if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $headerLine, $matches) === 1) {
                    $status = (int) $matches[1];
                    break;
                }
            }
        }

        $decoded = json_decode((string) $body, true);
        if ($status < 200 || $status >= 300) {
            $message = is_array($decoded) ? trim((string) ($decoded['message'] ?? '')) : '';
            throw new ApiException(
                $message !== '' ? $message : 'WooCommerce rejected the request. Check the website and REST key permissions.',
                502,
                'WOOCOMMERCE_REQUEST_REJECTED',
                ['providerStatus' => $status]
            );
        }
        return ['status' => $status, 'body' => (string) $body, 'json' => $decoded];
    }

    private function requireStore(string $storeId): array
    {
        $this->assertSchema();
        $storeId = trim($storeId);
        if ($storeId === '') {
            throw new RuntimeException('WooCommerce store id is required.');
        }
        $store = $this->database->fetchOne('SELECT * FROM woocommerce_stores WHERE id = :id LIMIT 1', [':id' => $storeId]);
        if ($store === null) {
            throw new RuntimeException('WooCommerce connection not found.');
        }
        return $store;
    }

    private function fetchStoreForResponse(string $id): array
    {
        return $this->mapStore($this->requireStore($id));
    }

    private function mapStore(array $row): array
    {
        return [
            'id' => (string) $row['id'], 'storeName' => (string) ($row['store_name'] ?? ''),
            'storeUrl' => (string) ($row['store_url'] ?? ''),
            'consumerKey' => (string) ($row['consumer_key'] ?? ''),
            'consumerSecret' => (string) ($row['consumer_secret'] ?? ''),
            'webhookSecret' => (string) ($row['webhook_secret'] ?? ''),
            'webhookBaseUrl' => trim((string) ($row['webhook_base_url'] ?? '')) !== ''
                ? rtrim((string) $row['webhook_base_url'], '/')
                : $this->inferredWebhookBaseUrl(),
            'webhookId' => isset($row['webhook_id']) ? (int) $row['webhook_id'] : null,
            'webhookUrl' => $this->webhookUrl((string) $row['id'], (string) ($row['webhook_base_url'] ?? '')),
            'companyPageId' => (string) ($row['company_page_id'] ?? ''),
            'enabled' => !empty($row['enabled']), 'lastSyncedAt' => $this->toIso($row['last_synced_at'] ?? null),
            'lastSyncStatus' => $this->nullableString($row['last_sync_status'] ?? null),
            'lastSyncMessage' => $this->nullableString($row['last_sync_message'] ?? null),
            'ordersSynced' => (int) ($row['orders_synced'] ?? 0),
            'createdAt' => $this->toIso($row['created_at'] ?? null), 'updatedAt' => $this->toIso($row['updated_at'] ?? null),
        ];
    }

    private function webhookUrl(string $storeId, string $configuredBaseUrl = ''): string
    {
        $base = $this->normalizeWebhookBaseUrl($configuredBaseUrl);
        if ($base === '') {
            $base = $this->inferredWebhookBaseUrl();
        }
        return rtrim($base, '/') . '/woocommerce-webhook.php?store=' . rawurlencode($storeId);
    }

    private function inferredWebhookBaseUrl(): string
    {
        $frontendUrl = rtrim(trim((string) ($this->config->get('APP_FRONTEND_URL', '') ?? '')), '/');
        if ($frontendUrl !== '') {
            $path = trim((string) parse_url($frontendUrl, PHP_URL_PATH), '/');
            return preg_match('#(?:^|/)api$#i', $path) === 1 ? $frontendUrl : $frontendUrl . '/api';
        }

        $forwardedProto = trim((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
        $scheme = $forwardedProto !== '' ? explode(',', $forwardedProto)[0] : ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http');
        $forwardedHost = trim((string) ($_SERVER['HTTP_X_FORWARDED_HOST'] ?? ''));
        $host = $forwardedHost !== '' ? explode(',', $forwardedHost)[0] : trim((string) ($_SERVER['HTTP_HOST'] ?? 'localhost'));
        $scriptName = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php'));
        $directory = trim(str_replace('\\', '/', dirname($scriptName)), '/.');
        return $scheme . '://' . $host . ($directory !== '' ? '/' . $directory : '');
    }

    private function normalizeStoreUrl(string $value): string
    {
        $url = rtrim(trim($value), '/');
        if ($url === '' || filter_var($url, FILTER_VALIDATE_URL) === false) {
            return '';
        }
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        return in_array($scheme, ['http', 'https'], true) ? $url : '';
    }

    private function normalizeWebhookBaseUrl(string $value): string
    {
        $url = rtrim(trim($value), '/');
        if ($url === '' || filter_var($url, FILTER_VALIDATE_URL) === false) {
            return '';
        }
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        if (!in_array($scheme, ['http', 'https'], true)) {
            return '';
        }
        if (parse_url($url, PHP_URL_QUERY) !== null || parse_url($url, PHP_URL_FRAGMENT) !== null) {
            return '';
        }
        return $url;
    }

    private function assertPublicWebhookUrl(string $url): void
    {
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        $host = strtolower(trim((string) parse_url($url, PHP_URL_HOST)));
        $isLocalName = $host === 'localhost' || str_ends_with($host, '.localhost') || str_ends_with($host, '.local') || str_ends_with($host, '.test');
        $isPrivateIp = filter_var($host, FILTER_VALIDATE_IP) !== false
            && filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false;
        if ($scheme !== 'https' || $host === '' || $isLocalName || $isPrivateIp) {
            throw new ApiException(
                'Automatic WooCommerce delivery needs a public HTTPS MamePilot URL. Enter the production URL or an HTTPS tunnel in Public delivery base URL, save, and try again.',
                422,
                'WOOCOMMERCE_PUBLIC_WEBHOOK_URL_REQUIRED'
            );
        }
    }

    /** @return array<int, array<string, mixed>> */
    private function fetchRemoteWebhooks(array $store): array
    {
        try {
            $response = $this->storeRequest($store, 'GET', '/wp-json/wc/v3/webhooks', ['per_page' => 100, 'status' => 'all']);
        } catch (\Throwable $exception) {
            throw new ApiException(
                'MamePilot could not read existing registrations from WooCommerce. Check the website URL, REST key permissions, and outbound HTTPS access.',
                502,
                'WOOCOMMERCE_CONNECTION_FAILED'
            );
        }
        return is_array($response['json'] ?? null) ? array_values(array_filter($response['json'], 'is_array')) : [];
    }

    private function resolveRemoteWebhookId(array $store, array $webhooks, string $deliveryUrl): int
    {
        $savedId = (int) ($store['webhook_id'] ?? 0);
        foreach ($webhooks as $webhook) {
            if ((int) ($webhook['id'] ?? 0) === $savedId && $savedId > 0) {
                return $savedId;
            }
        }

        $matching = array_values(array_filter($webhooks, function (array $webhook) use ($store, $deliveryUrl): bool {
            return $this->remoteWebhookBelongsToStore($webhook, (string) $store['id'])
                || (
                    trim((string) ($webhook['topic'] ?? '')) === 'order.created'
                    && rtrim(trim((string) ($webhook['delivery_url'] ?? '')), '/') === rtrim($deliveryUrl, '/')
                );
        }));
        usort($matching, static fn(array $left, array $right): int => (int) ($right['id'] ?? 0) <=> (int) ($left['id'] ?? 0));
        return (int) ($matching[0]['id'] ?? 0);
    }

    private function removeDuplicateRemoteWebhooks(array $store, array $webhooks, int $keepId): void
    {
        foreach ($webhooks as $webhook) {
            $id = (int) ($webhook['id'] ?? 0);
            if ($id <= 0 || $id === $keepId || !$this->remoteWebhookBelongsToStore($webhook, (string) $store['id'])) {
                continue;
            }
            try {
                $this->storeRequest($store, 'DELETE', '/wp-json/wc/v3/webhooks/' . $id, ['force' => true]);
            } catch (\Throwable $exception) {
                error_log('Could not remove duplicate WooCommerce registration #' . $id . ': ' . $exception->getMessage());
            }
        }
    }

    private function remoteWebhookBelongsToStore(array $webhook, string $storeId): bool
    {
        if (trim((string) ($webhook['name'] ?? '')) !== 'MamePilot order sync') {
            return false;
        }
        $query = (string) parse_url((string) ($webhook['delivery_url'] ?? ''), PHP_URL_QUERY);
        parse_str($query, $params);
        return trim((string) ($params['store'] ?? '')) === $storeId;
    }

    private function normalizePhone(string $phone): string
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        if (str_starts_with($digits, '880') && strlen($digits) >= 13) {
            $digits = '0' . substr($digits, 3);
        } elseif (strlen($digits) === 10 && str_starts_with($digits, '1')) {
            $digits = '0' . $digits;
        }
        return strlen($digits) > 10 ? substr($digits, -10) : $digits;
    }

    private function acquireCustomerLock(array $wcOrder): ?string
    {
        $billing = is_array($wcOrder['billing'] ?? null) ? $wcOrder['billing'] : [];
        $phoneKey = $this->normalizePhone((string) ($billing['phone'] ?? ''));
        if ($phoneKey === '') {
            return null;
        }

        $lockName = 'mpwoo:' . sha1($phoneKey);
        $row = $this->database->fetchOne(
            'SELECT GET_LOCK(:lock_name, 10) AS acquired',
            [':lock_name' => $lockName]
        );
        if ((int) ($row['acquired'] ?? 0) !== 1) {
            throw new RuntimeException('Customer matching is busy for this phone number. WooCommerce can retry the order shortly.');
        }

        return $lockName;
    }

    private function releaseCustomerLock(?string $lockName): void
    {
        if ($lockName === null) {
            return;
        }
        try {
            $this->database->fetchOne(
                'SELECT RELEASE_LOCK(:lock_name) AS released',
                [':lock_name' => $lockName]
            );
        } catch (\Throwable $exception) {
            error_log('Could not release WooCommerce customer lock: ' . $exception->getMessage());
        }
    }

    private function formatAddress(array $address): string
    {
        $parts = [
            $address['company'] ?? null, $address['address_1'] ?? null, $address['address_2'] ?? null,
            $address['city'] ?? null, $address['state'] ?? null, $address['postcode'] ?? null, $address['country'] ?? null,
        ];
        return implode(', ', array_values(array_filter(array_map(
            static fn($value): string => trim(strip_tags((string) ($value ?? ''))),
            $parts
        ), static fn(string $value): bool => $value !== '')));
    }

    private function companyPageExists(string $pageId): bool
    {
        $row = $this->database->fetchOne('SELECT pages FROM company_settings LIMIT 1');
        $pages = $this->normalizeCompanyPages($row['pages'] ?? [], []);
        foreach ($pages as $page) {
            if ((string) ($page['id'] ?? '') === $pageId) {
                return true;
            }
        }
        return false;
    }

    private function updateStoreSyncState(string $storeId, string $status, string $message): void
    {
        $now = $this->database->nowUtc();
        $this->database->execute(
            'UPDATE woocommerce_stores SET last_synced_at = :last_synced_at, last_sync_status = :status,
                last_sync_message = :message, updated_at = :updated_at WHERE id = :id',
            [
                ':last_synced_at' => $now, ':status' => $status, ':message' => substr($message, 0, 1000),
                ':updated_at' => $now, ':id' => $storeId,
            ]
        );
    }

    private function recordImportFailure(array $store, array $order, string $message): void
    {
        $wcOrderId = (int) ($order['id'] ?? 0);
        if ($wcOrderId <= 0) {
            return;
        }
        $now = $this->database->nowUtc();
        $this->database->execute(
            'INSERT INTO woocommerce_order_links
                (id, store_id, wc_order_id, wc_order_number, order_id, status, message, payload_hash, created_at, updated_at)
             VALUES (:id, :store_id, :wc_order_id, :wc_order_number, NULL, :status, :message, :payload_hash, :created_at, :updated_at)
             ON DUPLICATE KEY UPDATE status = VALUES(status), message = VALUES(message), payload_hash = VALUES(payload_hash), updated_at = VALUES(updated_at)',
            [
                ':id' => $this->uuid4(), ':store_id' => $store['id'], ':wc_order_id' => $wcOrderId,
                ':wc_order_number' => trim((string) ($order['number'] ?? $wcOrderId)), ':status' => 'failed',
                ':message' => substr($message, 0, 1000), ':payload_hash' => $this->payloadHash($order),
                ':created_at' => $now, ':updated_at' => $now,
            ]
        );
    }

    private function payloadHash(array $payload): string
    {
        return hash('sha256', json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '');
    }

    private function hasCredentials(array $store): bool
    {
        return trim((string) ($store['consumer_key'] ?? '')) !== '' && trim((string) ($store['consumer_secret'] ?? '')) !== '';
    }

    private function assertSchema(): void
    {
        foreach (['woocommerce_stores', 'woocommerce_order_links', 'woocommerce_product_links'] as $table) {
            if (!$this->tableExists($table)) {
                throw new RuntimeException('WooCommerce database tables are missing. Run the latest database schema update first.');
            }
        }
        if (!$this->columnExists('users', 'is_system')) {
            throw new RuntimeException('WooCommerce database upgrade is incomplete. Run the latest database schema update first.');
        }
        if (!$this->columnExists('woocommerce_stores', 'webhook_base_url')) {
            throw new RuntimeException('WooCommerce database upgrade is incomplete. Run the latest database schema update first.');
        }
    }
}
