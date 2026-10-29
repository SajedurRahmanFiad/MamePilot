<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\MasterDataApi;
use App\OperationsApi;

function orderProductIntegrityAssert(bool $condition, string $message): void
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
    "SELECT id, name, phone, role FROM users
     WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL
     ORDER BY CASE WHEN role = 'Developer' THEN 0 ELSE 1 END, created_at ASC LIMIT 1"
);
if ($actor === null) {
    throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
}
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

$stamp = substr(hash('sha256', uniqid('order-product-integrity-', true)), 0, 20);
$customerId = 'opi-customer-' . $stamp;
$productId = 'opi-product-' . $stamp;
$unitId = 'opi-unit-' . $stamp;
$orderId = 'opi-order-' . $stamp;

$pdo->beginTransaction();
try {
    $capabilitySettings = $database->fetchOne('SELECT id FROM app_capability_settings LIMIT 1');
    if ($capabilitySettings === null) {
        throw new RuntimeException('Local capability settings are unavailable.');
    }
    $database->execute(
        "UPDATE app_capability_settings SET business_mode = 'sofa_cover' WHERE id = :id",
        [':id' => (string) $capabilitySettings['id']]
    );

    $database->execute(
        'INSERT INTO customers (id, name, phone, address, created_by) VALUES (:id, :name, :phone, :address, :created_by)',
        [
            ':id' => $customerId,
            ':name' => 'Order Product Integrity Customer',
            ':phone' => '018' . substr(preg_replace('/\D/', '', (string) microtime(true)), -8),
            ':address' => 'Dhaka',
            ':created_by' => (string) $actor['id'],
        ]
    );
    $database->execute(
        'INSERT INTO units (id, name, short_name, is_fraction) VALUES (:id, :name, :short_name, 1)',
        [
            ':id' => $unitId,
            ':name' => 'Integrity Fabric Meter ' . $stamp,
            ':short_name' => 'opim' . $stamp,
        ]
    );
    $database->execute(
        'INSERT INTO products (id, name, slug, category, unit_id, sale_price, purchase_price, stock, created_by)
         VALUES (:id, :name, :slug, :category, :unit_id, 100, 50, 20, :created_by)',
        [
            ':id' => $productId,
            ':name' => 'Integrity Product 10x20',
            ':slug' => 'opi-' . $stamp,
            ':category' => 'Fabric',
            ':unit_id' => $unitId,
            ':created_by' => (string) $actor['id'],
        ]
    );

    $created = $operations->createOrder([
        'id' => $orderId,
        'orderDate' => gmdate('Y-m-d'),
        'customerId' => $customerId,
        'status' => 'On Hold',
        'collageUrls' => ['/uploads/order-collages/integrity-test.jpg'],
        'items' => [[
            'productId' => $productId,
            'productName' => 'Stale browser product name',
            'rate' => 100,
            'quantity' => 1,
            'amount' => 100,
        ]],
        'subtotal' => 100,
        'discount' => 0,
        'shipping' => 0,
        'total' => 100,
        'paidAmount' => 0,
        'history' => [],
    ]);
    orderProductIntegrityAssert(
        (string) ($created['items'][0]['productName'] ?? '') === 'Integrity Product 10x20',
        'Order creation did not replace a stale client product name with the server product snapshot.'
    );

    $operations->updateOrder(['id' => $orderId, 'updates' => ['status' => 'Processing']]);
    $stockAfterProcessing = (float) ($database->fetchOne('SELECT stock FROM products WHERE id = :id', [':id' => $productId])['stock'] ?? 0);
    orderProductIntegrityAssert(abs($stockAfterProcessing - 20) < 0.001, 'Sofa-cover processing deducted retail order quantity from fabric stock.');
    $operations->updateOrder(['id' => $orderId, 'updates' => ['status' => 'Cutting and Sewing']]);
    $stockAfterCutting = (float) ($database->fetchOne('SELECT stock FROM products WHERE id = :id', [':id' => $productId])['stock'] ?? 0);
    orderProductIntegrityAssert(abs($stockAfterCutting - 20) < 0.001, 'Sofa-cover cutting and sewing deducted fabric stock before usage was entered.');
    $readyItems = $created['items'];
    $readyItems[0]['fabricStockUsed'] = 0.5;
    $operations->updateOrder(['id' => $orderId, 'updates' => ['status' => 'Ready', 'items' => $readyItems]]);
    $stockAfterReady = (float) ($database->fetchOne('SELECT stock FROM products WHERE id = :id', [':id' => $productId])['stock'] ?? 0);
    orderProductIntegrityAssert(abs($stockAfterReady - 19.5) < 0.001, 'Ready did not deduct the fractional fabric usage.');
    $database->execute(
        'UPDATE orders SET items = :items WHERE id = :id',
        [
            ':id' => $orderId,
            ':items' => json_encode([[
                'productId' => $productId,
                'productName' => 'Historical Product Name',
                'rate' => 100,
                'quantity' => 1,
                'amount' => 100,
                'fabricStockUsed' => 0.5,
            ]], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]
    );
    $statusUpdated = $operations->updateOrder(['id' => $orderId, 'updates' => ['status' => 'Courier assigned']]);
    orderProductIntegrityAssert(
        (string) ($statusUpdated['status'] ?? '') === 'Courier assigned',
        'A historical product-name snapshot still blocked a status-only order update.'
    );

    $cosmetic = $masterData->updateProduct([
        'id' => $productId,
        'updates' => ['name' => 'Integrity Product ১০ × ২০'],
    ]);
    orderProductIntegrityAssert(
        (string) ($cosmetic['name'] ?? '') === 'Integrity Product ১০ × ২০',
        'Cosmetic product-name formatting was incorrectly rejected.'
    );

    try {
        $masterData->updateProduct([
            'id' => $productId,
            'updates' => ['name' => 'Integrity Product 11x20'],
        ]);
        throw new RuntimeException('A referenced product was repurposed to a different numeric identity.');
    } catch (RuntimeException $exception) {
        orderProductIntegrityAssert(
            str_contains($exception->getMessage(), 'Create a new product'),
            'Referenced product identity change failed for the wrong reason.'
        );
    }

    try {
        $masterData->deleteProduct(['id' => $productId]);
        throw new RuntimeException('A referenced inventory product was deleted.');
    } catch (RuntimeException $exception) {
        orderProductIntegrityAssert(
            str_contains($exception->getMessage(), 'cannot be deleted'),
            'Referenced product deletion failed for the wrong reason.'
        );
    }

    echo "Order product snapshot and product identity integrity runtime test passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
