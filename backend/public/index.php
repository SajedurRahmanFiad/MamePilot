<?php

declare(strict_types=1);

use App\Auth;
use App\ApiException;
use App\AutoCallApi;
use App\BusinessGrowthApi;
use App\Config;
use App\CourierApi;
use App\Database;
use App\DataManagementApi;
use App\FeatureAccess;
use App\Http;
use App\MasterDataApi;
use App\MetaAdsApi;
use App\MessengerApi;
use App\LeadApi;
use App\OperationsApi;
use App\OrderPostCreateEffects;
use App\WhatsAppApi;
use App\WooCommerceApi;

require_once dirname(__DIR__) . '/bootstrap.php';

if (Http::method() === 'OPTIONS') {
    Http::ok(['ok' => true]);
    exit;
}

try {
    $body = Http::jsonBody();
    $action = trim((string) ($_GET['action'] ?? $body['action'] ?? ''));
    if ($action === '') {
        Http::error(400, 'Missing action.');
        exit;
    }

    $payload = $body;
    unset($payload['action']);
    foreach ($_GET as $key => $value) {
        if ($key === 'action') {
            continue;
        }
        $payload[$key] = $value;
    }

    $config = Config::load(dirname(__DIR__, 2));
    $database = new Database($config);
    $auth = new Auth($config, $database);
    $serviceLifecycle = new \App\ServiceLifecycle($database, $config);
    $featureAccess = new FeatureAccess($database, $auth);
    $master = new MasterDataApi($database, $auth, $config);
    $operations = new OperationsApi($database, $auth, $config);
    $courier = new CourierApi($database, $auth, $config, $operations);
    $dataManagement = new DataManagementApi($database, $auth, $config);
    $metaAds = new MetaAdsApi($database, $auth, $config);
    $whatsapp = new WhatsAppApi($database, $auth, $config);
    $messenger = new MessengerApi($database, $auth, $config);
    $leads = new LeadApi($database, $auth, $config, $master, $operations);
    $businessGrowth = new BusinessGrowthApi($database, $auth, $config);
    $autoCall = new AutoCallApi($database, $auth, $config);
    $postCreateEffects = new OrderPostCreateEffects($featureAccess, $autoCall);
    $woocommerce = new WooCommerceApi($database, $auth, $config, $operations, $postCreateEffects);

    if ($action === 'health') {
        Http::ok([
            'ok' => true,
            'time' => gmdate('c'),
            'db' => $database->fetchOne('SELECT 1 AS ok'),
        ]);
        exit;
    }

    if ($action === 'metaAdsOAuthCallback') {
        $metaAds->redirectAfterOAuth($payload);
        exit;
    }

    // Central notification delivery must remain reachable during maintenance or
    // subscription read-only mode. The endpoint authenticates the raw payload
    // with its per-deployment HMAC secret before writing anything.
    if ($action === 'receiveCentralNotification') {
        Http::ok($master->receiveCentralNotification($payload));
        exit;
    }

    $serviceLifecycle->assertActionAllowed($action);
    $featureAccess->assertActionAllowed($action, $payload);

    if ($action === 'batchUpdateSettings') {
        $updates = is_array($payload['updates'] ?? null) ? $payload['updates'] : $payload;
        if (isset($updates['courier']) && is_array($updates['courier'])) {
            $featureAccess->assertActionAllowed('updateCourierSettings', $updates['courier']);
        }
        if (isset($updates['permissions'])) {
            $featureAccess->assertActionAllowed('updatePermissionsSettings', []);
        }
        $walletPayload = $updates['wallet'] ?? (isset($updates['payroll']) ? [
            'unitAmount' => $updates['payroll']['unitAmount'] ?? null,
            'countedStatuses' => $updates['payroll']['countedStatuses'] ?? null,
        ] : null);

        Http::ok([
            'company' => isset($updates['company']) ? $master->updateCompanySettings($updates['company']) : $master->fetchCompanySettings(),
            'order' => isset($updates['order']) ? $master->updateOrderSettings($updates['order']) : $master->fetchOrderSettings(),
            'invoice' => isset($updates['invoice']) ? $master->updateInvoiceSettings($updates['invoice']) : $master->fetchInvoiceSettings(),
            'defaults' => isset($updates['defaults']) ? $master->updateSystemDefaults($updates['defaults']) : $master->fetchSystemDefaults(),
            'courier' => isset($updates['courier']) ? $master->updateCourierSettings($updates['courier']) : $master->fetchCourierSettings(),
            'permissions' => isset($updates['permissions']) ? $master->updatePermissionsSettings($updates['permissions']) : $master->fetchPermissionsSettings(),
            'wallet' => $walletPayload !== null ? $operations->updateWalletSettings($walletPayload) : $operations->fetchWalletSettings(),
        ]);
        exit;
    }

    $services = [$master, $operations, $courier, $dataManagement, $metaAds, $businessGrowth, $autoCall, $whatsapp, $messenger, $leads, $woocommerce];
    foreach ($services as $service) {
        if (!method_exists($service, $action)) {
            continue;
        }

        $result = $service->{$action}($payload);
        if ($action === 'createOrder' && is_array($result)) {
            $postCreateEffects->schedule($result);
        }
        Http::ok($result);
        exit;
    }

    Http::error(404, 'Unknown action.');
} catch (ApiException $exception) {
    Http::error(
        $exception->httpStatus(),
        Http::safeErrorMessage($exception->getMessage()),
        array_merge(['code' => $exception->errorCode()], $exception->extra())
    );
} catch (Throwable $exception) {
    Http::unexpectedError($exception);
}
