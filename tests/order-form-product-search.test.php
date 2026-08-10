<?php

declare(strict_types=1);

function orderProductSearchAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = dirname(__DIR__);
$orderForm = (string) file_get_contents($root . '/pages/OrderForm.tsx');
$service = (string) file_get_contents($root . '/src/services/supabaseQueries.ts');
$backend = (string) file_get_contents($root . '/backend/src/MasterDataApi.php');
$featureAccess = (string) file_get_contents($root . '/backend/src/FeatureAccess.php');

orderProductSearchAssert(str_contains($orderForm, 'useInfiniteQuery'), 'Order product search is not paginated.');
orderProductSearchAssert(str_contains($orderForm, "['productsSearchPage', debouncedSearch]"), 'Order product search does not use an isolated server-search cache.');
orderProductSearchAssert(!str_contains($orderForm, "getQueryData<any[]>(['products'])"), 'Order product search still prefers the partial Products-page cache.');
orderProductSearchAssert(str_contains($orderForm, 'Load more products'), 'The product dropdown has no continuation control.');
orderProductSearchAssert(str_contains($service, "fetchProductsSearchPage(q: string"), 'The product search service does not expose pagination metadata.');
orderProductSearchAssert(str_contains($backend, 'public function fetchProductsSearchPage'), 'The backend has no paginated product search action.');
orderProductSearchAssert(str_contains($backend, 'ORDER BY name ASC, id ASC'), 'Paginated product search is not deterministic.');
orderProductSearchAssert(str_contains($backend, '($pageSize + 1)'), 'Product autocomplete still needs a full result count to determine whether another page exists.');
orderProductSearchAssert(str_contains($featureAccess, "'fetchProductsSearchPage',"), 'Order product search is blocked when inventory is disabled.');
orderProductSearchAssert(str_contains($orderForm, 'productsSearchQuery.isError'), 'Order product search errors are still disguised as empty results.');

echo "Order Form paginated product-search checks passed.\n";
