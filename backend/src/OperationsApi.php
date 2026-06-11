<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class OperationsApi extends BaseService
{
    private function pageSize(array $params): int
    {
        return max(1, min(200, (int) ($params['pageSize'] ?? self::DEFAULT_PAGE_SIZE)));
    }

    private function pageOffset(array $params): int
    {
        $page = max(1, (int) ($params['page'] ?? 1));
        return ($page - 1) * $this->pageSize($params);
    }

    private function updateAccountBalanceByDelta(?string $accountId, float $delta): void
    {
        $normalizedAccountId = trim((string) ($accountId ?? ''));
        if ($normalizedAccountId === '' || $delta === 0.0) {
            return;
        }
        $this->database->execute(
            'UPDATE accounts
             SET current_balance = current_balance + :delta, updated_at = :updated_at
             WHERE id = :id',
            [
                ':delta' => $this->formatMoney($delta),
                ':updated_at' => $this->database->nowUtc(),
                ':id' => $normalizedAccountId,
            ]
        );
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     */
    private function applyTransactionAccountEffect(array $rows, string $effect): void
    {
        $deltas = [];

        foreach ($rows as $row) {
            $accountEffectApplied = (int) ($row['account_effect_applied'] ?? $row['accountEffectApplied'] ?? 1);
            if ($accountEffectApplied !== 1) {
                continue;
            }

            $amount = (float) ($row['amount'] ?? 0);
            if ($amount === 0.0) {
                continue;
            }

            $type = (string) ($row['type'] ?? '');
            $accountId = $this->nullableString($row['account_id'] ?? null);
            $toAccountId = $this->nullableString($row['to_account_id'] ?? null);

            if ($type === 'Income') {
                $deltas[(string) $accountId] = ($deltas[(string) $accountId] ?? 0.0) + ($effect === 'apply' ? $amount : -$amount);
                continue;
            }

            if ($type === 'Expense') {
                $deltas[(string) $accountId] = ($deltas[(string) $accountId] ?? 0.0) + ($effect === 'apply' ? -$amount : $amount);
                continue;
            }

            if ($type === 'Transfer') {
                $deltas[(string) $accountId] = ($deltas[(string) $accountId] ?? 0.0) + ($effect === 'apply' ? -$amount : $amount);
                if ($toAccountId !== null) {
                    $deltas[$toAccountId] = ($deltas[$toAccountId] ?? 0.0) + ($effect === 'apply' ? $amount : -$amount);
                }
            }
        }

        foreach ($deltas as $accountId => $delta) {
            $this->updateAccountBalanceByDelta($accountId, (float) $delta);
        }
    }

    private function accountBalanceAdjustmentFromRevertingTransaction(array $row, string $accountId): float
    {
        $normalizedAccountId = trim($accountId);
        if (
            $normalizedAccountId === ''
            || (int) ($row['account_effect_applied'] ?? $row['accountEffectApplied'] ?? 1) !== 1
        ) {
            return 0.0;
        }

        $amount = (float) ($row['amount'] ?? 0);
        if ($amount === 0.0) {
            return 0.0;
        }

        $type = trim((string) ($row['type'] ?? ''));
        $accountRowId = trim((string) ($row['account_id'] ?? $row['accountId'] ?? ''));
        $toAccountRowId = trim((string) ($row['to_account_id'] ?? $row['toAccountId'] ?? ''));

        if ($type === 'Income' && $accountRowId === $normalizedAccountId) {
            return -$amount;
        }

        if ($type === 'Expense' && $accountRowId === $normalizedAccountId) {
            return $amount;
        }

        if ($type === 'Transfer') {
            if ($accountRowId === $normalizedAccountId) {
                return $amount;
            }
            if ($toAccountRowId === $normalizedAccountId) {
                return -$amount;
            }
        }

        return 0.0;
    }

    private function assertAccountHasAvailableBalance(string $accountId, float $amount, float $balanceAdjustment = 0.0): void
    {
        $normalizedAccountId = trim($accountId);
        if ($normalizedAccountId === '' || $amount <= 0) {
            return;
        }

        $accountRow = $this->database->fetchOne(
            'SELECT id, name, current_balance
             FROM accounts
             WHERE id = :id
             LIMIT 1 FOR UPDATE',
            [':id' => $normalizedAccountId]
        );

        if ($accountRow === null) {
            throw new RuntimeException('Selected payment account was not found.');
        }

        $availableBalance = (float) ($accountRow['current_balance'] ?? 0) + $balanceAdjustment;
        if ($availableBalance + 0.00001 < $amount) {
            $accountName = trim((string) ($accountRow['name'] ?? 'Selected account')) ?: 'Selected account';
            throw new RuntimeException(sprintf(
                '%s does not have enough balance for this transaction. Available: %s, required: %s.',
                $accountName,
                $this->formatMoney($availableBalance),
                $this->formatMoney($amount)
            ));
        }
    }

    /**
     * @param array<string, mixed> $transaction
     */
    private function assertTransactionHasAvailableBalance(array $transaction, float $balanceAdjustment = 0.0): void
    {
        $type = trim((string) ($transaction['type'] ?? ''));
        if (!in_array($type, ['Expense', 'Transfer'], true)) {
            return;
        }

        $this->assertAccountHasAvailableBalance(
            trim((string) ($transaction['account_id'] ?? $transaction['accountId'] ?? '')),
            (float) ($transaction['amount'] ?? 0),
            $balanceAdjustment
        );
    }

    private function transactionApprovalThreshold(): float
    {
        if (!$this->tableExists('system_defaults') || !$this->columnExists('system_defaults', 'max_transaction_amount')) {
            return 0.0;
        }

        $row = $this->database->fetchOne('SELECT max_transaction_amount FROM system_defaults LIMIT 1');
        return max(0.0, (float) ($row['max_transaction_amount'] ?? 0));
    }

    /**
     * @param array<string, mixed> $actor
     * @param array<string, mixed> $transaction
     */
    private function shouldRequireTransactionApproval(array $actor, array $transaction): bool
    {
        if ($this->hasAdminAccess((string) ($actor['role'] ?? ''))) {
            return false;
        }

        $threshold = $this->transactionApprovalThreshold();
        if ($threshold <= 0) {
            return false;
        }

        return (float) ($transaction['amount'] ?? 0) > $threshold;
    }

    /**
     * @param array<string, mixed> $actor
     * @param array<string, mixed> $transaction
     * @return array<string, mixed>
     */
    private function buildTransactionApprovalState(array $actor, array $transaction): array
    {
        $now = $this->database->nowUtc();
        if ($this->shouldRequireTransactionApproval($actor, $transaction)) {
            return [
                'approval_status' => 'pending',
                'account_effect_applied' => 0,
                'approval_requested_by' => (string) ($actor['id'] ?? ''),
                'approval_requested_at' => $now,
                'approved_by' => null,
                'approved_at' => null,
                'declined_by' => null,
                'declined_at' => null,
                'approval_note' => 'Awaiting admin approval because the transaction amount exceeds the configured limit.',
            ];
        }

        return [
            'approval_status' => 'approved',
            'account_effect_applied' => 1,
            'approval_requested_by' => (string) ($actor['id'] ?? ''),
            'approval_requested_at' => $now,
            'approved_by' => (string) ($actor['id'] ?? ''),
            'approved_at' => $now,
            'declined_by' => null,
            'declined_at' => null,
            'approval_note' => null,
        ];
    }

    /**
     * @param array<string, mixed> $actor
     * @param array<string, mixed> $transaction
     */
    private function upsertTransactionApprovalNotification(array $actor, array $transaction): void
    {
        if (
            !$this->tableExists('notifications')
            || !$this->columnExists('notifications', 'system_key')
            || !$this->columnExists('notifications', 'action_config')
        ) {
            return;
        }

        $transactionId = trim((string) ($transaction['id'] ?? ''));
        if ($transactionId === '') {
            return;
        }

        $transactionType = trim((string) ($transaction['type'] ?? 'Transaction')) ?: 'Transaction';
        $amount = $this->formatMoney($transaction['amount'] ?? 0);
        $description = trim((string) ($transaction['description'] ?? '')) ?: 'No description';
        $subject = sprintf('%s approval needed for %s', $transactionType, $amount);
        $contentHtml = sprintf(
            '<p><strong>%s</strong> created a pending %s transaction of <strong>%s</strong>.</p><p>%s</p><p><a href="/banking/transactions?highlightTx=%s&search=%s">Click Here</a> to review it.</p>',
            htmlspecialchars(trim((string) ($actor['name'] ?? 'A user')), ENT_QUOTES, 'UTF-8'),
            htmlspecialchars(strtolower($transactionType), ENT_QUOTES, 'UTF-8'),
            htmlspecialchars($amount, ENT_QUOTES, 'UTF-8'),
            htmlspecialchars($description, ENT_QUOTES, 'UTF-8'),
            htmlspecialchars($transactionId, ENT_QUOTES, 'UTF-8'),
            htmlspecialchars($transactionId, ENT_QUOTES, 'UTF-8')
        );
        $actionConfig = [
            'kind' => 'link_and_decision',
            'linkLabel' => 'View transaction',
            'linkUrl' => '/banking/transactions?highlightTx=' . $transactionId . '&search=' . $transactionId,
            'acceptLabel' => 'Accept',
            'declineLabel' => 'Decline',
            'decisionMode' => 'transaction_approval',
            'decisionScope' => 'single_user',
            'decisionContext' => [
                'transactionId' => $transactionId,
            ],
        ];
        $targetRoles = ['Admin', 'Developer'];
        $now = $this->database->nowUtc();
        $notificationId = 'transaction-approval-' . $transactionId;

        $this->database->execute(
            'INSERT INTO notifications (
                id, system_key, subject, content_html, target_roles, starts_at, ends_at,
                action_config, metadata, created_by, is_active, is_system_generated, created_at, updated_at
             ) VALUES (
                :id, :system_key, :subject, :content_html, :target_roles, :starts_at, :ends_at,
                :action_config, :metadata, :created_by, 1, 1, :created_at, :updated_at
             )
             ON DUPLICATE KEY UPDATE
                subject = VALUES(subject),
                content_html = VALUES(content_html),
                target_roles = VALUES(target_roles),
                starts_at = VALUES(starts_at),
                ends_at = VALUES(ends_at),
                action_config = VALUES(action_config),
                metadata = VALUES(metadata),
                is_active = VALUES(is_active),
                updated_at = VALUES(updated_at)',
            [
                ':id' => $notificationId,
                ':system_key' => $notificationId,
                ':subject' => $subject,
                ':content_html' => $contentHtml,
                ':target_roles' => $this->jsonEncode($targetRoles),
                ':starts_at' => $now,
                ':ends_at' => null,
                ':action_config' => $this->jsonEncode($actionConfig),
                ':metadata' => $this->jsonEncode([
                    'transactionId' => $transactionId,
                    'approvalStatus' => 'pending',
                ]),
                ':created_by' => (string) ($actor['id'] ?? ''),
                ':created_at' => $now,
                ':updated_at' => $now,
            ]
        );
    }

    private function resolveTransactionApprovalNotification(string $transactionId, string $approvalStatus, ?string $decision = null): void
    {
        if (
            !$this->tableExists('notifications')
            || !$this->columnExists('notifications', 'system_key')
            || !$this->columnExists('notifications', 'metadata')
        ) {
            return;
        }

        $notificationKey = 'transaction-approval-' . trim($transactionId);
        if ($notificationKey === 'transaction-approval-') {
            return;
        }

        $metadata = [
            'transactionId' => trim($transactionId),
            'approvalStatus' => $approvalStatus,
        ];
        if ($decision !== null) {
            $metadata['decision'] = $decision;
        }

        $now = $this->database->nowUtc();
        $this->database->execute(
            'UPDATE notifications
             SET is_active = 0,
                 ends_at = COALESCE(ends_at, :ends_at),
                 metadata = :metadata,
                 updated_at = :updated_at
             WHERE system_key = :system_key',
            [
                ':ends_at' => $now,
                ':metadata' => $this->jsonEncode($metadata),
                ':updated_at' => $now,
                ':system_key' => $notificationKey,
            ]
        );
    }

    private function syncCustomerOrderSummary(?string $customerId): void
    {
        $normalizedCustomerId = trim((string) ($customerId ?? ''));
        if ($normalizedCustomerId === '') {
            return;
        }

        $summary = $this->database->fetchOne(
            "SELECT
                COUNT(*) AS total_orders,
                COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled', 'Returned') THEN GREATEST(total - paid_amount, 0) ELSE 0 END), 0) AS due_amount
             FROM orders
             WHERE customer_id = :customer_id AND deleted_at IS NULL",
            [':customer_id' => $normalizedCustomerId]
        );

        $this->database->execute(
            'UPDATE customers SET total_orders = :total_orders, due_amount = :due_amount WHERE id = :id',
            [
                ':total_orders' => (int) ($summary['total_orders'] ?? 0),
                ':due_amount' => $this->formatMoney($summary['due_amount'] ?? 0),
                ':id' => $normalizedCustomerId,
            ]
        );
    }

    /**
     * @param array<int, string|null> $customerIds
     */
    private function syncCustomerOrderSummaries(array $customerIds): void
    {
        $normalizedIds = array_values(array_unique(array_filter(
            array_map(static fn($id): string => trim((string) ($id ?? '')), $customerIds),
            static fn(string $id): bool => $id !== ''
        )));

        foreach ($normalizedIds as $customerId) {
            $this->syncCustomerOrderSummary($customerId);
        }
    }

    private function syncVendorPurchaseSummary(?string $vendorId): void
    {
        $normalizedVendorId = trim((string) ($vendorId ?? ''));
        if ($normalizedVendorId === '') {
            return;
        }

        $summary = $this->database->fetchOne(
            "SELECT
                COUNT(*) AS total_purchases,
                COALESCE(SUM(CASE WHEN status <> 'Cancelled' THEN GREATEST(total - paid_amount, 0) ELSE 0 END), 0) AS due_amount
             FROM bills
             WHERE vendor_id = :vendor_id AND deleted_at IS NULL",
            [':vendor_id' => $normalizedVendorId]
        );

        $this->database->execute(
            'UPDATE vendors SET total_purchases = :total_purchases, due_amount = :due_amount WHERE id = :id',
            [
                ':total_purchases' => (int) ($summary['total_purchases'] ?? 0),
                ':due_amount' => $this->formatMoney($summary['due_amount'] ?? 0),
                ':id' => $normalizedVendorId,
            ]
        );
    }

    /**
     * @param array<int, string|null> $vendorIds
     */
    private function syncVendorPurchaseSummaries(array $vendorIds): void
    {
        $normalizedIds = array_values(array_unique(array_filter(
            array_map(static fn($id): string => trim((string) ($id ?? '')), $vendorIds),
            static fn(string $id): bool => $id !== ''
        )));

        foreach ($normalizedIds as $vendorId) {
            $this->syncVendorPurchaseSummary($vendorId);
        }
    }

    /**
     * @param array<int, array<string, mixed>> $items
     * @return array<string, int>
     */
    private function aggregateItemQuantities(array $items): array
    {
        $quantities = [];
        foreach ($items as $item) {
            $productId = trim((string) ($item['productId'] ?? ''));
            $quantity = (int) ($item['quantity'] ?? 0);
            if ($productId === '' || $quantity <= 0) {
                continue;
            }
            $quantities[$productId] = ($quantities[$productId] ?? 0) + $quantity;
        }

        return $quantities;
    }

    /**
     * @param array<int, array<string, mixed>> $previousItems
     * @param array<int, array<string, mixed>> $nextItems
     * @return array<string, int>
     */
    private function buildStockDeltas(array $previousItems, array $nextItems, int $previousCoeff, int $nextCoeff): array
    {
        $deltas = [];
        foreach ($this->aggregateItemQuantities($previousItems) as $productId => $quantity) {
            $deltas[$productId] = ($deltas[$productId] ?? 0) + ($quantity * $previousCoeff);
        }
        foreach ($this->aggregateItemQuantities($nextItems) as $productId => $quantity) {
            $deltas[$productId] = ($deltas[$productId] ?? 0) + ($quantity * $nextCoeff);
        }

        return array_filter($deltas, static fn(int $delta): bool => $delta !== 0);
    }

    /**
     * @param array<string, int> $deltas
     * @return array<int, array<string, mixed>>
     */
    private function resolveProductStockUpdates(array $deltas, string $context): array
    {
        if ($deltas === []) {
            return [];
        }

        $productIds = array_keys($deltas);
        [$placeholders, $bindings] = $this->inClause($productIds, 'product');
        $rows = $this->database->fetchAll(
            'SELECT id, name, stock FROM products WHERE id IN (' . implode(', ', $placeholders) . ') FOR UPDATE',
            $bindings
        );

        $byId = $this->keyBy($rows, 'id');
        $updates = [];
        $insufficient = [];

        foreach ($productIds as $productId) {
            $row = $byId[$productId] ?? null;
            if ($row === null) {
                throw new RuntimeException("Stock update failed in {$context}: product {$productId} was not found.");
            }

            $currentStock = (int) ($row['stock'] ?? 0);
            $nextStock = $currentStock + (int) $deltas[$productId];
            if ($nextStock < 0) {
                $insufficient[] = sprintf('%s (need %d, have %d)', $row['name'] ?? $productId, abs((int) $deltas[$productId]), $currentStock);
                continue;
            }

            $updates[] = ['id' => $productId, 'stock' => $nextStock];
        }

        if ($insufficient !== []) {
            throw new RuntimeException('Insufficient stock: ' . implode('; ', $insufficient));
        }

        return $updates;
    }

    /**
     * @param array<int, array<string, mixed>> $updates
     */
    private function applyResolvedProductStockUpdates(array $updates): void
    {
        foreach ($updates as $update) {
            $this->database->execute(
                'UPDATE products SET stock = :stock, updated_at = :updated_at WHERE id = :id',
                [
                    ':stock' => (int) $update['stock'],
                    ':updated_at' => $this->database->nowUtc(),
                    ':id' => (string) $update['id'],
                ]
            );
        }
    }

    private function isOrderStockApplied(?string $status): bool
    {
        return in_array((string) $status, self::ORDER_STOCK_STATUSES, true);
    }

    private function isBillStockApplied(?string $status): bool
    {
        return in_array((string) $status, self::BILL_STOCK_STATUSES, true);
    }

    /**
     * @param array<int, array<string, mixed>> $previousItems
     * @param array<int, array<string, mixed>> $nextItems
     * @return array<int, array<string, mixed>>
     */
    private function applyOrderStockTransition(string $previousStatus, string $nextStatus, array $previousItems, array $nextItems): array
    {
        $deltas = $this->buildStockDeltas(
            $previousItems,
            $nextItems,
            $this->isOrderStockApplied($previousStatus) ? 1 : 0,
            $this->isOrderStockApplied($nextStatus) ? -1 : 0
        );

        return $this->resolveProductStockUpdates($deltas, 'order');
    }

    /**
     * @param array<int, array<string, mixed>> $previousItems
     * @param array<int, array<string, mixed>> $nextItems
     * @return array<int, array<string, mixed>>
     */
    private function applyBillStockTransition(string $previousStatus, string $nextStatus, array $previousItems, array $nextItems): array
    {
        $deltas = $this->buildStockDeltas(
            $previousItems,
            $nextItems,
            $this->isBillStockApplied($previousStatus) ? -1 : 0,
            $this->isBillStockApplied($nextStatus) ? 1 : 0
        );

        return $this->resolveProductStockUpdates($deltas, 'bill');
    }

    private function deletedStateSql(string $deletedState): string
    {
        if ($deletedState === 'deleted') {
            return 'deleted_at IS NOT NULL';
        }
        if ($deletedState === 'any') {
            return '1=1';
        }

        return 'deleted_at IS NULL';
    }

    /**
     * @param array<int, string> $ids
     */
    private function softDeleteTransactionRowsByIds(array $ids, string $deletedAt, string $deletedBy): void
    {
        $ids = array_values(array_filter(array_map('strval', $ids), static fn(string $id): bool => trim($id) !== ''));
        if ($ids === []) {
            return;
        }

        [$placeholders, $bindings] = $this->inClause($ids, 'tx');
        $bindings[':deleted_at'] = $deletedAt;
        $bindings[':deleted_by'] = $deletedBy;
        $bindings[':updated_at'] = $deletedAt;

        $this->database->execute(
            'UPDATE transactions
             SET deleted_at = :deleted_at, deleted_by = :deleted_by, updated_at = :updated_at
             WHERE id IN (' . implode(', ', $placeholders) . ') AND deleted_at IS NULL',
            $bindings
        );
    }

    /**
     * @param array<int, string> $ids
     */
    private function restoreTransactionRowsByIds(array $ids): void
    {
        $ids = array_values(array_filter(array_map('strval', $ids), static fn(string $id): bool => trim($id) !== ''));
        if ($ids === []) {
            return;
        }

        [$placeholders, $bindings] = $this->inClause($ids, 'tx');
        $bindings[':updated_at'] = $this->database->nowUtc();
        $this->database->execute(
            'UPDATE transactions
             SET deleted_at = NULL, deleted_by = NULL, updated_at = :updated_at
             WHERE id IN (' . implode(', ', $placeholders) . ') AND deleted_at IS NOT NULL',
            $bindings
        );
    }

    /**
     * @param array<int, string> $ids
     */
    private function permanentlyDeleteTransactionRowsByIds(array $ids): void
    {
        $ids = array_values(array_filter(array_map('strval', $ids), static fn(string $id): bool => trim($id) !== ''));
        if ($ids === []) {
            return;
        }

        [$placeholders, $bindings] = $this->inClause($ids, 'tx');
        $this->database->execute(
            'DELETE FROM transactions WHERE id IN (' . implode(', ', $placeholders) . ') AND deleted_at IS NOT NULL',
            $bindings
        );
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function fetchOrderLinkedTransactionRows(string $orderId, string $orderNumber, string $deletedState): array
    {
        $stateSql = $this->deletedStateSql($deletedState);
        $shippingDescription = "Shipping costs for Order #{$orderNumber}";

        $rows = $this->database->fetchAll(
            "SELECT id, type, account_id, to_account_id, amount, account_effect_applied
             FROM transactions
             WHERE {$stateSql}
               AND (reference_id = :reference_id OR (type = 'Expense' AND category = 'expense_shipping' AND description = :shipping_description))",
            [
                ':reference_id' => $orderId,
                ':shipping_description' => $shippingDescription,
            ]
        );

        return array_values($this->keyBy($rows, 'id'));
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function fetchBillLinkedTransactionRows(string $billId, string $deletedState): array
    {
        $stateSql = $this->deletedStateSql($deletedState);
        return $this->database->fetchAll(
            "SELECT id, type, account_id, to_account_id, amount, account_effect_applied
             FROM transactions
             WHERE {$stateSql} AND reference_id = :reference_id AND type = 'Expense'",
            [':reference_id' => $billId]
        );
    }

    /**
     * @param mixed $value
     */
    private function encodeComparableJson($value): string
    {
        return (string) ($this->jsonEncode($value) ?? 'null');
    }

    /**
     * @param array<string, mixed> $history
     * @param array<int, string> $excludedKeys
     * @return array<string, mixed>
     */
    private function filteredHistoryForComparison(array $history, array $excludedKeys): array
    {
        foreach ($excludedKeys as $key) {
            unset($history[$key]);
        }

        ksort($history);
        return $history;
    }

    private function historyValue(array $history, string $key): string
    {
        return trim((string) ($history[$key] ?? ''));
    }

    /**
     * @param array<string, mixed> $user
     * @param array<string, mixed> $row
     */
    private function assertUserCanManageOrderRecord(array $user, array $row, string $ownPermission, string $anyPermission, string $message): void
    {
        $createdBy = (string) ($row['created_by'] ?? $row['createdBy'] ?? '');
        if ($this->userHasScopedPermissionForRecord($user, $createdBy, $ownPermission, $anyPermission)) {
            return;
        }

        throw new RuntimeException($message);
    }

    /**
     * @param array<string, mixed> $user
     * @param array<string, mixed> $row
     */
    private function assertUserCanManageBillRecord(array $user, array $row, string $ownPermission, string $anyPermission, string $message): void
    {
        $createdBy = (string) ($row['created_by'] ?? $row['createdBy'] ?? '');
        if ($this->userHasScopedPermissionForRecord($user, $createdBy, $ownPermission, $anyPermission)) {
            return;
        }

        throw new RuntimeException($message);
    }

    /**
     * @param array<string, mixed> $user
     * @param array<string, mixed> $row
     */
    private function assertUserCanEditOrder(array $user, array $row): void
    {
        $role = (string) ($user['role'] ?? '');
        if ($this->roleHasPermission($role, 'orders.editAny')) {
            return;
        }

        $createdBy = (string) ($row['created_by'] ?? '');
        $status = (string) ($row['status'] ?? '');
        if (
            $status === 'On Hold'
            && $this->userHasScopedPermissionForRecord($user, $createdBy, 'orders.editOwn', 'orders.editAny')
        ) {
            return;
        }

        throw new RuntimeException('You do not have permission to edit this order.');
    }

    /**
     * @param array<string, mixed> $user
     * @param array<string, mixed> $existingRow
     * @param array<string, mixed> $updates
     */
    private function assertUserCanUpdateOrder(array $user, array $existingRow, array $updates): void
    {
        $previousStatus = trim((string) ($existingRow['status'] ?? ''));
        $nextStatus = array_key_exists('status', $updates) ? trim((string) $updates['status']) : $previousStatus;
        $existingHistory = $this->jsonDecodeAssoc($existingRow['history'] ?? []);
        $nextHistory = array_key_exists('history', $updates)
            ? (is_array($updates['history']) ? $updates['history'] : $this->jsonDecodeAssoc($updates['history']))
            : $existingHistory;

        $courierChanged =
            (
                (array_key_exists('carrybeeConsignmentId', $updates) || array_key_exists('carrybee_consignment_id', $updates))
                && $this->nullableString($updates['carrybeeConsignmentId'] ?? $updates['carrybee_consignment_id'] ?? null)
                !== $this->nullableString($existingRow['carrybee_consignment_id'] ?? null)
            )
            || (
                (array_key_exists('steadfastConsignmentId', $updates) || array_key_exists('steadfast_consignment_id', $updates))
                && $this->nullableString($updates['steadfastConsignmentId'] ?? $updates['steadfast_consignment_id'] ?? null)
                !== $this->nullableString($existingRow['steadfast_consignment_id'] ?? null)
            )
            || (
                (array_key_exists('paperflyTrackingNumber', $updates) || array_key_exists('paperfly_tracking_number', $updates))
                && $this->nullableString($updates['paperflyTrackingNumber'] ?? $updates['paperfly_tracking_number'] ?? null)
                !== $this->nullableString($existingRow['paperfly_tracking_number'] ?? null)
            )
            || $this->historyValue($nextHistory, 'courier') !== $this->historyValue($existingHistory, 'courier');

        $processingChanged = $this->historyValue($nextHistory, 'processing') !== $this->historyValue($existingHistory, 'processing');
        $pickedChanged = $this->historyValue($nextHistory, 'picked') !== $this->historyValue($existingHistory, 'picked');
        $completedChanged = $this->historyValue($nextHistory, 'completed') !== $this->historyValue($existingHistory, 'completed');
        $returnedChanged = $this->historyValue($nextHistory, 'returned') !== $this->historyValue($existingHistory, 'returned');
        $paymentChanged = $this->historyValue($nextHistory, 'payment') !== $this->historyValue($existingHistory, 'payment');

        if ($nextStatus !== $previousStatus && $nextStatus === 'Cancelled') {
            $this->assertUserCanManageOrderRecord($user, $existingRow, 'orders.cancelOwn', 'orders.cancelAny', 'You do not have permission to cancel this order.');
        }

        if (($nextStatus !== $previousStatus && $nextStatus === 'Processing') || $processingChanged) {
            $this->assertUserCanManageOrderRecord(
                $user,
                $existingRow,
                'orders.moveOnHoldToProcessingOwn',
                'orders.moveOnHoldToProcessingAny',
                'You do not have permission to move this order to processing.'
            );
        }

        if ($courierChanged) {
            $this->assertUserCanManageOrderRecord(
                $user,
                $existingRow,
                'orders.sendToCourierOwn',
                'orders.sendToCourierAny',
                'You do not have permission to send this order to a courier.'
            );
        }

        if ((($nextStatus !== $previousStatus && $nextStatus === 'Picked') || $pickedChanged) && !$courierChanged) {
            $this->assertUserCanManageOrderRecord(
                $user,
                $existingRow,
                'orders.moveToPickedOwn',
                'orders.moveToPickedAny',
                'You do not have permission to mark this order as picked.'
            );
        }

        if (($nextStatus !== $previousStatus && $nextStatus === 'Completed') || $completedChanged || $paymentChanged) {
            $this->assertUserCanManageOrderRecord(
                $user,
                $existingRow,
                'orders.markCompletedOwn',
                'orders.markCompletedAny',
                'You do not have permission to mark this order as completed.'
            );
        }

        if (($nextStatus !== $previousStatus && $nextStatus === 'Returned') || $returnedChanged) {
            $this->assertUserCanManageOrderRecord(
                $user,
                $existingRow,
                'orders.markReturnedOwn',
                'orders.markReturnedAny',
                'You do not have permission to mark this order as returned.'
            );
        }

        $businessChanged = false;

        if (array_key_exists('customerId', $updates) && trim((string) $updates['customerId']) !== (string) ($existingRow['customer_id'] ?? '')) {
            $businessChanged = true;
        }
        if (
            (array_key_exists('pageId', $updates) || array_key_exists('page_id', $updates))
            && trim((string) ($updates['pageId'] ?? $updates['page_id'] ?? '')) !== (string) ($existingRow['page_id'] ?? '')
        ) {
            $businessChanged = true;
        }
        if (array_key_exists('pageSnapshot', $updates) || array_key_exists('page_snapshot', $updates)) {
            $nextPageSnapshot = $updates['pageSnapshot'] ?? $updates['page_snapshot'] ?? null;
            $decodedPageSnapshot = is_array($nextPageSnapshot) ? $nextPageSnapshot : $this->jsonDecodeAssoc($nextPageSnapshot);
            if ($this->encodeComparableJson($decodedPageSnapshot) !== $this->encodeComparableJson($this->jsonDecodeAssoc($existingRow['page_snapshot'] ?? []))) {
                $businessChanged = true;
            }
        }
        if (
            array_key_exists('orderDate', $updates)
            && ($this->normalizeDateOnly((string) $updates['orderDate']) ?: (string) ($existingRow['order_date'] ?? '')) !== (string) ($existingRow['order_date'] ?? '')
        ) {
            $businessChanged = true;
        }
        if (array_key_exists('orderNumber', $updates) && trim((string) $updates['orderNumber']) !== (string) ($existingRow['order_number'] ?? '')) {
            $businessChanged = true;
        }
        if (array_key_exists('notes', $updates) && $this->nullableString($updates['notes']) !== $this->nullableString($existingRow['notes'] ?? null)) {
            $businessChanged = true;
        }
        if (
            array_key_exists('items', $updates)
            && is_array($updates['items'])
            && $this->encodeComparableJson($updates['items']) !== $this->encodeComparableJson($this->jsonDecodeList($existingRow['items'] ?? []))
        ) {
            $businessChanged = true;
        }
        if (
            array_key_exists('subtotal', $updates)
            && $this->formatMoney($updates['subtotal']) !== $this->formatMoney($existingRow['subtotal'] ?? 0)
        ) {
            $businessChanged = true;
        }
        if (
            array_key_exists('discount', $updates)
            && $this->formatMoney($updates['discount']) !== $this->formatMoney($existingRow['discount'] ?? 0)
        ) {
            $businessChanged = true;
        }
        if (
            array_key_exists('shipping', $updates)
            && $this->formatMoney($updates['shipping']) !== $this->formatMoney($existingRow['shipping'] ?? 0)
        ) {
            $businessChanged = true;
        }
        if (
            array_key_exists('total', $updates)
            && $this->formatMoney($updates['total']) !== $this->formatMoney($existingRow['total'] ?? 0)
        ) {
            $businessChanged = true;
        }
        if (
            array_key_exists('paidAmount', $updates)
            && $this->formatMoney($updates['paidAmount']) !== $this->formatMoney($existingRow['paid_amount'] ?? 0)
        ) {
            $businessChanged = true;
        }
        if (
            array_key_exists('history', $updates)
            && $this->encodeComparableJson($this->filteredHistoryForComparison($nextHistory, ['processing', 'picked', 'courier', 'completed', 'returned', 'payment']))
            !== $this->encodeComparableJson($this->filteredHistoryForComparison($existingHistory, ['processing', 'picked', 'courier', 'completed', 'returned', 'payment']))
        ) {
            $businessChanged = true;
        }

        if ($businessChanged) {
            $this->assertUserCanEditOrder($user, $existingRow);
        }
    }

    /**
     * @param array<string, mixed> $user
     * @param array<string, mixed> $existingRow
     * @param array<string, mixed> $updates
     */
    private function assertUserCanUpdateBill(array $user, array $existingRow, array $updates): void
    {
        $previousStatus = trim((string) ($existingRow['status'] ?? ''));
        $nextStatus = array_key_exists('status', $updates) ? trim((string) $updates['status']) : $previousStatus;
        $existingHistory = $this->jsonDecodeAssoc($existingRow['history'] ?? []);
        $nextHistory = array_key_exists('history', $updates)
            ? (is_array($updates['history']) ? $updates['history'] : $this->jsonDecodeAssoc($updates['history']))
            : $existingHistory;

        $processingChanged = $this->historyValue($nextHistory, 'processing') !== $this->historyValue($existingHistory, 'processing');
        $receivedChanged = $this->historyValue($nextHistory, 'received') !== $this->historyValue($existingHistory, 'received');
        $cancelledChanged = $this->historyValue($nextHistory, 'cancelled') !== $this->historyValue($existingHistory, 'cancelled');
        $paidChanged = $this->historyValue($nextHistory, 'paid') !== $this->historyValue($existingHistory, 'paid');

        if (($nextStatus !== $previousStatus && $nextStatus === 'Processing') || $processingChanged) {
            $this->assertUserCanManageBillRecord(
                $user,
                $existingRow,
                'bills.moveOnHoldToProcessingOwn',
                'bills.moveOnHoldToProcessingAny',
                'You do not have permission to move this bill to processing.'
            );
        }

        if (($nextStatus !== $previousStatus && $nextStatus === 'Received') || $receivedChanged) {
            $this->assertUserCanManageBillRecord(
                $user,
                $existingRow,
                'bills.markReceivedOwn',
                'bills.markReceivedAny',
                'You do not have permission to mark this bill as received.'
            );
        }

        if ((($previousStatus !== 'On Hold' && $nextStatus === 'On Hold') && $nextStatus !== $previousStatus) || $cancelledChanged) {
            $this->assertUserCanManageBillRecord(
                $user,
                $existingRow,
                'bills.cancelOwn',
                'bills.cancelAny',
                'You do not have permission to cancel this bill.'
            );
        }

        if (
            $paidChanged
            || (array_key_exists('paidAmount', $updates) && $this->formatMoney($updates['paidAmount']) !== $this->formatMoney($existingRow['paid_amount'] ?? 0))
            || (array_key_exists('paidAt', $updates) && trim((string) $updates['paidAt']) !== '')
            || ($nextStatus !== $previousStatus && $nextStatus === 'Paid')
        ) {
            $this->assertUserCanManageBillRecord(
                $user,
                $existingRow,
                'bills.markPaidOwn',
                'bills.markPaidAny',
                'You do not have permission to record payment for this bill.'
            );
        }

        $businessChanged = false;
        if (array_key_exists('vendorId', $updates) && trim((string) $updates['vendorId']) !== (string) ($existingRow['vendor_id'] ?? '')) {
            $businessChanged = true;
        }
        if (
            array_key_exists('billDate', $updates)
            && ($this->normalizeDateOnly((string) $updates['billDate']) ?: (string) ($existingRow['bill_date'] ?? '')) !== (string) ($existingRow['bill_date'] ?? '')
        ) {
            $businessChanged = true;
        }
        if (array_key_exists('billNumber', $updates) && trim((string) $updates['billNumber']) !== (string) ($existingRow['bill_number'] ?? '')) {
            $businessChanged = true;
        }
        if (array_key_exists('notes', $updates) && $this->nullableString($updates['notes']) !== $this->nullableString($existingRow['notes'] ?? null)) {
            $businessChanged = true;
        }
        if (
            array_key_exists('items', $updates)
            && is_array($updates['items'])
            && $this->encodeComparableJson($updates['items']) !== $this->encodeComparableJson($this->jsonDecodeList($existingRow['items'] ?? []))
        ) {
            $businessChanged = true;
        }
        if (
            array_key_exists('subtotal', $updates)
            && $this->formatMoney($updates['subtotal']) !== $this->formatMoney($existingRow['subtotal'] ?? 0)
        ) {
            $businessChanged = true;
        }
        if (
            array_key_exists('discount', $updates)
            && $this->formatMoney($updates['discount']) !== $this->formatMoney($existingRow['discount'] ?? 0)
        ) {
            $businessChanged = true;
        }
        if (
            array_key_exists('shipping', $updates)
            && $this->formatMoney($updates['shipping']) !== $this->formatMoney($existingRow['shipping'] ?? 0)
        ) {
            $businessChanged = true;
        }
        if (
            array_key_exists('total', $updates)
            && $this->formatMoney($updates['total']) !== $this->formatMoney($existingRow['total'] ?? 0)
        ) {
            $businessChanged = true;
        }
        if (
            array_key_exists('history', $updates)
            && $this->encodeComparableJson($this->filteredHistoryForComparison($nextHistory, ['processing', 'received', 'cancelled', 'paid']))
            !== $this->encodeComparableJson($this->filteredHistoryForComparison($existingHistory, ['processing', 'received', 'cancelled', 'paid']))
        ) {
            $businessChanged = true;
        }

        if ($businessChanged) {
            $this->assertUserCanManageBillRecord($user, $existingRow, 'bills.editOwn', 'bills.editAny', 'You do not have permission to edit this bill.');
        }
    }

    private function nextOrderNumberPreview(): string
    {
        $settings = $this->database->fetchOne('SELECT prefix, next_number FROM order_settings LIMIT 1');
        $prefix = (string) ($settings['prefix'] ?? 'ORD-');
        $nextNumber = (int) ($settings['next_number'] ?? 1);
        $maxSeqRow = $this->database->fetchOne('SELECT COALESCE(MAX(order_seq), 0) AS max_seq FROM orders');
        $maxSeq = (int) ($maxSeqRow['max_seq'] ?? 0);
        $next = max($nextNumber, $maxSeq + 1);
        return $prefix . $next;
    }

    private function nextBillNumberPreview(): string
    {
        $maxSeqRow = $this->database->fetchOne('SELECT COALESCE(MAX(bill_seq), 0) AS max_seq FROM bills');
        $next = ((int) ($maxSeqRow['max_seq'] ?? 0)) + 1;
        return 'Bill-' . $next;
    }

    /**
     * @return array{id: string, prefix: string, next: int, orderNumber: string}
     */
    private function allocateOrderNumber(): array
    {
        $settings = $this->database->fetchOne('SELECT id, prefix, next_number FROM order_settings LIMIT 1 FOR UPDATE');
        if ($settings === null) {
            throw new RuntimeException('Order settings row is missing.');
        }

        $maxSeqRow = $this->database->fetchOne('SELECT COALESCE(MAX(order_seq), 0) AS max_seq FROM orders FOR UPDATE');
        $maxSeq = (int) ($maxSeqRow['max_seq'] ?? 0);
        $next = max((int) ($settings['next_number'] ?? 1), $maxSeq + 1);
        $prefix = (string) ($settings['prefix'] ?? 'ORD-');
        $orderNumber = $prefix . $next;

        $this->database->execute(
            'UPDATE order_settings SET next_number = :next_number, updated_at = :updated_at WHERE id = :id',
            [
                ':next_number' => $next + 1,
                ':updated_at' => $this->database->nowUtc(),
                ':id' => (string) $settings['id'],
            ]
        );

        return [
            'id' => (string) $settings['id'],
            'prefix' => $prefix,
            'next' => $next,
            'orderNumber' => $orderNumber,
        ];
    }

    /**
     * @return array{next: int, billNumber: string}
     */
    private function allocateBillNumber(): array
    {
        $maxSeqRow = $this->database->fetchOne('SELECT COALESCE(MAX(bill_seq), 0) AS max_seq FROM bills FOR UPDATE');
        $next = ((int) ($maxSeqRow['max_seq'] ?? 0)) + 1;
        return ['next' => $next, 'billNumber' => 'Bill-' . $next];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function fetchCompanyPages(): array
    {
        $row = $this->database->fetchOne('SELECT * FROM company_settings LIMIT 1');
        return $this->normalizeCompanyPages($row['pages'] ?? [], $row ?? []);
    }

    /**
     * @return array{pageId: string|null, pageSnapshot: array<string, mixed>|null}
     */
    private function resolveOrderPageSelection(array $payload): array
    {
        $pages = $this->fetchCompanyPages();
        $requestedPageId = trim((string) ($payload['pageId'] ?? $payload['page_id'] ?? ''));
        $rawSnapshot = $payload['pageSnapshot'] ?? $payload['page_snapshot'] ?? null;
        $requestedSnapshot = is_array($rawSnapshot) ? $rawSnapshot : $this->jsonDecodeAssoc($rawSnapshot);
        $matchedPage = null;

        if ($requestedPageId !== '') {
            foreach ($pages as $index => $page) {
                if ((string) ($page['id'] ?? '') === $requestedPageId) {
                    $matchedPage = $this->normalizeCompanyPage($page, $index);
                    break;
                }
            }
        }

        if ($matchedPage === null && $requestedSnapshot !== []) {
            $matchedPage = $this->normalizeCompanyPage(
                $requestedSnapshot,
                0,
                ['id' => $requestedPageId !== '' ? $requestedPageId : ($requestedSnapshot['id'] ?? 'company-default-page')]
            );
        }

        if ($matchedPage === null) {
            $matchedPage = $this->getGlobalCompanyPage($pages);
        }

        $resolvedId = trim((string) ($matchedPage['id'] ?? ''));

        return [
            'pageId' => $resolvedId !== '' ? $resolvedId : null,
            'pageSnapshot' => $matchedPage !== [] ? $matchedPage : null,
        ];
    }

    private function fetchOrderRowById(string $id): ?array
    {
        return $this->database->fetchOne('SELECT * FROM orders_with_customer_creator WHERE id = :id LIMIT 1', [':id' => $id]);
    }

    private function fetchBillRowById(string $id): ?array
    {
        return $this->database->fetchOne('SELECT * FROM bills_with_vendor_creator WHERE id = :id LIMIT 1', [':id' => $id]);
    }

    public function fetchOrders(array $params = []): array
    {
        $rows = $this->database->fetchAll(
            'SELECT * FROM orders_with_customer_creator ORDER BY createdAt DESC'
        );

        return array_map(fn(array $row): array => $this->mapOrder($row), $rows);
    }

    public function fetchOrderSearchPreview(array $params): array
    {
        $search = trim((string) ($params['search'] ?? ''));
        $limit = max(1, min(20, (int) ($params['limit'] ?? 10)));

        if ($search === '') {
            return [];
        }

        $bindings = [
            ':search_order' => '%' . $search . '%',
            ':search_customer' => '%' . $search . '%',
            ':search_phone' => '%' . $search . '%',
        ];

        $rows = $this->database->fetchAll(
            "SELECT id, orderNumber, customerName, customerPhone
             FROM orders_with_customer_creator
             WHERE orderNumber LIKE :search_order
                OR customerName LIKE :search_customer
                OR customerPhone LIKE :search_phone
             ORDER BY createdAt DESC
             LIMIT {$limit}",
            $bindings
        );

        return array_map(static fn(array $row): array => [
            'id' => (string) ($row['id'] ?? ''),
            'orderNumber' => (string) ($row['orderNumber'] ?? ''),
            'customerName' => $row['customerName'] !== null ? (string) $row['customerName'] : null,
            'customerPhone' => $row['customerPhone'] !== null ? (string) $row['customerPhone'] : null,
        ], $rows);
    }

    public function fetchOrdersPage(array $params): array
    {
        $pageSize = $this->pageSize($params);
        $offset = $this->pageOffset($params);
        $filters = is_array($params['filters'] ?? null) ? $params['filters'] : $params;
        $where = 'WHERE 1=1';
        $bindings = [];

        $status = trim((string) ($filters['status'] ?? ''));
        if ($status !== '' && $status !== 'All') {
            $where .= ' AND status = :status';
            $bindings[':status'] = $status;
        }
        if (!empty($filters['from'])) {
            $where .= ' AND createdAt >= :from';
            $bindings[':from'] = $this->normalizeDateTimeInput((string) $filters['from']);
        }
        if (!empty($filters['to'])) {
            $where .= ' AND createdAt <= :to';
            $bindings[':to'] = $this->normalizeDateTimeInput((string) $filters['to']);
        }

        $createdByIds = is_array($filters['createdByIds'] ?? null) ? $filters['createdByIds'] : [];
        $createdByIds = array_values(array_filter(array_map('strval', $createdByIds), static fn(string $id): bool => trim($id) !== ''));
        if ($createdByIds !== []) {
            [$placeholders, $inBindings] = $this->inClause($createdByIds, 'created_by');
            $where .= ' AND createdBy IN (' . implode(', ', $placeholders) . ')';
            $bindings += $inBindings;
        }

        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            if (preg_match('/\d/', $search) === 1) {
                $where .= ' AND (customerPhone LIKE :search_phone OR orderNumber LIKE :search_number)';
                $bindings[':search_phone'] = '%' . $search . '%';
                $bindings[':search_number'] = '%' . $search . '%';
            } else {
                $where .= ' AND (customerName LIKE :search_name OR orderNumber LIKE :search_number)';
                $bindings[':search_name'] = '%' . $search . '%';
                $bindings[':search_number'] = '%' . $search . '%';
            }
        }

        $countRow = $this->database->fetchOne("SELECT COUNT(*) AS count FROM orders_with_customer_creator {$where}", $bindings);
        $rows = $this->database->fetchAll(
            "SELECT
                id,
                orderNumber,
                orderDate,
                customerId,
                customerName,
                customerPhone,
                customerAddress,
                createdBy,
                creatorName,
                status,
                total,
                notes,
                history,
                paidAmount,
                createdAt,
                deletedAt,
                deletedBy,
                carrybeeConsignmentId,
                steadfastConsignmentId,
                paperflyTrackingNumber
             FROM orders_with_customer_creator
             {$where}
             ORDER BY createdAt DESC
             LIMIT {$pageSize} OFFSET {$offset}",
            $bindings
        );

        return [
            'data' => array_map(fn(array $row): array => $this->mapOrder($row), $rows),
            'count' => (int) ($countRow['count'] ?? 0),
        ];
    }

    public function fetchOrderById(array $params): ?array
    {
        $row = $this->fetchOrderRowById(trim((string) ($params['id'] ?? '')));
        return $row ? $this->mapOrder($row) : null;
    }

    public function fetchOrdersByCustomerId(array $params): array
    {
        $customerId = trim((string) ($params['customerId'] ?? ''));
        if ($customerId === '') {
            return [];
        }

        $rows = $this->database->fetchAll(
            'SELECT * FROM orders_with_customer_creator WHERE customerId = :customer_id ORDER BY orderDate DESC, createdAt DESC',
            [':customer_id' => $customerId]
        );

        return array_map(fn(array $row): array => $this->mapOrder($row), $rows);
    }

    public function fetchEmployeeOrderCounts(array $params): array
    {
        $createdByIds = is_array($params['createdByIds'] ?? null) ? $params['createdByIds'] : [];
        $filters = is_array($params['filters'] ?? null) ? $params['filters'] : $params;
        $results = [];

        foreach ($createdByIds as $userIdRaw) {
            $userId = trim((string) $userIdRaw);
            if ($userId === '') {
                continue;
            }

            $sql = 'SELECT COUNT(*) AS count FROM orders WHERE created_by = :created_by AND deleted_at IS NULL';
            $bindings = [':created_by' => $userId];
            if (!empty($filters['from'])) {
                $sql .= ' AND created_at >= :from';
                $bindings[':from'] = $this->normalizeDateTimeInput((string) $filters['from']);
            }
            if (!empty($filters['to'])) {
                $sql .= ' AND created_at <= :to';
                $bindings[':to'] = $this->normalizeDateTimeInput((string) $filters['to']);
            }

            $row = $this->database->fetchOne($sql, $bindings);
            $results[] = ['userId' => $userId, 'orderCount' => (int) ($row['count'] ?? 0)];
        }

        return $results;
    }

    public function fetchUserActivityPerformanceReportPage(array $params): array
    {
        $this->requireAdmin();

        $page = max(1, (int) ($params['page'] ?? 1));
        $pageSize = max(1, min(25, (int) ($params['pageSize'] ?? 10)));
        $offset = ($page - 1) * $pageSize;
        $filters = $this->buildDashboardDateFilters($params);
        $search = trim((string) ($params['search'] ?? ''));
        $roleFilter = trim((string) ($params['roleFilter'] ?? 'All Users'));
        $onlyActive = filter_var($params['onlyActive'] ?? false, FILTER_VALIDATE_BOOL);

        [$userWhereSql, $bindings] = $this->buildUserActivityPerformanceUserWhere($search, $roleFilter);
        $activityExpression = '(COALESCE(oa.ordersCreated, 0) + COALESCE(ba.billsCreated, 0) + COALESCE(ta.transactionsCreated, 0))';
        $ordersDateSql = $this->buildUserActivityPerformanceDateBoundsSql('o.created_at', $filters, $bindings, 'report_orders');
        $billsDateSql = $this->buildUserActivityPerformanceDateBoundsSql('b.created_at', $filters, $bindings, 'report_bills');
        $transactionsDateSql = $this->buildUserActivityPerformanceDateBoundsSql('t.created_at', $filters, $bindings, 'report_transactions');

        $baseSql = "
            FROM users u
            LEFT JOIN (
                SELECT
                    o.created_by AS user_id,
                    COUNT(*) AS ordersCreated,
                    SUM(CASE WHEN o.status = 'Completed' THEN 1 ELSE 0 END) AS completedOrders,
                    SUM(CASE WHEN o.status = 'Processing' THEN 1 ELSE 0 END) AS processingOrders,
                    SUM(CASE WHEN o.status = 'Picked' THEN 1 ELSE 0 END) AS pickedOrders,
                    SUM(CASE WHEN o.status = 'On Hold' THEN 1 ELSE 0 END) AS onHoldOrders,
                    SUM(CASE WHEN o.status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelledOrders,
                    COALESCE(SUM(o.total), 0) AS orderValue,
                    COALESCE(SUM(CASE WHEN o.status = 'Completed' THEN o.total ELSE 0 END), 0) AS completedOrderValue,
                    COALESCE(SUM(o.paid_amount), 0) AS orderPaidAmount,
                    COUNT(DISTINCT CASE WHEN o.customer_id IS NULL OR o.customer_id = '' THEN NULL ELSE o.customer_id END) AS uniqueCustomers
                FROM orders o
                WHERE o.deleted_at IS NULL{$ordersDateSql}
                GROUP BY o.created_by
            ) oa ON oa.user_id = u.id
            LEFT JOIN (
                SELECT
                    b.created_by AS user_id,
                    COUNT(*) AS billsCreated,
                    COALESCE(SUM(b.total), 0) AS billValue,
                    COALESCE(SUM(b.paid_amount), 0) AS billPaidAmount,
                    COUNT(DISTINCT CASE WHEN b.vendor_id IS NULL OR b.vendor_id = '' THEN NULL ELSE b.vendor_id END) AS uniqueVendors
                FROM bills b
                WHERE b.deleted_at IS NULL{$billsDateSql}
                GROUP BY b.created_by
            ) ba ON ba.user_id = u.id
            LEFT JOIN (
                SELECT
                    t.created_by AS user_id,
                    COUNT(*) AS transactionsCreated,
                    SUM(CASE WHEN t.type = 'Income' THEN 1 ELSE 0 END) AS incomeTransactions,
                    COALESCE(SUM(CASE WHEN t.type = 'Income' THEN t.amount ELSE 0 END), 0) AS incomeAmount,
                    SUM(CASE WHEN t.type = 'Expense' THEN 1 ELSE 0 END) AS expenseTransactions,
                    COALESCE(SUM(CASE WHEN t.type = 'Expense' THEN t.amount ELSE 0 END), 0) AS expenseAmount,
                    SUM(CASE WHEN t.type = 'Transfer' THEN 1 ELSE 0 END) AS transferTransactions,
                    COALESCE(SUM(CASE WHEN t.type = 'Transfer' THEN t.amount ELSE 0 END), 0) AS transferAmount
                FROM transactions t
                WHERE t.deleted_at IS NULL{$transactionsDateSql}
                GROUP BY t.created_by
            ) ta ON ta.user_id = u.id
            {$userWhereSql}
        ";

        $baseSql .= " AND (u.deleted_at IS NULL OR {$activityExpression} > 0)";

        if ($onlyActive) {
            $baseSql .= " AND {$activityExpression} > 0";
        }

        $countRow = $this->database->fetchOne(
            "SELECT COUNT(*) AS count {$baseSql}",
            $bindings
        );

        $totalsRow = $this->database->fetchOne(
            "SELECT
                COUNT(*) AS users,
                COALESCE(SUM(CASE WHEN {$activityExpression} > 0 THEN 1 ELSE 0 END), 0) AS activeUsers,
                COALESCE(SUM(COALESCE(oa.ordersCreated, 0)), 0) AS orders,
                COALESCE(SUM(COALESCE(ba.billsCreated, 0)), 0) AS bills,
                COALESCE(SUM(COALESCE(ta.transactionsCreated, 0)), 0) AS transactions,
                COALESCE(SUM(COALESCE(oa.orderValue, 0)), 0) AS orderValue
             {$baseSql}",
            $bindings
        );

        $rows = $this->database->fetchAll(
            "SELECT
                u.id,
                u.name,
                u.phone,
                u.role,
                u.image,
                u.created_at,
                u.deleted_at,
                u.deleted_by,
                COALESCE(oa.ordersCreated, 0) AS ordersCreated,
                COALESCE(oa.completedOrders, 0) AS completedOrders,
                COALESCE(oa.processingOrders, 0) AS processingOrders,
                COALESCE(oa.pickedOrders, 0) AS pickedOrders,
                COALESCE(oa.onHoldOrders, 0) AS onHoldOrders,
                COALESCE(oa.cancelledOrders, 0) AS cancelledOrders,
                COALESCE(oa.orderValue, 0) AS orderValue,
                COALESCE(oa.completedOrderValue, 0) AS completedOrderValue,
                COALESCE(oa.orderPaidAmount, 0) AS orderPaidAmount,
                COALESCE(oa.uniqueCustomers, 0) AS uniqueCustomers,
                COALESCE(ba.billsCreated, 0) AS billsCreated,
                COALESCE(ba.billValue, 0) AS billValue,
                COALESCE(ba.billPaidAmount, 0) AS billPaidAmount,
                COALESCE(ba.uniqueVendors, 0) AS uniqueVendors,
                COALESCE(ta.transactionsCreated, 0) AS transactionsCreated,
                COALESCE(ta.incomeTransactions, 0) AS incomeTransactions,
                COALESCE(ta.incomeAmount, 0) AS incomeAmount,
                COALESCE(ta.expenseTransactions, 0) AS expenseTransactions,
                COALESCE(ta.expenseAmount, 0) AS expenseAmount,
                COALESCE(ta.transferTransactions, 0) AS transferTransactions,
                COALESCE(ta.transferAmount, 0) AS transferAmount,
                {$activityExpression} AS totalActivities
             {$baseSql}
             ORDER BY totalActivities DESC, COALESCE(oa.orderValue, 0) DESC, u.name ASC
             LIMIT {$pageSize} OFFSET {$offset}",
            $bindings
        );

        $derivedMetrics = $this->fetchUserActivityPerformanceDerivedMetrics(
            array_map(static fn(array $row): string => (string) ($row['id'] ?? ''), $rows),
            $filters
        );

        return [
            'data' => array_map(fn(array $row): array => $this->mapUserActivityPerformanceSummary($row, $derivedMetrics[(string) ($row['id'] ?? '')] ?? []), $rows),
            'count' => (int) ($countRow['count'] ?? 0),
            'totals' => [
                'users' => (int) ($totalsRow['users'] ?? 0),
                'activeUsers' => (int) ($totalsRow['activeUsers'] ?? 0),
                'orders' => (int) ($totalsRow['orders'] ?? 0),
                'bills' => (int) ($totalsRow['bills'] ?? 0),
                'transactions' => (int) ($totalsRow['transactions'] ?? 0),
                'orderValue' => (float) ($totalsRow['orderValue'] ?? 0),
            ],
        ];
    }

    public function fetchUserActivityPerformanceLog(array $params): array
    {
        $this->requireAdmin();

        $userId = trim((string) ($params['userId'] ?? $params['id'] ?? ''));
        if ($userId === '') {
            return [];
        }

        $filters = $this->buildDashboardDateFilters($params);
        $entries = [];

        $orderBindings = [':user_id' => $userId];
        $orderDateSql = $this->buildUserActivityPerformanceDateBoundsSql('o.created_at', $filters, $orderBindings, 'log_orders');
        $orderRows = $this->database->fetchAll(
            "SELECT
                o.id,
                o.order_number,
                c.name AS customer_name,
                o.status,
                o.items,
                o.total,
                o.paid_amount,
                o.created_at
             FROM orders o
             LEFT JOIN customers c ON c.id = o.customer_id
             WHERE o.deleted_at IS NULL
               AND o.created_by = :user_id{$orderDateSql}
             ORDER BY o.created_at DESC",
            $orderBindings
        );

        foreach ($orderRows as $row) {
            $items = $this->jsonDecodeList($row['items'] ?? []);
            $entries[] = [
                'id' => 'order-' . (string) ($row['id'] ?? ''),
                'type' => 'Order',
                'rawDate' => $this->toIso($row['created_at'] ?? null) ?? (string) ($row['created_at'] ?? ''),
                'reference' => (string) ($row['order_number'] ?? $row['id'] ?? ''),
                'counterparty' => $this->nullableString($row['customer_name'] ?? null) ?? 'Unknown customer',
                'details' => $this->summarizeUserActivityItems($items) . ' | Paid ' . $this->formatMoney($row['paid_amount'] ?? 0),
                'quantity' => $this->sumUserActivityItemsQuantity($items),
                'amount' => (float) ($row['total'] ?? 0),
                'status' => (string) ($row['status'] ?? ''),
            ];
        }

        $billBindings = [':user_id' => $userId];
        $billDateSql = $this->buildUserActivityPerformanceDateBoundsSql('b.created_at', $filters, $billBindings, 'log_bills');
        $billRows = $this->database->fetchAll(
            "SELECT
                b.id,
                b.bill_number,
                v.name AS vendor_name,
                b.status,
                b.items,
                b.total,
                b.paid_amount,
                b.created_at
             FROM bills b
             LEFT JOIN vendors v ON v.id = b.vendor_id
             WHERE b.deleted_at IS NULL
               AND b.created_by = :user_id{$billDateSql}
             ORDER BY b.created_at DESC",
            $billBindings
        );

        foreach ($billRows as $row) {
            $items = $this->jsonDecodeList($row['items'] ?? []);
            $entries[] = [
                'id' => 'bill-' . (string) ($row['id'] ?? ''),
                'type' => 'Bill',
                'rawDate' => $this->toIso($row['created_at'] ?? null) ?? (string) ($row['created_at'] ?? ''),
                'reference' => (string) ($row['bill_number'] ?? $row['id'] ?? ''),
                'counterparty' => $this->nullableString($row['vendor_name'] ?? null) ?? 'Unknown vendor',
                'details' => $this->summarizeUserActivityItems($items) . ' | Paid ' . $this->formatMoney($row['paid_amount'] ?? 0),
                'quantity' => $this->sumUserActivityItemsQuantity($items),
                'amount' => (float) ($row['total'] ?? 0),
                'status' => (string) ($row['status'] ?? ''),
            ];
        }

        $transactionBindings = [':user_id' => $userId];
        $transactionDateSql = $this->buildUserActivityPerformanceDateBoundsSql('t.created_at', $filters, $transactionBindings, 'log_transactions');
        $transactionRows = $this->database->fetchAll(
            "SELECT
                t.id,
                t.type,
                t.amount,
                t.reference_id,
                t.description,
                t.category,
                t.created_at,
                a.name AS account_name,
                COALESCE(c.name, v.name) AS contact_name,
                cat.name AS category_name
             FROM transactions t
             LEFT JOIN accounts a ON a.id = t.account_id
             LEFT JOIN customers c ON c.id = t.contact_id
                LEFT JOIN vendors v ON v.id = t.contact_id
                LEFT JOIN categories cat ON cat.id = t.category
             WHERE t.deleted_at IS NULL
               AND t.created_by = :user_id{$transactionDateSql}
             ORDER BY t.created_at DESC",
            $transactionBindings
        );

        foreach ($transactionRows as $row) {
            $parts = array_values(array_filter([
                $this->nullableString($row['category_name'] ?? null) ?? $this->nullableString($row['category'] ?? null) ?? 'Uncategorized',
                $this->nullableString($row['account_name'] ?? null) ? 'Account: ' . (string) $row['account_name'] : '',
                $this->nullableString($row['description'] ?? null) ?? '',
            ]));

            $entries[] = [
                'id' => 'transaction-' . (string) ($row['id'] ?? ''),
                'type' => 'Transaction',
                'rawDate' => $this->toIso($row['created_at'] ?? null) ?? (string) ($row['created_at'] ?? ''),
                'reference' => $this->nullableString($row['reference_id'] ?? null) ?? substr((string) ($row['id'] ?? ''), 0, 8),
                'counterparty' => $this->nullableString($row['contact_name'] ?? null) ?? 'Internal entry',
                'details' => implode(' | ', $parts),
                'quantity' => null,
                'amount' => (float) ($row['amount'] ?? 0),
                'status' => (string) ($row['type'] ?? ''),
            ];
        }

        usort($entries, static function (array $left, array $right): int {
            return strcmp((string) ($right['rawDate'] ?? ''), (string) ($left['rawDate'] ?? ''));
        });

        return $entries;
    }

    /**
     * @return array{0: string, 1: array<string, mixed>}
     */
    private function buildUserActivityPerformanceUserWhere(string $search, string $roleFilter): array
    {
        $conditions = ['WHERE 1=1'];
        $bindings = [];

        if ($roleFilter === 'Admins') {
            $conditions[] = "u.role IN ('Admin', 'Developer')";
        } elseif ($roleFilter === 'Employees') {
            $conditions[] = "u.role IN ('Employee', 'Employee1')";
        }

        if ($search !== '') {
            $bindings[':user_activity_search_name'] = '%' . $search . '%';
            $bindings[':user_activity_search_phone'] = '%' . $search . '%';
            $bindings[':user_activity_search_role'] = '%' . $search . '%';
            $conditions[] = '(u.name LIKE :user_activity_search_name OR u.phone LIKE :user_activity_search_phone OR u.role LIKE :user_activity_search_role)';
        }

        return [implode(' AND ', $conditions), $bindings];
    }

    /**
     * @param array<string, string|null> $filters
     * @param array<string, mixed> $bindings
     */
    private function buildUserActivityPerformanceDateBoundsSql(
        string $column,
        array $filters,
        array &$bindings,
        string $bindingPrefix
    ): string {
        $conditions = [];
        $this->applyDashboardDateTimeBounds($column, $filters, $conditions, $bindings, $bindingPrefix);
        return $conditions === [] ? '' : ' AND ' . implode(' AND ', $conditions);
    }

    /**
     * @param list<string> $userIds
     * @param array<string, string|null> $filters
     * @return array<string, array<string, mixed>>
     */
    private function fetchUserActivityPerformanceDerivedMetrics(array $userIds, array $filters): array
    {
        $normalizedIds = array_values(array_unique(array_filter(
            array_map(static fn($id): string => trim((string) $id), $userIds),
            static fn(string $id): bool => $id !== ''
        )));

        if ($normalizedIds === []) {
            return [];
        }

        $derived = [];
        foreach ($normalizedIds as $userId) {
            $derived[$userId] = [
                'orderQuantity' => 0,
                'activityDays' => [],
                'firstActivityRaw' => null,
                'lastActivityRaw' => null,
            ];
        }

        [$orderPlaceholders, $orderBindings] = $this->inClause($normalizedIds, 'report_detail_order_user');
        $orderSql = "SELECT created_by, created_at, items
            FROM orders
            WHERE deleted_at IS NULL
              AND created_by IN (" . implode(', ', $orderPlaceholders) . ')';
        $orderSql .= $this->buildUserActivityPerformanceDateBoundsSql('created_at', $filters, $orderBindings, 'report_detail_orders');

        foreach ($this->database->fetchAll($orderSql, $orderBindings) as $row) {
            $userId = trim((string) ($row['created_by'] ?? ''));
            if ($userId === '' || !isset($derived[$userId])) {
                continue;
            }

            $items = $this->jsonDecodeList($row['items'] ?? []);
            $derived[$userId]['orderQuantity'] += $this->sumUserActivityItemsQuantity($items);
            $this->trackUserActivityPerformanceMoment($derived[$userId], $row['created_at'] ?? null);
        }

        [$billPlaceholders, $billBindings] = $this->inClause($normalizedIds, 'report_detail_bill_user');
        $billSql = "SELECT created_by, created_at
            FROM bills
            WHERE deleted_at IS NULL
              AND created_by IN (" . implode(', ', $billPlaceholders) . ')';
        $billSql .= $this->buildUserActivityPerformanceDateBoundsSql('created_at', $filters, $billBindings, 'report_detail_bills');

        foreach ($this->database->fetchAll($billSql, $billBindings) as $row) {
            $userId = trim((string) ($row['created_by'] ?? ''));
            if ($userId === '' || !isset($derived[$userId])) {
                continue;
            }

            $this->trackUserActivityPerformanceMoment($derived[$userId], $row['created_at'] ?? null);
        }

        [$transactionPlaceholders, $transactionBindings] = $this->inClause($normalizedIds, 'report_detail_transaction_user');
        $transactionSql = "SELECT created_by, created_at
            FROM transactions
            WHERE deleted_at IS NULL
              AND created_by IN (" . implode(', ', $transactionPlaceholders) . ')';
        $transactionSql .= $this->buildUserActivityPerformanceDateBoundsSql('created_at', $filters, $transactionBindings, 'report_detail_transactions');

        foreach ($this->database->fetchAll($transactionSql, $transactionBindings) as $row) {
            $userId = trim((string) ($row['created_by'] ?? ''));
            if ($userId === '' || !isset($derived[$userId])) {
                continue;
            }

            $this->trackUserActivityPerformanceMoment($derived[$userId], $row['created_at'] ?? null);
        }

        foreach ($derived as $userId => $metrics) {
            $derived[$userId] = [
                'orderQuantity' => (int) ($metrics['orderQuantity'] ?? 0),
                'activeDays' => count((array) ($metrics['activityDays'] ?? [])),
                'firstActivity' => $this->toIso($metrics['firstActivityRaw'] ?? null),
                'lastActivity' => $this->toIso($metrics['lastActivityRaw'] ?? null),
            ];
        }

        return $derived;
    }

    /**
     * @param array<string, mixed> $bucket
     * @param mixed $createdAt
     */
    private function trackUserActivityPerformanceMoment(array &$bucket, $createdAt): void
    {
        $raw = trim((string) ($createdAt ?? ''));
        if ($raw === '') {
            return;
        }

        $localDay = $this->localDateFromUtc($raw);
        if ($localDay !== '') {
            if (!is_array($bucket['activityDays'] ?? null)) {
                $bucket['activityDays'] = [];
            }
            $bucket['activityDays'][$localDay] = true;
        }

        if (!isset($bucket['firstActivityRaw']) || $bucket['firstActivityRaw'] === null || $raw < (string) $bucket['firstActivityRaw']) {
            $bucket['firstActivityRaw'] = $raw;
        }
        if (!isset($bucket['lastActivityRaw']) || $bucket['lastActivityRaw'] === null || $raw > (string) $bucket['lastActivityRaw']) {
            $bucket['lastActivityRaw'] = $raw;
        }
    }

    /**
     * @param array<int, array<string, mixed>> $items
     */
    private function sumUserActivityItemsQuantity(array $items): int
    {
        $sum = 0;
        foreach ($items as $item) {
            $sum += (int) ($item['quantity'] ?? 0);
        }

        return $sum;
    }

    /**
     * @param array<int, array<string, mixed>> $items
     */
    private function summarizeUserActivityItems(array $items): string
    {
        if ($items === []) {
            return 'No line items';
        }

        $parts = [];
        foreach (array_slice($items, 0, 3) as $item) {
            $name = trim((string) ($item['productName'] ?? $item['name'] ?? 'Item'));
            $parts[] = $name . ' x' . (int) ($item['quantity'] ?? 0);
        }

        $summary = implode(', ', $parts);
        if (count($items) > 3) {
            $summary .= ' +' . (count($items) - 3) . ' more';
        }

        return $summary;
    }

    /**
     * @param array<string, mixed> $row
     * @param array<string, mixed> $derived
     * @return array<string, mixed>
     */
    private function mapUserActivityPerformanceSummary(array $row, array $derived = []): array
    {
        $ordersCreated = (int) ($row['ordersCreated'] ?? 0);
        $orderValue = (float) ($row['orderValue'] ?? 0);
        $orderPaidAmount = (float) ($row['orderPaidAmount'] ?? 0);
        $billValue = (float) ($row['billValue'] ?? 0);
        $billPaidAmount = (float) ($row['billPaidAmount'] ?? 0);
        $totalActivities = (int) ($row['totalActivities'] ?? 0);

        return [
            'user' => $this->mapUser($row),
            'metrics' => [
                'totalActivities' => $totalActivities,
                'activeDays' => (int) ($derived['activeDays'] ?? 0),
                'ordersCreated' => $ordersCreated,
                'completedOrders' => (int) ($row['completedOrders'] ?? 0),
                'processingOrders' => (int) ($row['processingOrders'] ?? 0),
                'pickedOrders' => (int) ($row['pickedOrders'] ?? 0),
                'onHoldOrders' => (int) ($row['onHoldOrders'] ?? 0),
                'cancelledOrders' => (int) ($row['cancelledOrders'] ?? 0),
                'orderValue' => $orderValue,
                'completedOrderValue' => (float) ($row['completedOrderValue'] ?? 0),
                'orderPaidAmount' => $orderPaidAmount,
                'orderQuantity' => (int) ($derived['orderQuantity'] ?? 0),
                'uniqueCustomers' => (int) ($row['uniqueCustomers'] ?? 0),
                'averageOrderValue' => $ordersCreated > 0 ? $orderValue / $ordersCreated : 0,
                'completionRate' => $ordersCreated > 0 ? (((int) ($row['completedOrders'] ?? 0)) / $ordersCreated) * 100 : 0,
                'collectionRate' => $orderValue > 0 ? ($orderPaidAmount / $orderValue) * 100 : 0,
                'billsCreated' => (int) ($row['billsCreated'] ?? 0),
                'billValue' => $billValue,
                'billPaidAmount' => $billPaidAmount,
                'uniqueVendors' => (int) ($row['uniqueVendors'] ?? 0),
                'billSettlementRate' => $billValue > 0 ? ($billPaidAmount / $billValue) * 100 : 0,
                'transactionsCreated' => (int) ($row['transactionsCreated'] ?? 0),
                'incomeTransactions' => (int) ($row['incomeTransactions'] ?? 0),
                'incomeAmount' => (float) ($row['incomeAmount'] ?? 0),
                'expenseTransactions' => (int) ($row['expenseTransactions'] ?? 0),
                'expenseAmount' => (float) ($row['expenseAmount'] ?? 0),
                'transferTransactions' => (int) ($row['transferTransactions'] ?? 0),
                'transferAmount' => (float) ($row['transferAmount'] ?? 0),
                'firstActivity' => $this->nullableString($derived['firstActivity'] ?? null),
                'lastActivity' => $this->nullableString($derived['lastActivity'] ?? null),
            ],
        ];
    }

    /**
     * @return array<string, string|null>
     */
    private function parseCustomDateBoundary(string $value, \DateTimeZone $localTimezone, bool $endOfRange): ?\DateTimeImmutable
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return null;
        }

        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $trimmed) === 1) {
            $candidate = \DateTimeImmutable::createFromFormat('!Y-m-d', $trimmed, $localTimezone);
            if ($candidate instanceof \DateTimeImmutable) {
                return $endOfRange ? $candidate->setTime(23, 59, 59) : $candidate->setTime(0, 0, 0);
            }
        }

        $normalized = str_replace('T', ' ', $trimmed);
        if (preg_match('/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/', $normalized) === 1) {
            $candidate = \DateTimeImmutable::createFromFormat('Y-m-d H:i', $normalized, $localTimezone);
            if ($candidate instanceof \DateTimeImmutable) {
                $hour = (int) $candidate->format('H');
                $minute = (int) $candidate->format('i');
                return $endOfRange ? $candidate->setTime($hour, $minute, 59) : $candidate->setTime($hour, $minute, 0);
            }
        }

        try {
            return new \DateTimeImmutable($trimmed, $localTimezone);
        } catch (\Exception) {
            return null;
        }
    }

    /**
     * @return array<string, string|null>
     */
    private function buildDashboardDateFilters(array $params): array
    {
        $filterRange = trim((string) ($params['filterRange'] ?? 'All Time'));
        $customDates = is_array($params['customDates'] ?? null) ? $params['customDates'] : [];
        $localTimezone = new \DateTimeZone($this->config->timezone());
        $utcTimezone = new \DateTimeZone('UTC');
        $nowLocal = new \DateTimeImmutable('now', $localTimezone);

        $fromLocal = null;
        $toLocal = null;

        if ($filterRange === 'Today') {
            $fromLocal = $nowLocal->setTime(0, 0, 0);
            $toLocal = $nowLocal->setTime(23, 59, 59);
        } elseif ($filterRange === 'This Week') {
            $dayOfWeek = (int) $nowLocal->format('w');
            $fromLocal = $nowLocal->modify("-{$dayOfWeek} days")->setTime(0, 0, 0);
            $toLocal = $nowLocal->setTime(23, 59, 59);
        } elseif ($filterRange === 'This Month') {
            $fromLocal = $nowLocal->modify('first day of this month')->setTime(0, 0, 0);
            $toLocal = $nowLocal->setTime(23, 59, 59);
        } elseif ($filterRange === 'This Year') {
            $fromLocal = $nowLocal->setDate((int) $nowLocal->format('Y'), 1, 1)->setTime(0, 0, 0);
            $toLocal = $nowLocal->setTime(23, 59, 59);
        } elseif ($filterRange === 'Custom') {
            $fromValue = trim((string) ($customDates['from'] ?? ''));
            $toValue = trim((string) ($customDates['to'] ?? ''));

            $fromLocal = $this->parseCustomDateBoundary($fromValue, $localTimezone, false);
            $toLocal = $this->parseCustomDateBoundary($toValue, $localTimezone, true);
        }

        if ($fromLocal instanceof \DateTimeImmutable && $toLocal instanceof \DateTimeImmutable && $fromLocal > $toLocal) {
            [$fromLocal, $toLocal] = [$toLocal, $fromLocal];
        }

        $currentYear = (int) $nowLocal->format('Y');
        $currentYearStartLocal = $nowLocal->setDate($currentYear, 1, 1)->setTime(0, 0, 0);
        $nextYearStartLocal = $nowLocal->setDate($currentYear + 1, 1, 1)->setTime(0, 0, 0);

        return [
            'filterRange' => $filterRange,
            'fromDateTime' => $fromLocal instanceof \DateTimeImmutable ? $fromLocal->setTimezone($utcTimezone)->format('Y-m-d H:i:s') : null,
            'toDateTime' => $toLocal instanceof \DateTimeImmutable ? $toLocal->setTimezone($utcTimezone)->format('Y-m-d H:i:s') : null,
            'fromDate' => $fromLocal instanceof \DateTimeImmutable ? $fromLocal->format('Y-m-d') : null,
            'toDate' => $toLocal instanceof \DateTimeImmutable ? $toLocal->format('Y-m-d') : null,
            'todayStartUtc' => $nowLocal->setTime(0, 0, 0)->setTimezone($utcTimezone)->format('Y-m-d H:i:s'),
            'todayEndUtc' => $nowLocal->setTime(23, 59, 59)->setTimezone($utcTimezone)->format('Y-m-d H:i:s'),
            'currentYearStartUtc' => $currentYearStartLocal->setTimezone($utcTimezone)->format('Y-m-d H:i:s'),
            'nextYearStartUtc' => $nextYearStartLocal->setTimezone($utcTimezone)->format('Y-m-d H:i:s'),
        ];
    }

    /**
     * @param array<string, string|null> $filters
     * @param array<int, string> $conditions
     * @param array<string, mixed> $bindings
     */
    private function applyDashboardDateTimeBounds(
        string $column,
        array $filters,
        array &$conditions,
        array &$bindings,
        string $bindingPrefix
    ): void {
        if (!empty($filters['fromDateTime'])) {
            $conditions[] = "{$column} >= :{$bindingPrefix}_from";
            $bindings[":{$bindingPrefix}_from"] = $filters['fromDateTime'];
        }

        if (!empty($filters['toDateTime'])) {
            $conditions[] = "{$column} <= :{$bindingPrefix}_to";
            $bindings[":{$bindingPrefix}_to"] = $filters['toDateTime'];
        }
    }

    /**
     * @param array<string, string|null> $filters
     * @param array<int, string> $conditions
     * @param array<string, mixed> $bindings
     */
    private function applyDashboardDateBounds(
        string $column,
        array $filters,
        array &$conditions,
        array &$bindings,
        string $bindingPrefix
    ): void {
        if (!empty($filters['fromDate'])) {
            $conditions[] = "{$column} >= :{$bindingPrefix}_from_date";
            $bindings[":{$bindingPrefix}_from_date"] = $filters['fromDate'];
        }

        if (!empty($filters['toDate'])) {
            $conditions[] = "{$column} <= :{$bindingPrefix}_to_date";
            $bindings[":{$bindingPrefix}_to_date"] = $filters['toDate'];
        }
    }

    private function ensureReportsViewPermission(): void
    {
        if (!$this->currentUserHasPermission('reports.view')) {
            throw new RuntimeException('You do not have permission to view reports.');
        }
    }

    private function normalizeReportSearchTerm(string $value): string
    {
        $trimmed = trim($value);
        if ($trimmed === '') {
            return '';
        }

        return function_exists('mb_strtolower')
            ? mb_strtolower($trimmed, 'UTF-8')
            : strtolower($trimmed);
    }

    /**
     * @param array<string, mixed> $params
     * @return array<string, mixed>
     */
    private function normalizeProfitLossFilterParams(array $params): array
    {
        $filterRange = trim((string) ($params['filterRange'] ?? ''));
        $dateRange = trim((string) ($params['dateRange'] ?? ''));
        $customDates = is_array($params['customDates'] ?? null) ? $params['customDates'] : [];

        if ($dateRange !== '' && $filterRange === '') {
            if ($dateRange === 'currentMonth') {
                $filterRange = 'This Month';
            } elseif ($dateRange === 'custom') {
                $filterRange = 'Custom';
                $customDates = [
                    'from' => trim((string) ($params['customFrom'] ?? ($customDates['from'] ?? ''))),
                    'to' => trim((string) ($params['customTo'] ?? ($customDates['to'] ?? ''))),
                ];
            } else {
                $filterRange = 'This Year';
            }
        }

        if ($filterRange === '') {
            $filterRange = 'This Year';
        }

        return [
            'filterRange' => $filterRange,
            'customDates' => $customDates,
        ];
    }

    /**
     * @param array<string, string|null> $filters
     * @return array<string, mixed>
     */
    private function buildDashboardAdminSnapshot(array $filters): array
    {
        $statusKeyMap = [
            'On Hold' => 'onHold',
            'Processing' => 'processing',
            'Picked' => 'picked',
            'Completed' => 'completed',
            'Returned' => 'returned',
            'Cancelled' => 'cancelled',
        ];

        $baseMetrics = [
            'total' => 0,
            'onHold' => 0,
            'processing' => 0,
            'picked' => 0,
            'completed' => 0,
            'returned' => 0,
            'cancelled' => 0,
        ];

        $orderConditions = ['deleted_at IS NULL'];
        $orderBindings = [];
        $this->applyDashboardDateTimeBounds('created_at', $filters, $orderConditions, $orderBindings, 'dashboard_order');

        $transactionConditions = ['deleted_at IS NULL'];
        $transactionBindings = [];
        $this->applyDashboardDateTimeBounds('created_at', $filters, $transactionConditions, $transactionBindings, 'dashboard_txn');

        $billConditions = ['deleted_at IS NULL'];
        $billBindings = [];
        $this->applyDashboardDateTimeBounds('created_at', $filters, $billConditions, $billBindings, 'dashboard_bill');

        $orderRows = $this->database->fetchAll(
            'SELECT status, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
             FROM orders
             WHERE ' . implode(' AND ', $orderConditions) . '
             GROUP BY status',
            $orderBindings
        );

        $orderCounts = $baseMetrics;
        $orderTotals = $baseMetrics;
        foreach ($orderRows as $row) {
            $status = trim((string) ($row['status'] ?? ''));
            $key = $statusKeyMap[$status] ?? null;
            if ($key === null) {
                continue;
            }

            $count = (int) ($row['count'] ?? 0);
            $total = (float) ($row['total'] ?? 0);

            $orderCounts[$key] = $count;
            $orderTotals[$key] = $total;
            $orderCounts['total'] += $count;
            $orderTotals['total'] += $total;
        }

        $transactionSummary = $this->database->fetchOne(
            'SELECT
                COALESCE(SUM(CASE WHEN type = \'Income\' AND reference_id IS NOT NULL THEN amount ELSE 0 END), 0) AS salesFromTransactions,
                COALESCE(SUM(CASE WHEN type = \'Expense\' AND category = \'expense_purchases\' THEN amount ELSE 0 END), 0) AS purchasesFromTransactions,
                COALESCE(SUM(CASE WHEN type = \'Expense\' AND COALESCE(category, \'\') <> \'expense_purchases\' THEN amount ELSE 0 END), 0) AS otherExpenses
             FROM transactions
             WHERE ' . implode(' AND ', $transactionConditions),
            $transactionBindings
        ) ?? [];

        $billSummary = $this->database->fetchOne(
            'SELECT COALESCE(SUM(total), 0) AS totalPurchases
             FROM bills
             WHERE ' . implode(' AND ', $billConditions),
            $billBindings
        ) ?? [];

        $salesFromTransactions = (float) ($transactionSummary['salesFromTransactions'] ?? 0);
        $purchasesFromTransactions = (float) ($transactionSummary['purchasesFromTransactions'] ?? 0);
        $otherExpenses = (float) ($transactionSummary['otherExpenses'] ?? 0);
        $completedOrderSales = (float) ($orderTotals['completed'] ?? 0);
        $billPurchases = (float) ($billSummary['totalPurchases'] ?? 0);

        $totalSales = $salesFromTransactions > 0 ? $salesFromTransactions : $completedOrderSales;
        $totalPurchases = $purchasesFromTransactions > 0 ? $purchasesFromTransactions : $billPurchases;
        $totalProfit = $totalSales - $totalPurchases - $otherExpenses;

        $expenseConditions = [
            't.deleted_at IS NULL',
            "t.type = 'Expense'",
            "COALESCE(t.category, '') <> 'expense_purchases'",
        ];
        $expenseBindings = [];
        $this->applyDashboardDateTimeBounds('t.created_at', $filters, $expenseConditions, $expenseBindings, 'dashboard_expense');

        $expenseRows = $this->database->fetchAll(
            'SELECT
                COALESCE(NULLIF(c.name, \'\'), NULLIF(t.category, \'\'), \'Uncategorized\') AS name,
                COALESCE(SUM(t.amount), 0) AS value
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category
             WHERE ' . implode(' AND ', $expenseConditions) . '
             GROUP BY name
             ORDER BY value DESC',
            $expenseBindings
        );

        $expenseByCategory = [];
        if ($totalPurchases > 0) {
            $expenseByCategory[] = [
                'name' => 'Purchases',
                'value' => $totalPurchases,
            ];
        }

        foreach ($expenseRows as $row) {
            $expenseByCategory[] = [
                'name' => (string) ($row['name'] ?? 'Uncategorized'),
                'value' => (float) ($row['value'] ?? 0),
            ];
        }

        if ($expenseByCategory === []) {
            $expenseByCategory[] = [
                'name' => 'No Data',
                'value' => 1,
            ];
        }

        $localTimezone = new \DateTimeZone($this->config->timezone());
        $monthlyData = [];
        $monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        foreach ($monthLabels as $label) {
            $monthlyData[$label] = [
                'name' => $label,
                'income' => 0,
                'expense' => 0,
                'profit' => 0,
            ];
        }

        $monthlyRows = $this->database->fetchAll(
            'SELECT date, type, amount
             FROM transactions
             WHERE deleted_at IS NULL
               AND date >= :year_start
               AND date < :next_year_start',
            [
                ':year_start' => $filters['currentYearStartUtc'],
                ':next_year_start' => $filters['nextYearStartUtc'],
            ]
        );

        foreach ($monthlyRows as $row) {
            $date = $this->parseDateTimeValue((string) ($row['date'] ?? ''), $this->utcTimezone());
            if (!$date instanceof \DateTimeImmutable) {
                continue;
            }

            $monthIndex = (int) $date->setTimezone($localTimezone)->format('n') - 1;
            if (!isset($monthLabels[$monthIndex])) {
                continue;
            }

            $label = $monthLabels[$monthIndex];
            $amount = (float) ($row['amount'] ?? 0);
            $type = (string) ($row['type'] ?? '');

            if ($type === 'Income') {
                $monthlyData[$label]['income'] += $amount;
                $monthlyData[$label]['profit'] += $amount;
            } elseif ($type === 'Expense') {
                $monthlyData[$label]['expense'] -= $amount;
                $monthlyData[$label]['profit'] -= $amount;
            }
        }

        $topCustomerConditions = ['o.deleted_at IS NULL', 'o.status = :dashboard_completed_status'];
        $topCustomerBindings = [':dashboard_completed_status' => 'Completed'];
        $this->applyDashboardDateBounds('o.order_date', $filters, $topCustomerConditions, $topCustomerBindings, 'dashboard_top_customer');

        $topCustomerRows = $this->database->fetchAll(
            'SELECT
                o.customer_id AS customerId,
                COALESCE(NULLIF(c.name, \'\'), \'Unknown Customer\') AS customerName,
                COUNT(*) AS orderCount,
                COALESCE(SUM(o.total), 0) AS totalAmount
             FROM orders o
             LEFT JOIN customers c ON c.id = o.customer_id
             WHERE ' . implode(' AND ', $topCustomerConditions) . '
             GROUP BY o.customer_id, c.name
             ORDER BY totalAmount DESC
             LIMIT 5',
            $topCustomerBindings
        );

        $topCustomers = array_map(
            static fn(array $row): array => [
                'name' => (string) ($row['customerName'] ?? 'Unknown Customer'),
                'orders' => (int) ($row['orderCount'] ?? 0),
                'amount' => (float) ($row['totalAmount'] ?? 0),
            ],
            $topCustomerRows
        );

        $topProductConditions = ['deleted_at IS NULL', 'status = :dashboard_top_product_status'];
        $topProductBindings = [':dashboard_top_product_status' => 'Completed'];
        $this->applyDashboardDateBounds('order_date', $filters, $topProductConditions, $topProductBindings, 'dashboard_top_product');

        $topProductRows = $this->database->fetchAll(
            'SELECT items
             FROM orders
             WHERE ' . implode(' AND ', $topProductConditions),
            $topProductBindings
        );

        $productMap = [];
        foreach ($topProductRows as $row) {
            foreach ($this->jsonDecodeList($row['items'] ?? null) as $item) {
                if (!is_array($item)) {
                    continue;
                }

                $key = trim((string) ($item['productId'] ?? $item['productName'] ?? ''));
                if ($key === '') {
                    continue;
                }

                $productName = trim((string) ($item['productName'] ?? '')) ?: 'Unnamed Product';
                $quantity = (int) ($item['quantity'] ?? 0);
                if ($quantity <= 0) {
                    continue;
                }

                if (!isset($productMap[$key])) {
                    $productMap[$key] = [
                        'name' => $productName,
                        'qty' => 0,
                    ];
                }

                $productMap[$key]['qty'] += $quantity;
            }
        }

        $topSoldProducts = array_values($productMap);
        usort($topSoldProducts, static function (array $left, array $right): int {
            if ((int) $right['qty'] !== (int) $left['qty']) {
                return (int) $right['qty'] <=> (int) $left['qty'];
            }

            return strcmp((string) $left['name'], (string) $right['name']);
        });
        $topSoldProducts = array_slice($topSoldProducts, 0, 5);

        return [
            'totalSales' => $totalSales,
            'totalPurchases' => $totalPurchases,
            'otherExpenses' => $otherExpenses,
            'totalProfit' => $totalProfit,
            'orderCounts' => $orderCounts,
            'orderTotals' => $orderTotals,
            'monthlyData' => array_values($monthlyData),
            'expenseByCategory' => $expenseByCategory,
            'topSoldProducts' => $topSoldProducts,
            'topCustomers' => $topCustomers,
        ];
    }

    /**
     * @param array<string, string|null> $filters
     * @return array<string, mixed>
     */
    private function buildDashboardEmployeeSnapshot(array $filters): array
    {
        $currentUser = $this->currentUser();
        $currentUserId = (string) ($currentUser['id'] ?? '');

        $summary = $this->database->fetchOne(
            'SELECT
                COUNT(*) AS totalCreated,
                COALESCE(SUM(CASE WHEN created_at >= :today_start AND created_at <= :today_end THEN 1 ELSE 0 END), 0) AS createdToday,
                COALESCE(SUM(CASE WHEN status = :on_hold THEN 1 ELSE 0 END), 0) AS pendingOrders
             FROM orders
             WHERE deleted_at IS NULL
               AND created_by = :created_by',
            [
                ':today_start' => $filters['todayStartUtc'],
                ':today_end' => $filters['todayEndUtc'],
                ':on_hold' => 'On Hold',
                ':created_by' => $currentUserId,
            ]
        ) ?? [];

        $statusConditions = ['deleted_at IS NULL', 'created_by = :employee_status_created_by'];
        $statusBindings = [':employee_status_created_by' => $currentUserId];
        $this->applyDashboardDateTimeBounds('created_at', $filters, $statusConditions, $statusBindings, 'employee_status');

        $statusRows = $this->database->fetchAll(
            'SELECT status, COUNT(*) AS count
             FROM orders
             WHERE ' . implode(' AND ', $statusConditions) . '
             GROUP BY status',
            $statusBindings
        );

        $statusCounts = [
            'On Hold' => 0,
            'Processing' => 0,
            'Picked' => 0,
            'Completed' => 0,
            'Returned' => 0,
            'Cancelled' => 0,
        ];

        foreach ($statusRows as $row) {
            $status = trim((string) ($row['status'] ?? ''));
            if (!array_key_exists($status, $statusCounts)) {
                continue;
            }

            $statusCounts[$status] = (int) ($row['count'] ?? 0);
        }

        $comparisonConditions = ['o.deleted_at IS NULL'];
        $comparisonBindings = [];
        $this->applyDashboardDateTimeBounds('o.created_at', $filters, $comparisonConditions, $comparisonBindings, 'employee_compare');

        $comparisonRows = $this->database->fetchAll(
            'SELECT
                u.id AS userId,
                u.name,
                u.role,
                COALESCE(COUNT(o.id), 0) AS orderCount
             FROM users u
             LEFT JOIN orders o
               ON o.created_by = u.id
              AND ' . implode(' AND ', $comparisonConditions) . '
             WHERE u.deleted_at IS NULL
               AND u.role IN (\'Employee\', \'Employee1\')
             GROUP BY u.id, u.name, u.role',
            $comparisonBindings
        );

        $employeeComparisonRows = array_map(
            static fn(array $row): array => [
                'userId' => (string) ($row['userId'] ?? ''),
                'name' => (string) ($row['name'] ?? 'Unknown Employee'),
                'role' => (string) ($row['role'] ?? 'Employee'),
                'orderCount' => (int) ($row['orderCount'] ?? 0),
                'isCurrentUser' => (string) ($row['userId'] ?? '') === $currentUserId,
            ],
            $comparisonRows
        );

        // Show all employees, not just those with orders in the period
        $employeeComparisonRows = array_values($employeeComparisonRows);

        usort($employeeComparisonRows, static function (array $left, array $right): int {
            if ((int) ($right['orderCount'] ?? 0) !== (int) ($left['orderCount'] ?? 0)) {
                return (int) ($right['orderCount'] ?? 0) <=> (int) ($left['orderCount'] ?? 0);
            }

            if (!empty($left['isCurrentUser']) && empty($right['isCurrentUser'])) {
                return -1;
            }

            if (empty($left['isCurrentUser']) && !empty($right['isCurrentUser'])) {
                return 1;
            }

            return strcmp((string) ($left['name'] ?? ''), (string) ($right['name'] ?? ''));
        });

        $wallet = $this->fetchMyWallet();

        return [
            'myTotalCreated' => (int) ($summary['totalCreated'] ?? 0),
            'myCreatedToday' => (int) ($summary['createdToday'] ?? 0),
            'myPendingOrders' => (int) ($summary['pendingOrders'] ?? 0),
            'walletBalance' => (float) ($wallet['currentBalance'] ?? 0),
            'employeeStatusSnapshot' => [
                ['status' => 'On Hold', 'label' => 'On Hold', 'value' => $statusCounts['On Hold']],
                ['status' => 'Processing', 'label' => 'Processing', 'value' => $statusCounts['Processing']],
                ['status' => 'Picked', 'label' => 'Picked', 'value' => $statusCounts['Picked']],
                ['status' => 'Completed', 'label' => 'Completed', 'value' => $statusCounts['Completed']],
                ['status' => 'Returned', 'label' => 'Returned', 'value' => $statusCounts['Returned']],
                ['status' => 'Cancelled', 'label' => 'Cancelled', 'value' => $statusCounts['Cancelled']],
            ],
            'employeeComparisonRows' => $employeeComparisonRows,
        ];
    }

    public function fetchDashboardSnapshot(array $params = []): array
    {
        $currentUser = $this->currentUser();
        $filters = $this->buildDashboardDateFilters($params);
        $role = (string) ($currentUser['role'] ?? '');
        $canViewAdminDashboard = $this->roleHasPermission($role, 'dashboard.viewAdmin');
        $canViewEmployeeDashboard = !$canViewAdminDashboard && $this->roleHasPermission($role, 'dashboard.viewEmployee');

        return [
            'role' => $canViewAdminDashboard ? 'admin' : 'employee',
            'admin' => $canViewAdminDashboard ? $this->buildDashboardAdminSnapshot($filters) : null,
            'employee' => $canViewEmployeeDashboard ? $this->buildDashboardEmployeeSnapshot($filters) : null,
            'refreshedAt' => gmdate('c'),
        ];
    }

    public function fetchIncomeSummaryReport(array $params = []): array
    {
        $this->ensureReportsViewPermission();

        $filters = $this->buildDashboardDateFilters($params);
        $conditions = [
            't.deleted_at IS NULL',
            "t.type = 'Income'",
        ];
        $bindings = [];
        $this->applyDashboardDateTimeBounds('t.date', $filters, $conditions, $bindings, 'income_summary');

        $summary = $this->database->fetchOne(
            'SELECT
                COALESCE(SUM(t.amount), 0) AS totalRevenue,
                COUNT(*) AS transactionCount
             FROM transactions t
             WHERE ' . implode(' AND ', $conditions),
            $bindings
        ) ?? [];

        $revenueMixRows = $this->database->fetchAll(
            'SELECT
                COALESCE(NULLIF(c.name, \'\'), NULLIF(t.category, \'\'), \'Uncategorized\') AS name,
                COALESCE(SUM(t.amount), 0) AS value
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category
             WHERE ' . implode(' AND ', $conditions) . '
             GROUP BY name
             ORDER BY value DESC',
            $bindings
        );

        $topCustomerConditions = [
            'o.deleted_at IS NULL',
            'o.status = :income_summary_completed_status',
        ];
        $topCustomerBindings = [':income_summary_completed_status' => 'Completed'];
        $this->applyDashboardDateBounds('o.order_date', $filters, $topCustomerConditions, $topCustomerBindings, 'income_summary_customer');

        $topCustomerRows = $this->database->fetchAll(
            'SELECT
                o.customer_id AS customerId,
                COALESCE(NULLIF(c.name, \'\'), \'Unknown Customer\') AS customerName,
                COALESCE(SUM(o.total), 0) AS revenue
             FROM orders o
             LEFT JOIN customers c ON c.id = o.customer_id
             WHERE ' . implode(' AND ', $topCustomerConditions) . '
             GROUP BY o.customer_id, c.name
             ORDER BY revenue DESC
             LIMIT 3',
            $topCustomerBindings
        );

        $totalRevenue = (float) ($summary['totalRevenue'] ?? 0);
        $transactionCount = (int) ($summary['transactionCount'] ?? 0);

        return [
            'totalRevenue' => $totalRevenue,
            'averageTransactionSize' => $transactionCount > 0 ? $totalRevenue / $transactionCount : 0,
            'revenueMix' => array_map(
                static fn(array $row): array => [
                    'name' => (string) ($row['name'] ?? 'Uncategorized'),
                    'value' => (float) ($row['value'] ?? 0),
                ],
                $revenueMixRows
            ),
            'topCustomers' => array_map(
                static fn(array $row): array => [
                    'id' => (string) ($row['customerId'] ?? ''),
                    'name' => (string) ($row['customerName'] ?? 'Unknown Customer'),
                    'revenue' => (float) ($row['revenue'] ?? 0),
                ],
                $topCustomerRows
            ),
        ];
    }

    public function fetchExpenseSummaryReport(array $params = []): array
    {
        $this->ensureReportsViewPermission();

        $filters = $this->buildDashboardDateFilters($params);
        $conditions = [
            't.deleted_at IS NULL',
            "t.type = 'Expense'",
        ];
        $bindings = [];
        $this->applyDashboardDateTimeBounds('t.date', $filters, $conditions, $bindings, 'expense_summary');

        $summary = $this->database->fetchOne(
            'SELECT COALESCE(SUM(t.amount), 0) AS totalOutflow
             FROM transactions t
             WHERE ' . implode(' AND ', $conditions),
            $bindings
        ) ?? [];

        $categoryRows = $this->database->fetchAll(
            'SELECT
                COALESCE(NULLIF(c.name, \'\'), NULLIF(t.category, \'\'), \'Uncategorized\') AS name,
                COALESCE(SUM(t.amount), 0) AS value
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category
             WHERE ' . implode(' AND ', $conditions) . '
             GROUP BY name
             ORDER BY value DESC',
            $bindings
        );

        $recentRows = $this->database->fetchAll(
            'SELECT
                t.id,
                t.date,
                COALESCE(NULLIF(c.name, \'\'), NULLIF(t.category, \'\'), \'Uncategorized\') AS categoryName,
                t.amount
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category
             WHERE ' . implode(' AND ', $conditions) . '
             ORDER BY t.date DESC, t.created_at DESC
             LIMIT 10',
            $bindings
        );

        return [
            'totalOutflow' => (float) ($summary['totalOutflow'] ?? 0),
            'byCategory' => array_map(
                static fn(array $row): array => [
                    'name' => (string) ($row['name'] ?? 'Uncategorized'),
                    'value' => (float) ($row['value'] ?? 0),
                ],
                $categoryRows
            ),
            'recentExpenses' => array_map(
                fn(array $row): array => [
                    'id' => (string) ($row['id'] ?? ''),
                    'date' => $this->toIso($row['date'] ?? null) ?? (string) ($row['date'] ?? ''),
                    'categoryName' => (string) ($row['categoryName'] ?? 'Uncategorized'),
                    'amount' => (float) ($row['amount'] ?? 0),
                ],
                $recentRows
            ),
        ];
    }

    public function fetchExpenseSummaryCsv(array $params = []): array
    {
        $this->ensureReportsViewPermission();

        $filters = $this->buildDashboardDateFilters($params);
        $conditions = [
            't.deleted_at IS NULL',
            "t.type = 'Expense'",
        ];
        $bindings = [];
        $this->applyDashboardDateTimeBounds('t.date', $filters, $conditions, $bindings, 'expense_summary_csv');

        $rows = $this->database->fetchAll(
            'SELECT
                t.date,
                COALESCE(NULLIF(cat.name, \'\'), NULLIF(t.category, \'\'), \'Uncategorized\') AS categoryName,
                COALESCE(NULLIF(v.name, \'\'), NULLIF(cu.name, \'\'), \'N/A\') AS contactName,
                COALESCE(NULLIF(a.name, \'\'), \'N/A\') AS accountName,
                t.amount,
                t.description
             FROM transactions t
             LEFT JOIN categories cat ON cat.id = t.category
             LEFT JOIN vendors v ON v.id = t.contact_id
             LEFT JOIN customers cu ON cu.id = t.contact_id
             LEFT JOIN accounts a ON a.id = t.account_id
             WHERE ' . implode(' AND ', $conditions) . '
             ORDER BY t.date DESC, t.created_at DESC',
            $bindings
        );

        return array_map(
            fn(array $row): array => [
                'date' => $this->toIso($row['date'] ?? null) ?? (string) ($row['date'] ?? ''),
                'categoryName' => (string) ($row['categoryName'] ?? 'Uncategorized'),
                'contactName' => (string) ($row['contactName'] ?? 'N/A'),
                'accountName' => (string) ($row['accountName'] ?? 'N/A'),
                'amount' => (float) ($row['amount'] ?? 0),
                'description' => (string) ($row['description'] ?? ''),
            ],
            $rows
        );
    }

    public function fetchIncomeVsExpenseReport(array $params = []): array
    {
        $this->ensureReportsViewPermission();

        $localTimezone = new \DateTimeZone($this->config->timezone());
        $utcTimezone = $this->utcTimezone();
        $nowLocal = new \DateTimeImmutable('now', $localTimezone);
        $startLocal = $nowLocal->modify('first day of this month')->setTime(0, 0, 0)->modify('-5 months');
        $endLocal = $nowLocal->modify('first day of next month')->setTime(0, 0, 0);

        $buckets = [];
        $bucketOrder = [];
        for ($offset = 0; $offset < 6; $offset += 1) {
            $month = $startLocal->modify('+' . $offset . ' months');
            $key = $month->format('Y-n');
            $buckets[$key] = [
                'name' => $month->format('M'),
                'label' => $month->format('M Y'),
                'income' => 0.0,
                'expense' => 0.0,
                'profit' => 0.0,
            ];
            $bucketOrder[] = $key;
        }

        $rows = $this->database->fetchAll(
            'SELECT date, type, amount
             FROM transactions
             WHERE deleted_at IS NULL
               AND date >= :income_vs_expense_from
               AND date < :income_vs_expense_to',
            [
                ':income_vs_expense_from' => $startLocal->setTimezone($utcTimezone)->format('Y-m-d H:i:s'),
                ':income_vs_expense_to' => $endLocal->setTimezone($utcTimezone)->format('Y-m-d H:i:s'),
            ]
        );

        foreach ($rows as $row) {
            $date = $this->parseDateTimeValue((string) ($row['date'] ?? ''), $utcTimezone);
            if (!$date instanceof \DateTimeImmutable) {
                continue;
            }

            $bucketKey = $date->setTimezone($localTimezone)->format('Y-n');
            if (!isset($buckets[$bucketKey])) {
                continue;
            }

            $amount = (float) ($row['amount'] ?? 0);
            $type = (string) ($row['type'] ?? '');
            if ($type === 'Income') {
                $buckets[$bucketKey]['income'] += $amount;
                $buckets[$bucketKey]['profit'] += $amount;
            } elseif ($type === 'Expense') {
                $buckets[$bucketKey]['expense'] += $amount;
                $buckets[$bucketKey]['profit'] -= $amount;
            }
        }

        $chartData = array_map(
            static fn(string $key): array => $buckets[$key],
            $bucketOrder
        );

        $totalIncome = 0.0;
        $totalExpense = 0.0;
        $highestRevenueMonth = null;
        $lowestExpenseMonth = null;

        foreach ($chartData as $entry) {
            $totalIncome += (float) ($entry['income'] ?? 0);
            $totalExpense += (float) ($entry['expense'] ?? 0);

            $hasActivity = (float) ($entry['income'] ?? 0) > 0 || (float) ($entry['expense'] ?? 0) > 0;
            if (!$hasActivity) {
                continue;
            }

            if ($highestRevenueMonth === null || (float) $entry['income'] > (float) $highestRevenueMonth['amount']) {
                $highestRevenueMonth = [
                    'label' => (string) ($entry['label'] ?? ''),
                    'amount' => (float) ($entry['income'] ?? 0),
                ];
            }

            if ($lowestExpenseMonth === null || (float) $entry['expense'] < (float) $lowestExpenseMonth['amount']) {
                $lowestExpenseMonth = [
                    'label' => (string) ($entry['label'] ?? ''),
                    'amount' => (float) ($entry['expense'] ?? 0),
                ];
            }
        }

        return [
            'chartData' => $chartData,
            'totalIncome' => $totalIncome,
            'totalExpense' => $totalExpense,
            'averageProfit' => count($chartData) > 0 ? ($totalIncome - $totalExpense) / count($chartData) : 0,
            'highestRevenueMonth' => $highestRevenueMonth,
            'lowestExpenseMonth' => $lowestExpenseMonth,
        ];
    }

    public function fetchProfitLossReport(array $params = []): array
    {
        $this->ensureReportsViewPermission();

        $filters = $this->buildDashboardDateFilters($this->normalizeProfitLossFilterParams($params));

        $transactionConditions = ['deleted_at IS NULL'];
        $transactionBindings = [];
        $this->applyDashboardDateTimeBounds('date', $filters, $transactionConditions, $transactionBindings, 'profit_loss_txn');

        $transactionSummary = $this->database->fetchOne(
            'SELECT
                COALESCE(SUM(CASE WHEN type = \'Income\' AND reference_id IS NOT NULL THEN amount ELSE 0 END), 0) AS salesFromTransactions,
                COALESCE(SUM(CASE WHEN type = \'Expense\' AND category = \'expense_purchases\' THEN amount ELSE 0 END), 0) AS purchasesFromTransactions,
                COALESCE(SUM(CASE WHEN type = \'Expense\' AND COALESCE(category, \'\') <> \'expense_purchases\' THEN amount ELSE 0 END), 0) AS otherExpenses
             FROM transactions
             WHERE ' . implode(' AND ', $transactionConditions),
            $transactionBindings
        ) ?? [];

        $orderConditions = [
            'deleted_at IS NULL',
            'status = :profit_loss_completed_status',
        ];
        $orderBindings = [':profit_loss_completed_status' => 'Completed'];
        $this->applyDashboardDateBounds('order_date', $filters, $orderConditions, $orderBindings, 'profit_loss_order');

        $orderSummary = $this->database->fetchOne(
            'SELECT COALESCE(SUM(total), 0) AS grossSales
             FROM orders
             WHERE ' . implode(' AND ', $orderConditions),
            $orderBindings
        ) ?? [];

        $billConditions = ['deleted_at IS NULL'];
        $billBindings = [];
        $this->applyDashboardDateBounds('bill_date', $filters, $billConditions, $billBindings, 'profit_loss_bill');

        $billSummary = $this->database->fetchOne(
            'SELECT COALESCE(SUM(total), 0) AS totalPurchases
             FROM bills
             WHERE ' . implode(' AND ', $billConditions),
            $billBindings
        ) ?? [];

        $expenseConditions = [
            't.deleted_at IS NULL',
            "t.type = 'Expense'",
            "COALESCE(t.category, '') <> 'expense_purchases'",
        ];
        $expenseBindings = [];
        $this->applyDashboardDateTimeBounds('t.date', $filters, $expenseConditions, $expenseBindings, 'profit_loss_expense');

        $expenseRows = $this->database->fetchAll(
            'SELECT
                COALESCE(NULLIF(c.name, \'\'), NULLIF(t.category, \'\'), \'Uncategorized\') AS categoryName,
                COALESCE(SUM(t.amount), 0) AS amount
             FROM transactions t
             LEFT JOIN categories c ON c.id = t.category
             WHERE ' . implode(' AND ', $expenseConditions) . '
             GROUP BY categoryName
             ORDER BY amount DESC',
            $expenseBindings
        );

        $salesFromTransactions = (float) ($transactionSummary['salesFromTransactions'] ?? 0);
        $purchasesFromTransactions = (float) ($transactionSummary['purchasesFromTransactions'] ?? 0);
        $grossSales = $salesFromTransactions > 0
            ? $salesFromTransactions
            : (float) ($orderSummary['grossSales'] ?? 0);
        $costOfPurchases = $purchasesFromTransactions > 0
            ? $purchasesFromTransactions
            : (float) ($billSummary['totalPurchases'] ?? 0);
        $grossProfit = $grossSales - $costOfPurchases;
        $expenses = array_map(
            static fn(array $row): array => [
                'categoryName' => (string) ($row['categoryName'] ?? 'Uncategorized'),
                'amount' => (float) ($row['amount'] ?? 0),
            ],
            $expenseRows
        );
        $totalOperatingExpenses = array_reduce(
            $expenses,
            static fn(float $carry, array $row): float => $carry + (float) ($row['amount'] ?? 0),
            0.0
        );

        return [
            'grossSales' => $grossSales,
            'costOfPurchases' => $costOfPurchases,
            'grossProfit' => $grossProfit,
            'expenses' => $expenses,
            'totalOperatingExpenses' => $totalOperatingExpenses,
            'netProfit' => $grossProfit - $totalOperatingExpenses,
        ];
    }

    public function fetchProductQuantitySoldReport(array $params = []): array
    {
        $this->ensureReportsViewPermission();

        $filters = $this->buildDashboardDateFilters($params);
        $search = $this->normalizeReportSearchTerm((string) ($params['search'] ?? ''));
        $conditions = [
            'deleted_at IS NULL',
            'status = :product_quantity_completed_status',
        ];
        $bindings = [':product_quantity_completed_status' => 'Completed'];
        $this->applyDashboardDateBounds('order_date', $filters, $conditions, $bindings, 'product_quantity');

        $rows = $this->database->fetchAll(
            'SELECT items
             FROM orders
             WHERE ' . implode(' AND ', $conditions),
            $bindings
        );

        $productMap = [];
        foreach ($rows as $row) {
            foreach ($this->jsonDecodeList($row['items'] ?? null) as $item) {
                if (!is_array($item)) {
                    continue;
                }

                $productName = trim((string) ($item['productName'] ?? '')) ?: 'Unnamed Product';
                $key = trim((string) ($item['productId'] ?? '')) ?: $productName;
                $quantity = (float) ($item['quantity'] ?? 0);
                $revenue = (float) ($item['amount'] ?? 0);

                if (!isset($productMap[$key])) {
                    $productMap[$key] = [
                        'productName' => $productName,
                        'quantity' => 0.0,
                        'revenue' => 0.0,
                    ];
                }

                $productMap[$key]['quantity'] += $quantity;
                $productMap[$key]['revenue'] += $revenue;
            }
        }

        $reportRows = array_values($productMap);
        usort($reportRows, static function (array $left, array $right): int {
            if ((float) $right['quantity'] !== (float) $left['quantity']) {
                return (float) $right['quantity'] <=> (float) $left['quantity'];
            }

            if ((float) $right['revenue'] !== (float) $left['revenue']) {
                return (float) $right['revenue'] <=> (float) $left['revenue'];
            }

            return strcmp((string) ($left['productName'] ?? ''), (string) ($right['productName'] ?? ''));
        });

        if ($search !== '') {
            $reportRows = array_values(array_filter(
                $reportRows,
                fn(array $row): bool => str_contains(
                    $this->normalizeReportSearchTerm((string) ($row['productName'] ?? '')),
                    $search
                )
            ));
        }

        $mappedRows = array_map(
            static fn(array $row): array => [
                'productName' => (string) ($row['productName'] ?? 'Unnamed Product'),
                'quantity' => (float) ($row['quantity'] ?? 0),
                'revenue' => (float) ($row['revenue'] ?? 0),
            ],
            $reportRows
        );

        return [
            'rows' => $mappedRows,
            'totalQty' => array_reduce(
                $mappedRows,
                static fn(float $carry, array $row): float => $carry + (float) ($row['quantity'] ?? 0),
                0.0
            ),
        ];
    }

    public function fetchCustomerSalesReport(array $params = []): array
    {
        $this->ensureReportsViewPermission();

        $filters = $this->buildDashboardDateFilters($params);
        $search = $this->normalizeReportSearchTerm((string) ($params['search'] ?? ''));
        $conditions = [
            'o.deleted_at IS NULL',
            'o.status = :customer_sales_completed_status',
        ];
        $bindings = [':customer_sales_completed_status' => 'Completed'];
        $this->applyDashboardDateBounds('o.order_date', $filters, $conditions, $bindings, 'customer_sales');

        $rows = $this->database->fetchAll(
            'SELECT
                o.customer_id AS customerId,
                COALESCE(NULLIF(c.name, \'\'), \'Unknown Customer\') AS customerName,
                o.total,
                o.items
             FROM orders o
             LEFT JOIN customers c ON c.id = o.customer_id
             WHERE ' . implode(' AND ', $conditions),
            $bindings
        );

        $customerMap = [];
        foreach ($rows as $row) {
            $customerId = trim((string) ($row['customerId'] ?? ''));
            $customerName = trim((string) ($row['customerName'] ?? '')) ?: 'Unknown Customer';
            $key = $customerId !== '' ? $customerId : $customerName;

            if (!isset($customerMap[$key])) {
                $customerMap[$key] = [
                    'name' => $customerName,
                    'orders' => 0,
                    'quantity' => 0.0,
                    'amount' => 0.0,
                ];
            }

            $customerMap[$key]['orders'] += 1;
            $customerMap[$key]['amount'] += (float) ($row['total'] ?? 0);

            foreach ($this->jsonDecodeList($row['items'] ?? null) as $item) {
                if (!is_array($item)) {
                    continue;
                }

                $customerMap[$key]['quantity'] += (float) ($item['quantity'] ?? 0);
            }
        }

        $reportRows = array_values($customerMap);
        usort($reportRows, static function (array $left, array $right): int {
            if ((float) $right['amount'] !== (float) $left['amount']) {
                return (float) $right['amount'] <=> (float) $left['amount'];
            }

            if ((int) $right['orders'] !== (int) $left['orders']) {
                return (int) $right['orders'] <=> (int) $left['orders'];
            }

            return strcmp((string) ($left['name'] ?? ''), (string) ($right['name'] ?? ''));
        });

        if ($search !== '') {
            $reportRows = array_values(array_filter(
                $reportRows,
                fn(array $row): bool => str_contains(
                    $this->normalizeReportSearchTerm((string) ($row['name'] ?? '')),
                    $search
                )
            ));
        }

        $mappedRows = array_map(
            static fn(array $row): array => [
                'name' => (string) ($row['name'] ?? 'Unknown Customer'),
                'orders' => (int) ($row['orders'] ?? 0),
                'quantity' => (float) ($row['quantity'] ?? 0),
                'amount' => (float) ($row['amount'] ?? 0),
            ],
            $reportRows
        );

        return [
            'rows' => $mappedRows,
            'totalAmount' => array_reduce(
                $mappedRows,
                static fn(float $carry, array $row): float => $carry + (float) ($row['amount'] ?? 0),
                0.0
            ),
            'totalOrders' => array_reduce(
                $mappedRows,
                static fn(int $carry, array $row): int => $carry + (int) ($row['orders'] ?? 0),
                0
            ),
            'totalQuantity' => array_reduce(
                $mappedRows,
                static fn(float $carry, array $row): float => $carry + (float) ($row['quantity'] ?? 0),
                0.0
            ),
        ];
    }

    public function getNextOrderNumber(array $params = []): string
    {
        return $this->nextOrderNumberPreview();
    }

    public function getNextBillNumber(array $params = []): string
    {
        return $this->nextBillNumberPreview();
    }

    public function createOrder(array $params): array
    {
        $actor = $this->currentUser();
        if (!$this->currentUserHasPermission('orders.create')) {
            throw new RuntimeException('You do not have permission to create orders.');
        }
        $id = $this->stringId($params['id'] ?? null);

        return $this->database->transaction(function () use ($actor, $id, $params): array {
            $allocation = $this->allocateOrderNumber();
            $orderDate = $this->normalizeDateOnly((string) ($params['orderDate'] ?? '')) ?: gmdate('Y-m-d');
            $status = trim((string) ($params['status'] ?? 'On Hold'));
            $items = is_array($params['items'] ?? null) ? $params['items'] : [];
            $pageSelection = $this->resolveOrderPageSelection($params);
            $stockUpdates = $this->applyOrderStockTransition('', $status, [], $items);
            $now = $this->database->nowUtc();

            $this->database->execute(
                'INSERT INTO orders (
                    id, order_number, order_seq, order_date, customer_id, page_id, created_by, status, items,
                    subtotal, discount, shipping, total, paid_amount, notes, history, page_snapshot,
                    carrybee_consignment_id, steadfast_consignment_id, paperfly_tracking_number,
                    created_at, updated_at
                ) VALUES (
                    :id, :order_number, :order_seq, :order_date, :customer_id, :page_id, :created_by, :status, :items,
                    :subtotal, :discount, :shipping, :total, :paid_amount, :notes, :history, :page_snapshot,
                    :carrybee_consignment_id, :steadfast_consignment_id, :paperfly_tracking_number,
                    :created_at, :updated_at
                )',
                [
                    ':id' => $id,
                    ':order_number' => $allocation['orderNumber'],
                    ':order_seq' => $allocation['next'],
                    ':order_date' => $orderDate,
                    ':customer_id' => trim((string) ($params['customerId'] ?? '')),
                    ':page_id' => $pageSelection['pageId'],
                    ':created_by' => (string) $actor['id'],
                    ':status' => $status,
                    ':items' => $this->jsonEncode($items),
                    ':subtotal' => $this->formatMoney($params['subtotal'] ?? 0),
                    ':discount' => $this->formatMoney($params['discount'] ?? 0),
                    ':shipping' => $this->formatMoney($params['shipping'] ?? 0),
                    ':total' => $this->formatMoney($params['total'] ?? 0),
                    ':paid_amount' => $this->formatMoney($params['paidAmount'] ?? 0),
                    ':notes' => $this->nullableString($params['notes'] ?? null),
                    ':history' => $this->jsonEncode($params['history'] ?? []),
                    ':page_snapshot' => $this->jsonEncode($pageSelection['pageSnapshot']),
                    ':carrybee_consignment_id' => $this->nullableString($params['carrybeeConsignmentId'] ?? $params['carrybee_consignment_id'] ?? null),
                    ':steadfast_consignment_id' => $this->nullableString($params['steadfastConsignmentId'] ?? $params['steadfast_consignment_id'] ?? null),
                    ':paperfly_tracking_number' => $this->nullableString($params['paperflyTrackingNumber'] ?? $params['paperfly_tracking_number'] ?? null),
                    ':created_at' => $now,
                    ':updated_at' => $now,
                ]
            );

            $this->applyResolvedProductStockUpdates($stockUpdates);
            $this->syncCustomerOrderSummaries([trim((string) ($params['customerId'] ?? ''))]);
            $this->syncWalletCreditForOrder([
                'id' => $id,
                'createdBy' => (string) $actor['id'],
                'status' => $status,
                'orderNumber' => $allocation['orderNumber'],
                'orderDate' => $orderDate,
                'createdAt' => $this->toIso($now),
            ]);

            $row = $this->fetchOrderRowById($id);
            if ($row === null) {
                throw new RuntimeException('Created order could not be loaded.');
            }

            return $this->mapOrder($row);
        });
    }

    public function updateOrder(array $params): ?array
    {
        $actor = $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));
        $updates = is_array($params['updates'] ?? null) ? $params['updates'] : [];

        return $this->database->transaction(function () use ($actor, $id, $updates): ?array {
            $existingRow = $this->database->fetchOne(
                'SELECT * FROM orders WHERE id = :id AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
                [':id' => $id]
            );

            if ($existingRow === null) {
                throw new RuntimeException('Order not found.');
            }

            $this->assertUserCanUpdateOrder($actor, $existingRow, $updates);

            $previousStatus = (string) ($existingRow['status'] ?? '');
            $previousItems = $this->jsonDecodeList($existingRow['items'] ?? []);
            $previousCustomerId = (string) ($existingRow['customer_id'] ?? '');
            $nextStatus = array_key_exists('status', $updates) ? trim((string) $updates['status']) : $previousStatus;
            $nextItems = array_key_exists('items', $updates) && is_array($updates['items']) ? $updates['items'] : $previousItems;
            $stockUpdates = [];

            if (array_key_exists('status', $updates) || array_key_exists('items', $updates)) {
                $stockUpdates = $this->applyOrderStockTransition($previousStatus, $nextStatus, $previousItems, $nextItems);
            }

            $payload = [];
            if (array_key_exists('customerId', $updates)) {
                $payload['customer_id'] = trim((string) $updates['customerId']);
            }
            if (
                array_key_exists('pageId', $updates) ||
                array_key_exists('page_id', $updates) ||
                array_key_exists('pageSnapshot', $updates) ||
                array_key_exists('page_snapshot', $updates)
            ) {
                $pageSelection = $this->resolveOrderPageSelection($updates);
                $payload['page_id'] = $pageSelection['pageId'];
                $payload['page_snapshot'] = $this->jsonEncode($pageSelection['pageSnapshot']);
            }
            if (array_key_exists('orderDate', $updates)) {
                $payload['order_date'] = $this->normalizeDateOnly((string) $updates['orderDate']) ?: (string) $existingRow['order_date'];
            }
            if (array_key_exists('orderNumber', $updates)) {
                $payload['order_number'] = trim((string) $updates['orderNumber']);
            }
            if (array_key_exists('notes', $updates)) {
                $payload['notes'] = $this->nullableString($updates['notes']);
            }
            if (array_key_exists('status', $updates)) {
                $payload['status'] = $nextStatus;
            }
            if (array_key_exists('items', $updates)) {
                $payload['items'] = $this->jsonEncode($nextItems);
            }
            if (array_key_exists('subtotal', $updates)) {
                $payload['subtotal'] = $this->formatMoney($updates['subtotal']);
            }
            if (array_key_exists('discount', $updates)) {
                $payload['discount'] = $this->formatMoney($updates['discount']);
            }
            if (array_key_exists('shipping', $updates)) {
                $payload['shipping'] = $this->formatMoney($updates['shipping']);
            }
            if (array_key_exists('total', $updates)) {
                $payload['total'] = $this->formatMoney($updates['total']);
            }
            if (array_key_exists('paidAmount', $updates)) {
                $payload['paid_amount'] = $this->formatMoney($updates['paidAmount']);
            }
            if (array_key_exists('history', $updates)) {
                $payload['history'] = $this->jsonEncode($updates['history']);
            }
            if (array_key_exists('carrybeeConsignmentId', $updates) || array_key_exists('carrybee_consignment_id', $updates)) {
                $payload['carrybee_consignment_id'] = $this->nullableString($updates['carrybeeConsignmentId'] ?? $updates['carrybee_consignment_id'] ?? null);
            }
            if (array_key_exists('steadfastConsignmentId', $updates) || array_key_exists('steadfast_consignment_id', $updates)) {
                $payload['steadfast_consignment_id'] = $this->nullableString($updates['steadfastConsignmentId'] ?? $updates['steadfast_consignment_id'] ?? null);
            }
            if (array_key_exists('paperflyTrackingNumber', $updates) || array_key_exists('paperfly_tracking_number', $updates)) {
                $payload['paperfly_tracking_number'] = $this->nullableString($updates['paperflyTrackingNumber'] ?? $updates['paperfly_tracking_number'] ?? null);
            }

            $affectsCustomerSummary =
                array_key_exists('customerId', $updates) ||
                array_key_exists('status', $updates) ||
                array_key_exists('total', $updates) ||
                array_key_exists('paidAmount', $updates);

            $this->touchUpdate('orders', $id, $payload);
            $this->applyResolvedProductStockUpdates($stockUpdates);
            if ($affectsCustomerSummary) {
                $this->syncCustomerOrderSummaries([
                    $previousCustomerId,
                    (string) ($payload['customer_id'] ?? $previousCustomerId),
                ]);
            }

            $row = $this->fetchOrderRowById($id);
            if ($row === null) {
                return null;
            }

            if (array_key_exists('status', $updates)) {
                $this->syncWalletCreditForOrder([
                    'id' => $id,
                    'createdBy' => (string) ($row['created_by'] ?? $existingRow['created_by'] ?? ''),
                    'status' => (string) ($row['status'] ?? $nextStatus),
                    'orderNumber' => (string) ($row['order_number'] ?? $existingRow['order_number'] ?? ''),
                    'orderDate' => (string) ($row['order_date'] ?? $existingRow['order_date'] ?? ''),
                    'createdAt' => $this->toIso($row['created_at'] ?? $existingRow['created_at'] ?? null),
                ]);
            }

            return $this->mapOrder($row);
        });
    }

    public function completePickedOrder(array $params): array
    {
        $actor = $this->currentUser();
        $orderId = trim((string) ($params['orderId'] ?? ''));
        $outcome = trim((string) ($params['outcome'] ?? 'Delivered'));
        if ($orderId === '') {
            throw new RuntimeException('Order id is required.');
        }
        if (!in_array($outcome, ['Delivered', 'Returned'], true)) {
            throw new RuntimeException('Unsupported completion outcome.');
        }

        $recordedAt = $this->normalizeDateTimeInput((string) ($params['date'] ?? $this->database->nowUtc()));
        $accountId = trim((string) ($params['accountId'] ?? ''));
        if ($accountId === '') {
            throw new RuntimeException('Account is required.');
        }

        $amount = (float) ($params['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException($outcome === 'Returned'
                ? 'Return expense amount must be greater than zero.'
                : 'Received amount must be greater than zero.');
        }

        $paymentMethod = trim((string) ($params['paymentMethod'] ?? ''));
        $categoryId = trim((string) ($params['categoryId'] ?? ''));
        if ($outcome === 'Returned' && $paymentMethod === '') {
            throw new RuntimeException('Payment method is required for returned orders.');
        }
        if ($outcome === 'Returned' && $categoryId === '') {
            throw new RuntimeException('Expense category is required for returned orders.');
        }

        return $this->database->transaction(function () use ($actor, $orderId, $outcome, $recordedAt, $accountId, $amount, $paymentMethod, $categoryId, $params): array {
            $orderRow = $this->database->fetchOne(
                'SELECT * FROM orders WHERE id = :id AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
                [':id' => $orderId]
            );

            if ($orderRow === null) {
                throw new RuntimeException('Order not found.');
            }

            if ($outcome === 'Returned') {
                $this->assertUserCanManageOrderRecord(
                    $actor,
                    $orderRow,
                    'orders.markReturnedOwn',
                    'orders.markReturnedAny',
                    'You do not have permission to mark this order as returned.'
                );
            } else {
                $this->assertUserCanManageOrderRecord(
                    $actor,
                    $orderRow,
                    'orders.markCompletedOwn',
                    'orders.markCompletedAny',
                    'You do not have permission to mark this order as completed.'
                );
            }

            $previousStatus = trim((string) ($orderRow['status'] ?? ''));
            if ($previousStatus !== 'Picked') {
                throw new RuntimeException('Only picked orders can be finalized from this modal.');
            }

            $orderNumber = trim((string) ($orderRow['order_number'] ?? ''));
            $customerId = trim((string) ($orderRow['customer_id'] ?? ''));
            $orderTotal = (float) ($orderRow['total'] ?? 0);
            $paidAmount = (float) ($orderRow['paid_amount'] ?? 0);
            $previousItems = $this->jsonDecodeList($orderRow['items'] ?? []);
            $nextStatus = $outcome === 'Returned' ? 'Returned' : 'Completed';
            $stockUpdates = $this->applyOrderStockTransition($previousStatus, $nextStatus, $previousItems, $previousItems);
            $linkedTransactions = $this->fetchOrderLinkedTransactionRows($orderId, $orderNumber, 'active');
            $systemDefaults = $this->database->fetchOne(
                'SELECT default_payment_method, income_category_id, expense_category_id FROM system_defaults LIMIT 1'
            ) ?? [];
            $defaultPaymentMethod = trim((string) ($systemDefaults['default_payment_method'] ?? 'Cash')) ?: 'Cash';
            $incomeCategoryId = trim((string) ($systemDefaults['income_category_id'] ?? 'income_sales')) ?: 'income_sales';
            $existingIncome = 0.0;
            $existingExpense = 0.0;
            foreach ($linkedTransactions as $transactionRow) {
                if (($transactionRow['type'] ?? '') === 'Income') {
                    $existingIncome += (float) ($transactionRow['amount'] ?? 0);
                    continue;
                }
                if (($transactionRow['type'] ?? '') === 'Expense') {
                    $existingExpense += (float) ($transactionRow['amount'] ?? 0);
                }
            }

            $localRecordedAt = (new \DateTimeImmutable($recordedAt, new \DateTimeZone('UTC')))
                ->setTimezone(new \DateTimeZone($this->config->timezone()));
            $dateLabel = $localRecordedAt->format('j M Y');
            $timeLabel = $localRecordedAt->format('H:i');

            $history = $this->jsonDecodeAssoc($orderRow['history'] ?? []);
            $payload = [
                'status' => $nextStatus,
            ];
            $createdTransactions = [];

            if ($outcome === 'Delivered') {
                $remainingCollectible = max($orderTotal - $paidAmount, 0);
                if ($remainingCollectible <= 0) {
                    throw new RuntimeException('This order is already fully paid.');
                }
                if ($amount > $remainingCollectible) {
                    throw new RuntimeException('Received amount cannot exceed the remaining due amount.');
                }

                $incomeToCreate = max($orderTotal - $existingIncome, 0);
                $updatedPaidAmount = $paidAmount + $amount;
                $deliveryExpenseTarget = max($orderTotal - $updatedPaidAmount, 0);
                $expenseToCreate = max($deliveryExpenseTarget - $existingExpense, 0);

                if ($incomeToCreate > 0) {
                    $createdTransactions[] = $this->createTransactionRecord([
                        'date' => $recordedAt,
                        'type' => 'Income',
                        'category' => $incomeCategoryId,
                        'accountId' => $accountId,
                        'amount' => $incomeToCreate,
                        'description' => "Payment for Order #{$orderNumber}",
                        'referenceId' => $orderId,
                        'contactId' => $customerId,
                        'paymentMethod' => $paymentMethod !== '' ? $paymentMethod : $defaultPaymentMethod,
                    ], (string) $actor['id'], $actor);
                }

                if ($expenseToCreate > 0) {
                    $createdTransactions[] = $this->createTransactionRecord([
                        'date' => $recordedAt,
                        'type' => 'Expense',
                        'category' => 'expense_shipping',
                        'accountId' => $accountId,
                        'amount' => $expenseToCreate,
                        'description' => "Shipping costs for Order #{$orderNumber}",
                        'referenceId' => $orderId,
                        'contactId' => $customerId,
                        'paymentMethod' => $paymentMethod !== '' ? $paymentMethod : $defaultPaymentMethod,
                    ], (string) $actor['id'], $actor);
                }

                $history['completed'] = sprintf(
                    'Marked as delivered by %s on %s at %s.',
                    trim((string) ($actor['name'] ?? 'System')),
                    $dateLabel,
                    $timeLabel
                );
                $history['payment'] = sprintf(
                    'Payment of %s received on %s at %s.%s',
                    $this->formatMoney($amount),
                    $dateLabel,
                    $timeLabel,
                    $expenseToCreate > 0 ? ' Remaining amount recorded as expense.' : ''
                );
                $payload['paid_amount'] = $this->formatMoney($updatedPaidAmount);
                $payload['history'] = $this->jsonEncode($history);
            } else {
                $createdTransactions[] = $this->createTransactionRecord([
                    'date' => $recordedAt,
                    'type' => 'Expense',
                    'category' => $categoryId,
                    'accountId' => $accountId,
                    'amount' => $amount,
                    'description' => "Return expense for Order #{$orderNumber}",
                    'referenceId' => $orderId,
                    'contactId' => $customerId,
                    'paymentMethod' => $paymentMethod,
                    'history' => [],
                ], (string) $actor['id'], $actor);

                $history['returned'] = sprintf(
                    'Marked as returned by %s on %s at %s. Expense recorded: %s.%s',
                    trim((string) ($actor['name'] ?? 'System')),
                    $dateLabel,
                    $timeLabel,
                    $this->formatMoney($amount),
                    trim((string) ($params['note'] ?? '')) !== '' ? ' Note: ' . trim((string) $params['note']) : ''
                );
                $payload['history'] = $this->jsonEncode($history);
            }

            $this->touchUpdate('orders', $orderId, $payload);
            $this->applyResolvedProductStockUpdates($stockUpdates);

            $row = $this->fetchOrderRowById($orderId);
            if ($row === null) {
                throw new RuntimeException('Updated order could not be loaded.');
            }

            $this->syncCustomerOrderSummaries([$customerId]);
            $this->syncWalletCreditForOrder([
                'id' => $orderId,
                'createdBy' => (string) ($row['created_by'] ?? $orderRow['created_by'] ?? ''),
                'status' => (string) ($row['status'] ?? $nextStatus),
                'orderNumber' => $orderNumber,
                'orderDate' => (string) ($orderRow['order_date'] ?? ''),
                'createdAt' => $this->toIso($orderRow['created_at'] ?? null),
            ]);

            $order = $this->mapOrder($row);
            $pendingTransactionIds = array_values(array_map(
                static fn(array $transaction): string => (string) ($transaction['id'] ?? ''),
                array_filter(
                    $createdTransactions,
                    static fn(array $transaction): bool => (string) ($transaction['approvalStatus'] ?? 'approved') === 'pending'
                )
            ));
            $order['pendingTransactionCount'] = count($pendingTransactionIds);
            $order['pendingTransactionIds'] = $pendingTransactionIds;

            return $order;
        });
    }

    public function deleteOrder(array $params): array
    {
        $actor = $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));

        return $this->database->transaction(function () use ($actor, $id): array {
            $existingRow = $this->database->fetchOne(
                'SELECT * FROM orders WHERE id = :id AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
                [':id' => $id]
            );

            if ($existingRow === null) {
                throw new RuntimeException('Order was not found or is already deleted.');
            }

            $this->assertUserCanManageOrderRecord(
                $actor,
                $existingRow,
                'orders.deleteOwn',
                'orders.deleteAny',
                'You do not have permission to delete this order.'
            );
            $deletedAt = $this->database->nowUtc();
            $relatedTransactions = $this->fetchOrderLinkedTransactionRows(
                $id,
                (string) ($existingRow['order_number'] ?? ''),
                'active'
            );

            $this->applyTransactionAccountEffect($relatedTransactions, 'revert');
            $this->softDeleteTransactionRowsByIds(
                array_map(static fn(array $row): string => (string) $row['id'], $relatedTransactions),
                $deletedAt,
                (string) $actor['id']
            );

            $this->ensureDeletedOrderWalletReversal([
                'id' => $id,
                'createdBy' => (string) ($existingRow['created_by'] ?? ''),
                'orderNumber' => (string) ($existingRow['order_number'] ?? ''),
                'orderDate' => (string) ($existingRow['order_date'] ?? ''),
                'createdAt' => $this->toIso($existingRow['created_at'] ?? null),
                'deletedBy' => (string) $actor['id'],
            ]);

            $this->database->execute(
                'UPDATE orders
                 SET deleted_at = :deleted_at, deleted_by = :deleted_by, updated_at = :updated_at
                 WHERE id = :id AND deleted_at IS NULL',
                [
                    ':deleted_at' => $deletedAt,
                    ':deleted_by' => (string) $actor['id'],
                    ':updated_at' => $deletedAt,
                    ':id' => $id,
                ]
            );
            $this->syncCustomerOrderSummaries([(string) ($existingRow['customer_id'] ?? '')]);

            return ['success' => true];
        });
    }

    public function fetchBillsPage(array $params): array
    {
        $pageSize = $this->pageSize($params);
        $offset = $this->pageOffset($params);
        $filters = is_array($params['filters'] ?? null) ? $params['filters'] : $params;
        $where = 'WHERE 1=1';
        $bindings = [];

        $status = trim((string) ($filters['status'] ?? ''));
        if ($status !== '' && $status !== 'All') {
            $where .= ' AND status = :status';
            $bindings[':status'] = $status;
        }
        if (!empty($filters['from'])) {
            $where .= ' AND createdAt >= :from';
            $bindings[':from'] = $this->normalizeDateTimeInput((string) $filters['from']);
        }
        if (!empty($filters['to'])) {
            $where .= ' AND createdAt <= :to';
            $bindings[':to'] = $this->normalizeDateTimeInput((string) $filters['to']);
        }

        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $where .= ' AND (billNumber LIKE :search_number OR vendorName LIKE :search_name OR vendorPhone LIKE :search_phone)';
            $bindings[':search_number'] = '%' . $search . '%';
            $bindings[':search_name'] = '%' . $search . '%';
            $bindings[':search_phone'] = '%' . $search . '%';
        }

        $createdByIds = is_array($filters['createdByIds'] ?? null) ? $filters['createdByIds'] : [];
        $createdByIds = array_values(array_filter(array_map('strval', $createdByIds), static fn(string $id): bool => trim($id) !== ''));
        if ($createdByIds !== []) {
            [$placeholders, $inBindings] = $this->inClause($createdByIds, 'created_by');
            $where .= ' AND createdBy IN (' . implode(', ', $placeholders) . ')';
            $bindings += $inBindings;
        }

        $countRow = $this->database->fetchOne("SELECT COUNT(*) AS count FROM bills_with_vendor_creator {$where}", $bindings);
        $rows = $this->database->fetchAll(
            "SELECT
                id,
                billNumber,
                billDate,
                vendorId,
                vendorName,
                vendorPhone,
                vendorAddress,
                createdBy,
                creatorName,
                status,
                total,
                history,
                paidAmount,
                createdAt,
                deletedAt,
                deletedBy
             FROM bills_with_vendor_creator
             {$where}
             ORDER BY createdAt DESC
             LIMIT {$pageSize} OFFSET {$offset}",
            $bindings
        );

        return [
            'data' => array_map(fn(array $row): array => $this->mapBill($row), $rows),
            'count' => (int) ($countRow['count'] ?? 0),
        ];
    }

    public function fetchBills(array $params = []): array
    {
        $rows = $this->database->fetchAll('SELECT * FROM bills_with_vendor_creator ORDER BY createdAt DESC');
        return array_map(fn(array $row): array => $this->mapBill($row), $rows);
    }

    public function fetchBillsByVendorId(array $params): array
    {
        $vendorId = trim((string) ($params['vendorId'] ?? ''));
        if ($vendorId === '') {
            return [];
        }

        $rows = $this->database->fetchAll(
            'SELECT * FROM bills_with_vendor_creator WHERE vendorId = :vendor_id ORDER BY createdAt DESC',
            [':vendor_id' => $vendorId]
        );

        return array_map(fn(array $row): array => $this->mapBill($row), $rows);
    }

    public function fetchBillById(array $params): ?array
    {
        $row = $this->fetchBillRowById(trim((string) ($params['id'] ?? '')));
        return $row ? $this->mapBill($row) : null;
    }

    public function createBill(array $params): array
    {
        $actor = $this->currentUser();
        if (!$this->currentUserHasPermission('bills.create')) {
            throw new RuntimeException('You do not have permission to create bills.');
        }
        $id = $this->stringId($params['id'] ?? null);

        return $this->database->transaction(function () use ($actor, $id, $params): array {
            $allocation = $this->allocateBillNumber();
            $billDate = $this->normalizeDateOnly((string) ($params['billDate'] ?? '')) ?: gmdate('Y-m-d');
            $status = trim((string) ($params['status'] ?? 'On Hold'));
            $items = is_array($params['items'] ?? null) ? $params['items'] : [];
            $stockUpdates = $this->applyBillStockTransition('', $status, [], $items);
            $now = $this->database->nowUtc();

            $this->database->execute(
                'INSERT INTO bills (
                    id, bill_number, bill_seq, bill_date, vendor_id, created_by, status, items,
                    subtotal, discount, shipping, total, paid_amount, notes, history, created_at, updated_at
                ) VALUES (
                    :id, :bill_number, :bill_seq, :bill_date, :vendor_id, :created_by, :status, :items,
                    :subtotal, :discount, :shipping, :total, :paid_amount, :notes, :history, :created_at, :updated_at
                )',
                [
                    ':id' => $id,
                    ':bill_number' => $allocation['billNumber'],
                    ':bill_seq' => $allocation['next'],
                    ':bill_date' => $billDate,
                    ':vendor_id' => trim((string) ($params['vendorId'] ?? '')),
                    ':created_by' => (string) $actor['id'],
                    ':status' => $status,
                    ':items' => $this->jsonEncode($items),
                    ':subtotal' => $this->formatMoney($params['subtotal'] ?? 0),
                    ':discount' => $this->formatMoney($params['discount'] ?? 0),
                    ':shipping' => $this->formatMoney($params['shipping'] ?? 0),
                    ':total' => $this->formatMoney($params['total'] ?? 0),
                    ':paid_amount' => $this->formatMoney($params['paidAmount'] ?? 0),
                    ':notes' => $this->nullableString($params['notes'] ?? null),
                    ':history' => $this->jsonEncode($params['history'] ?? []),
                    ':created_at' => $now,
                    ':updated_at' => $now,
                ]
            );

            $this->applyResolvedProductStockUpdates($stockUpdates);
            $this->syncVendorPurchaseSummaries([trim((string) ($params['vendorId'] ?? ''))]);
            $row = $this->fetchBillRowById($id);
            if ($row === null) {
                throw new RuntimeException('Created bill could not be loaded.');
            }

            return $this->mapBill($row);
        });
    }

    public function updateBill(array $params): array
    {
        $actor = $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));
        $updates = is_array($params['updates'] ?? null) ? $params['updates'] : [];

        return $this->database->transaction(function () use ($actor, $id, $updates): array {
            $existingRow = $this->database->fetchOne(
                'SELECT * FROM bills WHERE id = :id AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
                [':id' => $id]
            );

            if ($existingRow === null) {
                throw new RuntimeException('Bill not found.');
            }

            $this->assertUserCanUpdateBill($actor, $existingRow, $updates);

            $previousStatus = (string) ($existingRow['status'] ?? '');
            $previousItems = $this->jsonDecodeList($existingRow['items'] ?? []);
            $previousVendorId = (string) ($existingRow['vendor_id'] ?? '');
            $nextStatus = array_key_exists('status', $updates) ? trim((string) $updates['status']) : $previousStatus;
            $nextItems = array_key_exists('items', $updates) && is_array($updates['items']) ? $updates['items'] : $previousItems;
            $stockUpdates = [];

            if (array_key_exists('status', $updates) || array_key_exists('items', $updates)) {
                $stockUpdates = $this->applyBillStockTransition($previousStatus, $nextStatus, $previousItems, $nextItems);
            }

            $payload = [];
            if (array_key_exists('vendorId', $updates)) {
                $payload['vendor_id'] = trim((string) $updates['vendorId']);
            }
            if (array_key_exists('billDate', $updates)) {
                $payload['bill_date'] = $this->normalizeDateOnly((string) $updates['billDate']) ?: (string) $existingRow['bill_date'];
            }
            if (array_key_exists('billNumber', $updates)) {
                $payload['bill_number'] = trim((string) $updates['billNumber']);
            }
            if (array_key_exists('notes', $updates)) {
                $payload['notes'] = $this->nullableString($updates['notes']);
            }
            if (array_key_exists('status', $updates)) {
                $payload['status'] = $nextStatus;
            }
            if (array_key_exists('items', $updates)) {
                $payload['items'] = $this->jsonEncode($nextItems);
            }
            if (array_key_exists('subtotal', $updates)) {
                $payload['subtotal'] = $this->formatMoney($updates['subtotal']);
            }
            if (array_key_exists('discount', $updates)) {
                $payload['discount'] = $this->formatMoney($updates['discount']);
            }
            if (array_key_exists('shipping', $updates)) {
                $payload['shipping'] = $this->formatMoney($updates['shipping']);
            }
            if (array_key_exists('total', $updates)) {
                $payload['total'] = $this->formatMoney($updates['total']);
            }
            if (array_key_exists('paidAmount', $updates)) {
                $payload['paid_amount'] = $this->formatMoney($updates['paidAmount']);
            }
            if (array_key_exists('history', $updates)) {
                $payload['history'] = $this->jsonEncode($updates['history']);
            }

            $this->touchUpdate('bills', $id, $payload);
            $this->applyResolvedProductStockUpdates($stockUpdates);
            $this->syncVendorPurchaseSummaries([
                $previousVendorId,
                (string) ($payload['vendor_id'] ?? $previousVendorId),
            ]);

            $row = $this->fetchBillRowById($id);
            if ($row === null) {
                throw new RuntimeException('Updated bill could not be loaded.');
            }

            return $this->mapBill($row);
        });
    }

    public function deleteBill(array $params): array
    {
        $actor = $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));

        return $this->database->transaction(function () use ($actor, $id): array {
            $existingRow = $this->database->fetchOne(
                'SELECT * FROM bills WHERE id = :id AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
                [':id' => $id]
            );

            if ($existingRow === null) {
                throw new RuntimeException('Bill was not found or is already deleted.');
            }

            $this->assertUserCanManageBillRecord(
                $actor,
                $existingRow,
                'bills.deleteOwn',
                'bills.deleteAny',
                'You do not have permission to delete this bill.'
            );
            $deletedAt = $this->database->nowUtc();
            $relatedTransactions = $this->fetchBillLinkedTransactionRows($id, 'active');
            $this->applyTransactionAccountEffect($relatedTransactions, 'revert');
            $this->softDeleteTransactionRowsByIds(
                array_map(static fn(array $row): string => (string) $row['id'], $relatedTransactions),
                $deletedAt,
                (string) $actor['id']
            );

            $this->database->execute(
                'UPDATE bills
                 SET deleted_at = :deleted_at, deleted_by = :deleted_by, updated_at = :updated_at
                 WHERE id = :id AND deleted_at IS NULL',
                [
                    ':deleted_at' => $deletedAt,
                    ':deleted_by' => (string) $actor['id'],
                    ':updated_at' => $deletedAt,
                    ':id' => $id,
                ]
            );
            $this->syncVendorPurchaseSummaries([(string) ($existingRow['vendor_id'] ?? '')]);

            return ['success' => true];
        });
    }

    public function fetchTransactions(array $params = []): array
    {
        $rows = $this->database->fetchAll('SELECT * FROM transactions_with_relations ORDER BY createdAt DESC');
        return array_map(fn(array $row): array => $this->mapTransaction($row), $rows);
    }

    public function fetchTransactionsPage(array $params): array
    {
        $pageSize = $this->pageSize($params);
        $offset = $this->pageOffset($params);
        $filters = is_array($params['filters'] ?? null) ? $params['filters'] : $params;
        $where = 'WHERE 1=1';
        $bindings = [];

        if (!empty($filters['type'])) {
            $where .= ' AND twr.type = :type';
            $bindings[':type'] = trim((string) $filters['type']);
        }
        if (!empty($filters['category'])) {
            $where .= ' AND twr.category = :category';
            $bindings[':category'] = trim((string) $filters['category']);
        }
        if (!empty($filters['from'])) {
            $where .= ' AND twr.date >= :from';
            $bindings[':from'] = $this->normalizeDateTimeInput((string) $filters['from']);
        }
        if (!empty($filters['to'])) {
            $where .= ' AND twr.date <= :to';
            $bindings[':to'] = $this->normalizeDateTimeInput((string) $filters['to']);
        }
        if (!empty($filters['search'])) {
            $searchValue = '%' . trim((string) $filters['search']) . '%';
            $bindings[':search_desc'] = $searchValue;
            $bindings[':search_id'] = $searchValue;
            $bindings[':search_type'] = $searchValue;
            $bindings[':search_cat'] = $searchValue;
            $bindings[':search_contact'] = $searchValue;
            $bindings[':search_creator'] = $searchValue;
            $bindings[':search_amount'] = $searchValue;
            $bindings[':search_cat_name'] = $searchValue;

            $where .= " AND (
                twr.description LIKE :search_desc
                OR twr.id LIKE :search_id
                OR twr.type LIKE :search_type
                OR twr.category LIKE :search_cat
                OR COALESCE(twr.contactName, '') LIKE :search_contact
                OR COALESCE(twr.creatorName, '') LIKE :search_creator
                OR CAST(twr.amount AS CHAR) LIKE :search_amount
                OR EXISTS (
                    SELECT 1
                    FROM categories cat
                    WHERE cat.id = twr.category
                      AND cat.name LIKE :search_cat_name
                )
            )";
        }

        $createdByIds = is_array($filters['createdByIds'] ?? null) ? $filters['createdByIds'] : [];
        $createdByIds = array_values(array_filter(array_map('strval', $createdByIds), static fn(string $id): bool => trim($id) !== ''));
        if ($createdByIds !== []) {
            [$placeholders, $inBindings] = $this->inClause($createdByIds, 'created_by');
            $where .= ' AND twr.createdBy IN (' . implode(', ', $placeholders) . ')';
            $bindings += $inBindings;
        }

        $countRow = $this->database->fetchOne("SELECT COUNT(*) AS count FROM transactions_with_relations twr {$where}", $bindings);
        $rows = $this->database->fetchAll(
            "SELECT
                twr.id,
                twr.date,
                twr.type,
                twr.category,
                twr.accountId,
                twr.accountName,
                twr.toAccountId,
                twr.amount,
                twr.description,
                twr.referenceId,
                twr.contactId,
                twr.contactName,
                twr.contactType,
                twr.paymentMethod,
                twr.attachmentName,
                twr.attachmentUrl,
                twr.createdBy,
                twr.creatorName,
                twr.approvalStatus,
                twr.accountEffectApplied,
                twr.approvalRequestedAt,
                twr.approvedAt,
                twr.declinedAt,
                twr.approvalNote,
                twr.createdAt,
                twr.deletedAt,
                twr.deletedBy
             FROM transactions_with_relations twr
             {$where}
             ORDER BY twr.createdAt DESC
             LIMIT {$pageSize} OFFSET {$offset}",
            $bindings
        );

        return [
            'data' => array_map(fn(array $row): array => $this->mapTransaction($row), $rows),
            'count' => (int) ($countRow['count'] ?? 0),
        ];
    }

    public function fetchTransactionById(array $params): ?array
    {
        $row = $this->database->fetchOne(
            'SELECT * FROM transactions_with_relations WHERE id = :id LIMIT 1',
            [':id' => trim((string) ($params['id'] ?? ''))]
        );

        return $row ? $this->mapTransaction($row) : null;
    }

    /**
     * @param array<string, mixed> $params
     * @return array<string, mixed>
     */
    private function createTransactionRecord(array $params, string $actorId, ?array $actor = null): array
    {
        $id = $this->stringId($params['id'] ?? null);
        $now = $this->database->nowUtc();
        $type = trim((string) ($params['type'] ?? 'Income'));
        $accountId = trim((string) ($params['accountId'] ?? ''));
        $toAccountId = $this->nullableString($params['toAccountId'] ?? null);
        $amount = (float) ($params['amount'] ?? 0);
        $actorRow = is_array($actor) ? $actor : $this->currentUser();
        $transactionDraft = [
            'id' => $id,
            'type' => $type,
            'account_id' => $accountId,
            'to_account_id' => $toAccountId,
            'amount' => $amount,
            'description' => trim((string) ($params['description'] ?? '')),
        ];
        $approvalState = $this->buildTransactionApprovalState($actorRow, $transactionDraft);

        $this->assertTransactionHasAvailableBalance($transactionDraft);

        $this->database->execute(
            'INSERT INTO transactions (
                id, date, type, category, account_id, to_account_id, amount, description,
                reference_id, contact_id, payment_method, attachment_name, attachment_url,
                created_by, history, approval_status, account_effect_applied,
                approval_requested_by, approval_requested_at, approved_by, approved_at,
                declined_by, declined_at, approval_note, created_at, updated_at
            ) VALUES (
                :id, :date, :type, :category, :account_id, :to_account_id, :amount, :description,
                :reference_id, :contact_id, :payment_method, :attachment_name, :attachment_url,
                :created_by, :history, :approval_status, :account_effect_applied,
                :approval_requested_by, :approval_requested_at, :approved_by, :approved_at,
                :declined_by, :declined_at, :approval_note, :created_at, :updated_at
            )',
            [
                ':id' => $id,
                ':date' => $this->normalizeDateTimeInput((string) ($params['date'] ?? $now)),
                ':type' => $type,
                ':category' => trim((string) ($params['category'] ?? '')),
                ':account_id' => $accountId,
                ':to_account_id' => $toAccountId,
                ':amount' => $this->formatMoney($amount),
                ':description' => trim((string) ($params['description'] ?? '')),
                ':reference_id' => $this->nullableString($params['referenceId'] ?? null),
                ':contact_id' => $this->nullableString($params['contactId'] ?? null),
                ':payment_method' => trim((string) ($params['paymentMethod'] ?? '')),
                ':attachment_name' => $this->nullableString($params['attachmentName'] ?? null),
                ':attachment_url' => $this->nullableString($params['attachmentUrl'] ?? null),
                ':created_by' => $actorId,
                ':history' => $this->jsonEncode($params['history'] ?? []),
                ':approval_status' => (string) ($approvalState['approval_status'] ?? 'approved'),
                ':account_effect_applied' => (int) ($approvalState['account_effect_applied'] ?? 1),
                ':approval_requested_by' => $this->nullableString($approvalState['approval_requested_by'] ?? null),
                ':approval_requested_at' => $this->nullableString($approvalState['approval_requested_at'] ?? null),
                ':approved_by' => $this->nullableString($approvalState['approved_by'] ?? null),
                ':approved_at' => $this->nullableString($approvalState['approved_at'] ?? null),
                ':declined_by' => $this->nullableString($approvalState['declined_by'] ?? null),
                ':declined_at' => $this->nullableString($approvalState['declined_at'] ?? null),
                ':approval_note' => $this->nullableString($approvalState['approval_note'] ?? null),
                ':created_at' => $now,
                ':updated_at' => $now,
            ]
        );

        $this->applyTransactionAccountEffect([array_merge($transactionDraft, $approvalState)], 'apply');

        $record = $this->fetchTransactionById(['id' => $id]) ?? throw new RuntimeException('Failed to create transaction.');
        if (($record['approvalStatus'] ?? 'approved') === 'pending') {
            $this->upsertTransactionApprovalNotification($actorRow, $record);
        }

        return $record;
    }

    public function createTransaction(array $params): array
    {
        $actor = $this->currentUser();

        return $this->database->transaction(fn() => $this->createTransactionRecord($params, (string) $actor['id'], $actor));
    }

    public function updateTransaction(array $params): array
    {
        $actor = $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));
        $updates = is_array($params['updates'] ?? null) ? $params['updates'] : [];

        return $this->database->transaction(function () use ($actor, $id, $updates): array {
            $existingRow = $this->database->fetchOne(
                'SELECT * FROM transactions WHERE id = :id AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
                [':id' => $id]
            );

            if ($existingRow === null) {
                throw new RuntimeException('Transaction not found.');
            }

            $payload = [];
            if (array_key_exists('date', $updates)) {
                $payload['date'] = $this->normalizeDateTimeInput((string) $updates['date']);
            }
            if (array_key_exists('type', $updates)) {
                $payload['type'] = trim((string) $updates['type']);
            }
            if (array_key_exists('category', $updates)) {
                $payload['category'] = trim((string) $updates['category']);
            }
            if (array_key_exists('accountId', $updates)) {
                $payload['account_id'] = trim((string) $updates['accountId']);
            }
            if (array_key_exists('toAccountId', $updates)) {
                $payload['to_account_id'] = $this->nullableString($updates['toAccountId']);
            }
            if (array_key_exists('amount', $updates)) {
                $payload['amount'] = $this->formatMoney($updates['amount']);
            }
            if (array_key_exists('description', $updates)) {
                $payload['description'] = trim((string) $updates['description']);
            }
            if (array_key_exists('referenceId', $updates)) {
                $payload['reference_id'] = $this->nullableString($updates['referenceId']);
            }
            if (array_key_exists('contactId', $updates)) {
                $payload['contact_id'] = $this->nullableString($updates['contactId']);
            }
            if (array_key_exists('paymentMethod', $updates)) {
                $payload['payment_method'] = trim((string) $updates['paymentMethod']);
            }
            if (array_key_exists('attachmentName', $updates)) {
                $payload['attachment_name'] = $this->nullableString($updates['attachmentName']);
            }
            if (array_key_exists('attachmentUrl', $updates)) {
                $payload['attachment_url'] = $this->nullableString($updates['attachmentUrl']);
            }
            if (array_key_exists('history', $updates)) {
                $payload['history'] = $this->jsonEncode($updates['history']);
            }

            $nextRow = array_merge($existingRow, $payload);
            $currentApprovalStatus = trim((string) ($existingRow['approval_status'] ?? 'approved')) ?: 'approved';
            $calculatedApprovalState = $this->buildTransactionApprovalState($actor, $nextRow);
            $nextApprovalStatus = trim((string) ($calculatedApprovalState['approval_status'] ?? 'approved')) ?: 'approved';
            $approvalState = $calculatedApprovalState;

            if ($nextApprovalStatus === $currentApprovalStatus) {
                if ($nextApprovalStatus === 'approved') {
                    $approvalState = [
                        'approval_status' => 'approved',
                        'account_effect_applied' => 1,
                        'approval_requested_by' => $this->nullableString($existingRow['approval_requested_by'] ?? (string) ($actor['id'] ?? '')),
                        'approval_requested_at' => $this->nullableString($existingRow['approval_requested_at'] ?? $calculatedApprovalState['approval_requested_at'] ?? null),
                        'approved_by' => $this->nullableString($existingRow['approved_by'] ?? (string) ($actor['id'] ?? '')),
                        'approved_at' => $this->nullableString($existingRow['approved_at'] ?? $calculatedApprovalState['approved_at'] ?? null),
                        'declined_by' => null,
                        'declined_at' => null,
                        'approval_note' => null,
                    ];
                } elseif ($nextApprovalStatus === 'pending') {
                    $approvalState = [
                        'approval_status' => 'pending',
                        'account_effect_applied' => 0,
                        'approval_requested_by' => $this->nullableString($existingRow['approval_requested_by'] ?? (string) ($actor['id'] ?? '')),
                        'approval_requested_at' => $this->nullableString($existingRow['approval_requested_at'] ?? $calculatedApprovalState['approval_requested_at'] ?? null),
                        'approved_by' => null,
                        'approved_at' => null,
                        'declined_by' => null,
                        'declined_at' => null,
                        'approval_note' => $this->nullableString($existingRow['approval_note'] ?? $calculatedApprovalState['approval_note'] ?? null),
                    ];
                } elseif ($nextApprovalStatus === 'declined') {
                    $approvalState = [
                        'approval_status' => 'declined',
                        'account_effect_applied' => 0,
                        'approval_requested_by' => $this->nullableString($existingRow['approval_requested_by'] ?? null),
                        'approval_requested_at' => $this->nullableString($existingRow['approval_requested_at'] ?? null),
                        'approved_by' => null,
                        'approved_at' => null,
                        'declined_by' => $this->nullableString($existingRow['declined_by'] ?? null),
                        'declined_at' => $this->nullableString($existingRow['declined_at'] ?? null),
                        'approval_note' => $this->nullableString($existingRow['approval_note'] ?? null),
                    ];
                }
            }

            $financialFieldsChanged =
                array_key_exists('type', $payload) ||
                array_key_exists('account_id', $payload) ||
                array_key_exists('to_account_id', $payload) ||
                array_key_exists('amount', $payload);

            if ($financialFieldsChanged || ($currentApprovalStatus !== 'approved' && $nextApprovalStatus === 'approved')) {
                $this->assertTransactionHasAvailableBalance(
                    $nextRow,
                    $this->accountBalanceAdjustmentFromRevertingTransaction(
                        $existingRow,
                        trim((string) ($nextRow['account_id'] ?? ''))
                    )
                );
            }
            $payload = array_merge($payload, $approvalState);

            if ($payload !== []) {
                $shouldResyncAccountEffect =
                    $financialFieldsChanged ||
                    (int) ($existingRow['account_effect_applied'] ?? 1) !== (int) ($approvalState['account_effect_applied'] ?? 1);

                $this->touchUpdate('transactions', $id, $payload);

                if ($shouldResyncAccountEffect) {
                    $nextRow = array_merge($existingRow, $payload);
                    $this->applyTransactionAccountEffect([$existingRow], 'revert');
                    $this->applyTransactionAccountEffect([$nextRow], 'apply');
                }
            }

            $record = $this->fetchTransactionById(['id' => $id]) ?? throw new RuntimeException('Transaction not found.');
            if (($record['approvalStatus'] ?? 'approved') === 'pending') {
                $this->upsertTransactionApprovalNotification($actor, $record);
            } else {
                $this->resolveTransactionApprovalNotification(
                    (string) ($record['id'] ?? $id),
                    (string) ($record['approvalStatus'] ?? 'approved')
                );
            }

            return $record;
        });
    }

    public function reviewTransactionApproval(array $params): array
    {
        $actor = $this->requireAdmin();
        $transactionId = trim((string) ($params['transactionId'] ?? ''));
        $decision = trim((string) ($params['decision'] ?? ''));

        if ($transactionId === '') {
            throw new RuntimeException('Transaction id is required.');
        }
        if (!in_array($decision, ['approve', 'decline'], true)) {
            throw new RuntimeException('A valid approval decision is required.');
        }

        return $this->database->transaction(function () use ($actor, $transactionId, $decision): array {
            $row = $this->database->fetchOne(
                'SELECT * FROM transactions WHERE id = :id AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
                [':id' => $transactionId]
            );

            if ($row === null) {
                throw new RuntimeException('Transaction not found.');
            }

            $currentStatus = trim((string) ($row['approval_status'] ?? 'approved')) ?: 'approved';
            if ($currentStatus === 'approved') {
                if ($decision === 'approve') {
                    $this->resolveTransactionApprovalNotification($transactionId, 'approved', 'approve');
                    return [
                        'transactionId' => $transactionId,
                        'decision' => $decision,
                        'success' => true,
                    ];
                }

                throw new RuntimeException('This transaction has already been approved.');
            }

            if ($currentStatus === 'declined') {
                if ($decision === 'decline') {
                    $this->resolveTransactionApprovalNotification($transactionId, 'declined', 'decline');
                    return [
                        'transactionId' => $transactionId,
                        'decision' => $decision,
                        'success' => true,
                    ];
                }

                throw new RuntimeException('This transaction has already been declined.');
            }

            if ($currentStatus !== 'pending') {
                throw new RuntimeException('Only pending transactions can be reviewed.');
            }

            $now = $this->database->nowUtc();
            if ($decision === 'approve') {
                $approvalRow = $row;
                $approvalRow['account_effect_applied'] = 1;
                $this->assertTransactionHasAvailableBalance($approvalRow);
                $this->applyTransactionAccountEffect([$approvalRow], 'apply');
                $this->touchUpdate('transactions', $transactionId, [
                    'approval_status' => 'approved',
                    'account_effect_applied' => 1,
                    'approved_by' => (string) ($actor['id'] ?? ''),
                    'approved_at' => $now,
                    'declined_by' => null,
                    'declined_at' => null,
                    'approval_note' => null,
                ]);
            } else {
                if ((int) ($row['account_effect_applied'] ?? 0) === 1) {
                    $this->applyTransactionAccountEffect([$row], 'revert');
                }

                $this->touchUpdate('transactions', $transactionId, [
                    'approval_status' => 'declined',
                    'account_effect_applied' => 0,
                    'approved_by' => null,
                    'approved_at' => null,
                    'declined_by' => (string) ($actor['id'] ?? ''),
                    'declined_at' => $now,
                    'approval_note' => 'Declined by admin review.',
                ]);
            }

            $this->resolveTransactionApprovalNotification(
                $transactionId,
                $decision === 'approve' ? 'approved' : 'declined',
                $decision
            );

            return [
                'transactionId' => $transactionId,
                'decision' => $decision,
                'success' => true,
            ];
        });
    }

    public function deleteTransaction(array $params): array
    {
        $actor = $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));
        if (str_starts_with($id, 'temp-')) {
            throw new RuntimeException('Cannot delete unsaved transactions. Please refresh and try again.');
        }

        return $this->database->transaction(function () use ($actor, $id): array {
            $row = $this->database->fetchOne(
                'SELECT id, type, account_id, to_account_id, amount, account_effect_applied
                 FROM transactions
                 WHERE id = :id AND deleted_at IS NULL
                 LIMIT 1 FOR UPDATE',
                [':id' => $id]
            );

            if ($row === null) {
                throw new RuntimeException('Transaction was not found or is already deleted.');
            }

            $deletedAt = $this->database->nowUtc();
            $this->applyTransactionAccountEffect([$row], 'revert');
            $this->softDeleteTransactionRowsByIds([$id], $deletedAt, (string) $actor['id']);
            return ['success' => true];
        });
    }

    private function fetchPayrollSettingsInternal(): array
    {
        $row = $this->database->fetchOne('SELECT * FROM payroll_settings LIMIT 1');
        if ($row === null) {
            return $this->defaultPayrollSettings();
        }

        return $this->mapPayrollSettings($row);
    }

    private function isWalletStatusPayable(string $status, array $countedStatuses): bool
    {
        return in_array($status, $countedStatuses, true);
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function fetchWalletEntriesForOrder(string $orderId): array
    {
        return $this->database->fetchAll(
            "SELECT id, employee_id, entry_type, amount_delta, unit_amount_snapshot, source_order_id, source_order_number
             FROM wallet_entries
             WHERE source_order_id = :source_order_id
               AND entry_type IN ('order_credit', 'order_reversal')
             ORDER BY created_at ASC",
            [':source_order_id' => $orderId]
        );
    }

    /**
     * @param array<int, string> $entryIds
     */
    private function deleteWalletEntryRows(array $entryIds): void
    {
        $entryIds = array_values(array_filter(array_map('strval', $entryIds), static fn(string $id): bool => trim($id) !== ''));
        if ($entryIds === []) {
            return;
        }

        [$placeholders, $bindings] = $this->inClause($entryIds, 'wallet');
        $this->database->execute(
            'DELETE FROM wallet_entries WHERE id IN (' . implode(', ', $placeholders) . ')',
            $bindings
        );
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     */
    private function insertWalletEntryRows(array $rows): void
    {
        foreach ($rows as $row) {
            $id = $this->stringId($row['id'] ?? null);
            $this->database->execute(
                'INSERT INTO wallet_entries (
                    id, employee_id, entry_type, amount_delta, unit_amount_snapshot, source_order_id,
                    source_order_number, wallet_payout_id, note, created_at, created_by
                ) VALUES (
                    :id, :employee_id, :entry_type, :amount_delta, :unit_amount_snapshot, :source_order_id,
                    :source_order_number, :wallet_payout_id, :note, :created_at, :created_by
                )',
                [
                    ':id' => $id,
                    ':employee_id' => trim((string) ($row['employee_id'] ?? '')),
                    ':entry_type' => trim((string) ($row['entry_type'] ?? 'order_credit')),
                    ':amount_delta' => $this->formatMoney($row['amount_delta'] ?? 0),
                    ':unit_amount_snapshot' => ($row['unit_amount_snapshot'] ?? null) !== null
                        ? $this->formatMoney($row['unit_amount_snapshot'])
                        : null,
                    ':source_order_id' => $this->nullableString($row['source_order_id'] ?? null),
                    ':source_order_number' => $this->nullableString($row['source_order_number'] ?? null),
                    ':wallet_payout_id' => $this->nullableString($row['wallet_payout_id'] ?? null),
                    ':note' => $this->nullableString($row['note'] ?? null),
                    ':created_at' => $this->normalizeDateTimeInput((string) ($row['created_at'] ?? $this->database->nowUtc())),
                    ':created_by' => $this->nullableString($row['created_by'] ?? null),
                ]
            );
        }
    }

    /**
     * @param array<string, mixed> $order
     * @param array<string, mixed>|null $walletSettings
     */
    private function syncWalletCreditForOrder(array $order, ?array $walletSettings = null): void
    {
        $orderId = trim((string) ($order['id'] ?? ''));
        $createdBy = trim((string) ($order['createdBy'] ?? ''));
        if ($orderId === '' || $createdBy === '') {
            return;
        }

        if (!$this->isWalletEligibleOrderDate((string) ($order['orderDate'] ?? ''), (string) ($order['createdAt'] ?? ''))) {
            return;
        }

        $creator = $this->database->fetchOne(
            'SELECT id, role FROM users WHERE id = :id AND deleted_at IS NULL LIMIT 1',
            [':id' => $createdBy]
        );
        if ($creator === null || !$this->isEmployeeRole((string) ($creator['role'] ?? ''))) {
            return;
        }

        $effectiveSettings = $walletSettings ?? $this->fetchWalletSettings();
        $countedStatuses = is_array($effectiveSettings['countedStatuses'] ?? null)
            ? $effectiveSettings['countedStatuses']
            : [];
        $status = trim((string) ($order['status'] ?? ''));
        $now = $this->database->nowUtc();
        $actor = $this->auth->userFromToken(Http::bearerToken());
        $actorId = trim((string) (($actor['id'] ?? null) ?? $createdBy));

        $entries = $this->fetchWalletEntriesForOrder($orderId);
        $creditEntry = null;
        $reversalEntries = [];
        foreach ($entries as $entry) {
            if (($entry['entry_type'] ?? '') === 'order_credit' && $creditEntry === null) {
                $creditEntry = $entry;
                continue;
            }
            if (($entry['entry_type'] ?? '') === 'order_reversal') {
                $reversalEntries[] = $entry;
            }
        }

        if ($creditEntry === null && $reversalEntries !== []) {
            $this->deleteWalletEntryRows(array_map(static fn(array $entry): string => (string) $entry['id'], $reversalEntries));
        }

        if ($this->isWalletStatusPayable($status, $countedStatuses)) {
            if ($reversalEntries !== []) {
                $this->deleteWalletEntryRows(array_map(static fn(array $entry): string => (string) $entry['id'], $reversalEntries));
            }

            if ($creditEntry === null && (float) ($effectiveSettings['unitAmount'] ?? 0) > 0) {
                $unitAmount = (float) ($effectiveSettings['unitAmount'] ?? 0);
                $this->insertWalletEntryRows([
                    [
                        'employee_id' => $createdBy,
                        'entry_type' => 'order_credit',
                        'amount_delta' => $unitAmount,
                        'unit_amount_snapshot' => $unitAmount,
                        'source_order_id' => $orderId,
                        'source_order_number' => $order['orderNumber'] ?? null,
                        'note' => 'Wallet credit added because the order is in a payable status.',
                        'created_at' => $now,
                        'created_by' => $actorId !== '' ? $actorId : $createdBy,
                    ]
                ]);
            }

            return;
        }

        if ($creditEntry !== null && $reversalEntries === []) {
            $creditAmount = abs((float) ($creditEntry['amount_delta'] ?? 0));
            $this->insertWalletEntryRows([
                [
                    'employee_id' => $createdBy,
                    'entry_type' => 'order_reversal',
                    'amount_delta' => -$creditAmount,
                    'unit_amount_snapshot' => $creditEntry['unit_amount_snapshot'] ?? $creditAmount,
                    'source_order_id' => $orderId,
                    'source_order_number' => $order['orderNumber'] ?? ($creditEntry['source_order_number'] ?? null),
                    'note' => 'Wallet credit reversed because the order is not in a payable status.',
                    'created_at' => $now,
                    'created_by' => $actorId !== '' ? $actorId : $createdBy,
                ]
            ]);
        }
    }

    /**
     * @param array<string, mixed> $params
     */
    private function ensureDeletedOrderWalletReversal(array $params): void
    {
        if (!$this->isWalletEligibleOrderDate((string) ($params['orderDate'] ?? ''), (string) ($params['createdAt'] ?? ''))) {
            return;
        }

        $creditRow = $this->database->fetchOne(
            "SELECT id, amount_delta, unit_amount_snapshot
             FROM wallet_entries
             WHERE source_order_id = :source_order_id AND entry_type = 'order_credit'
             ORDER BY created_at ASC
             LIMIT 1",
            [':source_order_id' => trim((string) ($params['id'] ?? ''))]
        );

        if ($creditRow === null) {
            return;
        }

        $reversalRow = $this->database->fetchOne(
            "SELECT id FROM wallet_entries
             WHERE source_order_id = :source_order_id AND entry_type = 'order_reversal'
             LIMIT 1",
            [':source_order_id' => trim((string) ($params['id'] ?? ''))]
        );

        if ($reversalRow !== null) {
            return;
        }

        $creditAmount = abs((float) ($creditRow['amount_delta'] ?? 0));
        $this->insertWalletEntryRows([
            [
                'employee_id' => (string) ($params['createdBy'] ?? ''),
                'entry_type' => 'order_reversal',
                'amount_delta' => -$creditAmount,
                'unit_amount_snapshot' => $creditRow['unit_amount_snapshot'] ?? $creditAmount,
                'source_order_id' => (string) ($params['id'] ?? ''),
                'source_order_number' => $params['orderNumber'] ?? null,
                'note' => 'Wallet credit reversed because the order was moved to the recycle bin.',
                'created_at' => $this->database->nowUtc(),
                'created_by' => $params['deletedBy'] ?? null,
            ]
        ]);
    }

    /**
     * @param array<int, string> $employeeIds
     * @param array<string, mixed>|null $walletSettings
     */
    private function syncWalletCreditsForEmployees(array $employeeIds, ?array $walletSettings = null): void
    {
        $employeeIds = array_values(array_unique(array_filter(
            array_map(static fn($id): string => trim((string) $id), $employeeIds),
            static fn(string $id): bool => $id !== ''
        )));
        if ($employeeIds === []) {
            return;
        }

        $effectiveSettings = $walletSettings ?? $this->fetchWalletSettings();
        [$placeholders, $bindings] = $this->inClause($employeeIds, 'employee');
        $orders = $this->database->fetchAll(
            'SELECT id, created_by, status, order_number, order_date, created_at
             FROM orders
             WHERE deleted_at IS NULL AND created_by IN (' . implode(', ', $placeholders) . ')',
            $bindings
        );

        foreach ($orders as $order) {
            $this->syncWalletCreditForOrder([
                'id' => (string) $order['id'],
                'createdBy' => (string) ($order['created_by'] ?? ''),
                'status' => (string) ($order['status'] ?? 'On Hold'),
                'orderNumber' => (string) ($order['order_number'] ?? ''),
                'orderDate' => (string) ($order['order_date'] ?? ''),
                'createdAt' => $this->toIso($order['created_at'] ?? null),
            ], $effectiveSettings);
        }
    }

    /**
     * @param array<int, string> $employeeIds
     * @param array<int, string> $countedStatuses
     * @return array<string, int>
     */
    private function fetchEligibleOrderCountsByEmployeeIds(
        array $employeeIds,
        array $countedStatuses,
        ?string $periodStart = null,
        ?string $periodEnd = null
    ): array {
        $employeeIds = array_values(array_unique(array_filter(
            array_map(static fn($id): string => trim((string) $id), $employeeIds),
            static fn(string $id): bool => $id !== ''
        )));
        if ($employeeIds === [] || $countedStatuses === []) {
            return [];
        }

        [$placeholders, $bindings] = $this->inClause($employeeIds, 'count_employee');
        $orderRows = $this->database->fetchAll(
            'SELECT created_by, status, order_date, created_at
             FROM orders
             WHERE deleted_at IS NULL AND created_by IN (' . implode(', ', $placeholders) . ')',
            $bindings
        );

        $orderCounts = [];
        foreach ($orderRows as $row) {
            $createdBy = trim((string) ($row['created_by'] ?? ''));
            $status = trim((string) ($row['status'] ?? ''));
            if ($createdBy === '' || !in_array($status, $countedStatuses, true)) {
                continue;
            }

            $activityDate = $this->walletEligibleLocalDate(
                (string) ($row['order_date'] ?? ''),
                $this->toIso($row['created_at'] ?? null) ?? (string) ($row['created_at'] ?? '')
            );
            if ($activityDate === '' || $activityDate < $this->walletCutoffDate()) {
                continue;
            }
            if ($periodStart !== null && $periodStart !== '' && $activityDate < $periodStart) {
                continue;
            }
            if ($periodEnd !== null && $periodEnd !== '' && $activityDate > $periodEnd) {
                continue;
            }

            $orderCounts[$createdBy] = ($orderCounts[$createdBy] ?? 0) + 1;
        }

        return $orderCounts;
    }

    /**
     * @param array<int, string> $employeeIds
     * @return array<string, array<string, mixed>>
     */
    private function fetchLiveWalletAmountsByEmployeeIds(array $employeeIds): array
    {
        $employeeIds = array_values(array_unique(array_filter(
            array_map(static fn($id): string => trim((string) $id), $employeeIds),
            static fn(string $id): bool => $id !== ''
        )));
        if ($employeeIds === []) {
            return [];
        }

        [$placeholders, $bindings] = $this->inClause($employeeIds, 'wallet_employee');
        $rows = $this->database->fetchAll(
            'SELECT we.employee_id, we.entry_type, we.amount_delta, we.created_at, o.order_date, o.created_at AS order_created_at
             FROM wallet_entries we
             LEFT JOIN orders o ON o.id = we.source_order_id
             WHERE we.employee_id IN (' . implode(', ', $placeholders) . ')',
            $bindings
        );

        $cutoffAtUtc = $this->walletCutoffAtUtc();
        $aggregates = [];
        foreach ($rows as $row) {
            $employeeId = trim((string) ($row['employee_id'] ?? ''));
            $entryType = trim((string) ($row['entry_type'] ?? ''));
            if ($employeeId === '' || $entryType === '') {
                continue;
            }

            $entryCreatedAt = $this->toIso($row['created_at'] ?? null) ?? (string) ($row['created_at'] ?? '');
            $includeEntry = false;
            if (in_array($entryType, ['order_credit', 'order_reversal'], true)) {
                $orderCreatedAt = $this->toIso($row['order_created_at'] ?? null) ?? (string) ($row['order_created_at'] ?? '');
                $includeEntry = $this->isWalletEligibleOrderDate((string) ($row['order_date'] ?? ''), $orderCreatedAt);
            } elseif ($entryCreatedAt !== '') {
                $includeEntry = $this->normalizeDateTimeInput($entryCreatedAt) >= $cutoffAtUtc;
            }

            if (!$includeEntry) {
                continue;
            }

            if (!isset($aggregates[$employeeId])) {
                $aggregates[$employeeId] = [
                    'currentBalance' => 0.0,
                    'totalEarned' => 0.0,
                    'totalPaid' => 0.0,
                    'lastActivityAt' => null,
                ];
            }

            $amount = (float) ($row['amount_delta'] ?? 0);
            $aggregates[$employeeId]['currentBalance'] += $amount;
            if ($entryType === 'order_credit') {
                $aggregates[$employeeId]['totalEarned'] += $amount;
            }
            if ($entryType === 'payout') {
                $aggregates[$employeeId]['totalPaid'] += abs($amount);
            }
            if (
                $entryCreatedAt !== ''
                && (
                    !isset($aggregates[$employeeId]['lastActivityAt'])
                    || !is_string($aggregates[$employeeId]['lastActivityAt'])
                    || $aggregates[$employeeId]['lastActivityAt'] === ''
                    || $entryCreatedAt > $aggregates[$employeeId]['lastActivityAt']
                )
            ) {
                $aggregates[$employeeId]['lastActivityAt'] = $entryCreatedAt;
            }
        }

        foreach ($aggregates as $employeeId => $aggregate) {
            $aggregates[$employeeId]['currentBalance'] = round((float) ($aggregate['currentBalance'] ?? 0), 2);
            $aggregates[$employeeId]['totalEarned'] = round((float) ($aggregate['totalEarned'] ?? 0), 2);
            $aggregates[$employeeId]['totalPaid'] = round((float) ($aggregate['totalPaid'] ?? 0), 2);
        }

        return $aggregates;
    }

    /**
     * @param array<int, array<string, mixed>> $employees
     * @param array<string, mixed>|null $walletSettings
     * @return array<int, array<string, mixed>>
     */
    private function buildWalletCardsForEmployees(array $employees, ?array $walletSettings = null): array
    {
        if ($employees === []) {
            return [];
        }

        $effectiveSettings = $walletSettings ?? $this->fetchWalletSettings();
        $countedStatuses = is_array($effectiveSettings['countedStatuses'] ?? null)
            ? $effectiveSettings['countedStatuses']
            : [];
        $employeeIds = array_map(static fn(array $employee): string => (string) ($employee['id'] ?? ''), $employees);
        $orderCounts = $this->fetchEligibleOrderCountsByEmployeeIds($employeeIds, $countedStatuses);
        $walletAmounts = $this->fetchLiveWalletAmountsByEmployeeIds($employeeIds);

        $cards = [];
        foreach ($employees as $employee) {
            $employeeId = (string) ($employee['id'] ?? '');
            if ($employeeId === '') {
                continue;
            }

            $walletAmount = $walletAmounts[$employeeId] ?? [];
            $cards[] = [
                'employeeId' => $employeeId,
                'employeeName' => (string) ($employee['name'] ?? 'Unknown Employee'),
                'employeeRole' => (string) ($employee['role'] ?? 'Employee'),
                'currentBalance' => (float) ($walletAmount['currentBalance'] ?? 0),
                'totalEarned' => (float) ($walletAmount['totalEarned'] ?? 0),
                'totalPaid' => (float) ($walletAmount['totalPaid'] ?? 0),
                'creditedOrders' => (int) ($orderCounts[$employeeId] ?? 0),
                'lastActivityAt' => $walletAmount['lastActivityAt'] ?? null,
            ];
        }

        usort($cards, static function (array $left, array $right): int {
            if ((float) $right['currentBalance'] !== (float) $left['currentBalance']) {
                return (float) $right['currentBalance'] <=> (float) $left['currentBalance'];
            }

            return strcmp((string) $left['employeeName'], (string) $right['employeeName']);
        });

        return $cards;
    }

    /**
     * @param array<int, array<string, mixed>> $cards
     * @return array<string, float|int>
     */
    private function summarizeWalletCards(array $cards): array
    {
        return array_reduce(
            $cards,
            static function (array $summary, array $card): array {
                $summary['totalBalance'] += (float) ($card['currentBalance'] ?? 0);
                $summary['totalEarned'] += (float) ($card['totalEarned'] ?? 0);
                $summary['totalPaid'] += (float) ($card['totalPaid'] ?? 0);
                if ((float) ($card['currentBalance'] ?? 0) > 0) {
                    $summary['employeesDue'] += 1;
                }

                return $summary;
            },
            [
                'totalBalance' => 0.0,
                'totalEarned' => 0.0,
                'totalPaid' => 0.0,
                'employeesDue' => 0,
            ]
        );
    }

    /**
     * @param array<string, mixed> $walletSettings
     */
    private function syncWalletCreditsForPayableStatuses(array $walletSettings): void
    {
        $employees = $this->database->fetchAll(
            "SELECT id FROM users WHERE deleted_at IS NULL AND role IN ('Employee', 'Employee1')"
        );

        if ($employees === []) {
            return;
        }

        $employeeIds = array_map(static fn(array $row): string => (string) $row['id'], $employees);
        $this->syncWalletCreditsForEmployees($employeeIds, $walletSettings);
    }

    public function fetchPayrollSettings(array $params = []): array
    {
        return $this->fetchPayrollSettingsInternal();
    }

    public function updatePayrollSettings(array $params): array
    {
        $current = $this->fetchPayrollSettingsInternal();
        return $this->saveSingleton(
            'payroll_settings',
            'payroll-default',
            [
                'singleton' => 1,
                'unit_amount' => array_key_exists('unitAmount', $params) ? $this->formatMoney($params['unitAmount']) : $current['unitAmount'],
                'counted_statuses' => $this->jsonEncode(
                    $this->normalizePayrollStatuses(
                        is_array($params['countedStatuses'] ?? null) ? $params['countedStatuses'] : $current['countedStatuses'],
                        true
                    )
                ),
            ],
            fn(): array => $this->fetchPayrollSettingsInternal()
        );
    }

    public function fetchPayrollEmployees(array $params = []): array
    {
        $currentUser = $this->auth->userFromToken(Http::bearerToken());
        $rows = $this->database->fetchAll(
            "SELECT * FROM users
             WHERE deleted_at IS NULL AND role IN ('Employee', 'Employee1')
             ORDER BY name ASC"
        );
        $employees = array_map(fn(array $row): array => $this->mapUser($row), $rows);

        if ($currentUser === null || $this->hasAdminAccess((string) ($currentUser['role'] ?? ''))) {
            return $employees;
        }

        if ($this->isEmployeeRole((string) ($currentUser['role'] ?? ''))) {
            return array_values(array_filter($employees, fn(array $employee): bool => $employee['id'] === (string) $currentUser['id']));
        }

        return [];
    }

    public function fetchPayrollHistory(array $params = []): array
    {
        $currentUser = $this->currentUser();
        if (!$this->hasAdminAccess((string) ($currentUser['role'] ?? ''))) {
            throw new RuntimeException('Payroll history is available to admins only.');
        }

        $sql = 'SELECT * FROM payroll_payments WHERE 1=1';
        $bindings = [];
        if (!empty($params['employeeId'])) {
            $sql .= ' AND employee_id = :employee_id';
            $bindings[':employee_id'] = trim((string) $params['employeeId']);
        }
        if (!empty($params['periodStart']) && !empty($params['periodEnd'])) {
            $sql .= ' AND period_start <= :period_end AND period_end >= :period_start';
            $bindings[':period_start'] = $this->normalizeDateOnly((string) $params['periodStart']);
            $bindings[':period_end'] = $this->normalizeDateOnly((string) $params['periodEnd']);
        } elseif (!empty($params['periodStart'])) {
            $sql .= ' AND period_end >= :period_start';
            $bindings[':period_start'] = $this->normalizeDateOnly((string) $params['periodStart']);
        } elseif (!empty($params['periodEnd'])) {
            $sql .= ' AND period_start <= :period_end';
            $bindings[':period_end'] = $this->normalizeDateOnly((string) $params['periodEnd']);
        }
        $sql .= ' ORDER BY paid_at DESC';

        $rows = $this->database->fetchAll($sql, $bindings);
        $users = $this->database->fetchAll('SELECT id, name, role FROM users WHERE deleted_at IS NULL');
        $userMap = $this->keyBy($users, 'id');

        return array_map(fn(array $row): array => $this->mapPayrollPayment($row, $userMap), $rows);
    }

    public function fetchPayrollSummaries(array $params): array
    {
        $currentUser = $this->currentUser();
        $periodStart = $this->normalizeDateOnly((string) ($params['periodStart'] ?? ''));
        $periodEnd = $this->normalizeDateOnly((string) ($params['periodEnd'] ?? ''));
        if ($periodStart === '' || $periodEnd === '') {
            return [];
        }

        $settings = $this->fetchPayrollSettingsInternal();
        $countedStatuses = is_array($settings['countedStatuses'] ?? null) ? $settings['countedStatuses'] : [];
        $targetEmployeeId = $this->hasAdminAccess((string) ($currentUser['role'] ?? ''))
            ? trim((string) ($params['employeeId'] ?? ''))
            : (string) $currentUser['id'];

        $employees = $this->fetchPayrollEmployees();
        if ($targetEmployeeId !== '') {
            $employees = array_values(array_filter($employees, fn(array $employee): bool => $employee['id'] === $targetEmployeeId));
        }
        if ($employees === []) {
            return [];
        }

        $employeeIds = array_map(static fn(array $employee): string => (string) $employee['id'], $employees);
        $orderCounts = $this->fetchEligibleOrderCountsByEmployeeIds($employeeIds, $countedStatuses, $periodStart, $periodEnd);

        $paymentBindings = [
            ':period_start' => $periodStart,
            ':period_end' => $periodEnd,
        ];
        $paymentSql = 'SELECT * FROM payroll_payments WHERE period_start <= :period_end AND period_end >= :period_start';
        if ($targetEmployeeId !== '') {
            $paymentSql .= ' AND employee_id = :employee_id';
            $paymentBindings[':employee_id'] = $targetEmployeeId;
        } else {
            [$paymentPlaceholders, $paymentInBindings] = $this->inClause($employeeIds, 'summary_employee');
            $paymentSql .= ' AND employee_id IN (' . implode(', ', $paymentPlaceholders) . ')';
            $paymentBindings += $paymentInBindings;
        }
        $paymentRows = $this->database->fetchAll($paymentSql, $paymentBindings);
        $employeeMap = $this->keyBy($employees, 'id');
        $paymentByEmployee = [];
        foreach ($paymentRows as $row) {
            $paymentByEmployee[(string) $row['employee_id']] = $this->mapPayrollPayment($row, $employeeMap);
        }

        $summaries = [];
        foreach ($employees as $employee) {
            $employeeId = (string) $employee['id'];
            $count = (int) ($orderCounts[$employeeId] ?? 0);
            $estimatedAmount = $count * (float) $settings['unitAmount'];
            $paymentSnapshot = $paymentByEmployee[$employeeId] ?? null;
            $summaries[] = [
                'employeeId' => $employeeId,
                'employeeName' => $employee['name'],
                'employeeRole' => $employee['role'],
                'countedOrderCount' => $count,
                'unitAmount' => (float) $settings['unitAmount'],
                'estimatedAmount' => $estimatedAmount,
                'paymentStatus' => $paymentSnapshot ? 'paid' : 'unpaid',
                'paymentSnapshot' => $paymentSnapshot,
                'liveAmountDelta' => $paymentSnapshot ? $estimatedAmount - (float) ($paymentSnapshot['amountSnapshot'] ?? 0) : 0,
                'liveOrderCountDelta' => $paymentSnapshot ? $count - (int) ($paymentSnapshot['orderCountSnapshot'] ?? 0) : 0,
            ];
        }

        usort($summaries, static function (array $left, array $right): int {
            if ($left['paymentStatus'] !== $right['paymentStatus']) {
                return $left['paymentStatus'] === 'unpaid' ? -1 : 1;
            }
            if ((float) $right['estimatedAmount'] !== (float) $left['estimatedAmount']) {
                return (float) $right['estimatedAmount'] <=> (float) $left['estimatedAmount'];
            }
            return strcmp((string) $left['employeeName'], (string) $right['employeeName']);
        });

        return $summaries;
    }

    public function markPayrollPaid(array $params): array
    {
        $currentUser = $this->currentUser();
        if (!$this->hasAdminAccess((string) ($currentUser['role'] ?? ''))) {
            throw new RuntimeException('Only admins can mark payroll as paid.');
        }

        $employeeId = trim((string) ($params['employeeId'] ?? ''));
        $periodStart = $this->normalizeDateOnly((string) ($params['periodStart'] ?? ''));
        $periodEnd = $this->normalizeDateOnly((string) ($params['periodEnd'] ?? ''));

        $overlap = $this->database->fetchOne(
            'SELECT id FROM payroll_payments
             WHERE employee_id = :employee_id AND period_start <= :period_end AND period_end >= :period_start
             LIMIT 1',
            [
                ':employee_id' => $employeeId,
                ':period_start' => $periodStart,
                ':period_end' => $periodEnd,
            ]
        );
        if ($overlap !== null) {
            throw new RuntimeException('This employee already has payroll recorded for an overlapping period.');
        }

        $id = $this->uuid4();
        $now = $this->database->nowUtc();
        $this->database->execute(
            'INSERT INTO payroll_payments (
                id, employee_id, period_start, period_end, period_kind, period_label,
                unit_amount_snapshot, counted_statuses_snapshot, order_count_snapshot, amount_snapshot,
                paid_at, paid_by, note, created_at, updated_at
            ) VALUES (
                :id, :employee_id, :period_start, :period_end, :period_kind, :period_label,
                :unit_amount_snapshot, :counted_statuses_snapshot, :order_count_snapshot, :amount_snapshot,
                :paid_at, :paid_by, :note, :created_at, :updated_at
            )',
            [
                ':id' => $id,
                ':employee_id' => $employeeId,
                ':period_start' => $periodStart,
                ':period_end' => $periodEnd,
                ':period_kind' => trim((string) ($params['periodKind'] ?? 'custom')),
                ':period_label' => trim((string) ($params['periodLabel'] ?? ($periodStart . ' - ' . $periodEnd))),
                ':unit_amount_snapshot' => $this->formatMoney($params['unitAmountSnapshot'] ?? 0),
                ':counted_statuses_snapshot' => $this->jsonEncode(
                    $this->normalizePayrollStatuses(
                        is_array($params['countedStatusesSnapshot'] ?? null) ? $params['countedStatusesSnapshot'] : [],
                        true
                    )
                ),
                ':order_count_snapshot' => (int) ($params['orderCountSnapshot'] ?? 0),
                ':amount_snapshot' => $this->formatMoney($params['amountSnapshot'] ?? 0),
                ':paid_at' => $now,
                ':paid_by' => (string) $currentUser['id'],
                ':note' => $this->nullableString($params['note'] ?? null),
                ':created_at' => $now,
                ':updated_at' => $now,
            ]
        );

        $row = $this->database->fetchOne('SELECT * FROM payroll_payments WHERE id = :id LIMIT 1', [':id' => $id]);
        $userMap = $this->keyBy([$currentUser], 'id');
        return $this->mapPayrollPayment($row ?? [], $userMap);
    }

    public function fetchWalletSettings(array $params = []): array
    {
        $payroll = $this->fetchPayrollSettingsInternal();
        return [
            'unitAmount' => (float) $payroll['unitAmount'],
            'countedStatuses' => $payroll['countedStatuses'],
        ];
    }

    public function updateWalletSettings(array $params): array
    {
        $current = $this->fetchWalletSettings();
        $nextStatuses = array_key_exists('countedStatuses', $params)
            ? $this->normalizePayrollStatuses(is_array($params['countedStatuses']) ? $params['countedStatuses'] : [], true)
            : $current['countedStatuses'];
        $shouldSync = json_encode($current['countedStatuses']) !== json_encode($nextStatuses);

        $updated = $this->updatePayrollSettings([
            'unitAmount' => $params['unitAmount'] ?? $current['unitAmount'],
            'countedStatuses' => $nextStatuses,
        ]);

        $wallet = [
            'unitAmount' => (float) $updated['unitAmount'],
            'countedStatuses' => $updated['countedStatuses'],
        ];

        if ($shouldSync) {
            $this->syncWalletCreditsForPayableStatuses($wallet);
        }

        return $wallet;
    }

    public function fetchEmployeeWalletCards(array $params = []): array
    {
        $employees = $this->fetchPayrollEmployees();
        if ($employees === []) {
            return [];
        }

        $walletSettings = $this->fetchWalletSettings();
        return $this->buildWalletCardsForEmployees($employees, $walletSettings);
    }

    public function fetchEmployeeWalletCardsPage(array $params = []): array
    {
        $employees = $this->fetchPayrollEmployees();
        $search = $this->normalizeReportSearchTerm((string) ($params['search'] ?? ''));
        $pageSize = $this->pageSize($params);
        $offset = $this->pageOffset($params);

        if ($search !== '') {
            $employees = array_values(array_filter($employees, function (array $employee) use ($search): bool {
                $haystack = implode(' ', array_filter([
                    (string) ($employee['name'] ?? ''),
                    (string) ($employee['phone'] ?? ''),
                    (string) ($employee['role'] ?? ''),
                ]));

                return str_contains($this->normalizeReportSearchTerm($haystack), $search);
            }));
        }

        if ($employees === []) {
            return [
                'data' => [],
                'count' => 0,
                'summary' => $this->summarizeWalletCards([]),
            ];
        }

        $walletSettings = $this->fetchWalletSettings();
        $cards = $this->buildWalletCardsForEmployees($employees, $walletSettings);

        return [
            'data' => array_slice($cards, $offset, $pageSize),
            'count' => count($cards),
            'summary' => $this->summarizeWalletCards($cards),
        ];
    }

    public function fetchMyWallet(array $params = []): ?array
    {
        $currentUser = $this->currentUser();
        if (!$this->isEmployeeRole((string) ($currentUser['role'] ?? ''))) {
            return [
                'employeeId' => (string) $currentUser['id'],
                'employeeName' => (string) ($currentUser['name'] ?? 'Unknown Employee'),
                'employeeRole' => (string) ($currentUser['role'] ?? 'Employee'),
                'currentBalance' => 0,
                'totalEarned' => 0,
                'totalPaid' => 0,
                'creditedOrders' => 0,
            ];
        }

        $walletSettings = $this->fetchWalletSettings();
        $employee = [
            'id' => (string) $currentUser['id'],
            'name' => (string) ($currentUser['name'] ?? 'Unknown Employee'),
            'role' => (string) ($currentUser['role'] ?? 'Employee'),
        ];
        $cards = $this->buildWalletCardsForEmployees([$employee], $walletSettings);

        return $cards[0] ?? [
            'employeeId' => (string) $currentUser['id'],
            'employeeName' => (string) ($currentUser['name'] ?? 'Unknown Employee'),
            'employeeRole' => (string) ($currentUser['role'] ?? 'Employee'),
            'currentBalance' => 0,
            'totalEarned' => 0,
            'totalPaid' => 0,
            'creditedOrders' => 0,
        ];
    }

    public function fetchWalletActivity(array $params = []): array
    {
        $currentUser = $this->currentUser();
        $targetEmployeeId = $this->hasAdminAccess((string) ($currentUser['role'] ?? ''))
            ? trim((string) ($params['employeeId'] ?? ''))
            : (string) $currentUser['id'];
        $entryTypes = is_array($params['entryTypes'] ?? null) ? $params['entryTypes'] : [];
        $where = 'WHERE 1=1';
        $bindings = [];
        if ($targetEmployeeId !== '') {
            $where .= ' AND employeeId = :employee_id';
            $bindings[':employee_id'] = $targetEmployeeId;
        }
        if ($entryTypes !== []) {
            [$placeholders, $inBindings] = $this->inClause(array_map('strval', $entryTypes), 'entry_type');
            $where .= ' AND entryType IN (' . implode(', ', $placeholders) . ')';
            $bindings += $inBindings;
        }

        $rows = $this->database->fetchAll(
            "SELECT * FROM wallet_activity_with_relations {$where} ORDER BY createdAt DESC",
            $bindings
        );
        return array_map(fn(array $row): array => $this->mapWalletActivityEntry($row), $rows);
    }

    public function fetchWalletActivityPage(array $params): array
    {
        $currentUser = $this->currentUser();
        $pageSize = $this->pageSize($params);
        $offset = $this->pageOffset($params);
        $targetEmployeeId = $this->hasAdminAccess((string) ($currentUser['role'] ?? ''))
            ? trim((string) ($params['employeeId'] ?? ''))
            : (string) $currentUser['id'];
        $entryTypes = is_array($params['entryTypes'] ?? null) ? $params['entryTypes'] : [];
        $where = 'WHERE 1=1';
        $bindings = [];
        if ($targetEmployeeId !== '') {
            $where .= ' AND employeeId = :employee_id';
            $bindings[':employee_id'] = $targetEmployeeId;
        }
        if ($entryTypes !== []) {
            [$placeholders, $inBindings] = $this->inClause(array_map('strval', $entryTypes), 'entry_type');
            $where .= ' AND entryType IN (' . implode(', ', $placeholders) . ')';
            $bindings += $inBindings;
        }

        $countRow = $this->database->fetchOne("SELECT COUNT(*) AS count FROM wallet_activity_with_relations {$where}", $bindings);
        $rows = $this->database->fetchAll(
            "SELECT * FROM wallet_activity_with_relations {$where} ORDER BY createdAt DESC LIMIT {$pageSize} OFFSET {$offset}",
            $bindings
        );

        return [
            'data' => array_map(fn(array $row): array => $this->mapWalletActivityEntry($row), $rows),
            'count' => (int) ($countRow['count'] ?? 0),
        ];
    }

    public function payEmployeeWallet(array $params): array
    {
        $currentUser = $this->currentUser();
        if (!$this->hasAdminAccess((string) ($currentUser['role'] ?? ''))) {
            throw new RuntimeException('Only admins can pay employee wallets.');
        }

        $employeeId = trim((string) ($params['employeeId'] ?? ''));
        $amount = (float) ($params['amount'] ?? 0);
        if ($amount <= 0) {
            throw new RuntimeException('Payout amount must be greater than zero.');
        }

        return $this->database->transaction(function () use ($currentUser, $employeeId, $amount, $params): array {
            $employee = $this->database->fetchOne('SELECT * FROM users WHERE id = :id LIMIT 1', [':id' => $employeeId]);
            if ($employee === null) {
                throw new RuntimeException('Employee not found.');
            }
            if (!$this->isEmployeeRole((string) ($employee['role'] ?? ''))) {
                throw new RuntimeException('Wallet payouts can only be created for employee accounts.');
            }

            $walletSettings = $this->fetchWalletSettings();
            $this->syncWalletCreditsForEmployees([$employeeId], $walletSettings);
            $walletCards = $this->buildWalletCardsForEmployees([
                [
                    'id' => $employeeId,
                    'name' => (string) ($employee['name'] ?? 'Unknown Employee'),
                    'role' => (string) ($employee['role'] ?? 'Employee'),
                ]
            ], $walletSettings);
            $walletBalance = (float) (($walletCards[0]['currentBalance'] ?? 0));
            if ($amount > $walletBalance) {
                throw new RuntimeException('Payout amount exceeds the current wallet balance.');
            }

            $account = $this->database->fetchOne(
                'SELECT id, current_balance FROM accounts WHERE id = :id LIMIT 1 FOR UPDATE',
                [':id' => trim((string) ($params['accountId'] ?? ''))]
            );
            if ($account === null) {
                throw new RuntimeException('Selected payment account was not found.');
            }
            if ($amount > (float) ($account['current_balance'] ?? 0)) {
                throw new RuntimeException('Selected account does not have enough balance.');
            }

            $payoutId = $this->uuid4();
            $transactionId = $this->uuid4();
            $createdAt = $this->database->nowUtc();
            $paidAt = $this->normalizeDateTimeInputWithCurrentLocalTime((string) ($params['paidAt'] ?? $createdAt));
            $description = 'Wallet payout to ' . (string) ($employee['name'] ?? 'Employee');

            $this->database->execute(
                'INSERT INTO transactions (
                    id, date, type, category, account_id, amount, description, reference_id,
                    payment_method, created_by, created_at, updated_at
                ) VALUES (
                    :id, :date, :type, :category, :account_id, :amount, :description, :reference_id,
                    :payment_method, :created_by, :created_at, :updated_at
                )',
                [
                    ':id' => $transactionId,
                    ':date' => $paidAt,
                    ':type' => 'Expense',
                    ':category' => trim((string) ($params['categoryId'] ?? '')),
                    ':account_id' => trim((string) ($params['accountId'] ?? '')),
                    ':amount' => $this->formatMoney($amount),
                    ':description' => $description,
                    ':reference_id' => $payoutId,
                    ':payment_method' => trim((string) ($params['paymentMethod'] ?? '')),
                    ':created_by' => (string) $currentUser['id'],
                    ':created_at' => $createdAt,
                    ':updated_at' => $createdAt,
                ]
            );

            $this->database->execute(
                'UPDATE accounts SET current_balance = current_balance - :amount, updated_at = :updated_at WHERE id = :id',
                [
                    ':amount' => $this->formatMoney($amount),
                    ':updated_at' => $this->database->nowUtc(),
                    ':id' => trim((string) ($params['accountId'] ?? '')),
                ]
            );

            $this->database->execute(
                'INSERT INTO wallet_payouts (
                    id, employee_id, amount, account_id, payment_method, category_id, transaction_id,
                    paid_at, paid_by, note, created_at, updated_at
                ) VALUES (
                    :id, :employee_id, :amount, :account_id, :payment_method, :category_id, :transaction_id,
                    :paid_at, :paid_by, :note, :created_at, :updated_at
                )',
                [
                    ':id' => $payoutId,
                    ':employee_id' => $employeeId,
                    ':amount' => $this->formatMoney($amount),
                    ':account_id' => trim((string) ($params['accountId'] ?? '')),
                    ':payment_method' => trim((string) ($params['paymentMethod'] ?? '')),
                    ':category_id' => trim((string) ($params['categoryId'] ?? '')),
                    ':transaction_id' => $transactionId,
                    ':paid_at' => $paidAt,
                    ':paid_by' => (string) $currentUser['id'],
                    ':note' => $this->nullableString($params['note'] ?? null),
                    ':created_at' => $createdAt,
                    ':updated_at' => $createdAt,
                ]
            );

            $this->insertWalletEntryRows([
                [
                    'employee_id' => $employeeId,
                    'entry_type' => 'payout',
                    'amount_delta' => -abs($amount),
                    'wallet_payout_id' => $payoutId,
                    'note' => $this->nullableString($params['note'] ?? null) ?? $description,
                    'created_at' => $createdAt,
                    'created_by' => (string) $currentUser['id'],
                ]
            ]);

            return $this->mapWalletPayout([
                'id' => $payoutId,
                'employee_id' => $employeeId,
                'amount' => $amount,
                'account_id' => trim((string) ($params['accountId'] ?? '')),
                'payment_method' => trim((string) ($params['paymentMethod'] ?? '')),
                'category_id' => trim((string) ($params['categoryId'] ?? '')),
                'transaction_id' => $transactionId,
                'paid_at' => $paidAt,
                'paid_by' => (string) $currentUser['id'],
                'paid_by_name' => (string) ($currentUser['name'] ?? ''),
                'note' => $this->nullableString($params['note'] ?? null),
            ]);
        });
    }

    public function deleteEmployeeWalletPayout(array $params): array
    {
        $currentUser = $this->currentUser();
        if (!$this->hasAdminAccess((string) ($currentUser['role'] ?? ''))) {
            throw new RuntimeException('Only admins can delete employee payouts.');
        }

        $walletEntryId = trim((string) ($params['id'] ?? ''));
        if ($walletEntryId === '') {
            throw new RuntimeException('Missing entry ID.');
        }

        return $this->database->transaction(function () use ($walletEntryId, $currentUser): array {
            $entry = $this->database->fetchOne(
                'SELECT * FROM wallet_entries WHERE id = :id FOR UPDATE',
                [':id' => $walletEntryId]
            );

            if ($entry === null) {
                return ['success' => true];
            }

            if ($entry['entry_type'] !== 'payout') {
                throw new RuntimeException('Only payouts can be deleted this way.');
            }

            $payoutId = $entry['wallet_payout_id'] ?? null;
            $transactionId = null;
            $accountId = null;
            $amount = null;

            if ($payoutId !== null) {
                $payout = $this->database->fetchOne(
                    'SELECT * FROM wallet_payouts WHERE id = :id FOR UPDATE',
                    [':id' => $payoutId]
                );
                if ($payout !== null) {
                    $transactionId = $payout['transaction_id'] ?? null;
                    $accountId = $payout['account_id'] ?? null;
                    $amount = $payout['amount'] ?? null;
                }
            }

            if ($transactionId !== null) {
                if ($accountId !== null && $amount !== null) {
                    $this->database->execute(
                        'UPDATE accounts SET current_balance = current_balance + :amount, updated_at = :updated_at WHERE id = :id',
                        [
                            ':amount' => $amount,
                            ':updated_at' => $this->database->nowUtc(),
                            ':id' => $accountId,
                        ]
                    );
                }

                $this->database->execute('DELETE FROM transactions WHERE id = :id', [':id' => $transactionId]);
            }

            if ($payoutId !== null) {
                $this->database->execute('DELETE FROM wallet_payouts WHERE id = :id', [':id' => $payoutId]);
            }

            $this->database->execute('DELETE FROM wallet_entries WHERE id = :id', [':id' => $walletEntryId]);

            return ['success' => true];
        });
    }

    private function buildRecycleBinItems(): array
    {
        $users = $this->keyBy($this->database->fetchAll('SELECT id, name, phone, role FROM users'), 'id');
        $customers = $this->keyBy($this->database->fetchAll('SELECT id, name, phone FROM customers'), 'id');
        $vendors = $this->keyBy($this->database->fetchAll('SELECT id, name, phone FROM vendors'), 'id');
        $accounts = $this->keyBy($this->database->fetchAll('SELECT id, name FROM accounts'), 'id');

        $deletedCustomers = $this->database->fetchAll(
            'SELECT id, name, phone, address, total_orders, due_amount, created_at, created_by, deleted_at, deleted_by
             FROM customers WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
        );
        $deletedOrders = $this->database->fetchAll(
            'SELECT id, order_number, order_date, customer_id, created_by, status, total, created_at, deleted_at, deleted_by
             FROM orders WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
        );
        $deletedBills = $this->database->fetchAll(
            'SELECT id, bill_number, bill_date, vendor_id, created_by, status, total, created_at, deleted_at, deleted_by
             FROM bills WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
        );
        $deletedTransactions = $this->database->fetchAll(
            'SELECT id, date, type, category, account_id, to_account_id, amount, description, reference_id, contact_id, payment_method, created_by, deleted_at, deleted_by, created_at
             FROM transactions WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
        );
        $deletedUsers = $this->database->fetchAll(
            'SELECT id, name, phone, role, created_at, deleted_at, deleted_by FROM users WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
        );
        $deletedVendors = $this->database->fetchAll(
            'SELECT id, name, phone, address, total_purchases, due_amount, created_at, created_by, deleted_at, deleted_by
             FROM vendors WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
        );
        $deletedProducts = $this->database->fetchAll(
            'SELECT id, name, category, stock, created_at, created_by, deleted_at, deleted_by
             FROM products WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
        );

        $items = [];

        foreach ($deletedCustomers as $row) {
            $items[] = [
                'id' => (string) $row['id'],
                'entityType' => 'customer',
                'title' => (string) ($row['name'] ?? 'Unnamed Customer'),
                'description' => implode(' • ', array_values(array_filter([(string) ($row['phone'] ?? ''), (string) ($row['address'] ?? '')]))),
                'details' => [
                    'Orders: ' . (int) ($row['total_orders'] ?? 0),
                    'Due: ' . (float) ($row['due_amount'] ?? 0),
                ],
                'deletedAt' => $this->toIso($row['deleted_at'] ?? null) ?? (string) ($row['deleted_at'] ?? ''),
                'deletedBy' => $this->nullableString($row['deleted_by'] ?? null),
                'deletedByName' => $users[(string) ($row['deleted_by'] ?? '')]['name'] ?? null,
                'createdAt' => $this->toIso($row['created_at'] ?? null),
                'createdBy' => $this->nullableString($row['created_by'] ?? null),
                'createdByName' => $users[(string) ($row['created_by'] ?? '')]['name'] ?? null,
                'amount' => (float) ($row['due_amount'] ?? 0),
            ];
        }

        foreach ($deletedOrders as $row) {
            $customer = $customers[(string) ($row['customer_id'] ?? '')] ?? null;
            $items[] = [
                'id' => (string) $row['id'],
                'entityType' => 'order',
                'title' => (string) ($row['order_number'] ?? $row['id']),
                'description' => implode(' • ', array_values(array_filter([(string) ($customer['name'] ?? ''), (string) ($customer['phone'] ?? '')]))),
                'details' => array_values(array_filter([
                    !empty($row['order_date']) ? 'Order Date: ' . (string) $row['order_date'] : '',
                    !empty($row['status']) ? 'Status: ' . (string) $row['status'] : '',
                ])),
                'deletedAt' => $this->toIso($row['deleted_at'] ?? null) ?? (string) ($row['deleted_at'] ?? ''),
                'deletedBy' => $this->nullableString($row['deleted_by'] ?? null),
                'deletedByName' => $users[(string) ($row['deleted_by'] ?? '')]['name'] ?? null,
                'createdAt' => $this->toIso($row['created_at'] ?? null),
                'createdBy' => $this->nullableString($row['created_by'] ?? null),
                'createdByName' => $users[(string) ($row['created_by'] ?? '')]['name'] ?? null,
                'status' => $this->nullableString($row['status'] ?? null),
                'amount' => (float) ($row['total'] ?? 0),
            ];
        }

        foreach ($deletedBills as $row) {
            $vendor = $vendors[(string) ($row['vendor_id'] ?? '')] ?? null;
            $items[] = [
                'id' => (string) $row['id'],
                'entityType' => 'bill',
                'title' => (string) ($row['bill_number'] ?? $row['id']),
                'description' => implode(' • ', array_values(array_filter([(string) ($vendor['name'] ?? ''), (string) ($vendor['phone'] ?? '')]))),
                'details' => array_values(array_filter([
                    !empty($row['bill_date']) ? 'Bill Date: ' . (string) $row['bill_date'] : '',
                    !empty($row['status']) ? 'Status: ' . (string) $row['status'] : '',
                ])),
                'deletedAt' => $this->toIso($row['deleted_at'] ?? null) ?? (string) ($row['deleted_at'] ?? ''),
                'deletedBy' => $this->nullableString($row['deleted_by'] ?? null),
                'deletedByName' => $users[(string) ($row['deleted_by'] ?? '')]['name'] ?? null,
                'createdAt' => $this->toIso($row['created_at'] ?? null),
                'createdBy' => $this->nullableString($row['created_by'] ?? null),
                'createdByName' => $users[(string) ($row['created_by'] ?? '')]['name'] ?? null,
                'status' => $this->nullableString($row['status'] ?? null),
                'amount' => (float) ($row['total'] ?? 0),
            ];
        }

        foreach ($deletedTransactions as $row) {
            $contact = $customers[(string) ($row['contact_id'] ?? '')] ?? $vendors[(string) ($row['contact_id'] ?? '')] ?? null;
            $account = $accounts[(string) ($row['account_id'] ?? '')] ?? null;
            $toAccount = $accounts[(string) ($row['to_account_id'] ?? '')] ?? null;
            $items[] = [
                'id' => (string) $row['id'],
                'entityType' => 'transaction',
                'title' => (string) ($row['description'] ?? (($row['type'] ?? 'Transaction') . ' Transaction')),
                'description' => implode(' • ', array_values(array_filter([(string) ($row['type'] ?? ''), (string) ($row['category'] ?? ''), (string) ($account['name'] ?? '')]))),
                'details' => array_values(array_filter([
                    (string) ($contact['name'] ?? ''),
                    !empty($toAccount['name']) ? 'To: ' . (string) $toAccount['name'] : '',
                    !empty($row['date']) ? 'Date: ' . (string) $row['date'] : '',
                    !empty($row['payment_method']) ? 'Method: ' . (string) $row['payment_method'] : '',
                ])),
                'deletedAt' => $this->toIso($row['deleted_at'] ?? null) ?? (string) ($row['deleted_at'] ?? ''),
                'deletedBy' => $this->nullableString($row['deleted_by'] ?? null),
                'deletedByName' => $users[(string) ($row['deleted_by'] ?? '')]['name'] ?? null,
                'createdAt' => $this->toIso($row['date'] ?? $row['created_at'] ?? null),
                'createdBy' => $this->nullableString($row['created_by'] ?? null),
                'createdByName' => $users[(string) ($row['created_by'] ?? '')]['name'] ?? null,
                'status' => $this->nullableString($row['type'] ?? null),
                'amount' => (float) ($row['amount'] ?? 0),
            ];
        }

        foreach ($deletedUsers as $row) {
            $items[] = [
                'id' => (string) $row['id'],
                'entityType' => 'user',
                'title' => (string) ($row['name'] ?? 'Unnamed User'),
                'description' => implode(' • ', array_values(array_filter([(string) ($row['role'] ?? ''), (string) ($row['phone'] ?? '')]))),
                'details' => array_values(array_filter([
                    !empty($row['created_at']) ? 'Created: ' . substr((string) $row['created_at'], 0, 10) : '',
                ])),
                'deletedAt' => $this->toIso($row['deleted_at'] ?? null) ?? (string) ($row['deleted_at'] ?? ''),
                'deletedBy' => $this->nullableString($row['deleted_by'] ?? null),
                'deletedByName' => $users[(string) ($row['deleted_by'] ?? '')]['name'] ?? null,
                'createdAt' => $this->toIso($row['created_at'] ?? null),
                'status' => $this->nullableString($row['role'] ?? null),
            ];
        }

        foreach ($deletedVendors as $row) {
            $items[] = [
                'id' => (string) $row['id'],
                'entityType' => 'vendor',
                'title' => (string) ($row['name'] ?? 'Unnamed Vendor'),
                'description' => implode(' • ', array_values(array_filter([(string) ($row['phone'] ?? ''), (string) ($row['address'] ?? '')]))),
                'details' => [
                    'Purchases: ' . (int) ($row['total_purchases'] ?? 0),
                    'Due: ' . (float) ($row['due_amount'] ?? 0),
                ],
                'deletedAt' => $this->toIso($row['deleted_at'] ?? null) ?? (string) ($row['deleted_at'] ?? ''),
                'deletedBy' => $this->nullableString($row['deleted_by'] ?? null),
                'deletedByName' => $users[(string) ($row['deleted_by'] ?? '')]['name'] ?? null,
                'createdAt' => $this->toIso($row['created_at'] ?? null),
                'createdBy' => $this->nullableString($row['created_by'] ?? null),
                'createdByName' => $users[(string) ($row['created_by'] ?? '')]['name'] ?? null,
                'amount' => (float) ($row['due_amount'] ?? 0),
            ];
        }

        foreach ($deletedProducts as $row) {
            $items[] = [
                'id' => (string) $row['id'],
                'entityType' => 'product',
                'title' => (string) ($row['name'] ?? 'Unnamed Product'),
                'description' => (string) ($row['category'] ?? 'Uncategorized'),
                'details' => ['Stock: ' . (int) ($row['stock'] ?? 0)],
                'deletedAt' => $this->toIso($row['deleted_at'] ?? null) ?? (string) ($row['deleted_at'] ?? ''),
                'deletedBy' => $this->nullableString($row['deleted_by'] ?? null),
                'deletedByName' => $users[(string) ($row['deleted_by'] ?? '')]['name'] ?? null,
                'createdAt' => $this->toIso($row['created_at'] ?? null),
                'createdBy' => $this->nullableString($row['created_by'] ?? null),
                'createdByName' => $users[(string) ($row['created_by'] ?? '')]['name'] ?? null,
            ];
        }

        usort($items, static function (array $left, array $right): int {
            return strtotime((string) ($right['deletedAt'] ?? '')) <=> strtotime((string) ($left['deletedAt'] ?? ''));
        });

        return $items;
    }

    /**
     * @param array<int, array<string, mixed>> $items
     * @return array<int, array<string, mixed>>
     */
    private function filterRecycleBinItems(array $items, string $search, string $entityType): array
    {
        if ($search === '' && ($entityType === '' || $entityType === 'all')) {
            return $items;
        }

        return array_values(array_filter($items, function (array $item) use ($search, $entityType): bool {
            if ($entityType !== '' && $entityType !== 'all' && (string) ($item['entityType'] ?? '') !== $entityType) {
                return false;
            }

            if ($search === '') {
                return true;
            }

            $haystack = implode(' ', array_filter([
                (string) ($item['title'] ?? ''),
                (string) ($item['description'] ?? ''),
                (string) ($item['deletedByName'] ?? ''),
                (string) ($item['createdByName'] ?? ''),
                (string) ($item['status'] ?? ''),
                implode(' ', is_array($item['details'] ?? null) ? $item['details'] : []),
            ]));

            return str_contains($this->normalizeReportSearchTerm($haystack), $search);
        }));
    }

    public function fetchRecycleBinItems(array $params = []): array
    {
        $this->requireAdmin();
        return $this->buildRecycleBinItems();
    }

    public function fetchRecycleBinPage(array $params = []): array
    {
        $this->requireAdmin();

        $pageSize = $this->pageSize($params);
        $offset = $this->pageOffset($params);
        $search = $this->normalizeReportSearchTerm((string) ($params['search'] ?? ''));
        $entityType = trim((string) ($params['entityType'] ?? 'all'));
        $items = $this->filterRecycleBinItems($this->buildRecycleBinItems(), $search, $entityType);

        return [
            'data' => array_slice($items, $offset, $pageSize),
            'count' => count($items),
        ];
    }

    public function restoreDeletedItem(array $params): array
    {
        $this->requireAdmin();
        $entityType = trim((string) ($params['entityType'] ?? ''));
        $id = trim((string) ($params['id'] ?? ''));

        return $this->database->transaction(function () use ($entityType, $id): array {
            if ($entityType === 'customer') {
                $this->restoreSoftDeletedRow('customers', $id);
                return ['success' => true];
            }

            if ($entityType === 'order') {
                $orderRow = $this->database->fetchOne(
                    'SELECT * FROM orders WHERE id = :id AND deleted_at IS NOT NULL LIMIT 1 FOR UPDATE',
                    [':id' => $id]
                );
                if ($orderRow === null) {
                    throw new RuntimeException('Deleted order not found.');
                }
                $relatedTransactions = $this->fetchOrderLinkedTransactionRows($id, (string) ($orderRow['order_number'] ?? ''), 'deleted');
                $this->restoreSoftDeletedRow('orders', $id);
                $this->restoreTransactionRowsByIds(array_map(static fn(array $row): string => (string) $row['id'], $relatedTransactions));
                $this->applyTransactionAccountEffect($relatedTransactions, 'apply');
                $this->syncWalletCreditForOrder([
                    'id' => $id,
                    'createdBy' => (string) ($orderRow['created_by'] ?? ''),
                    'status' => (string) ($orderRow['status'] ?? 'On Hold'),
                    'orderNumber' => (string) ($orderRow['order_number'] ?? ''),
                    'orderDate' => (string) ($orderRow['order_date'] ?? ''),
                    'createdAt' => $this->toIso($orderRow['created_at'] ?? null),
                ]);
                $this->syncCustomerOrderSummaries([(string) ($orderRow['customer_id'] ?? '')]);
                return ['success' => true];
            }

            if ($entityType === 'bill') {
                $billRow = $this->database->fetchOne(
                    'SELECT * FROM bills WHERE id = :id AND deleted_at IS NOT NULL LIMIT 1 FOR UPDATE',
                    [':id' => $id]
                );
                if ($billRow === null) {
                    throw new RuntimeException('Deleted bill not found.');
                }
                $relatedTransactions = $this->fetchBillLinkedTransactionRows($id, 'deleted');
                $this->restoreSoftDeletedRow('bills', $id);
                $this->restoreTransactionRowsByIds(array_map(static fn(array $row): string => (string) $row['id'], $relatedTransactions));
                $this->applyTransactionAccountEffect($relatedTransactions, 'apply');
                $this->syncVendorPurchaseSummaries([(string) ($billRow['vendor_id'] ?? '')]);
                return ['success' => true];
            }

            if ($entityType === 'transaction') {
                $row = $this->database->fetchOne(
                    'SELECT id, type, account_id, to_account_id, amount, account_effect_applied
                     FROM transactions
                     WHERE id = :id AND deleted_at IS NOT NULL
                     LIMIT 1 FOR UPDATE',
                    [':id' => $id]
                );
                if ($row === null) {
                    throw new RuntimeException('Deleted transaction not found.');
                }
                $this->restoreTransactionRowsByIds([$id]);
                $this->applyTransactionAccountEffect([$row], 'apply');
                return ['success' => true];
            }

            if ($entityType === 'user') {
                $this->restoreSoftDeletedRow('users', $id);
                return ['success' => true];
            }

            if ($entityType === 'vendor') {
                $this->restoreSoftDeletedRow('vendors', $id);
                return ['success' => true];
            }

            if ($entityType === 'product') {
                $this->restoreSoftDeletedRow('products', $id);
                return ['success' => true];
            }

            throw new RuntimeException('Unsupported recycle bin item type.');
        });
    }

    public function permanentlyDeleteDeletedItem(array $params): array
    {
        $this->requireAdmin();
        $entityType = trim((string) ($params['entityType'] ?? ''));
        $id = trim((string) ($params['id'] ?? ''));

        return $this->database->transaction(function () use ($entityType, $id): array {
            if ($entityType === 'customer') {
                $this->permanentlyDeleteSoftDeletedRow('customers', $id);
                return ['success' => true];
            }

            if ($entityType === 'order') {
                $orderRow = $this->database->fetchOne(
                    'SELECT * FROM orders WHERE id = :id AND deleted_at IS NOT NULL LIMIT 1 FOR UPDATE',
                    [':id' => $id]
                );
                if ($orderRow === null) {
                    throw new RuntimeException('Deleted order not found.');
                }
                $relatedTransactions = $this->fetchOrderLinkedTransactionRows($id, (string) ($orderRow['order_number'] ?? ''), 'deleted');
                $this->permanentlyDeleteTransactionRowsByIds(array_map(static fn(array $row): string => (string) $row['id'], $relatedTransactions));
                $this->permanentlyDeleteSoftDeletedRow('orders', $id);
                $this->syncCustomerOrderSummaries([(string) ($orderRow['customer_id'] ?? '')]);
                return ['success' => true];
            }

            if ($entityType === 'bill') {
                $billRow = $this->database->fetchOne(
                    'SELECT * FROM bills WHERE id = :id AND deleted_at IS NOT NULL LIMIT 1 FOR UPDATE',
                    [':id' => $id]
                );
                if ($billRow === null) {
                    throw new RuntimeException('Deleted bill not found.');
                }
                $relatedTransactions = $this->fetchBillLinkedTransactionRows($id, 'deleted');
                $this->permanentlyDeleteTransactionRowsByIds(array_map(static fn(array $row): string => (string) $row['id'], $relatedTransactions));
                $this->permanentlyDeleteSoftDeletedRow('bills', $id);
                $this->syncVendorPurchaseSummaries([(string) ($billRow['vendor_id'] ?? '')]);
                return ['success' => true];
            }

            if ($entityType === 'transaction') {
                $this->permanentlyDeleteTransactionRowsByIds([$id]);
                return ['success' => true];
            }

            if ($entityType === 'user') {
                $this->permanentlyDeleteSoftDeletedRow('users', $id);
                return ['success' => true];
            }

            if ($entityType === 'vendor') {
                $this->permanentlyDeleteSoftDeletedRow('vendors', $id);
                return ['success' => true];
            }

            if ($entityType === 'product') {
                $this->permanentlyDeleteSoftDeletedRow('products', $id);
                return ['success' => true];
            }

            throw new RuntimeException('Unsupported recycle bin item type.');
        });
    }

    /**
     * Look up a single order by its full order_number (e.g. "ORD-123").
     */
    public function fetchOrderByNumber(array $params): ?array
    {
        $orderNumber = trim((string) ($params['orderNumber'] ?? ''));
        if ($orderNumber === '') {
            return null;
        }

        $row = $this->database->fetchOne(
            'SELECT * FROM orders_with_customer_creator WHERE orderNumber = :order_number AND deletedAt IS NULL LIMIT 1',
            [':order_number' => $orderNumber]
        );

        return $row !== null ? $this->mapOrder($row) : null;
    }

    /**
     * Atomically revert an order from its current status to a prior status,
     * undoing every side-effect produced by the forward transition(s).
     *
     * Side-effects reversed:
     *  1. Linked transactions  → soft-deleted + account balances reverted
     *  2. Wallet entries       → credit/reversal rows cleaned up
     *  3. Product stock        → re-computed via applyOrderStockTransition
     *  4. Order paid_amount    → reset to 0 (pre-completion value)
     *  5. History keys         → completion/return/payment stamps removed
     *  6. Customer summaries   → re-synced
     */
    public function revertOrderStatus(array $params): array
    {
        $actor = $this->currentUser();
        $hasPermission = $this->currentUserHasPermission('orders.markCompletedOwn')
            || $this->currentUserHasPermission('orders.markCompletedAny')
            || $this->currentUserHasPermission('orders.markReturnedOwn')
            || $this->currentUserHasPermission('orders.markReturnedAny');
        if (!$hasPermission) {
            throw new RuntimeException('You do not have permission to revert order statuses.');
        }

        $orderId = trim((string) ($params['orderId'] ?? ''));
        $targetStatus = trim((string) ($params['targetStatus'] ?? ''));
        if ($orderId === '') {
            throw new RuntimeException('Order id is required.');
        }
        if ($targetStatus === '') {
            throw new RuntimeException('Target status is required.');
        }

        $statusOrder = ['On Hold', 'Processing', 'Picked', 'Completed', 'Returned', 'Cancelled'];

        if (!in_array($targetStatus, $statusOrder, true)) {
            throw new RuntimeException('Invalid target status.');
        }

        return $this->database->transaction(function () use ($actor, $orderId, $targetStatus, $statusOrder): array {
            $orderRow = $this->database->fetchOne(
                'SELECT * FROM orders WHERE id = :id AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
                [':id' => $orderId]
            );

            if ($orderRow === null) {
                throw new RuntimeException('Order not found.');
            }

            $currentStatus = trim((string) ($orderRow['status'] ?? ''));
            $currentIndex = array_search($currentStatus, $statusOrder, true);
            $targetIndex = array_search($targetStatus, $statusOrder, true);

            if ($currentIndex === false) {
                throw new RuntimeException('Current order status is unrecognised: ' . $currentStatus);
            }
            if ($targetIndex === false) {
                throw new RuntimeException('Target status is unrecognised.');
            }

            // "Returned" and "Cancelled" are terminal; treat them at position 4/5 for comparison.
            // For reverting, we just need the target to be strictly before the current.
            if ($currentStatus === 'Returned' || $currentStatus === 'Cancelled') {
                // These are terminal statuses – allow reverting to anything before them
            } elseif ($targetIndex >= $currentIndex) {
                throw new RuntimeException('Target status must be prior to the current status.');
            }

            $orderNumber = trim((string) ($orderRow['order_number'] ?? ''));
            $customerId = trim((string) ($orderRow['customer_id'] ?? ''));
            $previousItems = $this->jsonDecodeList($orderRow['items'] ?? []);

            // ─── 1. Reverse linked transactions (soft-delete + revert account balances) ───
            $linkedTransactions = $this->fetchOrderLinkedTransactionRows($orderId, $orderNumber, 'active');
            if ($linkedTransactions !== []) {
                $this->applyTransactionAccountEffect($linkedTransactions, 'revert');
                $deletedAt = $this->database->nowUtc();
                $this->softDeleteTransactionRowsByIds(
                    array_map(static fn(array $row): string => (string) $row['id'], $linkedTransactions),
                    $deletedAt,
                    (string) $actor['id']
                );
            }

            // ─── 2. Reverse wallet entries ───
            $this->revertWalletEntriesForOrder($orderId);

            // ─── 3. Reverse product stock ───
            $stockUpdates = $this->applyOrderStockTransition($currentStatus, $targetStatus, $previousItems, $previousItems);
            $this->applyResolvedProductStockUpdates($stockUpdates);

            // ─── 4. Build updated order payload ───
            $history = $this->jsonDecodeAssoc($orderRow['history'] ?? []);

            // Remove history keys that were set during completion/return
            $keysToRemove = [];
            if (in_array($currentStatus, ['Completed', 'Returned'], true)) {
                $keysToRemove = array_merge($keysToRemove, ['completed', 'payment', 'returned']);
            }

            // If reverting past Picked, remove picked key
            $targetIdx = array_search($targetStatus, ['On Hold', 'Processing', 'Picked', 'Completed', 'Returned', 'Cancelled'], true);
            if ($targetIdx !== false && $targetIdx < 2) {
                // Reverting to On Hold or Processing – remove picked
                $keysToRemove[] = 'picked';
            }
            if ($targetIdx !== false && $targetIdx < 1) {
                // Reverting to On Hold – remove processing
                $keysToRemove[] = 'processing';
            }

            foreach (array_unique($keysToRemove) as $key) {
                unset($history[$key]);
            }

            // Add an undo audit trail entry
            $localNow = (new \DateTimeImmutable($this->database->nowUtc(), new \DateTimeZone('UTC')))
                ->setTimezone(new \DateTimeZone($this->config->timezone()));
            $history['undone'] = sprintf(
                'Status reverted from %s to %s by %s on %s at %s.',
                $currentStatus,
                $targetStatus,
                trim((string) ($actor['name'] ?? 'System')),
                $localNow->format('j M Y'),
                $localNow->format('H:i')
            );

            $payload = [
                'status' => $targetStatus,
                'history' => $this->jsonEncode($history),
            ];

            // Reset paid_amount if we're reverting away from Completed/Returned
            if (in_array($currentStatus, ['Completed', 'Returned'], true)) {
                $payload['paid_amount'] = $this->formatMoney(0);
            }

            $this->touchUpdate('orders', $orderId, $payload);

            // ─── 5. Re-sync customer summaries ───
            $this->syncCustomerOrderSummaries([$customerId]);

            // ─── 6. Re-sync wallet credit for order (target status) ───
            $updatedRow = $this->database->fetchOne(
                'SELECT * FROM orders WHERE id = :id LIMIT 1',
                [':id' => $orderId]
            );
            if ($updatedRow !== null) {
                $this->syncWalletCreditForOrder([
                    'id' => $orderId,
                    'createdBy' => (string) ($updatedRow['created_by'] ?? ''),
                    'status' => $targetStatus,
                    'orderNumber' => $orderNumber,
                    'orderDate' => (string) ($updatedRow['order_date'] ?? ''),
                    'createdAt' => $this->toIso($updatedRow['created_at'] ?? null),
                ]);
            }

            // ─── 7. Return the refreshed mapped order ───
            $finalRow = $this->fetchOrderRowById($orderId);
            if ($finalRow === null) {
                throw new RuntimeException('Reverted order could not be loaded.');
            }

            return $this->mapOrder($finalRow);
        });
    }

    /**
     * Remove all wallet entries (credits + reversals) for an order so the
     * wallet state can be cleanly re-evaluated by syncWalletCreditForOrder.
     */
    private function revertWalletEntriesForOrder(string $orderId): void
    {
        if (!$this->tableExists('wallet_entries')) {
            return;
        }

        $entries = $this->database->fetchAll(
            "SELECT id FROM wallet_entries WHERE source_order_id = :order_id",
            [':order_id' => $orderId]
        );

        if ($entries === []) {
            return;
        }

        $ids = array_map(static fn(array $row): string => (string) $row['id'], $entries);
        $this->deleteWalletEntryRows($ids);
    }
}
