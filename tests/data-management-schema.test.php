<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\DataManagementApi;

function assertTrue(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$reflection = new ReflectionClass(DataManagementApi::class);
$api = $reflection->newInstanceWithoutConstructor();
$definitionsMethod = $reflection->getMethod('datasetDefinitions');
$definitions = $definitionsMethod->invoke($api);

$expectedDatasets = ['orders', 'products', 'customers', 'bills', 'vendors', 'transactions', 'users'];
assertTrue(array_keys($definitions) === $expectedDatasets, 'The supported dataset order changed unexpectedly.');

foreach ($definitions as $key => $definition) {
    assertTrue(trim((string) ($definition['label'] ?? '')) !== '', "{$key} needs a label.");
    assertTrue(is_array($definition['fields'] ?? null) && $definition['fields'] !== [], "{$key} needs import fields.");
    $fieldKeys = array_column($definition['fields'], 'key');
    $fieldLabels = array_column($definition['fields'], 'label');
    assertTrue(count($fieldKeys) === count(array_unique($fieldKeys)), "{$key} has duplicate field keys.");
    assertTrue(count($fieldLabels) === count(array_unique($fieldLabels)), "{$key} has duplicate CSV headers.");
    assertTrue(!in_array('id', $fieldKeys, true), "{$key} exposes an internal record ID.");
    assertTrue(!in_array('MamePilot ID', $fieldLabels, true), "{$key} exposes the old MamePilot ID header.");
    assertTrue(is_array($definition['sampleRow'] ?? null), "{$key} needs a template sample row.");
    foreach ($fieldKeys as $fieldKey) {
        assertTrue(array_key_exists($fieldKey, $definition['sampleRow']), "{$key} template is missing {$fieldKey}.");
    }
}

$amountsMethod = $reflection->getMethod('documentAmounts');
$valid = $amountsMethod->invoke($api, [
    'itemsJson' => '[{"productId":"p1","quantity":2,"rate":50,"amount":100}]',
    'subtotal' => '100',
    'discount' => '10',
    'shipping' => '5',
    'total' => '95',
], 'Order');
assertTrue($valid[1] === 100.0 && $valid[2] === 95.0, 'Document totals were not validated correctly.');

$invalidRejected = false;
try {
    $amountsMethod->invoke($api, [
        'itemsJson' => '[{"productId":"p1","quantity":2,"rate":50,"amount":100}]',
        'subtotal' => '90',
        'total' => '90',
    ], 'Order');
} catch (ReflectionException|RuntimeException $exception) {
    $invalidRejected = true;
}
assertTrue($invalidRejected, 'An inconsistent document subtotal was accepted.');

echo "Data management schema and document validation checks passed.\n";
