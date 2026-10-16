<?php

declare(strict_types=1);

namespace App;

final class WooCommerceProductSyncScheduler
{
    public const SYNC_INTERVAL_SECONDS = 21600;
    private const REQUEST_CHECK_INTERVAL_SECONDS = 300;

    public function __construct(
        private Database $database,
        private Config $config,
    ) {
    }

    public function triggerIfNeeded(): void
    {
        try {
            if (!$this->claimSchedulerCheckWindow() || !$this->tableExists('woocommerce_stores')) return;

            $cutoff = gmdate('Y-m-d H:i:s', time() - self::SYNC_INTERVAL_SECONDS);
            $dueStore = $this->database->fetchOne(
                'SELECT id FROM woocommerce_stores
                 WHERE enabled = 1 AND (last_products_synced_at IS NULL OR last_products_synced_at <= :cutoff)
                 LIMIT 1',
                [':cutoff' => $cutoff]
            );
            if ($dueStore === null) return;

            if (!$this->launchWorker()) {
                error_log('The internal PHP WooCommerce product-sync worker could not be started on this host.');
            }
        } catch (\Throwable $exception) {
            error_log('Could not start the WooCommerce product-sync worker: ' . $exception->getMessage());
        }
    }

    private function claimSchedulerCheckWindow(): bool
    {
        $databaseName = trim((string) ($this->config->get('DB_NAME', 'mamepilot') ?? 'mamepilot'));
        $marker = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
            . DIRECTORY_SEPARATOR
            . 'mamepilot-woocommerce-product-sync-' . substr(hash('sha256', $databaseName), 0, 24) . '.lock';
        $handle = @fopen($marker, 'c+');
        if (!is_resource($handle)) return true;
        if (!@flock($handle, LOCK_EX | LOCK_NB)) {
            @fclose($handle);
            return false;
        }

        try {
            @rewind($handle);
            $lastCheck = (int) trim((string) @stream_get_contents($handle));
            if ($lastCheck > 0 && $lastCheck >= time() - self::REQUEST_CHECK_INTERVAL_SECONDS) return false;
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
        $script = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'process_woocommerce_product_sync.php';
        if (!is_file($script)) return false;

        $php = $this->phpBinary();
        $logPath = trim((string) ($this->config->get(
            'WOOCOMMERCE_PRODUCT_SYNC_WORKER_LOG',
            dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'mamepilot-woocommerce-product-sync.log'
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
            'WOOCOMMERCE_PRODUCT_SYNC_PHP_BINARY',
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