<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;

function transactionCategoryFilterAssert(bool $condition, string $message): void
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
} catch (Throwable) {
    echo "Multi-category transaction filter test skipped: database unavailable.\n";
    exit(0);
}

$pdo->exec('DROP TEMPORARY TABLE IF EXISTS transactions_with_relations');
$pdo->exec(
    "CREATE TEMPORARY TABLE transactions_with_relations (
        id VARCHAR(64) NOT NULL PRIMARY KEY,
        date DATETIME NULL,
        type VARCHAR(32) NOT NULL,
        category VARCHAR(64) NULL,
        accountId VARCHAR(64) NULL,
        accountName VARCHAR(255) NULL,
        toAccountId VARCHAR(64) NULL,
        amount DECIMAL(12,2) NOT NULL DEFAULT 0,
        description TEXT NULL,
        referenceId VARCHAR(64) NULL,
        contactId VARCHAR(64) NULL,
        contactName VARCHAR(255) NULL,
        contactType VARCHAR(32) NULL,
        paymentMethod VARCHAR(255) NULL,
        attachmentName TEXT NULL,
        attachmentUrl TEXT NULL,
        createdBy VARCHAR(64) NULL,
        creatorName VARCHAR(255) NULL,
        approvalStatus VARCHAR(32) NULL,
        accountEffectApplied TINYINT(1) NULL,
        approvalRequestedAt DATETIME NULL,
        approvedAt DATETIME NULL,
        declinedAt DATETIME NULL,
        approvalNote TEXT NULL,
        createdAt DATETIME NULL,
        deletedAt DATETIME NULL,
        deletedBy VARCHAR(64) NULL
    )"
);
$pdo->exec(
    "INSERT INTO transactions_with_relations (id, date, type, category, amount, createdAt) VALUES
        ('sales', NOW(), 'Income', 'income_sales', 100, NOW()),
        ('shipping', NOW(), 'Expense', 'expense_shipping', 20, NOW()),
        ('office', NOW(), 'Expense', 'expense_office', 5, NOW())"
);

try {
    $operations = new OperationsApi($database, new Auth($config, $database), $config);
    $excluded = $operations->fetchTransactionsPage([
        'page' => 1,
        'pageSize' => 10,
        'filters' => ['categoryNot' => 'income_sales,expense_shipping'],
    ]);
    transactionCategoryFilterAssert(
        (int) $excluded['count'] === 1 && ($excluded['data'][0]['category'] ?? null) === 'expense_office',
        'The multi-category exclusion did not remove both selected categories.'
    );

    $included = $operations->fetchTransactionsPage([
        'page' => 1,
        'pageSize' => 10,
        'filters' => ['category' => 'income_sales,expense_shipping'],
    ]);
    $includedCategories = array_column($included['data'], 'category');
    sort($includedCategories);
    transactionCategoryFilterAssert(
        (int) $included['count'] === 2 && $includedCategories === ['expense_shipping', 'income_sales'],
        'The multi-category inclusion did not match both selected categories.'
    );
} finally {
    $pdo->exec('DROP TEMPORARY TABLE IF EXISTS transactions_with_relations');
}

echo "Multi-category transaction filter tests passed.\n";