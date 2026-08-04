<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\ApiException;
use App\Auth;
use App\Config;
use App\Database;
use App\MasterDataApi;

function productSelectionModeAssert(bool $condition, string $message): void
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
    "SELECT id, name, phone, role FROM users WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1"
);
if ($actor === null) {
    throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
}
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

$defaultsRow = $database->fetchOne('SELECT id FROM system_defaults LIMIT 1');
if ($defaultsRow === null) {
    throw new RuntimeException('Local system defaults row is unavailable.');
}

$pdo->beginTransaction();
try {
    // Reproduce the production state: a legacy/imported account reference that
    // no longer resolves, while the foreign key is active for future writes.
    $database->execute('SET FOREIGN_KEY_CHECKS = 0');
    $database->execute(
        'UPDATE system_defaults SET default_account_id = :account_id WHERE id = :id',
        [':account_id' => 'missing-account-regression', ':id' => (string) $defaultsRow['id']]
    );
    $database->execute('SET FOREIGN_KEY_CHECKS = 1');

    $saved = $masterData->updateSystemDefaults(['productSelectionMode' => 'multi']);
    productSelectionModeAssert(
        ($saved['productSelectionMode'] ?? null) === 'multi',
        'Product selection mode was not returned from the persisted server row.'
    );

    $stored = $database->fetchOne(
        'SELECT default_account_id, product_selection_mode FROM system_defaults WHERE id = :id',
        [':id' => (string) $defaultsRow['id']]
    );
    productSelectionModeAssert(
        ($stored['product_selection_mode'] ?? null) === 'multi',
        'Product selection mode was not persisted in system_defaults.'
    );
    productSelectionModeAssert(
        ($stored['default_account_id'] ?? null) === 'missing-account-regression',
        'Saving product selection mode must not rewrite an unrelated default account.'
    );

    try {
        $masterData->updateSystemDefaults(['productSelectionMode' => 'unsupported']);
        throw new RuntimeException('An unsupported product selection mode was accepted.');
    } catch (ApiException $exception) {
        productSelectionModeAssert(
            $exception->httpStatus() === 422 && $exception->errorCode() === 'INVALID_PRODUCT_SELECTION_MODE',
            'Unsupported product selection modes must return the expected validation error.'
        );
    }

    echo "Product selection mode persistence regression test passed.\n";
} finally {
    $database->execute('SET FOREIGN_KEY_CHECKS = 1');
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
