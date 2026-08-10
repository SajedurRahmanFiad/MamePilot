<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$auditScript = __DIR__ . '/audit-order-product-integrity.php';
$dumpPath = $argv[1] ?? (__DIR__ . '/bdhatbela_rifababyshop.sql');
$outputPath = $argv[2] ?? (__DIR__ . '/bdhatbela_rifababyshop_product_repair.sql');

$auditOutputPath = tempnam(sys_get_temp_dir(), 'mamepilot-order-audit-');
if ($auditOutputPath === false) {
    throw new RuntimeException('Could not allocate a temporary audit output file.');
}
$command = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($auditScript) . ' ' . escapeshellarg($dumpPath)
    . ' ' . escapeshellarg('--output=' . $auditOutputPath);
exec($command, $ignoredOutput, $exitCode);
$json = $exitCode === 0 ? file_get_contents($auditOutputPath) : false;
@unlink($auditOutputPath);
$audit = is_string($json) ? json_decode($json, true) : null;
if (!is_array($audit) || !is_array($audit['repairPlan'] ?? null)) {
    throw new RuntimeException('Could not build the repair plan from the SQL dump audit.');
}

/** SQL string literal for utf8mb4 data. */
function sqlString(?string $value): string
{
    if ($value === null) return 'NULL';
    return "'" . strtr($value, ["\\" => "\\\\", "'" => "''", "\0" => "\\0"]) . "'";
}

/** @param array<int, string> $values */
function sqlIn(array $values): string
{
    return implode(', ', array_map(static fn(string $value): string => sqlString($value), $values));
}

$plan = $audit['repairPlan'];
$orders = $plan['orders'];
$stocks = array_values(array_filter($plan['stocks'], static fn(array $row): bool => (int) $row['delta'] !== 0));
$undoEvents = $plan['undoEvents'];
$cogsRows = $plan['cogs'];
$orderIds = array_values(array_unique(array_map('strval', array_column($orders, 'id'))));
$productIds = array_values(array_unique(array_map('strval', array_column($stocks, 'id'))));
$undoIds = array_values(array_unique(array_map('strval', array_column($undoEvents, 'id'))));
$cogsIds = array_values(array_unique(array_map('strval', array_column($cogsRows, 'id'))));
$transactionIds = array_values(array_unique(array_filter(array_map('strval', array_column($cogsRows, 'transactionId')))));

$sql = [];
$sql[] = '-- MamePilot production repair generated from tests/bdhatbela_rifababyshop.sql';
$sql[] = '-- Generated: ' . gmdate('Y-m-d H:i:s') . ' UTC';
$sql[] = '-- Scope: 41 orders with proven repurposed bundle product IDs.';
$sql[] = '-- This preserves historical item names and changes only product IDs plus dependent stock/COGS/Undoer data.';
$sql[] = '-- Keep maintenance mode enabled and take a fresh database backup before execution.';
$sql[] = '';
$sql[] = 'SET NAMES utf8mb4;';
$sql[] = 'SET @repair_tag = ' . sqlString('bdhatbela_product_identity_20260811') . ';';
$sql[] = '';

$backupTables = [
    'orders' => 'repair_20260811_orders',
    'products' => 'repair_20260811_products',
    'order_status_undo_events' => 'repair_20260811_undo_events',
    'order_cogs_expenses' => 'repair_20260811_cogs',
    'transactions' => 'repair_20260811_transactions',
];
foreach ($backupTables as $source => $backup) {
    $sql[] = "CREATE TABLE IF NOT EXISTS `{$backup}` LIKE `{$source}`;";
}
$sql[] = '';
$sql[] = 'INSERT IGNORE INTO `repair_20260811_orders` SELECT * FROM `orders` WHERE id IN (' . sqlIn($orderIds) . ');';
$sql[] = 'INSERT IGNORE INTO `repair_20260811_products` SELECT * FROM `products` WHERE id IN (' . sqlIn($productIds) . ');';
$sql[] = 'INSERT IGNORE INTO `repair_20260811_undo_events` SELECT * FROM `order_status_undo_events` WHERE id IN (' . sqlIn($undoIds) . ');';
$sql[] = 'INSERT IGNORE INTO `repair_20260811_cogs` SELECT * FROM `order_cogs_expenses` WHERE id IN (' . sqlIn($cogsIds) . ');';
if ($transactionIds !== []) {
    $sql[] = 'INSERT IGNORE INTO `repair_20260811_transactions` SELECT * FROM `transactions` WHERE id IN (' . sqlIn($transactionIds) . ');';
}
$sql[] = '';
$sql[] = 'DROP PROCEDURE IF EXISTS `repair_20260811_assert`;';
$sql[] = 'DELIMITER //';
$sql[] = 'CREATE PROCEDURE `repair_20260811_assert`(IN condition_ok BOOLEAN, IN failure_message VARCHAR(255))';
$sql[] = 'BEGIN';
$sql[] = "  IF condition_ok IS NULL OR condition_ok = 0 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = failure_message; END IF;";
$sql[] = 'END//';
$sql[] = 'DELIMITER ;';
$sql[] = '';
$sql[] = 'START TRANSACTION;';
$sql[] = "CALL `repair_20260811_assert`((SELECT COUNT(*) FROM app_capability_settings WHERE maintenance_enabled = 1) >= 1, 'Maintenance mode must remain enabled.');";
$sql[] = "CALL `repair_20260811_assert`((SELECT COUNT(*) FROM repair_20260811_orders) = " . count($orderIds) . ", 'Order backup count mismatch.');";
$sql[] = "CALL `repair_20260811_assert`((SELECT COUNT(*) FROM repair_20260811_products) = " . count($productIds) . ", 'Product backup count mismatch.');";
$sql[] = '';

foreach ($orders as $row) {
    $sql[] = sprintf(
        'UPDATE orders SET items = %s WHERE id = %s AND BINARY items = BINARY %s;',
        sqlString((string) $row['afterItems']),
        sqlString((string) $row['id']),
        sqlString((string) $row['beforeItems'])
    );
    $sql[] = 'CALL `repair_20260811_assert`(ROW_COUNT() = 1, ' . sqlString('Order precondition failed: ' . $row['order']) . ');';
}
$sql[] = '';

foreach ($stocks as $row) {
    $sql[] = sprintf(
        'UPDATE products SET stock = %d, updated_at = updated_at WHERE id = %s AND stock = %d;',
        (int) $row['afterStock'],
        sqlString((string) $row['id']),
        (int) $row['beforeStock']
    );
    $sql[] = 'CALL `repair_20260811_assert`(ROW_COUNT() = 1, ' . sqlString('Product stock precondition failed: ' . $row['id']) . ');';
}
$sql[] = '';

foreach ($undoEvents as $event) {
    $set = [];
    $where = ['id = ' . sqlString((string) $event['id'])];
    foreach ($event['changes'] as $column => $change) {
        if (!in_array($column, ['before_snapshot', 'after_snapshot', 'stock_deltas'], true)) {
            throw new RuntimeException("Unsupported Undoer repair column: {$column}");
        }
        $set[] = "`{$column}` = " . sqlString((string) $change['after']);
        $where[] = "BINARY `{$column}` = BINARY " . sqlString((string) $change['before']);
    }
    $sql[] = 'UPDATE order_status_undo_events SET ' . implode(', ', $set) . ' WHERE ' . implode(' AND ', $where) . ';';
    $sql[] = 'CALL `repair_20260811_assert`(ROW_COUNT() = 1, ' . sqlString('Undoer precondition failed: ' . $event['id']) . ');';
}
$sql[] = '';

foreach ($cogsRows as $row) {
    $sql[] = sprintf(
        'UPDATE order_cogs_expenses SET amount = %.2F, breakdown = %s, updated_at = updated_at WHERE id = %s AND amount = %.2F AND BINARY breakdown = BINARY %s;',
        (float) $row['afterAmount'],
        sqlString((string) $row['afterBreakdown']),
        sqlString((string) $row['id']),
        (float) $row['beforeAmount'],
        sqlString((string) $row['beforeBreakdown'])
    );
    $sql[] = 'CALL `repair_20260811_assert`(ROW_COUNT() = 1, ' . sqlString('COGS precondition failed: ' . $row['id']) . ');';
    if (trim((string) ($row['transactionId'] ?? '')) !== '') {
        $sql[] = sprintf(
            'CALL `repair_20260811_assert`((SELECT ABS(amount - %.2F) <= 0.01 FROM transactions WHERE id = %s), %s);',
            (float) $row['afterAmount'],
            sqlString((string) $row['transactionId']),
            sqlString('COGS transaction amount mismatch: ' . $row['transactionId'])
        );
    }
}
$sql[] = '';
$sql[] = "CALL `repair_20260811_assert`((SELECT COUNT(*) FROM orders WHERE id IN (" . sqlIn($orderIds) . ") AND JSON_VALID(items)) = " . count($orderIds) . ", 'Repaired order JSON validation failed.');";
$sql[] = "CALL `repair_20260811_assert`((SELECT COUNT(*) FROM order_status_undo_events WHERE id IN (" . sqlIn($undoIds) . ") AND JSON_VALID(before_snapshot) AND JSON_VALID(after_snapshot)) = " . count($undoIds) . ", 'Repaired Undoer JSON validation failed.');";
$sql[] = 'COMMIT;';
$sql[] = 'DROP PROCEDURE IF EXISTS `repair_20260811_assert`;';
$sql[] = '';
$sql[] = '-- Post-repair review';
$sql[] = "SELECT id, order_number, status, items FROM orders WHERE id IN (" . sqlIn($orderIds) . ") ORDER BY order_seq;";
$sql[] = "SELECT id, name, stock FROM products WHERE id IN (" . sqlIn($productIds) . ") ORDER BY name, id;";
$sql[] = "SELECT order_id, amount, transaction_id, breakdown FROM order_cogs_expenses WHERE id IN (" . sqlIn($cogsIds) . ") ORDER BY order_id;";

$contents = implode("\n", $sql) . "\n";
if (file_put_contents($outputPath, $contents) === false) {
    throw new RuntimeException("Could not write repair SQL: {$outputPath}");
}

echo sprintf(
    "Generated %s (%d orders, %d stock rows, %d Undoer rows, %d COGS rows).\n",
    $outputPath,
    count($orders),
    count($stocks),
    count($undoEvents),
    count($cogsRows)
);
