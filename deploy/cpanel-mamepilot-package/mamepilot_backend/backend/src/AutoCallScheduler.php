<?php

declare(strict_types=1);

namespace App;

final class AutoCallScheduler
{
    private const MARKER_PREFIX = '# mamepilot-auto-calling';

    private Config $config;

    public function __construct(Config $config)
    {
        $this->config = $config;
    }

    /** @return array{status: string, message: string} */
    public function ensureInstalled(): array
    {
        if (DIRECTORY_SEPARATOR === '\\') {
            return ['status' => 'skipped', 'message' => 'Scheduled task installation is not used on Windows.'];
        }
        if (!$this->boolConfig('AUTO_CALL_MANAGE_CRON', true)) {
            return ['status' => 'skipped', 'message' => 'Automatic schedule management is disabled.'];
        }
        if (!function_exists('proc_open')) {
            return ['status' => 'unavailable', 'message' => 'The hosting account does not allow schedule management.'];
        }

        $current = $this->run(['crontab', '-l']);
        if (
            $current['exitCode'] !== 0
            && stripos($current['stderr'], 'no crontab') === false
            && trim($current['stdout']) === ''
        ) {
            return ['status' => 'unavailable', 'message' => 'The hosting account does not provide user schedule access.'];
        }

        $existing = $current['exitCode'] === 0 ? $current['stdout'] : '';
        $entry = $this->cronEntry();
        $merged = self::mergeCrontab($existing, $entry);
        if (self::normalizeCrontab($existing) === self::normalizeCrontab($merged)) {
            return ['status' => 'present', 'message' => 'The automatic calling schedule is already installed.'];
        }

        $installed = $this->run(['crontab', '-'], $merged);
        if ($installed['exitCode'] !== 0) {
            return ['status' => 'unavailable', 'message' => 'The automatic calling schedule could not be installed automatically.'];
        }

        return ['status' => 'installed', 'message' => 'The automatic calling schedule was installed.'];
    }

    public static function mergeCrontab(string $existing, string $entry): string
    {
        $targetMarker = self::markerFromEntry($entry);
        $targetScript = self::workerScriptFromEntry($entry);
        $lines = preg_split('/\r?\n/', $existing) ?: [];
        $kept = [];
        foreach ($lines as $line) {
            $trimmed = trim($line);
            if ($trimmed === '') {
                continue;
            }
            $lineScript = self::workerScriptFromEntry($line);
            $sameMarker = $targetMarker !== '' && str_contains($line, $targetMarker);
            $sameScript = $targetScript !== ''
                && $lineScript !== ''
                && self::normalizePath($lineScript) === self::normalizePath($targetScript);
            if ($sameMarker || $sameScript) {
                continue;
            }
            $kept[] = rtrim($line);
        }
        $kept[] = trim($entry);

        return implode("\n", $kept) . "\n";
    }

    private static function normalizeCrontab(string $value): string
    {
        $lines = preg_split('/\r?\n/', trim($value)) ?: [];
        return implode("\n", array_map('rtrim', $lines));
    }

    private function cronEntry(): string
    {
        $script = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'process_survey_queue.php';
        $marker = self::MARKER_PREFIX . ':' . substr(hash('sha256', self::normalizePath($script)), 0, 12);
        $logPath = trim((string) ($this->config->get('AUTO_CALL_WORKER_LOG', '') ?? ''));
        if ($logPath === '') {
            $logPath = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'mamepilot-auto-call.log';
        }

        return sprintf(
            '* * * * * %s %s --once >> %s 2>&1 %s',
            escapeshellarg($this->phpBinary()),
            escapeshellarg($script),
            escapeshellarg($logPath),
            $marker
        );
    }

    private static function markerFromEntry(string $entry): string
    {
        if (preg_match('/# mamepilot-auto-calling:[a-f0-9]{12}/i', $entry, $matches) === 1) {
            return (string) $matches[0];
        }

        return '';
    }

    private static function workerScriptFromEntry(string $entry): string
    {
        if (preg_match('/([\'\"])([^\'\"]*process_survey_queue\.php)\1/', $entry, $matches) === 1) {
            return (string) $matches[2];
        }
        if (preg_match('/([^\s\'\"]*process_survey_queue\.php)/', $entry, $matches) === 1) {
            return (string) $matches[1];
        }

        return '';
    }

    private static function normalizePath(string $path): string
    {
        return rtrim(str_replace('\\', '/', trim($path)), '/');
    }

    private function phpBinary(): string
    {
        $configured = trim((string) ($this->config->get(
            'AUTO_CALL_PHP_BINARY',
            $this->config->get('UPDATE_PHP_BINARY', '')
        ) ?? ''));
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

    /** @return array{exitCode: int, stdout: string, stderr: string} */
    private function run(array $command, ?string $stdin = null): array
    {
        $descriptorSpec = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        try {
            $process = @proc_open($command, $descriptorSpec, $pipes);
        } catch (\Throwable $exception) {
            return ['exitCode' => 1, 'stdout' => '', 'stderr' => $exception->getMessage()];
        }
        if (!is_resource($process)) {
            return ['exitCode' => 1, 'stdout' => '', 'stderr' => 'Could not start schedule command.'];
        }

        if ($stdin !== null) {
            fwrite($pipes[0], $stdin);
        }
        fclose($pipes[0]);
        $stdout = (string) stream_get_contents($pipes[1]);
        $stderr = (string) stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);

        return ['exitCode' => proc_close($process), 'stdout' => $stdout, 'stderr' => $stderr];
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
