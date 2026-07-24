<?php

declare(strict_types=1);

function undoAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$operations = (string) file_get_contents($root . '/backend/src/OperationsApi.php');
$baseService = (string) file_get_contents($root . '/backend/src/BaseService.php');
$featureAccess = (string) file_get_contents($root . '/backend/src/FeatureAccess.php');
$migration = (string) file_get_contents($root . '/migrations/2026-07-24_order_status_undo_journal.sql');
$statusMigration = (string) file_get_contents($root . '/migrations/2026-07-25_order_status_canonicalization.sql');
$schemaOnly = (string) file_get_contents($root . '/backend/database/schema-only.sql');
$page = (string) file_get_contents($root . '/pages/Undoer.tsx');
$detailsPage = (string) file_get_contents($root . '/pages/OrderDetails.tsx');

undoAssert(str_contains($migration, 'CREATE TABLE IF NOT EXISTS order_status_undo_events'), 'Undo restore-point migration is missing.');
undoAssert(str_contains($migration, 'before_snapshot LONGTEXT NOT NULL'), 'Undo events must retain the exact before-state.');
undoAssert(str_contains($migration, 'transaction_ids LONGTEXT'), 'Undo events must retain exact transaction ids.');
undoAssert(str_contains($migration, 'stock_deltas LONGTEXT'), 'Undo events must retain exact stock deltas.');
undoAssert(str_contains($schemaOnly, 'CREATE TABLE IF NOT EXISTS order_status_undo_events'), 'Generated schema-only artifact is missing undo restore points.');
undoAssert(str_contains($statusMigration, "SET status = 'On Hold'"), 'Created orders are not migrated to the canonical On Hold status.');
undoAssert(str_contains($statusMigration, "SET status = 'Exchange delivered'"), 'Legacy exchange deliveries are not restored to their real status.');

undoAssert(substr_count($operations, 'recordOrderUndoEvent(') >= 4, 'All main order status workflows must record restore points.');
undoAssert(str_contains($operations, "'complete_picked_order'"), 'Picked completion is not journalled.');
undoAssert(str_contains($operations, "'process_order_exchange'"), 'Exchange processing is not journalled.');
undoAssert(str_contains($operations, "'process_order_return'"), 'Return processing is not journalled.');
undoAssert(str_contains($operations, "'On Hold' => []"), 'Undoer still treats Created and On Hold as separate statuses.');
undoAssert(str_contains($baseService, "'Completed' => ['exchangeDelivered', 'Exchange delivered']"), 'Exchange-delivered orders are still collapsed into Completed.');
undoAssert(str_contains($operations, 'softDeleteTransactionRowsByIds('), 'Undo must move transaction rows to Recycle Bin.');
undoAssert(str_contains($operations, "resolveTransactionApprovalNotification((string) \$transaction['id'], 'cancelled', 'order_status_undo')"), 'Undo must close pending transaction approval notifications.');
undoAssert(!str_contains($operations, 'revertWalletEntriesForOrder'), 'Undo must not hard-delete wallet history.');
undoAssert(str_contains($operations, "'walletTreatment' => 'append_compensating_entry'"), 'Undo must describe append-only wallet compensation.');
undoAssert(str_contains($operations, 'resolveProductStockUpdates('), 'Undo must validate stock reversals atomically.');
undoAssert(str_contains($operations, "'accountAdjustments' => \$accountAdjustments"), 'Undo preview must show account balance changes.');
undoAssert(str_contains($operations, "'externalEffects' => \$externalEffects"), 'Undo preview must disclose external courier effects.');

undoAssert(str_contains($baseService, "'undoer.view'"), 'Backend role permissions are missing undoer.view.');
undoAssert(str_contains($baseService, "'undoer.execute'"), 'Backend role permissions are missing undoer.execute.');
undoAssert(str_contains($featureAccess, "'fetchOrderUndoPlan' => 'undoer'"), 'Undo plan is not capability-gated.');
undoAssert(str_contains($page, 'Review the exact impact'), 'Undoer UI does not expose an impact review step.');
undoAssert(str_contains($page, 'I reviewed this exact action bundle'), 'Undoer UI does not require explicit confirmation.');
undoAssert(str_contains($page, 'Wallet rows remain as audit history'), 'Undoer UI does not explain wallet audit handling.');
undoAssert(str_contains($page, 'variant="primary"'), 'Undoer confirmation actions do not use the shared theme-aware primary button.');
undoAssert(str_contains($page, 'Current status'), 'Undoer does not distinguish the current status from a restore target.');
undoAssert(str_contains($detailsPage, 'nextStatus: OrderStatus.EXCHANGE_DELIVERED'), 'Exchange completion does not preserve the Exchange delivered status.');
undoAssert(str_contains($detailsPage, 'OrderStatus.COMPLETED || order.status === OrderStatus.EXCHANGE_DELIVERED'), 'Exchange delivered is not treated as a terminal order status.');

echo "Order status undo journal, reversal, permissions, schema, and UI contract checks passed.\n";
