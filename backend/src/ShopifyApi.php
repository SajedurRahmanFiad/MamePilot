<?php

declare(strict_types=1);

namespace App;

use RuntimeException;
use Throwable;

/**
 * Shopify Admin GraphQL integration.
 *
 * Shopify's REST Admin API is legacy for new integrations. This service uses
 * GraphQL for connection tests, complete product/order pagination, and webhook
 * subscription management. HTTPS webhook payloads remain JSON and are verified
 * with the app client secret before any local write is attempted.
 */
final class ShopifyApi extends BaseService
{
    private const SYSTEM_USER_ID = 'shopify-system';
    private const SYSTEM_USER_PHONE = '__shopify__';
    private const API_VERSION = '2026-07';
    private const PAGE_SIZE = 100;

    /** @var array<string, string> */
    private const WEBHOOK_TOPICS = [
        'ORDERS_CREATE' => 'orders/create',
        'CUSTOMERS_CREATE' => 'customers/create',
        'CUSTOMERS_UPDATE' => 'customers/update',
    ];

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
    ) {
        parent::__construct($database, $auth, $config);
        $this->operations = $operations;
        $this->postCreateEffects = $postCreateEffects
            ?? new OrderPostCreateEffects(
                new FeatureAccess($database, $auth),
                new AutoCallApi($database, $auth, $config)
            );
    }

    public function fetchShopifyStores(array $params = []): array
    {
        $this->requireAdmin();
        try {
            $this->assertSchema();
        } catch (\RuntimeException) {
            // Shopify tables don't exist yet - return empty array for graceful degradation
            return [];
        }
        $rows = $this->database->fetchAll('SELECT * FROM shopify_stores ORDER BY created_at ASC, store_name ASC');
        return array_map(fn(array $row): array => $this->mapStore($row), $rows);
    }

    public function saveShopifyStore(array $params): array
    {
        $this->requireAdmin();
        $this->assertSchema();
        $id = trim((string) ($params['id'] ?? '')) ?: $this->uuid4();
        $existing = $this->database->fetchOne('SELECT * FROM shopify_stores WHERE id = :id LIMIT 1', [':id' => $id]);
        $storeName = trim((string) ($params['storeName'] ?? $params['store_name'] ?? ($existing['store_name'] ?? '')));
        $storeUrl = $this->normalizeStoreUrl((string) ($params['storeUrl'] ?? $params['store_url'] ?? ($existing['store_url'] ?? '')));
        $accessTokenInput = trim((string) ($params['accessToken'] ?? $params['access_token'] ?? ''));
        $apiSecretInput = trim((string) ($params['apiSecret'] ?? $params['api_secret'] ?? ''));
        $accessToken = $accessTokenInput !== '' ? $accessTokenInput : trim((string) ($existing['access_token'] ?? ''));
        $apiSecret = $apiSecretInput !== '' ? $apiSecretInput : trim((string) ($existing['api_secret'] ?? ($existing['webhook_secret'] ?? '')));
        $webhookBaseUrl = $this->normalizeWebhookBaseUrl((string) ($params['webhookBaseUrl'] ?? $params['webhook_base_url'] ?? ($existing['webhook_base_url'] ?? '')));
        $companyPageId = trim((string) ($params['companyPageId'] ?? $params['company_page_id'] ?? ($existing['company_page_id'] ?? '')));
        $enabled = array_key_exists('enabled', $params) ? !empty($params['enabled']) : (bool) ($existing['enabled'] ?? true);

        if ($storeName === '') throw new RuntimeException('Store name is required.');
        if ($storeUrl === '') throw new RuntimeException('Enter a valid Shopify hostname such as store.myshopify.com.');
        if ($accessToken === '') throw new RuntimeException('Shopify Admin API access token is required.');
        if ($apiSecret === '') throw new RuntimeException('Shopify app API secret key is required for webhook verification.');
        if ($companyPageId === '' || !$this->companyPageExists($companyPageId)) throw new RuntimeException('Select a valid company for this Shopify store.');
        if (trim((string) ($params['webhookBaseUrl'] ?? $params['webhook_base_url'] ?? '')) !== '' && $webhookBaseUrl === '') {
            throw new RuntimeException('Enter a valid public HTTPS delivery base URL.');
        }

        $duplicate = $this->database->fetchOne(
            'SELECT id FROM shopify_stores WHERE LOWER(store_url) = LOWER(:store_url) AND id <> :id LIMIT 1',
            [':store_url' => $storeUrl, ':id' => $id]
        );
        if ($duplicate !== null) throw new RuntimeException('This Shopify store is already connected.');

        $now = $this->database->nowUtc();
        if ($existing !== null) {
            $this->database->execute(
                'UPDATE shopify_stores SET store_name = :store_name, store_url = :store_url,
                    access_token = :access_token, api_secret = :api_secret,
                    webhook_base_url = :webhook_base_url, company_page_id = :company_page_id,
                    enabled = :enabled, updated_at = :updated_at WHERE id = :id',
                [
                    ':store_name' => $storeName, ':store_url' => $storeUrl, ':access_token' => $accessToken,
                    ':api_secret' => $apiSecret, ':webhook_base_url' => $webhookBaseUrl !== '' ? $webhookBaseUrl : null,
                    ':company_page_id' => $companyPageId, ':enabled' => $enabled ? 1 : 0,
                    ':updated_at' => $now, ':id' => $id,
                ]
            );
        } else {
            $this->database->execute(
                'INSERT INTO shopify_stores
                    (id, store_name, store_url, access_token, api_secret, webhook_base_url, company_page_id, enabled, created_at, updated_at)
                 VALUES (:id, :store_name, :store_url, :access_token, :api_secret, :webhook_base_url, :company_page_id, :enabled, :created_at, :updated_at)',
                [
                    ':id' => $id, ':store_name' => $storeName, ':store_url' => $storeUrl,
                    ':access_token' => $accessToken, ':api_secret' => $apiSecret,
                    ':webhook_base_url' => $webhookBaseUrl !== '' ? $webhookBaseUrl : null,
                    ':company_page_id' => $companyPageId, ':enabled' => $enabled ? 1 : 0,
                    ':created_at' => $now, ':updated_at' => $now,
                ]
            );
        }
        return $this->fetchStoreForResponse($id);
    }

    public function deleteShopifyStore(array $params): array
    {
        $this->requireAdmin();
        $this->assertSchema();
        $store = $this->requireStore((string) ($params['id'] ?? $params['storeId'] ?? ''));
        $warning = null;
        foreach ($this->database->fetchAll('SELECT remote_id FROM shopify_webhook_subscriptions WHERE store_id = :store_id', [':store_id' => $store['id']]) as $row) {
            try { $this->deleteRemoteWebhook($store, (string) ($row['remote_id'] ?? '')); }
            catch (Throwable $exception) { $warning = 'The local connection was removed, but Shopify webhook cleanup was incomplete: ' . $exception->getMessage(); }
        }
        $this->database->execute('DELETE FROM shopify_stores WHERE id = :id', [':id' => $store['id']]);
        return ['success' => true, 'warning' => $warning];
    }

    public function testShopifyStore(array $params): array
    {
        $this->requireAdmin();
        $store = $this->requireStore((string) ($params['id'] ?? $params['storeId'] ?? ''));
        $data = $this->graphQl($store, <<<'GRAPHQL'
query {
  shop { name myshopifyDomain }
  currentAppInstallation { accessScopes { handle } }
}
GRAPHQL);
        $shop = is_array($data['shop'] ?? null) ? $data['shop'] : [];
        $scopes = array_values(array_filter(array_map(
            static fn($row): string => is_array($row) ? trim((string) ($row['handle'] ?? '')) : '',
            is_array($data['currentAppInstallation']['accessScopes'] ?? null) ? $data['currentAppInstallation']['accessScopes'] : []
        )));
        $required = ['read_products', 'read_orders', 'read_customers'];
        $missing = array_values(array_diff($required, $scopes));
        $message = 'Connected to ' . ((string) ($shop['name'] ?? $store['store_name'])) . ' successfully.';
        if ($missing !== []) $message .= ' Missing Admin API scopes: ' . implode(', ', $missing) . '.';
        $health = $this->checkShopifyWebhookHealthInternal($store);
        return [
            'success' => $missing === [], 'message' => $message,
            'ordersVisible' => true, 'productsVisible' => true,
            'scopes' => $scopes, 'missingScopes' => $missing, 'webhookHealth' => $health,
        ];
    }

    public function checkShopifyWebhookHealth(array $params): array
    {
        $this->requireAdmin();
        return $this->checkShopifyWebhookHealthInternal($this->requireStore((string) ($params['id'] ?? $params['storeId'] ?? '')));
    }

    public function repairShopifyWebhook(array $params): array
    {
        $this->requireAdmin();
        $store = $this->requireStore((string) ($params['id'] ?? $params['storeId'] ?? ''));
        $this->removeStoredWebhooks($store);
        $result = $this->registerWebhooks($store, true);
        return ['success' => true, 'message' => 'Shopify order and customer webhooks were repaired.', 'subscriptions' => $result];
    }

    public function registerShopifyWebhook(array $params): array
    {
        $this->requireAdmin();
        $store = $this->requireStore((string) ($params['id'] ?? $params['storeId'] ?? ''));
        $this->registerWebhooks($store, false);
        $this->updateStoreSyncState((string) $store['id'], 'ready', 'Shopify order and customer webhooks are registered.');
        return $this->fetchStoreForResponse((string) $store['id']);
    }

    public function syncShopifyProducts(array $params): array
    {
        $this->requireAdmin();
        $store = $this->requireStore((string) ($params['id'] ?? $params['storeId'] ?? ''));
        if (empty($store['enabled'])) throw new RuntimeException('Enable this Shopify connection before importing products.');
        $created = $matched = $updated = $skipped = $failed = 0;
        $errors = [];
        $cursor = null;
        do {
            $data = $this->graphQl($store, <<<'GRAPHQL'
query ProductVariantsPage($first: Int!, $after: String) {
  productVariants(first: $first, after: $after) {
    nodes {
      id title sku price inventoryQuantity image { url }
      product { id title handle productType featuredMedia { preview { image { url } } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}
GRAPHQL, ['first' => self::PAGE_SIZE, 'after' => $cursor]);
            $connection = is_array($data['productVariants'] ?? null) ? $data['productVariants'] : [];
            $nodes = $this->connectionNodes($connection);
            foreach ($nodes as $variant) {
                try {
                    $result = $this->importProductVariant($store, $variant);
                    $created += (int) ($result['created'] ?? 0); $matched += (int) ($result['matched'] ?? 0);
                    $updated += (int) ($result['updated'] ?? 0); $skipped += (int) ($result['skipped'] ?? 0);
                } catch (Throwable $exception) {
                    $failed++; $errors[] = 'Variant ' . ((string) ($variant['id'] ?? '?')) . ': ' . $exception->getMessage();
                }
            }
            $pageInfo = is_array($connection['pageInfo'] ?? null) ? $connection['pageInfo'] : [];
            $cursor = !empty($pageInfo['hasNextPage']) ? (string) ($pageInfo['endCursor'] ?? '') : null;
            if ($cursor === '') $cursor = null;
        } while ($cursor !== null);

        $total = $created + $matched + $updated;
        $message = sprintf('Shopify product import finished: %d created, %d matched, %d updated, %d skipped, %d failed.', $created, $matched, $updated, $skipped, $failed);
        $this->database->execute(
            'UPDATE shopify_stores SET products_synced = :count, last_products_synced_at = :now, last_synced_at = :now, last_sync_status = :status, last_sync_message = :message, updated_at = :now WHERE id = :id',
            [':count' => $total, ':now' => $this->database->nowUtc(), ':status' => $failed > 0 ? 'warning' : 'success', ':message' => mb_substr($message, 0, 1000), ':id' => $store['id']]
        );
        return ['success' => $failed === 0, 'message' => $message, 'processed' => $total + $skipped + $failed, 'created' => $created, 'matched' => $matched, 'updated' => $updated, 'skipped' => $skipped, 'imported' => $total, 'failed' => $failed, 'errors' => array_slice($errors, 0, 20)];
    }

    public function syncShopifyOrders(array $params): array
    {
        $this->requireAdmin();
        $store = $this->requireStore((string) ($params['id'] ?? $params['storeId'] ?? ''));
        if (empty($store['enabled'])) throw new RuntimeException('Enable this Shopify connection before importing orders.');
        $maxOrders = array_key_exists('maxOrders', $params) && (int) $params['maxOrders'] > 0 ? min(100000, (int) $params['maxOrders']) : PHP_INT_MAX;
        $processed = $imported = $skipped = $failed = 0; $errors = []; $cursor = null;
        do {
            $data = $this->graphQl($store, <<<'GRAPHQL'
query OrdersPage($first: Int!, $after: String) {
  orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: false) {
    nodes {
      id name createdAt displayFinancialStatus email note
      totalPriceSet { shopMoney { amount currencyCode } }
      subtotalPriceSet { shopMoney { amount currencyCode } }
      totalShippingPriceSet { shopMoney { amount currencyCode } }
      totalDiscountsSet { shopMoney { amount currencyCode } }
      customer { firstName lastName email phone defaultAddress { address1 address2 city province country zip phone } }
      shippingAddress { firstName lastName address1 address2 city province country zip phone }
      billingAddress { firstName lastName address1 address2 city province country zip phone }
      lineItems(first: 250) {
        nodes { id name quantity sku originalUnitPriceSet { shopMoney { amount } } variant { id product { id title handle productType } } }
        pageInfo { hasNextPage endCursor }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
GRAPHQL, ['first' => 50, 'after' => $cursor]);
            $connection = is_array($data['orders'] ?? null) ? $data['orders'] : [];
            foreach ($this->connectionNodes($connection) as $remoteOrder) {
                if (!is_array($remoteOrder) || $processed >= $maxOrders) break;
                $processed++;
                try {
                    $normalized = $this->normalizeGraphQlOrder($store, $remoteOrder);
                    $result = $this->importOrder($store, $normalized);
                    if (!empty($result['skipped'])) $skipped++; else $imported++;
                } catch (Throwable $exception) {
                    $failed++; $errors[] = 'Order ' . ((string) ($remoteOrder['name'] ?? $remoteOrder['id'] ?? '?')) . ': ' . $exception->getMessage();
                    $this->recordImportFailure($store, $remoteOrder, $exception->getMessage());
                }
            }
            if ($processed >= $maxOrders) break;
            $pageInfo = is_array($connection['pageInfo'] ?? null) ? $connection['pageInfo'] : [];
            $cursor = !empty($pageInfo['hasNextPage']) ? (string) ($pageInfo['endCursor'] ?? '') : null;
            if ($cursor === '') $cursor = null;
        } while ($cursor !== null);

        $message = sprintf('Shopify order import finished: %d imported, %d already present, %d failed.', $imported, $skipped, $failed);
        $this->updateStoreSyncState((string) $store['id'], $failed > 0 ? 'warning' : 'success', $message, 'orders');
        return ['success' => $failed === 0, 'message' => $message, 'processed' => $processed, 'imported' => $imported, 'skipped' => $skipped, 'failed' => $failed, 'errors' => array_slice($errors, 0, 20)];
    }

    /** @return array<string, mixed> */
    public function handleWebhook(string $storeId, string $rawBody, ?string $signature, ?string $topic = null, ?string $webhookId = null, ?string $eventId = null, ?string $shopDomain = null): array
    {
        $this->assertSchema();
        $store = $this->requireStore($storeId);
        if (empty($store['enabled'])) throw new ApiException('This Shopify connection is disabled.', 403, 'SHOPIFY_STORE_DISABLED');
        $capabilities = (new FeatureAccess($this->database, $this->auth))->fetchCapabilities();
        if (empty($capabilities['shopify'])) throw new ApiException('Shopify integration is not enabled for this installation.', 403, 'FEATURE_LOCKED');
        $this->serviceLifecycle()->assertActionAllowed('syncShopifyOrders');

        $secret = trim((string) ($store['api_secret'] ?? ($store['webhook_secret'] ?? '')));
        $signature = trim((string) ($signature ?? ''));
        if ($secret === '' || $signature === '') throw new ApiException('Invalid Shopify webhook signature.', 401, 'INVALID_WEBHOOK_SIGNATURE');
        $expected = base64_encode(hash_hmac('sha256', $rawBody, $secret, true));
        if (!hash_equals($expected, $signature)) throw new ApiException('Invalid Shopify webhook signature.', 401, 'INVALID_WEBHOOK_SIGNATURE');

        $topic = trim((string) ($topic ?? ''));
        if (!in_array($topic, array_values(self::WEBHOOK_TOPICS), true)) return ['success' => true, 'ignored' => true, 'message' => 'Webhook topic ignored.'];
        if ($shopDomain !== null && trim($shopDomain) !== '' && strtolower(trim($shopDomain)) !== strtolower((string) parse_url($store['store_url'], PHP_URL_HOST))) {
            throw new ApiException('Shopify webhook store domain does not match this connection.', 401, 'SHOPIFY_STORE_MISMATCH');
        }
        $payload = json_decode($rawBody, true);
        if (!is_array($payload)) throw new ApiException('Invalid Shopify webhook payload.', 422, 'INVALID_WEBHOOK_PAYLOAD');
        $webhookId = trim((string) ($webhookId ?? '')) ?: hash('sha256', $topic . '|' . $rawBody);
        $existingEvent = $this->database->fetchOne('SELECT status, message FROM shopify_webhook_events WHERE store_id = :store_id AND webhook_id = :webhook_id LIMIT 1', [':store_id' => $store['id'], ':webhook_id' => $webhookId]);
        if ($existingEvent !== null && (string) ($existingEvent['status'] ?? '') === 'processed') return ['success' => true, 'skipped' => true, 'message' => 'Shopify webhook delivery was already processed.'];
        $resourceId = $this->legacyId($payload['id'] ?? '');
        $now = $this->database->nowUtc();
        $this->database->execute(
            'INSERT INTO shopify_webhook_events (id, store_id, webhook_id, event_id, topic, resource_id, payload_hash, payload, status, created_at)
             VALUES (:id, :store_id, :webhook_id, :event_id, :topic, :resource_id, :payload_hash, :payload, :status, :created_at)
             ON DUPLICATE KEY UPDATE event_id = VALUES(event_id), topic = VALUES(topic), resource_id = VALUES(resource_id), payload_hash = VALUES(payload_hash), payload = VALUES(payload), status = :processing_status, message = NULL, processed_at = NULL',
            [':id' => $this->uuid4(), ':store_id' => $store['id'], ':webhook_id' => $webhookId, ':event_id' => $eventId ?: null, ':topic' => $topic, ':resource_id' => $resourceId ?: null, ':payload_hash' => $this->payloadHash($payload), ':payload' => $rawBody, ':status' => 'processing', ':created_at' => $now, ':processing_status' => 'processing']
        );
        try {
            if ($topic === 'orders/create') {
                $result = $this->importOrder($store, $payload);
            } else {
                $systemUser = $this->ensureSystemUser();
                $customer = $this->upsertCustomerPayload($payload, (string) $systemUser['id'], $topic !== 'customers/update');
                $result = $customer === null ? ['skipped' => true, 'message' => 'Customer webhook did not contain a phone number.'] : ['skipped' => false, 'customerId' => $customer['id']];
            }
            $this->database->execute('UPDATE shopify_webhook_events SET status = :status, message = :message, processed_at = :processed_at WHERE store_id = :store_id AND webhook_id = :webhook_id', [':status' => 'processed', ':message' => $result['message'] ?? null, ':processed_at' => $this->database->nowUtc(), ':store_id' => $store['id'], ':webhook_id' => $webhookId]);
            $this->updateStoreSyncState((string) $store['id'], 'success', $result['skipped'] ?? false ? 'Shopify webhook already handled.' : 'Shopify webhook imported successfully.');
            return ['success' => true, ...$result];
        } catch (Throwable $exception) {
            $this->database->execute('UPDATE shopify_webhook_events SET status = :status, message = :message WHERE store_id = :store_id AND webhook_id = :webhook_id', [':status' => 'failed', ':message' => mb_substr($exception->getMessage(), 0, 1000), ':store_id' => $store['id'], ':webhook_id' => $webhookId]);
            if ($topic === 'orders/create') $this->recordImportFailure($store, $payload, $exception->getMessage());
            $this->updateStoreSyncState((string) $store['id'], 'error', $exception->getMessage());
            throw $exception;
        }
    }

    /** @return array<string, mixed> */
    private function importOrder(array $store, array $payload): array
    {
        $order = isset($payload['line_items']) ? $payload : $this->normalizeGraphQlOrder($store, $payload);
        $remoteId = $this->legacyId($order['id'] ?? '');
        if ($remoteId === '') throw new RuntimeException('Shopify order id is missing.');
        $phone = $this->orderPhone($order);
        if ($phone === '') throw new RuntimeException('Shopify order customer phone number is missing. Orders cannot be safely matched without a phone number.');
        $dedupeKey = $this->orderDedupeKey($phone, $order);
        $existing = $this->database->fetchOne('SELECT order_id, status FROM shopify_order_links WHERE store_id = :store_id AND shopify_order_id = :remote_id LIMIT 1', [':store_id' => $store['id'], ':remote_id' => $remoteId]);
        if ($existing !== null && trim((string) ($existing['order_id'] ?? '')) !== '' && in_array((string) ($existing['status'] ?? ''), ['imported', 'matched'], true)) return ['skipped' => true, 'orderId' => (string) $existing['order_id'], 'shopifyOrderId' => $remoteId];
        $lockName = 'mpshopifyorder:' . sha1($dedupeKey);
        $lock = $this->database->fetchOne('SELECT GET_LOCK(:lock_name, 10) AS acquired', [':lock_name' => $lockName]);
        if ((int) ($lock['acquired'] ?? 0) !== 1) throw new RuntimeException('This Shopify order is being imported by another request. Shopify can retry it shortly.');
        try {
            $result = $this->database->transaction(function () use ($store, $order, $remoteId, $phone, $dedupeKey): array {
                $locked = $this->database->fetchOne('SELECT order_id, status FROM shopify_order_links WHERE store_id = :store_id AND shopify_order_id = :remote_id LIMIT 1 FOR UPDATE', [':store_id' => $store['id'], ':remote_id' => $remoteId]);
                if ($locked !== null && trim((string) ($locked['order_id'] ?? '')) !== '' && in_array((string) ($locked['status'] ?? ''), ['imported', 'matched'], true)) return ['skipped' => true, 'orderId' => (string) $locked['order_id'], 'shopifyOrderId' => $remoteId];
                $systemUser = $this->ensureSystemUser();
                $customer = $this->upsertCustomerFromOrder($order, (string) $systemUser['id']);
                $items = $this->mapOrderItems($store, $order, (string) $systemUser['id']);
                if ($items === []) throw new RuntimeException('Shopify order does not contain any valid SKU line items.');
                $existingLocal = $this->findExistingOrderByDedupeKey($customer['id'], $phone, $dedupeKey);
                if ($existingLocal !== null) {
                    $this->saveOrderLink($store, $remoteId, $order, $existingLocal['id'], 'matched', $dedupeKey, 'Matched an existing local order by customer phone, SKU, and quantity.');
                    return ['skipped' => true, 'matchedExisting' => true, 'orderId' => (string) $existingLocal['id'], 'shopifyOrderId' => $remoteId];
                }
                $subtotal = round(array_reduce($items, static fn(float $sum, array $item): float => $sum + (float) ($item['amount'] ?? 0), 0.0), 2);
                $total = max(0.0, round($this->money($order['total_price'] ?? $order['totalPriceSet'] ?? 0), 2));
                $discount = max(0.0, round($this->money($order['total_discounts'] ?? $order['totalDiscountsSet'] ?? 0), 2));
                $shipping = max(0.0, round($total - $subtotal + $discount, 2));
                if ($shipping < 0) { $shipping = 0.0; $discount = min($subtotal, max(0.0, round($subtotal - $total, 2))); }
                $financial = strtolower((string) ($order['financial_status'] ?? $order['displayFinancialStatus'] ?? ''));
                $paid = in_array($financial, ['paid', 'partially_paid'], true) && $financial === 'paid' ? $total : 0.0;
                $address = $this->formatShopifyAddress(is_array($order['shipping_address'] ?? null) ? $order['shipping_address'] : []);
                if ($address === '') $address = (string) ($customer['address'] ?? '');
                $orderDate = $this->parseDateOnly((string) ($order['created_at'] ?? $order['createdAt'] ?? '')) ?: gmdate('Y-m-d');
                $orderName = trim((string) ($order['name'] ?? $order['order_number'] ?? $remoteId));
                $notes = '';
                $saved = $this->withSystemUser($systemUser, fn(): array => $this->operations->createOrder([
                    'customerId' => $customer['id'], 'pageId' => (string) $store['company_page_id'], 'orderDate' => $orderDate,
                    'status' => 'On Hold', 'items' => $items, 'subtotal' => $subtotal, 'discount' => $discount,
                    'shipping' => $shipping, 'total' => $total, 'paidAmount' => $paid, 'notes' => $notes,
                    'sourceAd' => 'Shopify', 'history' => ['created' => 'Imported from Shopify automatically on ' . gmdate('c') . '.'],
                ]));
                $this->saveOrderLink($store, $remoteId, $order, (string) $saved['id'], 'imported', $dedupeKey, 'Imported successfully.');
                $this->database->execute('UPDATE shopify_stores SET orders_synced = orders_synced + 1, last_orders_synced_at = :now, updated_at = :now WHERE id = :id', [':now' => $this->database->nowUtc(), ':id' => $store['id']]);
                return ['skipped' => false, 'orderId' => (string) $saved['id'], 'orderNumber' => (string) ($saved['orderNumber'] ?? ''), 'shopifyOrderId' => $remoteId, 'order' => $saved];
            });
        } catch (Throwable $exception) { $this->customersByNormalizedPhone = null; throw $exception; }
        finally { $this->database->fetchOne('SELECT RELEASE_LOCK(:lock_name) AS released', [':lock_name' => $lockName]); }
        if (empty($result['skipped']) && is_array($result['order'] ?? null)) $this->postCreateEffects->schedule($result['order']);
        unset($result['order']);
        return $result;
    }

    /** @return array<int, array<string, mixed>> */
    private function mapOrderItems(array $store, array $order, string $systemUserId): array
    {
        $items = [];
        foreach ((array) ($order['line_items'] ?? []) as $line) {
            if (!is_array($line)) continue;
            $quantity = max(0, (int) ($line['quantity'] ?? 0));
            $sku = trim((string) ($line['sku'] ?? ''));
            if ($quantity <= 0) continue;
            if ($sku === '') throw new RuntimeException('Shopify line item "' . trim((string) ($line['name'] ?? 'item')) . '" has no SKU. Add SKUs to every Shopify variant before importing.');
            $product = $this->resolveOrderProduct($store, $line, $systemUserId);
            $rate = round((float) ($line['price'] ?? 0), 2);
            $items[] = ['productId' => (string) $product['id'], 'productName' => (string) ($product['name'] ?? $line['name'] ?? 'Shopify Product'), 'rate' => $rate, 'quantity' => $quantity, 'amount' => round($rate * $quantity, 2)];
        }
        return $items;
    }

    /** @return array<string, mixed> */
    private function resolveOrderProduct(array $store, array $line, string $systemUserId): array
    {
        $sku = trim((string) ($line['sku'] ?? ''));
        $product = $this->database->fetchOne('SELECT id, name, stock FROM products WHERE deleted_at IS NULL AND LOWER(TRIM(sku)) = LOWER(:sku) ORDER BY created_at ASC LIMIT 1', [':sku' => $sku]);
        if ($product !== null) {
            $this->linkProduct((string) $store['id'], $this->legacyId($line['product_id'] ?? ''), $this->legacyId($line['variant_id'] ?? ''), $sku, (string) $product['id'], false);
            return $product;
        }
        $id = $this->uuid4(); $name = trim((string) ($line['name'] ?? 'Shopify Product')) ?: 'Shopify Product'; $now = $this->database->nowUtc();
        $slug = $this->uniqueSlug($this->slugify($name . '-' . $sku));
        $this->database->execute('INSERT INTO products (id, name, slug, sku, category, sale_price, purchase_price, stock, created_by, created_at, updated_at) VALUES (:id, :name, :slug, :sku, :category, :sale_price, 0, 0, :created_by, :created_at, :updated_at)', [':id' => $id, ':name' => $name, ':slug' => $slug, ':sku' => $sku, ':category' => 'Shopify', ':sale_price' => round((float) ($line['price'] ?? 0), 2), ':created_by' => $systemUserId, ':created_at' => $now, ':updated_at' => $now]);
        $this->linkProduct((string) $store['id'], $this->legacyId($line['product_id'] ?? ''), $this->legacyId($line['variant_id'] ?? ''), $sku, $id, true);
        return ['id' => $id, 'name' => $name, 'stock' => 0];
    }

    /** @return array{created:int,matched:int,updated:int,skipped:int} */
    private function importProductVariant(array $store, array $variant): array
    {
        $remoteProductId = $this->legacyId($variant['product']['id'] ?? '');
        $remoteVariantId = $this->legacyId($variant['id'] ?? '');
        $handle = trim((string) ($variant['product']['handle'] ?? ''));
        $sku = trim((string) ($variant['sku'] ?? ''));
        $matchKey = $sku !== '' ? $sku : $this->slugify(($handle !== '' ? $handle : 'shopify-product') . '-' . ($remoteVariantId !== '' ? $remoteVariantId : 'variant'));
        $name = trim((string) ($variant['product']['title'] ?? 'Shopify Product'));
        $variantTitle = trim((string) ($variant['title'] ?? ''));
        if ($variantTitle !== '' && strcasecmp($variantTitle, 'Default Title') !== 0) $name .= ' (' . $variantTitle . ')';
        $price = round((float) ($variant['price'] ?? 0), 2);
        $stock = max(0, (int) ($variant['inventoryQuantity'] ?? 0));
        $image = trim((string) ($variant['image']['url'] ?? $variant['product']['featuredMedia']['preview']['image']['url'] ?? ''));
        $category = trim((string) ($variant['product']['productType'] ?? '')) ?: 'Shopify';
        $this->ensureCategory($category);
        $link = $this->database->fetchOne('SELECT l.product_id, l.auto_created, p.name FROM shopify_product_links l JOIN products p ON p.id = l.product_id AND p.deleted_at IS NULL WHERE l.store_id = :store_id AND l.shopify_product_id = :product_id AND l.shopify_variant_id = :variant_id LIMIT 1', [':store_id' => $store['id'], ':product_id' => $remoteProductId ?: '0', ':variant_id' => $remoteVariantId ?: '0']);
        if ($link !== null) {
            if ((int) ($link['auto_created'] ?? 0) === 1) {
                $this->database->execute('UPDATE products SET name = :name, sku = :sku, sale_price = :sale_price, stock = :stock, category = :category, image = :image, updated_at = :updated_at WHERE id = :id', [':name' => $name, ':sku' => $matchKey, ':sale_price' => $price, ':stock' => $stock, ':category' => $category, ':image' => $image !== '' ? $image : null, ':updated_at' => $this->database->nowUtc(), ':id' => $link['product_id']]);
                return ['created' => 0, 'matched' => 0, 'updated' => 1, 'skipped' => 0];
            }
            return ['created' => 0, 'matched' => 1, 'updated' => 0, 'skipped' => 0];
        }
        $existing = $this->database->fetchOne('SELECT id FROM products WHERE deleted_at IS NULL AND LOWER(TRIM(sku)) = LOWER(:sku) ORDER BY created_at ASC LIMIT 1', [':sku' => $matchKey]);
        if ($existing !== null) { $this->linkProduct((string) $store['id'], $remoteProductId ?: '0', $remoteVariantId ?: '0', $matchKey, (string) $existing['id'], false); return ['created' => 0, 'matched' => 1, 'updated' => 0, 'skipped' => 0]; }
        $id = $this->uuid4(); $now = $this->database->nowUtc();
        $systemUser = $this->ensureSystemUser();
        $this->database->execute('INSERT INTO products (id, name, slug, sku, image, category, sale_price, purchase_price, stock, created_by, created_at, updated_at) VALUES (:id, :name, :slug, :sku, :image, :category, :sale_price, 0, :stock, :created_by, :created_at, :updated_at)', [':id' => $id, ':name' => $name, ':slug' => $this->uniqueSlug($this->slugify(($handle !== '' ? $handle : 'shopify-product') . '-' . $matchKey)), ':sku' => $matchKey, ':image' => $image !== '' ? $image : null, ':category' => $category, ':sale_price' => $price, ':stock' => $stock, ':created_by' => (string) $systemUser['id'], ':created_at' => $now, ':updated_at' => $now]);
        $this->linkProduct((string) $store['id'], $remoteProductId ?: '0', $remoteVariantId ?: '0', $matchKey, $id, true);
        return ['created' => 1, 'matched' => 0, 'updated' => 0, 'skipped' => 0];
    }

    private function ensureCategory(string $name): void
    {
        if ($this->database->fetchOne('SELECT id FROM categories WHERE name = :name AND type = :type LIMIT 1', [':name' => $name, ':type' => 'Product']) !== null) return;
        try { $this->database->execute('INSERT INTO categories (id, name, type, color, is_system, created_at, updated_at) VALUES (:id, :name, :type, :color, 0, :created_at, :updated_at)', [':id' => $this->uuid4(), ':name' => $name, ':type' => 'Product', ':color' => '#3B82F6', ':created_at' => $this->database->nowUtc(), ':updated_at' => $this->database->nowUtc()]); }
        catch (Throwable $exception) { error_log('Shopify category creation warning: ' . $exception->getMessage()); }
    }

    private function linkProduct(string $storeId, string $remoteProductId, string $remoteVariantId, string $sku, string $productId, bool $autoCreated): void
    {
        $this->database->execute(
            'INSERT INTO shopify_product_links
                (id, store_id, shopify_product_id, shopify_variant_id, sku, product_id, auto_created, created_at, updated_at)
             VALUES (:id, :store_id, :product_id, :variant_id, :sku, :local_product_id, :auto_created, :created_at, :updated_at)
             ON DUPLICATE KEY UPDATE sku = VALUES(sku), product_id = VALUES(product_id), auto_created = VALUES(auto_created), updated_at = VALUES(updated_at)',
            [
                ':id' => $this->uuid4(), ':store_id' => $storeId,
                ':product_id' => $remoteProductId !== '' ? $remoteProductId : '0',
                ':variant_id' => $remoteVariantId !== '' ? $remoteVariantId : '0',
                ':sku' => $sku, ':local_product_id' => $productId, ':auto_created' => $autoCreated ? 1 : 0,
                ':created_at' => $this->database->nowUtc(), ':updated_at' => $this->database->nowUtc(),
            ]
        );
    }

    /** @return array<string, mixed> */
    private function upsertCustomerFromOrder(array $order, string $systemUserId): array
    {
        $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
        $shipping = is_array($order['shipping_address'] ?? null) ? $order['shipping_address'] : [];
        $billing = is_array($order['billing_address'] ?? null) ? $order['billing_address'] : [];
        $payload = [
            'first_name' => $shipping['first_name'] ?? $billing['first_name'] ?? $customer['first_name'] ?? '',
            'last_name' => $shipping['last_name'] ?? $billing['last_name'] ?? $customer['last_name'] ?? '',
            'email' => $order['email'] ?? $customer['email'] ?? '',
            'phone' => $this->orderPhone($order),
            'default_address' => $shipping !== [] ? $shipping : ($billing !== [] ? $billing : ($customer['default_address'] ?? [])),
        ];
        return $this->upsertCustomerPayload($payload, $systemUserId, true)
            ?? throw new RuntimeException('Shopify order customer phone number is missing.');
    }

    /** @return array<string, mixed>|null */
    private function upsertCustomerPayload(array $payload, string $systemUserId, bool $requirePhone): ?array
    {
        $defaultAddress = is_array($payload['default_address'] ?? null) ? $payload['default_address'] : [];
        $phone = trim((string) ($payload['phone'] ?? $defaultAddress['phone'] ?? ''));
        $phoneKey = $this->normalizePhone($phone);
        if ($phoneKey === '') {
            if ($requirePhone) throw new RuntimeException('Shopify customer phone number is missing.');
            return null;
        }
        $firstName = trim((string) ($payload['first_name'] ?? $defaultAddress['first_name'] ?? ''));
        $lastName = trim((string) ($payload['last_name'] ?? $defaultAddress['last_name'] ?? ''));
        $name = trim($firstName . ' ' . $lastName);
        if ($name === '') $name = trim((string) ($payload['email'] ?? '')) ?: 'Shopify Customer';
        $address = $this->formatShopifyAddress($defaultAddress);

        if ($this->customersByNormalizedPhone === null) {
            $this->customersByNormalizedPhone = [];
            foreach ($this->database->fetchAll('SELECT id, name, phone, address FROM customers WHERE deleted_at IS NULL ORDER BY created_at ASC') as $row) {
                $normalized = $this->normalizePhone((string) ($row['phone'] ?? ''));
                if ($normalized !== '' && !isset($this->customersByNormalizedPhone[$normalized])) $this->customersByNormalizedPhone[$normalized] = $row;
            }
        }
        $existing = $this->customersByNormalizedPhone[$phoneKey] ?? null;
        $now = $this->database->nowUtc();
        if ($existing !== null) {
            $this->database->execute('UPDATE customers SET name = :name, address = :address, updated_at = :updated_at WHERE id = :id', [':name' => $name, ':address' => $address, ':updated_at' => $now, ':id' => $existing['id']]);
            $customer = ['id' => (string) $existing['id'], 'name' => $name, 'phone' => (string) $existing['phone'], 'address' => $address];
            $this->customersByNormalizedPhone[$phoneKey] = $customer;
            return $customer;
        }
        $id = $this->uuid4();
        $this->database->execute(
            'INSERT INTO customers (id, name, phone, address, total_orders, due_amount, created_by, created_at, updated_at)
             VALUES (:id, :name, :phone, :address, 0, 0, :created_by, :created_at, :updated_at)',
            [':id' => $id, ':name' => $name, ':phone' => $phone, ':address' => $address, ':created_by' => $systemUserId, ':created_at' => $now, ':updated_at' => $now]
        );
        $customer = ['id' => $id, 'name' => $name, 'phone' => $phone, 'address' => $address];
        $this->customersByNormalizedPhone[$phoneKey] = $customer;
        return $customer;
    }

    private function orderPhone(array $order): string
    {
        $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
        $shipping = is_array($order['shipping_address'] ?? null) ? $order['shipping_address'] : [];
        $billing = is_array($order['billing_address'] ?? null) ? $order['billing_address'] : [];
        foreach ([$shipping['phone'] ?? '', $billing['phone'] ?? '', $customer['phone'] ?? '', $order['phone'] ?? ''] as $phone) {
            if ($this->normalizePhone((string) $phone) !== '') return trim((string) $phone);
        }
        return '';
    }

    private function orderDedupeKey(string $phone, array $order): string
    {
        $quantities = [];
        foreach ((array) ($order['line_items'] ?? []) as $line) {
            if (!is_array($line) || (int) ($line['quantity'] ?? 0) <= 0) continue;
            $sku = mb_strtolower(trim((string) ($line['sku'] ?? '')));
            if ($sku === '') throw new RuntimeException('Every Shopify order line item must have a SKU before it can be imported.');
            $quantities[$sku] = ($quantities[$sku] ?? 0) + (int) $line['quantity'];
        }
        if ($quantities === []) throw new RuntimeException('Shopify order does not contain any SKU line items.');
        ksort($quantities, SORT_STRING);
        $parts = [];
        foreach ($quantities as $sku => $quantity) $parts[] = $sku . ':' . $quantity;
        return hash('sha256', $this->normalizePhone($phone) . '|' . implode('|', $parts));
    }

    /** @return array<string, mixed>|null */
    private function findExistingOrderByDedupeKey(string $customerId, string $phone, string $dedupeKey): ?array
    {
        $linked = $this->database->fetchOne('SELECT order_id FROM shopify_order_links WHERE dedupe_key = :dedupe_key AND order_id IS NOT NULL LIMIT 1', [':dedupe_key' => $dedupeKey]);
        if ($linked !== null) return $this->database->fetchOne('SELECT id, order_number FROM orders WHERE id = :id AND deleted_at IS NULL LIMIT 1', [':id' => $linked['order_id']]);
        $orders = $this->database->fetchAll('SELECT id, order_number, items FROM orders WHERE customer_id = :customer_id AND deleted_at IS NULL ORDER BY created_at ASC', [':customer_id' => $customerId]);
        $productIds = [];
        foreach ($orders as $order) foreach ($this->jsonDecodeAssoc($order['items'] ?? []) as $item) {
            $productId = trim((string) ($item['productId'] ?? ''));
            if ($productId !== '') $productIds[$productId] = true;
        }
        $skus = [];
        if ($productIds !== []) {
            [$placeholders, $bindings] = $this->inClause(array_keys($productIds), 'shopify_existing_product');
            foreach ($this->database->fetchAll('SELECT id, sku FROM products WHERE id IN (' . implode(', ', $placeholders) . ')', $bindings) as $row) $skus[(string) $row['id']] = (string) ($row['sku'] ?? '');
        }
        foreach ($orders as $order) {
            $lineItems = [];
            foreach ($this->jsonDecodeAssoc($order['items'] ?? []) as $item) {
                $sku = trim((string) ($skus[(string) ($item['productId'] ?? '')] ?? ''));
                if ($sku === '') { $lineItems = []; break; }
                $lineItems[] = ['sku' => $sku, 'quantity' => (int) ($item['quantity'] ?? 0)];
            }
            if ($lineItems !== [] && $this->orderDedupeKey($phone, ['line_items' => $lineItems]) === $dedupeKey) return ['id' => (string) $order['id'], 'order_number' => (string) $order['order_number']];
        }
        return null;
    }

    private function saveOrderLink(array $store, string $remoteId, array $order, string $orderId, string $status, string $dedupeKey, string $message): void
    {
        $now = $this->database->nowUtc();
        $this->database->execute(
            'INSERT INTO shopify_order_links (id, store_id, shopify_order_id, shopify_order_number, dedupe_key, order_id, status, message, payload_hash, created_at, updated_at)
             VALUES (:id, :store_id, :remote_id, :order_number, :dedupe_key, :order_id, :status, :message, :payload_hash, :created_at, :updated_at)
             ON DUPLICATE KEY UPDATE shopify_order_number = VALUES(shopify_order_number), dedupe_key = VALUES(dedupe_key), order_id = VALUES(order_id), status = VALUES(status), message = VALUES(message), payload_hash = VALUES(payload_hash), updated_at = VALUES(updated_at)',
            [':id' => $this->uuid4(), ':store_id' => $store['id'], ':remote_id' => $remoteId, ':order_number' => trim((string) ($order['name'] ?? $order['order_number'] ?? $remoteId)), ':dedupe_key' => $dedupeKey, ':order_id' => $orderId, ':status' => $status, ':message' => $message, ':payload_hash' => $this->payloadHash($order), ':created_at' => $now, ':updated_at' => $now]
        );
    }

    /** @return array<string, mixed> */
    private function normalizeGraphQlOrder(array $store, array $order): array
    {
        $lineConnection = is_array($order['lineItems'] ?? null) ? $order['lineItems'] : [];
        $lineItems = $this->connectionNodes($lineConnection);
        $pageInfo = is_array($lineConnection['pageInfo'] ?? null) ? $lineConnection['pageInfo'] : [];
        $cursor = !empty($pageInfo['hasNextPage']) ? (string) ($pageInfo['endCursor'] ?? '') : '';
        while ($cursor !== '') {
            $data = $this->graphQl($store, <<<'GRAPHQL'
query OrderLineItemsPage($id: ID!, $after: String) {
  order(id: $id) {
    lineItems(first: 250, after: $after) {
      nodes { id name quantity sku originalUnitPriceSet { shopMoney { amount } } variant { id product { id title handle productType } } }
      pageInfo { hasNextPage endCursor }
    }
  }
}
GRAPHQL, ['id' => (string) ($order['id'] ?? ''), 'after' => $cursor]);
            $next = is_array($data['order']['lineItems'] ?? null) ? $data['order']['lineItems'] : [];
            $lineItems = array_merge($lineItems, $this->connectionNodes($next));
            $nextInfo = is_array($next['pageInfo'] ?? null) ? $next['pageInfo'] : [];
            $cursor = !empty($nextInfo['hasNextPage']) ? (string) ($nextInfo['endCursor'] ?? '') : '';
        }
        $normalizedLines = [];
        foreach ($lineItems as $line) {
            $variant = is_array($line['variant'] ?? null) ? $line['variant'] : [];
            $product = is_array($variant['product'] ?? null) ? $variant['product'] : [];
            $normalizedLines[] = [
                'id' => $this->legacyId($line['id'] ?? ''), 'name' => (string) ($line['name'] ?? $product['title'] ?? 'Shopify Product'),
                'sku' => trim((string) ($line['sku'] ?? '')), 'quantity' => max(0, (int) ($line['quantity'] ?? 0)),
                'price' => $this->money($line['originalUnitPriceSet'] ?? 0),
                'variant_id' => $this->legacyId($variant['id'] ?? ''), 'product_id' => $this->legacyId($product['id'] ?? ''),
            ];
        }
        $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
        return [
            'id' => $this->legacyId($order['id'] ?? ''), 'graphql_id' => (string) ($order['id'] ?? ''),
            'name' => (string) ($order['name'] ?? ''), 'created_at' => (string) ($order['createdAt'] ?? ''),
            'financial_status' => strtolower((string) ($order['displayFinancialStatus'] ?? '')),
            'email' => (string) ($order['email'] ?? $customer['email'] ?? ''), 'note' => (string) ($order['note'] ?? ''),
            'total_price' => $this->money($order['totalPriceSet'] ?? 0),
            'subtotal_price' => $this->money($order['subtotalPriceSet'] ?? 0),
            'total_discounts' => $this->money($order['totalDiscountsSet'] ?? 0),
            'total_shipping_price_set' => $order['totalShippingPriceSet'] ?? [],
            'customer' => [
                'first_name' => (string) ($customer['firstName'] ?? ''), 'last_name' => (string) ($customer['lastName'] ?? ''),
                'email' => (string) ($customer['email'] ?? ''), 'phone' => (string) ($customer['phone'] ?? ''),
                'default_address' => $this->normalizeGraphQlAddress(is_array($customer['defaultAddress'] ?? null) ? $customer['defaultAddress'] : []),
            ],
            'shipping_address' => $this->normalizeGraphQlAddress(is_array($order['shippingAddress'] ?? null) ? $order['shippingAddress'] : []),
            'billing_address' => $this->normalizeGraphQlAddress(is_array($order['billingAddress'] ?? null) ? $order['billingAddress'] : []),
            'line_items' => $normalizedLines,
        ];
    }

    /** @return array<string, mixed> */
    private function normalizeGraphQlAddress(array $address): array
    {
        return [
            'first_name' => (string) ($address['firstName'] ?? ''), 'last_name' => (string) ($address['lastName'] ?? ''),
            'address1' => (string) ($address['address1'] ?? ''), 'address2' => (string) ($address['address2'] ?? ''),
            'city' => (string) ($address['city'] ?? ''), 'province' => (string) ($address['province'] ?? ''),
            'country' => (string) ($address['country'] ?? ''), 'zip' => (string) ($address['zip'] ?? ''),
            'phone' => (string) ($address['phone'] ?? ''),
        ];
    }

    /** @return array<int, array<string, mixed>> */
    private function connectionNodes(array $connection): array
    {
        if (is_array($connection['nodes'] ?? null)) return array_values(array_filter($connection['nodes'], 'is_array'));
        $nodes = [];
        foreach ((array) ($connection['edges'] ?? []) as $edge) if (is_array($edge) && is_array($edge['node'] ?? null)) $nodes[] = $edge['node'];
        return $nodes;
    }

    /** @return array<string, mixed> */
    private function checkShopifyWebhookHealthInternal(array $store): array
    {
        try {
            $deliveryUrl = $this->webhookUrl((string) $store['id'], (string) ($store['webhook_base_url'] ?? ''));
            $remote = $this->fetchRemoteWebhooks($store);
            $missing = [];
            foreach (self::WEBHOOK_TOPICS as $graphqlTopic => $headerTopic) {
                $found = false;
                foreach ($remote as $subscription) {
                    if ((string) ($subscription['topic'] ?? '') === $graphqlTopic && rtrim((string) ($subscription['uri'] ?? ''), '/') === rtrim($deliveryUrl, '/')) { $found = true; break; }
                }
                if (!$found) $missing[] = $headerTopic;
            }
            if ($missing !== []) return ['healthy' => false, 'status' => 'missing', 'message' => 'Missing Shopify webhooks: ' . implode(', ', $missing) . '.', 'expectedUrl' => $deliveryUrl];
            return ['healthy' => true, 'status' => 'active', 'message' => 'Order and customer webhooks are active.', 'deliveryUrl' => $deliveryUrl, 'topics' => array_values(self::WEBHOOK_TOPICS)];
        } catch (Throwable $exception) {
            return ['healthy' => false, 'status' => 'check_failed', 'message' => 'Could not verify Shopify webhooks: ' . $exception->getMessage()];
        }
    }

    /** @return array<int, array<string, mixed>> */
    private function registerWebhooks(array $store, bool $replace): array
    {
        $deliveryUrl = $this->webhookUrl((string) $store['id'], (string) ($store['webhook_base_url'] ?? ''));
        $this->assertPublicWebhookUrl($deliveryUrl);
        if ($replace) $this->removeStoredWebhooks($store);
        $remote = $this->fetchRemoteWebhooks($store);
        $registered = [];
        foreach (self::WEBHOOK_TOPICS as $graphqlTopic => $headerTopic) {
            $match = null;
            foreach ($remote as $subscription) {
                if ((string) ($subscription['topic'] ?? '') === $graphqlTopic && rtrim((string) ($subscription['uri'] ?? ''), '/') === rtrim($deliveryUrl, '/')) { $match = $subscription; break; }
            }
            if ($match === null) $match = $this->createRemoteWebhook($store, $graphqlTopic, $deliveryUrl);
            $remoteId = trim((string) ($match['id'] ?? ''));
            if ($remoteId === '') throw new RuntimeException('Shopify did not return a webhook subscription id for ' . $headerTopic . '.');
            $this->database->execute(
                'INSERT INTO shopify_webhook_subscriptions (id, store_id, topic, remote_id, uri, created_at, updated_at)
                 VALUES (:id, :store_id, :topic, :remote_id, :uri, :created_at, :updated_at)
                 ON DUPLICATE KEY UPDATE remote_id = VALUES(remote_id), uri = VALUES(uri), updated_at = VALUES(updated_at)',
                [':id' => $this->uuid4(), ':store_id' => $store['id'], ':topic' => $graphqlTopic, ':remote_id' => $remoteId, ':uri' => $deliveryUrl, ':created_at' => $this->database->nowUtc(), ':updated_at' => $this->database->nowUtc()]
            );
            $registered[] = ['id' => $remoteId, 'topic' => $headerTopic, 'uri' => $deliveryUrl];
            if ($graphqlTopic === 'ORDERS_CREATE') $this->database->execute('UPDATE shopify_stores SET webhook_id = :webhook_id, updated_at = :updated_at WHERE id = :id', [':webhook_id' => $remoteId, ':updated_at' => $this->database->nowUtc(), ':id' => $store['id']]);
        }
        return $registered;
    }

    /** @return array<int, array<string, mixed>> */
    private function fetchRemoteWebhooks(array $store): array
    {
        $subscriptions = []; $cursor = null;
        do {
            $data = $this->graphQl($store, <<<'GRAPHQL'
query WebhookSubscriptionsPage($first: Int!, $after: String) {
  webhookSubscriptions(first: $first, after: $after) {
    nodes { id topic uri }
    pageInfo { hasNextPage endCursor }
  }
}
GRAPHQL, ['first' => 100, 'after' => $cursor]);
            $connection = is_array($data['webhookSubscriptions'] ?? null) ? $data['webhookSubscriptions'] : [];
            $subscriptions = array_merge($subscriptions, $this->connectionNodes($connection));
            $pageInfo = is_array($connection['pageInfo'] ?? null) ? $connection['pageInfo'] : [];
            $cursor = !empty($pageInfo['hasNextPage']) ? (string) ($pageInfo['endCursor'] ?? '') : null;
            if ($cursor === '') $cursor = null;
        } while ($cursor !== null);
        return $subscriptions;
    }

    /** @return array<string, mixed> */
    private function createRemoteWebhook(array $store, string $topic, string $uri): array
    {
        $data = $this->graphQl($store, <<<'GRAPHQL'
mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription { id topic uri }
    userErrors { field message }
  }
}
GRAPHQL, ['topic' => $topic, 'webhookSubscription' => ['uri' => $uri]]);
        $payload = is_array($data['webhookSubscriptionCreate'] ?? null) ? $data['webhookSubscriptionCreate'] : [];
        $this->assertNoUserErrors($payload['userErrors'] ?? [], 'Shopify rejected the webhook subscription.');
        return is_array($payload['webhookSubscription'] ?? null) ? $payload['webhookSubscription'] : [];
    }

    private function deleteRemoteWebhook(array $store, string $remoteId): void
    {
        if (trim($remoteId) === '') return;
        $data = $this->graphQl($store, <<<'GRAPHQL'
mutation DeleteWebhook($id: ID!) {
  webhookSubscriptionDelete(id: $id) { deletedWebhookSubscriptionId userErrors { field message } }
}
GRAPHQL, ['id' => $remoteId]);
        $payload = is_array($data['webhookSubscriptionDelete'] ?? null) ? $data['webhookSubscriptionDelete'] : [];
        $this->assertNoUserErrors($payload['userErrors'] ?? [], 'Shopify rejected webhook removal.');
    }

    private function removeStoredWebhooks(array $store): void
    {
        foreach ($this->database->fetchAll('SELECT remote_id FROM shopify_webhook_subscriptions WHERE store_id = :store_id', [':store_id' => $store['id']]) as $row) {
            try { $this->deleteRemoteWebhook($store, (string) ($row['remote_id'] ?? '')); }
            catch (Throwable $exception) { error_log('Shopify webhook cleanup warning: ' . $exception->getMessage()); }
        }
        $this->database->execute('DELETE FROM shopify_webhook_subscriptions WHERE store_id = :store_id', [':store_id' => $store['id']]);
        $this->database->execute('UPDATE shopify_stores SET webhook_id = NULL, updated_at = :updated_at WHERE id = :id', [':updated_at' => $this->database->nowUtc(), ':id' => $store['id']]);
    }

    private function assertNoUserErrors(mixed $errors, string $fallback): void
    {
        if (!is_array($errors) || $errors === []) return;
        $messages = [];
        foreach ($errors as $error) if (is_array($error) && trim((string) ($error['message'] ?? '')) !== '') $messages[] = trim((string) $error['message']);
        throw new RuntimeException($messages !== [] ? implode('; ', $messages) : $fallback);
    }

    /** @return array<string, mixed> */
    private function graphQl(array $store, string $query, array $variables = []): array
    {
        $token = trim((string) ($store['access_token'] ?? ''));
        if ($token === '') throw new RuntimeException('Shopify Admin API access token is missing.');
        $url = rtrim((string) $store['store_url'], '/') . '/admin/api/' . self::API_VERSION . '/graphql.json';
        $requestBody = json_encode(['query' => $query, 'variables' => $variables], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($requestBody)) throw new RuntimeException('Could not encode the Shopify GraphQL request.');
        $lastMessage = 'Shopify request failed.';
        for ($attempt = 1; $attempt <= 3; $attempt++) {
            [$status, $body] = $this->sendGraphQlRequest($url, $token, $requestBody);
            $decoded = json_decode($body, true);
            if ($status === 429 || $status >= 500) {
                $lastMessage = 'Shopify is temporarily unavailable (HTTP ' . $status . ').';
                if ($attempt < 3) { usleep(350000 * $attempt); continue; }
            }
            if ($status < 200 || $status >= 300) {
                $providerMessage = is_array($decoded) ? trim((string) ($decoded['errors'] ?? '')) : '';
                throw new ApiException($providerMessage !== '' ? $providerMessage : 'Shopify rejected the Admin API request.', 502, 'SHOPIFY_REQUEST_REJECTED', ['providerStatus' => $status]);
            }
            if (!is_array($decoded)) throw new ApiException('Shopify returned an invalid JSON response.', 502, 'SHOPIFY_INVALID_RESPONSE');
            $errors = is_array($decoded['errors'] ?? null) ? $decoded['errors'] : [];
            if ($errors !== []) {
                $messages = [];
                $throttled = false;
                foreach ($errors as $error) {
                    if (!is_array($error)) continue;
                    $messages[] = trim((string) ($error['message'] ?? 'Shopify GraphQL error.'));
                    if (strtoupper((string) ($error['extensions']['code'] ?? '')) === 'THROTTLED') $throttled = true;
                }
                if ($throttled && $attempt < 3) { usleep(500000 * $attempt); continue; }
                throw new ApiException(implode('; ', array_filter($messages)) ?: 'Shopify GraphQL request failed.', 502, 'SHOPIFY_GRAPHQL_ERROR');
            }
            return is_array($decoded['data'] ?? null) ? $decoded['data'] : [];
        }
        throw new ApiException($lastMessage, 502, 'SHOPIFY_CONNECTION_FAILED');
    }

    /** @return array{0:int,1:string} */
    private function sendGraphQlRequest(string $url, string $token, string $requestBody): array
    {
        $headers = ['Content-Type: application/json', 'Accept: application/json', 'X-Shopify-Access-Token: ' . $token];
        if (function_exists('curl_init')) {
            $handle = curl_init($url);
            if ($handle === false) throw new RuntimeException('Could not initialize the Shopify request.');
            curl_setopt_array($handle, [
                CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_POSTFIELDS => $requestBody,
                CURLOPT_HTTPHEADER => $headers, CURLOPT_TIMEOUT => 45, CURLOPT_CONNECTTIMEOUT => 15,
                CURLOPT_FOLLOWLOCATION => false, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
            ]);
            $body = curl_exec($handle);
            if ($body === false) {
                $error = curl_error($handle) ?: 'Connection failed.'; curl_close($handle);
                error_log('Shopify transport error: ' . $error);
                throw new ApiException('MamePilot could not connect to Shopify. Check the myshopify.com hostname and outbound HTTPS access.', 502, 'SHOPIFY_CONNECTION_FAILED');
            }
            $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE); curl_close($handle);
            return [$status, (string) $body];
        }
        $context = stream_context_create(['http' => ['method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $requestBody, 'timeout' => 45, 'ignore_errors' => true]]);
        $body = file_get_contents($url, false, $context);
        if ($body === false) throw new ApiException('MamePilot could not connect to Shopify.', 502, 'SHOPIFY_CONNECTION_FAILED');
        $status = 200;
        foreach (($http_response_header ?? []) as $line) if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $line, $matches) === 1) { $status = (int) $matches[1]; break; }
        return [$status, (string) $body];
    }

    /** @return array<string, mixed> */
    private function ensureSystemUser(): array
    {
        $existing = $this->database->fetchOne('SELECT * FROM users WHERE id = :id LIMIT 1', [':id' => self::SYSTEM_USER_ID]);
        if ($existing !== null) {
            if ((string) ($existing['name'] ?? '') !== 'Shopify' || (int) ($existing['is_system'] ?? 0) !== 1) {
                $this->database->execute('UPDATE users SET name = :name, role = :role, is_system = 1, deleted_at = NULL, deleted_by = NULL, updated_at = :updated_at WHERE id = :id', [':name' => 'Shopify', ':role' => 'Admin', ':updated_at' => $this->database->nowUtc(), ':id' => self::SYSTEM_USER_ID]);
            }
            return $this->database->fetchOne('SELECT * FROM users WHERE id = :id LIMIT 1', [':id' => self::SYSTEM_USER_ID]) ?? $existing;
        }
        $now = $this->database->nowUtc();
        $this->database->execute(
            'INSERT INTO users (id, name, phone, role, is_system, password_hash, created_at, updated_at)
             VALUES (:id, :name, :phone, :role, 1, :password_hash, :created_at, :updated_at)',
            [':id' => self::SYSTEM_USER_ID, ':name' => 'Shopify', ':phone' => self::SYSTEM_USER_PHONE, ':role' => 'Admin', ':password_hash' => password_hash(bin2hex(random_bytes(32)), PASSWORD_BCRYPT), ':created_at' => $now, ':updated_at' => $now]
        );
        return $this->database->fetchOne('SELECT * FROM users WHERE id = :id LIMIT 1', [':id' => self::SYSTEM_USER_ID]) ?? throw new RuntimeException('Could not create the Shopify system user.');
    }

    private function withSystemUser(array $systemUser, callable $callback): mixed
    {
        $previousAuthorization = $_SERVER['HTTP_AUTHORIZATION'] ?? null;
        $previousAuthorizationAlt = $_SERVER['Authorization'] ?? null;
        $authorization = 'Bearer ' . $this->auth->issueToken($systemUser);
        $_SERVER['HTTP_AUTHORIZATION'] = $authorization; $_SERVER['Authorization'] = $authorization;
        try { return $callback(); }
        finally {
            if ($previousAuthorization !== null) $_SERVER['HTTP_AUTHORIZATION'] = $previousAuthorization; else unset($_SERVER['HTTP_AUTHORIZATION']);
            if ($previousAuthorizationAlt !== null) $_SERVER['Authorization'] = $previousAuthorizationAlt; else unset($_SERVER['Authorization']);
        }
    }

    private function recordImportFailure(array $store, array $order, string $message): void
    {
        $remoteId = $this->legacyId($order['id'] ?? '');
        if ($remoteId === '') return;
        $now = $this->database->nowUtc();
        $this->database->execute(
            'INSERT INTO shopify_order_links (id, store_id, shopify_order_id, shopify_order_number, order_id, status, message, payload_hash, created_at, updated_at)
             VALUES (:id, :store_id, :remote_id, :order_number, NULL, :status, :message, :payload_hash, :created_at, :updated_at)
             ON DUPLICATE KEY UPDATE status = VALUES(status), message = VALUES(message), payload_hash = VALUES(payload_hash), updated_at = VALUES(updated_at)',
            [':id' => $this->uuid4(), ':store_id' => $store['id'], ':remote_id' => $remoteId, ':order_number' => trim((string) ($order['name'] ?? $remoteId)), ':status' => 'failed', ':message' => mb_substr($message, 0, 1000), ':payload_hash' => $this->payloadHash($order), ':created_at' => $now, ':updated_at' => $now]
        );
    }

    private function updateStoreSyncState(string $storeId, string $status, string $message, ?string $kind = null): void
    {
        $now = $this->database->nowUtc();
        $extra = $kind === 'orders' ? ', last_orders_synced_at = :kind_time' : '';
        $bindings = [':last_synced_at' => $now, ':status' => $status, ':message' => mb_substr($message, 0, 1000), ':updated_at' => $now, ':id' => $storeId];
        if ($kind === 'orders') $bindings[':kind_time'] = $now;
        $this->database->execute('UPDATE shopify_stores SET last_synced_at = :last_synced_at, last_sync_status = :status, last_sync_message = :message, updated_at = :updated_at' . $extra . ' WHERE id = :id', $bindings);
    }

    private function requireStore(string $storeId): array
    {
        $this->assertSchema(); $storeId = trim($storeId);
        if ($storeId === '') throw new RuntimeException('Shopify store id is required.');
        $store = $this->database->fetchOne('SELECT * FROM shopify_stores WHERE id = :id LIMIT 1', [':id' => $storeId]);
        if ($store === null) throw new RuntimeException('Shopify store connection not found.');
        return $store;
    }

    private function fetchStoreForResponse(string $storeId): array
    {
        return $this->mapStore($this->requireStore($storeId));
    }

    private function mapStore(array $row): array
    {
        $subscriptions = $this->database->fetchAll('SELECT topic, remote_id FROM shopify_webhook_subscriptions WHERE store_id = :store_id ORDER BY topic', [':store_id' => $row['id']]);
        return [
            'id' => (string) $row['id'], 'storeName' => (string) ($row['store_name'] ?? ''), 'storeUrl' => (string) ($row['store_url'] ?? ''),
            'accessToken' => '', 'apiSecret' => '', 'accessTokenConfigured' => trim((string) ($row['access_token'] ?? '')) !== '',
            'apiSecretConfigured' => trim((string) ($row['api_secret'] ?? ($row['webhook_secret'] ?? ''))) !== '',
            'webhookBaseUrl' => trim((string) ($row['webhook_base_url'] ?? '')) !== '' ? rtrim((string) $row['webhook_base_url'], '/') : $this->inferredWebhookBaseUrl(),
            'webhookId' => $row['webhook_id'] ?? null, 'webhookUrl' => $this->webhookUrl((string) $row['id'], (string) ($row['webhook_base_url'] ?? '')),
            'webhookSubscriptions' => array_map(static fn(array $subscription): array => ['topic' => (string) $subscription['topic'], 'id' => (string) $subscription['remote_id']], $subscriptions),
            'companyPageId' => (string) ($row['company_page_id'] ?? ''), 'enabled' => !empty($row['enabled']),
            'lastSyncedAt' => $this->toIso($row['last_synced_at'] ?? null), 'lastProductsSyncedAt' => $this->toIso($row['last_products_synced_at'] ?? null),
            'lastOrdersSyncedAt' => $this->toIso($row['last_orders_synced_at'] ?? null), 'lastSyncStatus' => $this->nullableString($row['last_sync_status'] ?? null),
            'lastSyncMessage' => $this->nullableString($row['last_sync_message'] ?? null), 'productsSynced' => (int) ($row['products_synced'] ?? 0),
            'ordersSynced' => (int) ($row['orders_synced'] ?? 0), 'createdAt' => $this->toIso($row['created_at'] ?? null), 'updatedAt' => $this->toIso($row['updated_at'] ?? null),
        ];
    }

    private function webhookUrl(string $storeId, string $configuredBaseUrl = ''): string
    {
        $base = $this->normalizeWebhookBaseUrl($configuredBaseUrl);
        if ($base === '') $base = $this->inferredWebhookBaseUrl();
        return rtrim($base, '/') . '/shopify-webhook.php?store=' . rawurlencode($storeId);
    }

    private function inferredWebhookBaseUrl(): string
    {
        $frontendUrl = rtrim(trim((string) ($this->config->get('APP_FRONTEND_URL', '') ?? '')), '/');
        if ($frontendUrl !== '') {
            $path = trim((string) parse_url($frontendUrl, PHP_URL_PATH), '/');
            return preg_match('#(?:^|/)api$#i', $path) === 1 ? $frontendUrl : $frontendUrl . '/api';
        }
        $proto = trim((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
        $scheme = $proto !== '' ? explode(',', $proto)[0] : ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http');
        $forwardedHost = trim((string) ($_SERVER['HTTP_X_FORWARDED_HOST'] ?? ''));
        $host = $forwardedHost !== '' ? explode(',', $forwardedHost)[0] : trim((string) ($_SERVER['HTTP_HOST'] ?? 'localhost'));
        $scriptName = str_replace('\\', '/', (string) ($_SERVER['SCRIPT_NAME'] ?? '/index.php'));
        $directory = trim(str_replace('\\', '/', dirname($scriptName)), '/.');
        return $scheme . '://' . $host . ($directory !== '' ? '/' . $directory : '');
    }

    private function normalizeStoreUrl(string $value): string
    {
        $url = trim($value); if ($url === '') return '';
        if (!preg_match('#^https?://#i', $url)) $url = 'https://' . $url;
        $host = strtolower(trim((string) parse_url($url, PHP_URL_HOST)));
        if ($host === '' || !str_ends_with($host, '.myshopify.com')) return '';
        return 'https://' . $host;
    }

    private function normalizeWebhookBaseUrl(string $value): string
    {
        $url = rtrim(trim($value), '/');
        if ($url === '' || filter_var($url, FILTER_VALIDATE_URL) === false) return '';
        if (strtolower((string) parse_url($url, PHP_URL_SCHEME)) !== 'https') return '';
        if (parse_url($url, PHP_URL_QUERY) !== null || parse_url($url, PHP_URL_FRAGMENT) !== null) return '';
        return $url;
    }

    private function assertPublicWebhookUrl(string $url): void
    {
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        $host = strtolower(trim((string) parse_url($url, PHP_URL_HOST)));
        $local = $host === 'localhost' || str_ends_with($host, '.localhost') || str_ends_with($host, '.local') || str_ends_with($host, '.test');
        $privateIp = filter_var($host, FILTER_VALIDATE_IP) !== false && filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE) === false;
        if ($scheme !== 'https' || $host === '' || $local || $privateIp) throw new ApiException('Shopify webhooks need a public HTTPS MamePilot URL. Enter the production API URL or an HTTPS tunnel and try again.', 422, 'SHOPIFY_PUBLIC_WEBHOOK_URL_REQUIRED');
    }

    private function companyPageExists(string $pageId): bool
    {
        $row = $this->database->fetchOne('SELECT pages FROM company_settings LIMIT 1');
        foreach ($this->normalizeCompanyPages($row['pages'] ?? [], []) as $page) if ((string) ($page['id'] ?? '') === $pageId) return true;
        return false;
    }

    private function formatShopifyAddress(array $address): string
    {
        $parts = [$address['company'] ?? null, $address['address1'] ?? $address['address_1'] ?? null, $address['address2'] ?? $address['address_2'] ?? null, $address['city'] ?? null, $address['province'] ?? $address['province_code'] ?? null, $address['zip'] ?? null, $address['country'] ?? null];
        return implode(', ', array_values(array_filter(array_map(static fn($value): string => trim(strip_tags((string) ($value ?? ''))), $parts), static fn(string $value): bool => $value !== '')));
    }

    private function normalizePhone(string $phone): string
    {
        $digits = preg_replace('/\D+/', '', $phone) ?? '';
        if (str_starts_with($digits, '00')) $digits = substr($digits, 2);
        if (str_starts_with($digits, '880') && strlen($digits) >= 13) $digits = '0' . substr($digits, 3);
        elseif (strlen($digits) === 10 && str_starts_with($digits, '1')) $digits = '0' . $digits;
        return strlen($digits) > 11 ? substr($digits, -10) : $digits;
    }

    protected function money(mixed $value): float
    {
        if (is_numeric($value)) return (float) $value;
        if (!is_array($value)) return 0.0;
        foreach ([['shop_money', 'amount'], ['shopMoney', 'amount'], ['presentment_money', 'amount'], ['presentmentMoney', 'amount']] as [$group, $field]) {
            if (isset($value[$group][$field]) && is_numeric($value[$group][$field])) return (float) $value[$group][$field];
        }
        if (isset($value['amount']) && is_numeric($value['amount'])) return (float) $value['amount'];
        return 0.0;
    }

    private function legacyId(mixed $value): string
    {
        $id = trim((string) ($value ?? ''));
        if ($id === '') return '';
        if (str_starts_with($id, 'gid://')) { $parts = explode('/', $id); return trim((string) end($parts)); }
        return $id;
    }

    private function parseDateOnly(string $value): ?string
    {
        $timestamp = trim($value) !== '' ? strtotime($value) : false;
        return $timestamp === false ? null : gmdate('Y-m-d', $timestamp);
    }

    private function payloadHash(array $payload): string
    {
        return hash('sha256', json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) ?: '');
    }

    private function slugify(string $value): string
    {
        $slug = strtolower(trim($value)); $slug = preg_replace('/[^a-z0-9]+/', '-', $slug) ?? '';
        return trim($slug, '-');
    }

    private function uniqueSlug(string $candidate): ?string
    {
        $base = $candidate !== '' ? mb_substr($candidate, 0, 220) : 'shopify-product';
        $slug = $base; $counter = 1;
        while ($this->database->fetchOne('SELECT id FROM products WHERE slug = :slug LIMIT 1', [':slug' => $slug]) !== null) {
            $counter++; $slug = mb_substr($base, 0, 230) . '-' . $counter;
        }
        return $slug;
    }

    private function assertSchema(): void
    {
        foreach (['shopify_stores', 'shopify_order_links', 'shopify_product_links', 'shopify_webhook_subscriptions', 'shopify_webhook_events'] as $table) {
            if (!$this->tableExists($table)) throw new RuntimeException('Shopify database tables are missing. Run the latest database schema update first.');
        }
        foreach ([['products', 'sku'], ['users', 'is_system'], ['shopify_stores', 'api_secret'], ['shopify_order_links', 'dedupe_key']] as [$table, $column]) {
            if (!$this->columnExists($table, $column)) throw new RuntimeException('Shopify database upgrade is incomplete. Run the latest database schema update first.');
        }
    }
}
