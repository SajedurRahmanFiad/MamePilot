<?php

declare(strict_types=1);

namespace App;

final class AppVersion
{
    public const UNKNOWN = '0.0.0';

    public static function current(?string $projectRoot = null): string
    {
        $root = $projectRoot ?? dirname(__DIR__, 2);
        $path = $root . DIRECTORY_SEPARATOR . 'VERSION';

        if (!is_file($path)) {
            return self::UNKNOWN;
        }

        $content = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($content === false || $content === []) {
            return self::UNKNOWN;
        }

        $version = trim((string) $content[0]);
        if ($version === '' || !preg_match('/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/', $version)) {
            return self::UNKNOWN;
        }

        return $version;
    }

    /**
     * @return array<string, string|null>
     */
    public static function info(?string $projectRoot = null): array
    {
        $root = $projectRoot ?? dirname(__DIR__, 2);
        $versionPath = $root . DIRECTORY_SEPARATOR . 'VERSION';
        $modifiedAt = is_file($versionPath) ? @filemtime($versionPath) : false;

        return [
            'version' => self::current($root),
            'versionFile' => is_file($versionPath) ? $versionPath : null,
            'versionFileModifiedAt' => $modifiedAt === false ? null : gmdate('c', (int) $modifiedAt),
            'gitCommit' => self::gitCommit($root),
        ];
    }

    private static function gitCommit(string $projectRoot): ?string
    {
        $head = $projectRoot . DIRECTORY_SEPARATOR . '.git' . DIRECTORY_SEPARATOR . 'HEAD';
        if (!is_file($head)) {
            return null;
        }

        $content = trim((string) file_get_contents($head));
        if ($content === '' || !str_starts_with($content, 'ref:')) {
            return $content === '' ? null : $content;
        }

        $ref = trim(substr($content, 5));
        $refPath = $projectRoot . DIRECTORY_SEPARATOR . '.git' . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $ref);
        if (is_file($refPath)) {
            return trim((string) file_get_contents($refPath)) ?: null;
        }

        return null;
    }
}
