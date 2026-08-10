<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\CourierStatusScheduler;

function courierPollingAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = dirname(__DIR__);
$worker = (string) file_get_contents($root . '/backend/bin/process_courier_statuses.php');
$courier = (string) file_get_contents($root . '/backend/src/CourierApi.php');
$setup = (string) file_get_contents($root . '/backend/bin/setup.php');
$updates = (string) file_get_contents($root . '/backend/src/UpdateManager.php');
$schema = (string) file_get_contents($root . '/backend/database/schema-only.sql');

$merged = CourierStatusScheduler::mergeCrontab(
    "* * * * * php /home/another/backend/bin/process_courier_statuses.php --once # mamepilot-courier-status:aabbccddeeff\n",
    "2-59/5 * * * * '/usr/local/bin/php' '/home/current/backend/bin/process_courier_statuses.php' --once >> '/home/current/courier.log' 2>&1 # mamepilot-courier-status:112233445566"
);
courierPollingAssert(substr_count($merged, '# mamepilot-courier-status:112233445566') === 1, 'Courier scheduler duplicated the current deployment.');
courierPollingAssert(str_contains($merged, '/home/another/backend/bin/process_courier_statuses.php'), 'Courier scheduler removed another deployment schedule.');
courierPollingAssert(str_contains($worker, 'GET_LOCK'), 'Courier worker has no overlap lock.');
courierPollingAssert(str_contains($worker, "'timeoutSeconds' => 8"), 'Courier worker does not bound provider request time.');
courierPollingAssert(str_contains($worker, "\$limit = \$provider === 'exchange' ? 2 : 10"), 'Courier worker batch size is not bounded.');
courierPollingAssert(str_contains($worker, 'reconcileUnmatchedWebhookEvents'), 'Stored unmatched webhooks are never retried by the fallback worker.');
courierPollingAssert(str_contains($courier, 'LIMIT {$limit} OFFSET {$offset}'), 'Legacy courier sync does not rotate bounded order windows.');
courierPollingAssert(str_contains($setup, 'new CourierStatusScheduler') && substr_count($updates, 'new CourierStatusScheduler') >= 2, 'Fresh installs and both updater paths do not install courier fallback polling.');
courierPollingAssert(str_contains($schema, 'CREATE TABLE IF NOT EXISTS `courier_poll_worker_state`'), 'Generated upgrade schema omits courier polling state.');

echo "Courier fallback polling runtime checks passed.\n";
