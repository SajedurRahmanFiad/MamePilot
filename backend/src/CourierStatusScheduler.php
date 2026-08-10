<?php

declare(strict_types=1);

namespace App;

final class CourierStatusScheduler
{
    private const MARKER_PREFIX = '# mamepilot-courier-status';

    public function __construct(private Config $config)
    {
    }

    /** @return array{status:string,message:string} */
    public function ensureInstalled(): array
    {
        if (DIRECTORY_SEPARATOR === '\\') return ['status' => 'skipped', 'message' => 'Courier polling schedule installation is not used on Windows.'];
        if (!$this->boolConfig('COURIER_POLL_MANAGE_CRON', true)) return ['status' => 'skipped', 'message' => 'Courier polling schedule management is disabled.'];
        if (!function_exists('proc_open')) return ['status' => 'unavailable', 'message' => 'The hosting account does not allow courier schedule management.'];

        $current = $this->run(['crontab', '-l']);
        if ($current['exitCode'] !== 0 && stripos($current['stderr'], 'no crontab') === false && trim($current['stdout']) === '') {
            return ['status' => 'unavailable', 'message' => 'The hosting account does not provide user schedule access.'];
        }
        $existing = $current['exitCode'] === 0 ? $current['stdout'] : '';
        $entry = $this->cronEntry();
        $merged = self::mergeCrontab($existing, $entry);
        if (self::normalizeCrontab($existing) === self::normalizeCrontab($merged)) {
            return ['status' => 'present', 'message' => 'The courier confirmation schedule is already installed.'];
        }
        $installed = $this->run(['crontab', '-'], $merged);
        if ($installed['exitCode'] !== 0) return ['status' => 'unavailable', 'message' => 'The courier confirmation schedule could not be installed automatically.'];
        return ['status' => 'installed', 'message' => 'The courier confirmation schedule was installed.'];
    }

    public static function mergeCrontab(string $existing, string $entry): string
    {
        $targetMarker = self::markerFromEntry($entry);
        $targetScript = self::workerScriptFromEntry($entry);
        $kept = [];
        foreach (preg_split('/\r?\n/', $existing) ?: [] as $line) {
            if (trim($line) === '') continue;
            $lineScript = self::workerScriptFromEntry($line);
            $sameMarker = $targetMarker !== '' && str_contains($line, $targetMarker);
            $sameScript = $targetScript !== '' && $lineScript !== '' && self::normalizePath($lineScript) === self::normalizePath($targetScript);
            if (!$sameMarker && !$sameScript) $kept[] = rtrim($line);
        }
        $kept[] = trim($entry);
        return implode("\n", $kept) . "\n";
    }

    private function cronEntry(): string
    {
        $script = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'process_courier_statuses.php';
        $marker = self::MARKER_PREFIX . ':' . substr(hash('sha256', self::normalizePath($script)), 0, 12);
        $minute = abs((int) crc32(self::normalizePath($script))) % 5;
        $logPath = trim((string) ($this->config->get('COURIER_POLL_WORKER_LOG', '') ?? ''));
        if ($logPath === '') $logPath = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'mamepilot-courier-status.log';
        return sprintf(
            '%d-59/5 * * * * %s %s --once >> %s 2>&1 %s',
            $minute,
            escapeshellarg($this->phpBinary()),
            escapeshellarg($script),
            escapeshellarg($logPath),
            $marker
        );
    }

    private static function normalizeCrontab(string $value): string
    {
        return implode("\n", array_map('rtrim', preg_split('/\r?\n/', trim($value)) ?: []));
    }

    private static function markerFromEntry(string $entry): string
    {
        return preg_match('/# mamepilot-courier-status:[a-f0-9]{12}/i', $entry, $matches) === 1 ? (string) $matches[0] : '';
    }

    private static function workerScriptFromEntry(string $entry): string
    {
        if (preg_match('/([\'\"])([^\'\"]*process_courier_statuses\.php)\1/', $entry, $matches) === 1) return (string) $matches[2];
        if (preg_match('/([^\s\'\"]*process_courier_statuses\.php)/', $entry, $matches) === 1) return (string) $matches[1];
        return '';
    }

    private static function normalizePath(string $path): string
    {
        return rtrim(str_replace('\\', '/', trim($path)), '/');
    }

    private function phpBinary(): string
    {
        $configured = trim((string) ($this->config->get('COURIER_POLL_PHP_BINARY', $this->config->get('UPDATE_PHP_BINARY', '')) ?? ''));
        if ($configured !== '') return $configured;
        $binary = trim((string) PHP_BINARY);
        if ($binary !== '' && stripos(basename($binary), 'php-cgi') === false) return $binary;
        foreach (['/usr/local/bin/php', '/usr/bin/php'] as $candidate) if (is_file($candidate) && is_executable($candidate)) return $candidate;
        return 'php';
    }

    /** @return array{exitCode:int,stdout:string,stderr:string} */
    private function run(array $command, ?string $stdin = null): array
    {
        try {
            $process = @proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        } catch (\Throwable $exception) {
            return ['exitCode' => 1, 'stdout' => '', 'stderr' => $exception->getMessage()];
        }
        if (!is_resource($process)) return ['exitCode' => 1, 'stdout' => '', 'stderr' => 'Could not start schedule command.'];
        if ($stdin !== null) fwrite($pipes[0], $stdin);
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
        return $value === '' ? $default : in_array(strtolower($value), ['1', 'true', 'yes', 'on'], true);
    }
}
