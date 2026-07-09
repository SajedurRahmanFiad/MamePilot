<?php

declare(strict_types=1);

use App\Auth;
use App\Config;
use App\Database;
use App\MetaAdsApi;

require_once dirname(__DIR__) . '/bootstrap.php';

$isManual = in_array('--manual', $argv ?? [], true);

$config = Config::load(dirname(__DIR__, 2));
$database = new Database($config);
$auth = new Auth($config, $database);
$metaAds = new MetaAdsApi($database, $auth, $config);

try {
    if ($isManual) {
        $result = $metaAds->syncMetaAdsFromCliManual();
    } else {
        $result = $metaAds->syncMetaAdsFromCli();
    }
    echo json_encode($result, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . PHP_EOL;
    exit(0);
} catch (Throwable $exception) {
    fwrite(STDERR, $exception->getMessage() . PHP_EOL);
    exit(1);
}
