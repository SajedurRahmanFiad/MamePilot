<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

/**
 * The one backend dispatch path shared by HTTP requests and Mame AI action
 * execution. Agent runs pass an Auth context created from the persisted user
 * id; no browser token is copied into a queue payload.
 */
final class BusinessActionDispatcher
{
    private MasterDataApi $master;
    private OperationsApi $operations;
    private CourierApi $courier;
    private DataManagementApi $dataManagement;
    private MetaAdsApi $metaAds;
    private BusinessGrowthApi $businessGrowth;
    private AutoCallApi $autoCall;
    private WhatsAppApi $whatsapp;
    private MessengerApi $messenger;
    private LeadApi $leads;
    private WooCommerceApi $woocommerce;
    private OrderPostCreateEffects $postCreateEffects;

    public function __construct(
        private Database $database,
        private Auth $auth,
        private Config $config,
    ) {
        $featureAccess = new FeatureAccess($database, $auth);
        $this->master = new MasterDataApi($database, $auth, $config);
        $this->operations = new OperationsApi($database, $auth, $config);
        $this->courier = new CourierApi($database, $auth, $config, $this->operations);
        $this->dataManagement = new DataManagementApi($database, $auth, $config);
        $this->metaAds = new MetaAdsApi($database, $auth, $config);
        $this->businessGrowth = new BusinessGrowthApi($database, $auth, $config);
        $this->autoCall = new AutoCallApi($database, $auth, $config);
        $this->whatsapp = new WhatsAppApi($database, $auth, $config);
        $this->messenger = new MessengerApi($database, $auth, $config);
        $this->leads = new LeadApi($database, $auth, $config, $this->master, $this->operations);
        $this->postCreateEffects = new OrderPostCreateEffects($featureAccess, $this->autoCall);
        $this->woocommerce = new WooCommerceApi($database, $auth, $config, $this->operations, $this->postCreateEffects);
    }

    public function master(): MasterDataApi { return $this->master; }
    public function operations(): OperationsApi { return $this->operations; }
    public function metaAds(): MetaAdsApi { return $this->metaAds; }

    /** @return array<string, object> */
    public function services(): array
    {
        return [
            'master' => $this->master,
            'operations' => $this->operations,
            'courier' => $this->courier,
            'dataManagement' => $this->dataManagement,
            'metaAds' => $this->metaAds,
            'businessGrowth' => $this->businessGrowth,
            'autoCall' => $this->autoCall,
            'whatsapp' => $this->whatsapp,
            'messenger' => $this->messenger,
            'leads' => $this->leads,
            'woocommerce' => $this->woocommerce,
        ];
    }

    public function hasAction(string $action): bool
    {
        if ($action === 'createTransfer') return true;
        foreach ($this->services() as $service) if (method_exists($service, $action)) return true;
        return false;
    }

    /** Recheck record-scoped permissions that must pass before side effects. */
    public function assertActionScope(string $action, array $payload = []): void
    {
        if ($this->isCourierSubmission($action)) {
            $orderId = $payload['orderId'] ?? '';
            if ((is_array($orderId) && isset($orderId['$fromStep']))
                || (is_string($orderId) && preg_match('/^\{\{step:\d+:result(?:\.[A-Za-z0-9_.-]+)?\}\}$/', trim($orderId)) === 1)) {
                return;
            }
            $this->operations->assertCanSendOrderToCourier($payload);
        }
    }

    /**
     * Dispatch an existing public service action. ServiceLifecycle and
     * FeatureAccess are deliberately rechecked at execution time.
     *
     * @return mixed
     */
    public function dispatch(string $action, array $payload = []): mixed
    {
        $action = trim($action);
        if ($action === '') {
            throw new RuntimeException('Business action is required.');
        }

        (new ServiceLifecycle($this->database, $this->config))->assertActionAllowed($action);
        (new FeatureAccess($this->database, $this->auth))->assertActionAllowed($action, $payload);
        $this->assertActionScope($action, $payload);

        if ($this->isCourierRead($action)) {
            $payload = $this->hydrateCourierRead($action, $payload);
        }

        $agentCourierOrderId = '';
        if ($this->isCourierSubmission($action) && trim((string) ($payload['orderId'] ?? '')) !== '') {
            $agentCourierOrderId = trim((string) $payload['orderId']);
            $payload = $this->hydrateCourierSubmission($action, $payload, $agentCourierOrderId);
        }

        // Transfers are intentionally a named agent/UI operation while the
        // existing transaction service remains the single source of truth for
        // balances, approvals, and transaction history. Authorization is
        // checked against the transfer capability before selecting that shared
        // implementation.
        if ($action === 'createTransfer') {
            $action = 'createTransaction';
            $payload['type'] = 'Transfer';
            $payload['category'] = trim((string) ($payload['category'] ?? '')) ?: 'Transfer';
            $payload['paymentMethod'] = trim((string) ($payload['paymentMethod'] ?? '')) ?: 'Internal Transfer';
        }

        foreach ($this->services() as $service) {
            if (!method_exists($service, $action)) {
                continue;
            }

            $result = $service->{$action}($payload);
            if ($agentCourierOrderId !== '' && is_array($result) && empty($result['error'])) {
                return $this->finalizeCourierSubmission($action, $agentCourierOrderId, $result);
            }
            if ($action === 'createOrder' && is_array($result)) {
                $this->postCreateEffects->schedule($result);
            }
            return $result;
        }

        throw new RuntimeException('Unknown business action: ' . $action);
    }

    private function isCourierSubmission(string $action): bool
    {
        return in_array($action, [
            'submitCarryBeeOrder', 'submitCarryBeeExchangeOrder', 'submitSteadfastOrder',
            'submitPaperflyOrder', 'submitPaperflyExchangeOrder', 'submitPathaoOrder',
        ], true);
    }

    private function isCourierRead(string $action): bool
    {
        return in_array($action, [
            'fetchCarryBeeStores', 'fetchCarryBeeCities', 'fetchCarryBeeZones',
            'fetchCarryBeeAreas', 'fetchCarryBeeOrderDetails',
            'fetchSteadfastStatusByTrackingCode', 'fetchPaperflyOrderTracking',
            'fetchPathaoOrderInfo',
        ], true);
    }

    /** @return array<string, mixed> */
    private function hydrateCourierRead(string $action, array $payload): array
    {
        $settings = $this->master->fetchCourierSettings();
        $providerSettings = match (true) {
            str_contains($action, 'CarryBee') => (array) ($settings['carryBee'] ?? []),
            str_contains($action, 'Steadfast') => (array) ($settings['steadfast'] ?? []),
            str_contains($action, 'Paperfly') => (array) ($settings['paperfly'] ?? []),
            str_contains($action, 'Pathao') => (array) ($settings['pathao'] ?? []),
            default => [],
        };

        $orderId = trim((string) ($payload['orderId'] ?? ''));
        if ($orderId !== '') {
            $order = $this->operations->fetchOrderById(['id' => $orderId]);
            if (!is_array($order)) throw new RuntimeException('The selected order no longer exists.');
            if ($action === 'fetchCarryBeeOrderDetails') {
                $payload['consignmentId'] = trim((string) ($payload['consignmentId'] ?? $order['carrybeeConsignmentId'] ?? ''));
            } elseif ($action === 'fetchSteadfastStatusByTrackingCode') {
                $payload['trackingCode'] = trim((string) ($payload['trackingCode'] ?? $order['steadfastConsignmentId'] ?? ''));
            } elseif ($action === 'fetchPaperflyOrderTracking') {
                $payload['referenceNumber'] = trim((string) ($payload['referenceNumber'] ?? $order['orderNumber'] ?? $order['paperflyTrackingNumber'] ?? ''));
            } elseif ($action === 'fetchPathaoOrderInfo') {
                $payload['consignmentId'] = trim((string) ($payload['consignmentId'] ?? $order['pathaoConsignmentId'] ?? ''));
            }
        }

        // Provider settings win so a model-supplied value can never replace a
        // developer-managed endpoint, token, key, or secret.
        return array_merge($payload, $providerSettings);
    }

    /** @return array<string, mixed> */
    private function hydrateCourierSubmission(string $action, array $payload, string $orderId): array
    {
        $order = $this->operations->fetchOrderById(['id' => $orderId]);
        if (!is_array($order)) throw new RuntimeException('The selected order no longer exists.');
        $settings = $this->master->fetchCourierSettings();
        $items = is_array($order['items'] ?? null) ? $order['items'] : [];
        $productBrief = implode(', ', array_values(array_filter(array_map(static function ($item): string {
            if (!is_array($item)) return '';
            $name = trim((string) ($item['productName'] ?? $item['name'] ?? 'Product'));
            $quantity = (float) ($item['quantity'] ?? 0);
            return $name . ($quantity > 0 ? ' x ' . rtrim(rtrim(number_format($quantity, 2, '.', ''), '0'), '.') : '');
        }, $items))));
        $common = [
            'recipientName' => trim((string) ($order['customerName'] ?? '')),
            'recipientPhone' => trim((string) ($order['customerPhone'] ?? '')),
            'recipientAddress' => trim((string) ($order['customerAddress'] ?? '')),
        ];

        if ($action === 'submitSteadfastOrder') {
            return array_merge($payload, (array) ($settings['steadfast'] ?? []), $common, [
                'invoice' => (string) ($order['orderNumber'] ?? ''),
                'codAmount' => (float) ($order['total'] ?? 0),
            ]);
        }
        if (in_array($action, ['submitCarryBeeOrder', 'submitCarryBeeExchangeOrder'], true)) {
            $hydrated = array_merge($payload, (array) ($settings['carryBee'] ?? []), $common);
            if ($action === 'submitCarryBeeOrder') {
                $hydrated += [
                    'deliveryType' => 0, 'productType' => 1, 'itemWeight' => 1,
                    'collectableAmount' => (float) ($order['total'] ?? 0),
                ];
            } else {
                $hydrated['consignmentId'] = trim((string) ($payload['consignmentId'] ?? $order['carrybeeConsignmentId'] ?? ''));
                $hydrated += ['collectableAmount' => (float) ($order['total'] ?? 0), 'itemQuantity' => 1];
            }
            return $hydrated;
        }
        if (in_array($action, ['submitPaperflyOrder', 'submitPaperflyExchangeOrder'], true)) {
            $paperfly = (array) ($settings['paperfly'] ?? []);
            $hydrated = array_merge($payload, $paperfly, [
                'merchantOrderReference' => (string) ($order['orderNumber'] ?? ''),
                'storeName' => trim((string) ($payload['storeName'] ?? $paperfly['defaultShopName'] ?? '')),
                'productBrief' => $productBrief,
                'packagePrice' => (string) ((float) ($order['total'] ?? 0)),
                'maxWeightKg' => (string) ((float) ($payload['maxWeightKg'] ?? $paperfly['maxWeightKg'] ?? 0.3)),
                'customerName' => $common['recipientName'],
                'customerAddress' => $common['recipientAddress'],
                'customerPhone' => $common['recipientPhone'],
            ]);
            if ($action === 'submitPaperflyExchangeOrder') {
                $hydrated += ['exchangeDescription' => $productBrief ?: 'Exchange product', 'exchangePrice' => (string) ((float) ($order['total'] ?? 0)), 'exchangeWeightKg' => $hydrated['maxWeightKg']];
            }
            return $hydrated;
        }

        $pathao = (array) ($settings['pathao'] ?? []);
        return array_merge($payload, $pathao, $common, [
            'deliveryType' => (int) ($payload['deliveryType'] ?? $pathao['defaultDeliveryType'] ?? 48),
            'itemType' => (int) ($payload['itemType'] ?? $pathao['defaultItemType'] ?? 2),
            'itemQuantity' => (int) ($payload['itemQuantity'] ?? $pathao['defaultQuantity'] ?? 1),
            'itemWeight' => (float) ($payload['itemWeight'] ?? $pathao['defaultWeight'] ?? 1),
            'amountToCollect' => max(0, round((float) ($order['total'] ?? 0))),
            'specialInstruction' => trim((string) ($payload['specialInstruction'] ?? '')),
        ]);
    }

    /** @return array<string, mixed> */
    private function finalizeCourierSubmission(string $action, string $orderId, array $providerResult): array
    {
        $updates = [];
        if ($action === 'submitSteadfastOrder') {
            $updates['steadfastConsignmentId'] = $this->firstCourierValue($providerResult, ['consignment_id', 'consignmentId']);
            $updates['status'] = 'Courier assigned';
        } elseif ($action === 'submitCarryBeeOrder') {
            $updates['carrybeeConsignmentId'] = $this->firstCourierValue($providerResult, ['consignment_id', 'consignmentId']);
            $updates['status'] = 'Courier assigned';
        } elseif ($action === 'submitCarryBeeExchangeOrder') {
            $updates['exchangeCarrybeeConsignmentId'] = $this->firstCourierValue($providerResult, ['consignment_id', 'consignmentId']);
            $updates['exchangeCourier'] = 'CarryBee';
            $updates['status'] = 'Exchange processing';
        } elseif ($action === 'submitPaperflyOrder') {
            $updates['paperflyTrackingNumber'] = $this->firstCourierValue($providerResult, ['tracking_number', 'trackingNumber']);
            $updates['status'] = 'Courier assigned';
        } elseif ($action === 'submitPaperflyExchangeOrder') {
            $updates['exchangePaperflyTrackingNumber'] = $this->firstCourierValue($providerResult, ['tracking_number', 'trackingNumber']);
            $updates['exchangeCourier'] = 'Paperfly';
            $updates['status'] = 'Exchange processing';
        } elseif ($action === 'submitPathaoOrder') {
            $updates['pathaoConsignmentId'] = $this->firstCourierValue($providerResult, ['consignment_id', 'consignmentId']);
            $updates['status'] = 'Courier assigned';
        }
        $updates = array_filter($updates, static fn($value): bool => $value !== null && $value !== '');
        try {
            $order = $this->operations->updateOrder(['id' => $orderId, 'updates' => $updates]);
            return ['providerSubmitted' => true, 'orderUpdated' => true, 'order' => $order, 'providerResult' => $providerResult];
        } catch (\Throwable $exception) {
            return ['providerSubmitted' => true, 'orderUpdated' => false, 'warning' => 'The courier accepted the request, but the local order update failed: ' . $exception->getMessage(), 'providerResult' => $providerResult];
        }
    }

    private function firstCourierValue(array $payload, array $keys): ?string
    {
        $queue = [$payload];
        while ($queue !== []) {
            $current = array_shift($queue);
            if (!is_array($current)) continue;
            foreach ($keys as $key) {
                $value = trim((string) ($current[$key] ?? ''));
                if ($value !== '') return $value;
            }
            foreach ($current as $value) if (is_array($value)) $queue[] = $value;
        }
        return null;
    }
}
