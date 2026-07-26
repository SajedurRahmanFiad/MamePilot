<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\Database;
use App\MasterDataApi;

function permissionsPersistenceAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function permissionsPersistenceRole(array $settings, string $roleName): ?array
{
    foreach ($settings['roles'] ?? [] as $role) {
        if (is_array($role) && ($role['roleName'] ?? null) === $roleName) {
            return $role;
        }
    }

    return null;
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

$permissionKey = 'accounts.viewBalance';
$pdo->beginTransaction();
try {
    $current = $masterData->fetchPermissionsSettings();
    $employee = permissionsPersistenceRole($current, 'Employee');
    permissionsPersistenceAssert($employee !== null, 'Employee permission role is unavailable.');

    $next = $current;
    foreach ($next['roles'] as &$role) {
        if (($role['roleName'] ?? null) === 'Employee') {
            $role['permissions'][$permissionKey] = true;
        }
    }
    unset($role);

    $saved = $masterData->updatePermissionsSettings($next);
    $savedEmployee = permissionsPersistenceRole($saved, 'Employee');
    permissionsPersistenceAssert(
        ($savedEmployee['permissions'][$permissionKey] ?? false) === true,
        'The saved permissions response discarded a checked permission.'
    );

    $storedRow = $database->fetchOne(
        'SELECT permissions FROM role_permissions WHERE role_name = :role_name LIMIT 1',
        [':role_name' => 'Employee']
    );
    $storedPermissions = json_decode((string) ($storedRow['permissions'] ?? ''), true);
    permissionsPersistenceAssert(
        is_array($storedPermissions) && ($storedPermissions[$permissionKey] ?? false) === true,
        'The checked permission was not persisted in role_permissions.'
    );

    $refetchedEmployee = permissionsPersistenceRole($masterData->fetchPermissionsSettings(), 'Employee');
    permissionsPersistenceAssert(
        ($refetchedEmployee['permissions'][$permissionKey] ?? false) === true,
        'A fresh permissions fetch did not retain the checked permission.'
    );

    echo "Permissions save/read-back persistence test passed.\n";
} finally {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
}
