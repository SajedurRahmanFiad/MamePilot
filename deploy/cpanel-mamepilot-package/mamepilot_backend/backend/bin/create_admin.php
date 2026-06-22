<?php

declare(strict_types=1);

use App\Auth;
use App\Config;
use App\Database;
use App\MasterDataApi;

require_once dirname(__DIR__) . '/bootstrap.php';

$options = getopt('', ['name:', 'phone:', 'password:', 'role::']);
$name = trim((string) ($options['name'] ?? ''));
$phone = trim((string) ($options['phone'] ?? ''));
$password = (string) ($options['password'] ?? '');
$role = trim((string) ($options['role'] ?? 'Admin'));

if ($name === '' || $phone === '' || $password === '') {
    fwrite(STDERR, "Usage: php backend/bin/create_admin.php --name=\"Admin\" --phone=\"017...\" --password=\"secret\" [--role=Admin]\n");
    exit(1);
}

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$auth = new Auth($config, $database);
$api = new MasterDataApi($database, $auth, $config);

try {
    $user = $api->createUser([
        'name' => $name,
        'phone' => $phone,
        'password' => $password,
        'role' => $role,
    ]);
    echo json_encode($user, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . PHP_EOL;
} catch (Throwable $exception) {
    fwrite(STDERR, $exception->getMessage() . PHP_EOL);
    exit(1);
}
