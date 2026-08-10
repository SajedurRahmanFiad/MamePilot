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
$orderId = 'opi-order-' . $stamp;

$pdo->beginTransaction();
try {
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
        'INSERT INTO products (id, name, slug, category, sale_price, purchase_price, stock, created_by)
         VALUES (:id, :name, :slug, :category, 100, 50, 20, :created_by)',
        [
            ':id' => $productId,
            ':name' => 'Integrity Product 10x20',
            ':slug' => 'opi-' . $stamp,
            ':category' => 'Test',
            ':created_by' => (string) $actor['id'],
        ]
    );

    $created = $operations->createOrder([
        'id' => $orderId,
        'orderDate' => gmdate('Y-m-d'),
        'customerId' => $customerId,
        'status' => 'On Hold',
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
