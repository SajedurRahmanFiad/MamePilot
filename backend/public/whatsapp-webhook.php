<?php

declare(strict_types=1);

use App\Auth;
use App\Config;
use App\Database;
use App\WhatsAppApi;

require_once dirname(__DIR__) . '/bootstrap.php';

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$auth = new Auth($config, $database);
$whatsapp = new WhatsAppApi($database, $auth, $config);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    $challenge = $whatsapp->webhookVerification(
        trim((string) ($_GET['hub_mode'] ?? $_GET['hub.mode'] ?? '')),
        trim((string) ($_GET['hub_verify_token'] ?? $_GET['hub.verify_token'] ?? '')),
        trim((string) ($_GET['hub_challenge'] ?? $_GET['hub.challenge'] ?? ''))
    );
    if ($challenge !== null) {
        http_response_code(200);
        header('Content-Type: text/plain; charset=utf-8');
        echo $challenge;
        exit;
    }
    http_response_code(403);
    echo 'Webhook verification failed.';
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? 'POST') !== 'POST') {
    http_response_code(405);
    header('Allow: GET, POST');
    echo 'Method not allowed.';
    exit;
}

$rawBody = file_get_contents('php://input');
try {
    $result = $whatsapp->handleWebhook((string) $rawBody, $_SERVER['HTTP_X_HUB_SIGNATURE_256'] ?? null);
    http_response_code(200);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $exception) {
    http_response_code($exception->getMessage() === 'Invalid WhatsApp webhook signature.' ? 403 : 400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => $exception->getMessage()], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
