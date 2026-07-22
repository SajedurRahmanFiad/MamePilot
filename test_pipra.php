<?php
$apiKey = trim((string) getenv('PIPRAPAY_API_KEY'));
if ($apiKey === '') {
    fwrite(STDERR, "Set PIPRAPAY_API_KEY before running this diagnostic.\n");
    exit(1);
}

$url = 'https://payment.sajedurrahmanfiad.me/api/checkout/redirect';
$payload = [
    'full_name' => 'Test',
    'email_address' => 'test@test.com',
    'mobile_number' => '01700000000',
    'amount' => '100.00',
    'currency' => 'BDT',
    'metadata' => '{\"test\":\"1\"}',
    'return_url' => 'https://test.com',
    'webhook_url' => 'https://test.com'
];
$ch = curl_init($url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'MHS-PIPRAPAY-API-KEY: ' . $apiKey,
    'Content-Type: application/json',
    'Accept: application/json'
]);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
$res = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error = curl_error($ch);
echo "String metadata: $status\nError: $error\n" . $res . "\n";

$payload['metadata'] = ['test' => '1'];
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
$res = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
echo "Object metadata: $status\n" . $res . "\n";

$url2 = 'https://payment.sajedurrahmanfiad.me/api/api/checkout/redirect';
curl_setopt($ch, CURLOPT_URL, $url2);
$res = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
echo "Double API URL: $status\n" . $res . "\n";
