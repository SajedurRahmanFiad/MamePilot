<?php

declare(strict_types=1);

namespace App;

final class RecurringTransactionProcessor
{
    public function __construct(
        private Database $database,
        private Auth $auth,
        private Config $config,
    ) {
    }

    /** @return array{processed: int, failed: int} */
    public function processDueBatch(int $limit = 25): array
    {
        $limit = max(1, min(100, $limit));
        (new ServiceLifecycle($this->database, $this->config))->assertActionAllowed('createRecurringTransaction');
        $capabilities = (new FeatureAccess($this->database, $this->auth))->fetchCapabilities();
        if (empty($capabilities['recurring_transactions'])) {
            return ['processed' => 0, 'failed' => 0];
        }

        $rows = $this->database->fetchAll(
            "SELECT id
             FROM recurring_transactions
             WHERE is_active = 1
               AND next_run_at <= UTC_TIMESTAMP()
               AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP())
             ORDER BY next_run_at ASC
             LIMIT {$limit}"
        );
        $processed = 0;
        $failed = 0;

        foreach ($rows as $row) {
            $id = trim((string) ($row['id'] ?? ''));
            if ($id === '') continue;
            try {
                if ($this->processSchedule($id)) {
                    $processed++;
                }
            } catch (\Throwable $exception) {
                $failed++;
                $message = mb_substr(trim($exception->getMessage()), 0, 2000);
                $this->database->execute(
                    'UPDATE recurring_transactions SET
                        next_attempt_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE),
                        last_error = :last_error, last_error_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()
                     WHERE id = :id',
                    [':last_error' => $message !== '' ? $message : 'The automatic transaction could not be created.', ':id' => $id]
                );
                error_log('Recurring transaction ' . $id . ' failed: ' . $exception->getMessage());
            }
        }

        $this->recordWorkerHealth($failed === 0 ? null : "{$failed} recurring transaction(s) failed.", $processed > 0 && $failed === 0);
        return ['processed' => $processed, 'failed' => $failed];
    }

    public function hasActiveSchedules(): bool
    {
        $row = $this->database->fetchOne('SELECT id FROM recurring_transactions WHERE is_active = 1 LIMIT 1');
        return $row !== null;
    }

    public function secondsUntilNextCheck(): int
    {
        $row = $this->database->fetchOne(
            'SELECT MIN(GREATEST(next_run_at, COALESCE(next_attempt_at, next_run_at))) AS next_due
             FROM recurring_transactions
             WHERE is_active = 1'
        );
        $nextDue = trim((string) ($row['next_due'] ?? ''));
        if ($nextDue === '') return 30;
        $seconds = (strtotime($nextDue . ' UTC') ?: time()) - time();
        return max(1, min(30, $seconds));
    }

    public function heartbeat(?string $error = null): void
    {
        $this->recordWorkerHealth($error, null);
    }

    private function processSchedule(string $id): bool
    {
        return $this->database->transaction(function () use ($id): bool {
            $schedule = $this->database->fetchOne(
                "SELECT *
                 FROM recurring_transactions
                 WHERE id = :id
                   AND is_active = 1
                   AND next_run_at <= UTC_TIMESTAMP()
                   AND (next_attempt_at IS NULL OR next_attempt_at <= UTC_TIMESTAMP())
                 LIMIT 1 FOR UPDATE",
                [':id' => $id]
            );
            if ($schedule === null) return false;

            $scheduledFor = (string) $schedule['next_run_at'];
            $transaction = $this->database->fetchOne(
                'SELECT id FROM transactions
                 WHERE recurring_transaction_id = :recurring_transaction_id
                   AND recurring_scheduled_for = :scheduled_for
                 LIMIT 1',
                [':recurring_transaction_id' => $id, ':scheduled_for' => $scheduledFor]
            );

            if ($transaction === null) {
                $backgroundAuth = $this->backgroundAuthForSchedule((string) $schedule['created_by']);
                $operations = new OperationsApi($this->database, $backgroundAuth, $this->config);
                $type = (string) $schedule['type'];
                $interval = (string) $schedule['recurrence_interval'];
                $note = trim((string) ($schedule['note'] ?? ''));
                $transaction = $operations->createTransaction([
                    'date' => $scheduledFor,
                    'type' => $type,
                    'category' => (string) $schedule['category_id'],
                    'accountId' => (string) $schedule['account_id'],
                    'amount' => (float) $schedule['amount'],
                    'description' => $note !== '' ? $note : ucfirst($interval) . ' recurring ' . strtolower($type),
                    'paymentMethod' => (string) $schedule['payment_method'],
                    'recurringTransactionId' => $id,
                    'recurringScheduledFor' => $scheduledFor,
                    'history' => [
                        'created' => 'Created automatically from a recurring transaction schedule.',
                    ],
                ]);
            }

            $nextRunAt = RecurringTransactionSchedule::nextOccurrence(
                $scheduledFor,
                (string) $schedule['recurrence_interval'],
                (string) $schedule['start_at']
            );
            $this->database->execute(
                'UPDATE recurring_transactions SET
                    next_run_at = :next_run_at, next_attempt_at = NULL,
                    last_run_at = :last_run_at, last_transaction_id = :last_transaction_id,
                    run_count = run_count + 1, last_error = NULL, last_error_at = NULL,
                    updated_at = UTC_TIMESTAMP()
                 WHERE id = :id',
                [
                    ':next_run_at' => $nextRunAt,
                    ':last_run_at' => $scheduledFor,
                    ':last_transaction_id' => (string) ($transaction['id'] ?? ''),
                    ':id' => $id,
                ]
            );
            return true;
        });
    }

    private function recordWorkerHealth(?string $error, ?bool $success): void
    {
        $this->database->execute(
            'INSERT INTO recurring_transaction_worker_state (
                id, worker_started_at, worker_heartbeat_at, worker_last_success_at,
                worker_last_error_at, worker_last_error, updated_at
             ) VALUES (
                1, UTC_TIMESTAMP(), UTC_TIMESTAMP(), :success_at, :error_at, :error, UTC_TIMESTAMP()
             ) ON DUPLICATE KEY UPDATE
                worker_heartbeat_at = UTC_TIMESTAMP(),
                worker_last_success_at = COALESCE(:success_update, worker_last_success_at),
                worker_last_error_at = COALESCE(:error_at_update, worker_last_error_at),
                worker_last_error = CASE WHEN :clear_error = 1 THEN NULL ELSE COALESCE(:error_update, worker_last_error) END,
                updated_at = UTC_TIMESTAMP()',
            [
                ':success_at' => $success === true ? $this->database->nowUtc() : null,
                ':error_at' => $error !== null ? $this->database->nowUtc() : null,
                ':error' => $error,
                ':success_update' => $success === true ? $this->database->nowUtc() : null,
                ':error_at_update' => $error !== null ? $this->database->nowUtc() : null,
                ':clear_error' => $success === true ? 1 : 0,
                ':error_update' => $error,
            ]
        );
    }

    private function backgroundAuthForSchedule(string $creatorId): Auth
    {
        try {
            return $this->auth->forUserId($creatorId);
        } catch (\Throwable) {
            $fallbackUsers = $this->database->fetchAll(
                "SELECT id FROM users
                 WHERE role IN ('Developer', 'Admin') AND deleted_at IS NULL
                 ORDER BY CASE WHEN role = 'Developer' THEN 0 ELSE 1 END, created_at ASC"
            );
            foreach ($fallbackUsers as $fallbackUser) {
                try {
                    return $this->auth->forUserId((string) ($fallbackUser['id'] ?? ''));
                } catch (\Throwable) {
                    // Keep looking when the candidate exists but is explicitly disabled.
                }
            }
            throw new \RuntimeException('No active administrator is available to create this automatic transaction.');
        }
    }
}
