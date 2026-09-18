<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\MasterDataApi;

function vaccineDosageAssert(bool $condition, string $message): void
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
     ORDER BY CASE WHEN role = 'Developer' THEN 0 ELSE 1 END, created_at ASC LIMIT 1"
);
if ($actor === null) {
    throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
}
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

$stamp = substr(hash('sha256', uniqid('vaccine-dosage-', true)), 0, 20);
$productId = 'vaccine-dosage-' . $stamp;
$sequence = json_encode([
    'dosageRules' => [
        [
            'id' => 'rule-1',
            'operator' => '<',
            'ageFrom' => 5,
            'dosageCount' => 2,
            'hasBoosterDose' => false,
        ],
        [
            'id' => 'rule-2',
            'operator' => 'between',
            'ageFrom' => 5,
            'ageTo' => 12,
            'dosageCount' => 3,
            'hasBoosterDose' => true,
        ],
    ],
    'scheduleRules' => [[
        'dosageRuleId' => 'rule-1',
        'intervals' => [0, 1],
    ], [
        'dosageRuleId' => 'rule-2',
        'intervals' => [0, 1, 2],
        'boosterInterval' => 12,
    ]],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

$pdo->beginTransaction();
try {
    $created = $masterData->createProduct([
        'id' => $productId,
        'name' => 'Vaccine Dosage Persistence Test',
        'slug' => 'vaccine-dosage-' . $stamp,
        'category' => 'Vaccine',
        'salePrice' => 0,
        'purchasePrice' => 0,
        'stock' => 0,
        'recommendedDoseSequence' => null,
    ]);
    $updated = $masterData->updateProduct([
        'id' => $productId,
        'updates' => ['recommendedDoseSequence' => $sequence],
    ]);
    $reloaded = $masterData->fetchProductById(['id' => $productId]);

    vaccineDosageAssert(($updated['recommendedDoseSequence'] ?? null) === $sequence, 'Update response did not contain the saved dosage sequence.');
    vaccineDosageAssert(($reloaded['recommendedDoseSequence'] ?? null) === $sequence, 'Reloaded product did not contain the saved dosage sequence.');
    echo "Vaccine dosage persistence runtime test passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
