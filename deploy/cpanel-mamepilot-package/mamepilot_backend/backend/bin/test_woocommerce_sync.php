<?php

declare(strict_types=1);

use App\ApiException;
use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;
use App\SchemaManager;
use App\WooCommerceApi;

require_once dirname(__DIR__) . '/bootstrap.php';

$root = dirname(__DIR__, 2);
$base = Config::load($root);
$testDatabaseName = 'mamepilot_woocommerce_test';
$config = new Config([
    'DB_HOST' => $base->get('DB_HOST', '127.0.0.1') ?? '127.0.0.1',
    'DB_PORT' => $base->get('DB_PORT', '3306') ?? '3306',
    'DB_NAME' => $testDatabaseName,
    'DB_USER' => $base->get('DB_USER', 'root') ?? 'root',
    'DB_PASS' => $base->get('DB_PASS', '') ?? '',
    'APP_JWT_SECRET' => 'woocommerce-integration-test-secret',
    'APP_TIMEZONE' => 'Asia/Dhaka',
]);
$database = new Database($config);

try {
    (new SchemaManager($config, $database))->provision(true, null, null, false);
    $now = $database->nowUtc();
    $page = [
        'id' => 'company-online', 'name' => 'Online Company', 'logo' => '/uploads/online-logo.png',
        'phone' => '01700000000', 'email' => 'online@example.com', 'address' => 'Dhaka',
        'isGlobalBranding' => true,
    ];
    $database->execute(
        'INSERT INTO company_settings (id, name, pages, created_at, updated_at) VALUES (:id, :name, :pages, :created, :updated)',
        [':id' => 'company-default', ':name' => 'Online Company', ':pages' => json_encode([$page]), ':created' => $now, ':updated' => $now]
    );
    $database->execute(
        'INSERT INTO order_settings (id, prefix, next_number, created_at, updated_at) VALUES (:id, :prefix, 1, :created, :updated)',
        [':id' => 'order-default', ':prefix' => 'ORD-', ':created' => $now, ':updated' => $now]
    );
    $database->execute(
        'INSERT INTO app_capability_settings (id, capabilities, created_at, updated_at) VALUES (:id, :capabilities, :created, :updated)',
        [':id' => 'app-capabilities-default', ':capabilities' => json_encode(['sales' => true, 'woocommerce' => true]), ':created' => $now, ':updated' => $now]
    );
    $database->execute(
        'INSERT INTO woocommerce_stores
            (id, store_name, store_url, consumer_key, consumer_secret, webhook_secret, company_page_id, enabled, created_at, updated_at)
         VALUES (:id, :name, :url, :key, :secret, :webhook_secret, :company, 1, :created, :updated)',
        [
            ':id' => 'woo-store-1', ':name' => 'Test Woo Shop', ':url' => 'https://shop.example.com',
            ':key' => 'ck_test', ':secret' => 'cs_test', ':webhook_secret' => 'signed-webhook-secret',
            ':company' => 'company-online', ':created' => $now, ':updated' => $now,
        ]
    );

    $auth = new Auth($config, $database);
    $woocommerce = new WooCommerceApi($database, $auth, $config, new OperationsApi($database, $auth, $config));
    $first = [
        'id' => 901, 'number' => '901', 'status' => 'processing', 'currency' => 'BDT',
        'total' => '120.00', 'discount_total' => '10.00',
        'date_created_gmt' => '2026-07-20T12:00:00', 'date_paid_gmt' => '2026-07-20T12:05:00',
        'billing' => [
            'first_name' => 'First', 'last_name' => 'Customer', 'phone' => '+8801712345678',
            'address_1' => 'Old Road', 'city' => 'Dhaka', 'country' => 'BD',
        ],
        'shipping' => [
            'first_name' => 'First', 'last_name' => 'Customer',
            'address_1' => 'Old Road', 'city' => 'Dhaka', 'country' => 'BD',
        ],
        'line_items' => [[
            'id' => 1, 'product_id' => 501, 'variation_id' => 0, 'name' => 'Woo Test Product',
            'sku' => 'WOO-501', 'quantity' => 2, 'subtotal' => '100.00', 'total' => '90.00', 'price' => '50.00',
        ]],
    ];

    $invalidRejected = false;
    try {
        $woocommerce->handleWebhook('woo-store-1', wooEncode($first), 'invalid', 'order.created');
    } catch (ApiException $exception) {
        $invalidRejected = $exception->errorCode() === 'INVALID_WEBHOOK_SIGNATURE';
    }
    wooCheck($invalidRejected, 'Invalid webhook signature was not rejected.');

    $firstRaw = wooEncode($first);
    $firstResult = $woocommerce->handleWebhook(
        'woo-store-1', $firstRaw,
        base64_encode(hash_hmac('sha256', $firstRaw, 'signed-webhook-secret', true)),
        'order.created'
    );
    wooCheck(empty($firstResult['skipped']), 'First WooCommerce order was unexpectedly skipped.');

    $second = $first;
    $second['id'] = 902;
    $second['number'] = '902';
    $second['total'] = '60.00';
    $second['discount_total'] = '0.00';
    $second['date_paid_gmt'] = null;
    $second['billing']['first_name'] = 'Updated';
    $second['billing']['last_name'] = 'Name';
    $second['billing']['phone'] = '01712-345678';
    $second['shipping']['first_name'] = 'Updated';
    $second['shipping']['last_name'] = 'Name';
    $second['shipping']['address_1'] = 'New Shipping Address';
    $second['line_items'][0]['quantity'] = 1;
    $second['line_items'][0]['subtotal'] = '50.00';
    $second['line_items'][0]['total'] = '50.00';

    $secondRaw = wooEncode($second);
    $signature = base64_encode(hash_hmac('sha256', $secondRaw, 'signed-webhook-secret', true));
    $secondResult = $woocommerce->handleWebhook('woo-store-1', $secondRaw, $signature, 'order.created');
    wooCheck(empty($secondResult['skipped']), 'Second WooCommerce order was unexpectedly skipped.');
    $replayResult = $woocommerce->handleWebhook('woo-store-1', $secondRaw, $signature, 'order.created');
    wooCheck(!empty($replayResult['skipped']), 'Duplicate WooCommerce webhook created another order.');

    $customer = $database->fetchOne('SELECT * FROM customers LIMIT 1');
    wooCheck($customer !== null, 'Customer was not created.');
    wooCheck((string) $customer['name'] === 'Updated Name', 'Existing customer name was not replaced.');
    wooCheck(str_contains((string) $customer['address'], 'New Shipping Address'), 'Existing customer address was not replaced.');
    wooCheck((int) $customer['total_orders'] === 2, 'Customer order summary was not recalculated.');
    wooCheck(abs((float) $customer['due_amount'] - 60.0) < 0.01, 'Customer due summary is incorrect.');

    $orders = $database->fetchAll(
        'SELECT o.*, u.name AS creator_name FROM orders o JOIN users u ON u.id = o.created_by ORDER BY o.order_seq ASC'
    );
    wooCheck(count($orders) === 2, 'Expected exactly two imported orders after duplicate replay.');
    foreach ($orders as $order) {
        $snapshot = json_decode((string) $order['page_snapshot'], true);
        wooCheck((string) $order['creator_name'] === 'WooCommerce', 'Created by is not WooCommerce.');
        wooCheck((string) $order['page_id'] === 'company-online', 'Company page mapping was not saved.');
        wooCheck(is_array($snapshot) && ($snapshot['name'] ?? '') === 'Online Company', 'Invoice company snapshot is incorrect.');
        wooCheck((string) $order['source_ad'] === 'WooCommerce', 'WooCommerce order source was not recorded.');
        wooCheck((string) $order['status'] === 'On Hold', 'Imported order did not enter the local On Hold workflow.');
    }
    wooCheck(abs((float) $orders[0]['paid_amount'] - 120.0) < 0.01, 'Paid order amount was not retained.');
    wooCheck(abs((float) $orders[1]['paid_amount']) < 0.01, 'Unpaid order was marked paid.');
    $placeholderProduct = $database->fetchOne(
        'SELECT p.stock FROM products p JOIN woocommerce_product_links l ON l.product_id = p.id WHERE l.store_id = :store_id LIMIT 1',
        [':store_id' => 'woo-store-1']
    );
    wooCheck((int) ($placeholderProduct['stock'] ?? 0) === 3, 'Auto-created WooCommerce product stock was not replenished for each imported order.');

    $usageUsers = (int) ($database->fetchOne(
        'SELECT COUNT(*) AS count FROM users WHERE deleted_at IS NULL AND COALESCE(is_system, 0) = 0'
    )['count'] ?? 0);
    wooCheck($usageUsers === 0, 'WooCommerce system user leaked into active-user counts.');

    $counts = [
        'customers' => (int) ($database->fetchOne('SELECT COUNT(*) AS count FROM customers')['count'] ?? 0),
        'orders' => (int) ($database->fetchOne('SELECT COUNT(*) AS count FROM orders')['count'] ?? 0),
        'orderLinks' => (int) ($database->fetchOne('SELECT COUNT(*) AS count FROM woocommerce_order_links')['count'] ?? 0),
        'productLinks' => (int) ($database->fetchOne('SELECT COUNT(*) AS count FROM woocommerce_product_links')['count'] ?? 0),
        'systemUsers' => (int) ($database->fetchOne('SELECT COUNT(*) AS count FROM users WHERE is_system = 1')['count'] ?? 0),
    ];
    wooCheck($counts === ['customers' => 1, 'orders' => 2, 'orderLinks' => 2, 'productLinks' => 1, 'systemUsers' => 1], 'Unexpected record counts.');

    echo json_encode([
        'success' => true, 'signatureValidation' => 'passed', 'customerUpsert' => 'passed',
        'companyBranding' => 'passed', 'createdBy' => 'WooCommerce',
        'duplicateReplay' => 'passed', 'placeholderStock' => 'passed',
        'systemUserExclusion' => 'passed', 'counts' => $counts,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
} finally {
    try {
        $database->connectServer()->exec('DROP DATABASE IF EXISTS ' . chr(96) . $testDatabaseName . chr(96));
    } catch (Throwable) {
    }
}

function wooEncode(array $payload): string
{
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (!is_string($json)) throw new RuntimeException('Could not encode test payload.');
    return $json;
}

function wooCheck(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}
