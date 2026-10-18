<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\MasterDataApi;

function sofaCoverPricingAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$config = Config::load($root);
$database = new Database($config);
$auth = new Auth($config, $database);
$masterData = new MasterDataApi($database, $auth, $config);
$pdo = $database->connect();

$actor = $database->fetchOne(
    "SELECT id, name, phone, role FROM users
     WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL
     ORDER BY created_at ASC LIMIT 1"
);
if ($actor === null) {
    throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
}
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

$stamp = substr(hash('sha256', uniqid('sofa-pricing-', true)), 0, 20);
$productId = 'sofa-pricing-' . $stamp;
$initialPricing = json_encode([
    'sofaCover' => ['perSeat' => 1250, 'perFoam' => 450],
    'cushions' => [['id' => 'small', 'size' => 'Small', 'price' => 300]],
    'divanCover' => ['perSeat' => 950],
    'chairCover' => ['perSeat' => 250, 'perBackrest' => 400, 'perSeatAndBackrest' => 600, 'perArmchair' => 850],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$updatedPricing = json_encode([
    'sofaCover' => ['perSeat' => 1350, 'perFoam' => 500],
    'cushions' => [
        ['id' => 'small', 'size' => 'Small', 'price' => 325],
        ['id' => 'large', 'size' => 'Large', 'price' => 475],
    ],
    'divanCover' => ['perSeat' => 1050],
    'chairCover' => ['perSeat' => 275, 'perBackrest' => 425, 'perSeatAndBackrest' => 650, 'perArmchair' => 900],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

$pdo->beginTransaction();
try {
    $created = $masterData->createProduct([
        'id' => $productId,
        'name' => 'Sofa Cover Pricing Persistence Test',
        'slug' => 'sofa-pricing-' . $stamp,
        'category' => 'Fabric',
        'salePrice' => 0,
        'purchasePrice' => 120,
        'stock' => 0,
        'sofaCoverPricing' => $initialPricing,
    ]);
    sofaCoverPricingAssert(($created['sofaCoverPricing'] ?? null) === $initialPricing, 'Created product did not return sofa-cover pricing.');

    $updated = $masterData->updateProduct([
        'id' => $productId,
        'updates' => ['sofaCoverPricing' => $updatedPricing],
    ]);
    $reloaded = $masterData->fetchProductById(['id' => $productId]);
    sofaCoverPricingAssert(($updated['sofaCoverPricing'] ?? null) === $updatedPricing, 'Updated product did not return sofa-cover pricing.');
    sofaCoverPricingAssert(($reloaded['sofaCoverPricing'] ?? null) === $updatedPricing, 'Reloaded product did not contain sofa-cover pricing.');
    $searchPage = $masterData->fetchProductsSearchPage(['q' => 'Sofa Cover Pricing Persistence Test', 'page' => 1, 'pageSize' => 10]);
    $searchProduct = array_values(array_filter($searchPage['data'] ?? [], static fn(array $product): bool => ($product['id'] ?? '') === $productId))[0] ?? null;
    sofaCoverPricingAssert(($searchProduct['sofaCoverPricing'] ?? null) === $updatedPricing, 'Paged fabric search did not return sofa-cover pricing.');
    echo "Sofa-cover pricing persistence runtime test passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}