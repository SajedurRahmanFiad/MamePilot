<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;

function performanceReportAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function performanceReportAssertMoney(float $actual, float $expected, string $message): void
{
    performanceReportAssert(
        abs($actual - $expected) < 0.005,
        $message . " (expected {$expected}, got {$actual})"
    );
}

$root = dirname(__DIR__);
$config = Config::load($root);
$database = new Database($config);
$auth = new Auth($config, $database);
$api = new OperationsApi($database, $auth, $config);
$pdo = $database->connect();

$actor = $database->fetchOne(
    "SELECT id, name, phone, role
     FROM users
     WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL
     ORDER BY CASE WHEN role = 'Admin' THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1"
);
if ($actor === null) {
    throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
}
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

$stamp = strtolower(str_replace('.', '', uniqid('perf-report-', true)));
$customerId = substr('customer-' . $stamp, 0, 64);
$productAId = substr('product-a-' . $stamp, 0, 64);
$productBId = substr('product-b-' . $stamp, 0, 64);
$productCId = substr('product-c-' . $stamp, 0, 64);
$productAName = 'Performance Product A ' . $stamp;
$productBName = 'Performance Product B ' . $stamp;
$productCName = 'Performance Product C ' . $stamp;
$date = '2037-11-17';
$createdAt = '2037-11-17 06:00:00';
$params = [
    'filterRange' => 'Custom',
    'customDates' => ['from' => $date, 'to' => $date],
];

$pdo->beginTransaction();
try {
    $database->execute(
        'INSERT INTO customers (id, name, phone, address, total_orders, due_amount, created_by, created_at, updated_at)
         VALUES (:id, :name, :phone, :address, 0, 0, :created_by, :created_at, :updated_at)',
        [
            ':id' => $customerId,
            ':name' => 'Performance Customer ' . $stamp,
            ':phone' => '01700000000',
            ':address' => 'Performance fixture',
            ':created_by' => $actor['id'],
            ':created_at' => $createdAt,
            ':updated_at' => $createdAt,
        ]
    );

    $nextOrderSeq = (int) (($database->fetchOne(
        'SELECT COALESCE(MAX(order_seq), 0) + 1 AS seq FROM orders'
    ) ?? [])['seq'] ?? 1);
    $orderIds = [];
    $insertOrder = static function (
        string $suffix,
        string $status,
        string $items,
        float $discount,
        float $total
    ) use (
        $database,
        $actor,
        $customerId,
        $stamp,
        $date,
        $createdAt,
        $nextOrderSeq,
        &$orderIds
    ): void {
        $index = count($orderIds);
        $id = substr('order-' . $suffix . '-' . $stamp, 0, 64);
        $orderIds[] = $id;
        $database->execute(
            'INSERT INTO orders (
                id, order_number, order_seq, order_date, customer_id, created_by,
                status, items, subtotal, discount, total, history, created_at, updated_at
             ) VALUES (
                :id, :order_number, :order_seq, :order_date, :customer_id, :created_by,
                :status, :items, :subtotal, :discount, :total, :history, :created_at, :updated_at
             )',
            [
                ':id' => $id,
                ':order_number' => 'PERF-' . strtoupper($suffix) . '-' . $stamp,
                ':order_seq' => $nextOrderSeq + $index,
                ':order_date' => $date,
                ':customer_id' => $customerId,
                ':created_by' => $actor['id'],
                ':status' => $status,
                ':items' => $items,
                ':subtotal' => $total + $discount,
                ':discount' => $discount,
                ':total' => $total,
                ':history' => '{}',
                ':created_at' => $createdAt,
                ':updated_at' => $createdAt,
            ]
        );
    };

    $insertOrder('completed-one', 'Completed', json_encode([
        ['productId' => $productAId, 'productName' => $productAName, 'quantity' => 2, 'amount' => 200],
        ['productId' => $productBId, 'productName' => $productBName, 'quantity' => 1, 'amount' => 50],
    ], JSON_THROW_ON_ERROR), 25, 225);
    $insertOrder('completed-two', 'Completed', json_encode([
        ['productId' => $productAId, 'productName' => $productAName, 'quantity' => 3, 'amount' => 300],
    ], JSON_THROW_ON_ERROR), 30, 270);
    $insertOrder('completed-empty', 'Completed', '[]', 0, 10);
    $insertOrder('completed-invalid', 'Completed', 'not-json', 0, 0);
    $insertOrder('exchange-delivered', 'Exchange delivered', json_encode([
        ['productId' => $productCId, 'productName' => $productCName, 'quantity' => 4, 'amount' => 80],
    ], JSON_THROW_ON_ERROR), 0, 80);

    // Execute the exact production projection helpers directly. This ensures a
    // passing public report cannot hide a SQL syntax failure behind its legacy
    // PHP fallback on MariaDB 10.4.
    $joinMethod = new ReflectionMethod($api, 'orderItemsSequenceJoin');
    $joinMethod->setAccessible(true);
    $valueMethod = new ReflectionMethod($api, 'orderItemJsonValue');
    $valueMethod->setAccessible(true);
    $joinSql = $joinMethod->invoke($api, 'o', 'runtime_item_seq');
    $quantitySql = $valueMethod->invoke($api, 'o', 'runtime_item_seq', 'quantity');
    $placeholders = [];
    $bindings = [];
    foreach ($orderIds as $index => $orderId) {
        $placeholder = ':order_' . $index;
        $placeholders[] = $placeholder;
        $bindings[$placeholder] = $orderId;
    }
    $projection = $database->fetchOne(
        'SELECT COALESCE(SUM(CAST(COALESCE(NULLIF(' . $quantitySql . ', \'\'), \'0\') AS DECIMAL(18,4))), 0) AS quantity
         FROM orders o
         INNER JOIN ' . $joinSql . '
         WHERE o.id IN (' . implode(', ', $placeholders) . ')',
        $bindings
    ) ?? [];
    performanceReportAssertMoney((float) ($projection['quantity'] ?? 0), 10, 'MariaDB sequence projection quantity');

    $productReport = $api->fetchProductQuantitySoldReport($params);
    $productRows = [];
    foreach ($productReport['rows'] ?? [] as $row) {
        $productRows[(string) ($row['productName'] ?? '')] = $row;
    }
    performanceReportAssert(isset($productRows[$productAName]), 'Product A is missing from quantity-sold report.');
    performanceReportAssert(isset($productRows[$productBName]), 'Product B is missing from quantity-sold report.');
    performanceReportAssertMoney((float) $productRows[$productAName]['quantity'], 5, 'Product A quantity');
    performanceReportAssertMoney((float) $productRows[$productAName]['revenue'], 450, 'Product A discounted revenue');
    performanceReportAssertMoney((float) $productRows[$productBName]['quantity'], 1, 'Product B quantity');
    performanceReportAssertMoney((float) $productRows[$productBName]['revenue'], 45, 'Product B discounted revenue');
    performanceReportAssertMoney((float) ($productReport['totalQty'] ?? 0), 6, 'Completed-product total quantity');

    $customerReport = $api->fetchCustomerSalesReport($params);
    $customerRow = $customerReport['rows'][0] ?? [];
    performanceReportAssert((int) ($customerRow['orders'] ?? 0) === 4, 'Customer order count must include empty and invalid legacy item payloads.');
    performanceReportAssertMoney((float) ($customerRow['quantity'] ?? 0), 6, 'Customer item quantity');
    performanceReportAssertMoney((float) ($customerRow['amount'] ?? 0), 505, 'Customer sales total');

    $profitLoss = $api->fetchProfitLossReport($params);
    performanceReportAssert((int) ($profitLoss['orderCount'] ?? 0) === 5, 'Profit/Loss order count');
    performanceReportAssertMoney((float) ($profitLoss['productsSold'] ?? 0), 10, 'Profit/Loss products sold');

    $dashboard = $api->fetchDashboardSnapshot($params);
    $topProducts = $dashboard['admin']['topSoldProducts'] ?? [];
    $topProductA = null;
    foreach ($topProducts as $row) {
        if (($row['name'] ?? '') === $productAName) {
            $topProductA = $row;
            break;
        }
    }
    performanceReportAssert(is_array($topProductA), 'Dashboard top-product projection omitted Product A.');
    performanceReportAssert((int) ($topProductA['qty'] ?? 0) === 5, 'Dashboard top-product quantity');

    echo "MariaDB set-based performance report projections passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
