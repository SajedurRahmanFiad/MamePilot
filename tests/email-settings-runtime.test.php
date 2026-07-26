<?php

declare(strict_types=1);

function assertEmailSettings(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$masterSource = (string) file_get_contents($root . '/backend/src/MasterDataApi.php');
$packagedSource = (string) file_get_contents(
    $root . '/deploy/cpanel-mamepilot-package/mamepilot_backend/backend/src/MasterDataApi.php'
);
$migrationSource = (string) file_get_contents($root . '/migrations/2026-07-20_payment_email_hardening.sql');

assertEmailSettings(
    str_contains($masterSource, 'private function ensureEmailSettingsTable(): void')
        && substr_count($masterSource, '$this->ensureEmailSettingsTable();') === 3,
    'Email settings reads, writes, and notification delivery must repair a skipped table migration.'
);
assertEmailSettings(
    str_contains($masterSource, 'VALUES (:id, {$placeholders}, :created_at, :updated_at)')
        && str_contains($masterSource, '$bindings[\':created_at\'] = $now;')
        && str_contains($masterSource, '$bindings[\':updated_at\'] = $now;')
        && !str_contains($masterSource, ':now, :now'),
    'The first email settings insert must use unique native PDO placeholders.'
);
assertEmailSettings(
    str_contains($masterSource, 'CREATE TABLE IF NOT EXISTS email_settings')
        && str_contains($masterSource, "tableExists('email_settings')")
        && str_contains($masterSource, 'smtp_encryption VARCHAR(16)')
        && str_contains($masterSource, 'smtp_password VARCHAR(500)'),
    'The runtime email settings schema is incomplete.'
);
assertEmailSettings(
    str_contains($migrationSource, 'CREATE TABLE IF NOT EXISTS email_settings')
        && str_contains($migrationSource, 'smtp_encryption VARCHAR(16)')
        && str_contains($migrationSource, 'smtp_password VARCHAR(500)'),
    'The deployment migration must retain the email settings schema.'
);
assertEmailSettings(
    hash('sha256', $masterSource) === hash('sha256', $packagedSource),
    'The packaged email settings backend does not match the source backend.'
);

echo "Email settings runtime tests passed.\n";
