<?php

declare(strict_types=1);

use App\Auth;
use App\Config;
use App\Database;
use App\RecurringTransactionApi;
use App\RecurringTransactionProcessor;
use App\RecurringTransactionSchedule;

require_once dirname(__DIR__) . '/backend/bootstrap.php';

$root = dirname(__DIR__);
$assert = static function (bool $condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
};

$assert(
    RecurringTransactionSchedule::nextOccurrence('2026-01-31 09:30:00', 'monthly', '2026-01-31 09:30:00') === '2026-02-28 09:30:00',
    'Monthly schedules must clamp to the final day of shorter months.'
);
$assert(
    RecurringTransactionSchedule::nextOccurrence('2026-02-28 09:30:00', 'monthly', '2026-01-31 09:30:00') === '2026-03-31 09:30:00',
    'Monthly schedules must retain their original day anchor after a short month.'
);
$assert(
    RecurringTransactionSchedule::nextOccurrence('2024-02-29 08:00:00', 'yearly', '2024-02-29 08:00:00') === '2025-02-28 08:00:00',
    'Leap-day yearly schedules must clamp safely in non-leap years.'
);
$assert(
    RecurringTransactionSchedule::nextOccurrence('2026-07-15 00:00:00', 'monthly', '2026-07-15 00:00:00') === '2026-08-15 00:00:00',
    'An early monthly renewal payment must retain the current renewal day.'
);
$assert(
    RecurringTransactionSchedule::nextOccurrence('2026-07-15 00:00:00', 'yearly', '2026-07-15 00:00:00') === '2027-07-15 00:00:00',
    'An early yearly renewal payment must retain the current renewal month and day.'
);

$schemaOnly = (string) file_get_contents($root . '/backend/database/schema-only.sql');
$featureAccess = (string) file_get_contents($root . '/backend/src/FeatureAccess.php');
$publicIndex = (string) file_get_contents($root . '/backend/public/index.php');
$masterData = (string) file_get_contents($root . '/backend/src/MasterDataApi.php');
$cpanelIndex = (string) file_get_contents($root . '/deploy/cpanel-template/public_html/api/index.php');
$page = (string) file_get_contents($root . '/pages/RecurringTransactions.tsx');
$assert(str_contains($schemaOnly, '-- Migration: 2026-08-04_recurring_transactions.sql'), 'schema-only.sql must contain the recurring transaction migration.');
$assert(str_contains($schemaOnly, 'uq_transactions_recurring_occurrence'), 'Generated occurrences need a database idempotency constraint.');
$assert(str_contains($featureAccess, "'fetchRecurringTransactionsPage' => 'recurring_transactions'"), 'Recurring API reads must be capability-gated.');
$assert(str_contains($publicIndex, 'RecurringTransactionScheduler'), 'Normal API traffic must self-start the internal recurring worker.');
$assert(
    str_contains($masterData, 'RecurringTransactionSchedule::nextOccurrence')
        && !str_contains($masterData, "\$base->modify(\$interval === 'yearly' ? '+365 days' : '+30 days')"),
    'Subscription renewal still advances by payment-relative fixed day counts.'
);
$assert(
    str_contains($cpanelIndex, 'new RecurringTransactionScheduler') && str_contains($cpanelIndex, '$recurringTransactions'),
    'The cPanel API wrapper must start and dispatch the recurring transaction module.'
);
$assert(str_contains($page, '<DynamicFilterBar') && str_contains($page, '<Pagination'), 'The recurring page must retain dynamic filters and server pagination.');

$config = Config::load($root);
$database = new Database($config);
$pdo = $database->connect();
$pdo->beginTransaction();

try {
    $user = $database->fetchOne("SELECT id FROM users WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL ORDER BY role ASC LIMIT 1");
    $account = $database->fetchOne('SELECT id, current_balance FROM accounts ORDER BY created_at ASC LIMIT 1');
    $category = $database->fetchOne("SELECT id FROM categories WHERE type = 'Income' ORDER BY created_at ASC LIMIT 1");
    $method = $database->fetchOne('SELECT name FROM payment_methods WHERE is_active = 1 ORDER BY created_at ASC LIMIT 1');
    $capabilityRow = $database->fetchOne('SELECT id, capabilities FROM app_capability_settings LIMIT 1 FOR UPDATE');
    $assert($user !== null && $account !== null && $category !== null && $method !== null && $capabilityRow !== null, 'Local database fixtures required for the recurring transaction probe are missing.');

    $capabilities = json_decode((string) ($capabilityRow['capabilities'] ?? ''), true);
    if (!is_array($capabilities)) $capabilities = [];
    $capabilities['recurring_transactions'] = true;
    $database->execute(
        'UPDATE app_capability_settings SET capabilities = :capabilities WHERE id = :id',
        [':capabilities' => json_encode($capabilities, JSON_UNESCAPED_SLASHES), ':id' => (string) $capabilityRow['id']]
    );

    $auth = new Auth($config, $database);
    $backgroundAuth = $auth->forUserId((string) $user['id']);
    $api = new RecurringTransactionApi($database, $backgroundAuth, $config);
    $created = $api->createRecurringTransaction([
        'type' => 'Income',
        'accountId' => (string) $account['id'],
        'categoryId' => (string) $category['id'],
        'paymentMethod' => (string) $method['name'],
        'amount' => 1,
        'note' => 'Transactional recurring worker probe',
        'interval' => 'daily',
        'startAt' => gmdate('c'),
        'isActive' => true,
    ]);

    $processor = new RecurringTransactionProcessor($database, $auth, $config);
    $result = $processor->processDueBatch(5);
    $assert((int) $result['processed'] === 1 && (int) $result['failed'] === 0, 'The due schedule should create exactly one transaction.');
    $transaction = $database->fetchOne(
        'SELECT id, amount FROM transactions WHERE recurring_transaction_id = :id AND recurring_scheduled_for IS NOT NULL LIMIT 1',
        [':id' => (string) $created['id']]
    );
    $assert($transaction !== null && (float) $transaction['amount'] === 1.0, 'The generated transaction must retain its recurring occurrence link and amount.');
    $secondRun = $processor->processDueBatch(5);
    $assert((int) $secondRun['processed'] === 0, 'A processed occurrence must not be generated twice.');
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
}

echo "Recurring transaction runtime checks passed.\n";
