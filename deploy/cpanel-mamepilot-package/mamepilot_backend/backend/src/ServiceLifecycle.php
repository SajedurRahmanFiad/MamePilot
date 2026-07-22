<?php

declare(strict_types=1);

namespace App;

final class ServiceLifecycle
{
    /**
     * Actions that should stop when the shared backend services are expired
     * or still being renewed. Read-only endpoints intentionally stay available
     * so admins can open settings and submit the renewal payment.
     */
    private const BLOCKED_ACTIONS = [
        'batchUpdateSettings',
        'completePickedOrder',
        'createAccount',
        'createBill',
        'createCategory',
        'createCustomer',
        'createOrder',
        'createPaymentMethod',
        'createProduct',
        'createTransaction',
        'createUnit',
        'createUser',
        'createVendor',
        'importDataRecords',
        'deleteAccount',
        'deleteBill',
        'deleteCategory',
        'deleteCustomer',
        'deleteOrder',
        'deletePaymentMethod',
        'deleteProduct',
        'deleteTransaction',
        'deleteUnit',
        'deleteUser',
        'deleteVendor',
        'deleteEmployeeWalletPayout',
        'markPayrollPaid',
        'payEmployeeWallet',
        'permanentlyDeleteDeletedItem',
        'restoreDeletedItem',
        'revertOrderStatus',
        'reviewTransactionApproval',
        'submitCarryBeeOrder',
        'submitPaperflyOrder',
        'submitSteadfastOrder',
        'syncCarryBeeTransferStatuses',
        'syncPaperflyOrderStatuses',
        'syncPathaoDeliveryStatuses',
        'syncSteadfastDeliveryStatuses',
        'updateAccount',
        'updateBill',
        'updateCategory',
        'updateCompanySettings',
        'updateCourierSettings',
        'updateCustomer',
        'updateInvoiceSettings',
        'updateMetaAdsSettings',
        'updateLlmSettings',
        'updateBeSmartSettings',
        'updateOrder',
        'updateOrderSettings',
        'updatePaymentMethod',
        'updatePayrollSettings',
        'updatePermissionsSettings',
        'updateProduct',
        'updateSystemDefaults',
        'updateTransaction',
        'updateUnit',
        'updateUser',
        'updateVendor',
        'updateWalletSettings',
        'createWhatsAppConversation',
        'markWhatsAppConversationRead',
        'sendWhatsAppMessage',
        'sendWhatsAppMediaMessage',
        'sendWhatsAppTemplate',
        'testWhatsAppConnection',
        'updateWhatsAppSettings',
        'updateWhatsAppWelcomeExperience',
        'markMessengerConversationRead',
        'sendMessengerMessage',
        'sendMessengerMediaMessage',
        'sendMessengerQuickReplies',
        'sendMessengerCard',
        'sendMessengerReaction',
        'sendMessengerSenderAction',
        'testMessengerConnection',
        'subscribeMessengerPage',
        'updateMessengerProfile',
        'updateMessengerSettings',
        'saveWooCommerceStore',
        'deleteWooCommerceStore',
        'registerWooCommerceWebhook',
        'syncWooCommerceOrders',
    ];

    private Database $database;
    private Config $config;
    /** @var array<string, bool> */
    private array $tableExistsCache = [];
    /** @var array<string, bool> */
    private array $columnExistsCache = [];

    public function __construct(Database $database, Config $config)
    {
        $this->database = $database;
        $this->config = $config;
    }

    public function requiresActiveServices(string $action): bool
    {
        return in_array(trim($action), self::BLOCKED_ACTIONS, true);
    }

    public function assertActionAllowed(string $action): void
    {
        if (!$this->requiresActiveServices($action)) {
            return;
        }

        $state = $this->getState();
        $status = (string) ($state['state'] ?? 'active');
        $isBlocked = (bool) ($state['writeBlocked'] ?? false);
        if (!$isBlocked) {
            return;
        }

        if ($status === 'renewing') {
            throw new ApiException(
                'Service renewal is processing. The subscription will be available again within 10 minutes.',
                423,
                'SERVICE_RENEWAL_PENDING',
                ['serviceState' => $status]
            );
        }

        throw new ApiException(
            'Your subscription has expired. Please renew it from Subscriptions to restore normal operations.',
            423,
            'SERVICE_EXPIRED',
            ['serviceState' => $status]
        );
    }

    /**
     * @return array<string, mixed>
     */
    public function getState(): array
    {
        $this->finalizeReadyPayments();
        $this->advanceRecurringCycleIfCovered();

        $defaultWarningDays = 7;
        if (
            !$this->tableExists('service_subscription_settings')
            || !$this->tableExists('service_subscription_payments')
        ) {
            return [
                'state' => 'unconfigured',
                'writeBlocked' => false,
                'dueAt' => null,
                'warningDays' => $defaultWarningDays,
                'billingVersion' => 1,
                'payment' => null,
            ];
        }

        $settings = $this->database->fetchOne('SELECT * FROM service_subscription_settings LIMIT 1');
        if ($settings === null) {
            return [
                'state' => 'unconfigured',
                'writeBlocked' => false,
                'dueAt' => null,
                'warningDays' => $defaultWarningDays,
                'billingVersion' => 1,
                'payment' => null,
            ];
        }

        $warningDays = max(1, (int) ($settings['warning_days'] ?? $defaultWarningDays));
        $billingVersion = max(1, (int) ($settings['billing_version'] ?? 1));
        $dueAt = $this->normalizeDateTimeString($settings['due_at'] ?? null);
        $totalAmount = max(0.0, (float) ($settings['total_amount'] ?? 0));
        $subscriptionStatus = strtolower(trim((string) ($settings['subscription_status'] ?? '')));
        if (in_array($subscriptionStatus, ['past_due', 'expired', 'cancelled', 'canceled'], true)) {
            return [
                'state' => $subscriptionStatus === 'past_due' ? 'warning' : 'expired',
                'writeBlocked' => $subscriptionStatus !== 'past_due',
                'dueAt' => $dueAt,
                'warningDays' => $warningDays,
                'billingVersion' => $billingVersion,
                'payment' => null,
            ];
        }
        if ($dueAt === null || $totalAmount <= 0) {
            return [
                'state' => 'unconfigured',
                'writeBlocked' => false,
                'dueAt' => $dueAt,
                'warningDays' => $warningDays,
                'billingVersion' => $billingVersion,
                'payment' => null,
            ];
        }

        $approvedPayment = $this->database->fetchOne(
            "SELECT *
             FROM service_subscription_payments
             WHERE billing_version = :billing_version
               AND status = 'approved'
             ORDER BY processed_at DESC, submitted_at DESC
             LIMIT 1",
            [':billing_version' => $billingVersion]
        );
        if ($approvedPayment !== null) {
            return [
                'state' => 'active',
                'writeBlocked' => false,
                'dueAt' => $dueAt,
                'warningDays' => $warningDays,
                'billingVersion' => $billingVersion,
                'payment' => $approvedPayment,
            ];
        }

        $processingPayment = $this->database->fetchOne(
            "SELECT *
             FROM service_subscription_payments
             WHERE billing_version = :billing_version
               AND status = 'processing'
             ORDER BY submitted_at DESC
             LIMIT 1",
            [':billing_version' => $billingVersion]
        );

        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $dueDate = $this->parseDateTime($dueAt);
        $isDue = $dueDate instanceof \DateTimeImmutable && $now >= $dueDate;

        if ($processingPayment !== null && $isDue) {
            return [
                'state' => 'renewing',
                'writeBlocked' => true,
                'dueAt' => $dueAt,
                'warningDays' => $warningDays,
                'billingVersion' => $billingVersion,
                'payment' => $processingPayment,
            ];
        }

        if ($isDue) {
            return [
                'state' => 'expired',
                'writeBlocked' => true,
                'dueAt' => $dueAt,
                'warningDays' => $warningDays,
                'billingVersion' => $billingVersion,
                'payment' => $processingPayment,
            ];
        }

        if ($dueDate instanceof \DateTimeImmutable) {
            $warningBoundary = $dueDate->modify('-' . $warningDays . ' days');
            if ($now >= $warningBoundary) {
                return [
                    'state' => 'warning',
                    'writeBlocked' => false,
                    'dueAt' => $dueAt,
                    'warningDays' => $warningDays,
                    'billingVersion' => $billingVersion,
                    'payment' => $processingPayment,
                ];
            }
        }

        return [
            'state' => 'active',
            'writeBlocked' => false,
            'dueAt' => $dueAt,
            'warningDays' => $warningDays,
            'billingVersion' => $billingVersion,
            'payment' => $processingPayment,
        ];
    }

    public function finalizeReadyPayments(): void
    {
        if (!$this->tableExists('service_subscription_payments')) {
            return;
        }

        $now = $this->database->nowUtc();
        $this->database->execute(
            "UPDATE service_subscription_payments
             SET status = 'approved',
                 processed_at = :processed_at,
                 updated_at = :updated_at
             WHERE status = 'processing'
               AND reactivate_at IS NOT NULL
               AND reactivate_at <= :ready_at",
            [
                ':processed_at' => $now,
                ':updated_at' => $now,
                ':ready_at' => $now,
            ]
        );
    }

    private function advanceRecurringCycleIfCovered(): void
    {
        if (
            !$this->tableExists('service_subscription_settings')
            || !$this->tableExists('service_subscription_payments')
        ) {
            return;
        }

        $this->database->transaction(function (): void {
            $settings = $this->database->fetchOne(
                'SELECT * FROM service_subscription_settings LIMIT 1 FOR UPDATE'
            );
            if ($settings === null) {
                return;
            }

            $hasResetScheduleColumns =
                $this->columnExists('service_subscription_settings', 'reset_day_of_month')
                && $this->columnExists('service_subscription_settings', 'reset_time_of_day');
            $settingsId = trim((string) ($settings['id'] ?? ''));
            $dueAt = $this->normalizeDateTimeString($settings['due_at'] ?? null);
            $dueDate = $this->parseDateTime($dueAt);
            if ($settingsId === '' || !$dueDate instanceof \DateTimeImmutable) {
                return;
            }

            $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
            $currentVersion = max(1, (int) ($settings['billing_version'] ?? 1));
            $preferredDayOfMonth = max(
                1,
                min(
                    31,
                    (int) (($hasResetScheduleColumns ? ($settings['reset_day_of_month'] ?? null) : null) ?? (int) $dueDate->format('j'))
                )
            );
            $preferredTimeOfDay = trim((string) (($hasResetScheduleColumns ? ($settings['reset_time_of_day'] ?? null) : null) ?? $dueDate->format('H:i:s')));
            $iterations = 0;

            while ($iterations < 24 && $now >= $dueDate) {
                $approvedPayment = $this->database->fetchOne(
                    "SELECT id
                     FROM service_subscription_payments
                     WHERE billing_version = :billing_version
                       AND status = 'approved'
                     ORDER BY processed_at DESC, submitted_at DESC
                     LIMIT 1",
                    [':billing_version' => $currentVersion]
                );
                if ($approvedPayment === null) {
                    return;
                }

                $nextDueDate = $this->advanceMonthlyReset($dueDate, $preferredDayOfMonth, $preferredTimeOfDay);
                if ($nextDueDate->getTimestamp() <= $dueDate->getTimestamp()) {
                    return;
                }

                $currentVersion++;
                $dueDate = $nextDueDate;
                $sql = "UPDATE service_subscription_settings
                        SET due_at = :due_at, ";
                $params = [
                    ':due_at' => $dueDate->format('Y-m-d H:i:s'),
                    ':billing_version' => $currentVersion,
                    ':updated_at' => $this->database->nowUtc(),
                    ':id' => $settingsId,
                ];
                if ($hasResetScheduleColumns) {
                    $sql .= 'reset_day_of_month = :reset_day_of_month,
                             reset_time_of_day = :reset_time_of_day, ';
                    $params[':reset_day_of_month'] = $preferredDayOfMonth;
                    $params[':reset_time_of_day'] = $preferredTimeOfDay;
                }
                $sql .= 'billing_version = :billing_version,
                         updated_at = :updated_at
                         WHERE id = :id';

                $this->database->execute($sql, $params);

                $iterations++;
            }
        });
    }

    private function tableExists(string $table): bool
    {
        if (array_key_exists($table, $this->tableExistsCache)) {
            return $this->tableExistsCache[$table];
        }

        $row = $this->database->fetchOne(
            'SELECT 1 AS present
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = :table
             LIMIT 1',
            [':table' => $table]
        );

        $this->tableExistsCache[$table] = $row !== null;
        return $this->tableExistsCache[$table];
    }

    private function columnExists(string $table, string $column): bool
    {
        $cacheKey = $table . '.' . $column;
        if (array_key_exists($cacheKey, $this->columnExistsCache)) {
            return $this->columnExistsCache[$cacheKey];
        }

        $row = $this->database->fetchOne(
            'SELECT 1 AS present
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = :table
               AND COLUMN_NAME = :column
             LIMIT 1',
            [
                ':table' => $table,
                ':column' => $column,
            ]
        );

        $this->columnExistsCache[$cacheKey] = $row !== null;
        return $this->columnExistsCache[$cacheKey];
    }

    private function normalizeDateTimeString($value): ?string
    {
        $trimmed = trim((string) ($value ?? ''));
        if ($trimmed === '') {
            return null;
        }

        $dateTime = $this->parseDateTime($trimmed);
        return $dateTime instanceof \DateTimeImmutable
            ? $dateTime->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d H:i:s')
            : null;
    }

    private function parseDateTime(?string $value): ?\DateTimeImmutable
    {
        $trimmed = trim((string) ($value ?? ''));
        if ($trimmed === '') {
            return null;
        }

        try {
            return new \DateTimeImmutable($trimmed, new \DateTimeZone('UTC'));
        } catch (\Exception) {
            return null;
        }
    }

    private function advanceMonthlyReset(
        \DateTimeImmutable $currentDueDate,
        int $preferredDayOfMonth,
        string $preferredTimeOfDay
    ): \DateTimeImmutable
    {
        $year = (int) $currentDueDate->format('Y');
        $month = (int) $currentDueDate->format('n');

        $targetMonth = $month + 1;
        $targetYear = $year;
        if ($targetMonth > 12) {
            $targetMonth = 1;
            $targetYear++;
        }

        $lastDayOfTargetMonth = cal_days_in_month(CAL_GREGORIAN, $targetMonth, $targetYear);
        $targetDay = min(max(1, $preferredDayOfMonth), $lastDayOfTargetMonth);

        [$hour, $minute, $second] = $this->parseTimeParts($preferredTimeOfDay, $currentDueDate);

        return $currentDueDate
            ->setDate($targetYear, $targetMonth, $targetDay)
            ->setTime($hour, $minute, $second);
    }

    /**
     * @return array{0:int, 1:int, 2:int}
     */
    private function parseTimeParts(string $timeOfDay, \DateTimeImmutable $fallback): array
    {
        $parts = explode(':', trim($timeOfDay));
        if (count($parts) >= 2) {
            $hour = max(0, min(23, (int) $parts[0]));
            $minute = max(0, min(59, (int) $parts[1]));
            $second = max(0, min(59, (int) ($parts[2] ?? 0)));
            return [$hour, $minute, $second];
        }

        return [
            (int) $fallback->format('H'),
            (int) $fallback->format('i'),
            (int) $fallback->format('s'),
        ];
    }
}
