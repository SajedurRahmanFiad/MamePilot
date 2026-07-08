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

$logFile = dirname(__DIR__) . '/agent_worker.log';
file_put_contents($logFile, date('Y-m-d H:i:s') . " [START] run=$runId pid=" . getmypid() . PHP_EOL, FILE_APPEND);

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$auth = new Auth($config, $database);

try {
    $executor = new AgentExecutor($database, $auth, $config);
    $executor->processQueuedRun(['runId' => $runId]);
    file_put_contents($logFile, date('Y-m-d H:i:s') . " [OK] run=$runId\n", FILE_APPEND);
} catch (\Throwable $ex) {
    $errorMsg = date('Y-m-d H:i:s') . " [ERROR] run=$runId error=" . $ex->getMessage() . " at " . $ex->getFile() . ":" . $ex->getLine() . "\n";
    file_put_contents($logFile, $errorMsg, FILE_APPEND);

    try {
        $now = $database->nowUtc();
        $database->execute(
            "UPDATE agent_runs SET status = 'failed', error_message = :error, finished_at = :finished_at, updated_at = :updated_at WHERE id = :id",
            [':error' => $ex->getMessage(), ':finished_at' => $now, ':updated_at' => $now, ':id' => $runId]
        );
        $convRow = $database->fetchOne('SELECT conversation_id FROM agent_runs WHERE id = :id LIMIT 1', [':id' => $runId]);
        $conversationId = (string) ($convRow['conversation_id'] ?? '');
        if ($conversationId !== '') {
            $errorAnswer = 'I could not complete the analysis. Please try again.';
            $database->execute(
                'INSERT INTO agent_run_events (id, run_id, event_type, sequence_no, payload_json, created_at) VALUES (:id, :run_id, :event_type, :seq, :payload, :created_at)',
                [':id' => bin2hex(random_bytes(16)), ':run_id' => $runId, ':event_type' => 'completed', ':seq' => 999, ':payload' => json_encode(['answer' => $errorAnswer], JSON_UNESCAPED_UNICODE), ':created_at' => $now]
            );
            $database->execute(
                'INSERT INTO agent_messages (id, conversation_id, run_id, role, content, created_at) VALUES (:id, :conversation_id, :run_id, :role, :content, :created_at)',
                [':id' => bin2hex(random_bytes(16)), ':conversation_id' => $conversationId, ':run_id' => $runId, ':role' => 'assistant', ':content' => $errorAnswer, ':created_at' => $now]
            );
        }
    } catch (\Throwable $inner) {
        file_put_contents($logFile, date('Y-m-d H:i:s') . " [FATAL] Could not mark run failed: " . $inner->getMessage() . "\n", FILE_APPEND);
    }
}