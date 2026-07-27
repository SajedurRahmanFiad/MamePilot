<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Config;
use App\Database;
use App\UpdateManager;

function updateMethodAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

/** @param list<string> $arguments */
function runUpdateMethodCommand(array $arguments): void
{
    $command = implode(' ', array_map('escapeshellarg', $arguments));
    exec($command . ' 2>&1', $output, $exitCode);
    if ($exitCode !== 0) {
        throw new RuntimeException("Command failed: {$command}\n" . implode("\n", $output));
    }
}

function removeUpdateMethodTree(string $path): void
{
    if (!is_dir($path)) {
        return;
    }

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST,
    );
    foreach ($iterator as $item) {
        if ($item->isDir()) {
            @chmod($item->getPathname(), 0777);
            @rmdir($item->getPathname());
        } else {
            @chmod($item->getPathname(), 0666);
            @unlink($item->getPathname());
        }
    }
    @chmod($path, 0777);
    @rmdir($path);
}

$tempRoot = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
    . DIRECTORY_SEPARATOR
    . 'mamepilot-update-methods-'
    . bin2hex(random_bytes(6));
$remoteRoot = $tempRoot . DIRECTORY_SEPARATOR . 'remote.git';
$publisherRoot = $tempRoot . DIRECTORY_SEPARATOR . 'publisher';
$gitDeploymentRoot = $tempRoot . DIRECTORY_SEPARATOR . 'git-deployment';
$packageDeploymentRoot = $tempRoot . DIRECTORY_SEPARATOR . 'package-deployment';
$packageVersionPath = $tempRoot . DIRECTORY_SEPARATOR . 'central-VERSION';

try {
    mkdir($tempRoot, 0700, true);
    runUpdateMethodCommand(['git', 'init', '--bare', $remoteRoot]);
    runUpdateMethodCommand(['git', 'init', $publisherRoot]);
    file_put_contents($publisherRoot . DIRECTORY_SEPARATOR . 'VERSION', "2.0.0\n");
    runUpdateMethodCommand(['git', '-C', $publisherRoot, 'add', 'VERSION']);
    runUpdateMethodCommand([
        'git', '-C', $publisherRoot,
        '-c', 'user.name=MamePilot Test',
        '-c', 'user.email=mamepilot-test@example.invalid',
        'commit', '-m', 'Test release',
    ]);
    runUpdateMethodCommand(['git', '-C', $publisherRoot, 'branch', '-M', 'main']);
    runUpdateMethodCommand(['git', '-C', $publisherRoot, 'remote', 'add', 'origin', $remoteRoot]);
    runUpdateMethodCommand(['git', '-C', $publisherRoot, 'push', '-u', 'origin', 'main']);
    runUpdateMethodCommand(['git', 'clone', '--branch', 'main', $remoteRoot, $gitDeploymentRoot]);

    // Simulate a deployed application that is behind the configured Git branch.
    file_put_contents($gitDeploymentRoot . DIRECTORY_SEPARATOR . 'VERSION', "1.0.0\n");
    $gitConfig = new Config([
        'UPDATE_ENABLED' => '1',
        'UPDATE_USE_GIT' => '1',
        'UPDATE_PROJECT_ROOT' => $gitDeploymentRoot,
        'UPDATE_GIT_DEPLOY_ROOT' => $gitDeploymentRoot,
        'UPDATE_GIT_URL' => $remoteRoot,
        'UPDATE_GIT_BRANCH' => 'main',
    ]);
    $gitCheck = (new UpdateManager($gitConfig, new Database($gitConfig)))->check();

    updateMethodAssert(($gitCheck['method'] ?? null) === 'git', 'Git deployments did not select the Git updater.');
    updateMethodAssert(($gitCheck['remoteVersion'] ?? null) === '2.0.0', 'Git check did not read VERSION from the configured branch.');
    updateMethodAssert(($gitCheck['updateAvailable'] ?? false) === true, 'Git check did not detect the newer branch version.');
    updateMethodAssert(
        ($gitCheck['versionSource'] ?? null) === 'git:origin/main:VERSION',
        'Git check still depends on the package server version URL.',
    );

    mkdir($packageDeploymentRoot, 0700, true);
    file_put_contents($packageDeploymentRoot . DIRECTORY_SEPARATOR . 'VERSION', "1.0.0\n");
    file_put_contents($packageVersionPath, "3.0.0\n");
    $packageConfig = new Config([
        'UPDATE_ENABLED' => '1',
        'UPDATE_USE_GIT' => '0',
        'UPDATE_PROJECT_ROOT' => $packageDeploymentRoot,
        'UPDATE_VERSION_URL' => $packageVersionPath,
    ]);
    $packageCheck = (new UpdateManager($packageConfig, new Database($packageConfig)))->check();

    updateMethodAssert(($packageCheck['method'] ?? null) === 'package', 'Package deployments did not select the ZIP updater.');
    updateMethodAssert(($packageCheck['remoteVersion'] ?? null) === '3.0.0', 'Package check did not read the central VERSION file.');
    updateMethodAssert(($packageCheck['versionSource'] ?? null) === $packageVersionPath, 'Package version source was not preserved.');

    $releaseScript = (string) file_get_contents(dirname(__DIR__) . '/scripts/release-push.ps1');
    $publisherScript = (string) file_get_contents(dirname(__DIR__) . '/scripts/publish-cpanel-release.ps1');
    updateMethodAssert(
        str_contains($releaseScript, "publish-cpanel-release.ps1")
            && str_contains($releaseScript, 'git push')
            && str_contains($releaseScript, 'git push failed with exit code'),
        'The release pipeline must publish the central ZIP and fail loudly if its Git push fails.',
    );
    updateMethodAssert(
        str_contains($publisherScript, 'Central release package is ready.')
            && str_contains($publisherScript, 'cpanel-mamepilot-package'),
        'The central-server ZIP publishing flow was removed.',
    );

    echo "Git and central ZIP update methods passed.\n";
} finally {
    removeUpdateMethodTree($tempRoot);
}
