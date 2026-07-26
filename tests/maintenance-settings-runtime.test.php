<?php

declare(strict_types=1);

function maintenanceRuntimeAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$centralSource = (string) file_get_contents($root . '/deploy/Central Server/api.php');
$centralSchema = (string) file_get_contents($root . '/deploy/Central Server/central-db.sql');
$localSource = (string) file_get_contents($root . '/backend/src/MasterDataApi.php');

maintenanceRuntimeAssert(
    str_contains($centralSource, 'function ensureMaintenanceSettingsSchema(PDO $pdo): void')
        && substr_count($centralSource, 'ensureMaintenanceSettingsSchema($pdo);') === 2,
    'Central maintenance reads and writes must repair the runtime schema.'
);
maintenanceRuntimeAssert(
    str_contains($centralSource, 'CREATE TABLE IF NOT EXISTS maintenance_settings')
        && str_contains($centralSource, "'target_deployments' => 'LONGTEXT NULL'")
        && str_contains($centralSource, "'deployment_scope' => \"VARCHAR(32) NOT NULL DEFAULT 'all'\"")
        && str_contains($centralSource, "'image_url' => 'VARCHAR(1000) NULL'")
        && str_contains($centralSource, "'ends_at' => 'DATETIME NULL'"),
    'The central maintenance runtime repair is missing required settings columns.'
);
maintenanceRuntimeAssert(
    str_contains($centralSource, "SHOW COLUMNS FROM `maintenance_settings`")
        && str_contains($centralSource, "ALTER TABLE `maintenance_settings` ADD COLUMN")
        && str_contains($centralSource, "!== 1060"),
    'The central maintenance upgrade must remain additive and concurrency-safe.'
);
maintenanceRuntimeAssert(
    str_contains($centralSchema, 'ADD COLUMN IF NOT EXISTS target_deployments')
        && str_contains($centralSchema, 'ADD COLUMN IF NOT EXISTS deployment_scope')
        && str_contains($centralSchema, 'ADD COLUMN IF NOT EXISTS ends_at'),
    'The central SQL artifact must retain the maintenance compatibility upgrade.'
);
maintenanceRuntimeAssert(
    str_contains($localSource, "'set_maintenance_status'")
        && str_contains($localSource, "'targetDeployments' => \$targetDeployments")
        && str_contains($localSource, "'imageUrl' => \$centralImageUrl")
        && str_contains($localSource, "'endsAt' => \$endsAt"),
    'The deployment backend must forward the complete maintenance settings payload.'
);

$packagedCentralPath = $root . '/deploy/central-license-api-package/api.php';
if (is_file($packagedCentralPath)) {
    $packagedCentral = (string) file_get_contents($packagedCentralPath);
    maintenanceRuntimeAssert(
        hash('sha256', $centralSource) === hash('sha256', $packagedCentral),
        'The packaged central maintenance API does not match the source API.'
    );
}

echo "Maintenance settings runtime compatibility tests passed.\n";
