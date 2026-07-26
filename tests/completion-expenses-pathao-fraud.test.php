<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;

function completionAssert(bool $condition, string $message): void
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
$pdo = $database->connect();

$actor = $database->fetchOne(
    "SELECT id, name, phone, role FROM users WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1"
);
if ($actor === null) {
    throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
}
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

$stamp = str_replace('.', '', uniqid('completion-expense-', true));
$accountId = substr('account-' . $stamp, 0, 64);
$categoryId = substr('category-' . $stamp, 0, 64);
$customerId = substr('customer-' . $stamp, 0, 64);
$vendorId = substr('vendor-' . $stamp, 0, 64);
$orderId = substr('order-' . $stamp, 0, 64);
$billId = substr('bill-' . $stamp, 0, 64);
$orderNumber = 'TEST-ORDER-' . $stamp;
$billNumber = 'TEST-BILL-' . $stamp;

$pdo->beginTransaction();
try {
    $database->execute(
        'INSERT INTO accounts (id, name, type, opening_balance, current_balance) VALUES (:id, :name, :type, 1000, 1000)',
        [':id' => $accountId, ':name' => 'Completion Expense Test', ':type' => 'Cash']
    );
    $database->execute(
        'INSERT INTO categories (id, name, type, color, is_system) VALUES (:id, :name, :type, :color, 0)',
        [':id' => $categoryId, ':name' => 'Delivery Expense ' . $stamp, ':type' => 'Expense', ':color' => '#F59E0B']
    );
    $database->execute(
        'INSERT INTO customers (id, name, phone, address, created_by) VALUES (:id, :name, :phone, :address, :created_by)',
        [':id' => $customerId, ':name' => 'Expense Test Customer', ':phone' => '017' . substr(preg_replace('/\D/', '', $stamp), -8), ':address' => 'Dhaka', ':created_by' => $actor['id']]
    );
    $database->execute(
        'INSERT INTO vendors (id, name, phone, address, created_by) VALUES (:id, :name, :phone, :address, :created_by)',
        [':id' => $vendorId, ':name' => 'Expense Test Vendor', ':phone' => '018' . substr(preg_replace('/\D/', '', $stamp), -8), ':address' => 'Dhaka', ':created_by' => $actor['id']]
    );
    $database->execute(
        'UPDATE system_defaults SET default_account_id = :account_id, default_payment_method = :method, expense_category_id = :category_id',
        [':account_id' => $accountId, ':method' => 'Cash', ':category_id' => $categoryId]
    );

    $nextOrderSeq = (int) (($database->fetchOne('SELECT COALESCE(MAX(order_seq), 0) + 1 AS seq FROM orders') ?? [])['seq'] ?? 1);
    $database->execute(
        "INSERT INTO orders (id, order_number, order_seq, order_date, customer_id, created_by, status, items, total, history)
         VALUES (:id, :number, :seq, CURRENT_DATE, :customer_id, :created_by, 'Picked', '[]', 0, '{}')",
        [':id' => $orderId, ':number' => $orderNumber, ':seq' => $nextOrderSeq, ':customer_id' => $customerId, ':created_by' => $actor['id']]
    );

    $completedOrder = $operations->completePickedOrder([
        'orderId' => $orderId,
        'outcome' => 'Delivered',
        'date' => gmdate('c'),
        'additionalExpenseAmount' => 12.50,
        'additionalExpenseCategoryId' => $categoryId,
    ]);
    completionAssert(($completedOrder['status'] ?? '') === 'Completed', 'Order did not complete with an additional expense.');
    $orderExpense = $database->fetchOne(
        "SELECT type, category, account_id, amount FROM transactions WHERE reference_id = :id AND description LIKE 'Additional delivery expense for Order #%' LIMIT 1",
        [':id' => $orderId]
    );
    completionAssert($orderExpense !== null, 'Order additional expense transaction was not created.');
    completionAssert(($orderExpense['type'] ?? '') === 'Expense', 'Order additional expense has the wrong transaction type.');
    completionAssert(($orderExpense['category'] ?? '') === $categoryId, 'Order additional expense category was not preserved.');
    completionAssert(abs((float) ($orderExpense['amount'] ?? 0) - 12.50) < 0.001, 'Order additional expense amount is incorrect.');

    $nextBillSeq = (int) (($database->fetchOne('SELECT COALESCE(MAX(bill_seq), 0) + 1 AS seq FROM bills') ?? [])['seq'] ?? 1);
    $database->execute(
        "INSERT INTO bills (id, bill_number, bill_seq, bill_date, vendor_id, created_by, status, items, total, history)
         VALUES (:id, :number, :seq, CURRENT_DATE, :vendor_id, :created_by, 'Processing', '[]', 0, '{}')",
        [':id' => $billId, ':number' => $billNumber, ':seq' => $nextBillSeq, ':vendor_id' => $vendorId, ':created_by' => $actor['id']]
    );
    $receivedBill = $operations->updateBill([
        'id' => $billId,
        'updates' => [
            'status' => 'Received',
            'history' => ['received' => 'Received by integration test.'],
            'additionalExpenseAmount' => 8.25,
            'additionalExpenseCategoryId' => $categoryId,
        ],
    ]);
    completionAssert(($receivedBill['status'] ?? '') === 'Received', 'Bill did not complete with an additional expense.');
    $billExpense = $database->fetchOne(
        "SELECT type, category, account_id, amount FROM transactions WHERE reference_id = :id AND description LIKE 'Additional delivery expense for Bill #%' LIMIT 1",
        [':id' => $billId]
    );
    completionAssert($billExpense !== null, 'Bill additional expense transaction was not created.');
    completionAssert(($billExpense['type'] ?? '') === 'Expense', 'Bill additional expense has the wrong transaction type.');
    completionAssert(($billExpense['category'] ?? '') === $categoryId, 'Bill additional expense category was not preserved.');
    completionAssert(abs((float) ($billExpense['amount'] ?? 0) - 8.25) < 0.001, 'Bill additional expense amount is incorrect.');

    $balance = (float) (($database->fetchOne('SELECT current_balance FROM accounts WHERE id = :id', [':id' => $accountId]) ?? [])['current_balance'] ?? 0);
    completionAssert(abs($balance - 979.25) < 0.001, 'Additional expense transactions did not deduct the account balance exactly once.');

    $schemaOnly = (string) file_get_contents($root . '/backend/database/schema-only.sql');
    foreach (['fraud_check_result', 'fraud_check_percentage', 'fraud_check_phone', 'fraud_checked_at'] as $column) {
        completionAssert(str_contains($schemaOnly, "sp_add_col('customers', '{$column}'"), "schema-only.sql is missing {$column}.");
    }

    $courierApi = (string) file_get_contents($root . '/backend/src/CourierApi.php');
    completionAssert(str_contains($courierApi, '/aladdin/api/v1/city-list'), 'Pathao city endpoint is missing.');
    completionAssert(str_contains($courierApi, "rawurlencode(\$cityId) . '/zone-list'"), 'Pathao zone endpoint is missing.');
    completionAssert(str_contains($courierApi, "rawurlencode(\$zoneId) . '/area-list'"), 'Pathao area endpoint is missing.');
    completionAssert(str_contains($courierApi, "'recipient_city'"), 'Pathao booking payload is missing recipient_city.');
    completionAssert(str_contains($courierApi, "'recipient_zone'"), 'Pathao booking payload is missing recipient_zone.');
    completionAssert(str_contains($courierApi, "'recipient_area'"), 'Pathao booking payload is missing recipient_area.');

    echo "Order and bill additional expenses, fraud schema, and Pathao location contracts passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
