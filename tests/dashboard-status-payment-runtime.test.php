<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;

function dashboardStatusPaymentAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = dirname(__DIR__);
$config = Config::load($root);
$database = new Database($config);
$auth = new Auth($config, $database);
$operations = new OperationsApi($database, $auth, $config);

$actor = $database->fetchOne(
    "SELECT id, name, phone, role FROM users WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1"
);
if ($actor === null) throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

$snapshot = $operations->fetchDashboardSnapshot(['filterRange' => 'All Time']);
$admin = is_array($snapshot['admin'] ?? null) ? $snapshot['admin'] : [];
$orderCounts = is_array($admin['orderCounts'] ?? null) ? $admin['orderCounts'] : [];
$orderTotals = is_array($admin['orderTotals'] ?? null) ? $admin['orderTotals'] : [];
$paymentCounts = is_array($admin['paymentCounts'] ?? null) ? $admin['paymentCounts'] : [];
$paymentTotals = is_array($admin['paymentTotals'] ?? null) ? $admin['paymentTotals'] : [];

$exchangeKeys = ['exchangeProcessing', 'exchangePicked', 'exchangeDelivered', 'exchangeReturned', 'exchangeCancelled'];
$paymentKeys = ['paid', 'partiallyPaid', 'unpaid', 'overpaid', 'refunded'];
foreach (['courierAssigned', 'exchangeTotal', ...$exchangeKeys] as $key) {
    dashboardStatusPaymentAssert(array_key_exists($key, $orderCounts), "Order count metric {$key} is missing.");
    dashboardStatusPaymentAssert(array_key_exists($key, $orderTotals), "Order total metric {$key} is missing.");
}
foreach ($paymentKeys as $key) {
    dashboardStatusPaymentAssert(array_key_exists($key, $paymentCounts), "Payment count metric {$key} is missing.");
    dashboardStatusPaymentAssert(array_key_exists($key, $paymentTotals), "Payment total metric {$key} is missing.");
}

$exchangeCount = array_sum(array_map(static fn(string $key): int => (int) $orderCounts[$key], $exchangeKeys));
$exchangeTotal = array_sum(array_map(static fn(string $key): float => (float) $orderTotals[$key], $exchangeKeys));
dashboardStatusPaymentAssert($exchangeCount === (int) $orderCounts['exchangeTotal'], 'The Exchanged Orders count does not equal its exact exchange statuses.');
dashboardStatusPaymentAssert(abs($exchangeTotal - (float) $orderTotals['exchangeTotal']) < 0.01, 'The Exchanged Orders total does not equal its exact exchange statuses.');
dashboardStatusPaymentAssert(array_sum($paymentCounts) === (int) $orderCounts['total'], 'Payment-status counts do not cover all dashboard orders.');
dashboardStatusPaymentAssert(abs(array_sum($paymentTotals) - (float) $orderTotals['total']) < 0.01, 'Payment-status totals do not cover all dashboard order value.');

echo "Dashboard exact-status and payment-status runtime test passed.\n";
