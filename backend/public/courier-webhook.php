<?php

declare(strict_types=1);

use App\Auth;
use App\Config;
use App\CourierApi;
use App\Database;
use App\OperationsApi;

require_once dirname(__DIR__) . '/bootstrap.php';

header('Content-Type: application/json; charset=utf-8');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    http_response_code(405);
    header('Allow: POST');
    echo json_encode(['error' => 'Method not allowed.']);
    exit;
}

try {
    $provider = strtolower(trim((string) ($_GET['provider'] ?? '')));
    $rawBody = (string) file_get_contents('php://input');
    $headers = [];
    if (function_exists('getallheaders')) {
        foreach ((array) getallheaders() as $name => $value) {
            if (is_scalar($value)) {
                $headers[(string) $name] = (string) $value;
            }
        }
    }
    foreach ($_SERVER as $name => $value) {
        if (!is_scalar($value)) {
            continue;
        }
        if (str_starts_with($name, 'HTTP_')) {
            $headerName = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($name, 5)))));
            $headers[$headerName] = (string) $value;
        } elseif ($name === 'CONTENT_TYPE') {
            $headers['Content-Type'] = (string) $value;
        }
    }
    foreach (['HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'Authorization'] as $authorizationKey) {
        if (isset($_SERVER[$authorizationKey]) && is_scalar($_SERVER[$authorizationKey])) {
            $headers['Authorization'] = (string) $_SERVER[$authorizationKey];
            break;
        }
    }

    $config = Config::load(dirname(__DIR__, 2));
    $database = new Database($config);
    $auth = new Auth($config, $database);
    $operations = new OperationsApi($database, $auth, $config);
    $courier = new CourierApi($database, $auth, $config, $operations);
    $result = $courier->handleWebhook($provider, $rawBody, $headers);

    http_response_code(200);
    if ($provider === 'steadfast') {
        $result = array_merge([
            'status' => 'success',
            'message' => 'Webhook received successfully.',
        ], $result);
    }
    echo json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $exception) {
    $message = $exception->getMessage();
    $isAuthenticationError = str_contains(strtolower($message), 'signature');
    $isPayloadError = str_contains(strtolower($message), 'json')
        || str_contains(strtolower($message), 'payload')
        || str_contains(strtolower($message), 'provider');
    http_response_code($isAuthenticationError ? 403 : ($isPayloadError ? 400 : 500));
    echo json_encode([
        'status' => 'error',
        'message' => $isAuthenticationError
            ? 'Webhook verification failed.'
            : ($isPayloadError ? $message : 'Courier webhook processing failed.'),
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
