<?php

declare(strict_types=1);

/**
 * AwajDigital Voice Survey Webhook Endpoint
 *
 * Receives POST callbacks from AwajDigital when a survey call completes.
 * Validates the shared secret token, then delegates to AutoCallApi.
 *
 * POST /webhook-survey.php?token={webhookSecret}
 */

header('Content-Type: application/json');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

require_once dirname(__DIR__) . '/bootstrap.php';

use App\Config;
use App\Database;
use App\AutoCallApi;
use App\Auth;

try {
    // Validate token
    $token = trim((string) ($_GET['token'] ?? ''));
    if ($token === '') {
        http_response_code(401);
        echo json_encode(['error' => 'Missing token.']);
        exit;
    }

    $config = Config::load(dirname(__DIR__, 2));
    $database = new Database($config);

    $settings = $database->fetchOne('SELECT webhook_secret FROM voice_survey_settings LIMIT 1');
    $expectedSecret = (string) ($settings['webhook_secret'] ?? '');

    if ($expectedSecret === '' || !hash_equals($expectedSecret, $token)) {
        http_response_code(403);
        echo json_encode(['error' => 'Invalid token.']);
        exit;
    }

    // Parse payload
    $rawBody = file_get_contents('php://input');
    $payload = json_decode((string) $rawBody, true);

    if (!is_array($payload)) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid JSON payload.']);
        exit;
    }

    if (empty($payload['results'])) {
        http_response_code(400);
        echo json_encode(['error' => 'No results in payload.']);
        exit;
    }

    // Process webhook
    $auth = new Auth($config, $database);
    $autoCall = new AutoCallApi($database, $auth, $config);
    $result = $autoCall->handleWebhookCallback($payload);

    echo json_encode($result);
} catch (\Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Internal server error.']);
}
