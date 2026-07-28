<?php

declare(strict_types=1);

namespace App;

use RuntimeException;
use ZipArchive;

final class UpdateManager
{
    private Config $config;
    private Database $database;

    public function __construct(Config $config, Database $database)
    {
        $this->config = $config;
        $this->database = $database;
    }

    public function check(): array
    {
        $this->assertEnabled();
        $localVersion = AppVersion::current($this->projectRoot());
        $method = $this->updateMethod();

        if ($method === 'git') {
            $remote = $this->gitRemoteVersion();
            $remoteVersion = $remote['version'];
            $versionSource = $remote['source'];
        } else {
            $versionSource = $this->versionUrl();
            $remoteVersion = $this->normalizeVersion(
                $this->fetchText($versionSource, 'remote version'),
                'release package version'
            );
        }

        return [
            'method' => $method,
            'localVersion' => $localVersion,
            'remoteVersion' => $remoteVersion,
            'versionSource' => $versionSource,
            'updateAvailable' => version_compare($remoteVersion, $localVersion, '>'),
            'checkedAt' => gmdate('c'),
        ];
    }

    public function update(bool $force = false): array
    {
        $this->assertEnabled();
        $check = $this->check();
        (new AuditLog($this->config))->append('update.check', $check);
        $this->cleanupStaleTemporaryDirectories();
        if (!$force && !$check['updateAvailable']) {
            return array_merge($check, [
                'updated' => false,
                'message' => 'Already on the latest version.',
                'automaticUpdateSchedule' => (new UpdateScheduler($this->config))->ensureInstalled(),
            ]);
        }

        $projectRoot = $this->projectRoot();
        $appRoot = $this->config->get('UPDATE_APP_ROOT', $projectRoot);

        if (($check['method'] ?? $this->updateMethod()) === 'git') {
            return $this->updateFromGit($check, $force, $appRoot);
        }

        $releaseUrl = $this->releaseUrl();
        $publicRoot = $this->config->get('UPDATE_PUBLIC_ROOT', '');
        $documentRootFolder = self::normalizeReleaseFolderName(
            (string) $this->config->get('UPDATE_DOCUMENT_ROOT_FOLDER', 'public_html'),
            'public_html'
        );
        $backendFolder = self::normalizeReleaseFolderName(
            (string) $this->config->get('UPDATE_BACKEND_FOLDER', 'mamepilot_backend'),
            'mamepilot_backend'
        );
        $tempRoot = $this->temporaryDirectory();
        $result = null;
        $failure = null;
        $cleanupFailure = null;

        try {
            $zipPath = $tempRoot . DIRECTORY_SEPARATOR . 'release.zip';
            $extractRoot = $tempRoot . DIRECTORY_SEPARATOR . 'release';
            if (!is_dir($extractRoot)) {
                mkdir($extractRoot, 0755, true);
            }

            $this->downloadFile($releaseUrl, $zipPath);
            $this->extractZip($zipPath, $extractRoot);

            $extractedBackend = $extractRoot . DIRECTORY_SEPARATOR . $backendFolder;
            if (!is_dir($extractedBackend)) {
                throw new RuntimeException("Release package does not contain backend folder: {$backendFolder}");
            }
            $this->assertReleasePackageVersion($extractedBackend, (string) $check['remoteVersion']);
            $this->copyDirectory($extractedBackend, $appRoot, ['.env', '.env.local']);

            if ($publicRoot !== '' && is_dir($extractRoot . DIRECTORY_SEPARATOR . $documentRootFolder)) {
                $this->copyDirectory($extractRoot . DIRECTORY_SEPARATOR . $documentRootFolder, $publicRoot, []);
            }

            $databaseResult = [];
            if ($this->boolConfig('UPDATE_RUN_SCHEMA', true)) {
                $databaseResult = $this->runSchemaUpdate(dirname(__DIR__, 2));

                if ($this->boolConfig('UPDATE_RUN_SEED', false)) {
                    // Seed data is an installation concern, never an upgrade step. Older
                    // deployments may still have UPDATE_RUN_SEED=1 in their preserved
                    // .env file; honoring it here can overwrite branding, theme, invoice,
                    // courier, catalog, and login data after every automatic update.
                    $databaseResult['seed'] = 'Skipped seed.sql: automatic updates preserve existing data. Use backend:setup for a fresh install.';
                }
            } elseif ($this->boolConfig('UPDATE_RUN_MIGRATIONS', false)) {
                $databaseResult = (new MigrationManager($this->config, $this->database))->run();
            } else {
                $databaseResult = ['message' => 'Database update step skipped.'];
            }
            $autoCallSchedule = (new AutoCallScheduler($this->config))->ensureInstalled();
            $updateSchedule = (new UpdateScheduler($this->config))->ensureInstalled();

            $result = [
                'updated' => true,
                'method' => 'package',
                'localVersion' => $check['localVersion'],
                'remoteVersion' => $check['remoteVersion'],
                'releaseUrl' => $releaseUrl,
                'appRoot' => $appRoot,
                'publicRoot' => $publicRoot === '' ? null : $publicRoot,
                'backupRoot' => null,
                'database' => $databaseResult,
                'automaticCallingSchedule' => $autoCallSchedule,
                'automaticUpdateSchedule' => $updateSchedule,
                'updatedAt' => gmdate('c'),
            ];
        } catch (\Throwable $exception) {
            $failure = $exception;
        } finally {
            try {
                $this->removeDirectory($tempRoot);
            } catch (\Throwable $exception) {
                $cleanupFailure = $exception;
            }
        }

        if ($failure !== null || $cleanupFailure !== null) {
            $reportedFailure = $failure ?? $cleanupFailure;
            (new AuditLog($this->config))->append('update.failed', [
                'localVersion' => $check['localVersion'] ?? null,
                'remoteVersion' => $check['remoteVersion'] ?? null,
                'error' => $reportedFailure?->getMessage(),
                'cleanupError' => $cleanupFailure?->getMessage(),
            ]);
            throw new RuntimeException(
                'Update failed: ' . $reportedFailure?->getMessage(),
                0,
                $reportedFailure,
            );
        }

        if (!is_array($result)) {
            throw new RuntimeException('Update failed without producing a result.');
        }

        (new AuditLog($this->config))->append('update.success', $result);

        return $result;
    }

    /**
     * @param array<string, mixed> $check
     */
    private function updateFromGit(array $check, bool $force, string $appRoot): array
    {
        $gitRoot = $this->config->get('UPDATE_GIT_DEPLOY_ROOT', $this->projectRoot());
        $skipPull = $this->boolConfig('UPDATE_GIT_SKIP_PULL', false);
        $branch = $this->gitBranch();
        $documentRoot = $this->requiredConfig('UPDATE_DOCUMENT_ROOT');
        $backendRoot = $this->config->get('UPDATE_BACKEND_ROOT', dirname($gitRoot) . DIRECTORY_SEPARATOR . 'mamepilot_backend');

        try {
            if (!$skipPull) {
                $gitUrl = $this->requiredConfig('UPDATE_GIT_URL');
                $this->runGitCommand($gitRoot, ['remote', 'set-url', 'origin', $gitUrl]);
                $this->runGitCommand($gitRoot, ['fetch', 'origin', $branch]);
                $this->runGitCommand($gitRoot, ['pull', '--ff-only', 'origin', $branch]);
            }
            $this->buildFrontend($gitRoot);
            $this->deployGitCheckout($gitRoot, $documentRoot, $backendRoot);

            if ($this->boolConfig('UPDATE_RUN_SCHEMA', true)) {
                $databaseResult = $this->runSchemaUpdate($gitRoot);
            } else {
                $databaseResult = ['message' => 'Schema update skipped by UPDATE_RUN_SCHEMA=0.'];
            }
            $autoCallSchedule = (new AutoCallScheduler($this->config))->ensureInstalled();
            $updateSchedule = (new UpdateScheduler($this->config))->ensureInstalled();

            $result = [
                'updated' => true,
                'method' => 'git',
                'localVersion' => $check['localVersion'] ?? null,
                'remoteVersion' => $check['remoteVersion'] ?? null,
                'gitRoot' => $gitRoot,
                'documentRoot' => $documentRoot,
                'backendRoot' => $backendRoot,
                'backupRoot' => null,
                'database' => $databaseResult,
                'automaticCallingSchedule' => $autoCallSchedule,
                'automaticUpdateSchedule' => $updateSchedule,
                'updatedAt' => gmdate('c'),
            ];
            (new AuditLog($this->config))->append('update.git_success', $result);

            return $result;
        } catch (\Throwable $exception) {
            (new AuditLog($this->config))->append('update.git_failed', [
                'gitRoot' => $gitRoot,
                'documentRoot' => $documentRoot,
                'backendRoot' => $backendRoot,
                'localVersion' => $check['localVersion'] ?? null,
                'remoteVersion' => $check['remoteVersion'] ?? null,
                'error' => $exception->getMessage(),
            ]);
            throw new RuntimeException('Git update failed: ' . $exception->getMessage(), 0, $exception);
        }
    }

    private function buildFrontend(string $gitRoot): void
    {
        if ($this->boolConfig('UPDATE_SKIP_BUILD', false)) {
            return;
        }

        $command = trim((string) $this->config->get('UPDATE_BUILD_COMMAND', 'npm run build'));
        if ($command === '') {
            return;
        }

        $this->runShellCommand($gitRoot, $command);
    }

    /** @return array{schema: string, path: string} */
    private function runSchemaUpdate(string $root): array
    {
        $schemaPath = $this->schemaUpdatePath($root);
        (new SchemaManager($this->config, $this->database))->runSqlFile($schemaPath, false);

        return [
            'schema' => 'Applied ' . basename($schemaPath),
            'path' => $schemaPath,
        ];
    }

    private function schemaUpdatePath(string $root): string
    {
        $configuredPath = trim((string) $this->config->get('UPDATE_SCHEMA_PATH', ''));
        if ($configuredPath === '') {
            return $root . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'schema-only.sql';
        }

        $isAbsolute = str_starts_with($configuredPath, DIRECTORY_SEPARATOR)
            || preg_match('/^[A-Za-z]:[\\\\\/]/', $configuredPath) === 1;
        if (!$isAbsolute) {
            $configuredPath = rtrim($root, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $configuredPath;
        }

        // Older .env examples pointed at schema.sql. That file creates fresh tables,
        // but CREATE TABLE IF NOT EXISTS cannot add columns to an existing table.
        // Transparently prefer the sibling production upgrade artifact so existing
        // installations receive additive migrations without requiring an .env edit.
        if (strtolower(basename($configuredPath)) === 'schema.sql') {
            $upgradePath = dirname($configuredPath) . DIRECTORY_SEPARATOR . 'schema-only.sql';
            if (is_file($upgradePath)) {
                return $upgradePath;
            }
        }

        return $configuredPath;
    }

    private function deployGitCheckout(string $gitRoot, string $documentRoot, string $backendRoot): void
    {
        $templateRoot = $gitRoot . DIRECTORY_SEPARATOR . 'deploy' . DIRECTORY_SEPARATOR . 'cpanel-template' . DIRECTORY_SEPARATOR . 'public_html';
        $distRoot = $gitRoot . DIRECTORY_SEPARATOR . 'dist';
        $backendSource = $gitRoot . DIRECTORY_SEPARATOR . 'backend';

        if (!is_dir($distRoot)) {
            throw new RuntimeException("Frontend build output not found after build: {$distRoot}");
        }
        if (!is_dir($backendSource)) {
            throw new RuntimeException("Backend source not found in git checkout: {$backendSource}");
        }
        if (!is_dir($templateRoot)) {
            throw new RuntimeException("cPanel template not found: {$templateRoot}");
        }

        $this->copyDirectory($distRoot, $documentRoot, []);
        $this->copyFile($templateRoot . DIRECTORY_SEPARATOR . '.htaccess', $documentRoot . DIRECTORY_SEPARATOR . '.htaccess');

        $apiRoot = $documentRoot . DIRECTORY_SEPARATOR . 'api';
        if (!is_dir($apiRoot) && !mkdir($apiRoot, 0755, true) && !is_dir($apiRoot)) {
            throw new RuntimeException("Failed to create API directory: {$apiRoot}");
        }
        $this->copyDirectory($templateRoot . DIRECTORY_SEPARATOR . 'api', $apiRoot, []);

        if (!is_dir($backendRoot) && !mkdir($backendRoot, 0755, true) && !is_dir($backendRoot)) {
            throw new RuntimeException("Failed to create backend root: {$backendRoot}");
        }
        $this->copyDirectory($backendSource, $backendRoot . DIRECTORY_SEPARATOR . 'backend', ['.env', '.env.local']);
        $this->copyFile($gitRoot . DIRECTORY_SEPARATOR . '.env.example', $backendRoot . DIRECTORY_SEPARATOR . '.env.example');
        $this->copyFile($gitRoot . DIRECTORY_SEPARATOR . 'VERSION', $backendRoot . DIRECTORY_SEPARATOR . 'VERSION');
    }

    private function copyFile(string $source, string $destination): void
    {
        if (!is_file($source)) {
            throw new RuntimeException("Source file not found: {$source}");
        }

        $parent = dirname($destination);
        if (!is_dir($parent) && !mkdir($parent, 0755, true) && !is_dir($parent)) {
            throw new RuntimeException("Failed to create directory: {$parent}");
        }
        if (!copy($source, $destination)) {
            throw new RuntimeException("Failed to copy {$source} to {$destination}");
        }
    }

    private function runShellCommand(string $workingDirectory, string $command): void
    {
        $descriptorSpec = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        $process = proc_open($command, $descriptorSpec, $pipes, $workingDirectory);
        if (!is_resource($process)) {
            throw new RuntimeException("Failed to start command: {$command}");
        }

        fclose($pipes[0]);
        $stdout = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($process);

        if ($exitCode !== 0) {
            throw new RuntimeException(trim((string) $stderr ?: $stdout) ?: "Command failed: {$command}");
        }
    }

    private function versionUrl(): string
    {
        $versionUrl = trim((string) $this->config->get('UPDATE_VERSION_URL', ''));
        if ($versionUrl !== '') {
            return $versionUrl;
        }

        $baseUrl = $this->baseUrl();
        $versionFile = trim((string) $this->config->get('UPDATE_VERSION_FILENAME', 'VERSION'));
        if ($versionFile === '') {
            $versionFile = 'VERSION';
        }

        return rtrim($baseUrl, '/') . '/' . $versionFile;
    }

    private function releaseUrl(): string
    {
        $releaseUrl = trim((string) $this->config->get('UPDATE_RELEASE_URL', ''));
        if ($releaseUrl !== '') {
            return $releaseUrl;
        }

        $baseUrl = $this->baseUrl();
        $packageName = trim((string) $this->config->get('UPDATE_PACKAGE_NAME', 'cpanel-mamepilot-package'));
        if ($packageName === '') {
            $packageName = 'cpanel-mamepilot-package';
        }

        return rtrim($baseUrl, '/') . '/' . $packageName . '.zip';
    }

    private function baseUrl(): string
    {
        $baseUrl = trim((string) $this->config->get('UPDATE_BASE_URL', ''));
        if ($baseUrl === '') {
            throw new RuntimeException('Missing UPDATE_BASE_URL, or set UPDATE_VERSION_URL and UPDATE_RELEASE_URL manually.');
        }

        return $baseUrl;
    }

    private function updateMethod(): string
    {
        return $this->boolConfig('UPDATE_USE_GIT', false) ? 'git' : 'package';
    }

    /** @return array{version: string, source: string} */
    private function gitRemoteVersion(): array
    {
        $gitRoot = $this->config->get('UPDATE_GIT_DEPLOY_ROOT', $this->projectRoot());
        $branch = $this->gitBranch();

        if ($this->boolConfig('UPDATE_GIT_SKIP_PULL', false)) {
            // cPanel Git Version Control handles pulls; read local VERSION.
            $versionPath = rtrim($gitRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'VERSION';
            if (!is_file($versionPath)) {
                throw new RuntimeException("VERSION file not found in local repo: {$versionPath}");
            }
            $version = file_get_contents($versionPath);
            if ($version === false) {
                throw new RuntimeException("Failed to read VERSION from local repo: {$versionPath}");
            }

            return [
                'version' => $this->normalizeVersion($version, 'Git VERSION'),
                'source' => 'git:local:VERSION',
            ];
        }

        $gitUrl = $this->requiredConfig('UPDATE_GIT_URL');
        $remoteRef = 'refs/remotes/origin/' . $branch;

        $this->runGitCommand($gitRoot, ['remote', 'set-url', 'origin', $gitUrl]);
        $this->runGitCommand($gitRoot, ['fetch', 'origin', $branch]);
        $version = $this->runGitCommand($gitRoot, ['show', $remoteRef . ':VERSION']);

        return [
            'version' => $this->normalizeVersion($version, 'Git VERSION'),
            'source' => 'git:origin/' . $branch . ':VERSION',
        ];
    }

    private function gitBranch(): string
    {
        $branch = trim((string) $this->config->get('UPDATE_GIT_BRANCH', 'main'));
        if (
            $branch === ''
            || preg_match('/^[A-Za-z0-9][A-Za-z0-9._\/-]*$/', $branch) !== 1
            || str_contains($branch, '..')
            || str_contains($branch, '//')
            || str_ends_with($branch, '/')
            || str_ends_with($branch, '.')
        ) {
            throw new RuntimeException('Invalid UPDATE_GIT_BRANCH value.');
        }

        return $branch;
    }

    private function normalizeVersion(string $version, string $label): string
    {
        $normalized = trim(preg_replace('/^\s*(?:v)?/i', '', $version) ?? '');
        if (preg_match('/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/', $normalized) !== 1) {
            throw new RuntimeException("Invalid {$label}: {$normalized}");
        }

        return $normalized;
    }

    private function assertEnabled(): void
    {
        if (!$this->boolConfig('UPDATE_ENABLED', false)) {
            throw new RuntimeException('Automatic updates are disabled. Set UPDATE_ENABLED=1 in .env to enable them.');
        }
    }

    private function requiredConfig(string $key): string
    {
        $value = $this->config->get($key);
        if ($value === null || trim($value) === '') {
            throw new RuntimeException("Missing required config value: {$key}");
        }

        return trim($value);
    }

    public static function normalizeReleaseFolderName(string $configured, string $default): string
    {
        $value = trim($configured);
        if ($value === '') {
            return $default;
        }

        $normalized = str_replace('\\', '/', $value);
        $looksLikePath = str_starts_with($normalized, '/')
            || preg_match('/^[A-Za-z]:\//', $normalized) === 1
            || str_contains($normalized, '/');
        if ($looksLikePath) {
            // Older deployment instructions were sometimes interpreted as asking
            // for destination paths here. These settings identify top-level ZIP
            // folders, while UPDATE_PUBLIC_ROOT/UPDATE_APP_ROOT hold destinations.
            return $default;
        }

        if ($normalized === '.' || $normalized === '..') {
            return $default;
        }

        return $normalized;
    }

    private function boolConfig(string $key, bool $default): bool
    {
        $value = $this->config->get($key);
        if ($value === null || trim($value) === '') {
            return $default;
        }

        return in_array(strtolower(trim($value)), ['1', 'true', 'yes', 'on'], true);
    }

    private function projectRoot(): string
    {
        $configuredRoot = trim((string) $this->config->get('UPDATE_PROJECT_ROOT', ''));
        if ($configuredRoot !== '' && is_file(rtrim($configuredRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'VERSION')) {
            return rtrim($configuredRoot, DIRECTORY_SEPARATOR);
        }

        $appRoot = trim((string) $this->config->get('UPDATE_APP_ROOT', ''));
        if ($appRoot !== '' && is_file(rtrim($appRoot, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'VERSION')) {
            return rtrim($appRoot, DIRECTORY_SEPARATOR);
        }

        return dirname(__DIR__, 2);
    }

    private function temporaryDirectory(): string
    {
        $base = $this->config->get('UPDATE_TEMP_DIR', sys_get_temp_dir());
        $dir = rtrim($base, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'mamepilot-update-' . gmdate('YmdHis') . '-' . bin2hex(random_bytes(4));
        if (!mkdir($dir, 0700, true) && !is_dir($dir)) {
            throw new RuntimeException("Failed to create temporary directory: {$dir}");
        }

        return $dir;
    }

    private function cleanupStaleTemporaryDirectories(): void
    {
        $base = rtrim((string) $this->config->get('UPDATE_TEMP_DIR', sys_get_temp_dir()), DIRECTORY_SEPARATOR);
        if ($base === '' || !is_dir($base)) {
            return;
        }

        $staleBefore = time() - 600;
        foreach (scandir($base) ?: [] as $item) {
            if (preg_match('/^mamepilot-update-\d{14}-[a-f0-9]{8}$/', $item) !== 1) {
                continue;
            }

            $path = $base . DIRECTORY_SEPARATOR . $item;
            $modifiedAt = filemtime($path);
            if (is_link($path) || !is_dir($path) || $modifiedAt === false || $modifiedAt > $staleBefore) {
                continue;
            }

            $this->removeDirectory($path);
        }
    }

    private function assertReleasePackageVersion(string $extractedBackend, string $expectedVersion): void
    {
        $versionPath = rtrim($extractedBackend, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'VERSION';
        if (!is_file($versionPath)) {
            throw new RuntimeException('Release package does not contain mamepilot_backend/VERSION.');
        }

        $contents = file_get_contents($versionPath);
        if ($contents === false) {
            throw new RuntimeException('Failed to read the release package VERSION file.');
        }

        $packageVersion = $this->normalizeVersion($contents, 'release package VERSION');
        if ($packageVersion !== $expectedVersion) {
            throw new RuntimeException(
                "Release package version {$packageVersion} does not match advertised version {$expectedVersion}."
            );
        }
    }

    private function removeDirectory(string $path): void
    {
        if (!file_exists($path) && !is_link($path)) {
            return;
        }
        if (is_link($path) || !is_dir($path)) {
            if (!@unlink($path)) {
                throw new RuntimeException("Failed to remove temporary update path: {$path}");
            }
            return;
        }

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($path, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::CHILD_FIRST,
        );
        foreach ($iterator as $item) {
            $itemPath = $item->getPathname();
            $removed = $item->isDir() && !$item->isLink()
                ? @rmdir($itemPath)
                : @unlink($itemPath);
            if (!$removed) {
                throw new RuntimeException("Failed to remove temporary update path: {$itemPath}");
            }
        }

        if (!@rmdir($path)) {
            throw new RuntimeException("Failed to remove temporary update directory: {$path}");
        }
    }

    /**
     * @param list<string> $args
     */
    private function runGitCommand(string $gitRoot, array $args, bool $requireRoot = true): string
    {
        if ($requireRoot && !is_dir($gitRoot . DIRECTORY_SEPARATOR . '.git')) {
            throw new RuntimeException("Git deploy root is not a git repository: {$gitRoot}");
        }

        $command = array_merge(['git', '-C', $gitRoot], $args);
        $descriptorSpec = [
            0 => ['pipe', 'r'],
            1 => ['pipe', 'w'],
            2 => ['pipe', 'w'],
        ];

        $process = proc_open(implode(' ', array_map('escapeshellarg', $command)), $descriptorSpec, $pipes);
        if (!is_resource($process)) {
            throw new RuntimeException('Failed to start git command.');
        }

        fclose($pipes[0]);
        $stdout = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        $exitCode = proc_close($process);

        if ($exitCode !== 0) {
            throw new RuntimeException(trim((string) $stderr) ?: 'git command failed.');
        }

        return (string) $stdout;
    }

    private function downloadFile(string $url, string $destination): void
    {
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => "User-Agent: MamePilot-Updater\r\n",
                'timeout' => 120,
                'ignore_errors' => true,
            ],
            'https' => [
                'method' => 'GET',
                'header' => "User-Agent: MamePilot-Updater\r\n",
                'timeout' => 120,
                'ignore_errors' => true,
            ],
        ]);

        $contents = file_get_contents($url, false, $context);
        if ($contents === false) {
            throw new RuntimeException("Failed to download release package: {$url}");
        }

        if (file_put_contents($destination, $contents) === false) {
            throw new RuntimeException("Failed to write release package: {$destination}");
        }

        if (filesize($destination) < 100) {
            throw new RuntimeException("Downloaded release package looks too small. Check UPDATE_RELEASE_URL.");
        }
    }

    private function fetchText(string $url, string $label): string
    {
        $context = stream_context_create([
            'http' => [
                'method' => 'GET',
                'header' => "User-Agent: MamePilot-Updater\r\n",
                'timeout' => 120,
                'ignore_errors' => true,
            ],
            'https' => [
                'method' => 'GET',
                'header' => "User-Agent: MamePilot-Updater\r\n",
                'timeout' => 120,
                'ignore_errors' => true,
            ],
        ]);

        $contents = file_get_contents($url, false, $context);
        if ($contents === false) {
            throw new RuntimeException("Failed to fetch {$label}: {$url}");
        }

        $trimmed = trim($contents);
        if ($trimmed === '') {
            throw new RuntimeException("Fetched {$label} was empty: {$url}");
        }

        return $contents;
    }

    private function extractZip(string $zipPath, string $extractRoot): void
    {
        if (!class_exists(ZipArchive::class)) {
            throw new RuntimeException('PHP ZipArchive extension is required for updates.');
        }

        $zip = new ZipArchive();
        $result = $zip->open($zipPath);
        if ($result !== true) {
            throw new RuntimeException("Failed to open release ZIP. ZipArchive error {$result}.");
        }

        if (!$zip->extractTo($extractRoot)) {
            $zip->close();
            throw new RuntimeException('Failed to extract release ZIP.');
        }

        $zip->close();
    }

    /**
     * @param list<string> $excludeNames
     */
    private function copyDirectory(string $source, string $destination, array $excludeNames = []): void
    {
        if (!is_dir($source)) {
            throw new RuntimeException("Source directory not found: {$source}");
        }
        if (!is_dir($destination) && !mkdir($destination, 0755, true) && !is_dir($destination)) {
            throw new RuntimeException("Failed to create destination directory: {$destination}");
        }

        $iterator = new \RecursiveIteratorIterator(
            new \RecursiveDirectoryIterator($source, \FilesystemIterator::SKIP_DOTS),
            \RecursiveIteratorIterator::SELF_FIRST
        );

        foreach ($iterator as $item) {
            $relative = $iterator->getSubPathName();
            $baseName = basename($relative);
            if (in_array($baseName, $excludeNames, true)) {
                continue;
            }

            $target = $destination . DIRECTORY_SEPARATOR . $relative;
            if ($item->isDir()) {
                if (!is_dir($target) && !mkdir($target, 0755, true) && !is_dir($target)) {
                    throw new RuntimeException("Failed to create directory: {$target}");
                }
                continue;
            }

            $parent = dirname($target);
            if (!is_dir($parent) && !mkdir($parent, 0755, true) && !is_dir($parent)) {
                throw new RuntimeException("Failed to create directory: {$parent}");
            }
            if (!copy($item->getPathname(), $target)) {
                throw new RuntimeException("Failed to copy {$item->getPathname()} to {$target}");
            }
        }
    }
}
