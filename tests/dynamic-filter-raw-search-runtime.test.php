<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\MasterDataApi;
use App\OperationsApi;

function rawSearchRuntimeAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$config = Config::load($root);
$database = new Database($config);
$auth = new Auth($config, $database);
$operations = new OperationsApi($database, $auth, $config);
$masterData = new MasterDataApi($database, $auth, $config);
$pdo = $database->connect();

$actor = $database->fetchOne(
    "SELECT id, name, phone, role FROM users WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1"
);
if ($actor === null) {
    throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
}
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

$stamp = strtolower(str_replace('.', '', uniqid('raw45', true)));
$customerId = substr('customer-' . $stamp, 0, 64);
$vendorId = substr('vendor-' . $stamp, 0, 64);
$productId = substr('product-' . $stamp, 0, 64);
$accountId = substr('account-' . $stamp, 0, 64);
$orderId = substr('order-' . $stamp, 0, 64);
$exchangeOrderId = substr('exchange-' . $stamp, 0, 64);
$billId = substr('bill-' . $stamp, 0, 64);
$transactionId = substr('transaction-' . $stamp, 0, 64);

$pdo->beginTransaction();
try {
    $database->execute(
        'INSERT INTO customers (id, name, phone, address, total_orders, due_amount, created_by) VALUES (:id, :name, :phone, :address, 0, 0, :created_by)',
        [
            ':id' => $customerId,
            ':name' => 'Raw Search Customer',
            ':phone' => '01700000000',
            ':address' => 'Hidden Address Match 45',
            ':created_by' => $actor['id'],
        ]
    );
    $database->execute(
        'INSERT INTO vendors (id, name, phone, address, total_purchases, due_amount, created_by) VALUES (:id, :name, :phone, :address, 0, 0, :created_by)',
        [
            ':id' => $vendorId,
            ':name' => 'Raw Search Vendor',
            ':phone' => '01800000000',
            ':address' => 'Vendor Address Match 45',
            ':created_by' => $actor['id'],
        ]
    );
    $database->execute(
        'INSERT INTO products (id, name, category, sale_price, purchase_price, stock, created_by) VALUES (:id, :name, :category, 120, 80, 7, :created_by)',
        [
            ':id' => $productId,
            ':name' => 'Raw Search Product',
            ':category' => 'Category Match 45',
            ':created_by' => $actor['id'],
        ]
    );
    $database->execute(
        'INSERT INTO accounts (id, name, type, opening_balance, current_balance) VALUES (:id, :name, :type, 0, 0)',
        [':id' => $accountId, ':name' => 'Account Match 45', ':type' => 'Cash']
    );

    $nextOrderSeq = (int) (($database->fetchOne('SELECT COALESCE(MAX(order_seq), 0) + 1 AS seq FROM orders') ?? [])['seq'] ?? 1);
    $database->execute(
        "INSERT INTO orders (id, order_number, order_seq, order_date, customer_id, created_by, status, items, total, history)
         VALUES (:id, :number, :seq, CURRENT_DATE, :customer_id, :created_by, 'On Hold', '[]', 0, '{}')",
        [
            ':id' => $orderId,
            ':number' => 'RAW-ORDER-' . $stamp,
            ':seq' => $nextOrderSeq,
            ':customer_id' => $customerId,
            ':created_by' => $actor['id'],
        ]
    );
    $database->execute(
        "INSERT INTO orders (id, order_number, order_seq, order_date, customer_id, created_by, status, items, total, history)
         VALUES (:id, :number, :seq, CURRENT_DATE, :customer_id, :created_by, 'Exchange processing', '[]', 0, '{}')",
        [
            ':id' => $exchangeOrderId,
            ':number' => 'RAW-EXCHANGE-' . $stamp,
            ':seq' => $nextOrderSeq + 1,
            ':customer_id' => $customerId,
            ':created_by' => $actor['id'],
        ]
    );

    $nextBillSeq = (int) (($database->fetchOne('SELECT COALESCE(MAX(bill_seq), 0) + 1 AS seq FROM bills') ?? [])['seq'] ?? 1);
    $database->execute(
        "INSERT INTO bills (id, bill_number, bill_seq, bill_date, vendor_id, created_by, status, items, total, history)
         VALUES (:id, :number, :seq, CURRENT_DATE, :vendor_id, :created_by, 'On Hold', '[]', 0, '{}')",
        [
            ':id' => $billId,
            ':number' => 'RAW-BILL-' . $stamp,
            ':seq' => $nextBillSeq,
            ':vendor_id' => $vendorId,
            ':created_by' => $actor['id'],
        ]
    );
    $database->execute(
        "INSERT INTO transactions (id, date, type, category, account_id, amount, description, created_by, history)
         VALUES (:id, NOW(), 'Income', 'raw_search', :account_id, 10, 'No numeric marker here', :created_by, '{}')",
        [
            ':id' => $transactionId,
            ':account_id' => $accountId,
            ':created_by' => $actor['id'],
        ]
    );

    $orderPage = $operations->fetchOrdersPage(['page' => 1, 'pageSize' => 50, 'filters' => ['search' => '45']]);
    rawSearchRuntimeAssert(in_array($orderId, array_column($orderPage['data'], 'id'), true), 'Order search did not match the linked customer address.');

    $billPage = $operations->fetchBillsPage(['page' => 1, 'pageSize' => 50, 'filters' => ['search' => '45']]);
    rawSearchRuntimeAssert(in_array($billId, array_column($billPage['data'], 'id'), true), 'Bill search did not match the linked vendor address.');

    $transactionPage = $operations->fetchTransactionsPage(['page' => 1, 'pageSize' => 50, 'filters' => ['search' => '45']]);
    rawSearchRuntimeAssert(in_array($transactionId, array_column($transactionPage['data'], 'id'), true), 'Transaction search did not match the linked account name.');

    $productPage = $masterData->fetchProductsPage(['page' => 1, 'pageSize' => 50, 'search' => '45']);
    rawSearchRuntimeAssert(in_array($productId, array_column($productPage['data'], 'id'), true), 'Product search did not match its category.');

    $updatedExchangeOrder = $operations->updateOrder([
        'id' => $exchangeOrderId,
        'updates' => ['notes' => 'Still editable before exchange pickup.'],
    ]);
    rawSearchRuntimeAssert(($updatedExchangeOrder['notes'] ?? '') === 'Still editable before exchange pickup.', 'Exchange-processing order was not editable.');

    $database->execute("UPDATE orders SET status = 'Exchange picked' WHERE id = :id", [':id' => $exchangeOrderId]);
    $blockedAfterPickup = false;
    try {
        $operations->updateOrder([
            'id' => $exchangeOrderId,
            'updates' => ['notes' => 'This edit must be blocked.'],
        ]);
    } catch (RuntimeException $exception) {
        $blockedAfterPickup = str_contains($exception->getMessage(), 'can no longer be edited');
    }
    rawSearchRuntimeAssert($blockedAfterPickup, 'Exchange-picked order remained editable through the API.');

    echo "Raw-search SQL coverage and exchange edit-window runtime tests passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
