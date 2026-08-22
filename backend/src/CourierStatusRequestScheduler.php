<?php

declare(strict_types=1);

namespace App;

final class CourierStatusRequestScheduler
{
    public function __construct(
        private Database $database,
        private Config $config,
    ) {
    }

    /** Launch one detached courier-poll worker when the poll interval has elapsed. */
    public function triggerIfNeeded(): void
    {
        try {
            if (!$this->claimSchedulerCheckWindow()) return;
            if (!$this->tableExists('courier_poll_worker_state')) return;

            $databaseName = trim((string) ($this->config->get('DB_NAME', 'mamepilot') ?? 'mamepilot'));
            $lockName = 'mamepilot_courier_dispatch_' . substr(hash('sha256', $databaseName), 0, 24);
            $lock = $this->database->fetchOne('SELECT GET_LOCK(:lock_name, 0) AS acquired', [':lock_name' => $lockName]);
            if ((int) ($lock['acquired'] ?? 0) !== 1) return;

            try {
                $state = $this->database->fetchOne(
                    'SELECT last_success_at FROM courier_poll_worker_state ORDER BY last_success_at DESC LIMIT 1'
                );
                $lastSuccess = trim((string) ($state['last_success_at'] ?? ''));
                $threshold = max(120, (int) ($this->config->get('COURIER_POLL_WORKER_THRESHOLD_SECONDS', '240') ?? '240'));
                if ($lastSuccess !== '' && (strtotime($lastSuccess . ' UTC') ?: 0) >= time() - $threshold) return;

                if (!$this->launchWorker()) {
                    error_log('The internal PHP courier-poll worker could not be started on this host.');
                }
            } finally {
                $this->database->fetchOne('SELECT RELEASE_LOCK(:lock_name) AS released', [':lock_name' => $lockName]);
            }
        } catch (\Throwable $exception) {
            error_log('Could not start the courier-poll worker: ' . $exception->getMessage());
        }
    }

    /**
     * Use a shared filesystem marker so that not every API request pays the
     * cost of the database lock / heartbeat queries.
     */
    private function claimSchedulerCheckWindow(): bool
    {
        $interval = max(60, (int) ($this->config->get('COURIER_POLL_REQUEST_CHECK_SECONDS', '300') ?? '300'));
        $databaseName = trim((string) ($this->config->get('DB_NAME', 'mamepilot') ?? 'mamepilot'));
        $marker = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
            . DIRECTORY_SEPARATOR
            . 'mamepilot-courier-check-' . substr(hash('sha256', $databaseName), 0, 24) . '.lock';
        $handle = @fopen($marker, 'c+');
        if (!is_resource($handle)) return true;
        if (!@flock($handle, LOCK_EX | LOCK_NB)) {
            @fclose($handle);
            return false;
        }

        try {
            @rewind($handle);
            $lastCheck = (int) trim((string) @stream_get_contents($handle));
            if ($lastCheck > 0 && $lastCheck >= time() - $interval) return false;
            @ftruncate($handle, 0);
            @rewind($handle);
            @fwrite($handle, (string) time());
            @fflush($handle);
            return true;
        } finally {
            @flock($handle, LOCK_UN);
            @fclose($handle);
        }
    }

    private function launchWorker(): bool
    {
        $script = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'process_courier_statuses.php';
        if (!is_file($script)) return false;
        $php = $this->phpBinary();
        $logPath = trim((string) ($this->config->get(
            'COURIER_POLL_WORKER_LOG',
            dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'mamepilot-courier-status.log'
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
            'COURIER_POLL_PHP_BINARY',
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
