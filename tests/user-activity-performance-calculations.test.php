<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\OperationsApi;

$reflection = new ReflectionClass(OperationsApi::class);
$api = $reflection->newInstanceWithoutConstructor();
$invoke = static function (string $method, array $arguments = []) use ($reflection, $api) {
    return $reflection->getMethod($method)->invokeArgs($api, $arguments);
};

$quantity = $invoke('sumUserActivityItemsQuantity', [[
    ['quantity' => 1.5],
    ['quantity' => '2.25'],
    ['quantity' => 'not-a-number'],
]]);
if (abs((float) $quantity - 3.75) > 0.0001) {
    throw new RuntimeException('Fractional order quantities are not preserved.');
}

$summary = $invoke('mapUserActivityPerformanceSummary', [[
    'id' => 'metric-test-user',
    'name' => 'Metric Test User',
    'phone' => '01000000000',
    'role' => 'Employee',
    'image' => '',
    'ordersCreated' => 4,
    'completedOrders' => 2,
    'processingOrders' => 0,
    'pickedOrders' => 0,
    'onHoldOrders' => 0,
    'returnedOrders' => 1,
    'cancelledOrders' => 1,
    'orderValue' => 1000,
    'completedOrderValue' => 600,
    'orderPaidAmount' => 400,
    'uniqueCustomers' => 3,
    'billsCreated' => 2,
    'billValue' => 500,
    'billPaidAmount' => 125,
    'uniqueVendors' => 2,
    'transactionsCreated' => 3,
    'incomeTransactions' => 1,
    'incomeAmount' => 400,
    'expenseTransactions' => 1,
    'expenseAmount' => 100,
    'transferTransactions' => 1,
    'transferAmount' => 50,
    'totalActivities' => 9,
], [
    'activeDays' => 2,
    'orderQuantity' => 3.75,
    'firstActivity' => '2026-07-22T01:00:00Z',
    'lastActivity' => '2026-07-23T01:00:00Z',
]]);
$metrics = $summary['metrics'] ?? [];
$expected = [
    'averageOrderValue' => 250.0,
    'completionRate' => 50.0,
    'collectionRate' => 40.0,
    'billSettlementRate' => 25.0,
    'orderQuantity' => 3.75,
];
foreach ($expected as $key => $value) {
    if (abs((float) ($metrics[$key] ?? -1) - $value) > 0.0001) {
        throw new RuntimeException("{$key} is calculated incorrectly.");
    }
}
if (($metrics['returnedOrders'] ?? null) !== 1 || ($metrics['cancelledOrders'] ?? null) !== 1) {
    throw new RuntimeException('Returned and cancelled order groups were not mapped correctly.');
}

$source = file_get_contents(dirname(__DIR__) . '/backend/src/OperationsApi.php');
foreach ([
    "o.status IN ('On Hold', 'Created')",
    "o.status IN ('Returned', 'Exchange returned')",
    "o.status IN ('Cancelled', 'Exchange cancelled')",
] as $statusGrouping) {
    if (!is_string($source) || !str_contains($source, $statusGrouping)) {
        throw new RuntimeException('The report SQL is missing a complete order status group.');
    }
}

echo "User activity performance calculation checks passed.\n";
