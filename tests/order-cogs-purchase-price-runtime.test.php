<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;

function orderCogsAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = dirname(__DIR__);
$config = Config::load($root);
$database = new Database($config);
$auth = new Auth($config, $database);
$operations = new OperationsApi($database, $auth, $config);
$pdo = $database->connect();
$actor = $database->fetchOne("SELECT id, name, phone, role FROM users WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1");
if ($actor === null) throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

$stamp = str_replace('.', '', uniqid('order-cogs-', true));
$accountId = substr('account-' . $stamp, 0, 64);
$customerId = substr('customer-' . $stamp, 0, 64);
$productId = substr('product-' . $stamp, 0, 64);
$orderId = substr('order-' . $stamp, 0, 64);
$historicalId = substr('historical-' . $stamp, 0, 64);

$pdo->beginTransaction();
try {
    $capabilityRow = $database->fetchOne('SELECT id, capabilities FROM app_capability_settings LIMIT 1');
    $capabilities = json_decode((string) ($capabilityRow['capabilities'] ?? '{}'), true);
    if (!is_array($capabilities)) $capabilities = [];
    $capabilities['purchases'] = false;
    $database->execute('UPDATE app_capability_settings SET capabilities = :capabilities WHERE id = :id', [':capabilities' => json_encode($capabilities), ':id' => $capabilityRow['id']]);
    $database->execute('INSERT INTO accounts (id, name, type, opening_balance, current_balance) VALUES (:id, :name, :type, 1000, 1000)', [':id' => $accountId, ':name' => 'COGS Test Account', ':type' => 'Cash']);
    $database->execute('INSERT INTO customers (id, name, phone, address, created_by) VALUES (:id, :name, :phone, :address, :created_by)', [':id' => $customerId, ':name' => 'COGS Test Customer', ':phone' => '019' . substr(preg_replace('/\D/', '', $stamp), -8), ':address' => 'Dhaka', ':created_by' => $actor['id']]);
    $database->execute('INSERT INTO products (id, name, slug, category, sale_price, purchase_price, stock, created_by) VALUES (:id, :name, :slug, :category, 100, 30, 100, :created_by)', [':id' => $productId, ':name' => 'COGS Test Product', ':slug' => 'cogs-' . $stamp, ':category' => 'Test', ':created_by' => $actor['id']]);
    $database->execute("UPDATE system_defaults SET default_account_id = :account_id, default_payment_method = 'Cash', calculate_cogs_from_purchase_price = 1", [':account_id' => $accountId]);

    $items = json_encode([['productId' => $productId, 'productName' => 'COGS Test Product', 'rate' => 100, 'quantity' => 2, 'amount' => 200]]);
    $nextSeq = (int) (($database->fetchOne('SELECT COALESCE(MAX(order_seq), 0) + 1 AS seq FROM orders') ?? [])['seq'] ?? 1);
    $database->execute("INSERT INTO orders (id, order_number, order_seq, order_date, customer_id, created_by, status, items, subtotal, total, history) VALUES (:id, :number, :seq, CURRENT_DATE, :customer, :actor, 'Picked', :items, 200, 200, '{}')", [':id' => $orderId, ':number' => 'COGS-' . $stamp, ':seq' => $nextSeq, ':customer' => $customerId, ':actor' => $actor['id'], ':items' => $items]);
    $operations->completePickedOrder(['orderId' => $orderId, 'outcome' => 'Delivered', 'amount' => 0, 'date' => gmdate('c')]);

    $transaction = $database->fetchOne("SELECT id, amount FROM transactions WHERE reference_id = :order_id AND category = 'expense_purchases' AND deleted_at IS NULL", [':order_id' => $orderId]);
    orderCogsAssert($transaction !== null && abs((float) $transaction['amount'] - 60.0) < 0.001, 'Delivered order did not create the expected purchase-price COGS expense.');
    $operations->updateOrder(['id' => $orderId, 'updates' => ['status' => 'Completed']]);
    $duplicateCount = (int) (($database->fetchOne("SELECT COUNT(*) AS count FROM transactions WHERE reference_id = :order_id AND category = 'expense_purchases'", [':order_id' => $orderId]) ?? [])['count'] ?? 0);
    orderCogsAssert($duplicateCount === 1, 'Repeating a delivered status created duplicate COGS expenses.');

    $database->execute("INSERT INTO orders (id, order_number, order_seq, order_date, customer_id, created_by, status, items, subtotal, total, history) VALUES (:id, :number, :seq, CURRENT_DATE, :customer, :actor, 'Completed', :items, 200, 200, '{}')", [':id' => $historicalId, ':number' => 'COGS-HIST-' . $stamp, ':seq' => $nextSeq + 1, ':customer' => $customerId, ':actor' => $actor['id'], ':items' => $items]);
    $before = $operations->fetchOrderCogsBackfillStatus();
    orderCogsAssert((int) $before['missingOrders'] >= 1, 'Historical delivered order was not reported as missing COGS.');
    $after = $operations->backfillOrderCogsExpenses(['limit' => 500]);
    orderCogsAssert((int) $after['missingOrders'] === 0, 'Historical COGS backfill did not clear the missing-order count.');
    $historicalTransaction = $database->fetchOne("SELECT amount FROM transactions WHERE reference_id = :order_id AND category = 'expense_purchases' AND deleted_at IS NULL", [':order_id' => $historicalId]);
    orderCogsAssert($historicalTransaction !== null && abs((float) $historicalTransaction['amount'] - 60.0) < 0.001, 'Historical COGS backfill generated the wrong amount.');

    echo "Order purchase-price COGS runtime test passed.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
}
