<?php

declare(strict_types=1);

function requireContains(string $haystack, string $needle, string $message): void
{
    if (!str_contains($haystack, $needle)) {
        fwrite(STDERR, "Assertion failed: {$message}\nMissing: {$needle}\n");
        exit(1);
    }
}

$root = dirname(__DIR__);
$database = file_get_contents($root . '/backend/src/Database.php') ?: '';
$config = file_get_contents($root . '/backend/src/Config.php') ?: '';
$operations = file_get_contents($root . '/backend/src/OperationsApi.php') ?: '';
$baseService = file_get_contents($root . '/backend/src/BaseService.php') ?: '';

requireContains($database, 'SET time_zone = \'+00:00\'', 'every application database session must be UTC');
requireContains($database, "return gmdate('Y-m-d H:i:s');", 'application-generated database timestamps must be UTC');
requireContains($config, "get('APP_TIMEZONE', 'Asia/Dhaka')", 'Bangladesh must remain the configured business timezone');
requireContains($baseService, "->setTimezone(\$this->utcTimezone())->format('Y-m-d\\TH:i:s\\Z')", 'database datetimes must be serialized with an explicit UTC marker');
requireContains($operations, "WHERE order_id = :order_id AND undone_at IS NULL", 'Order Details must read active server-authored status events');
requireContains($operations, "'Processing' => 'processing'", 'processing events must expose their authoritative timestamp');
requireContains($operations, "\$order['statusTimestamps'][\$key] = \$timestamp", 'status timestamps must be returned to the timeline');

echo "Backend UTC and Bangladesh timezone contract assertions passed.\n";
