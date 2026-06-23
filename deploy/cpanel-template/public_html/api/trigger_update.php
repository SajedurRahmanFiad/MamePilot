<?php

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    echo json_encode(['status' => 'ok', 'message' => 'CORS preflight accepted.']);
    exit;
}

$lockFile = __DIR__ . '/trigger_update.lock';
$cooldown = 60;

$phpBinary = getenv('UPDATE_PHP_BINARY') ?: getenv('PHP_BINARY') ?: 'php';
$scriptPath = getenv('MAMEPILOT_APP_ROOT') ?: getenv('BDHATBELA_APP_ROOT');
$scriptPath = is_string($scriptPath) && trim($scriptPath) !== ''
    ? rtrim($scriptPath, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'update.php'
    : dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'mamepilot_backend' . DIRECTORY_SEPARATOR . 'bin' . DIRECTORY_SEPARATOR . 'update.php';

if (!is_file($scriptPath)) {
    echo json_encode([
        'status' => 'error',
        'message' => 'Update script not found.',
        'scriptPath' => $scriptPath,
    ]);
    exit;
}

if (file_exists($lockFile)) {
    $lastRunTime = filemtime($lockFile);
    $timePassed = time() - $lastRunTime;

    if ($timePassed < $cooldown) {
        echo json_encode([
            'status' => 'skipped',
            'message' => 'Cooldown active. Try again in ' . ($cooldown - $timePassed) . ' seconds.',
            'cooldown' => $cooldown,
            'elapsed' => $timePassed,
        ]);
        exit;
    }
}

if (!touch($lockFile)) {
    echo json_encode([
        'status' => 'error',
        'message' => 'Failed to update lock file. Check directory permissions.',
        'lockFile' => $lockFile,
    ]);
    exit;
}

$command = escapeshellcmd($phpBinary) . ' ' . escapeshellarg($scriptPath) . ' > /dev/null 2>&1 &';

$output = null;
$returnVar = null;
exec($command, $output, $returnVar);

if ($returnVar !== 0) {
    echo json_encode([
        'status' => 'error',
        'message' => 'Failed to launch update script in background.',
        'returnVar' => $returnVar,
        'command' => $command,
        'output' => $output,
    ]);
    exit;
}

echo json_encode([
    'status' => 'success',
    'message' => 'Background update script successfully dispatched.',
    'command' => $command,
]);
