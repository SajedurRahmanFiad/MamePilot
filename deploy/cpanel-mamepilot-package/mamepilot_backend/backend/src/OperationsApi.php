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

    /**
     * @return array{remainingExistingSubtotal: float, newSubtotal: float, newDiscount: float, newTotal: float, maxRefund: float, maxCollection: float}
     */
    private function calculateReturnAdjustment(
        float $subtotal,
        float $discount,
        float $shipping,
        float $paidAmount,
        float $returnValue,
        float $replacementValue = 0.0,
        ?float $discountEligibleSubtotal = null,
        ?float $discountEligibleReturnValue = null
    ): array {
        $safeSubtotal = max(0.0, $subtotal);
        $safeReturnValue = min($safeSubtotal, max(0.0, $returnValue));
        $safeDiscountEligibleSubtotal = min(
            $safeSubtotal,
            max(0.0, $discountEligibleSubtotal ?? $safeSubtotal)
        );
        $safeDiscountEligibleReturnValue = min(
            $safeDiscountEligibleSubtotal,
            max(0.0, $discountEligibleReturnValue ?? $safeReturnValue)
        );
        $remainingExistingSubtotal = max(0.0, $safeSubtotal - $safeReturnValue);
        $remainingDiscountEligibleSubtotal = max(0.0, $safeDiscountEligibleSubtotal - $safeDiscountEligibleReturnValue);
        $remainingRatio = $safeDiscountEligibleSubtotal > 0
            ? $remainingDiscountEligibleSubtotal / $safeDiscountEligibleSubtotal
            : 0.0;
        $newDiscount = round(max(0.0, $discount) * $remainingRatio, 2);
        $newSubtotal = round($remainingExistingSubtotal + max(0.0, $replacementValue), 2);
        $newTotal = round(max(0.0, $newSubtotal - $newDiscount + max(0.0, $shipping)), 2);

        return [
            'remainingExistingSubtotal' => round($remainingExistingSubtotal, 2),
            'newSubtotal' => $newSubtotal,
            'newDiscount' => $newDiscount,
            'newTotal' => $newTotal,
            'maxRefund' => round(max(0.0, max(0.0, $paidAmount) - $newTotal), 2),
            'maxCollection' => round(max(0.0, $newTotal - max(0.0, $paidAmount)), 2),
        ];
    }

    private function appendHistoryText(string $existing, string $event): string
    {
        $existing = trim($existing);
        $event = trim($event);
        if ($existing === '') return $event;
        if ($event === '') return $existing;
        return $existing . "\n" . $event;
    }

    /** @return array{0: string, 1: bool} */
    private function decodeEncodedTextFilterValue(string $value): array
    {
        $prefix = '__mp_filter_v1__:';
        if (str_starts_with($value, $prefix)) {
            $payload = substr($value, strlen($prefix));
            $separator = strpos($payload, ':');
            $mode = $separator === false ? '' : substr($payload, 0, $separator);
            if ($separator !== false && in_array($mode, ['equals', 'contains'], true)) {
                return [rawurldecode(substr($payload, $separator + 1)), $mode === 'contains'];
            }
        }

        // Backward compatibility for navigation state created before tagged filters.
        $contains = strlen($value) >= 2 && str_starts_with($value, '%') && str_ends_with($value, '%');
        return [$contains ? substr($value, 1, -1) : $value, $contains];
    }

    private function appendEncodedTextFilter(
        string &$where,
        array &$bindings,
        string $column,
        string $value,
        string $bindingName,
        bool $negative = false
    ): void {
        if ($value === '') return;

        [$value, $contains] = $this->decodeEncodedTextFilterValue($value);
        if (!$contains) {
            $where .= " AND COALESCE({$column}, '') " . ($negative ? '<>' : '=') . " :{$bindingName}";
            $bindings[':' . $bindingName] = $value;
            return;
        }

        $escaped = str_replace(['=', '%', '_'], ['==', '=%', '=_'], $value);
        $where .= " AND COALESCE({$column}, '') " . ($negative ? 'NOT LIKE' : 'LIKE') . " :{$bindingName} ESCAPE '='";
        $bindings[':' . $bindingName] = '%' . $escaped . '%';
    }

    /** @param array<int, array<string, mixed>> $items */
    private function validateDocumentAmounts(array $params, array $items, string $documentLabel): void
    {
        if ($items === []) {
            throw new RuntimeException("{$documentLabel} must contain at least one item.");
        }
        $calculatedSubtotal = 0.0;
        foreach ($items as $item) {
            $productId = trim((string) ($item['productId'] ?? ''));
            $quantity = (int) ($item['quantity'] ?? 0);
            $rate = round((float) ($item['rate'] ?? 0), 2);
            $amount = round((float) ($item['amount'] ?? ($rate * $quantity)), 2);
            if ($productId === '' || $quantity <= 0 || $rate < 0) {
                throw new RuntimeException("{$documentLabel} items require a product, a positive quantity, and a non-negative rate.");
            }
            if (abs($amount - round($rate * $quantity, 2)) > 0.01) {
                throw new RuntimeException("{$documentLabel} item amount does not match rate × quantity.");
            }
            $calculatedSubtotal += $amount;
        }
        $calculatedSubtotal = round($calculatedSubtotal, 2);
        $submittedSubtotal = round((float) ($params['subtotal'] ?? 0), 2);
        $discount = round((float) ($params['discount'] ?? 0), 2);
        $shipping = round((float) ($params['shipping'] ?? 0), 2);
        $submittedTotal = round((float) ($params['total'] ?? 0), 2);
        $expectedTotal = round(max(0.0, $calculatedSubtotal - $discount + $shipping), 2);
        if (abs($submittedSubtotal - $calculatedSubtotal) > 0.01) {
            throw new RuntimeException("{$documentLabel} subtotal does not match its items.");
        }
        if ($discount < 0 || $discount > $calculatedSubtotal) {
            throw new RuntimeException("{$documentLabel} discount must be between zero and the subtotal.");
        }
        if ($shipping < 0 || abs($submittedTotal - $expectedTotal) > 0.01) {
            throw new RuntimeException("{$documentLabel} total is invalid.");
        }
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
            || (
                (array_key_exists('pathaoConsignmentId', $updates) || array_key_exists('pathao_consignment_id', $updates))
                && $this->nullableString($updates['pathaoConsignmentId'] ?? $updates['pathao_consignment_id'] ?? null)
                !== $this->nullableString($existingRow['pathao_consignment_id'] ?? null)
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

        if (($nextStatus !== $previousStatus && ($nextStatus === 'Completed' || $nextStatus === 'Exchange delivered')) || $completedChanged || $paymentChanged) {
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
        $returnedChanged = $this->historyValue($nextHistory, 'returned') !== $this->historyValue($existingHistory, 'returned');
        $cancelledChanged = $this->historyValue($nextHistory, 'cancelled') !== $this->historyValue($existingHistory, 'cancelled');
        $paidChanged = $this->historyValue($nextHistory, 'paid') !== $this->historyValue($existingHistory, 'paid');
        $refundChanged = $this->historyValue($nextHistory, 'refund') !== $this->historyValue($existingHistory, 'refund');

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

        if (($nextStatus !== $previousStatus && $nextStatus === 'Returned') || $returnedChanged) {
            $this->assertUserCanManageBillRecord(
                $user,
                $existingRow,
                'bills.markReceivedOwn',
                'bills.markReceivedAny',
                'You do not have permission to mark this bill as returned.'
            );
        }

        if (($nextStatus !== $previousStatus && $nextStatus === 'Cancelled') || $cancelledChanged) {
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
            || $refundChanged
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
            && $this->encodeComparableJson($this->filteredHistoryForComparison($nextHistory, ['processing', 'received', 'returned', 'cancelled', 'paid', 'refund']))
            !== $this->encodeComparableJson($this->filteredHistoryForComparison($existingHistory, ['processing', 'received', 'returned', 'cancelled', 'paid', 'refund']))
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
        $next = $this->nextAvailableOrderSequence($prefix, max($nextNumber, $maxSeq + 1));
        return $prefix . $next;
    }

    private function nextBillNumberPreview(): string
    {
        $maxSeqRow = $this->database->fetchOne('SELECT COALESCE(MAX(bill_seq), 0) AS max_seq FROM bills');
        $next = $this->nextAvailableBillSequence(((int) ($maxSeqRow['max_seq'] ?? 0)) + 1);
        return 'Bill-' . $next;
    }

    private function nextAvailableOrderSequence(string $prefix, int $candidate): int
    {
        $next = max(1, $candidate);
        while ($this->database->fetchOne(
            'SELECT id FROM orders WHERE order_number = :order_number LIMIT 1',
            [':order_number' => $prefix . $next]
        ) !== null) {
            $next++;
        }

        return $next;
    }

    private function nextAvailableBillSequence(int $candidate): int
    {
        $next = max(1, $candidate);
        while ($this->database->fetchOne(
            'SELECT id FROM bills WHERE bill_number = :bill_number LIMIT 1',
            [':bill_number' => 'Bill-' . $next]
        ) !== null) {
            $next++;
        }

        return $next;
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
        $prefix = (string) ($settings['prefix'] ?? 'ORD-');
        $next = $this->nextAvailableOrderSequence($prefix, max((int) ($settings['next_number'] ?? 1), $maxSeq + 1));
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
        $next = $this->nextAvailableBillSequence(((int) ($maxSeqRow['max_seq'] ?? 0)) + 1);
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
        return $this->database->fetchOne(
            'SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, u.name AS creator_name
             FROM orders o
             LEFT JOIN customers c ON c.id = o.customer_id
             LEFT JOIN users u ON u.id = o.created_by
             WHERE o.id = :id AND o.deleted_at IS NULL
             LIMIT 1',
            [':id' => $id]
        );
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

        // Support exclusion filter from frontend: statusNot
        $statusNot = trim((string) ($filters['statusNot'] ?? ''));
        if ($statusNot !== '') {
            $where .= ' AND status <> :status_not';
            $bindings[':status_not'] = $statusNot;
        }
        // Keep the server-side filter mutually exclusive and aligned with the
        // payment badges used by the list and detail screens.
        $orderSettlementTotalSql = "(CASE WHEN status = 'Cancelled' THEN 0 ELSE total END)";
        $paymentStatusSql = "(CASE
            WHEN paidAmount > {$orderSettlementTotalSql} THEN 'Overpaid'
            WHEN paidAmount <= 0 AND LOWER(COALESCE(history, '')) LIKE '%refund%' THEN 'Refunded'
            WHEN {$orderSettlementTotalSql} <= 0 THEN 'Paid'
            WHEN paidAmount <= 0 THEN 'Unpaid'
            WHEN paidAmount < {$orderSettlementTotalSql} THEN 'Partially Paid'
            ELSE 'Paid'
        END)";
        $paymentStatus = trim((string) ($filters['paymentStatus'] ?? ''));
        if ($paymentStatus !== '') {
            $where .= " AND {$paymentStatusSql} = :payment_status";
            $bindings[':payment_status'] = $paymentStatus;
        }
        $paymentStatusNot = trim((string) ($filters['paymentStatusNot'] ?? ''));
        if ($paymentStatusNot !== '') {
            $where .= " AND {$paymentStatusSql} <> :payment_status_not";
            $bindings[':payment_status_not'] = $paymentStatusNot;
        }

        $sourceAd = trim((string) ($filters['sourceAd'] ?? ''));
        if ($sourceAd !== '') {
            $where .= ' AND sourceAd = :source_ad';
            $bindings[':source_ad'] = $sourceAd;
        }
        $sourceAdNot = trim((string) ($filters['sourceAdNot'] ?? ''));
        if ($sourceAdNot !== '') {
            $where .= " AND COALESCE(sourceAd, '') <> :source_ad_not";
            $bindings[':source_ad_not'] = $sourceAdNot;
        }

        $orderNumber = trim((string) ($filters['orderNumber'] ?? ''));
        $this->appendEncodedTextFilter($where, $bindings, 'orderNumber', $orderNumber, 'order_number');
        $orderNumberNot = trim((string) ($filters['orderNumberNot'] ?? ''));
        $this->appendEncodedTextFilter($where, $bindings, 'orderNumber', $orderNumberNot, 'order_number_not', true);

        $customerName = trim((string) ($filters['customerName'] ?? ''));
        $this->appendEncodedTextFilter($where, $bindings, 'customerName', $customerName, 'customer_name');
        $customerNameNot = trim((string) ($filters['customerNameNot'] ?? ''));
        $this->appendEncodedTextFilter($where, $bindings, 'customerName', $customerNameNot, 'customer_name_not', true);

        $customerPhone = trim((string) ($filters['customerPhone'] ?? ''));
        $this->appendEncodedTextFilter($where, $bindings, 'customerPhone', $customerPhone, 'customer_phone');
        $customerPhoneNot = trim((string) ($filters['customerPhoneNot'] ?? ''));
        $this->appendEncodedTextFilter($where, $bindings, 'customerPhone', $customerPhoneNot, 'customer_phone_not', true);

        $company = trim((string) ($filters['company'] ?? ''));
        $this->appendEncodedTextFilter($where, $bindings, 'JSON_UNQUOTE(JSON_EXTRACT(pageSnapshot, "$.name"))', $company, 'company');
        $companyNot = trim((string) ($filters['companyNot'] ?? ''));
        $this->appendEncodedTextFilter($where, $bindings, 'JSON_UNQUOTE(JSON_EXTRACT(pageSnapshot, "$.name"))', $companyNot, 'company_not', true);

        $courier = trim((string) ($filters['courier'] ?? ''));
        if ($courier !== '') {
            $normalizedCourier = strtolower($courier);
            switch ($normalizedCourier) {
                case 'steadfast':
                    $where .= ' AND (
                        LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) LIKE :courier_like
                        OR TRIM(COALESCE(steadfastConsignmentId, "")) <> ""
                    )';
                    $bindings[':courier_like'] = '%steadfast%';
                    break;
                case 'carrybee':
                    $where .= ' AND (
                        LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) LIKE :courier_like
                        OR TRIM(COALESCE(carrybeeConsignmentId, "")) <> ""
                    )';
                    $bindings[':courier_like'] = '%carrybee%';
                    break;
                case 'paperfly':
                    $where .= ' AND (
                        LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) LIKE :courier_like
                        OR TRIM(COALESCE(paperflyTrackingNumber, "")) <> ""
                    )';
                    $bindings[':courier_like'] = '%paperfly%';
                    break;
                case 'pathao':
                    $where .= ' AND (
                        LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) LIKE :courier_like
                        OR TRIM(COALESCE(pathaoConsignmentId, "")) <> ""
                    )';
                    $bindings[':courier_like'] = '%pathao%';
                    break;
                case 'manual':
                case 'manual/other':
                case 'manual-other':
                    $where .= ' AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) <> ""'
                        . ' AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) NOT LIKE :manual_avoid_steadfast'
                        . ' AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) NOT LIKE :manual_avoid_carrybee'
                        . ' AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) NOT LIKE :manual_avoid_paperfly'
                        . ' AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) NOT LIKE :manual_avoid_pathao'
                        . ' AND TRIM(COALESCE(steadfastConsignmentId, "")) = ""'
                        . ' AND TRIM(COALESCE(carrybeeConsignmentId, "")) = ""'
                        . ' AND TRIM(COALESCE(paperflyTrackingNumber, "")) = ""'
                        . ' AND TRIM(COALESCE(pathaoConsignmentId, "")) = ""';
                    $bindings[':manual_avoid_steadfast'] = '%steadfast%';
                    $bindings[':manual_avoid_carrybee'] = '%carrybee%';
                    $bindings[':manual_avoid_paperfly'] = '%paperfly%';
                    $bindings[':manual_avoid_pathao'] = '%pathao%';
                    break;
                default:
                    $where .= ' AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) LIKE :courier_like';
                    $bindings[':courier_like'] = '%' . strtolower($courier) . '%';
                    break;
            }
        }
        $courierNot = trim((string) ($filters['courierNot'] ?? ''));
        if ($courierNot !== '') {
            $normalizedCourierNot = strtolower($courierNot);
            switch ($normalizedCourierNot) {
                case 'steadfast':
                    $where .= ' AND NOT (
                        LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) LIKE :courier_not_like
                        OR TRIM(COALESCE(steadfastConsignmentId, "")) <> ""
                    )';
                    $bindings[':courier_not_like'] = '%steadfast%';
                    break;
                case 'carrybee':
                    $where .= ' AND NOT (
                        LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) LIKE :courier_not_like
                        OR TRIM(COALESCE(carrybeeConsignmentId, "")) <> ""
                    )';
                    $bindings[':courier_not_like'] = '%carrybee%';
                    break;
                case 'paperfly':
                    $where .= ' AND NOT (
                        LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) LIKE :courier_not_like
                        OR TRIM(COALESCE(paperflyTrackingNumber, "")) <> ""
                    )';
                    $bindings[':courier_not_like'] = '%paperfly%';
                    break;
                case 'pathao':
                    $where .= ' AND NOT (
                        LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) LIKE :courier_not_like
                        OR TRIM(COALESCE(pathaoConsignmentId, "")) <> ""
                    )';
                    $bindings[':courier_not_like'] = '%pathao%';
                    break;
                case 'manual':
                case 'manual/other':
                case 'manual-other':
                    $where .= ' AND (
                        LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) LIKE :manual_not_match_steadfast
                        OR LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) LIKE :manual_not_match_carrybee
                        OR LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) LIKE :manual_not_match_paperfly
                        OR LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) LIKE :manual_not_match_pathao
                        OR TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) = ""
                        OR TRIM(COALESCE(steadfastConsignmentId, "")) <> ""
                        OR TRIM(COALESCE(carrybeeConsignmentId, "")) <> ""
                        OR TRIM(COALESCE(paperflyTrackingNumber, "")) <> ""
                        OR TRIM(COALESCE(pathaoConsignmentId, "")) <> ""
                    )';
                    $bindings[':manual_not_match_steadfast'] = '%steadfast%';
                    $bindings[':manual_not_match_carrybee'] = '%carrybee%';
                    $bindings[':manual_not_match_paperfly'] = '%paperfly%';
                    $bindings[':manual_not_match_pathao'] = '%pathao%';
                    break;
                default:
                    $where .= ' AND NOT LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")), "")) LIKE :courier_not_like';
                    $bindings[':courier_not_like'] = '%' . strtolower($courierNot) . '%';
                    break;
            }
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

        $createdByNotIds = is_array($filters['createdByNotIds'] ?? null) ? $filters['createdByNotIds'] : [];
        $createdByNotIds = array_values(array_filter(array_map('strval', $createdByNotIds), static fn(string $id): bool => trim($id) !== ''));
        if ($createdByNotIds !== []) {
            [$placeholders, $notBindings] = $this->inClause($createdByNotIds, 'created_by_not');
            $where .= ' AND createdBy NOT IN (' . implode(', ', $placeholders) . ')';
            $bindings += $notBindings;
        }

        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $searchTerm = '%' . $search . '%';
            if (preg_match('/\d/', $search) === 1) {
                $where .= ' AND (
                    customerPhone LIKE :search_term
                    OR orderNumber LIKE :search_term
                    OR customerName LIKE :search_term
                    OR JSON_UNQUOTE(JSON_EXTRACT(pageSnapshot, "$.name")) LIKE :search_term
                    OR JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")) LIKE :search_term
                )';
                $bindings[':search_term'] = $searchTerm;
            } else {
                $where .= ' AND (
                    customerName LIKE :search_term
                    OR orderNumber LIKE :search_term
                    OR JSON_UNQUOTE(JSON_EXTRACT(pageSnapshot, "$.name")) LIKE :search_term
                    OR JSON_UNQUOTE(JSON_EXTRACT(history, "$.courier")) LIKE :search_term
                )';
                $bindings[':search_term'] = $searchTerm;
            }
        }

        $countRow = $this->database->fetchOne("SELECT COUNT(*) AS count FROM orders_with_customer_creator {$where}", $bindings);
        $rows = $this->database->fetchAll(
            "SELECT *
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

    /**
     * Return distinct values for order filter dropdowns.
     * Optionally filtered by a search query for search-as-you-type.
     */
    public function fetchOrderFilterOptions(array $params = []): array
    {
        $search = trim((string) ($params['search'] ?? ''));
        $field = trim((string) ($params['field'] ?? ''));
        $limit = 50;
        $like = $search !== '' ? '%' . $search . '%' : null;

        $result = [];

        if ($field === '' || $field === 'customerNames') {
            $sql = 'SELECT DISTINCT customerName FROM orders_with_customer_creator WHERE deletedAt IS NULL AND TRIM(COALESCE(customerName, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'customerNames') { $sql .= ' AND customerName LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY customerName LIMIT ' . $limit;
            $result['customerNames'] = array_column($this->database->fetchAll($sql, $bindings), 'customerName');
        }

        if ($field === '' || $field === 'customerPhones') {
            $sql = 'SELECT DISTINCT customerPhone FROM orders_with_customer_creator WHERE deletedAt IS NULL AND TRIM(COALESCE(customerPhone, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'customerPhones') { $sql .= ' AND customerPhone LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY customerPhone LIMIT ' . $limit;
            $result['customerPhones'] = array_column($this->database->fetchAll($sql, $bindings), 'customerPhone');
        }

        if ($field === '' || $field === 'orderNumbers') {
            $sql = 'SELECT DISTINCT orderNumber FROM orders_with_customer_creator WHERE deletedAt IS NULL AND TRIM(COALESCE(orderNumber, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'orderNumbers') { $sql .= ' AND orderNumber LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY orderNumber LIMIT ' . $limit;
            $result['orderNumbers'] = array_column($this->database->fetchAll($sql, $bindings), 'orderNumber');
        }

        if ($field === '' || $field === 'companyNames') {
            $sql = 'SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(pageSnapshot, "$.name")) AS companyName FROM orders_with_customer_creator WHERE deletedAt IS NULL AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pageSnapshot, "$.name")), "")) <> ""';
            $bindings = [];
            if ($like && $field === 'companyNames') { $sql .= ' AND JSON_UNQUOTE(JSON_EXTRACT(pageSnapshot, "$.name")) LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY companyName LIMIT ' . $limit;
            $result['companyNames'] = array_column($this->database->fetchAll($sql, $bindings), 'companyName');
        }

        if ($field === '' || $field === 'courierNames') {
            $result['courierNames'] = ['SteadFast', 'CarryBee', 'Paperfly', 'Pathao', 'Manual/Other'];
        }

        return $result;
    }

    /**
     * Return distinct values for customer filter dropdowns.
     */
    public function fetchCustomerFilterOptions(array $params = []): array
    {
        $search = trim((string) ($params['search'] ?? ''));
        $field = trim((string) ($params['field'] ?? ''));
        $limit = 50;
        $like = $search !== '' ? '%' . $search . '%' : null;

        $result = [];

        if ($field === '' || $field === 'names') {
            $sql = 'SELECT DISTINCT name FROM customers WHERE deleted_at IS NULL AND TRIM(COALESCE(name, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'names') { $sql .= ' AND name LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY name LIMIT ' . $limit;
            $result['names'] = array_column($this->database->fetchAll($sql, $bindings), 'name');
        }

        if ($field === '' || $field === 'phones') {
            $sql = 'SELECT DISTINCT phone FROM customers WHERE deleted_at IS NULL AND TRIM(COALESCE(phone, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'phones') { $sql .= ' AND phone LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY phone LIMIT ' . $limit;
            $result['phones'] = array_column($this->database->fetchAll($sql, $bindings), 'phone');
        }

        if ($field === '' || $field === 'addresses') {
            $sql = 'SELECT DISTINCT address FROM customers WHERE deleted_at IS NULL AND TRIM(COALESCE(address, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'addresses') { $sql .= ' AND address LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY address LIMIT ' . $limit;
            $result['addresses'] = array_column($this->database->fetchAll($sql, $bindings), 'address');
        }

        return $result;
    }

    /**
     * Return distinct values for product filter dropdowns.
     */
    public function fetchProductFilterOptions(array $params = []): array
    {
        $search = trim((string) ($params['search'] ?? ''));
        $field = trim((string) ($params['field'] ?? ''));
        $limit = 50;
        $like = $search !== '' ? '%' . $search . '%' : null;

        $result = [];

        if ($field === '' || $field === 'names') {
            $sql = 'SELECT DISTINCT name FROM products WHERE deleted_at IS NULL AND TRIM(COALESCE(name, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'names') { $sql .= ' AND name LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY name LIMIT ' . $limit;
            $result['names'] = array_column($this->database->fetchAll($sql, $bindings), 'name');
        }

        if ($field === '' || $field === 'categories') {
            $sql = 'SELECT DISTINCT category FROM products WHERE deleted_at IS NULL AND TRIM(COALESCE(category, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'categories') { $sql .= ' AND category LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY category LIMIT ' . $limit;
            $result['categories'] = array_column($this->database->fetchAll($sql, $bindings), 'category');
        }

        return $result;
    }

    /**
     * Return distinct values for transaction filter dropdowns.
     */
    public function fetchTransactionFilterOptions(array $params = []): array
    {
        $search = trim((string) ($params['search'] ?? ''));
        $field = trim((string) ($params['field'] ?? ''));
        $limit = 50;
        $like = $search !== '' ? '%' . $search . '%' : null;

        $result = [];

        if ($field === '' || $field === 'accounts') {
            $sql = 'SELECT DISTINCT accountName FROM transactions_with_relations WHERE deletedAt IS NULL AND TRIM(COALESCE(accountName, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'accounts') { $sql .= ' AND accountName LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY accountName LIMIT ' . $limit;
            $result['accounts'] = array_column($this->database->fetchAll($sql, $bindings), 'accountName');
        }

        if ($field === '' || $field === 'contacts') {
            $sql = 'SELECT DISTINCT contactName FROM transactions_with_relations WHERE deletedAt IS NULL AND TRIM(COALESCE(contactName, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'contacts') { $sql .= ' AND contactName LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY contactName LIMIT ' . $limit;
            $result['contacts'] = array_column($this->database->fetchAll($sql, $bindings), 'contactName');
        }

        if ($field === '' || $field === 'paymentMethods') {
            $sql = 'SELECT DISTINCT paymentMethod FROM transactions_with_relations WHERE deletedAt IS NULL AND TRIM(COALESCE(paymentMethod, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'paymentMethods') { $sql .= ' AND paymentMethod LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY paymentMethod LIMIT ' . $limit;
            $result['paymentMethods'] = array_column($this->database->fetchAll($sql, $bindings), 'paymentMethod');
        }

        return $result;
    }

    /**
     * Return distinct values for bill filter dropdowns.
     */
    public function fetchBillFilterOptions(array $params = []): array
    {
        $search = trim((string) ($params['search'] ?? ''));
        $field = trim((string) ($params['field'] ?? ''));
        $limit = 50;
        $like = $search !== '' ? '%' . $search . '%' : null;

        $result = [];

        if ($field === '' || $field === 'billNumbers') {
            $sql = 'SELECT DISTINCT bill_number FROM bills WHERE deleted_at IS NULL AND TRIM(COALESCE(bill_number, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'billNumbers') { $sql .= ' AND bill_number LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY bill_number LIMIT ' . $limit;
            $result['billNumbers'] = array_column($this->database->fetchAll($sql, $bindings), 'bill_number');
        }

        if ($field === '' || $field === 'vendorNames') {
            $sql = "SELECT DISTINCT v.name FROM bills b JOIN vendors v ON b.vendor_id = v.id WHERE b.deleted_at IS NULL AND v.deleted_at IS NULL AND TRIM(COALESCE(v.name, '')) <> ''";
            $bindings = [];
            if ($like && $field === 'vendorNames') { $sql .= ' AND v.name LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY v.name LIMIT ' . $limit;
            $result['vendorNames'] = array_column($this->database->fetchAll($sql, $bindings), 'name');
        }

        if ($field === '' || $field === 'vendorPhones') {
            $sql = "SELECT DISTINCT v.phone FROM bills b JOIN vendors v ON b.vendor_id = v.id WHERE b.deleted_at IS NULL AND v.deleted_at IS NULL AND TRIM(COALESCE(v.phone, '')) <> ''";
            $bindings = [];
            if ($like && $field === 'vendorPhones') { $sql .= ' AND v.phone LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY v.phone LIMIT ' . $limit;
            $result['vendorPhones'] = array_column($this->database->fetchAll($sql, $bindings), 'phone');
        }

        return $result;
    }

    /**
     * Return distinct values for vendor filter dropdowns.
     */
    public function fetchVendorFilterOptions(array $params = []): array
    {
        $search = trim((string) ($params['search'] ?? ''));
        $field = trim((string) ($params['field'] ?? ''));
        $limit = 50;
        $like = $search !== '' ? '%' . $search . '%' : null;

        $result = [];

        if ($field === '' || $field === 'names') {
            $sql = 'SELECT DISTINCT name FROM vendors WHERE deleted_at IS NULL AND TRIM(COALESCE(name, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'names') { $sql .= ' AND name LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY name LIMIT ' . $limit;
            $result['names'] = array_column($this->database->fetchAll($sql, $bindings), 'name');
        }

        if ($field === '' || $field === 'phones') {
            $sql = 'SELECT DISTINCT phone FROM vendors WHERE deleted_at IS NULL AND TRIM(COALESCE(phone, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'phones') { $sql .= ' AND phone LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY phone LIMIT ' . $limit;
            $result['phones'] = array_column($this->database->fetchAll($sql, $bindings), 'phone');
        }

        if ($field === '' || $field === 'addresses') {
            $sql = 'SELECT DISTINCT address FROM vendors WHERE deleted_at IS NULL AND TRIM(COALESCE(address, "")) <> ""';
            $bindings = [];
            if ($like && $field === 'addresses') { $sql .= ' AND address LIKE :q'; $bindings[':q'] = $like; }
            $sql .= ' ORDER BY address LIMIT ' . $limit;
            $result['addresses'] = array_column($this->database->fetchAll($sql, $bindings), 'address');
        }

        return $result;
    }

    /**
     * Return distinct values for recycle bin filter dropdowns.
     */
    public function fetchRecycleBinFilterOptions(array $params = []): array
    {
        $search = trim((string) ($params['search'] ?? ''));
        $field = trim((string) ($params['field'] ?? ''));
        $limit = 50;
        $like = $search !== '' ? '%' . $search . '%' : null;

        $result = [];

        $tables = [
            'orders' => 'order_number',
            'customers' => 'name',
            'products' => 'name',
            'vendors' => 'name',
            'bills' => 'bill_number',
            'transactions' => 'description',
            'users' => 'name',
            'accounts' => 'name',
        ];

        $deletedByNames = [];
        $titles = [];

        foreach ($tables as $table => $titleCol) {
            // Recycle-bin support is intentionally schema-driven. Older
            // deployments can contain non-recyclable tables (such as accounts)
            // without deleted_at/deleted_by columns. Those tables must not make
            // the entire filter-options request fail.
            if (
                !$this->tableExists($table)
                || !$this->columnExists($table, 'deleted_at')
                || !$this->columnExists($table, $titleCol)
            ) {
                continue;
            }

            if (($field === '' || $field === 'deletedByNames') && $this->columnExists($table, 'deleted_by')) {
                $sql = "SELECT DISTINCT u.name AS deletedByName FROM `{$table}` t LEFT JOIN users u ON t.deleted_by = u.id WHERE t.deleted_at IS NOT NULL AND t.deleted_by IS NOT NULL AND t.deleted_by <> ''";
                $bindings = [];
                if ($like) { $sql .= ' AND u.name LIKE :q'; $bindings[':q'] = $like; }
                $sql .= ' LIMIT ' . $limit;
                $rows = $this->database->fetchAll($sql, $bindings);
                foreach ($rows as $row) {
                    $name = trim((string) ($row['deletedByName'] ?? ''));
                    if ($name !== '') $deletedByNames[$name] = true;
                }
            }

            if ($field === '' || $field === 'titles') {
                $sql = "SELECT DISTINCT `{$titleCol}` AS title FROM `{$table}` WHERE deleted_at IS NOT NULL";
                $bindings = [];
                if ($like) { $sql .= " AND `{$titleCol}` LIKE :q"; $bindings[':q'] = $like; }
                $sql .= ' LIMIT ' . $limit;
                $rows = $this->database->fetchAll($sql, $bindings);
                foreach ($rows as $row) {
                    $title = trim((string) ($row['title'] ?? ''));
                    if ($title !== '') $titles[$title] = true;
                }
            }
        }

        if ($field === '' || $field === 'deletedByNames') {
            $result['deletedByNames'] = array_values(array_keys($deletedByNames));
            sort($result['deletedByNames']);
        }
        if ($field === '' || $field === 'titles') {
            $result['titles'] = array_values(array_keys($titles));
            sort($result['titles']);
        }

        return $result;
    }

    public function fetchOrderById(array $params): ?array
    {
        $row = $this->fetchOrderRowById(trim((string) ($params['id'] ?? '')));
        if ($row === null) {
            return null;
        }

        $order = $this->mapOrder($row);
        $order['surveyEvents'] = [];
        if ($this->tableExists('voice_survey_events')) {
            $events = $this->database->fetchAll(
                'SELECT id, survey_id, event_type, call_status, response, details, created_at
                 FROM voice_survey_events
                 WHERE order_id = :order_id
                 ORDER BY created_at ASC, id ASC',
                [':order_id' => (string) $row['id']]
            );
            $order['surveyEvents'] = array_map(fn (array $event): array => [
                'id' => (string) $event['id'],
                'surveyId' => $this->nullableString($event['survey_id'] ?? null),
                'eventType' => (string) ($event['event_type'] ?? ''),
                'callStatus' => $this->nullableString($event['call_status'] ?? null),
                'response' => $this->nullableString($event['response'] ?? null),
                'details' => $this->nullableString($event['details'] ?? null),
                'createdAt' => $this->toIso($event['created_at'] ?? null) ?? '',
            ], $events);
        }

        return $order;
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
                    SUM(CASE WHEN o.status IN ('Completed', 'Exchange delivered') THEN 1 ELSE 0 END) AS completedOrders,
                    SUM(CASE WHEN o.status IN ('Processing', 'Courier assigned', 'Exchange processing') THEN 1 ELSE 0 END) AS processingOrders,
                    SUM(CASE WHEN o.status IN ('Picked', 'Exchange picked') THEN 1 ELSE 0 END) AS pickedOrders,
                    SUM(CASE WHEN o.status = 'On Hold' THEN 1 ELSE 0 END) AS onHoldOrders,
                    SUM(CASE WHEN o.status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelledOrders,
                    COALESCE(SUM(o.total), 0) AS orderValue,
                    COALESCE(SUM(CASE WHEN o.status IN ('Completed', 'Exchange delivered') THEN o.total ELSE 0 END), 0) AS completedOrderValue,
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
        $conditions = ['WHERE COALESCE(u.is_system, 0) = 0'];
        $bindings = [];

        if ($roleFilter === 'Admins') {
            $conditions[] = "u.role IN ('Admin', 'Developer')";
        } elseif ($roleFilter === 'Employees') {
            $conditions[] = "u.role IN ('Employee')";
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
        $featureAccess = new FeatureAccess($this->database, $this->auth);
        $capabilities = $featureAccess->fetchCapabilities();
        $hasPurchases = !empty($capabilities['purchases']);
        $hasBanking = !empty($capabilities['banking']);

        $statusKeyMap = [
            'On Hold' => 'onHold',
            'Processing' => 'processing',
            'Courier assigned' => 'processing',
            'Exchange processing' => 'processing',
            'Picked' => 'picked',
            'Exchange picked' => 'picked',
            'Completed' => 'completed',
            'Exchange delivered' => 'completed',
            'Returned' => 'returned',
            'Exchange returned' => 'returned',
            'Cancelled' => 'cancelled',
            'Exchange cancelled' => 'cancelled',
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

        $salesFromTransactions = 0.0;
        $purchasesFromTransactions = 0.0;
        $otherExpenses = 0.0;

        if ($hasBanking) {
            $transactionSummary = $this->database->fetchOne(
                'SELECT
                    COALESCE(SUM(CASE WHEN type = \'Income\' AND reference_id IS NOT NULL THEN amount ELSE 0 END), 0) AS salesFromTransactions,
                    COALESCE(SUM(CASE WHEN type = \'Expense\' AND category = \'expense_purchases\' THEN amount ELSE 0 END), 0) AS purchasesFromTransactions,
                    COALESCE(SUM(CASE WHEN type = \'Expense\' AND COALESCE(category, \'\') <> \'expense_purchases\' THEN amount ELSE 0 END), 0) AS otherExpenses
                 FROM transactions
                 WHERE ' . implode(' AND ', $transactionConditions),
                $transactionBindings
            ) ?? [];

            $salesFromTransactions = (float) ($transactionSummary['salesFromTransactions'] ?? 0);
            $purchasesFromTransactions = (float) ($transactionSummary['purchasesFromTransactions'] ?? 0);
            $otherExpenses = (float) ($transactionSummary['otherExpenses'] ?? 0);
        }

        $billPurchases = 0.0;
        if ($hasPurchases) {
            $billSummary = $this->database->fetchOne(
                'SELECT COALESCE(SUM(total), 0) AS totalPurchases
                 FROM bills
                 WHERE ' . implode(' AND ', $billConditions),
                $billBindings
            ) ?? [];

            $billPurchases = (float) ($billSummary['totalPurchases'] ?? 0);
        }

        $completedOrderSales = (float) ($orderTotals['completed'] ?? 0);

        $totalSales = $salesFromTransactions > 0 ? $salesFromTransactions : $completedOrderSales;
        $totalPurchases = $hasPurchases ? ($purchasesFromTransactions > 0 ? $purchasesFromTransactions : $billPurchases) : 0;
        $totalProfit = ($hasPurchases && $hasBanking) ? ($totalSales - $totalPurchases - $otherExpenses) : 0;

        $expenseByCategory = [];
        $monthlyData = [];

        if ($hasBanking) {
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
        } elseif ($expenseByCategory === []) {
            $expenseByCategory[] = [
                'name' => 'No Data',
                'value' => 1,
            ];
        }

        $localTimezone = new \DateTimeZone($this->config->timezone());
        $monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        if ($hasBanking) {
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
        }

        $topCustomerConditions = ['o.deleted_at IS NULL', 'o.status = :dashboard_completed_status'];
        $topCustomerBindings = [':dashboard_completed_status' => 'Completed'];
        $this->applyDashboardDateBounds('o.order_date', $filters, $topCustomerConditions, $topCustomerBindings, 'dashboard_top_customer');

        try {
            $topCustomerRows = $this->database->fetchAll(
                'SELECT
                    o.customer_id AS customerId,
                    COALESCE(NULLIF(c.name, \'\'), \'Unknown Customer\') AS customerName,
                    c.profile_image AS profileImage,
                    COUNT(*) AS orderCount,
                    COALESCE(SUM(o.total), 0) AS totalAmount
                 FROM orders o
                 LEFT JOIN customers c ON c.id = o.customer_id
                 WHERE ' . implode(' AND ', $topCustomerConditions) . '
                 GROUP BY o.customer_id, c.name, c.profile_image
                 ORDER BY totalAmount DESC
                 LIMIT 5',
                $topCustomerBindings
            );
            $hasProfileImage = true;
        } catch (\Throwable $e) {
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
            $hasProfileImage = false;
        }

        $topCustomers = array_map(
            static fn(array $row): array => [
                'name' => (string) ($row['customerName'] ?? 'Unknown Customer'),
                'image' => $hasProfileImage ? (string) ($row['profileImage'] ?? '') : '',
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
                        'productId' => trim((string) ($item['productId'] ?? '')),
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

        $productIds = array_filter(array_column($topSoldProducts, 'productId'));
        if ($productIds) {
            [$placeholders, $bindings] = $this->inClause($productIds, 'top_product_image');
            $imageRows = $this->database->fetchAll(
                'SELECT id, image FROM products WHERE id IN (' . implode(', ', $placeholders) . ')',
                $bindings
            );
            $imageMap = [];
            foreach ($imageRows as $imgRow) {
                $imageMap[(string) $imgRow['id']] = (string) ($imgRow['image'] ?? '');
            }
            foreach ($topSoldProducts as &$product) {
                $pid = $product['productId'] ?? '';
                $product['image'] = ($pid !== '' && isset($imageMap[$pid])) ? $imageMap[$pid] : '';
                unset($product['productId']);
            }
            unset($product);
        } else {
            foreach ($topSoldProducts as &$product) {
                $product['image'] = '';
                unset($product['productId']);
            }
            unset($product);
        }

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
            // Map sub-statuses to their parent buckets
            if ($status === 'Courier assigned' || $status === 'Exchange processing') {
                $status = 'Processing';
            } elseif ($status === 'Exchange picked') {
                $status = 'Picked';
            } elseif ($status === 'Exchange delivered') {
                $status = 'Completed';
            } elseif ($status === 'Exchange returned') {
                $status = 'Returned';
            } elseif ($status === 'Exchange cancelled') {
                $status = 'Cancelled';
            }
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
               AND u.role IN (\'Employee\')
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

        $featureAccess = new FeatureAccess($this->database, $this->auth);
        $capabilities = $featureAccess->fetchCapabilities();
        $hasHR = !empty($capabilities['human_resources']);
        $subCapabilities = is_array($capabilities['subCapabilities'] ?? null) ? $capabilities['subCapabilities'] : [];
        $hasPayroll = $hasHR && (($subCapabilities['payroll'] ?? true) !== false);
        $walletBalance = 0.0;
        if ($hasPayroll && $this->roleHasPermission((string) ($currentUser['role'] ?? ''), 'wallet.view')) {
            $wallet = $this->fetchMyWallet();
            $walletBalance = (float) ($wallet['currentBalance'] ?? 0);
        }

        return [
            'myTotalCreated' => (int) ($summary['totalCreated'] ?? 0),
            'myCreatedToday' => (int) ($summary['createdToday'] ?? 0),
            'myPendingOrders' => (int) ($summary['pendingOrders'] ?? 0),
            'walletBalance' => $walletBalance,
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
            'SELECT items, discount
             FROM orders
             WHERE ' . implode(' AND ', $conditions),
            $bindings
        );

        $productMap = [];
        foreach ($rows as $row) {
            $orderDiscount = max(0.0, (float) ($row['discount'] ?? 0));
            $decodedItems = $this->jsonDecodeList($row['items'] ?? null);
            $subtotal = 0.0;

            foreach ($decodedItems as $item) {
                if (!is_array($item)) {
                    continue;
                }

                $subtotal += (float) ($item['amount'] ?? 0);
            }

            $discountRatio = $subtotal > 0 ? min(1.0, $orderDiscount / $subtotal) : 0.0;

            foreach ($decodedItems as $item) {
                if (!is_array($item)) {
                    continue;
                }

                $productName = trim((string) ($item['productName'] ?? '')) ?: 'Unnamed Product';
                $key = trim((string) ($item['productId'] ?? '')) ?: $productName;
                $quantity = (float) ($item['quantity'] ?? 0);
                $amount = (float) ($item['amount'] ?? 0);
                $revenue = $amount * (1.0 - $discountRatio);

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
            $this->validateDocumentAmounts($params, $items, 'Order');
            $pageSelection = $this->resolveOrderPageSelection($params);
            $stockUpdates = $this->applyOrderStockTransition('', $status, [], $items);
            $now = $this->database->nowUtc();

            $this->database->execute(
                'INSERT INTO orders (
                    id, order_number, order_seq, order_date, customer_id, page_id, created_by, status, items,
                    subtotal, discount, shipping, total, paid_amount, notes, history, page_snapshot,
                    carrybee_consignment_id, steadfast_consignment_id, paperfly_tracking_number, pathao_consignment_id, source_ad,
                    created_at, updated_at
                ) VALUES (
                    :id, :order_number, :order_seq, :order_date, :customer_id, :page_id, :created_by, :status, :items,
                    :subtotal, :discount, :shipping, :total, :paid_amount, :notes, :history, :page_snapshot,
                    :carrybee_consignment_id, :steadfast_consignment_id, :paperfly_tracking_number, :pathao_consignment_id, :source_ad,
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
                    ':pathao_consignment_id' => $this->nullableString($params['pathaoConsignmentId'] ?? $params['pathao_consignment_id'] ?? null),
                    ':source_ad' => $this->nullableString($params['sourceAd'] ?? $params['source_ad'] ?? null),
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
            $previousPaidAmount = (float) ($existingRow['paid_amount'] ?? 0);
            $orderTotal = (float) ($existingRow['total'] ?? 0);
            $orderNumber = trim((string) ($existingRow['order_number'] ?? ''));
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

            $paymentAmount = round((float) ($updates['paymentAmount'] ?? 0), 2);
            if ($paymentAmount > 0) {
                if ($previousStatus === 'Cancelled') {
                    throw new RuntimeException('Payments cannot be added to a cancelled order.');
                }
                $paymentAccountId = trim((string) ($updates['paymentAccountId'] ?? ''));
                if ($paymentAccountId === '') {
                    throw new RuntimeException('Select an account for the order payment.');
                }
                $remainingDue = max(0.0, $orderTotal - $previousPaidAmount);
                if ($paymentAmount > $remainingDue) {
                    throw new RuntimeException('Order payment cannot exceed the remaining due amount.');
                }
                $systemDefaults = $this->database->fetchOne(
                    'SELECT default_payment_method, income_category_id FROM system_defaults LIMIT 1'
                ) ?? [];
                $paymentMethod = trim((string) ($updates['paymentMethod'] ?? ''))
                    ?: (trim((string) ($systemDefaults['default_payment_method'] ?? '')) ?: 'Cash');
                $paymentCategory = trim((string) ($systemDefaults['income_category_id'] ?? '')) ?: 'income_sales';
                $paymentDate = trim((string) ($updates['paymentDate'] ?? '')) ?: $this->database->nowUtc();
                $this->createTransactionRecord([
                    'date' => $paymentDate,
                    'type' => 'Income',
                    'category' => $paymentCategory,
                    'accountId' => $paymentAccountId,
                    'amount' => $paymentAmount,
                    'description' => "Payment for Order #{$orderNumber}",
                    'referenceId' => $id,
                    'contactId' => $previousCustomerId,
                    'paymentMethod' => $paymentMethod,
                    'history' => [],
                ], (string) $actor['id'], $actor);
                $payload['paid_amount'] = $this->formatMoney($previousPaidAmount + $paymentAmount);
            }

            $refundAmount = round((float) ($updates['refundAmount'] ?? 0), 2);
            $refundAccountId = trim((string) ($updates['refundAccountId'] ?? ''));
            $refundPaymentMethod = trim((string) ($updates['refundPaymentMethod'] ?? ''));
            $refundCategoryId = trim((string) ($updates['refundCategoryId'] ?? ''));
            if ($paymentAmount > 0 && $refundAmount > 0) {
                throw new RuntimeException('Record either an order payment or a refund, not both.');
            }

            if ($refundAmount > 0) {
                if ($refundAccountId === '') {
                    throw new RuntimeException('Refund account is required when recording a refund transaction.');
                }
                if ($refundAmount > $previousPaidAmount) {
                    throw new RuntimeException('Refund amount cannot exceed the amount received for this order.');
                }

                $systemDefaults = $this->database->fetchOne(
                    'SELECT expense_category_id FROM system_defaults LIMIT 1'
                ) ?? [];
                $defaultRefundCategoryId = trim((string) ($systemDefaults['expense_category_id'] ?? '')) ?: 'expense_other';
                $refundCategory = $refundCategoryId !== '' ? $refundCategoryId : $defaultRefundCategoryId;

                $refundDate = trim((string) ($updates['paidAt'] ?? '')) ?: $this->database->nowUtc();
                $this->createTransactionRecord([
                    'date' => $refundDate,
                    'type' => 'Expense',
                    'category' => $refundCategory,
                    'accountId' => $refundAccountId,
                    'amount' => $refundAmount,
                    'description' => "Refund for Order #{$orderNumber}",
                    'referenceId' => $id,
                    'contactId' => $previousCustomerId,
                    'paymentMethod' => $refundPaymentMethod,
                    'history' => [],
                ], (string) $actor['id'], $actor);
                $payload['paid_amount'] = $this->formatMoney(max(0.0, $previousPaidAmount - $refundAmount));
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
            if (array_key_exists('pathaoConsignmentId', $updates) || array_key_exists('pathao_consignment_id', $updates)) {
                $payload['pathao_consignment_id'] = $this->nullableString($updates['pathaoConsignmentId'] ?? $updates['pathao_consignment_id'] ?? null);
            }
            if (array_key_exists('exchangeCourier', $updates) || array_key_exists('exchange_courier', $updates)) {
                $payload['exchange_courier'] = $this->nullableString($updates['exchangeCourier'] ?? $updates['exchange_courier'] ?? null);
            }
            if (array_key_exists('exchangeSteadfastConsignmentId', $updates) || array_key_exists('exchange_steadfast_consignment_id', $updates)) {
                $payload['exchange_steadfast_consignment_id'] = $this->nullableString($updates['exchangeSteadfastConsignmentId'] ?? $updates['exchange_steadfast_consignment_id'] ?? null);
            }
            if (array_key_exists('exchangeCarrybeeConsignmentId', $updates) || array_key_exists('exchange_carrybee_consignment_id', $updates)) {
                $payload['exchange_carrybee_consignment_id'] = $this->nullableString($updates['exchangeCarrybeeConsignmentId'] ?? $updates['exchange_carrybee_consignment_id'] ?? null);
            }
            if (array_key_exists('exchangePaperflyTrackingNumber', $updates) || array_key_exists('exchange_paperfly_tracking_number', $updates)) {
                $payload['exchange_paperfly_tracking_number'] = $this->nullableString($updates['exchangePaperflyTrackingNumber'] ?? $updates['exchange_paperfly_tracking_number'] ?? null);
            }
            if (array_key_exists('exchangePathaoConsignmentId', $updates) || array_key_exists('exchange_pathao_consignment_id', $updates)) {
                $payload['exchange_pathao_consignment_id'] = $this->nullableString($updates['exchangePathaoConsignmentId'] ?? $updates['exchange_pathao_consignment_id'] ?? null);
            }
            if (array_key_exists('exchangeCourierHistory', $updates) || array_key_exists('exchange_courier_history', $updates)) {
                $payload['exchange_courier_history'] = $this->nullableString($updates['exchangeCourierHistory'] ?? $updates['exchange_courier_history'] ?? null);
            }
            if (array_key_exists('sourceAd', $updates) || array_key_exists('source_ad', $updates)) {
                $payload['source_ad'] = $this->nullableString($updates['sourceAd'] ?? $updates['source_ad'] ?? null);
            }

            $affectsCustomerSummary =
                array_key_exists('customerId', $updates) ||
                array_key_exists('status', $updates) ||
                array_key_exists('total', $updates) ||
                array_key_exists('paidAmount', $updates) ||
                $paymentAmount > 0 ||
                $refundAmount > 0;

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
        $amount = (float) ($params['amount'] ?? 0);
        $paymentMethod = trim((string) ($params['paymentMethod'] ?? ''));
        $categoryId = trim((string) ($params['categoryId'] ?? ''));

        if ($outcome === 'Returned') {
            if ($amount < 0) {
                throw new RuntimeException('Return expense amount cannot be negative.');
            }
            if ($amount > 0 && ($accountId === '' || $paymentMethod === '' || $categoryId === '')) {
                throw new RuntimeException('Account, payment method, and expense category are required when a return expense is recorded.');
            }
        }

        $refundAmount = (float) ($params['refundAmount'] ?? 0);
        $refundAccountId = trim((string) ($params['refundAccountId'] ?? ''));
        $refundPaymentMethod = trim((string) ($params['refundPaymentMethod'] ?? ''));

        return $this->database->transaction(function () use ($actor, $orderId, $outcome, $recordedAt, $accountId, $amount, $paymentMethod, $categoryId, $refundAmount, $refundAccountId, $refundPaymentMethod, $params): array {
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
            if ($previousStatus !== 'Picked' && $previousStatus !== 'Exchange picked') {
                throw new RuntimeException('Only picked orders can be finalized from this modal.');
            }

            $orderNumber = trim((string) ($orderRow['order_number'] ?? ''));
            $customerId = trim((string) ($orderRow['customer_id'] ?? ''));
            $orderTotal = (float) ($orderRow['total'] ?? 0);
            $paidAmount = (float) ($orderRow['paid_amount'] ?? 0);
            $previousItems = $this->jsonDecodeList($orderRow['items'] ?? []);
            $nextStatus = $outcome === 'Returned' ? 'Returned' : ($previousStatus === 'Exchange picked' ? 'Exchange delivered' : 'Completed');
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
            $timeLabel = $localRecordedAt->format('h:i A');

            $history = $this->jsonDecodeAssoc($orderRow['history'] ?? []);
            $payload = [
                'status' => $nextStatus,
            ];
            $createdTransactions = [];

            if ($outcome === 'Delivered') {
                $effectivePayment = round(max(0.0, $amount), 2);
                $remainingDue = max(0.0, $orderTotal - $paidAmount);
                if ($effectivePayment > $remainingDue) {
                    throw new RuntimeException('Delivery payment cannot exceed the remaining order due.');
                }
                if ($effectivePayment > 0) {
                    if ($accountId === '') {
                        throw new RuntimeException('Select the account that received the delivery payment.');
                    }
                    $effectiveMethod = $paymentMethod !== '' ? $paymentMethod : $defaultPaymentMethod;
                    $effectiveCategory = $categoryId !== '' ? $categoryId : $incomeCategoryId;
                    $createdTransactions[] = $this->createTransactionRecord([
                        'date' => $recordedAt,
                        'type' => 'Income',
                        'category' => $effectiveCategory,
                        'accountId' => $accountId,
                        'amount' => $effectivePayment,
                        'description' => "Delivery payment for Order #{$orderNumber}",
                        'referenceId' => $orderId,
                        'contactId' => $customerId,
                        'paymentMethod' => $effectiveMethod,
                        'history' => [],
                    ], (string) $actor['id'], $actor);
                    $payload['paid_amount'] = $this->formatMoney($paidAmount + $effectivePayment);
                    $history['payment'] = $this->appendHistoryText(
                        (string) ($history['payment'] ?? ''),
                        'Delivery payment recorded: ' . $this->formatMoney($effectivePayment) . '.'
                    );
                }
                // When completing from exchange picked, set exchange delivered history
                // but preserve the original delivery history
                if ($previousStatus === 'Exchange picked') {
                    if (!isset($history['exchangeDelivered'])) {
                        $history['exchangeDelivered'] = sprintf(
                            'Exchange delivered by %s on %s at %s.',
                            trim((string) ($actor['name'] ?? 'System')),
                            $dateLabel,
                            $timeLabel
                        );
                    }
                } else {
                    $history['completed'] = sprintf(
                        'Marked as delivered by %s on %s at %s.',
                        trim((string) ($actor['name'] ?? 'System')),
                        $dateLabel,
                        $timeLabel
                    );
                }
                $payload['history'] = $this->jsonEncode($history);
            } else {
                if ($amount > 0) {
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
                }

                // Refund transaction for partially paid orders
                if ($refundAmount > 0 && $refundAccountId !== '' && $paidAmount > 0) {
                    $effectiveRefund = min($refundAmount, $paidAmount);
                    $createdTransactions[] = $this->createTransactionRecord([
                        'date' => $recordedAt,
                        'type' => 'Expense',
                        'category' => $categoryId,
                        'accountId' => $refundAccountId,
                        'amount' => $effectiveRefund,
                        'description' => "Refund for Order #{$orderNumber}",
                        'referenceId' => $orderId,
                        'contactId' => $customerId,
                        'paymentMethod' => $refundPaymentMethod ?: $paymentMethod,
                        'history' => [],
                    ], (string) $actor['id'], $actor);
                    $payload['paid_amount'] = $this->formatMoney(max(0, $paidAmount - $effectiveRefund));
                }

                $refundNote = '';
                if ($refundAmount > 0 && $refundAccountId !== '' && $paidAmount > 0) {
                    $effectiveRefund = min($refundAmount, $paidAmount);
                    $refundNote = sprintf(' Refund: %s.', $this->formatMoney($effectiveRefund));
                }

                $history['returned'] = sprintf(
                    'Marked as returned by %s on %s at %s. Expense recorded: %s.%s%s',
                    trim((string) ($actor['name'] ?? 'System')),
                    $dateLabel,
                    $timeLabel,
                    $this->formatMoney($amount),
                    $refundNote,
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

    /**
     * Process partial return, exchange, or partial refund on a completed/picked order.
     *
     * Handles:
     * - partialReturn: return some items, refund their value
     * - exchange: return some items and replace with new ones (price difference settled)
     *
     */
    public function processOrderReturnExchange(array $params): array
    {
        $actor = $this->currentUser();
        $orderId = trim((string) ($params['orderId'] ?? ''));
        $action = trim((string) ($params['returnAction'] ?? $params['action'] ?? ''));
        $items = is_array($params['items'] ?? null) ? $params['items'] : [];

        if ($orderId === '') {
            throw new RuntimeException('Order id is required.');
        }
        if (!in_array($action, ['partialReturn', 'exchange'], true)) {
            throw new RuntimeException('Invalid action. Must be partialReturn or exchange.');
        }
        if ($items === []) {
            throw new RuntimeException('At least one item must be selected.');
        }

        $refundAmount = (float) ($params['refundAmount'] ?? 0);
        $extraCollectionAmount = (float) ($params['extraCollectionAmount'] ?? 0);
        $accountId = trim((string) ($params['accountId'] ?? ''));
        $paymentMethod = trim((string) ($params['paymentMethod'] ?? ''));
        $categoryId = trim((string) ($params['categoryId'] ?? ''));
        $note = trim((string) ($params['note'] ?? ''));
        $recordedAt = $this->normalizeDateTimeInput((string) ($params['date'] ?? $this->database->nowUtc()));

        return $this->database->transaction(function () use ($actor, $orderId, $action, $items, $refundAmount, $extraCollectionAmount, $accountId, $paymentMethod, $categoryId, $note, $recordedAt): array {
            $orderRow = $this->database->fetchOne(
                'SELECT * FROM orders WHERE id = :id AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
                [':id' => $orderId]
            );

            if ($orderRow === null) {
                throw new RuntimeException('Order not found.');
            }

            $createdBy = (string) ($orderRow['created_by'] ?? '');
            $actorRole = (string) ($actor['role'] ?? '');
            $hasPermission = $this->hasAdminAccess($actorRole)
                || $this->userHasScopedPermissionForRecord(
                    $actor, $createdBy,
                    'orders.processReturnExchangeOwn',
                    'orders.processReturnExchangeAny'
                );
            if (!$hasPermission) {
                throw new RuntimeException('You do not have permission to process returns/exchanges. Enable "Orders: Process Return/Exchange" in Settings → Permissions.');
            }

            $currentStatus = trim((string) ($orderRow['status'] ?? ''));
            if (!in_array($currentStatus, ['Completed', 'Picked', 'Returned', 'Exchange delivered', 'Exchange picked'], true)) {
                throw new RuntimeException('Returns/exchanges can only be processed on Completed, Picked, Returned, Exchange delivered, or Exchange picked orders.');
            }

            $orderNumber = trim((string) ($orderRow['order_number'] ?? ''));
            $customerId = trim((string) ($orderRow['customer_id'] ?? ''));
            $previousItems = $this->jsonDecodeList($orderRow['items'] ?? []);
            $previousPaidAmount = (float) ($orderRow['paid_amount'] ?? 0);
            $previousTotal = (float) ($orderRow['total'] ?? 0);

            // Refund is only possible if customer has paid something
            if ($refundAmount > 0 && $previousPaidAmount <= 0) {
                $refundAmount = 0;
            }

            // Account is required when money moves
            if (($refundAmount > 0 || $extraCollectionAmount > 0) && $accountId === '') {
                throw new RuntimeException('Account is required when a refund or collection is involved.');
            }

            $localRecordedAt = (new \DateTimeImmutable($recordedAt, new \DateTimeZone('UTC')))
                ->setTimezone(new \DateTimeZone($this->config->timezone()));
            $dateLabel = $localRecordedAt->format('j M Y');
            $timeLabel = $localRecordedAt->format('h:i A');
            $actorName = trim((string) ($actor['name'] ?? 'System'));

            // Build updated items with return/exchange tracking
            $updatedItems = $previousItems;
            $returnedItemDescriptions = [];
            $exchangedItemDescriptions = [];
            $totalReturnValue = 0.0;
            $discountEligibleReturnValue = 0.0;
            $replacementValue = 0.0;
            $stockDeltas = [];
            $processedSelections = 0;
            $discountEligibleSubtotal = 0.0;
            foreach ($previousItems as $previousItem) {
                $isDiscountEligible = !array_key_exists('discountEligible', $previousItem)
                    || (bool) $previousItem['discountEligible'];
                if (!$isDiscountEligible) continue;
                $activeQty = max(
                    0,
                    (int) ($previousItem['quantity'] ?? 0)
                    - (int) ($previousItem['returnedQty'] ?? 0)
                    - (int) ($previousItem['exchangedQty'] ?? 0)
                );
                $discountEligibleSubtotal += max(0.0, (float) ($previousItem['rate'] ?? 0)) * $activeQty;
            }

            foreach ($items as $itemSelection) {
                $productId = trim((string) ($itemSelection['productId'] ?? ''));
                $itemAction = trim((string) ($itemSelection['action'] ?? 'keep'));
                $returnQty = (int) ($itemSelection['returnQty'] ?? 0);
                $replacementItems = is_array($itemSelection['replacementItems'] ?? null) ? $itemSelection['replacementItems'] : [];

                if ($itemAction === 'keep' || $returnQty <= 0) {
                    continue;
                }
                if ($action === 'partialReturn' && $itemAction !== 'return') {
                    throw new RuntimeException('Partial returns may only contain return items.');
                }
                if ($action === 'exchange' && $itemAction !== 'exchange') {
                    throw new RuntimeException('Exchanges may only contain exchange items.');
                }

                // A product can appear on more than one line. Prefer the stable
                // source line supplied by the UI and retain a safe legacy fallback.
                $itemIndex = array_key_exists('lineIndex', $itemSelection) ? (int) $itemSelection['lineIndex'] : -1;
                if (!isset($updatedItems[$itemIndex]) || trim((string) ($updatedItems[$itemIndex]['productId'] ?? '')) !== $productId) {
                    $itemIndex = -1;
                    foreach ($updatedItems as $idx => $item) {
                        $activeQty = max(0, (int) ($item['quantity'] ?? 0) - (int) ($item['returnedQty'] ?? 0) - (int) ($item['exchangedQty'] ?? 0));
                        if (trim((string) ($item['productId'] ?? '')) === $productId && $activeQty > 0) {
                            $itemIndex = $idx;
                            break;
                        }
                    }
                }
                if ($itemIndex < 0) {
                    throw new RuntimeException('A selected order item is no longer available. Refresh and try again.');
                }

                $originalItem = $updatedItems[$itemIndex];
                $originalQty = (int) ($originalItem['quantity'] ?? 0);
                $currentReturnedQty = (int) ($originalItem['returnedQty'] ?? 0);
                $currentExchangedQty = (int) ($originalItem['exchangedQty'] ?? 0);
                $activeQty = max(0, $originalQty - $currentReturnedQty - $currentExchangedQty);
                $rate = (float) ($originalItem['rate'] ?? 0);
                $productName = trim((string) ($originalItem['productName'] ?? 'Unknown'));

                if ($returnQty > $activeQty) {
                    throw new RuntimeException("Only {$activeQty} unit(s) of {$productName} remain available to return or exchange.");
                }
                $effectiveReturnQty = $returnQty;
                $returnValue = $rate * $effectiveReturnQty;
                $totalReturnValue += $returnValue;
                $isDiscountEligible = !array_key_exists('discountEligible', $originalItem)
                    || (bool) $originalItem['discountEligible'];
                if ($isDiscountEligible) {
                    $discountEligibleReturnValue += $returnValue;
                }
                $stockDeltas[$productId] = ($stockDeltas[$productId] ?? 0) + $effectiveReturnQty;
                $processedSelections++;

                // Update the item with return/exchange tracking
                if ($itemAction === 'return') {
                    $updatedItems[$itemIndex]['returnedQty'] = $currentReturnedQty + $effectiveReturnQty;
                    $returnedItemDescriptions[] = "{$productName} ×{$effectiveReturnQty}";
                } elseif ($itemAction === 'exchange') {
                    $updatedItems[$itemIndex]['exchangedQty'] = $currentExchangedQty + $effectiveReturnQty;

                    if ($replacementItems === []) {
                        throw new RuntimeException("Choose at least one replacement item for {$productName}.");
                    }

                    $existingExchanges = is_array($originalItem['exchangedWith'] ?? null) ? $originalItem['exchangedWith'] : [];
                    foreach ($replacementItems as $rep) {
                        $repProductId = trim((string) ($rep['productId'] ?? ''));
                        $repQty = (int) ($rep['quantity'] ?? 0);
                        $repRate = round((float) ($rep['rate'] ?? 0), 2);
                        if ($repProductId === '' || $repQty <= 0 || $repRate < 0) {
                            throw new RuntimeException('Replacement items must have a valid product, quantity, and rate.');
                        }
                        $productRow = $this->database->fetchOne(
                            'SELECT id, name FROM products WHERE id = :id AND deleted_at IS NULL LIMIT 1',
                            [':id' => $repProductId]
                        );
                        if ($productRow === null) {
                            throw new RuntimeException('A selected replacement product is no longer available.');
                        }
                        $repAmount = round($repRate * $repQty, 2);
                        $normalizedReplacement = [
                            'productId' => $repProductId,
                            'productName' => trim((string) ($productRow['name'] ?? $repProductId)),
                            'quantity' => $repQty,
                            'rate' => $repRate,
                            'amount' => $repAmount,
                            'discountEligible' => false,
                            'isExchangeReplacement' => true,
                        ];
                        $existingExchanges[] = $normalizedReplacement;
                        $updatedItems[] = $normalizedReplacement;
                        $replacementValue += $repAmount;
                        $stockDeltas[$repProductId] = ($stockDeltas[$repProductId] ?? 0) - $repQty;
                    }
                    $updatedItems[$itemIndex]['exchangedWith'] = $existingExchanges;

                    $repNames = array_map(function ($r) {
                        return trim((string) ($r['productName'] ?? '')) . ' ×' . (int) ($r['quantity'] ?? 1);
                    }, $replacementItems);
                    $exchangedItemDescriptions[] = "{$productName} ×{$effectiveReturnQty} → " . implode(', ', $repNames);
                }
            }

            if ($processedSelections === 0) {
                throw new RuntimeException('No valid return or exchange quantity was selected.');
            }

            // Resolve the net stock change atomically. Missing products and
            // insufficient replacement stock are explicit errors.
            $stockUpdates = $this->resolveProductStockUpdates(
                array_filter($stockDeltas, static fn(int $delta): bool => $delta !== 0),
                'order return/exchange'
            );
            $this->applyResolvedProductStockUpdates($stockUpdates);

            $originalSubtotal = (float) ($orderRow['subtotal'] ?? 0);
            $originalDiscount = (float) ($orderRow['discount'] ?? 0);
            $shipping = (float) ($orderRow['shipping'] ?? 0);

            $adjustment = $this->calculateReturnAdjustment(
                $originalSubtotal,
                $originalDiscount,
                $shipping,
                $previousPaidAmount,
                $totalReturnValue,
                $replacementValue,
                $discountEligibleSubtotal,
                $discountEligibleReturnValue
            );
            $newSubtotal = $adjustment['newSubtotal'];
            $newDiscount = $adjustment['newDiscount'];
            $newTotal = $adjustment['newTotal'];

            $effectiveRefund = min(max(0.0, $refundAmount), $adjustment['maxRefund']);
            $effectiveCollection = min(max(0.0, $extraCollectionAmount), $adjustment['maxCollection']);
            if ($effectiveRefund > 0 && $effectiveCollection > 0) {
                throw new RuntimeException('A return/exchange cannot record a refund and an extra collection at the same time.');
            }
            $newPaidAmount = max(0.0, $previousPaidAmount - $effectiveRefund + $effectiveCollection);
            $createdTransactions = [];

            $systemDefaults = $this->database->fetchOne(
                'SELECT default_payment_method, income_category_id, expense_category_id FROM system_defaults LIMIT 1'
            ) ?? [];
            $effectivePaymentMethod = $paymentMethod !== ''
                ? $paymentMethod
                : (trim((string) ($systemDefaults['default_payment_method'] ?? '')) ?: 'Cash');
            if ($effectiveRefund > 0) {
                $refundCategory = $categoryId !== ''
                    ? $categoryId
                    : (trim((string) ($systemDefaults['expense_category_id'] ?? '')) ?: 'expense_other');
                $createdTransactions[] = $this->createTransactionRecord([
                    'date' => $recordedAt,
                    'type' => 'Expense',
                    'category' => $refundCategory,
                    'accountId' => $accountId,
                    'amount' => $effectiveRefund,
                    'description' => "Return/exchange refund for Order #{$orderNumber}",
                    'referenceId' => $orderId,
                    'contactId' => $customerId,
                    'paymentMethod' => $effectivePaymentMethod,
                    'history' => [],
                ], (string) $actor['id'], $actor);
            }
            if ($effectiveCollection > 0) {
                $collectionCategory = $categoryId !== ''
                    ? $categoryId
                    : (trim((string) ($systemDefaults['income_category_id'] ?? '')) ?: 'income_sales');
                $createdTransactions[] = $this->createTransactionRecord([
                    'date' => $recordedAt,
                    'type' => 'Income',
                    'category' => $collectionCategory,
                    'accountId' => $accountId,
                    'amount' => $effectiveCollection,
                    'description' => "Exchange collection for Order #{$orderNumber}",
                    'referenceId' => $orderId,
                    'contactId' => $customerId,
                    'paymentMethod' => $effectivePaymentMethod,
                    'history' => [],
                ], (string) $actor['id'], $actor);
            }

            // Build history entry
            $history = $this->jsonDecodeAssoc($orderRow['history'] ?? []);
            $historyLines = [];
            if ($returnedItemDescriptions !== []) {
                $historyLines[] = 'Returned: ' . implode(', ', $returnedItemDescriptions);
            }
            if ($exchangedItemDescriptions !== []) {
                $historyLines[] = 'Exchanged: ' . implode(', ', $exchangedItemDescriptions);
            }
            if ($effectiveRefund > 0) {
                $historyLines[] = 'Refunded: ' . $this->formatMoney($effectiveRefund);
            }
            if ($effectiveCollection > 0) {
                $historyLines[] = 'Collected: ' . $this->formatMoney($effectiveCollection);
            }
            if ($note !== '') {
                $historyLines[] = 'Note: ' . $note;
            }

            $actionLabel = match ($action) {
                'partialReturn' => 'Partial return',
                'exchange' => 'Exchange',
                default => 'Return/Exchange',
            };
            $history['returnExchange'] = $this->appendHistoryText(
                (string) ($history['returnExchange'] ?? ''),
                trim(
                "{$actionLabel} processed by {$actorName} on {$dateLabel} at {$timeLabel}. "
                . implode('. ', $historyLines)
                )
            );

            if ($action === 'exchange') {
                $history['exchangeProcessing'] = $this->appendHistoryText(
                    (string) ($history['exchangeProcessing'] ?? ''),
                    "Exchange processing started by {$actorName} on {$dateLabel} at {$timeLabel}."
                );
            }

            // Update the order — set status based on action and current status
            $isExchangeOrder = str_starts_with($currentStatus, 'Exchange ');
            $hasActiveItems = false;
            foreach ($updatedItems as $updatedItem) {
                $activeQty = max(
                    0,
                    (int) ($updatedItem['quantity'] ?? 0)
                    - (int) ($updatedItem['returnedQty'] ?? 0)
                    - (int) ($updatedItem['exchangedQty'] ?? 0)
                );
                if ($activeQty > 0) {
                    $hasActiveItems = true;
                    break;
                }
            }
            if ($action === 'exchange') {
                $nextStatus = 'Exchange processing';
            } elseif (!$hasActiveItems) {
                $nextStatus = $isExchangeOrder ? 'Exchange returned' : 'Returned';
                $history[$isExchangeOrder ? 'exchangeReturned' : 'returned'] =
                    "Fully returned by {$actorName} on {$dateLabel} at {$timeLabel}.";
            } elseif ($action === 'partialReturn' && $isExchangeOrder) {
                $nextStatus = 'Exchange returned';
                $history['exchangeReturned'] = "Exchange returned by {$actorName} on {$dateLabel} at {$timeLabel}.";
            } else {
                $nextStatus = null;
            }
            $payload = [
                'items' => $this->jsonEncode($updatedItems),
                'subtotal' => $this->formatMoney($newSubtotal),
                'discount' => $this->formatMoney($newDiscount),
                'total' => $this->formatMoney($newTotal),
                'paid_amount' => $this->formatMoney($newPaidAmount),
                'history' => $this->jsonEncode($history),
            ];
            if ($nextStatus !== null) {
                $payload['status'] = $nextStatus;
            }
            $this->touchUpdate('orders', $orderId, $payload);

            // Sync customer summary
            $this->syncCustomerOrderSummaries([$customerId]);

            // Reload and return
            $row = $this->fetchOrderRowById($orderId);
            if ($row === null) {
                throw new RuntimeException('Updated order could not be loaded.');
            }

            $order = $this->mapOrder($row);
            $pendingTransactionIds = array_values(array_map(
                static fn(array $t): string => (string) ($t['id'] ?? ''),
                array_filter($createdTransactions, static fn(array $t): bool => (string) ($t['approvalStatus'] ?? 'approved') === 'pending')
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
        $this->appendEncodedTextFilter($where, $bindings, 'billNumber', trim((string) ($filters['billNumber'] ?? '')), 'bill_number');
        $this->appendEncodedTextFilter($where, $bindings, 'billNumber', trim((string) ($filters['billNumberNot'] ?? '')), 'bill_number_not', true);
        $this->appendEncodedTextFilter($where, $bindings, 'vendorName', trim((string) ($filters['vendorName'] ?? '')), 'vendor_name');
        $this->appendEncodedTextFilter($where, $bindings, 'vendorName', trim((string) ($filters['vendorNameNot'] ?? '')), 'vendor_name_not', true);
        $this->appendEncodedTextFilter($where, $bindings, 'vendorPhone', trim((string) ($filters['vendorPhone'] ?? '')), 'vendor_phone');
        $this->appendEncodedTextFilter($where, $bindings, 'vendorPhone', trim((string) ($filters['vendorPhoneNot'] ?? '')), 'vendor_phone_not', true);

        $finalStatusSql = "(CASE
            WHEN status = 'Returned' OR TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '')) <> '' THEN 'Returned'
            WHEN status = 'Cancelled' OR TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '')) <> '' THEN 'Cancelled'
            WHEN status IN ('Received', 'Paid') THEN 'Received'
            ELSE status
        END)";
        $billSettlementTotalSql = "(CASE
            WHEN {$finalStatusSql} = 'Cancelled' THEN 0
            WHEN {$finalStatusSql} = 'Returned'
                AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, '$.return')), '')) = '' THEN 0
            ELSE total
        END)";
        $billStatus = trim((string) ($filters['billStatus'] ?? ''));
        if ($billStatus !== '') {
            $where .= " AND {$finalStatusSql} = :bill_status";
            $bindings[':bill_status'] = $billStatus;
        }
        $billStatusNot = trim((string) ($filters['billStatusNot'] ?? ''));
        if ($billStatusNot !== '') {
            $where .= " AND {$finalStatusSql} <> :bill_status_not";
            $bindings[':bill_status_not'] = $billStatusNot;
        }

        $paymentStatusSql = "(CASE
            WHEN paidAmount > {$billSettlementTotalSql} THEN 'Overpaid'
            WHEN paidAmount <= 0 AND LOWER(COALESCE(history, '')) LIKE '%refund%' THEN 'Refunded'
            WHEN {$billSettlementTotalSql} <= 0 THEN 'Paid'
            WHEN paidAmount <= 0 THEN 'Unpaid'
            WHEN paidAmount < {$billSettlementTotalSql} THEN 'Partially Paid'
            ELSE 'Paid'
        END)";
        $billPaymentStatus = trim((string) ($filters['paymentStatus'] ?? ''));
        if ($billPaymentStatus !== '') {
            $where .= " AND {$paymentStatusSql} = :bill_payment_status";
            $bindings[':bill_payment_status'] = $billPaymentStatus;
        }
        $billPaymentStatusNot = trim((string) ($filters['paymentStatusNot'] ?? ''));
        if ($billPaymentStatusNot !== '') {
            $where .= " AND {$paymentStatusSql} <> :bill_payment_status_not";
            $bindings[':bill_payment_status_not'] = $billPaymentStatusNot;
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

        $createdByNotIds = is_array($filters['createdByNotIds'] ?? null) ? $filters['createdByNotIds'] : [];
        $createdByNotIds = array_values(array_filter(array_map('strval', $createdByNotIds), static fn(string $id): bool => trim($id) !== ''));
        if ($createdByNotIds !== []) {
            [$placeholders, $notBindings] = $this->inClause($createdByNotIds, 'bill_created_by_not');
            $where .= ' AND createdBy NOT IN (' . implode(', ', $placeholders) . ')';
            $bindings += $notBindings;
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
            $this->validateDocumentAmounts($params, $items, 'Bill');
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
            $previousPaidAmount = (float) ($existingRow['paid_amount'] ?? 0);
            $billTotal = (float) ($existingRow['total'] ?? 0);
            $existingHistory = $this->jsonDecodeAssoc($existingRow['history'] ?? []);
            $isVoidedBeforeReceipt = $previousStatus === 'Cancelled'
                || ($previousStatus === 'Returned' && trim((string) ($existingHistory['return'] ?? '')) === '');
            $billSettlementTotal = $isVoidedBeforeReceipt ? 0.0 : $billTotal;
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

            $paymentAmount = round((float) ($updates['paymentAmount'] ?? 0), 2);
            $refundAmount = round((float) ($updates['refundAmount'] ?? 0), 2);
            if ($paymentAmount > 0 && $refundAmount > 0) {
                throw new RuntimeException('Record either a bill payment or a vendor refund, not both.');
            }
            if ($paymentAmount > 0 || $refundAmount > 0) {
                $this->assertUserCanManageBillRecord(
                    $actor,
                    $existingRow,
                    'bills.markPaidOwn',
                    'bills.markPaidAny',
                    'You do not have permission to record bill payments or refunds.'
                );
                $accountId = trim((string) ($updates['accountId'] ?? ''));
                if ($accountId === '') {
                    throw new RuntimeException('Select an account for this bill transaction.');
                }
                $recordedAt = $this->normalizeDateTimeInput((string) ($updates['transactionDate'] ?? $this->database->nowUtc()));
                $systemDefaults = $this->database->fetchOne(
                    'SELECT default_payment_method, expense_category_id, income_category_id FROM system_defaults LIMIT 1'
                ) ?? [];
                $paymentMethod = trim((string) ($updates['paymentMethod'] ?? ''))
                    ?: (trim((string) ($systemDefaults['default_payment_method'] ?? '')) ?: 'Cash');
                $billNumber = trim((string) ($existingRow['bill_number'] ?? ''));

                if ($paymentAmount > 0) {
                    if (in_array($previousStatus, ['Returned', 'Cancelled'], true)) {
                        throw new RuntimeException('Payments cannot be added to a returned or cancelled bill.');
                    }
                    $remainingDue = max(0.0, $billSettlementTotal - $previousPaidAmount);
                    if ($paymentAmount > $remainingDue) {
                        throw new RuntimeException('Bill payment cannot exceed the remaining due amount.');
                    }
                    $transaction = $this->createTransactionRecord([
                        'date' => $recordedAt,
                        'type' => 'Expense',
                        'category' => trim((string) ($systemDefaults['expense_category_id'] ?? '')) ?: 'expense_purchases',
                        'accountId' => $accountId,
                        'amount' => $paymentAmount,
                        'description' => "Payment for Bill #{$billNumber}",
                        'referenceId' => $id,
                        'contactId' => $previousVendorId,
                        'paymentMethod' => $paymentMethod,
                        'history' => [],
                    ], (string) $actor['id'], $actor);
                    $payload['paid_amount'] = $this->formatMoney($previousPaidAmount + $paymentAmount);
                } else {
                    $maxRefund = max(0.0, $previousPaidAmount - $billSettlementTotal);
                    if ($refundAmount > $maxRefund) {
                        throw new RuntimeException('Vendor refund cannot exceed the bill overpayment.');
                    }
                    $transaction = $this->createTransactionRecord([
                        'date' => $recordedAt,
                        'type' => 'Income',
                        'category' => trim((string) ($systemDefaults['income_category_id'] ?? '')) ?: 'income_other',
                        'accountId' => $accountId,
                        'amount' => $refundAmount,
                        'description' => "Vendor refund for Bill #{$billNumber}",
                        'referenceId' => $id,
                        'contactId' => $previousVendorId,
                        'paymentMethod' => $paymentMethod,
                        'history' => [],
                    ], (string) $actor['id'], $actor);
                    $payload['paid_amount'] = $this->formatMoney(max(0.0, $previousPaidAmount - $refundAmount));
                }
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

    /**
     * Process partial return on a bill (return goods to vendor).
     */
    public function processBillReturn(array $params): array
    {
        $actor = $this->currentUser();
        $billId = trim((string) ($params['billId'] ?? ''));
        $items = is_array($params['items'] ?? null) ? $params['items'] : [];

        if ($billId === '') {
            throw new RuntimeException('Bill id is required.');
        }
        if ($items === []) {
            throw new RuntimeException('At least one item must be selected for return.');
        }

        $refundAmount = (float) ($params['refundAmount'] ?? 0);
        $accountId = trim((string) ($params['accountId'] ?? ''));
        $paymentMethod = trim((string) ($params['paymentMethod'] ?? ''));
        $categoryId = trim((string) ($params['categoryId'] ?? ''));
        $note = trim((string) ($params['note'] ?? ''));
        $recordedAt = $this->normalizeDateTimeInput((string) ($params['date'] ?? $this->database->nowUtc()));

        return $this->database->transaction(function () use ($actor, $billId, $items, $refundAmount, $accountId, $paymentMethod, $categoryId, $note, $recordedAt): array {
            $billRow = $this->database->fetchOne(
                'SELECT * FROM bills WHERE id = :id AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
                [':id' => $billId]
            );

            if ($billRow === null) {
                throw new RuntimeException('Bill not found.');
            }

            $createdBy = (string) ($billRow['created_by'] ?? '');
            $actorRole = (string) ($actor['role'] ?? '');
            $hasPermission = $this->hasAdminAccess($actorRole)
                || $this->userHasScopedPermissionForRecord(
                    $actor, $createdBy,
                    'bills.processReturnOwn',
                    'bills.processReturnAny'
                );
            if (!$hasPermission) {
                throw new RuntimeException('You do not have permission to process bill returns. Enable "Bills: Process Return" in Settings → Permissions.');
            }

            $currentStatus = trim((string) ($billRow['status'] ?? ''));
            if (!in_array($currentStatus, ['Received', 'Paid'], true)) {
                throw new RuntimeException('Receive the bill before returning stocked items to the vendor.');
            }

            $billNumber = trim((string) ($billRow['bill_number'] ?? ''));
            $vendorId = trim((string) ($billRow['vendor_id'] ?? ''));
            $previousItems = $this->jsonDecodeList($billRow['items'] ?? []);
            $previousPaidAmount = (float) ($billRow['paid_amount'] ?? 0);
            $previousTotal = (float) ($billRow['total'] ?? 0);

            $localRecordedAt = (new \DateTimeImmutable($recordedAt, new \DateTimeZone('UTC')))
                ->setTimezone(new \DateTimeZone($this->config->timezone()));
            $dateLabel = $localRecordedAt->format('j M Y');
            $timeLabel = $localRecordedAt->format('h:i A');
            $actorName = trim((string) ($actor['name'] ?? 'System'));

            // Build updated items with return tracking
            $updatedItems = $previousItems;
            $returnedItemDescriptions = [];
            $totalReturnValue = 0.0;
            $stockDeltas = [];
            $processedSelections = 0;

            foreach ($items as $itemSelection) {
                $productId = trim((string) ($itemSelection['productId'] ?? ''));
                $returnQty = (int) ($itemSelection['returnQty'] ?? 0);
                if ($returnQty <= 0) continue;

                $itemIndex = array_key_exists('lineIndex', $itemSelection) ? (int) $itemSelection['lineIndex'] : -1;
                if (!isset($updatedItems[$itemIndex]) || trim((string) ($updatedItems[$itemIndex]['productId'] ?? '')) !== $productId) {
                    $itemIndex = -1;
                    foreach ($updatedItems as $idx => $item) {
                        $activeQty = max(0, (int) ($item['quantity'] ?? 0) - (int) ($item['returnedQty'] ?? 0));
                        if (trim((string) ($item['productId'] ?? '')) === $productId && $activeQty > 0) {
                            $itemIndex = $idx;
                            break;
                        }
                    }
                }
                if ($itemIndex < 0) {
                    throw new RuntimeException('A selected bill item is no longer available. Refresh and try again.');
                }

                $originalItem = $updatedItems[$itemIndex];
                $originalQty = (int) ($originalItem['quantity'] ?? 0);
                $currentReturnedQty = (int) ($originalItem['returnedQty'] ?? 0);
                $activeQty = max(0, $originalQty - $currentReturnedQty);
                $rate = (float) ($originalItem['rate'] ?? 0);
                $productName = trim((string) ($originalItem['productName'] ?? 'Unknown'));

                if ($returnQty > $activeQty) {
                    throw new RuntimeException("Only {$activeQty} unit(s) of {$productName} remain available to return.");
                }
                $effectiveReturnQty = $returnQty;

                // Update item with return tracking
                $updatedItems[$itemIndex]['returnedQty'] = $currentReturnedQty + $effectiveReturnQty;

                $returnedItemDescriptions[] = "{$productName} ×{$effectiveReturnQty}";
                $totalReturnValue += $rate * $effectiveReturnQty;
                $stockDeltas[$productId] = ($stockDeltas[$productId] ?? 0) - $effectiveReturnQty;
                $processedSelections++;
            }

            if ($processedSelections === 0) {
                throw new RuntimeException('No valid return quantity was selected.');
            }
            $stockUpdates = $this->resolveProductStockUpdates($stockDeltas, 'bill return');
            $this->applyResolvedProductStockUpdates($stockUpdates);

            $originalSubtotal = (float) ($billRow['subtotal'] ?? 0);
            $originalDiscount = (float) ($billRow['discount'] ?? 0);
            $shipping = (float) ($billRow['shipping'] ?? 0);
            $adjustment = $this->calculateReturnAdjustment(
                $originalSubtotal,
                $originalDiscount,
                $shipping,
                $previousPaidAmount,
                $totalReturnValue
            );
            $newSubtotal = $adjustment['newSubtotal'];
            $newDiscount = $adjustment['newDiscount'];
            $newTotal = $adjustment['newTotal'];
            $effectiveRefund = min(max(0.0, $refundAmount), $adjustment['maxRefund']);
            if ($effectiveRefund > 0 && $accountId === '') {
                throw new RuntimeException('Select the account that received the vendor refund.');
            }
            $newPaidAmount = max(0.0, $previousPaidAmount - $effectiveRefund);

            // Create refund transaction (income - vendor refunding us)
            $systemDefaults = $this->database->fetchOne(
                'SELECT default_payment_method, income_category_id FROM system_defaults LIMIT 1'
            ) ?? [];
            $defaultPaymentMethod = trim((string) ($systemDefaults['default_payment_method'] ?? 'Cash')) ?: 'Cash';
            $incomeCategoryId = trim((string) ($systemDefaults['income_category_id'] ?? 'income_sales')) ?: 'income_sales';
            $effectivePaymentMethod = $paymentMethod ?: $defaultPaymentMethod;

            if ($effectiveRefund > 0) {
                    $this->createTransactionRecord([
                        'date' => $recordedAt,
                        'type' => 'Income',
                        'category' => $incomeCategoryId,
                        'accountId' => $accountId,
                        'amount' => $effectiveRefund,
                        'description' => "Vendor return refund for Bill #{$billNumber}",
                        'referenceId' => $billId,
                        'contactId' => $vendorId,
                        'paymentMethod' => $effectivePaymentMethod,
                        'history' => [],
                    ], (string) $actor['id'], $actor);
            }

            // Build history
            $history = $this->jsonDecodeAssoc($billRow['history'] ?? []);
            $historyLines = [];
            if ($returnedItemDescriptions !== []) {
                $historyLines[] = 'Returned: ' . implode(', ', $returnedItemDescriptions);
            }
            if ($effectiveRefund > 0) {
                $historyLines[] = 'Refunded: ' . $this->formatMoney($effectiveRefund);
            }
            if ($note !== '') {
                $historyLines[] = 'Note: ' . $note;
            }
            $history['return'] = $this->appendHistoryText(
                (string) ($history['return'] ?? ''),
                trim(
                    "Return processed by {$actorName} on {$dateLabel} at {$timeLabel}. "
                    . implode('. ', $historyLines)
                )
            );

            // Update bill
            $payload = [
                'items' => $this->jsonEncode($updatedItems),
                'subtotal' => $this->formatMoney($newSubtotal),
                'discount' => $this->formatMoney($newDiscount),
                'total' => $this->formatMoney($newTotal),
                'paid_amount' => $this->formatMoney($newPaidAmount),
                'history' => $this->jsonEncode($history),
            ];
            $hasActiveItems = false;
            foreach ($updatedItems as $updatedItem) {
                if ((int) ($updatedItem['quantity'] ?? 0) - (int) ($updatedItem['returnedQty'] ?? 0) > 0) {
                    $hasActiveItems = true;
                    break;
                }
            }
            if (!$hasActiveItems) {
                $payload['status'] = 'Returned';
                $history['returned'] = "Fully returned to vendor by {$actorName} on {$dateLabel} at {$timeLabel}.";
                $payload['history'] = $this->jsonEncode($history);
            }
            $this->touchUpdate('bills', $billId, $payload);

            // Sync vendor summary
            $this->syncVendorPurchaseSummaries([$vendorId]);

            // Reload and return
            $row = $this->fetchBillRowById($billId);
            if ($row === null) {
                throw new RuntimeException('Updated bill could not be loaded.');
            }
            return $this->mapBill($row);
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
        if (!empty($filters['typeNot'])) {
            $where .= ' AND twr.type <> :type_not';
            $bindings[':type_not'] = trim((string) $filters['typeNot']);
        }
        if (!empty($filters['category'])) {
            $where .= ' AND twr.category = :category';
            $bindings[':category'] = trim((string) $filters['category']);
        }
        if (!empty($filters['categoryNot'])) {
            $where .= ' AND twr.category <> :category_not';
            $bindings[':category_not'] = trim((string) $filters['categoryNot']);
        }
        $this->appendEncodedTextFilter($where, $bindings, 'twr.accountName', trim((string) ($filters['account'] ?? '')), 'transaction_account');
        $this->appendEncodedTextFilter($where, $bindings, 'twr.accountName', trim((string) ($filters['accountNot'] ?? '')), 'transaction_account_not', true);
        $this->appendEncodedTextFilter($where, $bindings, 'twr.contactName', trim((string) ($filters['contact'] ?? '')), 'transaction_contact');
        $this->appendEncodedTextFilter($where, $bindings, 'twr.contactName', trim((string) ($filters['contactNot'] ?? '')), 'transaction_contact_not', true);
        $this->appendEncodedTextFilter($where, $bindings, 'twr.paymentMethod', trim((string) ($filters['paymentMethod'] ?? '')), 'transaction_method');
        $this->appendEncodedTextFilter($where, $bindings, 'twr.paymentMethod', trim((string) ($filters['paymentMethodNot'] ?? '')), 'transaction_method_not', true);
        $approvalStatus = trim((string) ($filters['approvalStatus'] ?? ''));
        if ($approvalStatus !== '') {
            $where .= ' AND COALESCE(twr.approvalStatus, "approved") = :approval_status';
            $bindings[':approval_status'] = $approvalStatus;
        }
        $approvalStatusNot = trim((string) ($filters['approvalStatusNot'] ?? ''));
        if ($approvalStatusNot !== '') {
            $where .= ' AND COALESCE(twr.approvalStatus, "approved") <> :approval_status_not';
            $bindings[':approval_status_not'] = $approvalStatusNot;
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
        $createdByNotIds = is_array($filters['createdByNotIds'] ?? null) ? array_values(array_filter(array_map('strval', $filters['createdByNotIds']))) : [];
        if ($createdByNotIds !== []) {
            [$placeholders, $notBindings] = $this->inClause($createdByNotIds, 'transaction_created_by_not');
            $where .= ' AND twr.createdBy NOT IN (' . implode(', ', $placeholders) . ')';
            $bindings += $notBindings;
        }

        $countRow = $this->database->fetchOne("SELECT COUNT(*) AS count FROM transactions_with_relations twr {$where}", $bindings);
        $summaryRow = $this->database->fetchOne(
            "SELECT
                COALESCE(SUM(CASE WHEN twr.type = 'Income' THEN twr.amount ELSE 0 END), 0) AS income,
                COALESCE(SUM(CASE WHEN twr.type = 'Expense' THEN twr.amount ELSE 0 END), 0) AS expense,
                COALESCE(SUM(CASE WHEN twr.type = 'Transfer' THEN twr.amount ELSE 0 END), 0) AS transfer
             FROM transactions_with_relations twr {$where}",
            $bindings
        ) ?? [];
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
            'summary' => [
                'income' => (float) ($summaryRow['income'] ?? 0),
                'expense' => (float) ($summaryRow['expense'] ?? 0),
                'transfer' => (float) ($summaryRow['transfer'] ?? 0),
            ],
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
                ':attachment_url' => $this->normalizeUploadedFileValue($params['attachmentUrl'] ?? null, 'attachments', $params['attachmentName'] ?? null),
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
            if ($this->database->fetchOne(
                'SELECT id FROM wallet_payouts WHERE transaction_id = :transaction_id LIMIT 1',
                [':transaction_id' => $id]
            ) !== null) {
                throw new RuntimeException('Payroll transactions must be changed or removed from the payroll page.');
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
                $payload['attachment_url'] = $this->normalizeUploadedFileValue($updates['attachmentUrl'] ?? null, 'attachments', $updates['attachmentName'] ?? null);
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
            if ($this->database->fetchOne(
                'SELECT id FROM wallet_payouts WHERE transaction_id = :transaction_id LIMIT 1',
                [':transaction_id' => $id]
            ) !== null) {
                throw new RuntimeException('Payroll transactions must be removed from the payroll page so wallet and ledger balances stay synchronized.');
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
                    source_order_number, wallet_payout_id, payroll_payment_id, note, created_at, created_by
                ) VALUES (
                    :id, :employee_id, :entry_type, :amount_delta, :unit_amount_snapshot, :source_order_id,
                    :source_order_number, :wallet_payout_id, :payroll_payment_id, :note, :created_at, :created_by
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
                    ':payroll_payment_id' => $this->nullableString($row['payroll_payment_id'] ?? null),
                    ':note' => $this->nullableString($row['note'] ?? null),
                    ':created_at' => $this->normalizeDateTimeInput((string) ($row['created_at'] ?? $this->database->nowUtc())),
                    ':created_by' => $this->nullableString($row['created_by'] ?? null),
                ]
            );
        }
    }

    /** @return array{entryType: string, amountDelta: float}|null */
    private function walletOrderTransition(float $activeAmount, bool $isPayable, float $unitAmount): ?array
    {
        $activeAmount = round($activeAmount, 2);
        $unitAmount = round(max(0.0, $unitAmount), 2);
        if ($isPayable) {
            if ($unitAmount <= 0 || $activeAmount > 0) {
                return null;
            }
            return ['entryType' => 'order_credit', 'amountDelta' => round($unitAmount - $activeAmount, 2)];
        }
        if ($activeAmount <= 0) {
            return null;
        }
        return ['entryType' => 'order_reversal', 'amountDelta' => -$activeAmount];
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

        // Serialize status transitions and credit/reversal evaluation for one
        // order. This is especially important now that re-eligibility appends
        // a new credit event instead of deleting reversal history.
        $lockedOrder = $this->database->fetchOne(
            'SELECT id FROM orders WHERE id = :id LIMIT 1 FOR UPDATE',
            [':id' => $orderId]
        );
        if ($lockedOrder === null) {
            return;
        }

        if (!$this->isWalletEligibleOrderDate((string) ($order['orderDate'] ?? ''), (string) ($order['createdAt'] ?? ''))) {
            return;
        }

        $creator = $this->database->fetchOne(
            'SELECT id, role, is_commission_based, fixed_salary FROM users WHERE id = :id AND deleted_at IS NULL LIMIT 1',
            [':id' => $createdBy]
        );
        if ($creator === null || !$this->isEmployeeRole((string) ($creator['role'] ?? ''))) {
            return;
        }

        // Legacy employee rows have false + no salary. They remain commission
        // based until a positive fixed salary is deliberately configured.
        $fixedSalary = ($creator['fixed_salary'] ?? null) !== null ? (float) $creator['fixed_salary'] : null;
        $isCommissionBased = !empty($creator['is_commission_based'] ?? false)
            || $fixedSalary === null
            || $fixedSalary <= 0;
        if (!$isCommissionBased) {
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
        $activeAmount = 0.0;
        $lastUnitSnapshot = null;
        foreach ($entries as $entry) {
            $activeAmount += (float) ($entry['amount_delta'] ?? 0);
            if (($entry['entry_type'] ?? '') === 'order_credit' && ($entry['unit_amount_snapshot'] ?? null) !== null) {
                $lastUnitSnapshot = (float) $entry['unit_amount_snapshot'];
            }
        }
        $activeAmount = round($activeAmount, 2);
        $isPayable = $this->isWalletStatusPayable($status, $countedStatuses);
        $unitAmount = round((float) ($effectiveSettings['unitAmount'] ?? 0), 2);
        $transition = $this->walletOrderTransition($activeAmount, $isPayable, $unitAmount);
        if ($transition === null) {
            return;
        }

        if ($transition['entryType'] === 'order_credit') {
                // Append a new event instead of deleting reversal history. This
                // gives late/re-eligible work a new accrual date and preserves
                // the exact credit -> reversal -> re-credit audit trail.
                $this->insertWalletEntryRows([
                    [
                        'employee_id' => $createdBy,
                        'entry_type' => 'order_credit',
                        'amount_delta' => $transition['amountDelta'],
                        'unit_amount_snapshot' => $unitAmount,
                        'source_order_id' => $orderId,
                        'source_order_number' => $order['orderNumber'] ?? null,
                        'note' => $entries === []
                            ? 'Wallet credit added because the order entered a payable status.'
                            : 'Wallet credit re-accrued because the order returned to a payable status.',
                        'created_at' => $now,
                        'created_by' => $actorId !== '' ? $actorId : $createdBy,
                    ]
                ]);
            return;
        }

        $this->insertWalletEntryRows([
                [
                    'employee_id' => $createdBy,
                    'entry_type' => 'order_reversal',
                    'amount_delta' => $transition['amountDelta'],
                    'unit_amount_snapshot' => $lastUnitSnapshot ?? $activeAmount,
                    'source_order_id' => $orderId,
                    'source_order_number' => $order['orderNumber'] ?? null,
                    'note' => 'Wallet credit reversed because the order is not in a payable status.',
                    'created_at' => $now,
                    'created_by' => $actorId !== '' ? $actorId : $createdBy,
                ]
            ]);
    }

    /**
     * @param array<string, mixed> $params
     */
    private function ensureDeletedOrderWalletReversal(array $params): void
    {
        if (!$this->isWalletEligibleOrderDate((string) ($params['orderDate'] ?? ''), (string) ($params['createdAt'] ?? ''))) {
            return;
        }

        $walletState = $this->database->fetchOne(
            "SELECT COALESCE(SUM(amount_delta), 0) AS active_amount,
                    MAX(CASE WHEN entry_type = 'order_credit' THEN unit_amount_snapshot ELSE NULL END) AS unit_snapshot
             FROM wallet_entries
             WHERE source_order_id = :source_order_id
               AND entry_type IN ('order_credit', 'order_reversal')",
            [':source_order_id' => trim((string) ($params['id'] ?? ''))]
        );

        $activeAmount = round((float) ($walletState['active_amount'] ?? 0), 2);
        if ($activeAmount <= 0) {
            return;
        }
        $this->insertWalletEntryRows([
            [
                'employee_id' => (string) ($params['createdBy'] ?? ''),
                'entry_type' => 'order_reversal',
                'amount_delta' => -$activeAmount,
                'unit_amount_snapshot' => $walletState['unit_snapshot'] ?? $activeAmount,
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
             WHERE deleted_at IS NULL
               AND created_at >= :wallet_cutoff_at
               AND created_by IN (' . implode(', ', $placeholders) . ')',
            $bindings + [':wallet_cutoff_at' => $this->walletCutoffAtUtc()]
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
     * @param array<string, mixed> $params
     * @return array{0: string, 1: string}
     */
    private function requirePayrollPeriod(array $params): array
    {
        $periodStart = $this->normalizeDateOnly((string) ($params['periodStart'] ?? ''));
        $periodEnd = $this->normalizeDateOnly((string) ($params['periodEnd'] ?? ''));
        foreach ([$periodStart, $periodEnd] as $date) {
            $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $date, new \DateTimeZone('UTC'));
            if (!$parsed instanceof \DateTimeImmutable || $parsed->format('Y-m-d') !== $date) {
                throw new RuntimeException('A valid payroll start and end date are required.');
            }
        }
        if ($periodStart > $periodEnd) {
            throw new RuntimeException('Payroll period start cannot be after its end date.');
        }

        return [$periodStart, $periodEnd];
    }

    private function calculateFixedSalaryForPeriod(float $monthlySalary, string $periodStart, string $periodEnd): float
    {
        if ($monthlySalary <= 0 || $periodStart === '' || $periodEnd === '' || $periodStart > $periodEnd) {
            return 0.0;
        }

        $timezone = new \DateTimeZone('UTC');
        $cursor = new \DateTimeImmutable($periodStart . ' 00:00:00', $timezone);
        $end = new \DateTimeImmutable($periodEnd . ' 00:00:00', $timezone);
        $amount = 0.0;

        while ($cursor <= $end) {
            $monthEnd = $cursor->modify('last day of this month');
            $segmentEnd = $monthEnd < $end ? $monthEnd : $end;
            $coveredDays = (int) $cursor->diff($segmentEnd)->format('%a') + 1;
            $amount += $monthlySalary * ($coveredDays / (int) $cursor->format('t'));
            $cursor = $segmentEnd->modify('+1 day');
        }

        return round($amount, 2);
    }

    /**
     * @param array<int, array{accrualDate: string, grossAmount: float, remainingAmount: float}> $buckets
     * @param array<int, array{amount: float, periodStart: string, periodEnd: string}> $periodSettlements
     * @param array<int, float> $fifoSettlements
     * @return array{buckets: array<int, array{accrualDate: string, grossAmount: float, remainingAmount: float}>, carry: float}
     */
    private function allocateCommissionSettlementBuckets(
        array $buckets,
        array $periodSettlements,
        array $fifoSettlements
    ): array {
        $allocate = static function (array &$targetBuckets, float $amount, ?callable $accept = null): float {
            $remaining = round(max(0.0, $amount), 2);
            foreach ($targetBuckets as &$bucket) {
                if ($remaining <= 0) {
                    break;
                }
                if ($accept !== null && !$accept($bucket)) {
                    continue;
                }
                $available = max(0.0, (float) ($bucket['remainingAmount'] ?? 0));
                if ($available <= 0) {
                    continue;
                }
                $applied = min($available, $remaining);
                $bucket['remainingAmount'] = round($available - $applied, 2);
                $remaining = round($remaining - $applied, 2);
            }
            unset($bucket);
            return $remaining;
        };

        $carry = 0.0;
        foreach ($periodSettlements as $settlement) {
            $periodStart = (string) ($settlement['periodStart'] ?? '');
            $periodEnd = (string) ($settlement['periodEnd'] ?? '');
            $carry += $allocate(
                $buckets,
                (float) ($settlement['amount'] ?? 0),
                static fn(array $bucket): bool =>
                    (string) $bucket['accrualDate'] >= $periodStart && (string) $bucket['accrualDate'] <= $periodEnd
            );
        }
        foreach ($fifoSettlements as $amount) {
            $carry += max(0.0, (float) $amount);
        }
        $carry = $allocate($buckets, $carry);

        return ['buckets' => $buckets, 'carry' => round($carry, 2)];
    }

    /**
     * Commission payroll must use immutable wallet credit snapshots, not the
     * current global rate, otherwise changing settings rewrites old earnings.
     *
     * @param array<int, string> $employeeIds
     * @return array<string, array{orderCount: int, baseAmount: float}>
     */
    private function fetchCommissionPayrollMetricsByEmployeeIds(
        array $employeeIds,
        string $periodStart,
        string $periodEnd
    ): array {
        $employeeIds = array_values(array_unique(array_filter(
            array_map(static fn($id): string => trim((string) $id), $employeeIds),
            static fn(string $id): bool => $id !== ''
        )));
        if ($employeeIds === []) {
            return [];
        }

        [$placeholders, $bindings] = $this->inClause($employeeIds, 'commission_employee');
        $rows = $this->database->fetchAll(
            "SELECT we.employee_id, we.source_order_id, we.entry_type, we.amount_delta,
                    we.created_at AS entry_created_at, o.deleted_at AS order_deleted_at
             FROM wallet_entries we
             INNER JOIN orders o ON o.id = we.source_order_id
             WHERE we.employee_id IN (" . implode(', ', $placeholders) . ")
               AND we.entry_type IN ('order_credit', 'order_reversal')",
            $bindings
        );

        $orders = [];
        foreach ($rows as $row) {
            $employeeId = trim((string) ($row['employee_id'] ?? ''));
            $orderId = trim((string) ($row['source_order_id'] ?? ''));
            if ($employeeId === '' || $orderId === '' || ($row['order_deleted_at'] ?? null) !== null) {
                continue;
            }
            $key = $employeeId . "\0" . $orderId;
            if (!isset($orders[$key])) {
                $orders[$key] = ['employeeId' => $employeeId, 'amount' => 0.0, 'accrualDate' => ''];
            }
            $orders[$key]['amount'] += (float) ($row['amount_delta'] ?? 0);
            if ((string) ($row['entry_type'] ?? '') === 'order_credit') {
                $entryAt = $this->toIso($row['entry_created_at'] ?? null) ?? (string) ($row['entry_created_at'] ?? '');
                $accrualDate = $this->localDateFromUtc($entryAt);
                if ($accrualDate > (string) $orders[$key]['accrualDate']) {
                    $orders[$key]['accrualDate'] = $accrualDate;
                }
            }
        }

        $buckets = [];
        foreach ($orders as $order) {
            $amount = round((float) ($order['amount'] ?? 0), 2);
            if ($amount <= 0) {
                continue;
            }
            $accrualDate = (string) ($order['accrualDate'] ?? '');
            if ($accrualDate === '') {
                continue;
            }
            $employeeId = (string) $order['employeeId'];
            $buckets[$employeeId][] = [
                'accrualDate' => $accrualDate,
                'grossAmount' => $amount,
                'remainingAmount' => $amount,
            ];
        }
        foreach ($buckets as &$employeeBuckets) {
            usort($employeeBuckets, static fn(array $left, array $right): int =>
                strcmp((string) $left['accrualDate'], (string) $right['accrualDate'])
            );
        }
        unset($employeeBuckets);

        $paymentRows = $this->database->fetchAll(
            "SELECT employee_id, period_start, period_end, base_amount_snapshot,
                    bonus_amount, deduction_amount, amount_snapshot,
                    wallet_payout_id, transaction_id, paid_at
             FROM payroll_payments
             WHERE compensation_type = 'commission'
               AND employee_id IN (" . implode(', ', $placeholders) . ")
             ORDER BY paid_at ASC",
            $bindings
        );
        $legacyPayoutRows = $this->database->fetchAll(
            "SELECT employee_id, amount, paid_at
             FROM wallet_payouts
             WHERE payroll_payment_id IS NULL
               AND employee_id IN (" . implode(', ', $placeholders) . ")
             ORDER BY paid_at ASC",
            $bindings
        );

        $settlementCarry = [];
        $basePaid = [];
        $unlinkedPayrollPaid = [];
        $unlinkedPayrollBonuses = [];
        $unlinkedPayrollDeductions = [];
        $periodSettlements = [];
        $fifoSettlements = [];

        // Period-linked payroll settlements take precedence over legacy FIFO
        // payouts. Any excess becomes carry and offsets later outstanding work.
        foreach ($paymentRows as $payment) {
            $employeeId = (string) ($payment['employee_id'] ?? '');
            $base = max(0.0, (float) ($payment['base_amount_snapshot'] ?? 0));
            $isLegacySnapshot = $base === 0.0
                && (float) ($payment['amount_snapshot'] ?? 0) > 0
                && (float) ($payment['bonus_amount'] ?? 0) === 0.0
                && (float) ($payment['deduction_amount'] ?? 0) === 0.0
                && trim((string) ($payment['wallet_payout_id'] ?? '')) === ''
                && trim((string) ($payment['transaction_id'] ?? '')) === '';
            if ($isLegacySnapshot) {
                $base = (float) $payment['amount_snapshot'];
            }
            if ($employeeId === '' || $base <= 0) {
                continue;
            }
            $basePaid[$employeeId] = ($basePaid[$employeeId] ?? 0.0) + $base;
            $rowStart = (string) ($payment['period_start'] ?? '');
            $rowEnd = (string) ($payment['period_end'] ?? '');
            $periodSettlements[$employeeId][] = [
                'amount' => $base,
                'periodStart' => $rowStart,
                'periodEnd' => $rowEnd,
            ];
            if (trim((string) ($payment['wallet_payout_id'] ?? '')) === '') {
                $unlinkedPayrollPaid[$employeeId] = ($unlinkedPayrollPaid[$employeeId] ?? 0.0)
                    + max(0.0, (float) ($payment['amount_snapshot'] ?? 0));
                $unlinkedPayrollBonuses[$employeeId] = ($unlinkedPayrollBonuses[$employeeId] ?? 0.0)
                    + max(0.0, (float) ($payment['bonus_amount'] ?? 0));
                $unlinkedPayrollDeductions[$employeeId] = ($unlinkedPayrollDeductions[$employeeId] ?? 0.0)
                    + max(0.0, (float) ($payment['deduction_amount'] ?? 0));
            }
        }
        foreach ($legacyPayoutRows as $payout) {
            $employeeId = (string) ($payout['employee_id'] ?? '');
            $amount = max(0.0, (float) ($payout['amount'] ?? 0));
            if ($employeeId === '' || $amount <= 0) {
                continue;
            }
            $basePaid[$employeeId] = ($basePaid[$employeeId] ?? 0.0) + $amount;
            $fifoSettlements[$employeeId][] = $amount;
        }

        foreach ($employeeIds as $employeeId) {
            $allocation = $this->allocateCommissionSettlementBuckets(
                $buckets[$employeeId] ?? [],
                $periodSettlements[$employeeId] ?? [],
                $fifoSettlements[$employeeId] ?? []
            );
            $buckets[$employeeId] = $allocation['buckets'];
            $settlementCarry[$employeeId] = (float) $allocation['carry'];
        }

        $metrics = [];
        foreach ($employeeIds as $employeeId) {
            $employeeBuckets = $buckets[$employeeId] ?? [];
            $selectedCount = 0;
            $selectedGross = 0.0;
            $selectedOutstanding = 0.0;
            $totalGross = 0.0;
            $totalOutstanding = 0.0;
            foreach ($employeeBuckets as $bucket) {
                $gross = max(0.0, (float) ($bucket['grossAmount'] ?? 0));
                $remaining = max(0.0, (float) ($bucket['remainingAmount'] ?? 0));
                $totalGross += $gross;
                $totalOutstanding += $remaining;
                $date = (string) ($bucket['accrualDate'] ?? '');
                if ($date >= $periodStart && $date <= $periodEnd) {
                    $selectedCount++;
                    $selectedGross += $gross;
                    $selectedOutstanding += $remaining;
                }
            }
            $carry = max(0.0, (float) ($settlementCarry[$employeeId] ?? 0));
            $metrics[$employeeId] = [
                'orderCount' => $selectedCount,
                'baseAmount' => round($selectedOutstanding, 2),
                'grossBaseAmount' => round($selectedGross, 2),
                'baseEarned' => round($totalGross, 2),
                'basePaid' => round((float) ($basePaid[$employeeId] ?? 0), 2),
                'totalOutstanding' => round($totalOutstanding - $carry, 2),
                'settlementCarry' => round($carry, 2),
                'unlinkedPayrollPaid' => round((float) ($unlinkedPayrollPaid[$employeeId] ?? 0), 2),
                'unlinkedPayrollBonuses' => round((float) ($unlinkedPayrollBonuses[$employeeId] ?? 0), 2),
                'unlinkedPayrollDeductions' => round((float) ($unlinkedPayrollDeductions[$employeeId] ?? 0), 2),
            ];
        }

        return $metrics;
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
                    'baseEarned' => 0.0,
                    'totalEarned' => 0.0,
                    'totalPaid' => 0.0,
                    'totalBonuses' => 0.0,
                    'totalDeductions' => 0.0,
                    'lastActivityAt' => null,
                ];
            }

            $amount = (float) ($row['amount_delta'] ?? 0);
            $aggregates[$employeeId]['currentBalance'] += $amount;
            if (in_array($entryType, ['order_credit', 'order_reversal'], true)) {
                $aggregates[$employeeId]['baseEarned'] += $amount;
            }
            if ($entryType === 'payroll_bonus') {
                $aggregates[$employeeId]['totalBonuses'] += max(0.0, $amount);
            }
            if ($entryType === 'payroll_deduction') {
                $aggregates[$employeeId]['totalDeductions'] += abs($amount);
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
            $aggregates[$employeeId]['baseEarned'] = round((float) ($aggregate['baseEarned'] ?? 0), 2);
            $aggregates[$employeeId]['totalBonuses'] = round((float) ($aggregate['totalBonuses'] ?? 0), 2);
            $aggregates[$employeeId]['totalDeductions'] = round((float) ($aggregate['totalDeductions'] ?? 0), 2);
            $aggregates[$employeeId]['totalEarned'] = round(
                (float) $aggregates[$employeeId]['baseEarned'] + (float) $aggregates[$employeeId]['totalBonuses'],
                2
            );
            $aggregates[$employeeId]['totalPaid'] = round((float) ($aggregate['totalPaid'] ?? 0), 2);
        }

        return $aggregates;
    }

    /**
     * @param array<int, string> $employeeIds
     * @return array<string, float>
     */
    private function fetchCommissionBasePaidByEmployeeIds(array $employeeIds): array
    {
        if ($employeeIds === []) {
            return [];
        }
        [$placeholders, $bindings] = $this->inClause($employeeIds, 'commission_paid_employee');
        $rows = $this->database->fetchAll(
            "SELECT employee_id,
                    COALESCE(SUM(CASE
                        WHEN base_amount_snapshot = 0
                         AND amount_snapshot > 0
                         AND bonus_amount = 0
                         AND deduction_amount = 0
                         AND wallet_payout_id IS NULL
                         AND transaction_id IS NULL
                        THEN amount_snapshot
                        ELSE base_amount_snapshot
                    END), 0) AS base_paid
             FROM payroll_payments
             WHERE compensation_type = 'commission'
               AND employee_id IN (" . implode(', ', $placeholders) . ")
             GROUP BY employee_id",
            $bindings
        );

        $result = [];
        foreach ($rows as $row) {
            $result[(string) $row['employee_id']] = round((float) ($row['base_paid'] ?? 0), 2);
        }
        return $result;
    }

    /**
     * @param array<int, string> $employeeIds
     * @return array<string, array{basePaid: float, totalBonuses: float, totalDeductions: float, totalPaid: float, lastActivityAt: ?string}>
     */
    private function fetchFixedPayrollWalletMetricsByEmployeeIds(
        array $employeeIds,
        string $periodStart,
        string $periodEnd
    ): array {
        if ($employeeIds === []) {
            return [];
        }
        [$placeholders, $bindings] = $this->inClause($employeeIds, 'fixed_metric_employee');
        $bindings[':fixed_period_start'] = $periodStart;
        $bindings[':fixed_period_end'] = $periodEnd;
        $rows = $this->database->fetchAll(
            "SELECT employee_id, period_start, period_end, fixed_salary_snapshot,
                    base_amount_snapshot, bonus_amount, deduction_amount, amount_snapshot, paid_at
             FROM payroll_payments
             WHERE compensation_type = 'fixed'
               AND employee_id IN (" . implode(', ', $placeholders) . ")
               AND period_start <= :fixed_period_end
               AND period_end >= :fixed_period_start",
            $bindings
        );

        $metrics = [];
        $ensure = static function (array &$target, string $employeeId): void {
            if (!isset($target[$employeeId])) {
                $target[$employeeId] = [
                    'basePaid' => 0.0,
                    'totalBonuses' => 0.0,
                    'totalDeductions' => 0.0,
                    'totalPaid' => 0.0,
                    'lastActivityAt' => null,
                ];
            }
        };

        foreach ($rows as $row) {
            $employeeId = trim((string) ($row['employee_id'] ?? ''));
            if ($employeeId === '') {
                continue;
            }
            $rowStart = (string) ($row['period_start'] ?? '');
            $rowEnd = (string) ($row['period_end'] ?? '');
            $intersectionStart = max($periodStart, $rowStart);
            $intersectionEnd = min($periodEnd, $rowEnd);
            if ($intersectionStart > $intersectionEnd) {
                continue;
            }

            $fullBase = max(0.0, (float) ($row['base_amount_snapshot'] ?? 0));
            $salarySnapshot = max(0.0, (float) ($row['fixed_salary_snapshot'] ?? 0));
            if ($salarySnapshot > 0) {
                $calculatedFullBase = $this->calculateFixedSalaryForPeriod($salarySnapshot, $rowStart, $rowEnd);
                $calculatedIntersection = $this->calculateFixedSalaryForPeriod($salarySnapshot, $intersectionStart, $intersectionEnd);
                $ratio = $calculatedFullBase > 0 ? min(1.0, $calculatedIntersection / $calculatedFullBase) : 0.0;
            } else {
                $fullDays = (new \DateTimeImmutable($rowStart))->diff(new \DateTimeImmutable($rowEnd))->days + 1;
                $intersectionDays = (new \DateTimeImmutable($intersectionStart))->diff(new \DateTimeImmutable($intersectionEnd))->days + 1;
                $ratio = $fullDays > 0 ? min(1.0, $intersectionDays / $fullDays) : 0.0;
            }

            $ensure($metrics, $employeeId);
            $metrics[$employeeId]['basePaid'] += $fullBase * $ratio;
            $metrics[$employeeId]['totalBonuses'] += max(0.0, (float) ($row['bonus_amount'] ?? 0)) * $ratio;
            $metrics[$employeeId]['totalDeductions'] += max(0.0, (float) ($row['deduction_amount'] ?? 0)) * $ratio;
            $metrics[$employeeId]['totalPaid'] += max(0.0, (float) ($row['amount_snapshot'] ?? 0)) * $ratio;
            $paidAt = $this->toIso($row['paid_at'] ?? null);
            if ($paidAt !== null && ($metrics[$employeeId]['lastActivityAt'] === null || $paidAt > $metrics[$employeeId]['lastActivityAt'])) {
                $metrics[$employeeId]['lastActivityAt'] = $paidAt;
            }
        }

        // Legacy wallet payouts had no payroll period. Assign them to the local
        // month in which they were paid so upgrades do not resurrect salary due.
        $legacyRows = $this->database->fetchAll(
            "SELECT employee_id, amount, paid_at
             FROM wallet_payouts
             WHERE payroll_payment_id IS NULL
               AND employee_id IN (" . implode(', ', $placeholders) . ")",
            array_filter($bindings, static fn($key): bool => !in_array($key, [':fixed_period_start', ':fixed_period_end'], true), ARRAY_FILTER_USE_KEY)
        );
        foreach ($legacyRows as $row) {
            $employeeId = trim((string) ($row['employee_id'] ?? ''));
            $paidAt = $this->toIso($row['paid_at'] ?? null);
            $localPaidDate = $this->localDateFromUtc($paidAt);
            if ($employeeId === '' || $localPaidDate < $periodStart || $localPaidDate > $periodEnd) {
                continue;
            }
            $ensure($metrics, $employeeId);
            $legacyAmount = max(0.0, (float) ($row['amount'] ?? 0));
            $metrics[$employeeId]['basePaid'] += $legacyAmount;
            $metrics[$employeeId]['totalPaid'] += $legacyAmount;
            if ($paidAt !== null && ($metrics[$employeeId]['lastActivityAt'] === null || $paidAt > $metrics[$employeeId]['lastActivityAt'])) {
                $metrics[$employeeId]['lastActivityAt'] = $paidAt;
            }
        }

        foreach ($metrics as &$metric) {
            foreach (['basePaid', 'totalBonuses', 'totalDeductions', 'totalPaid'] as $key) {
                $metric[$key] = round((float) $metric[$key], 2);
            }
        }
        unset($metric);
        return $metrics;
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
        $walletAmounts = $this->fetchLiveWalletAmountsByEmployeeIds($employeeIds);
        $localNow = new \DateTimeImmutable('now', new \DateTimeZone($this->config->timezone()));
        $currentLocalDate = $localNow->format('Y-m-d');
        $monthStart = $localNow->modify('first day of this month')->format('Y-m-d');
        $monthEnd = $localNow->modify('last day of this month')->format('Y-m-d');
        $commissionMetrics = $this->fetchCommissionPayrollMetricsByEmployeeIds(
            $employeeIds,
            $this->walletCutoffDate(),
            $currentLocalDate
        );
        $fixedMetrics = $this->fetchFixedPayrollWalletMetricsByEmployeeIds($employeeIds, $monthStart, $monthEnd);

        $cards = [];
        foreach ($employees as $employee) {
            $employeeId = (string) ($employee['id'] ?? '');
            if ($employeeId === '') {
                continue;
            }

            $isCommissionBased = !empty($employee['isCommissionBased'] ?? false);
            $fixedSalary = isset($employee['fixedSalary']) ? (float) $employee['fixedSalary'] : null;
            $walletAmount = $walletAmounts[$employeeId] ?? [];

            if (!$isCommissionBased) {
                $periodMetrics = $fixedMetrics[$employeeId] ?? [];
                $baseEarned = max(0.0, (float) ($fixedSalary ?? 0));
                $basePaid = max(0.0, (float) ($periodMetrics['basePaid'] ?? 0));
                $totalBonuses = max(0.0, (float) ($periodMetrics['totalBonuses'] ?? 0));
                $totalDeductions = max(0.0, (float) ($periodMetrics['totalDeductions'] ?? 0));
                $totalPaid = max(0.0, (float) ($periodMetrics['totalPaid'] ?? 0));
                $totalEarned = $baseEarned + $totalBonuses;
                $currentBalance = max(0.0, $baseEarned + $totalBonuses - $totalDeductions - $totalPaid);
                $creditedOrders = 0;
                $balancePeriodStart = $monthStart;
                $balancePeriodEnd = $monthEnd;
                $lastActivityAt = $periodMetrics['lastActivityAt'] ?? ($walletAmount['lastActivityAt'] ?? null);
            } else {
                $periodMetrics = $commissionMetrics[$employeeId] ?? [];
                $baseEarned = max(0.0, (float) ($periodMetrics['baseEarned'] ?? 0));
                $basePaid = max(0.0, (float) ($periodMetrics['basePaid'] ?? 0));
                $totalBonuses = max(0.0, (float) ($walletAmount['totalBonuses'] ?? 0))
                    + max(0.0, (float) ($periodMetrics['unlinkedPayrollBonuses'] ?? 0));
                $totalDeductions = max(0.0, (float) ($walletAmount['totalDeductions'] ?? 0))
                    + max(0.0, (float) ($periodMetrics['unlinkedPayrollDeductions'] ?? 0));
                $currentBalance = (float) ($periodMetrics['totalOutstanding'] ?? 0);
                $totalEarned = $baseEarned + $totalBonuses;
                $totalPaid = (float) ($walletAmount['totalPaid'] ?? 0)
                    + max(0.0, (float) ($periodMetrics['unlinkedPayrollPaid'] ?? 0));
                $creditedOrders = (int) ($commissionMetrics[$employeeId]['orderCount'] ?? 0);
                $balancePeriodStart = $this->walletCutoffDate();
                $balancePeriodEnd = $currentLocalDate;
                $lastActivityAt = $walletAmount['lastActivityAt'] ?? null;
            }

            $cards[] = [
                'employeeId' => $employeeId,
                'employeeName' => (string) ($employee['name'] ?? 'Unknown Employee'),
                'employeeRole' => (string) ($employee['role'] ?? 'Employee'),
                'isCommissionBased' => $isCommissionBased,
                'compensationType' => $isCommissionBased ? 'commission' : 'fixed',
                'fixedSalary' => $fixedSalary,
                'balancePeriodStart' => $balancePeriodStart,
                'balancePeriodEnd' => $balancePeriodEnd,
                'baseEarned' => round($baseEarned, 2),
                'basePaid' => round($basePaid, 2),
                'totalBonuses' => round($totalBonuses, 2),
                'totalDeductions' => round($totalDeductions, 2),
                'carryAdjustment' => round(min(0.0, $currentBalance), 2),
                'currentBalance' => round($currentBalance, 2),
                'totalEarned' => round($totalEarned, 2),
                'totalPaid' => round($totalPaid, 2),
                'creditedOrders' => $creditedOrders,
                'lastActivityAt' => $lastActivityAt,
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
     * Find an employee by ID from an array of employees.
     */
    private function findEmployeeById(array $employees, string $id): ?array
    {
        foreach ($employees as $employee) {
            if ((string) ($employee['id'] ?? '') === $id) {
                return $employee;
            }
        }
        return null;
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
                $summary['totalBalance'] += max(0.0, (float) ($card['currentBalance'] ?? 0));
                $summary['totalCarryAdjustments'] += min(0.0, (float) ($card['currentBalance'] ?? 0));
                $summary['totalEarned'] += (float) ($card['totalEarned'] ?? 0);
                $summary['totalPaid'] += (float) ($card['totalPaid'] ?? 0);
                $summary['totalBaseEarned'] += (float) ($card['baseEarned'] ?? 0);
                $summary['totalBasePaid'] += (float) ($card['basePaid'] ?? 0);
                $summary['totalBonuses'] += (float) ($card['totalBonuses'] ?? 0);
                $summary['totalDeductions'] += (float) ($card['totalDeductions'] ?? 0);
                if ((float) ($card['currentBalance'] ?? 0) > 0) {
                    $summary['employeesDue'] += 1;
                }
                if (empty($card['isCommissionBased'] ?? false)) {
                    $summary['fixedSalaryEmployees'] += 1;
                    $summary['totalFixedSalaryDue'] += (float) ($card['currentBalance'] ?? 0);
                }

                return $summary;
            },
            [
                'totalBalance' => 0.0,
                'totalEarned' => 0.0,
                'totalPaid' => 0.0,
                'totalBaseEarned' => 0.0,
                'totalBasePaid' => 0.0,
                'totalBonuses' => 0.0,
                'totalDeductions' => 0.0,
                'totalCarryAdjustments' => 0.0,
                'employeesDue' => 0,
                'fixedSalaryEmployees' => 0,
                'totalFixedSalaryDue' => 0.0,
            ]
        );
    }

    /**
     * @param array<string, mixed> $walletSettings
     */
    private function syncWalletCreditsForPayableStatuses(array $walletSettings): void
    {
        $employees = $this->database->fetchAll(
            "SELECT id FROM users WHERE deleted_at IS NULL AND role IN ('Employee')"
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
        $currentUser = $this->currentUser();
        if (!$this->hasAdminAccess((string) ($currentUser['role'] ?? '')) && !$this->currentUserHasPermission('settings.editWallet')) {
            throw new RuntimeException('You do not have permission to update payroll settings.');
        }
        $current = $this->fetchPayrollSettingsInternal();
        if (array_key_exists('unitAmount', $params)) {
            $unitAmount = (float) $params['unitAmount'];
            if (!is_finite($unitAmount) || $unitAmount < 0) {
                throw new RuntimeException('Commission amount per eligible order must be a valid non-negative value.');
            }
        }
        if (array_key_exists('countedStatuses', $params)) {
            $submittedStatuses = is_array($params['countedStatuses']) ? $params['countedStatuses'] : [];
            if ($this->normalizePayrollStatuses($submittedStatuses, false) === []) {
                throw new RuntimeException('Select at least one valid order status for commission payroll.');
            }
        }
        $updated = $this->saveSingleton(
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
        if (json_encode($current['countedStatuses']) !== json_encode($updated['countedStatuses'])) {
            $this->database->transaction(fn() => $this->syncWalletCreditsForPayableStatuses([
                'unitAmount' => (float) $updated['unitAmount'],
                'countedStatuses' => $updated['countedStatuses'],
            ]));
        }
        return $updated;
    }

    public function fetchPayrollEmployees(array $params = []): array
    {
        $currentUser = $this->currentUser();
        $rows = $this->database->fetchAll(
            "SELECT * FROM users
             WHERE deleted_at IS NULL AND role IN ('Employee')
             ORDER BY name ASC"
        );
        $employees = array_map(fn(array $row): array => $this->mapUser($row), $rows);

        if ($this->hasAdminAccess((string) ($currentUser['role'] ?? ''))) {
            return $employees;
        }

        if ($this->isEmployeeRole((string) ($currentUser['role'] ?? ''))) {
            if (!$this->roleHasPermission((string) ($currentUser['role'] ?? ''), 'wallet.view')) {
                throw new RuntimeException('You do not have permission to view wallet or payroll information.');
            }
            return array_values(array_filter($employees, fn(array $employee): bool => $employee['id'] === (string) $currentUser['id']));
        }

        if ($this->currentUserHasPermission('payroll.view') || $this->currentUserHasPermission('payroll.pay')) {
            return $employees;
        }

        return [];
    }

    public function fetchPayrollHistory(array $params = []): array
    {
        $currentUser = $this->currentUser();
        $isEmployee = $this->isEmployeeRole((string) ($currentUser['role'] ?? ''));
        if ($isEmployee && !$this->roleHasPermission((string) ($currentUser['role'] ?? ''), 'wallet.view')) {
            throw new RuntimeException('You do not have permission to view wallet or payroll information.');
        }
        if (
            !$isEmployee
            && !$this->hasAdminAccess((string) ($currentUser['role'] ?? ''))
            && !$this->currentUserHasPermission('payroll.view')
            && !$this->currentUserHasPermission('payroll.pay')
        ) {
            throw new RuntimeException('You do not have permission to view payroll history.');
        }

        $sql = 'SELECT pp.*, a.name AS account_name, c.name AS category_name
                FROM payroll_payments pp
                LEFT JOIN accounts a ON a.id = pp.account_id
                LEFT JOIN categories c ON c.id = pp.category_id
                WHERE 1=1';
        $bindings = [];
        if ($isEmployee) {
            $sql .= ' AND pp.employee_id = :employee_id';
            $bindings[':employee_id'] = (string) $currentUser['id'];
        } elseif (!empty($params['employeeId'])) {
            $sql .= ' AND pp.employee_id = :employee_id';
            $bindings[':employee_id'] = trim((string) $params['employeeId']);
        }
        if (!empty($params['periodStart']) && !empty($params['periodEnd'])) {
            $sql .= ' AND pp.period_start <= :period_end AND pp.period_end >= :period_start';
            $bindings[':period_start'] = $this->normalizeDateOnly((string) $params['periodStart']);
            $bindings[':period_end'] = $this->normalizeDateOnly((string) $params['periodEnd']);
        } elseif (!empty($params['periodStart'])) {
            $sql .= ' AND pp.period_end >= :period_start';
            $bindings[':period_start'] = $this->normalizeDateOnly((string) $params['periodStart']);
        } elseif (!empty($params['periodEnd'])) {
            $sql .= ' AND pp.period_start <= :period_end';
            $bindings[':period_end'] = $this->normalizeDateOnly((string) $params['periodEnd']);
        }
        $sql .= ' ORDER BY pp.paid_at DESC';

        $rows = $this->database->fetchAll($sql, $bindings);
        $users = $this->database->fetchAll('SELECT id, name, role, is_commission_based, fixed_salary FROM users WHERE deleted_at IS NULL');
        $userMap = $this->keyBy($users, 'id');
        $history = array_map(fn(array $row): array => $this->mapPayrollPayment($row, $userMap), $rows);

        $legacySql = 'SELECT wp.*, a.name AS account_name, c.name AS category_name
                      FROM wallet_payouts wp
                      LEFT JOIN accounts a ON a.id = wp.account_id
                      LEFT JOIN categories c ON c.id = wp.category_id
                      WHERE wp.payroll_payment_id IS NULL';
        $legacyBindings = [];
        $legacyEmployeeId = $isEmployee
            ? (string) $currentUser['id']
            : trim((string) ($params['employeeId'] ?? ''));
        if ($legacyEmployeeId !== '') {
            $legacySql .= ' AND wp.employee_id = :employee_id';
            $legacyBindings[':employee_id'] = $legacyEmployeeId;
        }
        foreach ($this->database->fetchAll($legacySql . ' ORDER BY wp.paid_at DESC', $legacyBindings) as $legacy) {
            $paidAtIso = $this->toIso($legacy['paid_at'] ?? null);
            $localPaidDate = $this->localDateFromUtc($paidAtIso);
            $filterStart = $this->normalizeDateOnly((string) ($params['periodStart'] ?? ''));
            $filterEnd = $this->normalizeDateOnly((string) ($params['periodEnd'] ?? ''));
            if (($filterStart !== '' && $localPaidDate < $filterStart) || ($filterEnd !== '' && $localPaidDate > $filterEnd)) {
                continue;
            }
            $history[] = $this->mapPayrollPayment(array_merge($legacy, [
                'employee_name' => $userMap[(string) ($legacy['employee_id'] ?? '')]['name'] ?? null,
                'employee_role' => $userMap[(string) ($legacy['employee_id'] ?? '')]['role'] ?? null,
                'period_start' => $localPaidDate,
                'period_end' => $localPaidDate,
                'period_kind' => 'legacy',
                'period_label' => 'Legacy wallet payout',
                'unit_amount_snapshot' => 0,
                'counted_statuses_snapshot' => '[]',
                'order_count_snapshot' => 0,
                'base_amount_snapshot' => (float) ($legacy['amount'] ?? 0),
                'bonus_amount' => 0,
                'deduction_amount' => 0,
                'amount_snapshot' => (float) ($legacy['amount'] ?? 0),
                'wallet_payout_id' => (string) ($legacy['id'] ?? ''),
                'transaction_id' => $legacy['transaction_id'] ?? null,
                'account_id' => $legacy['account_id'] ?? null,
                'payment_method' => $legacy['payment_method'] ?? null,
                'category_id' => $legacy['category_id'] ?? null,
                'paid_by_name' => $userMap[(string) ($legacy['paid_by'] ?? '')]['name'] ?? null,
                'created_at' => $legacy['created_at'] ?? $legacy['paid_at'] ?? null,
            ]), $userMap);
        }
        usort($history, static fn(array $left, array $right): int => strcmp(
            (string) ($right['paidAt'] ?? ''),
            (string) ($left['paidAt'] ?? '')
        ));
        return $history;
    }

    public function fetchPayrollSummaries(array $params): array
    {
        $currentUser = $this->currentUser();
        if (
            $this->isEmployeeRole((string) ($currentUser['role'] ?? ''))
            && !$this->roleHasPermission((string) ($currentUser['role'] ?? ''), 'wallet.view')
        ) {
            throw new RuntimeException('You do not have permission to view wallet or payroll information.');
        }
        if (trim((string) ($params['periodStart'] ?? '')) === '' || trim((string) ($params['periodEnd'] ?? '')) === '') {
            return [];
        }
        [$periodStart, $periodEnd] = $this->requirePayrollPeriod($params);

        $settings = $this->fetchPayrollSettingsInternal();
        $targetEmployeeId = $this->isEmployeeRole((string) ($currentUser['role'] ?? ''))
            ? (string) $currentUser['id']
            : (($this->hasAdminAccess((string) ($currentUser['role'] ?? '')) || $this->currentUserHasPermission('payroll.view') || $this->currentUserHasPermission('payroll.pay'))
                ? trim((string) ($params['employeeId'] ?? ''))
                : (string) $currentUser['id']);

        $employees = $this->fetchPayrollEmployees();
        if ($targetEmployeeId !== '') {
            $employees = array_values(array_filter($employees, fn(array $employee): bool => $employee['id'] === $targetEmployeeId));
        }
        if ($employees === []) {
            return [];
        }

        $employeeIds = array_map(static fn(array $employee): string => (string) $employee['id'], $employees);
        $commissionEmployeeIds = array_values(array_filter($employeeIds, function (string $employeeId) use ($employees): bool {
            $employee = $this->findEmployeeById($employees, $employeeId);
            return !empty($employee['isCommissionBased'] ?? false);
        }));
        $fixedEmployeeIds = array_values(array_diff($employeeIds, $commissionEmployeeIds));
        $commissionMetrics = $this->fetchCommissionPayrollMetricsByEmployeeIds($commissionEmployeeIds, $periodStart, $periodEnd);
        $fixedMetrics = $this->fetchFixedPayrollWalletMetricsByEmployeeIds($fixedEmployeeIds, $periodStart, $periodEnd);

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
        $paymentSql .= ' ORDER BY paid_at DESC';
        $paymentRows = $this->database->fetchAll($paymentSql, $paymentBindings);
        $employeeMap = $this->keyBy($employees, 'id');
        $paymentByEmployee = [];
        $paymentTotalsByEmployee = [];
        $nonExactOverlapByEmployee = [];
        foreach ($paymentRows as $row) {
            $employeeId = (string) $row['employee_id'];
            $isExactSelectedPeriod = (string) ($row['period_start'] ?? '') === $periodStart
                && (string) ($row['period_end'] ?? '') === $periodEnd;
            if (!$isExactSelectedPeriod) {
                $nonExactOverlapByEmployee[$employeeId] = true;
                continue;
            }
            $mappedPayment = $this->mapPayrollPayment($row, $employeeMap);
            // A period should normally have one payment. Keep the latest row
            // as the detail snapshot while aggregating every exact-period
            // commission top-up for the period KPIs and payment card.
            if (!isset($paymentByEmployee[$employeeId])) {
                $paymentByEmployee[$employeeId] = $mappedPayment;
            }
            if (!isset($paymentTotalsByEmployee[$employeeId])) {
                $paymentTotalsByEmployee[$employeeId] = [
                    'paymentCount' => 0,
                    'paidBaseAmount' => 0.0,
                    'paidNetAmount' => 0.0,
                    'paidBonusAmount' => 0.0,
                    'paidDeductionAmount' => 0.0,
                ];
            }
            $paymentTotalsByEmployee[$employeeId]['paymentCount']++;
            $paymentTotalsByEmployee[$employeeId]['paidBaseAmount'] += (float) ($mappedPayment['baseAmountSnapshot'] ?? 0);
            $paymentTotalsByEmployee[$employeeId]['paidNetAmount'] += (float) ($mappedPayment['netAmount'] ?? $mappedPayment['amountSnapshot'] ?? 0);
            $paymentTotalsByEmployee[$employeeId]['paidBonusAmount'] += (float) ($mappedPayment['bonusAmount'] ?? 0);
            $paymentTotalsByEmployee[$employeeId]['paidDeductionAmount'] += (float) ($mappedPayment['deductionAmount'] ?? 0);
        }

        $summaries = [];
        foreach ($employees as $employee) {
            $employeeId = (string) $employee['id'];
            $isCommissionBased = !empty($employee['isCommissionBased'] ?? false);
            $fixedSalary = isset($employee['fixedSalary']) ? (float) $employee['fixedSalary'] : null;
            if ($isCommissionBased) {
                $count = (int) ($commissionMetrics[$employeeId]['orderCount'] ?? 0);
                $grossBaseAmount = (float) ($commissionMetrics[$employeeId]['grossBaseAmount'] ?? 0);
                $estimatedAmount = max(0.0, (float) ($commissionMetrics[$employeeId]['baseAmount'] ?? 0));
                $balancePeriodStart = $this->walletCutoffDate();
                $balancePeriodEnd = (new \DateTimeImmutable('now', new \DateTimeZone($this->config->timezone())))->format('Y-m-d');
            } else {
                $count = 0;
                $grossBaseAmount = $this->calculateFixedSalaryForPeriod(max(0.0, (float) ($fixedSalary ?? 0)), $periodStart, $periodEnd);
                $paidMetrics = $fixedMetrics[$employeeId] ?? [];
                $estimatedAmount = max(0.0, $grossBaseAmount - (float) ($paidMetrics['basePaid'] ?? 0));
                $balancePeriodStart = $periodStart;
                $balancePeriodEnd = $periodEnd;
            }
            $paymentSnapshot = $paymentByEmployee[$employeeId] ?? null;
            $paymentTotals = $paymentTotalsByEmployee[$employeeId] ?? [
                'paymentCount' => 0,
                'paidBaseAmount' => 0.0,
                'paidNetAmount' => 0.0,
                'paidBonusAmount' => 0.0,
                'paidDeductionAmount' => 0.0,
            ];
            foreach (['paidBaseAmount', 'paidNetAmount', 'paidBonusAmount', 'paidDeductionAmount'] as $moneyKey) {
                $paymentTotals[$moneyKey] = round((float) $paymentTotals[$moneyKey], 2);
            }
            $hasOutstandingTopUp = $isCommissionBased && $paymentSnapshot !== null && $estimatedAmount > 0;
            $hasBlockingPeriodOverlap = !empty($nonExactOverlapByEmployee[$employeeId]);
            $summaries[] = [
                'employeeId' => $employeeId,
                'employeeName' => $employee['name'],
                'employeeRole' => $employee['role'],
                'isCommissionBased' => $isCommissionBased,
                'compensationType' => $isCommissionBased ? 'commission' : 'fixed',
                'fixedSalary' => $fixedSalary,
                'countedOrderCount' => $count,
                'unitAmount' => (float) $settings['unitAmount'],
                'estimatedAmount' => $estimatedAmount,
                'baseAmount' => $estimatedAmount,
                'grossBaseAmount' => $grossBaseAmount,
                'balancePeriodStart' => $balancePeriodStart,
                'balancePeriodEnd' => $balancePeriodEnd,
                'paymentStatus' => $paymentSnapshot ? 'paid' : 'unpaid',
                'paymentSnapshot' => $paymentSnapshot,
                'paymentCount' => (int) $paymentTotals['paymentCount'],
                'paidBaseAmount' => $paymentTotals['paidBaseAmount'],
                'paidNetAmount' => $paymentTotals['paidNetAmount'],
                'paidBonusAmount' => $paymentTotals['paidBonusAmount'],
                'paidDeductionAmount' => $paymentTotals['paidDeductionAmount'],
                'periodBaseAmount' => round((float) $paymentTotals['paidBaseAmount'] + $estimatedAmount, 2),
                'hasOutstandingTopUp' => $hasOutstandingTopUp,
                'hasBlockingPeriodOverlap' => $hasBlockingPeriodOverlap,
                'liveAmountDelta' => $paymentSnapshot ? $estimatedAmount : 0,
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
        // Retained as a compatibility alias, but there is only one canonical
        // payment path. It requires account details and atomically updates the
        // payroll ledger, wallet, expense transaction, and account balance.
        $payout = $this->payEmployeeWallet($params);
        $payment = $payout['payrollPayment'] ?? null;
        if (!is_array($payment)) {
            throw new RuntimeException('Payroll payment could not be recorded.');
        }
        return $payment;
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
        $currentUser = $this->currentUser();
        if (!$this->hasAdminAccess((string) ($currentUser['role'] ?? '')) && !$this->currentUserHasPermission('settings.editWallet')) {
            throw new RuntimeException('You do not have permission to update wallet settings.');
        }
        $current = $this->fetchWalletSettings();
        $nextStatuses = array_key_exists('countedStatuses', $params)
            ? $this->normalizePayrollStatuses(is_array($params['countedStatuses']) ? $params['countedStatuses'] : [], true)
            : $current['countedStatuses'];
        $updated = $this->updatePayrollSettings([
            'unitAmount' => $params['unitAmount'] ?? $current['unitAmount'],
            'countedStatuses' => $nextStatuses,
        ]);

        $wallet = [
            'unitAmount' => (float) $updated['unitAmount'],
            'countedStatuses' => $updated['countedStatuses'],
        ];

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
        if (
            $this->isEmployeeRole((string) ($currentUser['role'] ?? ''))
            && !$this->roleHasPermission((string) ($currentUser['role'] ?? ''), 'wallet.view')
        ) {
            throw new RuntimeException('You do not have permission to view your wallet.');
        }
        if (!$this->isEmployeeRole((string) ($currentUser['role'] ?? ''))) {
            return [
                'employeeId' => (string) $currentUser['id'],
                'employeeName' => (string) ($currentUser['name'] ?? 'Unknown Employee'),
                'employeeRole' => (string) ($currentUser['role'] ?? 'Employee'),
                'isCommissionBased' => true,
                'fixedSalary' => null,
                'currentBalance' => 0,
                'totalEarned' => 0,
                'totalPaid' => 0,
                'creditedOrders' => 0,
            ];
        }

        $walletSettings = $this->fetchWalletSettings();
        $employee = $this->database->fetchOne(
            'SELECT id, name, role, is_commission_based, fixed_salary FROM users WHERE id = :id AND deleted_at IS NULL LIMIT 1',
            [':id' => (string) $currentUser['id']]
        );
        if ($employee === null) {
            return [
                'employeeId' => (string) $currentUser['id'],
                'employeeName' => (string) ($currentUser['name'] ?? 'Unknown Employee'),
                'employeeRole' => (string) ($currentUser['role'] ?? 'Employee'),
                'isCommissionBased' => true,
                'fixedSalary' => null,
                'currentBalance' => 0,
                'totalEarned' => 0,
                'totalPaid' => 0,
                'creditedOrders' => 0,
            ];
        }

        $mappedEmployee = $this->mapUser($employee);
        $cards = $this->buildWalletCardsForEmployees([$mappedEmployee], $walletSettings);

        return $cards[0] ?? [
            'employeeId' => (string) $currentUser['id'],
            'employeeName' => (string) ($currentUser['name'] ?? 'Unknown Employee'),
            'employeeRole' => (string) ($currentUser['role'] ?? 'Employee'),
            'isCommissionBased' => $mappedEmployee['isCommissionBased'] ?? true,
            'fixedSalary' => $mappedEmployee['fixedSalary'] ?? null,
            'currentBalance' => 0,
            'totalEarned' => 0,
            'totalPaid' => 0,
            'creditedOrders' => 0,
        ];
    }

    public function fetchWalletActivity(array $params = []): array
    {
        $currentUser = $this->currentUser();
        $isEmployee = $this->isEmployeeRole((string) ($currentUser['role'] ?? ''));
        if ($isEmployee && !$this->roleHasPermission((string) ($currentUser['role'] ?? ''), 'wallet.view')) {
            throw new RuntimeException('You do not have permission to view your wallet.');
        }
        if (
            !$isEmployee
            && !$this->hasAdminAccess((string) ($currentUser['role'] ?? ''))
            && !$this->currentUserHasPermission('payroll.view')
            && !$this->currentUserHasPermission('payroll.pay')
        ) {
            throw new RuntimeException('You do not have permission to view wallet activity.');
        }
        $targetEmployeeId = $isEmployee
            ? (string) $currentUser['id']
            : (($this->hasAdminAccess((string) ($currentUser['role'] ?? '')) || $this->currentUserHasPermission('payroll.view') || $this->currentUserHasPermission('payroll.pay'))
                ? trim((string) ($params['employeeId'] ?? ''))
                : (string) $currentUser['id']);
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
        $isEmployee = $this->isEmployeeRole((string) ($currentUser['role'] ?? ''));
        if ($isEmployee && !$this->roleHasPermission((string) ($currentUser['role'] ?? ''), 'wallet.view')) {
            throw new RuntimeException('You do not have permission to view your wallet.');
        }
        if (
            !$isEmployee
            && !$this->hasAdminAccess((string) ($currentUser['role'] ?? ''))
            && !$this->currentUserHasPermission('payroll.view')
            && !$this->currentUserHasPermission('payroll.pay')
        ) {
            throw new RuntimeException('You do not have permission to view wallet activity.');
        }
        $pageSize = $this->pageSize($params);
        $offset = $this->pageOffset($params);
        $targetEmployeeId = $isEmployee
            ? (string) $currentUser['id']
            : (($this->hasAdminAccess((string) ($currentUser['role'] ?? '')) || $this->currentUserHasPermission('payroll.view') || $this->currentUserHasPermission('payroll.pay'))
                ? trim((string) ($params['employeeId'] ?? ''))
                : (string) $currentUser['id']);
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

    /** @param array<string, mixed> $payment */
    private function buildPayrollPayoutResponse(array $payment): array
    {
        $payoutId = trim((string) ($payment['wallet_payout_id'] ?? ''));
        if ($payoutId === '') {
            throw new RuntimeException('The overlapping payroll record is not linked to a payout.');
        }
        $payout = $this->database->fetchOne(
            'SELECT wp.*, a.name AS account_name, c.name AS category_name
             FROM wallet_payouts wp
             LEFT JOIN accounts a ON a.id = wp.account_id
             LEFT JOIN categories c ON c.id = wp.category_id
             WHERE wp.id = :id LIMIT 1',
            [':id' => $payoutId]
        );
        if ($payout === null) {
            throw new RuntimeException('The payroll payout record could not be found.');
        }
        $users = $this->keyBy($this->database->fetchAll(
            'SELECT id, name, role, is_commission_based, fixed_salary FROM users
             WHERE id IN (:employee_id, :paid_by)',
            [
                ':employee_id' => (string) ($payment['employee_id'] ?? ''),
                ':paid_by' => (string) ($payment['paid_by'] ?? ''),
            ]
        ), 'id');
        $mappedPayment = $this->mapPayrollPayment(array_merge($payment, [
            'account_name' => $payout['account_name'] ?? null,
            'category_name' => $payout['category_name'] ?? null,
        ]), $users);
        $response = $this->mapWalletPayout(array_merge($payout, [
            'payroll_payment_id' => $payment['id'] ?? null,
            'compensation_type' => $payment['compensation_type'] ?? null,
            'base_amount' => $payment['base_amount_snapshot'] ?? 0,
            'bonus_amount' => $payment['bonus_amount'] ?? 0,
            'deduction_amount' => $payment['deduction_amount'] ?? 0,
            'net_amount' => $payment['amount_snapshot'] ?? $payout['amount'] ?? 0,
            'period_start' => $payment['period_start'] ?? null,
            'period_end' => $payment['period_end'] ?? null,
            'paid_by_name' => $users[(string) ($payment['paid_by'] ?? '')]['name'] ?? null,
        ]));
        $response['payrollPayment'] = $mappedPayment;
        return $response;
    }

    public function payEmployeeWallet(array $params): array
    {
        $currentUser = $this->currentUser();
        if (!$this->hasAdminAccess((string) ($currentUser['role'] ?? '')) && !$this->currentUserHasPermission('payroll.pay')) {
            throw new RuntimeException('You do not have permission to pay employee payroll.');
        }

        $employeeId = trim((string) ($params['employeeId'] ?? ''));
        if ($employeeId === '') {
            throw new RuntimeException('Select an employee to pay.');
        }
        [$periodStart, $periodEnd] = $this->requirePayrollPeriod($params);
        $bonusAmount = round((float) ($params['bonusAmount'] ?? 0), 2);
        $deductionAmount = round((float) ($params['deductionAmount'] ?? 0), 2);
        if (!is_finite($bonusAmount) || !is_finite($deductionAmount) || $bonusAmount < 0 || $deductionAmount < 0) {
            throw new RuntimeException('Bonus and deduction amounts must be valid non-negative values.');
        }

        return $this->database->transaction(function () use (
            $currentUser,
            $employeeId,
            $periodStart,
            $periodEnd,
            $bonusAmount,
            $deductionAmount,
            $params
        ): array {
            // This row lock serializes overlap/balance checks for one employee,
            // preventing two concurrent requests from paying the same period.
            $employee = $this->database->fetchOne(
                'SELECT * FROM users WHERE id = :id AND deleted_at IS NULL LIMIT 1 FOR UPDATE',
                [':id' => $employeeId]
            );
            if ($employee === null || !$this->isEmployeeRole((string) ($employee['role'] ?? ''))) {
                throw new RuntimeException('A valid employee account is required for payroll.');
            }

            $overlap = $this->database->fetchOne(
                'SELECT * FROM payroll_payments
                 WHERE employee_id = :employee_id AND period_start <= :period_end AND period_end >= :period_start
                 ORDER BY paid_at DESC LIMIT 1 FOR UPDATE',
                [
                    ':employee_id' => $employeeId,
                    ':period_start' => $periodStart,
                    ':period_end' => $periodEnd,
                ]
            );
            $isExactPeriod = $overlap !== null
                && (string) ($overlap['period_start'] ?? '') === $periodStart
                && (string) ($overlap['period_end'] ?? '') === $periodEnd;
            $isMatchingRetry = false;
            if ($overlap !== null && $isExactPeriod) {
                $isMatchingRetry = abs((float) ($overlap['bonus_amount'] ?? 0) - $bonusAmount) < 0.005
                    && abs((float) ($overlap['deduction_amount'] ?? 0) - $deductionAmount) < 0.005
                    && trim((string) ($overlap['account_id'] ?? '')) === trim((string) ($params['accountId'] ?? ''))
                    && trim((string) ($overlap['payment_method'] ?? '')) === trim((string) ($params['paymentMethod'] ?? ''))
                    && trim((string) ($overlap['category_id'] ?? '')) === trim((string) ($params['categoryId'] ?? ''));
            }

            $mappedEmployee = $this->mapUser($employee);
            $isCommissionBased = !empty($mappedEmployee['isCommissionBased'] ?? false);
            $compensationType = $isCommissionBased ? 'commission' : 'fixed';
            $fixedSalary = isset($mappedEmployee['fixedSalary']) ? (float) $mappedEmployee['fixedSalary'] : null;
            $walletSettings = $this->fetchWalletSettings();
            if ($isCommissionBased) {
                $this->syncWalletCreditsForEmployees([$employeeId], $walletSettings);
                $commissionMetrics = $this->fetchCommissionPayrollMetricsByEmployeeIds([$employeeId], $periodStart, $periodEnd);
                $grossBaseAmount = max(0.0, (float) ($commissionMetrics[$employeeId]['grossBaseAmount'] ?? 0));
                $orderCount = (int) ($commissionMetrics[$employeeId]['orderCount'] ?? 0);
                $baseAmount = max(0.0, (float) ($commissionMetrics[$employeeId]['baseAmount'] ?? 0));
            } else {
                $grossBaseAmount = $this->calculateFixedSalaryForPeriod(max(0.0, (float) ($fixedSalary ?? 0)), $periodStart, $periodEnd);
                $legacyMetrics = $this->fetchFixedPayrollWalletMetricsByEmployeeIds([$employeeId], $periodStart, $periodEnd);
                $baseAmount = max(0.0, $grossBaseAmount - (float) ($legacyMetrics[$employeeId]['basePaid'] ?? 0));
                $orderCount = 0;
            }
            $baseAmount = round($baseAmount, 2);
            if ($overlap !== null) {
                if ($baseAmount <= 0 && $isMatchingRetry && trim((string) ($overlap['wallet_payout_id'] ?? '')) !== '') {
                    return $this->buildPayrollPayoutResponse($overlap);
                }
                // Commission credits may legitimately accrue after an earlier
                // payout for the exact same period. Permit only that positive
                // top-up; fixed salary and partial-overlap duplicates stay blocked.
                if (!$isCommissionBased || !$isExactPeriod || $baseAmount <= 0) {
                    throw new RuntimeException('This employee already has payroll recorded for an overlapping period.');
                }
            }
            if ($baseAmount <= 0 && $bonusAmount <= 0) {
                throw new RuntimeException('There is no unpaid base amount or bonus for this employee in the selected period.');
            }
            if ($deductionAmount > round($baseAmount + $bonusAmount, 2)) {
                throw new RuntimeException('Deduction cannot exceed base pay plus bonus.');
            }
            $netAmount = round($baseAmount + $bonusAmount - $deductionAmount, 2);
            if ($netAmount <= 0) {
                throw new RuntimeException('Net payroll payout must be greater than zero.');
            }
            if (array_key_exists('amount', $params) && abs((float) $params['amount'] - $netAmount) > 0.01) {
                throw new RuntimeException('Payroll changed while this form was open. Refresh and review the recalculated net amount.');
            }

            $accountId = trim((string) ($params['accountId'] ?? ''));
            $paymentMethod = trim((string) ($params['paymentMethod'] ?? ''));
            $categoryId = trim((string) ($params['categoryId'] ?? ''));
            if ($accountId === '' || $paymentMethod === '' || $categoryId === '') {
                throw new RuntimeException('Payment account, method, and payroll expense category are required.');
            }
            $account = $this->database->fetchOne(
                'SELECT id, current_balance FROM accounts WHERE id = :id LIMIT 1 FOR UPDATE',
                [':id' => $accountId]
            );
            if ($account === null) {
                throw new RuntimeException('Selected payment account was not found.');
            }
            if ($netAmount > (float) ($account['current_balance'] ?? 0)) {
                throw new RuntimeException('Selected account does not have enough balance.');
            }
            if ($this->database->fetchOne(
                "SELECT id FROM categories WHERE id = :id AND LOWER(type) = 'expense' LIMIT 1",
                [':id' => $categoryId]
            ) === null) {
                throw new RuntimeException('Select a valid expense category for payroll.');
            }
            if ($this->database->fetchOne(
                'SELECT id FROM payment_methods WHERE name = :name AND is_active = 1 LIMIT 1',
                [':name' => $paymentMethod]
            ) === null) {
                throw new RuntimeException('Select an active payment method.');
            }

            $payrollPaymentId = $this->uuid4();
            $payoutId = $this->uuid4();
            $transactionId = $this->uuid4();
            $createdAt = $this->database->nowUtc();
            $paidAt = $this->normalizeDateTimeInputWithCurrentLocalTime((string) ($params['paidAt'] ?? $createdAt));
            $periodKind = in_array((string) ($params['periodKind'] ?? ''), ['month', 'custom'], true)
                ? (string) $params['periodKind']
                : 'custom';
            $periodLabel = trim((string) ($params['periodLabel'] ?? '')) ?: ($periodStart . ' - ' . $periodEnd);
            $note = $this->nullableString($params['note'] ?? null);
            $description = 'Payroll payout to ' . (string) ($employee['name'] ?? 'Employee')
                . ' (' . $periodLabel . '; base ' . $this->formatMoney($baseAmount)
                . ', bonus ' . $this->formatMoney($bonusAmount)
                . ', deduction ' . $this->formatMoney($deductionAmount) . ')';

            $transactionRecord = $this->createTransactionRecord([
                'id' => $transactionId,
                'date' => $paidAt,
                'type' => 'Expense',
                'category' => $categoryId,
                'accountId' => $accountId,
                'amount' => $netAmount,
                'description' => $description,
                'referenceId' => $payoutId,
                'paymentMethod' => $paymentMethod,
                'history' => [],
            ], (string) $currentUser['id'], $currentUser);
            if ((string) ($transactionRecord['approvalStatus'] ?? 'approved') !== 'approved') {
                throw new RuntimeException('Payroll payouts require an immediately approved expense transaction.');
            }

            $this->database->execute(
                'INSERT INTO payroll_payments (
                    id, employee_id, period_start, period_end, period_kind, period_label,
                    unit_amount_snapshot, counted_statuses_snapshot, order_count_snapshot,
                    compensation_type, fixed_salary_snapshot, base_amount_snapshot,
                    bonus_amount, deduction_amount, amount_snapshot, wallet_payout_id,
                    transaction_id, account_id, payment_method, category_id,
                    paid_at, paid_by, note, created_at, updated_at
                ) VALUES (
                    :id, :employee_id, :period_start, :period_end, :period_kind, :period_label,
                    :unit_amount_snapshot, :counted_statuses_snapshot, :order_count_snapshot,
                    :compensation_type, :fixed_salary_snapshot, :base_amount_snapshot,
                    :bonus_amount, :deduction_amount, :amount_snapshot, :wallet_payout_id,
                    :transaction_id, :account_id, :payment_method, :category_id,
                    :paid_at, :paid_by, :note, :created_at, :updated_at
                )',
                [
                    ':id' => $payrollPaymentId,
                    ':employee_id' => $employeeId,
                    ':period_start' => $periodStart,
                    ':period_end' => $periodEnd,
                    ':period_kind' => $periodKind,
                    ':period_label' => $periodLabel,
                    ':unit_amount_snapshot' => $this->formatMoney($walletSettings['unitAmount'] ?? 0),
                    ':counted_statuses_snapshot' => $this->jsonEncode($walletSettings['countedStatuses'] ?? []),
                    ':order_count_snapshot' => $orderCount,
                    ':compensation_type' => $compensationType,
                    ':fixed_salary_snapshot' => $isCommissionBased ? null : $this->formatMoney($fixedSalary ?? 0),
                    ':base_amount_snapshot' => $this->formatMoney($baseAmount),
                    ':bonus_amount' => $this->formatMoney($bonusAmount),
                    ':deduction_amount' => $this->formatMoney($deductionAmount),
                    ':amount_snapshot' => $this->formatMoney($netAmount),
                    ':wallet_payout_id' => $payoutId,
                    ':transaction_id' => $transactionId,
                    ':account_id' => $accountId,
                    ':payment_method' => $paymentMethod,
                    ':category_id' => $categoryId,
                    ':paid_at' => $paidAt,
                    ':paid_by' => (string) $currentUser['id'],
                    ':note' => $note,
                    ':created_at' => $createdAt,
                    ':updated_at' => $createdAt,
                ]
            );

            $this->database->execute(
                'INSERT INTO wallet_payouts (
                    id, employee_id, amount, account_id, payment_method, category_id, transaction_id,
                    payroll_payment_id, paid_at, paid_by, note, created_at, updated_at
                ) VALUES (
                    :id, :employee_id, :amount, :account_id, :payment_method, :category_id, :transaction_id,
                    :payroll_payment_id, :paid_at, :paid_by, :note, :created_at, :updated_at
                )',
                [
                    ':id' => $payoutId,
                    ':employee_id' => $employeeId,
                    ':amount' => $this->formatMoney($netAmount),
                    ':account_id' => $accountId,
                    ':payment_method' => $paymentMethod,
                    ':category_id' => $categoryId,
                    ':transaction_id' => $transactionId,
                    ':payroll_payment_id' => $payrollPaymentId,
                    ':paid_at' => $paidAt,
                    ':paid_by' => (string) $currentUser['id'],
                    ':note' => $note,
                    ':created_at' => $createdAt,
                    ':updated_at' => $createdAt,
                ]
            );

            $walletEntries = [];
            if ($bonusAmount > 0) {
                $walletEntries[] = [
                    'employee_id' => $employeeId,
                    'entry_type' => 'payroll_bonus',
                    'amount_delta' => $bonusAmount,
                    'payroll_payment_id' => $payrollPaymentId,
                    'note' => 'Payroll bonus for ' . $periodLabel . '.',
                    'created_at' => $createdAt,
                    'created_by' => (string) $currentUser['id'],
                ];
            }
            if ($deductionAmount > 0) {
                $walletEntries[] = [
                    'employee_id' => $employeeId,
                    'entry_type' => 'payroll_deduction',
                    'amount_delta' => -$deductionAmount,
                    'payroll_payment_id' => $payrollPaymentId,
                    'note' => 'Payroll deduction for ' . $periodLabel . '.',
                    'created_at' => $createdAt,
                    'created_by' => (string) $currentUser['id'],
                ];
            }
            $walletEntries[] = [
                'employee_id' => $employeeId,
                'entry_type' => 'payout',
                'amount_delta' => -$netAmount,
                'wallet_payout_id' => $payoutId,
                'payroll_payment_id' => $payrollPaymentId,
                'note' => $note ?? $description,
                'created_at' => $createdAt,
                'created_by' => (string) $currentUser['id'],
            ];
            $this->insertWalletEntryRows($walletEntries);

            $payment = $this->database->fetchOne(
                'SELECT * FROM payroll_payments WHERE id = :id LIMIT 1',
                [':id' => $payrollPaymentId]
            );
            return $this->buildPayrollPayoutResponse($payment ?? throw new RuntimeException('Payroll payment was not saved.'));
        });
    }

    public function deleteEmployeeWalletPayout(array $params): array
    {
        $currentUser = $this->currentUser();
        if (!$this->hasAdminAccess((string) ($currentUser['role'] ?? '')) && !$this->currentUserHasPermission('payroll.deletePayments')) {
            throw new RuntimeException('You do not have permission to delete payroll payments.');
        }

        $requestedId = trim((string) ($params['id'] ?? ''));
        if ($requestedId === '') {
            throw new RuntimeException('Missing payout or payroll payment ID.');
        }

        return $this->database->transaction(function () use ($requestedId): array {
            // The UI historically sent either wallet-entry ID or payout ID;
            // payroll history now sends payroll-payment ID. Resolve all three.
            $payout = $this->database->fetchOne(
                'SELECT * FROM wallet_payouts
                 WHERE id = :payout_id OR payroll_payment_id = :payroll_payment_id
                 LIMIT 1 FOR UPDATE',
                [':payout_id' => $requestedId, ':payroll_payment_id' => $requestedId]
            );
            $entry = null;
            if ($payout === null) {
                $entry = $this->database->fetchOne(
                    'SELECT * FROM wallet_entries
                      WHERE (id = :entry_id OR wallet_payout_id = :entry_payout_id OR payroll_payment_id = :entry_payroll_id)
                        AND entry_type = \'payout\'
                      ORDER BY CASE WHEN id = :preferred_entry_id THEN 0 ELSE 1 END
                      LIMIT 1 FOR UPDATE',
                    [
                        ':entry_id' => $requestedId,
                        ':entry_payout_id' => $requestedId,
                        ':entry_payroll_id' => $requestedId,
                        ':preferred_entry_id' => $requestedId,
                    ]
                );
                $resolvedPayoutId = trim((string) ($entry['wallet_payout_id'] ?? ''));
                if ($resolvedPayoutId !== '') {
                    $payout = $this->database->fetchOne(
                        'SELECT * FROM wallet_payouts WHERE id = :id LIMIT 1 FOR UPDATE',
                        [':id' => $resolvedPayoutId]
                    );
                }
            }
            $payrollPaymentId = trim((string) ($payout['payroll_payment_id'] ?? $entry['payroll_payment_id'] ?? ''));
            $payment = null;
            if ($payrollPaymentId !== '') {
                $payment = $this->database->fetchOne(
                    'SELECT * FROM payroll_payments WHERE id = :id LIMIT 1 FOR UPDATE',
                    [':id' => $payrollPaymentId]
                );
            } elseif ($payout !== null) {
                $payment = $this->database->fetchOne(
                    'SELECT * FROM payroll_payments WHERE wallet_payout_id = :id LIMIT 1 FOR UPDATE',
                    [':id' => (string) $payout['id']]
                );
                $payrollPaymentId = trim((string) ($payment['id'] ?? ''));
            } else {
                $payment = $this->database->fetchOne(
                    'SELECT * FROM payroll_payments WHERE id = :id LIMIT 1 FOR UPDATE',
                    [':id' => $requestedId]
                );
                $payrollPaymentId = trim((string) ($payment['id'] ?? ''));
                $resolvedPayoutId = trim((string) ($payment['wallet_payout_id'] ?? ''));
                if ($resolvedPayoutId !== '') {
                    $payout = $this->database->fetchOne(
                        'SELECT * FROM wallet_payouts WHERE id = :id LIMIT 1 FOR UPDATE',
                        [':id' => $resolvedPayoutId]
                    );
                }
            }
            if ($payout === null && $payment !== null) {
                $resolvedPayoutId = trim((string) ($payment['wallet_payout_id'] ?? ''));
                if ($resolvedPayoutId !== '') {
                    $payout = $this->database->fetchOne(
                        'SELECT * FROM wallet_payouts WHERE id = :id LIMIT 1 FOR UPDATE',
                        [':id' => $resolvedPayoutId]
                    );
                }
            }
            if ($payout === null && $payment === null && $entry === null) {
                $nonPayoutEntry = $this->database->fetchOne(
                    'SELECT entry_type FROM wallet_entries WHERE id = :id LIMIT 1 FOR UPDATE',
                    [':id' => $requestedId]
                );
                if ($nonPayoutEntry !== null) {
                    throw new RuntimeException('Only payroll payout entries can be deleted from the payroll page.');
                }
                return ['success' => true];
            }

            $payoutId = trim((string) ($payout['id'] ?? ''));
            $transactionId = trim((string) ($payout['transaction_id'] ?? $payment['transaction_id'] ?? ''));
            $transaction = null;
            if ($transactionId !== '') {
                $transaction = $this->database->fetchOne(
                    'SELECT id, type, account_id, to_account_id, amount, account_effect_applied
                     FROM transactions WHERE id = :id LIMIT 1 FOR UPDATE',
                    [':id' => $transactionId]
                );
            }

            if ($payoutId !== '' || $payrollPaymentId !== '') {
                $whereParts = [];
                $bindings = [];
                if ($payoutId !== '') {
                    $whereParts[] = 'wallet_payout_id = :wallet_payout_id';
                    $bindings[':wallet_payout_id'] = $payoutId;
                }
                if ($payrollPaymentId !== '') {
                    $whereParts[] = 'payroll_payment_id = :payroll_payment_id';
                    $bindings[':payroll_payment_id'] = $payrollPaymentId;
                }
                $this->database->execute('DELETE FROM wallet_entries WHERE ' . implode(' OR ', $whereParts), $bindings);
            } elseif ($entry !== null) {
                $this->database->execute('DELETE FROM wallet_entries WHERE id = :id', [':id' => (string) $entry['id']]);
            }

            if ($payrollPaymentId !== '') {
                $this->database->execute('DELETE FROM payroll_payments WHERE id = :id', [':id' => $payrollPaymentId]);
            }
            // wallet_payouts has a restrictive FK to transactions, so delete it
            // before reverting/removing the linked transaction.
            if ($payoutId !== '') {
                $this->database->execute('DELETE FROM wallet_payouts WHERE id = :id', [':id' => $payoutId]);
            }
            if ($transaction !== null) {
                $this->applyTransactionAccountEffect([$transaction], 'revert');
                $this->database->execute('DELETE FROM transactions WHERE id = :id', [':id' => $transactionId]);
            }

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
        $entityTypeNot = trim((string) ($params['entityTypeNot'] ?? ''));
        $deletedBy = trim((string) ($params['deletedBy'] ?? ''));
        $deletedByNot = trim((string) ($params['deletedByNot'] ?? ''));
        $title = trim((string) ($params['title'] ?? ''));
        $titleNot = trim((string) ($params['titleNot'] ?? ''));
        $deletedDate = is_array($params['deletedDate'] ?? null) ? $params['deletedDate'] : [];
        $items = array_values(array_filter($items, function (array $item) use ($entityTypeNot, $deletedBy, $deletedByNot, $title, $titleNot, $deletedDate): bool {
            if ($entityTypeNot !== '' && (string) ($item['entityType'] ?? '') === $entityTypeNot) return false;
            $deletedByName = mb_strtolower(trim((string) ($item['deletedByName'] ?? '')));
            if ($deletedBy !== '' && $deletedByName !== mb_strtolower($deletedBy)) return false;
            if ($deletedByNot !== '' && $deletedByName === mb_strtolower($deletedByNot)) return false;
            $itemTitle = mb_strtolower(trim((string) ($item['title'] ?? '')));
            foreach ([[$title, false], [$titleNot, true]] as [$encoded, $negative]) {
                if ($encoded === '') continue;
                [$expectedValue, $contains] = $this->decodeEncodedTextFilterValue($encoded);
                $expected = mb_strtolower($expectedValue);
                $match = $contains ? str_contains($itemTitle, $expected) : $itemTitle === $expected;
                if ((!$negative && !$match) || ($negative && $match)) return false;
            }
            $dateValue = trim((string) ($deletedDate['value'] ?? ''));
            $dateOperator = (string) ($deletedDate['operator'] ?? '');
            if ($dateValue !== '' && in_array($dateOperator, ['on', 'before', 'after'], true)) {
                $itemDate = substr((string) ($item['deletedAt'] ?? ''), 0, 10);
                if ($itemDate === '') return false;
                if ($dateOperator === 'on' && $itemDate !== $dateValue) return false;
                if ($dateOperator === 'before' && $itemDate >= $dateValue) return false;
                if ($dateOperator === 'after' && $itemDate <= $dateValue) return false;
            }
            return true;
        }));

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

        $statusOrder = ['On Hold', 'Processing', 'Courier assigned', 'Picked', 'Completed', 'Exchange processing', 'Exchange picked', 'Exchange delivered', 'Exchange returned', 'Exchange cancelled', 'Returned', 'Cancelled'];

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

            // "Returned", "Exchange returned", and "Cancelled" are terminal; allow reverting to anything before them.
            if ($targetIndex >= $currentIndex) {
                throw new RuntimeException('Target status must be prior to the current status.');
            }

            $orderNumber = trim((string) ($orderRow['order_number'] ?? ''));
            $customerId = trim((string) ($orderRow['customer_id'] ?? ''));
            $previousItems = $this->jsonDecodeList($orderRow['items'] ?? []);
            $hasReturnExchangeAdjustments = array_reduce(
                $previousItems,
                static fn(bool $found, array $item): bool => $found
                    || (int) ($item['returnedQty'] ?? 0) > 0
                    || (int) ($item['exchangedQty'] ?? 0) > 0,
                false
            );
            if ($hasReturnExchangeAdjustments) {
                throw new RuntimeException('This order contains item-level return/exchange adjustments and cannot be safely reverted with the status undo tool.');
            }

            // ─── 1. Reverse linked transactions (soft-delete + revert account balances) ───
            $linkedTransactions = $this->fetchOrderLinkedTransactionRows($orderId, $orderNumber, 'active');
            $transitionTransactions = array_values(array_filter($linkedTransactions, static function (array $transaction): bool {
                $description = strtolower(trim((string) ($transaction['description'] ?? '')));
                return str_starts_with($description, 'delivery payment for order #')
                    || str_starts_with($description, 'return expense for order #')
                    || str_starts_with($description, 'refund for order #')
                    || str_starts_with($description, 'return/exchange refund for order #')
                    || str_starts_with($description, 'exchange collection for order #');
            }));
            if ($transitionTransactions !== []) {
                $this->applyTransactionAccountEffect($transitionTransactions, 'revert');
                $deletedAt = $this->database->nowUtc();
                $this->softDeleteTransactionRowsByIds(
                    array_map(static fn(array $row): string => (string) $row['id'], $transitionTransactions),
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
            if (in_array($currentStatus, ['Completed', 'Returned', 'Exchange returned'], true)) {
                $keysToRemove = array_merge($keysToRemove, ['completed', 'returned', 'exchangeReturned']);
            }
            if (in_array($currentStatus, ['Exchange delivered', 'Exchange returned'], true)) {
                $keysToRemove = array_merge($keysToRemove, ['exchangeDelivered']);
            }

            // If reverting before Picked, remove picked key
            $targetIdx = array_search($targetStatus, ['On Hold', 'Processing', 'Courier assigned', 'Picked', 'Completed', 'Exchange processing', 'Exchange picked', 'Exchange delivered', 'Exchange returned', 'Returned', 'Cancelled'], true);
            if ($targetIdx !== false && $targetIdx < 3) {
                // Reverting to On Hold, Processing, or Courier assigned – remove picked
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
                $localNow->format('h:i A')
            );

            $payload = [
                'status' => $targetStatus,
                'history' => $this->jsonEncode($history),
            ];

            // Reverse only payment/refund amounts created by the status
            // transition; ordinary advance payments remain intact.
            if (in_array($currentStatus, ['Completed', 'Returned', 'Exchange returned'], true)) {
                $revertedPaidAmount = (float) ($orderRow['paid_amount'] ?? 0);
                foreach ($transitionTransactions as $transaction) {
                    $amount = (float) ($transaction['amount'] ?? 0);
                    if ((string) ($transaction['type'] ?? '') === 'Income') {
                        $revertedPaidAmount -= $amount;
                    } elseif (
                        (string) ($transaction['type'] ?? '') === 'Expense'
                        && str_contains(strtolower((string) ($transaction['description'] ?? '')), 'refund')
                    ) {
                        $revertedPaidAmount += $amount;
                    }
                }
                $payload['paid_amount'] = $this->formatMoney(max(0.0, $revertedPaidAmount));
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
