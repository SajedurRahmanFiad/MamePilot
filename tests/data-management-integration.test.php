<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\DataManagementApi;
use App\OperationsApi;

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
$createdImagePath = null;

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
    $order = $database->fetchOne('SELECT id, order_seq, customer_id, items, total FROM orders WHERE order_number = :number', [':number' => $orderNumber]);
    if ($order === null || (int) $order['order_seq'] <= 0 || count(json_decode((string) $order['items'], true)) !== 2 || abs((float) $order['total'] - 245) > 0.001) {
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
    $bill = $database->fetchOne('SELECT id, bill_seq, vendor_id FROM bills WHERE bill_number = :number', [':number' => $billNumber]);
    if ($bill === null || (int) $bill['bill_seq'] <= 0) {
        throw new RuntimeException('Imported bill did not receive an internal sequence.');
    }
    if ($database->fetchOne('SELECT id FROM vendors WHERE phone = :phone', [':phone' => $vendorPhone]) === null) {
        throw new RuntimeException('Bill did not auto-create its vendor.');
    }
    if ($invoke('importVendor', [[
        'name' => 'Friendly Vendor Updated', 'phone' => $vendorPhone, 'address' => 'Narayanganj',
    ], $actor]) !== 'updated') {
        throw new RuntimeException('Vendor natural-key update failed.');
    }

    $operations = new OperationsApi($database, $auth, $config);
    $operationsReflection = new ReflectionClass($operations);
    $invokeOperation = static function (string $method, array $arguments = []) use ($operationsReflection, $operations) {
        return $operationsReflection->getMethod($method)->invokeArgs($operations, $arguments);
    };
    $orderSettings = $database->fetchOne('SELECT prefix, next_number FROM order_settings LIMIT 1') ?? [];
    $prefix = (string) ($orderSettings['prefix'] ?? 'ORD-');
    $orderMax = (int) (($database->fetchOne('SELECT COALESCE(MAX(order_seq), 0) AS value FROM orders') ?? [])['value'] ?? 0);
    $orderCollisionSequence = max((int) ($orderSettings['next_number'] ?? 1), $orderMax + 1);
    while ($database->fetchOne('SELECT id FROM orders WHERE order_number = :number', [':number' => $prefix . $orderCollisionSequence]) !== null) {
        $orderCollisionSequence++;
    }
    $orderCollisionNumber = $prefix . $orderCollisionSequence;
    $database->execute(
        'INSERT INTO orders (id, order_number, order_seq, order_date, customer_id, created_by, status, items, subtotal, discount, shipping, total, paid_amount, history, created_at, updated_at)
         VALUES (:id, :number, NULL, :date, :customer, :creator, :status, :items, 0, 0, 0, 0, 0, :history, :created_at, :updated_at)',
        [
            ':id' => 'test-order-collision-' . substr($stamp, -24), ':number' => $orderCollisionNumber,
            ':date' => '2026-07-22', ':customer' => $order['customer_id'],
            ':creator' => $actor['id'], ':status' => 'On Hold', ':items' => '[]', ':history' => '[]',
            ':created_at' => $database->nowUtc(), ':updated_at' => $database->nowUtc(),
        ]
    );
    if ($invokeOperation('nextOrderNumberPreview') === $orderCollisionNumber) {
        throw new RuntimeException('Order preview reused an imported order number.');
    }
    $orderAllocation = $invokeOperation('allocateOrderNumber');
    if (($orderAllocation['orderNumber'] ?? '') === $orderCollisionNumber) {
        throw new RuntimeException('Order allocation reused an imported order number.');
    }

    $billMax = (int) (($database->fetchOne('SELECT COALESCE(MAX(bill_seq), 0) AS value FROM bills') ?? [])['value'] ?? 0);
    $billCollisionSequence = $billMax + 1;
    while ($database->fetchOne('SELECT id FROM bills WHERE bill_number = :number', [':number' => 'Bill-' . $billCollisionSequence]) !== null) {
        $billCollisionSequence++;
    }
    $billCollisionNumber = 'Bill-' . $billCollisionSequence;
    $vendorId = (string) $bill['vendor_id'];
    $database->execute(
        'INSERT INTO bills (id, bill_number, bill_seq, bill_date, vendor_id, created_by, status, items, subtotal, discount, shipping, total, paid_amount, history, created_at, updated_at)
         VALUES (:id, :number, NULL, :date, :vendor, :creator, :status, :items, 0, 0, 0, 0, 0, :history, :created_at, :updated_at)',
        [
            ':id' => 'test-bill-collision-' . substr($stamp, -25), ':number' => $billCollisionNumber,
            ':date' => '2026-07-22', ':vendor' => $vendorId, ':creator' => $actor['id'], ':status' => 'On Hold',
            ':items' => '[]', ':history' => '[]', ':created_at' => $database->nowUtc(), ':updated_at' => $database->nowUtc(),
        ]
    );
    if ($invokeOperation('nextBillNumberPreview') === $billCollisionNumber) {
        throw new RuntimeException('Bill preview reused an imported bill number.');
    }
    $billAllocation = $invokeOperation('allocateBillNumber');
    if (($billAllocation['billNumber'] ?? '') === $billCollisionNumber) {
        throw new RuntimeException('Bill allocation reused an imported bill number.');
    }

    if ($invoke('importProduct', [[
        'name' => $productName, 'category' => 'Test', 'unitName' => $unitName,
        'salePrice' => '120', 'purchasePrice' => '60', 'stock' => '20',
        'image' => 'data:image/svg+xml;base64,' . base64_encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#123456"/></svg>'),
    ], $actor]) !== 'updated') {
        throw new RuntimeException('Product natural-key update failed.');
    }
    $importedProduct = $database->fetchOne('SELECT image FROM products WHERE name = :name', [':name' => $productName]) ?? [];
    $createdImagePath = trim((string) ($importedProduct['image'] ?? ''));
    if (!str_starts_with($createdImagePath, '/uploads/product-images/')) {
        throw new RuntimeException('Packaged product image was not saved into local uploads.');
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
    if (is_string($createdImagePath) && str_starts_with($createdImagePath, '/uploads/product-images/')) {
        $physicalImagePath = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'public' . str_replace('/', DIRECTORY_SEPARATOR, $createdImagePath);
        if (is_file($physicalImagePath)) {
            unlink($physicalImagePath);
        }
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
