<?php

declare(strict_types=1);

use App\ApiException;
use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;
use App\ShopifyApi;

require_once dirname(__DIR__) . '/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    echo json_encode(['error' => 'Method not allowed.']);
    exit;
}

try {
    $config = Config::load(dirname(__DIR__, 2));
    $database = new Database($config);
    $auth = new Auth($config, $database);
    $operations = new OperationsApi($database, $auth, $config);
    $shopify = new ShopifyApi($database, $auth, $config, $operations);
    $rawBody = (string) file_get_contents('php://input');

    $hmacHeader = $_SERVER['HTTP_X_SHOPIFY_HMAC_SHA256'] ?? null;
    $topicHeader = $_SERVER['HTTP_X_SHOPIFY_TOPIC'] ?? null;
    $webhookIdHeader = $_SERVER['HTTP_X_SHOPIFY_WEBHOOK_ID'] ?? null;
    $eventIdHeader = $_SERVER['HTTP_X_SHOPIFY_EVENT_ID'] ?? null;
    $shopDomainHeader = $_SERVER['HTTP_X_SHOPIFY_SHOP_DOMAIN'] ?? null;

    $result = $shopify->handleWebhook(
        trim((string) ($_GET['store'] ?? $_GET['store_id'] ?? '')),
        $rawBody,
        $hmacHeader ? (string) $hmacHeader : null,
        $topicHeader ? (string) $topicHeader : null,
        $webhookIdHeader ? (string) $webhookIdHeader : null,
        $eventIdHeader ? (string) $eventIdHeader : null,
        $shopDomainHeader ? (string) $shopDomainHeader : null
    );

    http_response_code(200);
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (ApiException $exception) {
    http_response_code($exception->httpStatus());
    echo json_encode(['error' => $exception->getMessage(), 'code' => $exception->errorCode()], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $exception) {
    http_response_code(500);
    echo json_encode(['error' => 'Shopify order import failed: ' . $exception->getMessage()], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
