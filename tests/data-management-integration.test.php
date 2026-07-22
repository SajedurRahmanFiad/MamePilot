<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\DataManagementApi;

$config = Config::load(dirname(__DIR__));
$database = new Database($config);
$auth = new Auth($config, $database);
$api = new DataManagementApi($database, $auth, $config);
$reflection = new ReflectionClass($api);
$invoke = static function (string $method, array $arguments) use ($reflection, $api) {
    return $reflection->getMethod($method)->invokeArgs($api, $arguments);
};
$actor = $database->fetchOne(
    'SELECT id FROM users WHERE deleted_at IS NULL AND COALESCE(is_system, 0) = 0 ORDER BY created_at ASC LIMIT 1'
);
if ($actor === null) {
    throw new RuntimeException('Local integration actor is unavailable.');
}

$stamp = str_replace('.', '', uniqid('friendly-csv-', true));
$phone = '01' . substr((string) preg_replace('/\D/', '', $stamp), -9);
$customerPhone = $phone . '1';
$vendorPhone = $phone . '2';
$productName = 'Friendly Product ' . $stamp;
$orderNumber = 'FRIENDLY-ORD-' . $stamp;
$billNumber = 'FRIENDLY-BILL-' . $stamp;
$transactionNumber = 'FRIENDLY-TXN-' . $stamp;
$accountName = 'Friendly Account ' . $stamp;
$unitName = 'Friendly Unit ' . substr($stamp, -8);

$pdo = $database->connect();
$pdo->beginTransaction();
try {
    if ($invoke('importUser', [[
        'name' => 'Friendly CSV User',
        'phone' => $phone,
        'role' => 'Employee',
        'password' => 'temporary-test-password',
        'isCommissionBased' => 'yes',
    ]]) !== 'created') {
        throw new RuntimeException('User create failed.');
    }

    $orderRows = [
        [
            'orderNumber' => $orderNumber, 'orderDate' => '2026-07-22', 'customerName' => 'Friendly Customer',
            'customerPhone' => $customerPhone, 'customerAddress' => 'Dhaka', 'status' => 'On Hold',
            'productName' => $productName, 'quantity' => '2', 'rate' => '100', 'discount' => '10',
            'shipping' => '5', 'paidAmount' => '25', 'notes' => 'First item', '_csvRow' => '2',
        ],
        [
            'orderNumber' => $orderNumber, 'orderDate' => '2026-07-22', 'customerName' => 'Friendly Customer',
            'customerPhone' => $customerPhone, 'status' => 'On Hold', 'productName' => $productName,
            'quantity' => '1', 'rate' => '50', 'discount' => '10', 'shipping' => '5',
            'paidAmount' => '25', '_csvRow' => '3',
        ],
    ];
    $work = $invoke('prepareImportWorkItems', ['orders', $orderRows, 0]);
    if (count($work) !== 1 || $work[0]['sourceRowCount'] !== 2) {
        throw new RuntimeException('Order item rows were not grouped.');
    }
    if ($invoke('importOrder', [$work[0]['row'], $actor]) !== 'created') {
        throw new RuntimeException('Friendly order create failed.');
    }
    $order = $database->fetchOne('SELECT id, items, total FROM orders WHERE order_number = :number', [':number' => $orderNumber]);
    if ($order === null || count(json_decode((string) $order['items'], true)) !== 2 || abs((float) $order['total'] - 245) > 0.001) {
        throw new RuntimeException('Grouped order values are incorrect.');
    }
    if ($database->fetchOne('SELECT id FROM customers WHERE phone = :phone', [':phone' => $customerPhone]) === null) {
        throw new RuntimeException('Order did not auto-create its customer.');
    }
    if ($database->fetchOne('SELECT id FROM products WHERE name = :name', [':name' => $productName]) === null) {
        throw new RuntimeException('Order did not auto-create its product.');
    }

    if ($invoke('importCustomer', [[
        'name' => 'Friendly Customer Updated', 'phone' => $customerPhone, 'address' => 'Chattogram',
    ], $actor]) !== 'updated') {
        throw new RuntimeException('Customer natural-key update failed.');
    }
    $customer = $database->fetchOne(
        'SELECT total_orders, due_amount, address FROM customers WHERE phone = :phone',
        [':phone' => $customerPhone]
    );
    if ((int) $customer['total_orders'] !== 1 || abs((float) $customer['due_amount'] - 220) > 0.001 || $customer['address'] !== 'Chattogram') {
        throw new RuntimeException('Customer update damaged calculated summaries.');
    }

    $billRows = [[
        'billNumber' => $billNumber, 'billDate' => '2026-07-22', 'vendorName' => 'Friendly Vendor',
        'vendorPhone' => $vendorPhone, 'vendorAddress' => 'Dhaka', 'status' => 'On Hold',
        'productName' => $productName, 'quantity' => '5', 'rate' => '60', 'discount' => '0',
        'shipping' => '0', 'paidAmount' => '100', '_csvRow' => '2',
    ]];
    $billWork = $invoke('prepareImportWorkItems', ['bills', $billRows, 0]);
    if ($invoke('importBill', [$billWork[0]['row'], $actor]) !== 'created') {
        throw new RuntimeException('Friendly bill create failed.');
    }
    if ($database->fetchOne('SELECT id FROM vendors WHERE phone = :phone', [':phone' => $vendorPhone]) === null) {
        throw new RuntimeException('Bill did not auto-create its vendor.');
    }
    if ($invoke('importVendor', [[
        'name' => 'Friendly Vendor Updated', 'phone' => $vendorPhone, 'address' => 'Narayanganj',
    ], $actor]) !== 'updated') {
        throw new RuntimeException('Vendor natural-key update failed.');
    }

    if ($invoke('importProduct', [[
        'name' => $productName, 'category' => 'Test', 'unitName' => $unitName,
        'salePrice' => '120', 'purchasePrice' => '60', 'stock' => '20',
    ], $actor]) !== 'updated') {
        throw new RuntimeException('Product natural-key update failed.');
    }
    if ($database->fetchOne('SELECT id FROM units WHERE name = :name', [':name' => $unitName]) === null) {
        throw new RuntimeException('Product import did not auto-create its unit.');
    }

    $transaction = [
        'transactionId' => $transactionNumber, 'date' => '2026-07-22 12:00:00', 'type' => 'Income',
        'category' => 'Sales', 'accountName' => $accountName, 'accountType' => 'Cash', 'amount' => '25',
        'description' => 'Friendly transaction', 'referenceNumber' => $orderNumber,
        'contactPhone' => $customerPhone, 'paymentMethod' => 'Cash', 'approvalStatus' => 'approved',
    ];
    if ($invoke('importTransaction', [$transaction, $actor]) !== 'created') {
        throw new RuntimeException('Friendly transaction create failed.');
    }
    $account = $database->fetchOne('SELECT id, current_balance FROM accounts WHERE name = :name', [':name' => $accountName]);
    if ($account === null || abs((float) $account['current_balance'] - 25) > 0.001) {
        throw new RuntimeException('Transaction account auto-create or balance failed.');
    }
    if ($invoke('importTransaction', [$transaction, $actor]) !== 'updated') {
        throw new RuntimeException('Transaction natural-key update failed.');
    }
    $accountAfter = $database->fetchOne('SELECT current_balance FROM accounts WHERE id = :id', [':id' => $account['id']]);
    if (abs((float) $accountAfter['current_balance'] - 25) > 0.001) {
        throw new RuntimeException('Transaction update double-applied the account balance.');
    }
    $linked = $database->fetchOne(
        'SELECT reference_id, contact_id FROM transactions WHERE transaction_id = :id',
        [':id' => $transactionNumber]
    );
    if ($linked === null || trim((string) $linked['reference_id']) === '' || trim((string) $linked['contact_id']) === '') {
        throw new RuntimeException('Friendly transaction references were not resolved.');
    }

    echo "Friendly no-ID import, grouping, auto-create, update, and balance checks passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}

$checks = [
    ['users', 'phone', $phone], ['customers', 'phone', $customerPhone], ['vendors', 'phone', $vendorPhone],
    ['products', 'name', $productName], ['orders', 'order_number', $orderNumber], ['bills', 'bill_number', $billNumber],
    ['transactions', 'transaction_id', $transactionNumber], ['accounts', 'name', $accountName], ['units', 'name', $unitName],
];
foreach ($checks as [$table, $column, $value]) {
    if ($database->fetchOne("SELECT id FROM `{$table}` WHERE `{$column}` = :value", [':value' => $value]) !== null) {
        throw new RuntimeException('Rollback left a test record in ' . $table . '.');
    }
}
echo "Rollback cleanup verification passed.\n";
