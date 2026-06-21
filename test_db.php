<?php
require_once 'backend/bootstrap.php';
use App\Database;
use App\Config;
$config = Config::load('backend');
$db = new Database($config);
$settings = $db->fetchOne('SELECT * FROM payment_gateway_settings LIMIT 1');
print_r($settings);
