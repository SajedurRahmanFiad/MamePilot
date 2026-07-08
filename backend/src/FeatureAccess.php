<?php

declare(strict_types=1);

namespace App;

final class FeatureAccess
{
    private const DEFAULT_CAPABILITIES = [
        'dashboard' => true,
        'inventory' => true,
        'sales' => true,
        'recycle_bin_undoer' => true,
        'purchases' => true,
        'banking' => true,
        'human_resources' => true,
        'advanced_reports' => true,
        'fraud_checker' => true,
        'whitelabel' => false,
        'custom_roles' => true,
        'courier_automation' => true,
        'marketing' => false,
        'enterprise_ai_agent' => false,
    ];

    private const ACTION_CAPABILITIES = [
        'fetchDashboardSnapshot' => 'dashboard',
        'fetchProducts' => 'inventory',
        'fetchProductById' => 'inventory',
        'fetchProductImagesByIds' => 'inventory',
        'fetchProductsPage' => 'inventory',
        'fetchProductsMini' => 'inventory',
        'fetchProductsSearch' => 'inventory',
        'createProduct' => 'inventory',
        'updateProduct' => 'inventory',
        'deleteProduct' => 'inventory',
        'fetchOrders' => 'sales',
        'fetchOrderById' => 'sales',
        'fetchOrdersPage' => 'sales',
        'fetchOrdersByCustomerId' => 'sales',
        'fetchOrderSearchPreview' => 'sales',
        'fetchOrderByNumber' => 'sales',
        'getNextOrderNumber' => 'sales',
        'createOrder' => 'sales',
        'updateOrder' => 'sales',
        'deleteOrder' => 'sales',
        'completePickedOrder' => 'sales',
        'fetchCustomers' => 'sales',
        'fetchCustomerById' => 'sales',
        'fetchCustomersPage' => 'sales',
        'fetchCustomersMini' => 'sales',
        'createCustomer' => 'sales',
        'updateCustomer' => 'sales',
        'deleteCustomer' => 'sales',
        'fetchBills' => 'purchases',
        'fetchBillById' => 'purchases',
        'fetchBillsPage' => 'purchases',
        'fetchBillsByVendorId' => 'purchases',
        'getNextBillNumber' => 'purchases',
        'createBill' => 'purchases',
        'updateBill' => 'purchases',
        'deleteBill' => 'purchases',
        'fetchVendors' => 'purchases',
        'fetchVendorById' => 'purchases',
        'fetchVendorsPage' => 'purchases',
        'createVendor' => 'purchases',
        'updateVendor' => 'purchases',
        'deleteVendor' => 'purchases',
        'fetchAccounts' => 'banking',
        'fetchAccountById' => 'banking',
        'createAccount' => 'banking',
        'updateAccount' => 'banking',
        'deleteAccount' => 'banking',
        'fetchTransactions' => 'banking',
        'fetchTransactionById' => 'banking',
        'fetchTransactionsPage' => 'banking',
        'createTransaction' => 'banking',
        'updateTransaction' => 'banking',
        'deleteTransaction' => 'banking',
        'reviewTransactionApproval' => 'banking',
        'fetchUsers' => 'human_resources',
        'fetchUsersPage' => 'human_resources',
        'fetchUsersMini' => 'human_resources',
        'fetchUserById' => 'human_resources',
        'fetchUserByPhone' => 'human_resources',
        'createUser' => 'human_resources',
        'updateUser' => 'human_resources',
        'deleteUser' => 'human_resources',
        'fetchPayrollSettings' => 'human_resources',
        'updateWalletSettings' => 'human_resources',
        'fetchPayrollEmployees' => 'human_resources',
        'fetchPayrollHistory' => 'human_resources',
        'fetchPayrollSummaries' => 'human_resources',
        'markPayrollPaid' => 'human_resources',
        'fetchEmployeeWalletCards' => 'human_resources',
        'fetchEmployeeWalletCardsPage' => 'human_resources',
        'fetchMyWalletBalance' => 'human_resources',
        'fetchWalletActivityPage' => 'human_resources',
        'payEmployeeWallet' => 'human_resources',
        'deleteEmployeeWalletPayout' => 'human_resources',
        'fetchIncomeSummaryReport' => 'advanced_reports',
        'fetchExpenseSummaryReport' => 'advanced_reports',
        'fetchExpenseSummaryCsv' => 'advanced_reports',
        'fetchIncomeVsExpenseReport' => 'advanced_reports',
        'fetchProfitLossReport' => 'advanced_reports',
        'fetchProductQuantitySoldReport' => 'advanced_reports',
        'fetchCustomerSalesReport' => 'advanced_reports',
        'fetchUserActivityPerformanceReportPage' => 'advanced_reports',
        'fetchUserActivityPerformanceLog' => 'advanced_reports',
        'fetchRecycleBinItems' => 'recycle_bin_undoer',
        'fetchRecycleBinPage' => 'recycle_bin_undoer',
        'restoreDeletedItem' => 'recycle_bin_undoer',
        'permanentlyDeleteDeletedItem' => 'recycle_bin_undoer',
        'revertOrderStatus' => 'recycle_bin_undoer',
        'checkFraudCourierHistory' => 'fraud_checker',
        'submitCarryBeeOrder' => 'courier_automation',
        'submitPaperflyOrder' => 'courier_automation',
        'submitSteadfastOrder' => 'courier_automation',
        'fetchSteadfastStatusByTrackingCode' => 'courier_automation',
        'syncCarryBeeTransferStatuses' => 'courier_automation',
        'syncPaperflyOrderStatuses' => 'courier_automation',
        'syncSteadfastDeliveryStatuses' => 'courier_automation',
        'updatePermissionsSettings' => 'custom_roles',
        'fetchAgentSettings' => 'enterprise_ai_agent',
        'updateAgentSettings' => 'enterprise_ai_agent',
        'mameChat' => 'enterprise_ai_agent',
        'fetchAgentRunStream' => 'enterprise_ai_agent',
        'startAgentRun' => 'enterprise_ai_agent',
        'agentRunStream' => 'enterprise_ai_agent',
    ];

    private Database $database;
    private Auth $auth;

    public function __construct(Database $database, Auth $auth)
    {
        $this->database = $database;
        $this->auth = $auth;
    }

    public static function defaultCapabilities(): array
    {
        return self::DEFAULT_CAPABILITIES;
    }

    public function assertActionAllowed(string $action, array $payload = []): void
    {
        if ($action === 'updateCourierSettings') {
            $this->assertCourierSettingsAllowed($payload);
            return;
        }

        $capability = self::ACTION_CAPABILITIES[$action] ?? null;
        if ($capability === null) {
            return;
        }

        $user = $this->auth->requireUser();
        if (trim((string) ($user['role'] ?? '')) === 'Developer') {
            return;
        }

        $capabilities = $this->fetchCapabilities();
        if (!empty($capabilities[$capability])) {
            return;
        }

        throw new ApiException('This feature is not enabled for this installation.', 403, 'FEATURE_LOCKED', [
            'capability' => $capability,
        ]);
    }

    private function assertCourierSettingsAllowed(array $payload): void
    {
        $user = $this->auth->requireUser();
        if (trim((string) ($user['role'] ?? '')) === 'Developer') {
            return;
        }

        $capabilities = $this->fetchCapabilities();
        $hasCourierPayload = isset($payload['steadfast']) || isset($payload['carryBee']) || isset($payload['paperfly']);
        $hasFraudPayload = isset($payload['fraudChecker']);

        if ($hasCourierPayload && empty($capabilities['courier_automation'])) {
            throw new ApiException('Courier automation is not enabled for this installation.', 403, 'FEATURE_LOCKED', [
                'capability' => 'courier_automation',
            ]);
        }

        if ($hasFraudPayload && empty($capabilities['fraud_checker'])) {
            throw new ApiException('Fraud Checker is not enabled for this installation.', 403, 'FEATURE_LOCKED', [
                'capability' => 'fraud_checker',
            ]);
        }
    }

    public function fetchCapabilities(): array
    {
        if (!$this->tableExists('app_capability_settings')) {
            return self::DEFAULT_CAPABILITIES;
        }

        $row = $this->database->fetchOne('SELECT capabilities FROM app_capability_settings LIMIT 1');
        $decoded = [];
        if ($row !== null && trim((string) ($row['capabilities'] ?? '')) !== '') {
            $candidate = json_decode((string) $row['capabilities'], true);
            $decoded = is_array($candidate) ? $candidate : [];
        }

        $capabilities = self::DEFAULT_CAPABILITIES;
        foreach ($capabilities as $key => $default) {
            if (array_key_exists($key, $decoded)) {
                $capabilities[$key] = (bool) $decoded[$key];
            }
        }

        return $capabilities;
    }

    private function tableExists(string $table): bool
    {
        $row = $this->database->fetchOne(
            'SELECT 1 AS present
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = :table
             LIMIT 1',
            [':table' => $table]
        );

        return $row !== null;
    }
}
