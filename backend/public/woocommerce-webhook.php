<?php

declare(strict_types=1);

use App\ApiException;
use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;
use App\WooCommerceApi;

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
    $woocommerce = new WooCommerceApi($database, $auth, $config, $operations);
    $rawBody = (string) file_get_contents('php://input');
    $result = $woocommerce->handleWebhook(
        trim((string) ($_GET['store'] ?? '')),
        $rawBody,
        isset($_SERVER['HTTP_X_WC_WEBHOOK_SIGNATURE']) ? (string) $_SERVER['HTTP_X_WC_WEBHOOK_SIGNATURE'] : null,
        isset($_SERVER['HTTP_X_WC_WEBHOOK_TOPIC']) ? (string) $_SERVER['HTTP_X_WC_WEBHOOK_TOPIC'] : null
    );

    http_response_code(200);
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (ApiException $exception) {
    http_response_code($exception->httpStatus());
    echo json_encode(['error' => $exception->getMessage(), 'code' => $exception->errorCode()], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $exception) {
    http_response_code(500);
    echo json_encode(['error' => 'WooCommerce order import failed.'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
