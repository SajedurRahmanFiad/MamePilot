<?php

declare(strict_types=1);

use App\Auth;
use App\ApiException;
use App\AutoCallApi;
use App\BusinessGrowthApi;
use App\Config;
use App\CourierApi;
use App\Database;
use App\FeatureAccess;
use App\Http;
use App\MasterDataApi;
use App\MetaAdsApi;
use App\OperationsApi;

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
    $metaAds = new MetaAdsApi($database, $auth, $config);
    $businessGrowth = new BusinessGrowthApi($database, $auth, $config);
    $autoCall = new AutoCallApi($database, $auth, $config);

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

    $services = [$master, $operations, $courier, $metaAds, $businessGrowth, $autoCall];
    foreach ($services as $service) {
        if (!method_exists($service, $action)) {
            continue;
        }

        $result = $service->{$action}($payload);
        if ($action === 'createOrder' && is_array($result)) {
            $orderId = trim((string) ($result['id'] ?? ''));
            $orderStatus = trim((string) ($result['status'] ?? ''));
            if ($orderId !== '' && $autoCall->queueOrderIfEligible($orderId, $orderStatus)) {
                register_shutdown_function(static function () use ($autoCall): void {
                    $autoCall->triggerSurveyBackgroundProcess();
                });
            }

            $capabilities = $featureAccess->fetchCapabilities();
            $customerId = trim((string) ($result['customerId'] ?? ''));
            if (!empty($capabilities['grow_your_business']) && $customerId !== '') {
                register_shutdown_function(static function () use ($customerId): void {
                    $script = dirname(__DIR__) . '/bin/process_customer_fraud_check.php';
                    if (!is_file($script)) {
                        return;
                    }

                    $php = PHP_BINARY ?: 'php';
                    if (DIRECTORY_SEPARATOR === '\\') {
                        $command = 'cmd /c start "" /B ' . escapeshellarg($php) . ' ' . escapeshellarg($script) . ' ' . escapeshellarg($customerId) . ' > NUL 2>&1';
                    } else {
                        $command = 'nohup ' . escapeshellarg($php) . ' ' . escapeshellarg($script) . ' ' . escapeshellarg($customerId) . ' > /dev/null 2>&1 &';
                    }

                    if (function_exists('popen')) {
                        $process = @popen($command, 'r');
                        if (is_resource($process)) {
                            @pclose($process);
                        }
                    } elseif (function_exists('shell_exec')) {
                        @shell_exec($command);
                    }
                });
            }
        }
        Http::ok($result);
        exit;
    }

    Http::error(404, 'Unknown action.');
} catch (ApiException $exception) {
    Http::error(
        $exception->httpStatus(),
        $exception->getMessage(),
        array_merge(['code' => $exception->errorCode()], $exception->extra())
    );
} catch (Throwable $exception) {
    $message = $exception->getMessage();
    $status = 500;
    if ($message === 'Authentication required.') {
        $status = 401;
    } elseif ($message === 'Admin access required.') {
        $status = 403;
    }
    Http::error($status, $message . ' [' . $exception->getFile() . ':' . $exception->getLine() . ' | ' . substr($exception->getTraceAsString(), 0, 500) . ']');
}
