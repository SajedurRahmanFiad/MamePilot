<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\CourierStatusScheduler;
use App\CourierApi;

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
courierPollingAssert(
    substr_count($courier, "'logPollingResponse' => true") === 8,
    'One or more main or exchange courier polling lookups are not logged.'
);
$pollRequest = new ReflectionMethod(CourierApi::class, 'courierPollingRequest');
$pollRequest->setAccessible(true);
courierPollingAssert($pollRequest->getNumberOfParameters() === 8, 'Polling response logger does not capture request context and timeout.');
$courierApi = (new ReflectionClass(CourierApi::class))->newInstanceWithoutConstructor();
$pathaoClassifier = new ReflectionMethod(CourierApi::class, 'classifyPathaoStatus');
$pathaoClassifier->setAccessible(true);
$returnStatus = $pathaoClassifier->invoke($courierApi, 'Return Delivered');
courierPollingAssert(($returnStatus['status'] ?? null) === 'Returned', 'Pathao polling misclassified Return Delivered as a normal delivery.');
$deliveredStatus = $pathaoClassifier->invoke($courierApi, 'Delivered');
courierPollingAssert(($deliveredStatus['status'] ?? null) === 'Delivered', 'Pathao polling did not recognize Delivered.');
$pendingStatus = $pathaoClassifier->invoke($courierApi, 'Pending');
courierPollingAssert(($pendingStatus['status'] ?? null) === null, 'Pathao polling advanced an order that is still Pending.');
$pickedStatus = $pathaoClassifier->invoke($courierApi, 'Picked');
courierPollingAssert(($pickedStatus['status'] ?? null) === 'Picked', 'Pathao polling did not recognize Picked.');
$pickupStatus = $pathaoClassifier->invoke($courierApi, 'Pickup');
courierPollingAssert(($pickupStatus['status'] ?? null) === 'Picked', 'Pathao polling did not recognize Pickup.');
$transitStatus = $pathaoClassifier->invoke($courierApi, 'In Transit');
courierPollingAssert(($transitStatus['status'] ?? null) === 'Picked', 'Pathao polling did not recognize an order that is In Transit.');
$partialStatus = $pathaoClassifier->invoke($courierApi, 'Partial Delivery');
courierPollingAssert(($partialStatus['status'] ?? null) === 'Partially Delivered', 'Pathao polling did not recognize Partial Delivery.');
$paidReturnStatus = $pathaoClassifier->invoke($courierApi, 'Paid Return');
courierPollingAssert(($paidReturnStatus['status'] ?? null) === 'Partially Delivered', 'Pathao polling did not recognize Paid Return as partially delivered.');
$paidReturnSlugStatus = $pathaoClassifier->invoke($courierApi, 'paid_return');
courierPollingAssert(($paidReturnSlugStatus['status'] ?? null) === 'Partially Delivered', 'Pathao polling did not recognize the paid_return slug as partially delivered.');
$pathaoPollingSource = substr($courier, strpos($courier, 'public function syncPathaoDeliveryStatuses'));
courierPollingAssert(
    str_contains($pathaoPollingSource, "\$updates['status'] = 'pending_partial'")
    && str_contains($pathaoPollingSource, "\$updates['partial_delivery_action_required'] = 1"),
    'Pathao polling partial delivery does not require confirmation.'
);
$webhookMapper = new ReflectionMethod(CourierApi::class, 'mapWebhookStatus');
$webhookMapper->setAccessible(true);
foreach ([
    ['Pickup', '', 'Picked'],
    ['Return', '', 'Returned'],
    ['Delivered', '', 'Delivered'],
    ['Partial Delivery', '', 'Partially Delivered'],
    ['Paid Return', '', 'Partially Delivered'],
    ['Paid_Return', '', 'Partially Delivered'],
] as [$eventName, $rawStatus, $expected]) {
    $mapped = $webhookMapper->invoke($courierApi, 'pathao', $eventName, $rawStatus);
    courierPollingAssert($mapped === $expected, "Pathao webhook did not map {$eventName} to {$expected}.");
}

echo "Courier fallback polling runtime checks passed.\n";
