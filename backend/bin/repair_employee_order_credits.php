<?php

declare(strict_types=1);

use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;

require_once dirname(__DIR__) . '/bootstrap.php';

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$auth = new Auth($config, $database);
$operations = new OperationsApi($database, $auth, $config);

$readWalletTotals = static function () use ($database): array {
    $rows = $database->fetchAll(
        "SELECT employee_id, entry_type, COUNT(*) AS entry_count, COALESCE(SUM(amount_delta), 0) AS amount_total
         FROM wallet_entries
         WHERE entry_type IN ('order_credit', 'order_reversal')
         GROUP BY employee_id, entry_type"
    );
    $totals = [];
    foreach ($rows as $row) {
        $employeeId = trim((string) ($row['employee_id'] ?? ''));
        $entryType = trim((string) ($row['entry_type'] ?? ''));
        if ($employeeId === '' || $entryType === '') {
            continue;
        }
        $totals[$employeeId][$entryType] = [
            'count' => (int) ($row['entry_count'] ?? 0),
            'amount' => (float) ($row['amount_total'] ?? 0),
        ];
    }

    return $totals;
};

$settings = $operations->fetchWalletSettings();
$syncMethod = new ReflectionMethod($operations, 'syncWalletCreditsForPayableStatuses');
$syncMethod->setAccessible(true);

try {
    $result = $database->transaction(static function () use ($database, $readWalletTotals, $syncMethod, $operations, $settings): array {
        $before = $readWalletTotals();
        $syncMethod->invoke($operations, $settings);
        $after = $readWalletTotals();

        return [$before, $after];
    });
} catch (Throwable $exception) {
    fwrite(STDERR, "Employee order-credit repair failed; the database transaction was rolled back.\n");
    fwrite(STDERR, $exception->getMessage() . "\n");
    exit(1);
}

[$before, $after] = $result;
$employeeIds = array_values(array_unique(array_merge(array_keys($before), array_keys($after))));
$changes = [];
$addedCredits = 0;
$addedReversals = 0;
$addedCreditAmount = 0.0;

foreach ($employeeIds as $employeeId) {
    $creditCount = (int) ($after[$employeeId]['order_credit']['count'] ?? 0)
        - (int) ($before[$employeeId]['order_credit']['count'] ?? 0);
    $creditAmount = (float) ($after[$employeeId]['order_credit']['amount'] ?? 0)
        - (float) ($before[$employeeId]['order_credit']['amount'] ?? 0);
    $reversalCount = (int) ($after[$employeeId]['order_reversal']['count'] ?? 0)
        - (int) ($before[$employeeId]['order_reversal']['count'] ?? 0);

    if ($creditCount === 0 && $reversalCount === 0) {
        continue;
    }

    $employee = $database->fetchOne(
        'SELECT name FROM users WHERE id = :id LIMIT 1',
        [':id' => $employeeId]
    );
    $changes[] = [
        'name' => (string) ($employee['name'] ?? $employeeId),
        'credits' => $creditCount,
        'creditAmount' => $creditAmount,
        'reversals' => $reversalCount,
    ];
    $addedCredits += $creditCount;
    $addedCreditAmount += $creditAmount;
    $addedReversals += $reversalCount;
}

echo "Employee order-credit repair completed using current payroll commission settings.\n";
if ($changes === []) {
    echo "No wallet changes were needed; eligible order credits are already reconciled.\n";
    exit(0);
}

foreach ($changes as $change) {
    printf(
        "%s: %d credits (%0.2f added), %d reversals\n",
        $change['name'],
        $change['credits'],
        $change['creditAmount'],
        $change['reversals']
    );
}
printf(
    "Total: %d credits (%0.2f added), %d reversals.\n",
    $addedCredits,
    $addedCreditAmount,
    $addedReversals
);
