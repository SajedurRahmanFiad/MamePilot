<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;

function dashboardRecordedPurchaseAssertMoney(float $actual, float $expected, string $label): void
{
    if (abs($actual - $expected) > 0.001) {
        throw new RuntimeException("{$label}: expected {$expected}, got {$actual}");
    }
}

$root = dirname(__DIR__);
$config = Config::load($root);
$database = new Database($config);
$auth = new Auth($config, $database);
$operations = new OperationsApi($database, $auth, $config);
$pdo = $database->connect();
$actor = $database->fetchOne(
    "SELECT id, name, phone, role
     FROM users
     WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL
     ORDER BY created_at ASC
     LIMIT 1"
);

if ($actor === null) {
    throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
}

$account = $database->fetchOne('SELECT id FROM accounts ORDER BY created_at ASC LIMIT 1');
if ($account === null) {
    throw new RuntimeException('A local account is required for the dashboard profit runtime test.');
}

$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);
$stamp = str_replace('.', '', uniqid('dashboard-profit-', true));
$createdAt = '2001-01-15 12:00:00';

$pdo->beginTransaction();
try {
    $capabilityRow = $database->fetchOne('SELECT id, capabilities FROM app_capability_settings LIMIT 1');
    if ($capabilityRow === null) {
        throw new RuntimeException('App capability settings are unavailable.');
    }

    $capabilities = json_decode((string) ($capabilityRow['capabilities'] ?? '{}'), true);
    if (!is_array($capabilities)) {
        $capabilities = [];
    }
    $capabilities['purchases'] = false;
    $capabilities['banking'] = true;
    $database->execute(
        'UPDATE app_capability_settings SET capabilities = :capabilities WHERE id = :id',
        [':capabilities' => json_encode($capabilities), ':id' => $capabilityRow['id']]
    );
    $database->execute('UPDATE system_defaults SET calculate_cogs_from_purchase_price = 0');

    $insertTransaction = static function (
        string $id,
        string $type,
        string $category,
        float $amount,
        ?string $referenceId
    ) use ($database, $account, $actor, $createdAt): void {
        $database->execute(
            'INSERT INTO transactions
                (id, date, type, category, account_id, amount, description, reference_id,
                 payment_method, created_by, history, created_at, updated_at)
             VALUES
                (:id, :date, :type, :category, :account_id, :amount, :description, :reference_id,
                 :payment_method, :created_by, :history, :created_at, :updated_at)',
            [
                ':id' => $id,
                ':date' => $createdAt,
                ':type' => $type,
                ':category' => $category,
                ':account_id' => $account['id'],
                ':amount' => $amount,
                ':description' => 'Dashboard recorded-purchase profit regression fixture',
                ':reference_id' => $referenceId,
                ':payment_method' => 'Cash',
                ':created_by' => $actor['id'],
                ':history' => '{}',
                ':created_at' => $createdAt,
                ':updated_at' => $createdAt,
            ]
        );
    };

    $insertTransaction(substr($stamp . '-income', 0, 64), 'Income', 'income_sales', 1000, 'fixture-order');
    $insertTransaction(substr($stamp . '-purchase', 0, 64), 'Expense', 'expense_purchases', 300, 'fixture-bill');
    $insertTransaction(substr($stamp . '-expense', 0, 64), 'Expense', 'expense_other', 100, null);

    $snapshot = $operations->fetchDashboardSnapshot([
        'filterRange' => 'Custom',
        'customDates' => ['from' => '2001-01-15', 'to' => '2001-01-15'],
    ]);
    $admin = $snapshot['admin'] ?? null;
    if (!is_array($admin)) {
        throw new RuntimeException('Admin dashboard snapshot is unavailable.');
    }

    dashboardRecordedPurchaseAssertMoney((float) ($admin['totalSales'] ?? 0), 1000, 'Total sales');
    dashboardRecordedPurchaseAssertMoney((float) ($admin['totalPurchases'] ?? 0), 300, 'Total purchases');
    dashboardRecordedPurchaseAssertMoney((float) ($admin['otherExpenses'] ?? 0), 100, 'Other expenses');
    dashboardRecordedPurchaseAssertMoney((float) ($admin['totalProfit'] ?? 0), 600, 'Total profit');

    echo "Dashboard recorded-purchase profit runtime test passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
