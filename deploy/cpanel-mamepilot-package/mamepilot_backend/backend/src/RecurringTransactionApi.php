<?php

declare(strict_types=1);

namespace App;

use DateTimeImmutable;
use RuntimeException;

final class RecurringTransactionApi extends BaseService
{
    private const INTERVALS = ['daily', 'weekly', 'monthly', 'yearly'];

    public function fetchRecurringTransactionsPage(array $params): array
    {
        $this->requireRecurringPermission('transactions.view');
        $pageSize = $this->pageSize($params);
        $offset = $this->pageOffset($params);
        $filters = is_array($params['filters'] ?? null) ? $params['filters'] : $params;
        $where = 'WHERE 1=1';
        $bindings = [];

        foreach (['type' => 'rt.type', 'interval' => 'rt.recurrence_interval', 'accountId' => 'rt.account_id', 'categoryId' => 'rt.category_id', 'paymentMethod' => 'rt.payment_method'] as $key => $column) {
            $value = trim((string) ($filters[$key] ?? ''));
            if ($value !== '') {
                $parameter = ':' . $key;
                $where .= " AND {$column} = {$parameter}";
                $bindings[$parameter] = $value;
            }

            $notKey = $key . 'Not';
            $notValue = trim((string) ($filters[$notKey] ?? ''));
            if ($notValue !== '') {
                $parameter = ':' . $notKey;
                $where .= " AND {$column} <> {$parameter}";
                $bindings[$parameter] = $notValue;
            }
        }

        $status = trim((string) ($filters['status'] ?? ''));
        $statusNot = trim((string) ($filters['statusNot'] ?? ''));
        if ($status !== '') {
            $where .= $this->statusSql($status, $bindings, 'status');
        }
        if ($statusNot !== '') {
            $statusSql = $this->statusSql($statusNot, $bindings, 'status_not');
            if ($statusSql !== '') {
                $where .= ' AND NOT (' . substr($statusSql, 5) . ')';
            }
        }

        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $bindings[':search'] = '%' . str_replace(['=', '%', '_'], ['==', '=%', '=_'], $search) . '%';
            $where .= " AND CONVERT(CONCAT_WS(' ', rt.type, rt.payment_method, rt.amount, rt.note,
                rt.recurrence_interval, a.name, c.name, u.name) USING utf8mb4)
                COLLATE utf8mb4_unicode_ci LIKE :search ESCAPE '='";
        }

        $fromSql = "FROM recurring_transactions rt
            INNER JOIN accounts a ON a.id = rt.account_id
            INNER JOIN categories c ON c.id = rt.category_id
            INNER JOIN users u ON u.id = rt.created_by
            {$where}";
        $countRow = $this->database->fetchOne("SELECT COUNT(*) AS count {$fromSql}", $bindings);
        $rows = $this->database->fetchAll(
            "SELECT rt.*, a.name AS account_name, c.name AS category_name, u.name AS creator_name
             {$fromSql}
             ORDER BY rt.next_run_at ASC, rt.created_at DESC
             LIMIT {$pageSize} OFFSET {$offset}",
            $bindings
        );

        return [
            'data' => array_map(fn(array $row): array => $this->mapRecurringTransaction($row), $rows),
            'count' => (int) ($countRow['count'] ?? 0),
        ];
    }

    public function fetchRecurringTransactionById(array $params): ?array
    {
        $this->requireRecurringPermission('transactions.view');
        return $this->findRecurringTransaction(trim((string) ($params['id'] ?? '')));
    }

    public function fetchRecurringTransactionFormOptions(array $params = []): array
    {
        $user = $this->currentUser();
        $role = (string) ($user['role'] ?? '');
        if (
            !$this->roleHasPermission($role, 'transactions.view')
            && !$this->roleHasPermission($role, 'transactions.create')
            && !$this->roleHasPermission($role, 'transactions.edit')
        ) {
            throw new RuntimeException('You do not have permission to manage recurring transactions.');
        }

        $defaults = $this->database->fetchOne('SELECT * FROM system_defaults LIMIT 1') ?? [];
        $accounts = $this->database->fetchAll('SELECT id, name, current_balance FROM accounts ORDER BY name ASC');
        $categories = $this->database->fetchAll(
            "SELECT id, name, type, color, parent_id, is_system
             FROM categories
             WHERE type IN ('Income', 'Expense')
             ORDER BY type ASC, name ASC"
        );
        $paymentMethods = $this->database->fetchAll(
            'SELECT id, name, description FROM payment_methods WHERE is_active = 1 ORDER BY name ASC'
        );

        return [
            'accounts' => array_map(static fn(array $row): array => [
                'id' => (string) $row['id'],
                'name' => (string) ($row['name'] ?? ''),
                'currentBalance' => (float) ($row['current_balance'] ?? 0),
            ], $accounts),
            'categories' => array_map(static fn(array $row): array => [
                'id' => (string) $row['id'],
                'name' => (string) ($row['name'] ?? ''),
                'type' => (string) ($row['type'] ?? 'Other'),
                'color' => (string) ($row['color'] ?? '#3B82F6'),
                'parentId' => isset($row['parent_id']) ? (string) $row['parent_id'] : null,
                'isSystem' => (bool) ($row['is_system'] ?? false),
            ], $categories),
            'paymentMethods' => array_map(static fn(array $row): array => [
                'id' => (string) $row['id'],
                'name' => (string) ($row['name'] ?? ''),
                'description' => (string) ($row['description'] ?? ''),
            ], $paymentMethods),
            'defaults' => [
                'accountId' => (string) ($defaults['default_account_id'] ?? ''),
                'paymentMethod' => (string) ($defaults['default_payment_method'] ?? ''),
                'incomeCategoryId' => (string) ($defaults['income_category_id'] ?? ''),
                'expenseCategoryId' => (string) ($defaults['expense_category_id'] ?? ''),
            ],
        ];
    }

    public function createRecurringTransaction(array $params): array
    {
        $actor = $this->requireRecurringPermission('transactions.create');
        $values = $this->validatedValues($params);
        $id = $this->stringId($params['id'] ?? null);
        $now = $this->database->nowUtc();
        $nextRunAt = $this->initialNextRun($values[':start_at'], $values[':recurrence_interval'], $now);

        $this->database->execute(
            'INSERT INTO recurring_transactions (
                id, type, account_id, category_id, payment_method, amount, note,
                recurrence_interval, start_at, next_run_at, is_active, created_by, created_at, updated_at
             ) VALUES (
                :id, :type, :account_id, :category_id, :payment_method, :amount, :note,
                :recurrence_interval, :start_at, :next_run_at, :is_active, :created_by, :created_at, :updated_at
             )',
            array_merge($values, [
                ':id' => $id,
                ':next_run_at' => $nextRunAt,
                ':created_by' => (string) $actor['id'],
                ':created_at' => $now,
                ':updated_at' => $now,
            ])
        );

        return $this->findRecurringTransaction($id) ?? throw new RuntimeException('Failed to create the recurring transaction.');
    }

    public function updateRecurringTransaction(array $params): array
    {
        $this->requireRecurringPermission('transactions.edit');
        $id = trim((string) ($params['id'] ?? ''));
        $updates = is_array($params['updates'] ?? null) ? $params['updates'] : [];

        return $this->database->transaction(function () use ($id, $updates): array {
            $existing = $this->database->fetchOne(
                'SELECT * FROM recurring_transactions WHERE id = :id LIMIT 1 FOR UPDATE',
                [':id' => $id]
            );
            if ($existing === null) {
                throw new RuntimeException('Recurring transaction not found.');
            }

            $merged = [
                'type' => $updates['type'] ?? $existing['type'],
                'accountId' => $updates['accountId'] ?? $existing['account_id'],
                'categoryId' => $updates['categoryId'] ?? $existing['category_id'],
                'paymentMethod' => $updates['paymentMethod'] ?? $existing['payment_method'],
                'amount' => $updates['amount'] ?? $existing['amount'],
                'note' => array_key_exists('note', $updates) ? $updates['note'] : $existing['note'],
                'interval' => $updates['interval'] ?? $existing['recurrence_interval'],
                'startAt' => $updates['startAt'] ?? $existing['start_at'],
                'isActive' => array_key_exists('isActive', $updates) ? $updates['isActive'] : (bool) $existing['is_active'],
            ];
            $values = $this->validatedValues($merged);
            $scheduleChanged = $values[':start_at'] !== (string) $existing['start_at']
                || $values[':recurrence_interval'] !== (string) $existing['recurrence_interval'];
            $resumed = (int) $existing['is_active'] !== 1 && $values[':is_active'] === 1;
            $nextRunAt = ($scheduleChanged || $resumed)
                ? $this->initialNextRun($values[':start_at'], $values[':recurrence_interval'], $this->database->nowUtc())
                : (string) $existing['next_run_at'];

            $this->database->execute(
                'UPDATE recurring_transactions SET
                    type = :type, account_id = :account_id, category_id = :category_id,
                    payment_method = :payment_method, amount = :amount, note = :note,
                    recurrence_interval = :recurrence_interval, start_at = :start_at,
                    next_run_at = :next_run_at, next_attempt_at = NULL, is_active = :is_active,
                    last_error = NULL, last_error_at = NULL, updated_at = :updated_at
                 WHERE id = :id',
                array_merge($values, [
                    ':id' => $id,
                    ':next_run_at' => $nextRunAt,
                    ':updated_at' => $this->database->nowUtc(),
                ])
            );

            return $this->findRecurringTransaction($id) ?? throw new RuntimeException('Recurring transaction not found.');
        });
    }

    public function deleteRecurringTransaction(array $params): array
    {
        $this->requireRecurringPermission('transactions.delete');
        $id = trim((string) ($params['id'] ?? ''));
        $deleted = $this->database->execute('DELETE FROM recurring_transactions WHERE id = :id', [':id' => $id]);
        if ($deleted === 0) {
            throw new RuntimeException('Recurring transaction not found.');
        }
        return ['success' => true];
    }

    private function requireRecurringPermission(string $permission): array
    {
        $user = $this->currentUser();
        if (!$this->roleHasPermission((string) ($user['role'] ?? ''), $permission)) {
            throw new RuntimeException('You do not have permission to manage recurring transactions.');
        }
        return $user;
    }

    private function validatedValues(array $params): array
    {
        $type = trim((string) ($params['type'] ?? ''));
        $accountId = trim((string) ($params['accountId'] ?? ''));
        $categoryId = trim((string) ($params['categoryId'] ?? ''));
        $paymentMethod = trim((string) ($params['paymentMethod'] ?? ''));
        $amount = round((float) ($params['amount'] ?? 0), 2);
        $interval = strtolower(trim((string) ($params['interval'] ?? '')));
        $rawStartAt = trim((string) ($params['startAt'] ?? ''));
        $parsedStartAt = $this->parseDateTimeValue($rawStartAt, $this->utcTimezone());
        if ($rawStartAt === '' || !$parsedStartAt instanceof DateTimeImmutable) {
            throw new RuntimeException('Please select a valid first occurrence date and time.');
        }
        $startAt = $parsedStartAt->setTimezone($this->utcTimezone())->format('Y-m-d H:i:s');

        if (!in_array($type, ['Income', 'Expense'], true)) {
            throw new RuntimeException('Transaction type must be Income or Expense.');
        }
        if ($accountId === '' || $this->database->fetchOne('SELECT id FROM accounts WHERE id = :id LIMIT 1', [':id' => $accountId]) === null) {
            throw new RuntimeException('Please select a valid account.');
        }
        $category = $this->database->fetchOne('SELECT id, type FROM categories WHERE id = :id LIMIT 1', [':id' => $categoryId]);
        if ($category === null || (string) ($category['type'] ?? '') !== $type) {
            throw new RuntimeException('Please select a category that matches the transaction type.');
        }
        if ($paymentMethod === '') {
            throw new RuntimeException('Please select a payment method.');
        }
        if ($amount <= 0) {
            throw new RuntimeException('Amount must be greater than zero.');
        }
        if (!in_array($interval, self::INTERVALS, true)) {
            throw new RuntimeException('A valid recurring interval is required.');
        }

        return [
            ':type' => $type,
            ':account_id' => $accountId,
            ':category_id' => $categoryId,
            ':payment_method' => $paymentMethod,
            ':amount' => $this->formatMoney($amount),
            ':note' => $this->nullableString($params['note'] ?? null),
            ':recurrence_interval' => $interval,
            ':start_at' => $startAt,
            ':is_active' => !array_key_exists('isActive', $params) || (bool) $params['isActive'] ? 1 : 0,
        ];
    }

    private function initialNextRun(string $startAt, string $interval, string $now): string
    {
        $candidate = $startAt;
        $nowTimestamp = strtotime($now) ?: time();
        $iterations = 0;
        while ((strtotime($candidate) ?: 0) < $nowTimestamp - 300) {
            $candidate = RecurringTransactionSchedule::nextOccurrence($candidate, $interval, $startAt);
            if (++$iterations > 100000) {
                throw new RuntimeException('Could not calculate the next recurring transaction time.');
            }
        }
        return $candidate;
    }

    private function findRecurringTransaction(string $id): ?array
    {
        if ($id === '') {
            return null;
        }
        $row = $this->database->fetchOne(
            'SELECT rt.*, a.name AS account_name, c.name AS category_name, u.name AS creator_name
             FROM recurring_transactions rt
             INNER JOIN accounts a ON a.id = rt.account_id
             INNER JOIN categories c ON c.id = rt.category_id
             INNER JOIN users u ON u.id = rt.created_by
             WHERE rt.id = :id
             LIMIT 1',
            [':id' => $id]
        );
        return $row ? $this->mapRecurringTransaction($row) : null;
    }

    private function mapRecurringTransaction(array $row): array
    {
        return [
            'id' => (string) $row['id'],
            'type' => (string) $row['type'],
            'accountId' => (string) $row['account_id'],
            'accountName' => (string) ($row['account_name'] ?? ''),
            'categoryId' => (string) $row['category_id'],
            'categoryName' => (string) ($row['category_name'] ?? ''),
            'paymentMethod' => (string) ($row['payment_method'] ?? ''),
            'amount' => (float) ($row['amount'] ?? 0),
            'note' => $this->nullableString($row['note'] ?? null),
            'interval' => (string) $row['recurrence_interval'],
            'startAt' => $this->toIso($row['start_at'] ?? null),
            'nextRunAt' => $this->toIso($row['next_run_at'] ?? null),
            'nextAttemptAt' => $this->toIso($row['next_attempt_at'] ?? null),
            'lastRunAt' => $this->toIso($row['last_run_at'] ?? null),
            'lastTransactionId' => $this->nullableString($row['last_transaction_id'] ?? null),
            'runCount' => (int) ($row['run_count'] ?? 0),
            'isActive' => (int) ($row['is_active'] ?? 0) === 1,
            'lastError' => $this->nullableString($row['last_error'] ?? null),
            'lastErrorAt' => $this->toIso($row['last_error_at'] ?? null),
            'createdBy' => (string) ($row['created_by'] ?? ''),
            'creatorName' => (string) ($row['creator_name'] ?? ''),
            'createdAt' => $this->toIso($row['created_at'] ?? null),
            'updatedAt' => $this->toIso($row['updated_at'] ?? null),
        ];
    }

    private function statusSql(string $status, array &$bindings, string $prefix): string
    {
        if ($status === 'active') return ' AND rt.is_active = 1 AND rt.last_error IS NULL';
        if ($status === 'paused') return ' AND rt.is_active = 0';
        if ($status === 'error') return ' AND rt.is_active = 1 AND rt.last_error IS NOT NULL';
        return '';
    }
}
