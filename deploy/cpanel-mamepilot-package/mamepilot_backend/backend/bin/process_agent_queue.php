<?php

declare(strict_types=1);

use App\AgentExecutor;
use App\Auth;
use App\Config;
use App\Database;

require_once dirname(__DIR__) . '/bootstrap.php';

$runId = '';
$maxRuns = 10;
for ($index = 1; $index < $argc; $index++) {
    $argument = (string) ($argv[$index] ?? '');
    if ($argument === '--run-id' && isset($argv[$index + 1])) $runId = trim((string) $argv[++$index]);
    if ($argument === '--max-runs' && isset($argv[$index + 1])) $maxRuns = max(1, min(100, (int) $argv[++$index]));
}

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$auth = new Auth($config, $database);
$executor = new AgentExecutor($database, $auth, $config);
$workerId = substr(preg_replace('/[^A-Za-z0-9_.-]/', '-', gethostname() ?: 'worker') ?: 'worker', 0, 80) . '-' . getmypid() . '-' . substr(bin2hex(random_bytes(4)), 0, 8);
$processed = 0;

try {
    if ($runId !== '') {
        $result = $executor->processQueuedRun(['runId' => $runId, 'workerId' => $workerId]);
        $processed = !empty($result['processed']) ? 1 : 0;
    } else {
        for ($index = 0; $index < $maxRuns; $index++) {
            $result = $executor->processQueuedRun(['workerId' => $workerId]);
            if (empty($result['processed'])) break;
            $processed++;
        }
    }
    fwrite(STDOUT, 'Mame AI worker processed ' . $processed . " run(s).\n");
    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, 'Mame AI worker failed: ' . $exception->getMessage() . "\n");
    exit(1);
}
