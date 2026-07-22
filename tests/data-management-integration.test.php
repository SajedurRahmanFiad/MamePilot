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
$admin = $database->fetchOne(
    "SELECT id, name, phone, role FROM users WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1"
);
if ($admin === null) {
    throw new RuntimeException('Local integration administrator is unavailable.');
}
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($admin);
$settingsDefinitions = $invoke('settingsTabDefinitions', []);
$settingsExport = $api->exportSettingsPackage(['tabs' => array_keys($settingsDefinitions)]);
if (array_keys($settingsExport['tabs'] ?? []) !== array_keys($settingsDefinitions)) {
    throw new RuntimeException('The Settings package did not export every selected tab.');
}

$stamp = str_replace('.', '', uniqid('friendly-csv-', true));
$phone = '01' . substr((string) preg_replace('/\D/', '', $stamp), -9);
$customerPhone = $phone . '1';
$vendorPhone = $phone . '2';
$productName = 'Friendly Product ' . $stamp;
$catalogProductName = 'Friendly Catalog Product ' . $stamp;
$orderNumber = 'FRIENDLY-ORD-' . $stamp;
$billNumber = 'FRIENDLY-BILL-' . $stamp;
$transactionNumber = 'FRIENDLY-TXN-' . $stamp;
$accountName = 'Friendly Account ' . $stamp;
$unitName = 'Friendly Unit ' . substr($stamp, -8);
$paymentMethodName = 'Friendly Payment ' . substr($stamp, -8);
$createdImagePath = null;

$pdo = $database->connect();
$pdo->beginTransaction();
try {
    $settingsRoundTrip = $api->importSettingsPackage([
        'package' => $settingsExport,
        'selectedTabs' => array_keys($settingsDefinitions),
    ]);
    if (($settingsRoundTrip['failed'] ?? 0) !== 0) {
        $firstSettingsError = $settingsRoundTrip['errors'][0]['message'] ?? 'Unknown Settings import error.';
        throw new RuntimeException('Settings round-trip failed: ' . $firstSettingsError);
    }

    if ($invoke('importUser', [[
        'name' => 'Friendly CSV User',
        'phone' => $phone,
        'role' => 'Employee',
        'password' => 'temporary-test-password',
        'isCommissionBased' => 'yes',
    ]]) !== 'created') {
        throw new RuntimeException('User create failed.');
    }
    if ($invoke('importUser', [[
        'name' => 'Should Not Replace Existing User',
        'phone' => $phone,
        'role' => 'Admin',
    ]]) !== 'skipped') {
        throw new RuntimeException('Existing user was not skipped.');
    }
    $preservedUser = $database->fetchOne('SELECT name, role FROM users WHERE phone = :phone', [':phone' => $phone]) ?? [];
    if (($preservedUser['name'] ?? '') !== 'Friendly CSV User' || ($preservedUser['role'] ?? '') !== 'Employee') {
        throw new RuntimeException('Skipped user data was overwritten.');
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

    $changedOrderRows = $orderRows;
    $changedOrderRows[0]['rate'] = '999';
    $changedOrderRows[1]['rate'] = '999';
    $changedOrderWork = $invoke('prepareImportWorkItems', ['orders', $changedOrderRows, 0]);
    if ($invoke('importOrder', [$changedOrderWork[0]['row'], $actor]) !== 'skipped') {
        throw new RuntimeException('Existing order was not skipped.');
    }
    $preservedOrder = $database->fetchOne('SELECT total FROM orders WHERE order_number = :number', [':number' => $orderNumber]) ?? [];
    if (abs((float) ($preservedOrder['total'] ?? 0) - 245) > 0.001) {
        throw new RuntimeException('Skipped order data was overwritten.');
    }

    if ($invoke('importCustomer', [[
        'name' => 'Friendly Customer Updated', 'phone' => $customerPhone, 'address' => 'Chattogram',
    ], $actor]) !== 'skipped') {
        throw new RuntimeException('Existing customer was not skipped.');
    }
    $customer = $database->fetchOne(
        'SELECT total_orders, due_amount, address FROM customers WHERE phone = :phone',
        [':phone' => $customerPhone]
    );
    if ((int) $customer['total_orders'] !== 1 || abs((float) $customer['due_amount'] - 220) > 0.001 || $customer['address'] !== 'Dhaka') {
        throw new RuntimeException('Skipped customer data or calculated summaries changed unexpectedly.');
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
    $changedBillRows = $billRows;
    $changedBillRows[0]['rate'] = '999';
    $changedBillWork = $invoke('prepareImportWorkItems', ['bills', $changedBillRows, 0]);
    if ($invoke('importBill', [$changedBillWork[0]['row'], $actor]) !== 'skipped') {
        throw new RuntimeException('Existing bill was not skipped.');
    }
    if ($invoke('importVendor', [[
        'name' => 'Friendly Vendor Updated', 'phone' => $vendorPhone, 'address' => 'Narayanganj',
    ], $actor]) !== 'skipped') {
        throw new RuntimeException('Existing vendor was not skipped.');
    }
    $preservedVendor = $database->fetchOne('SELECT name, address FROM vendors WHERE phone = :phone', [':phone' => $vendorPhone]) ?? [];
    if (($preservedVendor['name'] ?? '') !== 'Friendly Vendor' || ($preservedVendor['address'] ?? '') !== 'Dhaka') {
        throw new RuntimeException('Skipped vendor data was overwritten.');
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
        'name' => $catalogProductName, 'category' => 'Test', 'unitName' => $unitName,
        'salePrice' => '120', 'purchasePrice' => '60', 'stock' => '20',
        'image' => 'data:image/svg+xml;base64,' . base64_encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#123456"/></svg>'),
    ], $actor]) !== 'created') {
        throw new RuntimeException('New catalog product import failed.');
    }
    $importedProduct = $database->fetchOne('SELECT image FROM products WHERE name = :name', [':name' => $catalogProductName]) ?? [];
    $createdImagePath = trim((string) ($importedProduct['image'] ?? ''));
    if (!str_starts_with($createdImagePath, '/uploads/product-images/')) {
        throw new RuntimeException('Packaged product image was not saved into local uploads.');
    }
    if ($database->fetchOne('SELECT id FROM units WHERE name = :name', [':name' => $unitName]) === null) {
        throw new RuntimeException('Product import did not auto-create its unit.');
    }
    if ($invoke('importProduct', [[
        'name' => $catalogProductName, 'category' => 'Should Not Replace', 'unitName' => $unitName,
        'salePrice' => '999', 'purchasePrice' => '999', 'stock' => '999',
    ], $actor]) !== 'skipped') {
        throw new RuntimeException('Existing product was not skipped.');
    }
    $preservedProduct = $database->fetchOne('SELECT category, sale_price, stock FROM products WHERE name = :name', [':name' => $catalogProductName]) ?? [];
    if (($preservedProduct['category'] ?? '') !== 'Test' || abs((float) ($preservedProduct['sale_price'] ?? 0) - 120) > 0.001 || (int) ($preservedProduct['stock'] ?? 0) !== 20) {
        throw new RuntimeException('Skipped product data was overwritten.');
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
    if ($invoke('importTransaction', [$transaction, $actor]) !== 'skipped') {
        throw new RuntimeException('Existing transaction was not skipped.');
    }
    $accountAfter = $database->fetchOne('SELECT current_balance FROM accounts WHERE id = :id', [':id' => $account['id']]);
    if (abs((float) $accountAfter['current_balance'] - 25) > 0.001) {
        throw new RuntimeException('Skipped transaction changed the account balance.');
    }
    if ($invoke('importAccount', [[
        'name' => $accountName, 'type' => 'Bank', 'openingBalance' => '999', 'currentBalance' => '999',
    ]]) !== 'skipped') {
        throw new RuntimeException('Existing transaction account was not skipped.');
    }
    $accountAfterAccountImport = $database->fetchOne('SELECT type, current_balance FROM accounts WHERE id = :id', [':id' => $account['id']]) ?? [];
    if (($accountAfterAccountImport['type'] ?? '') !== 'Cash' || abs((float) ($accountAfterAccountImport['current_balance'] ?? 0) - 25) > 0.001) {
        throw new RuntimeException('Skipped account data was overwritten.');
    }
    $linked = $database->fetchOne(
        'SELECT reference_id, contact_id FROM transactions WHERE transaction_id = :id',
        [':id' => $transactionNumber]
    );
    if ($linked === null || trim((string) $linked['reference_id']) === '' || trim((string) $linked['contact_id']) === '') {
        throw new RuntimeException('Friendly transaction references were not resolved.');
    }

    $settingsPaymentPackage = [
        'app' => 'MamePilot',
        'entity' => 'settings',
        'tabs' => [
            'payments' => [
                'label' => 'Payment Methods',
                'tables' => ['payment_methods' => [[
                    'name' => $paymentMethodName, 'description' => 'Original description', 'is_active' => 1,
                ]]],
            ],
        ],
    ];
    $settingsPaymentCounts = $api->importSettingsPackage([
        'package' => $settingsPaymentPackage,
        'selectedTabs' => ['payments'],
    ]);
    if (($settingsPaymentCounts['recordsCreated'] ?? 0) !== 1) {
        throw new RuntimeException('New Settings payment method was not appended.');
    }
    $settingsPaymentPackage['tabs']['payments']['tables']['payment_methods'][0]['description'] = 'Should not replace';
    $settingsPaymentPackage['tabs']['payments']['tables']['payment_methods'][0]['is_active'] = 0;
    $settingsPaymentSkip = $api->importSettingsPackage([
        'package' => $settingsPaymentPackage,
        'selectedTabs' => ['payments'],
    ]);
    $preservedPaymentMethod = $database->fetchOne(
        'SELECT description, is_active FROM payment_methods WHERE name = :name',
        [':name' => $paymentMethodName]
    ) ?? [];
    if (($settingsPaymentSkip['recordsSkipped'] ?? 0) !== 1 || ($preservedPaymentMethod['description'] ?? '') !== 'Original description' || (int) ($preservedPaymentMethod['is_active'] ?? 0) !== 1) {
        throw new RuntimeException('Settings list import overwrote an existing payment method.');
    }

    echo "Friendly no-ID import, grouping, append-only skip, auto-create, and balance checks passed.\n";
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
    ['products', 'name', $productName], ['products', 'name', $catalogProductName], ['orders', 'order_number', $orderNumber], ['bills', 'bill_number', $billNumber],
    ['transactions', 'transaction_id', $transactionNumber], ['accounts', 'name', $accountName], ['units', 'name', $unitName],
    ['payment_methods', 'name', $paymentMethodName],
];
foreach ($checks as [$table, $column, $value]) {
    if ($database->fetchOne("SELECT id FROM `{$table}` WHERE `{$column}` = :value", [':value' => $value]) !== null) {
        throw new RuntimeException('Rollback left a test record in ' . $table . '.');
    }
}
echo "Rollback cleanup verification passed.\n";
