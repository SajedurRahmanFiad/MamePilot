<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/bootstrap.php';

use App\Auth;
use App\Config;
use App\CourierApi;
use App\Database;
use App\OperationsApi;

$customerId = trim((string) ($argv[1] ?? ''));
if ($customerId === '') {
    fwrite(STDERR, "Customer ID is required.\n");
    exit(1);
}

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$auth = new Auth($config, $database);
$operations = new OperationsApi($database, $auth, $config);
$courier = new CourierApi($database, $auth, $config, $operations);

try {
    $result = $courier->processCustomerFraudCheck(['customerId' => $customerId]);
    echo json_encode(['success' => true, 'percentage' => $result['summary']['successRatio'] ?? 0]) . "\n";
} catch (Throwable $exception) {
    fwrite(STDERR, $exception->getMessage() . "\n");
    exit(1);
}
