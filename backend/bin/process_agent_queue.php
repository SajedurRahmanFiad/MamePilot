<?php

declare(strict_types=1);

use App\AgentExecutor;
use App\Auth;
use App\Config;
use App\Database;

require_once dirname(__DIR__) . '/bootstrap.php';

$runId = '';
for ($index = 1; $index < $argc; $index++) {
    $arg = $argv[$index] ?? '';
    if ($arg === '--run-id' && isset($argv[$index + 1])) {
        $runId = trim((string) $argv[$index + 1]);
        break;
    }
}

if ($runId === '') {
    fwrite(STDERR, "Missing --run-id\n");
    exit(1);
}

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$auth = new Auth($config, $database);
$executor = new AgentExecutor($database, $auth, $config);
$executor->processQueuedRun(['runId' => $runId]);
