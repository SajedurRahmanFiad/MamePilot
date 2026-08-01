<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$source = (string) file_get_contents($root . '/deploy/Central Server/api.php');
$schema = (string) file_get_contents($root . '/deploy/Central Server/central-db.sql');
$client = (string) file_get_contents($root . '/pages/DeveloperSubscriptions.tsx');
$backend = (string) file_get_contents($root . '/backend/src/MasterDataApi.php');

$expectations = [
    [$source, 'function ensureLicensePricingSchema(PDO $pdo): void', 'The central API does not repair existing license tables.'],
    [$source, "'pricing_metadata' => \$resolvedPricingMetadata", 'Resolved licenses do not return the persisted price override.'],
    [$source, 'pricing_metadata = :pricing_metadata', 'The central API does not persist price overrides.'],
    [$source, 'pricing_metadata = NULL', 'Resetting an override does not restore tier pricing.'],
    [$schema, 'ADD COLUMN IF NOT EXISTS pricing_metadata LONGTEXT NULL', 'The central database upgrade is missing pricing metadata.'],
    [$client, 'buildPriceOverride(monthlyPriceOverride, yearlyPriceOverride)', 'Blank override inputs are still serialized as zero.'],
];

foreach ($expectations as [$haystack, $needle, $message]) {
    if (!str_contains($haystack, $needle)) {
        throw new RuntimeException($message);
    }
}

if (str_contains($backend, "if (\$pricingMetadata !== []) {\n            \$this->updateCapabilitySettings")) {
    throw new RuntimeException('The deployment backend still overwrites the server-confirmed effective price.');
}

echo "Central per-deployment price override persistence checks passed.\n";
