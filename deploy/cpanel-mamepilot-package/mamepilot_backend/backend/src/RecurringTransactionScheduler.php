<?php

declare(strict_types=1);

namespace App;

final class RecurringTransactionScheduler
{
    public function __construct(
        private Database $database,
        private Auth $auth,
        private Config $config,
    ) {
    }

    /** Start one detached, low-impact PHP worker when recurring schedules need it. */
    public function triggerIfNeeded(): void
    {
        try {
            if (!$this->tableExists('recurring_transactions') || !$this->tableExists('recurring_transaction_worker_state')) return;
            $capabilities = (new FeatureAccess($this->database, $this->auth))->fetchCapabilities();
            if (empty($capabilities['recurring_transactions'])) return;
            try {
                (new ServiceLifecycle($this->database, $this->config))->assertActionAllowed('createRecurringTransaction');
            } catch (ApiException) {
                return;
            }
            if ($this->database->fetchOne('SELECT id FROM recurring_transactions WHERE is_active = 1 LIMIT 1') === null) return;

            $databaseName = trim((string) ($this->config->get('DB_NAME', 'mamepilot') ?? 'mamepilot'));
            $lockName = 'mamepilot_recurring_dispatch_' . substr(hash('sha256', $databaseName), 0, 24);
            $lock = $this->database->fetchOne('SELECT GET_LOCK(:lock_name, 0) AS acquired', [':lock_name' => $lockName]);
            if ((int) ($lock['acquired'] ?? 0) !== 1) return;

            try {
                $state = $this->database->fetchOne(
                    'SELECT worker_heartbeat_at FROM recurring_transaction_worker_state WHERE id = 1 LIMIT 1'
                );
                $heartbeat = trim((string) ($state['worker_heartbeat_at'] ?? ''));
                if ($heartbeat !== '' && (strtotime($heartbeat . ' UTC') ?: 0) >= time() - 45) return;

                $this->database->execute(
                    'INSERT INTO recurring_transaction_worker_state (id, worker_started_at, worker_heartbeat_at, updated_at)
                     VALUES (1, UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())
                     ON DUPLICATE KEY UPDATE worker_started_at = UTC_TIMESTAMP(), worker_heartbeat_at = UTC_TIMESTAMP(), updated_at = UTC_TIMESTAMP()'
                );
                if (!$this->launchWorker()) {
                    $this->database->execute(
                        'UPDATE recurring_transaction_worker_state SET
                            worker_heartbeat_at = NULL,
                            worker_last_error_at = UTC_TIMESTAMP(),
                            worker_last_error = :error,
                            updated_at = UTC_TIMESTAMP()
                         WHERE id = 1',
                        [':error' => 'The internal PHP worker could not be started on this host.']
                    );
                }
            } finally {
                $this->database->fetchOne('SELECT RELEASE_LOCK(:lock_name) AS released', [':lock_name' => $lockName]);
            }
        } catch (\Throwable $exception) {
            error_log('Could not start the recurring transaction worker: ' . $exception->getMessage());
        }
    }

    private function launchWorker(): bool
    {
        $script = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'process_recurring_transactions.php';
        if (!is_file($script)) return false;
        $php = $this->phpBinary();
        $logPath = trim((string) ($this->config->get(
            'RECURRING_TRANSACTION_WORKER_LOG',
            dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'mamepilot-recurring-transactions.log'
        ) ?? ''));

        if (DIRECTORY_SEPARATOR === '\\') {
            $command = 'cmd /c start "" /B ' . escapeshellarg($php) . ' ' . escapeshellarg($script)
                . ' >> ' . escapeshellarg($logPath) . ' 2>&1';
        } else {
            $command = 'nohup ' . escapeshellarg($php) . ' ' . escapeshellarg($script)
                . ' >> ' . escapeshellarg($logPath) . ' 2>&1 < /dev/null &';
        }

        if (function_exists('popen')) {
            $handle = @popen($command, 'r');
            if (is_resource($handle)) {
                @pclose($handle);
                return true;
            }
        }
        if (function_exists('exec')) {
            @exec($command, $output, $exitCode);
            return $exitCode === 0;
        }
        return false;
    }

    private function phpBinary(): string
    {
        $configured = trim((string) ($this->config->get(
            'RECURRING_TRANSACTION_PHP_BINARY',
            $this->config->get('UPDATE_PHP_BINARY', '')
        ) ?? ''));
        if ($configured !== '') return $configured;

        $binary = trim((string) PHP_BINARY);
        if ($binary !== '' && !preg_match('/php-(?:cgi|fpm)/i', basename($binary))) return $binary;
        if ($binary !== '') {
            $sibling = dirname($binary) . DIRECTORY_SEPARATOR . (DIRECTORY_SEPARATOR === '\\' ? 'php.exe' : 'php');
            if (is_file($sibling)) return $sibling;
        }
        foreach (['/usr/local/bin/php', '/usr/bin/php'] as $candidate) {
            if (is_file($candidate) && is_executable($candidate)) return $candidate;
        }
        return 'php';
    }

    private function tableExists(string $table): bool
    {
        return $this->database->fetchOne(
            'SELECT 1 AS present FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table LIMIT 1',
            [':table' => $table]
        ) !== null;
    }
}
