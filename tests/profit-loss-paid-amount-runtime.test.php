<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;

function profitLossPaidAmountAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function profitLossPaidAmountAssertMoney(float $actual, float $expected, string $message): void
{
    profitLossPaidAmountAssert(
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
    "SELECT id, name, phone, role FROM users WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1"
);
if ($actor === null) {
    throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
}
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

$stamp = strtolower(str_replace('.', '', uniqid('pl-paid-', true)));
$customerId = substr('customer-paid-' . $stamp, 0, 64);
$vendorId = substr('vendor-paid-' . $stamp, 0, 64);
$date = '2037-12-10';
$createdAt = '2037-12-10 09:00:00';

$pdo->beginTransaction();
try {
    $database->execute(
        'INSERT INTO customers (id, name, phone, address, total_orders, due_amount, created_by, created_at, updated_at)
         VALUES (:id, :name, :phone, :address, 0, 0, :created_by, :created_at, :updated_at)',
        [
            ':id' => $customerId,
            ':name' => 'Paid Amount Customer ' . $stamp,
            ':phone' => '01700000001',
            ':address' => 'Paid amount fixture',
            ':created_by' => $actor['id'],
            ':created_at' => $createdAt,
            ':updated_at' => $createdAt,
        ]
    );

    $database->execute(
        'INSERT INTO vendors (id, name, phone, address, total_purchases, due_amount, created_by, created_at, updated_at)
         VALUES (:id, :name, :phone, :address, 0, 0, :created_by, :created_at, :updated_at)',
        [
            ':id' => $vendorId,
            ':name' => 'Paid Amount Vendor ' . $stamp,
            ':phone' => '01700000002',
            ':address' => 'Paid amount vendor fixture',
            ':created_by' => $actor['id'],
            ':created_at' => $createdAt,
            ':updated_at' => $createdAt,
        ]
    );

    $nextOrderSeq = (int) (($database->fetchOne(
        'SELECT COALESCE(MAX(order_seq), 0) + 1 AS seq FROM orders'
    ) ?? [])['seq'] ?? 1);

    $database->execute(
        'INSERT INTO orders (
            id, order_number, order_seq, order_date, customer_id, created_by,
            status, items, subtotal, discount, shipping, total, paid_amount, history, created_at, updated_at
         ) VALUES (
            :id, :order_number, :order_seq, :order_date, :customer_id, :created_by,
            :status, :items, :subtotal, :discount, :shipping, :total, :paid_amount, :history, :created_at, :updated_at
         )',
        [
            ':id' => substr('order-paid-1-' . $stamp, 0, 64),
            ':order_number' => 'PAID-1-' . $stamp,
            ':order_seq' => $nextOrderSeq,
            ':order_date' => $date,
            ':customer_id' => $customerId,
            ':created_by' => $actor['id'],
            ':status' => 'Completed',
            ':items' => '[]',
            ':subtotal' => 1000,
            ':discount' => 0,
            ':shipping' => 0,
            ':total' => 1000,
            ':paid_amount' => 600,
            ':history' => '{}',
            ':created_at' => $createdAt,
            ':updated_at' => $createdAt,
        ]
    );

    $database->execute(
        'INSERT INTO orders (
            id, order_number, order_seq, order_date, customer_id, created_by,
            status, items, subtotal, discount, shipping, total, paid_amount, history, created_at, updated_at
         ) VALUES (
            :id, :order_number, :order_seq, :order_date, :customer_id, :created_by,
            :status, :items, :subtotal, :discount, :shipping, :total, :paid_amount, :history, :created_at, :updated_at
         )',
        [
            ':id' => substr('order-paid-2-' . $stamp, 0, 64),
            ':order_number' => 'PAID-2-' . $stamp,
            ':order_seq' => $nextOrderSeq + 1,
            ':order_date' => $date,
            ':customer_id' => $customerId,
            ':created_by' => $actor['id'],
            ':status' => 'Completed',
            ':items' => '[]',
            ':subtotal' => 500,
            ':discount' => 0,
            ':shipping' => 0,
            ':total' => 500,
            ':paid_amount' => 0,
            ':history' => '{}',
            ':created_at' => $createdAt,
            ':updated_at' => $createdAt,
        ]
    );

    $database->execute(
        'INSERT INTO orders (
            id, order_number, order_seq, order_date, customer_id, created_by,
            status, items, subtotal, discount, shipping, total, paid_amount, history, created_at, updated_at
         ) VALUES (
            :id, :order_number, :order_seq, :order_date, :customer_id, :created_by,
            :status, :items, :subtotal, :discount, :shipping, :total, :paid_amount, :history, :created_at, :updated_at
         )',
        [
            ':id' => substr('order-paid-3-' . $stamp, 0, 64),
            ':order_number' => 'PAID-3-' . $stamp,
            ':order_seq' => $nextOrderSeq + 2,
            ':order_date' => $date,
            ':customer_id' => $customerId,
            ':created_by' => $actor['id'],
            ':status' => 'Exchange delivered',
            ':items' => '[]',
            ':subtotal' => 300,
            ':discount' => 0,
            ':shipping' => 0,
            ':total' => 300,
            ':paid_amount' => 100,
            ':history' => '{}',
            ':created_at' => $createdAt,
            ':updated_at' => $createdAt,
        ]
    );

    $nextBillSeq = (int) (($database->fetchOne(
        'SELECT COALESCE(MAX(bill_seq), 0) + 1 AS seq FROM bills'
    ) ?? [])['seq'] ?? 1);

    $database->execute(
        'INSERT INTO bills (
            id, bill_number, bill_seq, bill_date, vendor_id, created_by,
            status, items, subtotal, discount, shipping, total, paid_amount, history, created_at, updated_at
         ) VALUES (
            :id, :bill_number, :bill_seq, :bill_date, :vendor_id, :created_by,
            :status, :items, :subtotal, :discount, :shipping, :total, :paid_amount, :history, :created_at, :updated_at
         )',
        [
            ':id' => substr('bill-paid-1-' . $stamp, 0, 64),
            ':bill_number' => 'BILL-1-' . $stamp,
            ':bill_seq' => $nextBillSeq,
            ':bill_date' => $date,
            ':vendor_id' => $vendorId,
            ':created_by' => $actor['id'],
            ':status' => 'Paid',
            ':items' => '[]',
            ':subtotal' => 400,
            ':discount' => 0,
            ':shipping' => 0,
            ':total' => 400,
            ':paid_amount' => 200,
            ':history' => '{}',
            ':created_at' => $createdAt,
            ':updated_at' => $createdAt,
        ]
    );

    $database->execute(
        'INSERT INTO bills (
            id, bill_number, bill_seq, bill_date, vendor_id, created_by,
            status, items, subtotal, discount, shipping, total, paid_amount, history, created_at, updated_at
         ) VALUES (
            :id, :bill_number, :bill_seq, :bill_date, :vendor_id, :created_by,
            :status, :items, :subtotal, :discount, :shipping, :total, :paid_amount, :history, :created_at, :updated_at
         )',
        [
            ':id' => substr('bill-paid-2-' . $stamp, 0, 64),
            ':bill_number' => 'BILL-2-' . $stamp,
            ':bill_seq' => $nextBillSeq + 1,
            ':bill_date' => $date,
            ':vendor_id' => $vendorId,
            ':created_by' => $actor['id'],
            ':status' => 'Processing',
            ':items' => '[]',
            ':subtotal' => 300,
            ':discount' => 0,
            ':shipping' => 0,
            ':total' => 300,
            ':paid_amount' => 0,
            ':history' => '{}',
            ':created_at' => $createdAt,
            ':updated_at' => $createdAt,
        ]
    );

    $profitLoss = $api->fetchProfitLossReport([
        'filterRange' => 'Custom',
        'customDates' => ['from' => $date, 'to' => $date],
    ]);

    profitLossPaidAmountAssertMoney((float) ($profitLoss['grossSales'] ?? 0), 700, 'Gross sales should use paid order amounts only');
    profitLossPaidAmountAssertMoney((float) ($profitLoss['costOfPurchases'] ?? 0), 200, 'COGS should use paid bill amounts only');
    profitLossPaidAmountAssertMoney((float) ($profitLoss['grossProfit'] ?? 0), 500, 'Gross profit should reflect paid amounts only');

    echo "Profit/Loss paid-amount runtime test passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
