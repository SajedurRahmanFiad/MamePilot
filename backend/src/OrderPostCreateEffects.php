<?php

declare(strict_types=1);

namespace App;

final class OrderPostCreateEffects
{
    private FeatureAccess $featureAccess;
    private AutoCallApi $autoCall;
    private bool $surveyWorkerScheduled = false;
    private bool $fraudWorkersScheduled = false;
    private ?bool $fraudChecksEnabled = null;
    /** @var array<string, true> */
    private array $fraudCustomerIds = [];

    public function __construct(FeatureAccess $featureAccess, AutoCallApi $autoCall)
    {
        $this->featureAccess = $featureAccess;
        $this->autoCall = $autoCall;
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

        $customerId = trim((string) ($order['customerId'] ?? ''));
        if ($customerId === '') {
            return;
        }
        if ($this->fraudChecksEnabled === null) {
            try {
                $this->fraudChecksEnabled = !empty($this->featureAccess->fetchCapabilities()['grow_your_business']);
            } catch (\Throwable $exception) {
                $this->fraudChecksEnabled = false;
                error_log('Could not read fraud-check capability settings: ' . $exception->getMessage());
            }
        }
        if (!$this->fraudChecksEnabled) {
            return;
        }

        $this->fraudCustomerIds[$customerId] = true;
        if ($this->fraudWorkersScheduled) {
            return;
        }

        $this->fraudWorkersScheduled = true;
        register_shutdown_function(function (): void {
            foreach (array_keys($this->fraudCustomerIds) as $customerId) {
                $this->launchFraudCheck($customerId);
            }
        });
    }

    private function launchFraudCheck(string $customerId): void
    {
        $script = dirname(__DIR__) . '/bin/process_customer_fraud_check.php';
        if (!is_file($script)) {
            return;
        }

        $php = PHP_BINARY ?: 'php';
        if (DIRECTORY_SEPARATOR === '\\') {
            $command = 'cmd /c start "" /B ' . escapeshellarg($php) . ' ' . escapeshellarg($script) . ' ' . escapeshellarg($customerId) . ' > NUL 2>&1';
        } else {
            $command = 'nohup ' . escapeshellarg($php) . ' ' . escapeshellarg($script) . ' ' . escapeshellarg($customerId) . ' > /dev/null 2>&1 &';
        }

        if (function_exists('popen')) {
            $process = @popen($command, 'r');
            if (is_resource($process)) {
                @pclose($process);
            }
        } elseif (function_exists('shell_exec')) {
            @shell_exec($command);
        }
    }
}
