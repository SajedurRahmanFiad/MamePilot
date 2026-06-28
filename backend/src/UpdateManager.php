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
        $remoteVersion = $this->fetchText($this->versionUrl(), 'remote version');
        $remoteVersion = trim(preg_replace('/^\s*(?:v)?/i', '', $remoteVersion) ?? '');

        return [
            'localVersion' => $localVersion,
            'remoteVersion' => $remoteVersion,
            'updateAvailable' => version_compare($remoteVersion, $localVersion, '>'),
            'checkedAt' => gmdate('c'),
        ];
    }

    public function update(bool $force = false): array
    {
        $this->assertEnabled();
        $check = $this->check();
        (new AuditLog($this->config))->append('update.check', $check);
        if (!$force && !$check['updateAvailable']) {
            return array_merge($check, ['updated' => false, 'message' => 'Already on the latest version.']);
        }

        $projectRoot = $this->projectRoot();
        $appRoot = $this->config->get('UPDATE_APP_ROOT', $projectRoot);

        if ($this->boolConfig('UPDATE_USE_GIT', false)) {
            return $this->updateFromGit($check, $force, $appRoot);
        }

        $releaseUrl = $this->releaseUrl();
        $publicRoot = $this->config->get('UPDATE_PUBLIC_ROOT', '');
        $documentRootFolder = $this->config->get('UPDATE_DOCUMENT_ROOT_FOLDER', 'public_html');
        $backendFolder = $this->config->get('UPDATE_BACKEND_FOLDER', 'mamepilot_backend');
        $tempRoot = $this->temporaryDirectory();
        
        // Check if UPDATE_BACKUP_ROOT is configured
        $backupRootConfigured = trim((string) $this->config->get('UPDATE_BACKUP_ROOT', '')) !== '';
        $backupRoot = null;
        if ($backupRootConfigured) {
            $backupRoot = $this->backupRoot($appRoot, $publicRoot, $tempRoot);
        }

        try {
            $zipPath = $tempRoot . DIRECTORY_SEPARATOR . 'release.zip';
            $extractRoot = $tempRoot . DIRECTORY_SEPARATOR . 'release';
            if (!is_dir($extractRoot)) {
                mkdir($extractRoot, 0755, true);
            }

            $this->downloadFile($releaseUrl, $zipPath);
            $this->extractZip($zipPath, $extractRoot);

            $actualBackupRoot = null;
            if ($backupRootConfigured && $backupRoot !== null && $this->boolConfig('UPDATE_BACKUP_BEFORE_UPDATE', true)) {
                $actualBackupRoot = $this->backupDirectories([$appRoot => 'backend', $publicRoot => 'public'], $backupRoot);
                $this->rememberLatestBackup($actualBackupRoot, $backupRoot);
            }

            $extractedBackend = $extractRoot . DIRECTORY_SEPARATOR . $backendFolder;
            if (!is_dir($extractedBackend)) {
                throw new RuntimeException("Release package does not contain backend folder: {$backendFolder}");
            }
            $this->copyDirectory($extractedBackend, $appRoot, ['.env', '.env.local']);

            if ($publicRoot !== '' && is_dir($extractRoot . DIRECTORY_SEPARATOR . $documentRootFolder)) {
                $this->copyDirectory($extractRoot . DIRECTORY_SEPARATOR . $documentRootFolder, $publicRoot, []);
            }

            $databaseResult = [];
            if ($this->boolConfig('UPDATE_RUN_SCHEMA', true)) {
                $schemaPath = $this->config->get('UPDATE_SCHEMA_PATH', dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'schema.sql');
                (new SchemaManager($this->config, $this->database))->runSqlFile($schemaPath, false);
                $databaseResult['schema'] = 'Applied schema.sql';

                if ($this->boolConfig('UPDATE_RUN_SEED', false)) {
                    $seedPath = $this->config->get('UPDATE_SEED_PATH', dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'seed.sql');
                    if (is_file($seedPath)) {
                        (new SchemaManager($this->config, $this->database))->runSqlFile($seedPath, true);
                        $databaseResult['seed'] = 'Applied seed.sql';
                    }
                }
            } elseif ($this->boolConfig('UPDATE_RUN_MIGRATIONS', false)) {
                $databaseResult = (new MigrationManager($this->config, $this->database))->run();
            } else {
                $databaseResult = ['message' => 'Database update step skipped.'];
            }

            $result = [
                'updated' => true,
                'localVersion' => $check['localVersion'],
                'remoteVersion' => $check['remoteVersion'],
                'releaseUrl' => $releaseUrl,
                'appRoot' => $appRoot,
                'publicRoot' => $publicRoot === '' ? null : $publicRoot,
                'backupRoot' => $actualBackupRoot,
                'database' => $databaseResult,
                'updatedAt' => gmdate('c'),
            ];
            (new AuditLog($this->config))->append('update.success', $result);

            return $result;
        } catch (\Throwable $exception) {
            (new AuditLog($this->config))->append('update.failed', [
                'localVersion' => $check['localVersion'] ?? null,
                'remoteVersion' => $check['remoteVersion'] ?? null,
                'error' => $exception->getMessage(),
            ]);
            throw new RuntimeException('Update failed: ' . $exception->getMessage(), 0, $exception);
        }
    }

    /**
     * @param array<string, mixed> $check
     */
    private function updateFromGit(array $check, bool $force, string $appRoot): array
    {
        $gitRoot = $this->config->get('UPDATE_GIT_DEPLOY_ROOT', $this->projectRoot());
        $gitUrl = $this->requiredConfig('UPDATE_GIT_URL');
        $branch = $this->config->get('UPDATE_GIT_BRANCH', 'main');
        $documentRoot = $this->requiredConfig('UPDATE_DOCUMENT_ROOT');
        $backendRoot = $this->config->get('UPDATE_BACKEND_ROOT', dirname($gitRoot) . DIRECTORY_SEPARATOR . 'mamepilot_backend');
        
        // Check if UPDATE_BACKUP_ROOT is configured
        $backupRootConfigured = trim((string) $this->config->get('UPDATE_BACKUP_ROOT', '')) !== '';
        $backupRoot = null;
        if ($backupRootConfigured) {
            $backupRoot = $this->backupRoot($backendRoot, $documentRoot, $this->temporaryDirectory());
        }
        
        $actualBackupRoot = null;

        try {
            if ($backupRootConfigured && $backupRoot !== null && $this->boolConfig('UPDATE_BACKUP_BEFORE_UPDATE', true)) {
                $actualBackupRoot = $this->backupDirectories([$backendRoot => 'backend', $documentRoot => 'public'], $backupRoot);
                $this->rememberLatestBackup($actualBackupRoot, $backupRoot);
            }

            $this->runGitCommand($gitRoot, ['remote', 'set-url', 'origin', $gitUrl]);
            $this->runGitCommand($gitRoot, ['fetch', 'origin', $branch]);
            $this->runGitCommand($gitRoot, ['pull', '--ff-only', 'origin', $branch]);
            $this->buildFrontend($gitRoot);
            $this->deployGitCheckout($gitRoot, $documentRoot, $backendRoot);

            if ($this->boolConfig('UPDATE_RUN_SCHEMA', true)) {
                $schemaPath = $this->config->get('UPDATE_SCHEMA_PATH', $gitRoot . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'schema.sql');
                (new SchemaManager($this->config, $this->database))->runSqlFile($schemaPath, false);
                $databaseResult = ['schema' => 'Applied schema.sql'];
            } else {
                $databaseResult = ['message' => 'Schema update skipped by UPDATE_RUN_SCHEMA=0.'];
            }

            $result = [
                'updated' => true,
                'method' => 'git',
                'localVersion' => $check['localVersion'] ?? null,
                'remoteVersion' => $check['remoteVersion'] ?? null,
                'gitRoot' => $gitRoot,
                'documentRoot' => $documentRoot,
                'backendRoot' => $backendRoot,
                'backupRoot' => $actualBackupRoot,
                'database' => $databaseResult,
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
        $this->copyFile($templateRoot . DIRECTORY_SEPARATOR . 'api' . DIRECTORY_SEPARATOR . '.htaccess', $apiRoot . DIRECTORY_SEPARATOR . '.htaccess');
        $this->copyFile($templateRoot . DIRECTORY_SEPARATOR . 'api' . DIRECTORY_SEPARATOR . 'index.php', $apiRoot . DIRECTORY_SEPARATOR . 'index.php');
        $this->copyFile($templateRoot . DIRECTORY_SEPARATOR . 'api' . DIRECTORY_SEPARATOR . 'update.php', $apiRoot . DIRECTORY_SEPARATOR . 'update.php');
        $this->copyFile($templateRoot . DIRECTORY_SEPARATOR . 'api' . DIRECTORY_SEPARATOR . 'trigger_update.php', $apiRoot . DIRECTORY_SEPARATOR . 'trigger_update.php');

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
        return $this->config->get('UPDATE_PROJECT_ROOT', dirname(__DIR__, 2));
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

    /**
     * @param list<string> $args
     */
    private function runGitCommand(string $gitRoot, array $args, bool $requireRoot = true): void
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

    private function backupRoot(string $appRoot, string $publicRoot, string $tempRoot): string
    {
        $configured = trim((string) $this->config->get('UPDATE_BACKUP_ROOT', ''));
        $base = $configured !== '' ? $configured : $tempRoot;
        $backupRoot = rtrim($base, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'update-' . gmdate('YmdHis');

        $realBackupRoot = realpath($backupRoot);
        $realAppRoot = realpath($appRoot);
        $realPublicRoot = $publicRoot === '' ? false : realpath($publicRoot);

        if ($realBackupRoot !== false && $realBackupRoot === $realAppRoot) {
            throw new RuntimeException('UPDATE_BACKUP_ROOT must not be the same as UPDATE_APP_ROOT.');
        }
        if ($realBackupRoot !== false && $realPublicRoot !== false && $realBackupRoot === $realPublicRoot) {
            throw new RuntimeException('UPDATE_BACKUP_ROOT must not be the same as UPDATE_PUBLIC_ROOT.');
        }

        if (!mkdir($backupRoot, 0700, true) && !is_dir($backupRoot)) {
            throw new RuntimeException("Failed to create backup directory: {$backupRoot}");
        }

        return $backupRoot;
    }

    private function rememberLatestBackup(string $actualBackupRoot, string $backupRoot): void
    {
        $configured = trim((string) $this->config->get('UPDATE_BACKUP_ROOT', ''));
        if ($configured === '') {
            return;
        }

        if (!is_dir($configured) && !mkdir($configured, 0700, true) && !is_dir($configured)) {
            throw new RuntimeException("Failed to create backup directory: {$configured}");
        }

        $payload = [
            'backupRoot' => $actualBackupRoot,
            'createdAt' => gmdate('c'),
        ];

        file_put_contents($configured . DIRECTORY_SEPARATOR . 'latest.txt', $actualBackupRoot);
        file_put_contents($configured . DIRECTORY_SEPARATOR . 'latest.json', json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    /**
     * @param array<string, string> $directories
     */
    private function backupDirectories(array $directories, string $backupRoot): string
    {
        if (!mkdir($backupRoot, 0700, true) && !is_dir($backupRoot)) {
            throw new RuntimeException("Failed to create backup directory: {$backupRoot}");
        }

        foreach ($directories as $source => $label) {
            if ($source === '' || !is_dir($source)) {
                continue;
            }
            $this->copyDirectory($source, $backupRoot . DIRECTORY_SEPARATOR . $label, []);
        }

        return $backupRoot;
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
