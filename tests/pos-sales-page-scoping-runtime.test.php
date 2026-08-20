<?php

declare(strict_types=1);

/**
 * Runtime test: POS sales page scoping + walk-in customer protections.
 *
 * Verifies:
 *  1. createPosOrder marks the order isPos=1, even with a real customer.
 *  2. fetchOrdersPage / fetchOrderSearchPreview with pos=true return POS
 *     sales while pos=false (the Orders page) never does.
 *  3. Customer listings never include the walk-in customer and deletion of
 *     the walk-in customer is rejected.
 */

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;
use App\MasterDataApi;

function posSalesAssert(bool $condition, string $message): void
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

$actor = $database->fetchOne(
    "SELECT id, name, phone, role FROM users WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1"
);
if ($actor === null) {
    throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
}
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

$stamp = date('YmdHis') . '-' . substr(bin2hex(random_bytes(4)), 0, 6);
$orderId = 'pos-sales-test-' . $stamp;
$productId = 'pos-product-' . $stamp;
$nextSeq = (int) ($database->fetchOne('SELECT COALESCE(MAX(order_seq), 0) + 1 AS n FROM orders')['n'] ?? 1);

// Seed a dedicated test customer (walk-in must NOT be the only POS customer).
$customerId = 'pos-customer-' . $stamp;
$database->execute(
    'INSERT INTO customers (id, name, phone, address, total_orders, due_amount, created_by)
     VALUES (:id, :name, :phone, :address, 0, 0, :actor)',
    [':id' => $customerId, ':name' => 'POS Scoping Test Customer', ':phone' => '019' . substr(preg_replace('/\D/', '', $stamp), -8), ':address' => 'Dhaka', ':actor' => $actor['id']]
);
$database->execute(
    'INSERT INTO products (id, name, slug, category, sale_price, purchase_price, stock, created_by)
     VALUES (:id, :name, :slug, :category, 150, 60, 100, :actor)',
    [':id' => $productId, ':name' => 'POS Scoping Test Product', ':slug' => 'pos-scoping-' . $stamp, ':category' => 'Test', ':actor' => $actor['id']]
);

try {
    // 1. Create a POS sale against a REAL customer with a tender.
    $posOrder = $operations->createPosOrder([
        'id' => $orderId,
        'customerId' => $customerId,
        'items' => [
            ['productId' => $productId, 'productName' => 'POS Scoping Test Product', 'rate' => 150, 'quantity' => 2],
        ],
        'discount' => 10,
        'vatRate' => 5,
        'tenders' => [['method' => 'cash', 'amount' => 305]],
    ]);
    posSalesAssert(($posOrder['isPos'] ?? false) === true, 'createPosOrder must return isPos=true.');
    posSalesAssert(round((float) ($posOrder['total'] ?? 0), 2) === 304.5, 'Unexpected POS order total.');

    $dbOrder = $database->fetchOne('SELECT is_pos FROM orders WHERE id = :id', [':id' => $orderId]);
    posSalesAssert($dbOrder !== null && (int) ($dbOrder['is_pos'] ?? 0) === 1, 'POS order must be persisted with is_pos=1.');

    // 2. Access through the orders list scope.
    $posPage = $operations->fetchOrdersPage(['page' => 1, 'pageSize' => 10, 'filters' => ['pos' => true]]);
    $regularPage = $operations->fetchOrdersPage(['page' => 1, 'pageSize' => 10, 'filters' => ['pos' => false]]);
    posSalesAssert(
        in_array($orderId, array_column($posPage['data'], 'id'), true),
        'pos=true must include the freshly created POS sale.'
    );
    posSalesAssert(
        !in_array($orderId, array_column($regularPage['data'], 'id'), true),
        'pos=false (Orders page) must not include POS sales.'
    );
    posSalesAssert(
        !in_array($orderId, array_column($regularPage['data'], 'id'), true)
        && count(array_filter($regularPage['data'], static fn(array $o): bool => (bool) ($o['isPos'] ?? false))) === 0,
        'Orders page rows must never carry isPos=true.'
    );

    $posPreview = $operations->fetchOrderSearchPreview(['search' => 'POS Scoping Test Customer', 'pos' => true]);
    $regularPreview = $operations->fetchOrderSearchPreview(['search' => 'POS Scoping Test Customer']);
    posSalesAssert(
        in_array($orderId, array_column($posPreview, 'id'), true),
        'Search preview with pos=true must find the POS sale.'
    );
    posSalesAssert(
        !in_array($orderId, array_column($regularPreview, 'id'), true),
        'Search preview without pos must not find the POS sale.'
    );

    // 3. Walk-in customer protections.
    $customers = $masterData->fetchCustomers();
    $mini = $masterData->fetchCustomersMini();
    $page = $masterData->fetchCustomersPage(['page' => 1, 'pageSize' => 50]);
    posSalesAssert(
        !in_array('walkin-customer', array_column($customers, 'id'), true),
        'fetchCustomers must hide the walk-in customer.'
    );
    posSalesAssert(
        !in_array('walkin-customer', array_column($mini, 'id'), true),
        'fetchCustomersMini must hide the walk-in customer.'
    );
    posSalesAssert(
        !in_array('walkin-customer', array_column($page['data'], 'id'), true),
        'fetchCustomersPage must hide the walk-in customer.'
    );

    $walkinRow = $database->fetchOne("SELECT phone, is_walkin FROM customers WHERE id = 'walkin-customer'");
    posSalesAssert(
        $walkinRow !== null && (string) ($walkinRow['phone'] ?? '') === '00000000000' && (int) ($walkinRow['is_walkin'] ?? 0) === 1,
        'Walk-in customer must exist with phone 00000000000 and is_walkin=1.'
    );

    $deletionBlocked = false;
    try {
        $masterData->deleteCustomer(['id' => 'walkin-customer']);
    } catch (RuntimeException $e) {
        $deletionBlocked = true;
        posSalesAssert(
            stripos($e->getMessage(), 'walk-in') !== false,
            'Deletion rejection must be explicit about the walk-in customer.'
        );
    }
    posSalesAssert($deletionBlocked, 'Deleting the walk-in customer must be rejected.');

    echo "POS sales page scoping + walk-in protections runtime test passed.\n";
} finally {
    $database->execute('UPDATE orders SET deleted_at = CURRENT_TIMESTAMP, deleted_by = :actor WHERE id = :id', [':id' => $orderId, ':actor' => $actor['id']]);
    $database->execute('UPDATE products SET deleted_at = CURRENT_TIMESTAMP WHERE id = :id', [':id' => $productId]);
    $database->execute('UPDATE customers SET deleted_at = CURRENT_TIMESTAMP WHERE id = :id', [':id' => $customerId]);
    unset($_SERVER['HTTP_AUTHORIZATION']);
}