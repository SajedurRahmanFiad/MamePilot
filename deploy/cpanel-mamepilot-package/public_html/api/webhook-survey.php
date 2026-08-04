<?php

declare(strict_types=1);

require_once __DIR__ . DIRECTORY_SEPARATOR . 'app-root.php';

$appRoot = mamepilotResolveAppRoot();

$handler = $appRoot . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'webhook-survey.php';
if (!is_file($handler)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Webhook handler not found.']);
    exit;
}

require $handler;
