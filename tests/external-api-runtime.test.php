<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
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
    'vendors.read', 'accounts.read', 'accounts.read_balance',
];
$filtersByResource = [
    'orders' => ['delivery_status' => 'delivered', 'payment_status' => 'unpaid', 'min_amount' => '200', 'max_amount' => '400'],
    'customers' => ['total_orders_min' => '0', 'due_min' => '0'],
    'transactions' => ['type_in' => 'Income,Expense', 'min_amount' => '0'],
    'bills' => ['payment_status' => 'unpaid', 'min_amount' => '0'],
    'vendors' => ['total_purchases_min' => '0', 'payable_min' => '0'],
    'accounts' => ['min_current_balance' => '0'],
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