<?php

declare(strict_types=1);

use App\Auth;
use App\Config;
use App\Database;
use App\OperationsApi;

require_once dirname(__DIR__) . '/bootstrap.php';

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$auth = new Auth($config, $database);
$operations = new OperationsApi($database, $auth, $config);

$settings = $operations->fetchWalletSettings();
$method = new ReflectionMethod($operations, 'syncWalletCreditsForPayableStatuses');
$method->setAccessible(true);
$method->invoke($operations, $settings);

echo "Wallet credits resynced using the current payroll settings.\n";
