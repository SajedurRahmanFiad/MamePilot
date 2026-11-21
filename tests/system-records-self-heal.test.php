<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\MasterDataApi;

function systemRecordsSelfHealAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
try {
    $config = Config::load($root);
    $database = new Database($config);
    $pdo = $database->connect();
} catch (Throwable $exception) {
    echo "System-record self-heal integration test skipped: database unavailable.\n";
    exit(0);
}

$pdo->exec('DROP TEMPORARY TABLE IF EXISTS categories');
$pdo->exec('DROP TEMPORARY TABLE IF EXISTS payment_methods');
$pdo->exec(
    "CREATE TEMPORARY TABLE categories (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        type VARCHAR(32) NOT NULL,
        color VARCHAR(16) NOT NULL,
        is_system TINYINT(1) NOT NULL DEFAULT 0,
        parent_id VARCHAR(64) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_categories_name_type (name, type)
    )"
);
$pdo->exec(
    "CREATE TEMPORARY TABLE payment_methods (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_payment_methods_name (name)
    )"
);

try {
    $master = new MasterDataApi($database, new Auth($config, $database), $config);
    $categories = $master->fetchCategories();
    $paymentMethods = $master->fetchPaymentMethods(['activeOnly' => false]);

    $expectedCategories = [
        'income_sales' => ['Sales', 'Income'],
        'expense_purchases' => ['Purchases', 'Expense'],
        'expense_shipping' => ['Shipping Costs', 'Expense'],
    ];
    foreach ($expectedCategories as $id => [$name, $type]) {
        $category = array_values(array_filter($categories, static fn(array $row): bool => $row['id'] === $id))[0] ?? null;
        systemRecordsSelfHealAssert(
            $category !== null && $category['name'] === $name && $category['type'] === $type && $category['isSystem'],
            "Missing or invalid self-healed category: {$id}."
        );
    }
    systemRecordsSelfHealAssert(
        count(array_filter($paymentMethods, static fn(array $row): bool => $row['id'] === 'cash' && $row['name'] === 'Cash' && $row['isActive'])) === 1,
        'The Cash payment method was not self-healed.'
    );

    $master->fetchCategories();
    $master->fetchPaymentMethods(['activeOnly' => false]);
    systemRecordsSelfHealAssert(
        (int) $pdo->query('SELECT COUNT(*) FROM categories')->fetchColumn() === 3
            && (int) $pdo->query('SELECT COUNT(*) FROM payment_methods')->fetchColumn() === 1,
        'Repeated list fetches created duplicate system records.'
    );
} finally {
    $pdo->exec('DROP TEMPORARY TABLE IF EXISTS categories');
    $pdo->exec('DROP TEMPORARY TABLE IF EXISTS payment_methods');
}

echo "System-record self-heal integration tests passed.\n";