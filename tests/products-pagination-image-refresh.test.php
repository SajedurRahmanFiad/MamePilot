<?php

declare(strict_types=1);

function productsRefreshAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$productsPage = (string) file_get_contents($root . '/pages/Products.tsx');
$mutations = (string) file_get_contents($root . '/src/hooks/useMutations.ts');

productsRefreshAssert(
    str_contains($productsPage, 'useSearchParams()')
        && str_contains($productsPage, "getPositivePageParam(searchParams.get('page'))")
        && str_contains($productsPage, "nextSearchParams.set('page', String(effectivePage))")
        && str_contains($productsPage, 'setSearchParams(nextSearchParams, { replace: true })'),
    'Products pagination is not synchronized with the URL.',
);

productsRefreshAssert(
    str_contains($productsPage, "queryKey: ['products']")
        && str_contains($productsPage, "queryKey: ['product-images']")
        && str_contains($productsPage, 'dataUpdatedAt: productImagesUpdatedAt')
        && str_contains($productsPage, 'withImageCacheVersion('),
    'The Products refresh button does not refresh both product data and browser-cached images.',
);

productsRefreshAssert(
    str_contains($mutations, "getQueriesData<Record<string, string>>({ queryKey: ['product-images'] })")
        && str_contains($mutations, '[data.id]: data.image ||'),
    'Product updates do not patch the separate product-image cache.',
);

echo "Products pagination and image refresh contracts passed.\n";
