<?php

declare(strict_types=1);

namespace App;

final class OrderPostCreateEffects
{
    private FeatureAccess $featureAccess;
    private AutoCallApi $autoCall;
    private ?SmsApi $sms;
    private ?Database $database;
    private bool $surveyWorkerScheduled = false;

    public function __construct(FeatureAccess $featureAccess, AutoCallApi $autoCall, ?Database $database = null, ?SmsApi $sms = null)
    {
        $this->featureAccess = $featureAccess;
        $this->autoCall = $autoCall;
        $this->database = $database;
        $this->sms = $sms;
    }

    /** @param array<string, mixed> $order */
    public function schedule(array $order): void
    {
        $orderId = trim((string) ($order['id'] ?? ''));
        $orderStatus = trim((string) ($order['status'] ?? ''));
        try {
            if (
                $orderId !== ''
                && $this->autoCall->queueOrderIfEligible($orderId, $orderStatus)
                && !$this->surveyWorkerScheduled
            ) {
                $this->surveyWorkerScheduled = true;
                register_shutdown_function(function (): void {
                    try {
                        $this->autoCall->triggerSurveyBackgroundProcess();
                    } catch (\Throwable $exception) {
                        error_log('Could not trigger the automatic call worker: ' . $exception->getMessage());
                    }
                });
            }
        } catch (\Throwable $exception) {
            error_log('Could not queue automatic calling for order ' . $orderId . ': ' . $exception->getMessage());
        }

        if ($orderId !== '' && $this->sms !== null) {
            try { $this->sms->queueOrderIfEligible($orderId); } catch (\Throwable $exception) { error_log('Could not send automatic SMS for order ' . $orderId . ': ' . $exception->getMessage()); }
        }

        $customerId = trim((string) ($order['customerId'] ?? ''));
        if ($customerId === '' || !$this->isAutomaticFraudCheckEnabled()) {
            return;
        }
        $this->runFraudCheck($customerId);
    }

    private function runFraudCheck(string $customerId): void
    {
        try {
            $config = Config::load(dirname(__DIR__, 2));
            $database = new Database($config);
            $auth = new Auth($config, $database);
            $operations = new OperationsApi($database, $auth, $config);
            $courier = new CourierApi($database, $auth, $config, $operations);
            $courier->processFraudCheckForCustomer($customerId);
        } catch (\Throwable $exception) {
            error_log('Automatic fraud check failed for customer ' . $customerId . ': ' . $exception->getMessage());
        }
    }

    private function launchFraudCheck(string $customerId): void
    {
        $script = dirname(__DIR__) . '/bin/process_customer_fraud_check.php';
        if (!is_file($script)) {
            error_log('Could not trigger automatic fraud check: worker script not found at ' . $script);
            return;
        }

        $php = $this->phpBinary();
        if (DIRECTORY_SEPARATOR === '\\') {
            $command = 'start "" /B ' . escapeshellarg($php) . ' ' . escapeshellarg($script) . ' ' . escapeshellarg($customerId) . ' > NUL 2>&1';
        } else {
            $command = 'nohup ' . escapeshellarg($php) . ' ' . escapeshellarg($script) . ' ' . escapeshellarg($customerId) . ' > /dev/null 2>&1 &';
        }

        if (function_exists('popen')) {
            $process = @popen($command, 'r');
            if (is_resource($process)) {
                @pclose($process);
                return;
            }
        } elseif (function_exists('shell_exec')) {
            @shell_exec($command);
            return;
        }

        // Some hosts disable both process APIs. The shutdown callback is already
        // running here, so this fallback still happens after order persistence.
        error_log('Could not spawn automatic fraud check worker; running it inline for customer ' . $customerId);
        $this->runFraudCheck($customerId);
    }

    private function phpBinary(): string
    {
        $configured = trim((string) ($this->database !== null ? $this->configValue('UPDATE_PHP_BINARY') : ''));
        if ($configured !== '') return $configured;

        $binary = trim((string) PHP_BINARY);
        if ($binary !== '' && !preg_match('/php-(?:cgi|fpm)$/i', basename($binary))) return $binary;
        if ($binary !== '') {
            $sibling = dirname($binary) . DIRECTORY_SEPARATOR . (DIRECTORY_SEPARATOR === '\\' ? 'php.exe' : 'php');
            if (is_file($sibling)) return $sibling;
        }
        foreach (['/usr/local/bin/php', '/usr/bin/php'] as $candidate) {
            if (is_file($candidate) && is_executable($candidate)) return $candidate;
        }
        return 'php';
    }

    private function configValue(string $key): ?string
    {
        try {
            return Config::load(dirname(__DIR__, 2))->get($key);
        } catch (\Throwable $exception) {
            return null;
        }
    }

    private function isAutomaticFraudCheckEnabled(): bool
    {
        if ($this->database === null) {
            return false;
        }

        try {
            $defaults = $this->database->fetchOne(
                'SELECT automatic_fraud_check_on_order_creation FROM system_defaults LIMIT 1'
            );
            return (bool) ($defaults['automatic_fraud_check_on_order_creation'] ?? false);
        } catch (\Throwable $exception) {
            error_log('Could not read automatic fraud check setting: ' . $exception->getMessage());
            return false;
        }
    }
}
