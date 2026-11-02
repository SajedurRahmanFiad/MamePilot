<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\MasterDataApi;

function productDuplicateSlugAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
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
if ($actor === null) throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

$stamp = substr(hash('sha256', uniqid('product-duplicate-', true)), 0, 20);
$baseSlug = 'duplicate-slug-' . $stamp;
$pdo->beginTransaction();
try {
    $source = $masterData->createProduct([
        'name' => 'Duplicate Slug Test ' . $stamp,
        'slug' => $baseSlug,
        'category' => 'Fabric',
    ]);
    $reservedSuffix = $masterData->createProduct([
        'name' => 'Reserved Slug Test ' . $stamp,
        'slug' => $baseSlug . '-1',
        'category' => 'Fabric',
    ]);
    $pdo->prepare('UPDATE products SET deleted_at = :deleted_at WHERE id = :id')->execute([
        ':deleted_at' => gmdate('Y-m-d H:i:s'),
        ':id' => $reservedSuffix['id'],
    ]);

    $duplicate = $masterData->duplicateProduct(['id' => $source['id']]);
    productDuplicateSlugAssert(
        ($duplicate['slug'] ?? null) === $baseSlug . '-2',
        'Duplicate product reused a slug reserved by a soft-deleted product.'
    );
    echo "Product duplicate slug runtime test passed.\n";
} finally {
    if ($pdo->inTransaction()) $pdo->rollBack();
}