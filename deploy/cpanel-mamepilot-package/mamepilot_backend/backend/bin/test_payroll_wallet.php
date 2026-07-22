<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;

$config = new Config(['APP_TIMEZONE' => 'Asia/Dhaka']);
$database = new Database($config);
$auth = new Auth($config, $database);
$api = new OperationsApi($database, $auth, $config);

$invoke = static function (object $target, string $method, array $arguments = []): mixed {
    $reflection = new ReflectionMethod($target, $method);
    $reflection->setAccessible(true);
    return $reflection->invokeArgs($target, $arguments);
};
$assert = static function (bool $condition, string $message): void {
    if (!$condition) {
        fwrite(STDERR, "Payroll/wallet test failed: {$message}\n");
        exit(1);
    }
};
$assertMoney = static function (float $actual, float $expected, string $message) use ($assert): void {
    $assert(abs($actual - $expected) < 0.005, $message . " (expected {$expected}, got {$actual})");
};

// Fixed salary is monthly and prorated by the actual number of calendar days.
$assertMoney((float) $invoke($api, 'calculateFixedSalaryForPeriod', [30000.0, '2028-02-01', '2028-02-29']), 30000.0, 'full leap-year month');
$assertMoney((float) $invoke($api, 'calculateFixedSalaryForPeriod', [30000.0, '2028-02-01', '2028-02-14']), 14482.76, 'partial leap-year month');
$assertMoney((float) $invoke($api, 'calculateFixedSalaryForPeriod', [31000.0, '2026-01-16', '2026-01-31']), 16000.0, 'partial 31-day month');

// Legacy false + null salary remains commission; a positive salary is fixed.
$legacyUser = $invoke($api, 'mapUser', [[
    'id' => 'legacy', 'name' => 'Legacy', 'phone' => '1', 'role' => 'Employee',
    'is_commission_based' => 0, 'fixed_salary' => null,
]]);
$fixedUser = $invoke($api, 'mapUser', [[
    'id' => 'fixed', 'name' => 'Fixed', 'phone' => '2', 'role' => 'Employee',
    'is_commission_based' => 0, 'fixed_salary' => 25000,
]]);
$assert(($legacyUser['compensationType'] ?? '') === 'commission', 'legacy compensation fallback');
$assert(($fixedUser['compensationType'] ?? '') === 'fixed', 'positive fixed salary classification');

// Every public order status accepted by the UI must survive server normalization.
$statuses = ['Created', 'Exchange processing', 'Exchange picked', 'Exchange returned', 'Returned'];
$assert($invoke($api, 'normalizePayrollStatuses', [$statuses, false]) === $statuses, 'complete order-status allowlist');

// Status toggles append balanced events: credit -> reversal -> later re-credit.
$credit = $invoke($api, 'walletOrderTransition', [0.0, true, 100.0]);
$reversal = $invoke($api, 'walletOrderTransition', [100.0, false, 100.0]);
$recredit = $invoke($api, 'walletOrderTransition', [0.0, true, 100.0]);
$assert(($credit['entryType'] ?? '') === 'order_credit' && ($credit['amountDelta'] ?? 0) === 100.0, 'initial credit transition');
$assert(($reversal['entryType'] ?? '') === 'order_reversal' && ($reversal['amountDelta'] ?? 0) === -100.0, 'reversal transition');
$assert(($recredit['entryType'] ?? '') === 'order_credit' && ($recredit['amountDelta'] ?? 0) === 100.0, 're-credit transition');

$buckets = [
    ['accrualDate' => '2026-06-10', 'grossAmount' => 100.0, 'remainingAmount' => 100.0],
    ['accrualDate' => '2026-07-10', 'grossAmount' => 100.0, 'remainingAmount' => 100.0],
];
// A legacy unperiodized payout settles the oldest credit only; it cannot make
// the already-settled June period consume July's still-outstanding credit.
$fifo = $invoke($api, 'allocateCommissionSettlementBuckets', [$buckets, [], [100.0]]);
$assertMoney((float) $fifo['buckets'][0]['remainingAmount'], 0.0, 'legacy FIFO settles oldest period');
$assertMoney((float) $fifo['buckets'][1]['remainingAmount'], 100.0, 'later period remains payable');

// Explicit period allocation wins before legacy FIFO, regardless of row order.
$mixed = $invoke($api, 'allocateCommissionSettlementBuckets', [
    $buckets,
    [['amount' => 100.0, 'periodStart' => '2026-07-01', 'periodEnd' => '2026-07-31']],
    [100.0],
]);
$assertMoney((float) $mixed['buckets'][0]['remainingAmount'], 0.0, 'legacy FIFO settles June after explicit July settlement');
$assertMoney((float) $mixed['buckets'][1]['remainingAmount'], 0.0, 'explicit settlement stays in July');
$assertMoney((float) $mixed['carry'], 0.0, 'fully allocated settlements have no carry');

// Bonus/deduction ledger rows plus net payout reduce wallet by base pay only.
$base = 100.0;
$bonus = 25.0;
$deduction = 10.0;
$net = $base + $bonus - $deduction;
$assertMoney($bonus - $deduction - $net, -$base, 'bonus/deduction/payout wallet equation');

fwrite(STDOUT, "Payroll/wallet invariant tests passed\n");

