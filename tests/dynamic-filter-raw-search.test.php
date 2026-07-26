<?php

declare(strict_types=1);

function rawSearchAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$filterBar = (string) file_get_contents($root . '/components/DynamicFilterBar.tsx');
$operations = (string) file_get_contents($root . '/backend/src/OperationsApi.php');
$masterData = (string) file_get_contents($root . '/backend/src/MasterDataApi.php');
$metaAds = (string) file_get_contents($root . '/backend/src/MetaAdsApi.php');
$ordersPage = (string) file_get_contents($root . '/pages/Orders.tsx');
$orderForm = (string) file_get_contents($root . '/pages/OrderForm.tsx');
$orderDetails = (string) file_get_contents($root . '/pages/OrderDetails.tsx');

rawSearchAssert(
    str_contains($filterBar, 'onRawSearchChange?.(nextValue)')
        && str_contains($filterBar, "filters.length === 0 && inputValue.trim()")
        && str_contains($filterBar, 'rawSearchValue?: string'),
    'DynamicFilterBar raw-search mode is not controlled independently from structured chips.'
);

$dynamicFilterPages = [
    'pages/Banking.tsx',
    'pages/Bills.tsx',
    'pages/Customers.tsx',
    'pages/MetaAds.tsx',
    'pages/NotificationDetail.tsx',
    'pages/Orders.tsx',
    'pages/Products.tsx',
    'pages/RecycleBin.tsx',
    'pages/Transactions.tsx',
    'pages/Users.tsx',
    'pages/Vendors.tsx',
    'pages/reports/UserActivityPerformanceReport.tsx',
];

foreach ($dynamicFilterPages as $relativePath) {
    $source = (string) file_get_contents($root . '/' . $relativePath);
    rawSearchAssert(str_contains($source, 'rawSearchValue='), "{$relativePath} is missing a controlled raw-search value.");
    rawSearchAssert(str_contains($source, 'onRawSearchChange='), "{$relativePath} is missing a raw-search result handler.");
}

rawSearchAssert(
    !str_contains($ordersPage, 'type: \'Orders\', operator: \'contains\''),
    'Orders raw search is still being reconstructed as a structured contains chip.'
);

foreach (['raw_order_search', 'raw_bill_search', 'raw_transaction_search'] as $binding) {
    rawSearchAssert(str_contains($operations, $binding), "Operations raw search is missing {$binding}.");
}
rawSearchAssert(str_contains($operations, 'customerAddress'), 'Order raw search does not include customer addresses.');
rawSearchAssert(str_contains($operations, 'exchangeCourierHistory'), 'Order raw search does not include exchange courier data.');
rawSearchAssert(str_contains($operations, "(string) (\$item['id'] ?? '')"), 'Recycle Bin raw search does not include record IDs.');

foreach (['raw_user_search', 'raw_customer_search', 'raw_vendor_search', 'raw_product_search'] as $binding) {
    rawSearchAssert(str_contains($masterData, $binding), "Master-data raw search is missing {$binding}.");
}
rawSearchAssert(str_contains($metaAds, "\$params['rawSearch']"), 'Meta Ads does not receive the broad raw-search value.');
rawSearchAssert(str_contains($metaAds, 'raw_search_campaign'), 'Meta Ads raw search does not cover related campaign data.');

rawSearchAssert(
    str_contains($operations, "in_array(\$status, ['On Hold', 'Exchange processing'], true)")
        && str_contains($ordersPage, 'OrderStatus.ON_HOLD || order.status === OrderStatus.EXCHANGE_PROCESSING')
        && str_contains($orderForm, '[OrderStatus.ON_HOLD, OrderStatus.EXCHANGE_PROCESSING]')
        && str_contains($orderDetails, 'OrderStatus.ON_HOLD || order.status === OrderStatus.EXCHANGE_PROCESSING'),
    'Exchange-processing orders are not editable consistently across list, form, detail, and API gates.'
);
rawSearchAssert(
    !str_contains($ordersPage, 'order.status === OrderStatus.PICKED || order.status === OrderStatus.EXCHANGE_PICKED) && hasAdminAccess'),
    'The Orders page still permits editing after an exchange has been picked.'
);

echo "DynamicFilterBar raw search and exchange edit-window contracts passed.\n";
