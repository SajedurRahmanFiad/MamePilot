<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\MasterDataApi;
use App\OperationsApi;

function profitLossCompanyAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = dirname(__DIR__);
$config = Config::load($root);
$database = new Database($config);
$auth = new Auth($config, $database);
$masterData = new MasterDataApi($database, $auth, $config);
$operations = new OperationsApi($database, $auth, $config);

$actor = $database->fetchOne(
    "SELECT id, name, phone, role FROM users WHERE role IN ('Admin', 'Developer') AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1"
);
if ($actor === null) throw new RuntimeException('Local Admin or Developer test actor is unavailable.');
$_SERVER['HTTP_AUTHORIZATION'] = 'Bearer ' . $auth->issueToken($actor);

$companySettings = $masterData->fetchCompanySettings();
$companyPages = is_array($companySettings['pages'] ?? null) ? $companySettings['pages'] : [];
profitLossCompanyAssert($companyPages !== [], 'No company page is available for the Profit/Loss company test.');

$allCompanies = $operations->fetchProfitLossReport([
    'filterRange' => 'All Time',
    'companyPageIds' => [],
]);
profitLossCompanyAssert(
    array_key_exists('companyPageIds', $allCompanies)
        && is_array($allCompanies['companyPageIds'])
        && $allCompanies['companyPageIds'] === []
        && ($allCompanies['sharedCostsConsolidated'] ?? true) === false,
    'All Companies did not return the expected unscoped report metadata.',
);

$firstCompanyId = (string) ($companyPages[0]['id'] ?? '');
profitLossCompanyAssert($firstCompanyId !== '', 'The first company page has no identifier.');
$selectedCompany = $operations->fetchProfitLossReport([
    'filterRange' => 'All Time',
    'companyPageIds' => [$firstCompanyId],
]);
profitLossCompanyAssert(
    is_array($selectedCompany['companyPageIds'] ?? null)
        && in_array($firstCompanyId, $selectedCompany['companyPageIds'], true)
        && ($selectedCompany['sharedCostsConsolidated'] ?? false) === true
        && is_numeric($selectedCompany['grossSales'] ?? null)
        && is_numeric($selectedCompany['netProfit'] ?? null),
    'The selected-company Profit/Loss response is incomplete.',
);

if (count($companyPages) >= 2) {
    $secondCompanyId = (string) ($companyPages[1]['id'] ?? '');
    $multiCompany = $operations->fetchProfitLossReport([
        'filterRange' => 'All Time',
        'companyPageIds' => [$firstCompanyId, $secondCompanyId],
    ]);
    profitLossCompanyAssert(
        is_array($multiCompany['companyPageIds'] ?? null)
            && count($multiCompany['companyPageIds']) === 2
            && ($multiCompany['sharedCostsConsolidated'] ?? false) === true
            && is_numeric($multiCompany['grossSales'] ?? null),
        'Multi-company Profit/Loss response is incomplete.',
    );
}

$invalidRejected = false;
try {
    $operations->fetchProfitLossReport([
        'filterRange' => 'All Time',
        'companyPageIds' => ['missing-company-page'],
    ]);
} catch (RuntimeException $error) {
    $invalidRejected = str_contains($error->getMessage(), 'Select a valid company');
}
profitLossCompanyAssert($invalidRejected, 'An invalid Profit/Loss company identifier was accepted.');

echo "Profit/Loss company filtering runtime test passed.\n";
