<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/bootstrap.php';

$config = new App\Config([]);
$database = new App\Database($config);
$auth = new App\Auth($config, $database);
$executor = new App\AgentExecutor($database, $auth, $config);

$analysis = $executor->analyzeProfitTrendMetrics(
    [
        'sales' => 12000,
        'purchases' => 7000,
        'otherExpenses' => 2000,
        'otherIncome' => 500,
    ],
    [
        'sales' => 15000,
        'purchases' => 6000,
        'otherExpenses' => 1500,
        'otherIncome' => 400,
    ]
);

if (($analysis['netProfitChangePercent'] ?? 0) >= 0 || ($analysis['likelyCauses'][0] ?? '') === '') {
    fwrite(STDERR, "Profit analysis test failed\n");
    exit(1);
}

$plan = $executor->buildReasoningPlan([], 'Why is my profit getting lower?');
if (($plan['finance'] ?? false) !== true || count($plan['steps'] ?? []) < 3) {
    fwrite(STDERR, "Reasoning plan test failed\n");
    exit(1);
}

fwrite(STDOUT, $analysis['summary'] . PHP_EOL);
fwrite(STDOUT, 'Reasoning steps: ' . count($plan['steps']) . PHP_EOL);
