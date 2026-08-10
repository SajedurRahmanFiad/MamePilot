<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\Auth;
use App\Config;
use App\CourierApi;
use App\Database;
use App\MasterDataApi;
use App\FeatureAccess;

function testAssert(bool $condition, string $message): void
{
    if (!$condition) {
        echo "[FAIL] " . $message . "\n";
        exit(1);
    }
}

echo "Starting FraudSpy Integration & Settings Tests...\n";

$root = dirname(__DIR__);
$config = Config::load($root);
$database = new Database($config);
$auth = new Auth($config, $database);

// Run migration / column checks
$schemaOnly = file_get_contents($root . '/backend/database/schema-only.sql');
testAssert(str_contains($schemaOnly, "sp_add_col('courier_settings', 'fraud_checker_provider'"), "schema-only.sql missing fraud_checker_provider column migration");
testAssert(str_contains($schemaOnly, "sp_add_col('courier_settings', 'fraudspy_api_key'"), "schema-only.sql missing fraudspy_api_key column migration");
testAssert(str_contains($schemaOnly, "sp_add_col('system_defaults', 'automatic_fraud_check_on_order_creation'"), "schema-only.sql missing automatic_fraud_check_on_order_creation column migration");

// Test MasterDataApi fetch & update courier settings
$master = new MasterDataApi($database, $auth, $config);
$courierSettings = $master->fetchCourierSettings();
testAssert(array_key_exists('fraudChecker', $courierSettings), "fetchCourierSettings missing fraudChecker array");
testAssert(array_key_exists('provider', $courierSettings['fraudChecker']), "fraudChecker settings missing provider");
testAssert(array_key_exists('fraudspyApiKey', $courierSettings['fraudChecker']), "fraudChecker settings missing fraudspyApiKey");

// Test MasterDataApi fetch & update system defaults
$systemDefaults = $master->fetchSystemDefaults();
testAssert(array_key_exists('automaticFraudCheckOnOrderCreation', $systemDefaults), "fetchSystemDefaults missing automaticFraudCheckOnOrderCreation");

// Test CourierApi FraudSpy mapping via reflection
$operations = new App\OperationsApi($database, $auth, $config);
$courierApi = new CourierApi($database, $auth, $config, $operations);
$reflection = new ReflectionClass($courierApi);
testAssert($reflection->hasMethod('connectFraudspySteadfast'), "CourierApi missing connectFraudspySteadfast method");
testAssert($reflection->hasMethod('mapFraudSpyResponse'), "CourierApi missing mapFraudSpyResponse method");

$mapMethod = $reflection->getMethod('mapFraudSpyResponse');
$mapMethod->setAccessible(true);

$sampleFraudSpyPayload = [
    "ok" => true,
    "phone" => ["local" => "01400570011"],
    "overall" => [
        "total" => 311,
        "delivered" => 257,
        "returned" => 54,
        "success_ratio" => 82.64
    ],
    "couriers" => [
        "steadfast" => [
            "ok" => true,
            "total" => 50,
            "successful" => 34,
            "returned" => 16,
            "ms" => 266
        ],
        "redx" => [
            "ok" => true,
            "total" => 20,
            "successful" => 18,
            "returned" => 2,
            "ms" => 150
        ]
    ],
    "fraud_reports" => [
        "count" => 1,
        "risk" => ["level" => "Medium", "score" => 2.4],
        "reports" => [
            [
                "id" => 4,
                "contact_name" => "Test Reporter",
                "complain" => "Fake address customer",
                "categories" => ["fake_address"],
                "courier" => "RedX",
                "reported_at" => "2026-05-12T11:31:30+06:00"
            ]
        ]
    ]
];

$mapped = $mapMethod->invoke($courierApi, $sampleFraudSpyPayload, '01400570011');
testAssert(($mapped['status'] ?? '') === 'success', "Mapped status should be success");
testAssert(($mapped['phone'] ?? '') === '01400570011', "Mapped phone mismatch");
testAssert(($mapped['provider'] ?? '') === 'fraudspy', "Mapped provider should be fraudspy");
testAssert(isset($mapped['summary']['totalParcel']) && $mapped['summary']['totalParcel'] === 311, "Total parcel mismatch");
testAssert(isset($mapped['summary']['successParcel']) && $mapped['summary']['successParcel'] === 257, "Success parcel mismatch");
testAssert(isset($mapped['summary']['cancelledParcel']) && $mapped['summary']['cancelledParcel'] === 54, "Cancelled parcel mismatch");
testAssert(count($mapped['couriers']) === 2, "Couriers count mismatch");
testAssert(count($mapped['reports']) === 1, "Reports count mismatch");
testAssert(($mapped['reports'][0]['name'] ?? '') === 'Test Reporter', "Report name mismatch");

// Test FeatureAccess capability mapping
$constants = (new ReflectionClass(FeatureAccess::class))->getConstants();
$actionMap = $constants['ACTION_CAPABILITIES'] ?? [];
testAssert(isset($actionMap['connectFraudspySteadfast']) && $actionMap['connectFraudspySteadfast'] === 'fraud_checker', "connectFraudspySteadfast missing from FeatureAccess action map");

echo "All FraudSpy integration PHP unit & contract tests passed successfully!\n";
