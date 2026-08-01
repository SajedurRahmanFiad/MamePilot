<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\DataManagementApi;

$root = dirname(__DIR__);
$config = Config::load($root);
$database = new Database($config);
$auth = new Auth($config, $database);
$api = new DataManagementApi($database, $auth, $config);
$reflection = new ReflectionClass($api);
$invoke = static function (string $method, array $arguments = []) use ($reflection, $api) {
    return $reflection->getMethod($method)->invokeArgs($api, $arguments);
};

$definitions = $invoke('datasetDefinitions');
if (($definitions['orders']['capability'] ?? null) !== 'sales'
    || ($definitions['products']['capability'] ?? null) !== 'inventory'
    || ($definitions['bills']['capability'] ?? null) !== 'purchases'
    || ($definitions['transactions']['capability'] ?? null) !== 'banking'
    || ($definitions['users']['capability'] ?? null) !== 'human_resources'
    || ($definitions['leads']['capability'] ?? null) !== 'automatic_leads'
) {
    throw new RuntimeException('Data-management capability metadata is incomplete.');
}
if (count($definitions['leads']['fields'] ?? []) < 10) {
    throw new RuntimeException('The Leads import/export schema is incomplete.');
}

$range = $invoke('resolveExportDateRange', [[
    'filterRange' => 'Custom',
    'customDates' => ['from' => '2026-07-22T10:15', 'to' => '2026-07-22T11:45'],
]]);
$localTimezone = new DateTimeZone($config->timezone());
$expectedFrom = (new DateTimeImmutable('2026-07-22 10:15:00', $localTimezone))
    ->setTimezone(new DateTimeZone('UTC'))
    ->format('Y-m-d H:i:s');
$expectedTo = (new DateTimeImmutable('2026-07-22 11:45:59', $localTimezone))
    ->setTimezone(new DateTimeZone('UTC'))
    ->format('Y-m-d H:i:s');
if (($range['from'] ?? null) !== $expectedFrom || ($range['to'] ?? null) !== $expectedTo) {
    throw new RuntimeException('Custom export datetimes were not converted from the application timezone correctly.');
}

$reversed = $invoke('resolveExportDateRange', [[
    'filterRange' => 'Custom',
    'customDates' => ['from' => '2026-07-23T12:00', 'to' => '2026-07-22T12:00'],
]]);
if (($reversed['from'] ?? '') >= ($reversed['to'] ?? '')) {
    throw new RuntimeException('Reversed custom export boundaries were not normalized.');
}

$allTime = $invoke('resolveExportDateRange', [['filterRange' => 'All Time']]);
if (($allTime['from'] ?? null) !== null || ($allTime['to'] ?? null) !== null) {
    throw new RuntimeException('All Time should not add export date bounds.');
}

$source = file_get_contents($root . '/backend/src/DataManagementApi.php');
foreach (['o.created_at', 'p.created_at', 'c.created_at', 'b.created_at', 'v.created_at', 't.created_at', 'a.created_at', 'u.created_at', 'l.created_at'] as $column) {
    if (!is_string($source) || !str_contains($source, "exportDateSql('{$column}'")) {
        throw new RuntimeException("Export datetime filtering is missing for {$column}.");
    }
}

echo "Data-management datetime ranges, capability metadata, and Leads schema checks passed.\n";
