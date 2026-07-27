<?php

declare(strict_types=1);

/**
 * Install the automatic calling cron job.
 *
 * This script installs a cron entry that runs the survey queue worker
 * every minute. It is safe to run multiple times — existing entries
 * with the same marker or script path are replaced.
 *
 * Usage:
 *   php backend/bin/install_auto_call_cron.php
 */

require_once dirname(__DIR__) . '/bootstrap.php';

use App\Config;
use App\AutoCallScheduler;

$config = Config::load(dirname(__DIR__, 2));
$result = (new AutoCallScheduler($config))->ensureInstalled();

echo $result['message'] . "\n";

if ($result['status'] === 'installed' || $result['status'] === 'present') {
    exit(0);
}

exit(1);
