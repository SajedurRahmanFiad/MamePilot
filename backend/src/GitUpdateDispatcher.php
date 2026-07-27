<?php

declare(strict_types=1);

namespace App;

final class GitUpdateDispatcher
{
    private const INTERVAL_SECONDS = 120;

    private Config $config;

    /** @var null|callable(string, string): bool */
    private $launcher;

    private string $lockDirectory;

    /**
     * @param null|callable(string, string): bool $launcher
     */
    public function __construct(Config $config, ?callable $launcher = null, ?string $lockDirectory = null)
    {
        $this->config = $config;
        $this->launcher = $launcher;
        $this->lockDirectory = rtrim($lockDirectory ?? sys_get_temp_dir(), DIRECTORY_SEPARATOR);
    }

    /**
     * @return array{
     *   status: string,
     *   mode: string,
     *   enabled: bool,
     *   intervalSeconds: int,
     *   retryAfterSeconds: int,
     *   message: string
     * }
     */
    public function dispatch(?int $now = null): array
    {
        if (!$this->boolConfig('UPDATE_USE_GIT', false)) {
            return $this->result(
                'cron_only',
                'package',
                $this->boolConfig('UPDATE_ENABLED', false),
                0,
                'Package updates are handled only by the scheduled server updater.'
            );
        }

        if (!$this->boolConfig('UPDATE_ENABLED', false)) {
            return $this->result(
                'disabled',
                'git',
                false,
                0,
                'Git automatic updates are disabled by UPDATE_ENABLED.'
            );
        }

        $scriptPath = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'update.php';
        if (!is_file($scriptPath)) {
            return $this->result(
                'unavailable',
                'git',
                true,
                self::INTERVAL_SECONDS,
                'The Git update script is not available on this deployment.'
            );
        }

        if ($this->lockDirectory === '' || (!is_dir($this->lockDirectory) && !@mkdir($this->lockDirectory, 0700, true))) {
            return $this->result(
                'unavailable',
                'git',
                true,
                self::INTERVAL_SECONDS,
                'The Git update dispatcher could not create its cooldown directory.'
            );
        }

        $lockHandle = @fopen($this->lockPath($scriptPath), 'c+');
        if ($lockHandle === false) {
            return $this->result(
                'unavailable',
                'git',
                true,
                self::INTERVAL_SECONDS,
                'The Git update dispatcher could not open its cooldown lock.'
            );
        }

        try {
            if (!flock($lockHandle, LOCK_EX)) {
                return $this->result(
                    'unavailable',
                    'git',
                    true,
                    self::INTERVAL_SECONDS,
                    'The Git update dispatcher could not acquire its cooldown lock.'
                );
            }

            rewind($lockHandle);
            $lastDispatch = (int) trim((string) stream_get_contents($lockHandle));
            $timestamp = $now ?? time();
            $elapsed = max(0, $timestamp - $lastDispatch);
            if ($lastDispatch > 0 && $elapsed < self::INTERVAL_SECONDS) {
                return $this->result(
                    'cooldown',
                    'git',
                    true,
                    self::INTERVAL_SECONDS - $elapsed,
                    'A Git update check was dispatched recently.'
                );
            }

            if (!$this->launch($scriptPath)) {
                return $this->result(
                    'unavailable',
                    'git',
                    true,
                    self::INTERVAL_SECONDS,
                    'The server could not launch the Git updater in the background.'
                );
            }

            rewind($lockHandle);
            ftruncate($lockHandle, 0);
            fwrite($lockHandle, (string) $timestamp);
            fflush($lockHandle);

            return $this->result(
                'dispatched',
                'git',
                true,
                self::INTERVAL_SECONDS,
                'The Git updater was launched as a detached PHP process.'
            );
        } finally {
            flock($lockHandle, LOCK_UN);
            fclose($lockHandle);
        }
    }

    /**
     * @return array{status: string, mode: string, enabled: bool, intervalSeconds: int, retryAfterSeconds: int, message: string}
     */
    private function result(string $status, string $mode, bool $enabled, int $retryAfterSeconds, string $message): array
    {
        return [
            'status' => $status,
            'mode' => $mode,
            'enabled' => $enabled,
            'intervalSeconds' => self::INTERVAL_SECONDS,
            'retryAfterSeconds' => max(0, $retryAfterSeconds),
            'message' => $message,
        ];
    }

    private function lockPath(string $scriptPath): string
    {
        $deploymentRoot = trim((string) ($this->config->get(
            'UPDATE_GIT_DEPLOY_ROOT',
            $this->config->get('UPDATE_PROJECT_ROOT', dirname(__DIR__, 2))
        ) ?? ''));
        $identity = str_replace('\\', '/', $deploymentRoot !== '' ? $deploymentRoot : $scriptPath);
        $suffix = substr(hash('sha256', $identity), 0, 16);

        return $this->lockDirectory . DIRECTORY_SEPARATOR . 'mamepilot-git-update-dispatch-' . $suffix . '.lock';
    }

    private function launch(string $scriptPath): bool
    {
        $phpBinary = $this->phpBinary();
        if ($this->launcher !== null) {
            return (bool) ($this->launcher)($phpBinary, $scriptPath);
        }

        if (DIRECTORY_SEPARATOR === '\\' || !function_exists('exec')) {
            return false;
        }

        $command = sprintf(
            'nohup %s %s > /dev/null 2>&1 < /dev/null &',
            escapeshellarg($phpBinary),
            escapeshellarg($scriptPath)
        );
        $output = [];
        $exitCode = 1;
        @exec($command, $output, $exitCode);

        return $exitCode === 0;
    }

    private function phpBinary(): string
    {
        $configured = trim((string) ($this->config->get('UPDATE_PHP_BINARY', '') ?? ''));
        if ($configured !== '') {
            return $configured;
        }

        $binary = trim((string) PHP_BINARY);
        if ($binary !== '' && stripos(basename($binary), 'php-cgi') === false) {
            return $binary;
        }
        if ($binary !== '') {
            $cliSibling = dirname($binary) . DIRECTORY_SEPARATOR . 'php';
            if (is_file($cliSibling) && is_executable($cliSibling)) {
                return $cliSibling;
            }
        }
        foreach (['/usr/local/bin/php', '/usr/bin/php'] as $candidate) {
            if (is_file($candidate) && is_executable($candidate)) {
                return $candidate;
            }
        }

        return 'php';
    }

    private function boolConfig(string $key, bool $default): bool
    {
        $value = trim((string) ($this->config->get($key, '') ?? ''));
        if ($value === '') {
            return $default;
        }

        return in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
    }
}
