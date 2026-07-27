<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Config;
use App\GitUpdateDispatcher;

function gitDispatcherAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$tempRoot = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
    . DIRECTORY_SEPARATOR
    . 'mamepilot-git-dispatcher-'
    . bin2hex(random_bytes(6));

try {
    mkdir($tempRoot, 0700, true);
    $launches = [];
    $launcher = static function (string $phpBinary, string $scriptPath) use (&$launches): bool {
        $launches[] = ['phpBinary' => $phpBinary, 'scriptPath' => $scriptPath];
        return true;
    };

    $packageConfig = new Config([
        'UPDATE_ENABLED' => '1',
        'UPDATE_USE_GIT' => '0',
        'UPDATE_PROJECT_ROOT' => $tempRoot . DIRECTORY_SEPARATOR . 'package',
    ]);
    $packageResult = (new GitUpdateDispatcher($packageConfig, $launcher, $tempRoot))->dispatch(1000);
    gitDispatcherAssert(($packageResult['status'] ?? null) === 'cron_only', 'Package mode must remain cron-only.');
    gitDispatcherAssert(($packageResult['mode'] ?? null) === 'package', 'Package mode was not reported to the browser.');
    gitDispatcherAssert($launches === [], 'Package mode must never launch the browser-dispatched updater.');

    $disabledConfig = new Config([
        'UPDATE_ENABLED' => '0',
        'UPDATE_USE_GIT' => '1',
        'UPDATE_PROJECT_ROOT' => $tempRoot . DIRECTORY_SEPARATOR . 'disabled-git',
    ]);
    $disabledResult = (new GitUpdateDispatcher($disabledConfig, $launcher, $tempRoot))->dispatch(1000);
    gitDispatcherAssert(($disabledResult['status'] ?? null) === 'disabled', 'Disabled Git updates must not dispatch.');
    gitDispatcherAssert($launches === [], 'Disabled Git mode launched an updater.');

    $gitConfig = new Config([
        'UPDATE_ENABLED' => '1',
        'UPDATE_USE_GIT' => '1',
        'UPDATE_GIT_DEPLOY_ROOT' => $tempRoot . DIRECTORY_SEPARATOR . 'git-deployment',
        'UPDATE_PHP_BINARY' => '/usr/local/bin/php',
    ]);
    $dispatcher = new GitUpdateDispatcher($gitConfig, $launcher, $tempRoot);
    $first = $dispatcher->dispatch(1000);
    gitDispatcherAssert(($first['status'] ?? null) === 'dispatched', 'Git mode did not launch the detached updater.');
    gitDispatcherAssert(($first['retryAfterSeconds'] ?? null) === 120, 'Git dispatcher did not return the browser interval.');
    gitDispatcherAssert(count($launches) === 1, 'Git dispatcher launched an unexpected number of processes.');
    gitDispatcherAssert(
        str_ends_with(str_replace('\\', '/', (string) $launches[0]['scriptPath']), '/backend/bin/update.php'),
        'Git dispatcher did not launch backend/bin/update.php.'
    );

    $cooldown = $dispatcher->dispatch(1030);
    gitDispatcherAssert(($cooldown['status'] ?? null) === 'cooldown', 'Git dispatcher ignored its deployment cooldown.');
    gitDispatcherAssert(($cooldown['retryAfterSeconds'] ?? null) === 90, 'Git dispatcher returned an incorrect cooldown countdown.');
    gitDispatcherAssert(count($launches) === 1, 'Cooldown launched a duplicate updater process.');

    $next = $dispatcher->dispatch(1120);
    gitDispatcherAssert(($next['status'] ?? null) === 'dispatched', 'Git dispatcher did not run after cooldown expiry.');
    gitDispatcherAssert(count($launches) === 2, 'Git dispatcher did not launch exactly once after cooldown expiry.');

    $otherConfig = new Config([
        'UPDATE_ENABLED' => '1',
        'UPDATE_USE_GIT' => '1',
        'UPDATE_GIT_DEPLOY_ROOT' => $tempRoot . DIRECTORY_SEPARATOR . 'other-git-deployment',
    ]);
    $other = (new GitUpdateDispatcher($otherConfig, $launcher, $tempRoot))->dispatch(1030);
    gitDispatcherAssert(($other['status'] ?? null) === 'dispatched', 'One deployment cooldown blocked another deployment.');
    gitDispatcherAssert(count($launches) === 3, 'The separate deployment did not receive its own dispatcher process.');

    echo "Git update dispatcher tests passed.\n";
} finally {
    if (is_dir($tempRoot)) {
        foreach (glob($tempRoot . DIRECTORY_SEPARATOR . '*') ?: [] as $path) {
            if (is_file($path)) {
                @unlink($path);
            }
        }
        @rmdir($tempRoot);
    }
}
