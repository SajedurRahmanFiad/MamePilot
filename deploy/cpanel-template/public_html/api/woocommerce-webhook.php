<?php

declare(strict_types=1);

$configuredRoot = getenv('MAMEPILOT_APP_ROOT') ?: getenv('BDHATBELA_APP_ROOT');
$appRoot = is_string($configuredRoot) && trim($configuredRoot) !== ''
    ? rtrim($configuredRoot, DIRECTORY_SEPARATOR)
    : dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'mamepilot_backend';

$handler = $appRoot . DIRECTORY_SEPARATOR . 'backend' . DIRECTORY_SEPARATOR . 'public' . DIRECTORY_SEPARATOR . 'woocommerce-webhook.php';
if (!is_file($handler)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'WooCommerce webhook handler not found.']);
    exit;
}

require $handler;
