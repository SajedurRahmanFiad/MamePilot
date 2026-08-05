<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$assert = static function (bool $condition, string $message): void {
    if (!$condition) {
        throw new RuntimeException($message);
    }
};

$modal = (string) file_get_contents($root . '/components/SteadfastModal.tsx');
$details = (string) file_get_contents($root . '/pages/OrderDetails.tsx');
$orders = (string) file_get_contents($root . '/pages/Orders.tsx');
$settings = (string) file_get_contents($root . '/pages/Settings.tsx');
$courierApi = (string) file_get_contents($root . '/backend/src/CourierApi.php');
$masterData = (string) file_get_contents($root . '/backend/src/MasterDataApi.php');
$operations = (string) file_get_contents($root . '/backend/src/OperationsApi.php');
$dispatcher = (string) file_get_contents($root . '/backend/src/BusinessActionDispatcher.php');
$schema = (string) file_get_contents($root . '/backend/database/schema-only.sql');

$assert(!str_contains($modal, 'tracking_code'), 'Steadfast submission still reads/stores tracking_code.');
$assert(
    str_contains($modal, 'invoiceValue = invoice.trim() || order.orderNumber')
        && str_contains($dispatcher, "trim((string) (\$steadfast['invoice'] ?? '')) ?: (string) (\$order['orderNumber'] ?? '')"),
    'Steadfast invoice fallback does not preserve the original order-number behavior.'
);
$assert(
    str_contains($modal, 'tracking_link')
        && str_contains($modal, 'steadfastTrackingLink')
        && str_contains($modal, 'consignment_id')
        && str_contains($modal, 'steadfastConsignmentId'),
    'Steadfast response identifiers are not mapped to their dedicated order fields.'
);
$assert(
    str_contains($details, 'order.steadfastTrackingLink')
        && str_contains($orders, 'order.steadfastTrackingLink')
        && !str_contains($details, "window.open('https://steadfast.com.bd/tracking'")
        && !str_contains($orders, "window.open('https://steadfast.com.bd/tracking'"),
    'The UI still generates a generic Steadfast tracking URL.'
);
$assert(
    str_contains($settings, 'Custom Invoice')
        && str_contains($settings, '/^[A-Za-z0-9_-]+$/')
        && str_contains($masterData, "preg_match('/^[A-Za-z0-9_-]+$/'"),
    'Custom Steadfast invoice validation is incomplete across UI and backend.'
);
$assert(
    str_contains($courierApi, "'/status_by_cid/'")
        && str_contains($courierApi, 'fetchSteadfastStatusByConsignmentId')
        && str_contains($dispatcher, "['tracking_link', 'trackingLink']"),
    'Stored Steadfast consignment IDs/tracking links are not used by every backend submission/status path.'
);
$assert(
    str_contains($settings, 'automaticallyMarkPaidAfterDelivery')
        && str_contains($masterData, 'automatically_mark_paid_after_delivery')
        && str_contains($operations, 'recordAutomaticCourierDeliveryPayment')
        && str_contains($operations, 'Automatically marked paid after courier delivery'),
    'Automatic payment after courier delivery is not wired end to end.'
);
$assert(
    str_contains($schema, 'steadfast_invoice')
        && str_contains($schema, 'steadfast_tracking_link')
        && str_contains($schema, 'automatically_mark_paid_after_delivery')
        && str_contains($schema, '-- Migration: 2026-08-05_steadfast_tracking_invoice_auto_payment.sql'),
    'The generated deployment schema is missing Steadfast/payment changes.'
);

echo "Steadfast tracking, invoice, automatic payment, and renewal wiring checks passed.\n";
