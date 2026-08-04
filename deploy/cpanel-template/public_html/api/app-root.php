<?php

declare(strict_types=1);

function mamepilotResolveAppRoot(?string $publicEnvPath = null): string
{
    $configuredRoot = getenv('MAMEPILOT_APP_ROOT') ?: getenv('BDHATBELA_APP_ROOT');
    if (is_string($configuredRoot) && trim($configuredRoot) !== '') {
        return rtrim($configuredRoot, '/\\');
    }

    // A public_html/.env file keeps this non-secret locator deployment-specific.
    // A PHP environment variable can override it at runtime.
    $defaultBackendFolder = 'mamepilot_backend';
    $configuredFolder = getenv('MAMEPILOT_BACKEND_FOLDER');
    if (!is_string($configuredFolder) || trim($configuredFolder) === '') {
        $publicEnvPath ??= dirname(__DIR__) . DIRECTORY_SEPARATOR . '.env';
        if (is_file($publicEnvPath)) {
            foreach (file($publicEnvPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
                if (preg_match('/^\s*MAMEPILOT_BACKEND_FOLDER\s*=\s*(.*?)\s*$/', $line, $matches) === 1) {
                    $configuredFolder = trim($matches[1], " \t\"'");
                    break;
                }
            }
        }
    }
    $backendFolder = is_string($configuredFolder) && trim($configuredFolder) !== ''
        ? trim($configuredFolder)
        : $defaultBackendFolder;

    if (
        $backendFolder === '.'
        || $backendFolder === '..'
        || basename(str_replace('\\', '/', $backendFolder)) !== $backendFolder
    ) {
        $backendFolder = $defaultBackendFolder;
    }

    return dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . $backendFolder;
}
