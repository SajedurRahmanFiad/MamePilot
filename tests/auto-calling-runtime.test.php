<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\AutoCallScheduler;

function assertAutoCall(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function assertUniqueSqlBindings(string $source, string $needle): void
{
    $position = strpos($source, $needle);
    assertAutoCall($position !== false, "Auto-calling SQL statement was not found: {$needle}");

    $lineEnd = strpos($source, "\n", (int) $position);
    $statement = substr($source, (int) $position, $lineEnd === false ? null : $lineEnd - (int) $position);
    preg_match_all('/:([a-zA-Z_][a-zA-Z0-9_]*)/', $statement, $matches);
    $bindings = $matches[1] ?? [];
    assertAutoCall(
        count($bindings) === count(array_unique($bindings)),
        "SQL statement reuses a named PDO binding: {$statement}"
    );
}

$root = dirname(__DIR__);
$autoCallSource = (string) file_get_contents($root . '/backend/src/AutoCallApi.php');
$workerSource = (string) file_get_contents($root . '/backend/bin/process_survey_queue.php');
$migrationSource = (string) file_get_contents($root . '/migrations/2026-07-23_auto_calling_worker_health.sql');
$schedulerSource = (string) file_get_contents($root . '/backend/src/AutoCallScheduler.php');
$updateManagerSource = (string) file_get_contents($root . '/backend/src/UpdateManager.php');
$setupSource = (string) file_get_contents($root . '/backend/bin/setup.php');
$orderDetailsSource = (string) file_get_contents($root . '/pages/OrderDetails.tsx');
$billDetailsSource = (string) file_get_contents($root . '/pages/BillDetails.tsx');
$queryHooksSource = (string) file_get_contents($root . '/src/hooks/useQueries.ts');
$indexSource = (string) file_get_contents($root . '/index.html');
$settingsSource = (string) file_get_contents($root . '/pages/Settings.tsx');
$autoCallingPageSource = (string) file_get_contents($root . '/pages/AutoCalling.tsx');
$ordersSource = (string) file_get_contents($root . '/pages/Orders.tsx');
$billsSource = (string) file_get_contents($root . '/pages/Bills.tsx');
$customersSource = (string) file_get_contents($root . '/pages/Customers.tsx');
$vendorsSource = (string) file_get_contents($root . '/pages/Vendors.tsx');
$tableSource = (string) file_get_contents($root . '/components/Table.tsx');

assertUniqueSqlBindings($autoCallSource, "INSERT INTO auto_calling_recharges");
assertUniqueSqlBindings($autoCallSource, "UPDATE orders SET survey_status = 'triggered'");
assertUniqueSqlBindings($autoCallSource, "UPDATE orders SET survey_status = 'pending', survey_id = NULL");

assertAutoCall(
    str_contains($autoCallSource, "'workerHealth' => \$this->buildWorkerHealth"),
    'Voice Survey responses must expose durable queue health.'
);
assertAutoCall(
    str_contains($autoCallSource, "'cron_last_error' => mb_substr"),
    'Worker failures must be persisted instead of disappearing with detached output.'
);
assertAutoCall(
    str_contains($workerSource, "hash('sha256', \$databaseName)"),
    'The MySQL worker lock must be scoped to the deployment database.'
);
assertAutoCall(
    str_contains($workerSource, "error_log('Automatic calling worker failed:"),
    'CLI worker failures must also be written to the PHP error log.'
);
assertAutoCall(
    str_contains($workerSource, "--watch-seconds=(\\d+)")
        && str_contains($autoCallSource, "'--watch-seconds=' . \$this->backgroundWorkerLifetimeSeconds(\$settings)"),
    'The post-order worker must remain active for local delay and retry windows.'
);
assertAutoCall(
    str_contains($migrationSource, 'cron_last_success_at')
        && str_contains($migrationSource, 'cron_last_error')
        && str_contains($migrationSource, 'cron_last_processed_count'),
    'The additive worker-health migration is incomplete.'
);
assertAutoCall(
    str_contains($schedulerSource, "self::MARKER_PREFIX . ':'")
        && str_contains($autoCallSource, 'new AutoCallScheduler')
        && str_contains($updateManagerSource, "'automaticCallingSchedule'")
        && str_contains($setupSource, 'new AutoCallScheduler'),
    'Automatic calling schedule repair must ship through setup, updates, and the next eligible order.'
);

$mergedCrontab = AutoCallScheduler::mergeCrontab(
    "15 * * * * php /home/example/another-task.php\n"
        . "*/5 * * * * php /old/backend/bin/process_survey_queue.php --once # mamepilot-auto-calling\n"
        . "* * * * * php /home/another-site/backend/bin/process_survey_queue.php --once # mamepilot-auto-calling:aabbccddeeff\n",
    "* * * * * '/usr/local/bin/php' '/old/backend/bin/process_survey_queue.php' --once >> '/home/example/auto-call.log' 2>&1 # mamepilot-auto-calling:112233445566"
);
assertAutoCall(substr_count($mergedCrontab, '# mamepilot-auto-calling:112233445566') === 1, 'Schedule repair must not create duplicate entries.');
assertAutoCall(str_contains($mergedCrontab, 'another-task.php'), 'Schedule repair must preserve unrelated entries.');
assertAutoCall(str_contains($mergedCrontab, '/home/another-site/backend/bin/process_survey_queue.php'), 'Schedule repair must preserve other MamePilot deployments.');

$orderProgressPosition = strpos($orderDetailsSource, '{/* Order Progress Section */}');
$surveySectionPosition = strpos($orderDetailsSource, '{/* Automatic Survey Section */}');
assertAutoCall(
    $orderProgressPosition !== false && $surveySectionPosition !== false && $surveySectionPosition > $orderProgressPosition,
    'Automatic Survey must appear below Order Progress.'
);
assertAutoCall(
    str_contains($orderDetailsSource, "toggleSection('survey')")
        && str_contains($orderDetailsSource, "toggleSection('activitySurvey')")
        && str_contains($orderDetailsSource, "label: 'Automatic survey queued'")
        && str_contains($orderDetailsSource, 'children: surveyChildren')
        && str_contains($orderDetailsSource, 'firstQueuedIndex < 0 || index !== firstQueuedIndex')
        && str_contains($orderDetailsSource, "event.eventType === 'retry_scheduled' || !eventTimestamp"),
    'Survey details and their activity group must be collapsible.'
);
assertAutoCall(
    !preg_match('/awajdigital|webhook/i', $orderDetailsSource . "\n" . $settingsSource . "\n" . $autoCallingPageSource),
    'General automatic-calling screens must not expose provider or delivery implementation terms.'
);
assertAutoCall(
    str_contains($autoCallSource, "'surveyEvents' => \$events")
        && str_contains($queryHooksSource, "queryKey: ['survey', 'order-status', orderId]")
        && str_contains($queryHooksSource, 'refetchIntervalInBackground: false')
        && str_contains($orderDetailsSource, 'storedOrder && liveSurvey ? { ...storedOrder, ...liveSurvey } : storedOrder'),
    'Order Details must merge a lightweight visible-page survey poll into every survey display.'
);
assertAutoCall(
    str_contains($orderDetailsSource, 'details-invoice-logo')
        && str_contains($billDetailsSource, 'details-invoice-logo')
        && str_contains($indexSource, '@media (max-width: 639px)')
        && str_contains($indexSource, 'width: var(--details-logo-mobile-width)'),
    'Order and bill invoice logos must scale down on mobile.'
);
assertAutoCall(
    str_contains($tableSource, 'w-full whitespace-nowrap text-left')
        && str_contains($ordersSource, 'w-full whitespace-nowrap text-left')
        && str_contains($billsSource, 'w-full whitespace-nowrap text-left')
        && str_contains($customersSource, 'nowrap: true')
        && str_contains($vendorsSource, 'nowrap: true'),
    'Primary list-table values must stay on one line on narrow screens.'
);

echo "Auto-calling runtime tests passed.\n";
