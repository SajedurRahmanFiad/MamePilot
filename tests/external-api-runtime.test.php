<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\ApiException;
use App\Config;
use App\Database;
use App\ExternalApiKeyService;
use App\ExternalDataApi;

function externalApiRuntimeAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$previousPepper = $_ENV['APP_API_KEY_PEPPER'] ?? null;
$_ENV['APP_API_KEY_PEPPER'] = str_repeat('external-api-test-pepper-', 2);
$config = Config::load(dirname(__DIR__));
if ($previousPepper === null) {
    unset($_ENV['APP_API_KEY_PEPPER']);
} else {
    $_ENV['APP_API_KEY_PEPPER'] = $previousPepper;
}

$database = new Database($config);
try {
    $developer = $database->fetchOne(
        "SELECT id, name, phone, role FROM users WHERE role = 'Developer' AND deleted_at IS NULL LIMIT 1"
    );
} catch (\PDOException $exception) {
    if ((int) ($exception->errorInfo[1] ?? 0) === 2002) {
        echo "External API runtime test skipped: local MariaDB is unavailable.\n";
        exit(0);
    }
    throw $exception;
}
if ($developer === null) {
    echo "External API runtime test skipped: no active Developer user is available.\n";
    exit(0);
}

$auth = new Auth($config, $database);
$previousAuthorization = $_SERVER['HTTP_AUTHORIZATION'] ?? null;
$sessionToken = $auth->issueToken($developer);
$scopes = [
    'orders.read', 'customers.read', 'transactions.read', 'bills.read',
    'vendors.read', 'accounts.read', 'accounts.read_balance', 'products.read',
];
$filtersByResource = [
    'orders' => ['delivery_status' => 'delivered', 'payment_status' => 'unpaid', 'min_amount' => '200', 'max_amount' => '400'],
    'customers' => ['total_orders_min' => '0', 'due_min' => '0'],
    'transactions' => ['type_in' => 'Income,Expense', 'min_amount' => '0'],
    'bills' => ['payment_status' => 'unpaid', 'min_amount' => '0'],
    'vendors' => ['total_purchases_min' => '0', 'payable_min' => '0'],
    'accounts' => ['min_current_balance' => '0'],
    'products' => ['min_sale_price' => '0', 'max_stock' => '100'],
];

try {
    try {
        $database->transaction(function () use ($database, $config, $auth, $sessionToken, $scopes, $filtersByResource): void {
            $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $sessionToken;
            $keyService = new ExternalApiKeyService($database, $auth, $config);
            $createdKey = $keyService->handleManagementRequest('POST', null, [
                'label' => 'Temporary external API runtime test',
                'scopes' => $scopes,
            ]);
            $secret = (string) ($createdKey['api_key'] ?? '');
            externalApiRuntimeAssert(str_starts_with($secret, 'mp_live_'), 'Key creation must return a one-time API secret.');

            $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $secret;
            $api = new ExternalDataApi($database, $auth, $config);
            try {
                $api->handleRequest('POST', '/api/v1/orders', [], ['unexpected' => 'value']);
                throw new RuntimeException('Read-only key unexpectedly passed a write request.');
            } catch (ApiException $exception) {
                externalApiRuntimeAssert($exception->httpStatus() === 403, 'A read-only key must not pass a write-scope check.');
            }

            $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $sessionToken;
            $writeKey = $keyService->handleManagementRequest('POST', null, [
                'label' => 'Temporary external API write-scope test',
                'scopes' => ['orders.create'],
            ]);
            $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . (string) ($writeKey['api_key'] ?? '');
            try {
                $api->handleRequest('POST', '/api/v1/orders', [], ['unexpected' => 'value']);
                throw new RuntimeException('Write payload unexpectedly accepted an unknown field.');
            } catch (ApiException $exception) {
                externalApiRuntimeAssert($exception->httpStatus() === 422, 'A granted write scope should reach strict payload validation.');
            }
            try {
                $api->handleRequest('PATCH', '/api/v1/orders/test-order', [], ['status' => 'On Hold']);
                throw new RuntimeException('Create scope unexpectedly authorized an update request.');
            } catch (ApiException $exception) {
                externalApiRuntimeAssert($exception->httpStatus() === 403, 'Create and update scopes must be independent.');
            }
            try {
                $api->handleRequest('POST', '/api/v1/orders', [], [
                    'customerId' => 'test-customer',
                    'items' => [['productId' => 'test-product']],
                    'orderDate' => '2026-99-31',
                ]);
                throw new RuntimeException('Malformed order date was unexpectedly accepted.');
            } catch (ApiException $exception) {
                externalApiRuntimeAssert($exception->httpStatus() === 422, 'Malformed order dates must be rejected.');
            }
            try {
                $api->handleRequest('POST', '/api/v1/transactions', [], []);
                throw new RuntimeException('Transaction writes are not supported.');
            } catch (ApiException $exception) {
                externalApiRuntimeAssert($exception->httpStatus() === 405, 'Transactions must remain read-only.');
            }

            $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $sessionToken;
            $contactKey = $keyService->handleManagementRequest('POST', null, [
                'label' => 'Temporary external API contact write test',
                'scopes' => [
                    'customers.create', 'customers.update', 'customers.delete',
                    'vendors.create', 'vendors.update', 'vendors.delete',
                ],
            ]);
            $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . (string) ($contactKey['api_key'] ?? '');
            $contactPhone = 'api-test-' . bin2hex(random_bytes(6));
            $createdCustomer = $api->handleRequest('POST', '/api/v1/customers', [], [
                'name' => 'External API runtime test',
                'phone' => $contactPhone,
                'address' => 'Before update',
            ]);
            externalApiRuntimeAssert(($createdCustomer['status'] ?? 0) === 201, 'Customer creation did not return HTTP 201.');
            $customerId = (string) ($createdCustomer['body']['data']['id'] ?? '');
            externalApiRuntimeAssert($customerId !== '', 'Customer creation did not return a record ID.');
            $updatedCustomer = $api->handleRequest('PATCH', '/api/v1/customers/' . $customerId, [], ['address' => 'After update']);
            externalApiRuntimeAssert(($updatedCustomer['status'] ?? 0) === 200, 'Customer update did not return HTTP 200.');
            $deletedCustomer = $api->handleRequest('DELETE', '/api/v1/customers/' . $customerId, [], []);
            externalApiRuntimeAssert(($deletedCustomer['body']['data']['deleted'] ?? false) === true, 'Customer delete did not return a soft-delete confirmation.');

            $createdVendor = $api->handleRequest('POST', '/api/v1/vendors', [], [
                'name' => 'External API runtime test',
                'phone' => 'api-test-' . bin2hex(random_bytes(6)),
                'address' => 'Before update',
            ]);
            externalApiRuntimeAssert(($createdVendor['status'] ?? 0) === 201, 'Vendor creation did not return HTTP 201.');
            $vendorId = (string) ($createdVendor['body']['data']['id'] ?? '');
            externalApiRuntimeAssert($vendorId !== '', 'Vendor creation did not return a record ID.');
            $updatedVendor = $api->handleRequest('PATCH', '/api/v1/vendors/' . $vendorId, [], ['address' => 'After update']);
            externalApiRuntimeAssert(($updatedVendor['status'] ?? 0) === 200, 'Vendor update did not return HTTP 200.');
            $deletedVendor = $api->handleRequest('DELETE', '/api/v1/vendors/' . $vendorId, [], []);
            externalApiRuntimeAssert(($deletedVendor['body']['data']['deleted'] ?? false) === true, 'Vendor delete did not return a soft-delete confirmation.');

            $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $sessionToken;
            $productKey = $keyService->handleManagementRequest('POST', null, [
                'label' => 'Temporary external API product write test',
                'scopes' => ['products.read', 'products.create', 'products.update', 'products.delete'],
            ]);
            $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . (string) ($productKey['api_key'] ?? '');
            $productSku = 'EXT-API-' . strtoupper(bin2hex(random_bytes(6)));
            $createdProduct = $api->handleRequest('POST', '/api/v1/products', [], [
                'name' => 'External API runtime product ' . bin2hex(random_bytes(4)),
                'sku' => $productSku,
                'category' => 'API test',
                'salePrice' => 12.5,
                'purchasePrice' => 7.25,
                'stock' => 0,
            ]);
            externalApiRuntimeAssert(($createdProduct['status'] ?? 0) === 201, 'Product creation did not return HTTP 201.');
            $productId = (string) ($createdProduct['body']['data']['id'] ?? '');
            externalApiRuntimeAssert($productId !== '', 'Product creation did not return a record ID.');
            $productRead = $api->handleRequest('GET', '/api/v1/products/' . $productId, [], []);
            externalApiRuntimeAssert(($productRead['body']['data']['sku'] ?? '') === $productSku, 'Product read did not return the created SKU.');
            externalApiRuntimeAssert(!array_key_exists('image', $productRead['body']['data'] ?? []), 'Product reads must not expose stored image paths.');
            $productUpdate = $api->handleRequest('PATCH', '/api/v1/products/' . $productId, [], ['salePrice' => 15.75]);
            externalApiRuntimeAssert(($productUpdate['status'] ?? 0) === 200, 'Product update did not return HTTP 200.');
            $productList = $api->handleRequest('GET', '/api/v1/products', ['sku' => $productSku, 'page_size' => '1'], []);
            externalApiRuntimeAssert(count($productList['body']['data'] ?? []) === 1, 'Product filters did not find the created SKU.');
            $deletedProduct = $api->handleRequest('DELETE', '/api/v1/products/' . $productId, [], []);
            externalApiRuntimeAssert(($deletedProduct['body']['data']['deleted'] ?? false) === true, 'Product delete did not return a soft-delete confirmation.');

            $_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $secret;
            foreach ($filtersByResource as $resource => $filters) {
                $response = $api->handleRequest('GET', '/api/v1/' . $resource, $filters + ['page_size' => '1'], []);
                externalApiRuntimeAssert(($response['status'] ?? 0) === 200, $resource . ' collection did not return HTTP 200.');
                externalApiRuntimeAssert(isset($response['body']['data'], $response['body']['pagination']), $resource . ' did not return the collection envelope.');
                externalApiRuntimeAssert(count($response['body']['data']) <= 1, $resource . ' exceeded its requested page size.');
            }

            throw new RuntimeException('__external_api_test_rollback__');
        });
    } catch (RuntimeException $exception) {
        if ($exception->getMessage() !== '__external_api_test_rollback__') {
            throw $exception;
        }
    }
} finally {
    if ($previousAuthorization === null) {
        unset($_SERVER['HTTP_AUTHORIZATION']);
    } else {
        $_SERVER['HTTP_AUTHORIZATION'] = $previousAuthorization;
    }
}

echo "External API runtime tests passed; temporary database writes were rolled back.\n";