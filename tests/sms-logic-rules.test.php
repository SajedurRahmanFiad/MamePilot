<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\AutoCallApi;
use App\SmsApi;

function smsLogicAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$smsReflection = new ReflectionClass(SmsApi::class);
smsLogicAssert($smsReflection->hasMethod('httpJson'), 'SMS API calls must have a defined HTTP transport.');
$sms = $smsReflection->newInstanceWithoutConstructor();
$normalizeRules = $smsReflection->getMethod('normalizeSmsRuleList');
$normalizeRules->setAccessible(true);
$rules = $normalizeRules->invoke($sms, [
    [
        'id' => 'call-rule',
        'sendTiming' => 'after_call',
        'callStatuses' => ['1', 'not_answered', 'unknown'],
        'templates' => ['1' => 'Confirmed', 'not_answered' => 'Missed call'],
    ],
    [
        'id' => 'courier-rule',
        'sendTiming' => 'after_courier_assigned',
        'templates' => ['default' => 'Courier assigned'],
    ],
], [1, 'not_answered']);

smsLogicAssert(count($rules) === 2, 'Multiple independent rules must be retained.');
smsLogicAssert($rules[0]['callStatuses'] === ['1', 'not_answered'], 'Outcomes outside the current dictionary must be discarded.');
smsLogicAssert(!array_key_exists('unknown', $rules[0]['templates']), 'Templates for removed dictionary outcomes must be discarded.');
smsLogicAssert($rules[1]['templates']['default'] === 'Courier assigned', 'Courier rules must retain their own template.');

$normalizeStoredRules = $smsReflection->getMethod('normalizeStoredSmsRules');
$normalizeStoredRules->setAccessible(true);
$legacy = $normalizeStoredRules->invoke($sms, [
    'send_timing' => 'after_call',
    'call_statuses' => json_encode(['confirmed', 'cancelled', 'unreachable']),
    'templates' => json_encode(['confirmed' => 'Yes', 'cancelled' => 'No', 'unreachable' => 'Missed']),
], [1, 2, 'not_answered']);

smsLogicAssert($legacy[0]['callStatuses'] === ['1', '2', 'not_answered'], 'Legacy outcome selections must migrate to corresponding dictionary keys.');
smsLogicAssert($legacy[0]['templates']['not_answered'] === 'Missed', 'Legacy outcome templates must be retained during conversion.');

$autoCallReflection = new ReflectionClass(AutoCallApi::class);
$autoCall = $autoCallReflection->newInstanceWithoutConstructor();
$normalizeDictionary = $autoCallReflection->getMethod('normalizeResponseDictionary');
$normalizeDictionary->setAccessible(true);
$dictionary = $normalizeDictionary->invoke($autoCall, [
    '1' => 'Confirmed',
    'not_answered' => 'Did not pick up',
    'invalid_outcome' => 'Ignore this',
]);

smsLogicAssert($dictionary === ['1' => 'Confirmed', 'not_answered' => 'Did not pick up'], 'Auto Calling must return only configured keypad or call-result outcomes.');

echo "SMS logic rule and dictionary contracts passed.\n";