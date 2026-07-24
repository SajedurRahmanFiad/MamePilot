<?php

declare(strict_types=1);

namespace App;

final class FeatureAccess
{
    private const DEFAULT_CAPABILITIES = [
        'dashboard' => true,
        'inventory' => true,
        'sales' => true,
        'recycle_bin_undoer' => false,
        'purchases' => false,
        'banking' => false,
        'human_resources' => false,
        'advanced_reports' => false,
        'fraud_checker' => false,
        'whitelabel' => false,
        'custom_roles' => false,
        'courier_automation' => false,
        'marketing' => false,
        'enterprise_ai_agent' => false,
        'grow_your_business' => false,
        'be_smart' => false,
        'whatsapp' => false,
        'messenger' => false,
        'automatic_leads' => false,
        'mamecx' => false,
        'auto_calling' => false,
        'woocommerce' => false,
    ];

    // Maps sub-capability keys to their parent capability keys
    private const SUB_CAPABILITY_PARENTS = [
        'hr_management' => 'human_resources',
        'payroll' => 'human_resources',
        'accounts' => 'banking',
        'transactions' => 'banking',
        'transfer' => 'banking',
        'steadfast_courier' => 'courier_automation',
        'carrybee_courier' => 'courier_automation',
        'paperfly_courier' => 'courier_automation',
        'pathao_courier' => 'courier_automation',
        'recycle_bin' => 'recycle_bin_undoer',
        'undoer' => 'recycle_bin_undoer',
    ];

    private const ACTION_CAPABILITIES = [
        'fetchDashboardSnapshot' => 'dashboard',
        'fetchProducts' => 'inventory',
        'fetchProductById' => 'inventory',
        'fetchProductImagesByIds' => 'inventory',
        'fetchProductsPage' => 'inventory',
        'fetchProductFilterOptions' => 'inventory',
        'fetchProductsMini' => 'inventory',
        'fetchProductsSearch' => 'inventory',
        'createProduct' => 'inventory',
        'updateProduct' => 'inventory',
        'deleteProduct' => 'inventory',
        'fetchOrders' => 'sales',
        'fetchOrderById' => 'sales',
        'fetchOrdersPage' => 'sales',
        'fetchOrderFilterOptions' => 'sales',
        'fetchOrdersByCustomerId' => 'sales',
        'fetchOrderSearchPreview' => 'sales',
        'fetchOrderByNumber' => 'sales',
        'getNextOrderNumber' => 'sales',
        'createOrder' => 'sales',
        'updateOrder' => 'sales',
        'deleteOrder' => 'sales',
        'completePickedOrder' => 'sales',
        'fetchCustomers' => 'sales',
        'fetchLeadsPage' => 'automatic_leads',
        'fetchLeadById' => 'automatic_leads',
        'fetchLeadIntelligence' => 'automatic_leads',
        'analyzeLead' => 'automatic_leads',
        'fetchLeadEvents' => 'automatic_leads',
        'markLeadSuggestionSent' => 'automatic_leads',
        'fetchCustomerById' => 'sales',
        'fetchCustomersPage' => 'sales',
        'fetchCustomerFilterOptions' => 'sales',
        'fetchCustomersMini' => 'sales',
        'createCustomer' => 'sales',
        'updateCustomer' => 'sales',
        'deleteCustomer' => 'sales',
        'fetchBills' => 'purchases',
        'fetchBillById' => 'purchases',
        'fetchBillsPage' => 'purchases',
        'fetchBillFilterOptions' => 'purchases',
        'fetchBillsByVendorId' => 'purchases',
        'getNextBillNumber' => 'purchases',
        'createBill' => 'purchases',
        'updateBill' => 'purchases',
        'deleteBill' => 'purchases',
        'fetchVendors' => 'purchases',
        'fetchVendorById' => 'purchases',
        'fetchVendorsPage' => 'purchases',
        'fetchVendorFilterOptions' => 'purchases',
        'createVendor' => 'purchases',
        'updateVendor' => 'purchases',
        'deleteVendor' => 'purchases',
        'fetchAccounts' => 'accounts',
        'fetchAccountById' => 'accounts',
        'createAccount' => 'accounts',
        'updateAccount' => 'accounts',
        'deleteAccount' => 'accounts',
        'fetchTransactions' => 'transactions',
        'fetchTransactionById' => 'transactions',
        'fetchTransactionsPage' => 'transactions',
        'fetchTransactionFilterOptions' => 'transactions',
        'createTransaction' => 'transactions',
        'createTransfer' => 'transfer',
        'updateTransaction' => 'transactions',
        'deleteTransaction' => 'transactions',
        'reviewTransactionApproval' => 'transactions',
        'fetchUsers' => 'hr_management',
        'fetchUsersPage' => 'hr_management',
        'fetchUsersMini' => 'hr_management',
        'fetchUserById' => 'hr_management',
        'fetchUserByPhone' => 'hr_management',
        'createUser' => 'hr_management',
        'updateUser' => 'hr_management',
        'deleteUser' => 'hr_management',
        'fetchPayrollSettings' => 'payroll',
        'updatePayrollSettings' => 'payroll',
        'fetchWalletSettings' => 'payroll',
        'updateWalletSettings' => 'payroll',
        'fetchPayrollEmployees' => 'payroll',
        'fetchPayrollHistory' => 'payroll',
        'fetchPayrollSummaries' => 'payroll',
        'markPayrollPaid' => 'payroll',
        'fetchEmployeeWalletCards' => 'payroll',
        'fetchEmployeeWalletCardsPage' => 'payroll',
        'fetchMyWallet' => 'payroll',
        'fetchMyWalletBalance' => 'payroll',
        'fetchWalletActivity' => 'payroll',
        'fetchWalletActivityPage' => 'payroll',
        'payEmployeeWallet' => 'payroll',
        'deleteEmployeeWalletPayout' => 'payroll',
        'fetchIncomeSummaryReport' => 'advanced_reports',
        'fetchExpenseSummaryReport' => 'advanced_reports',
        'fetchExpenseSummaryCsv' => 'advanced_reports',
        'fetchIncomeVsExpenseReport' => 'advanced_reports',
        'fetchProfitLossReport' => 'advanced_reports',
        'fetchProductQuantitySoldReport' => 'advanced_reports',
        'fetchCustomerSalesReport' => 'advanced_reports',
        'fetchUserActivityPerformanceReportPage' => 'advanced_reports',
        'fetchUserActivityPerformanceLog' => 'advanced_reports',
        'fetchRecycleBinItems' => 'recycle_bin',
        'fetchRecycleBinPage' => 'recycle_bin',
        'fetchRecycleBinFilterOptions' => 'recycle_bin',
        'restoreDeletedItem' => 'recycle_bin',
        'permanentlyDeleteDeletedItem' => 'recycle_bin',
        'fetchOrderUndoPlan' => 'undoer',
        'revertOrderStatus' => 'undoer',
        'checkFraudCourierHistory' => 'fraud_checker',
        'submitCarryBeeOrder' => 'carrybee_courier',
        'submitPaperflyOrder' => 'paperfly_courier',
        'submitSteadfastOrder' => 'steadfast_courier',
        'fetchSteadfastStatusByTrackingCode' => 'steadfast_courier',
        'syncCarryBeeTransferStatuses' => 'carrybee_courier',
        'syncPaperflyOrderStatuses' => 'paperfly_courier',
        'syncSteadfastDeliveryStatuses' => 'steadfast_courier',
        'submitPathaoOrder' => 'pathao_courier',
        'generatePathaoToken' => 'pathao_courier',
        'refreshPathaoToken' => 'pathao_courier',
        'syncPathaoDeliveryStatuses' => 'pathao_courier',
        'fetchPathaoOrderInfo' => 'pathao_courier',
        'updatePermissionsSettings' => 'custom_roles',
        'fetchAgentSettings' => 'enterprise_ai_agent',
        'updateAgentSettings' => 'enterprise_ai_agent',
        'mameChat' => 'enterprise_ai_agent',
        'legacyMameChat' => 'enterprise_ai_agent',
        'fetchAgentRunStream' => 'enterprise_ai_agent',
        'startAgentRun' => 'enterprise_ai_agent',
        'agentRunStream' => 'enterprise_ai_agent',
        'fetchAgentRunEvents' => 'enterprise_ai_agent',
        'streamAgentRunEvents' => 'enterprise_ai_agent',
        'cancelAgentRun' => 'enterprise_ai_agent',
        'confirmAgentActionBundle' => 'enterprise_ai_agent',
        'rejectAgentActionBundle' => 'enterprise_ai_agent',
        'fetchAgentConversations' => 'enterprise_ai_agent',
        'fetchAgentConversation' => 'enterprise_ai_agent',
        'createAgentAttachment' => 'enterprise_ai_agent',
        'fetchBusinessRecommendations' => 'grow_your_business',
        'refreshBusinessRecommendations' => 'grow_your_business',
        'fetchBusinessGrowthSettings' => 'grow_your_business',
        'updateBusinessGrowthSettings' => 'grow_your_business',
        'fetchBeSmartSettings' => 'be_smart',
        'updateBeSmartSettings' => 'be_smart',
        'fetchVoiceSurveySettings' => 'auto_calling',
        'updateVoiceSurveySettings' => 'auto_calling',
        'fetchVoiceSurveyIntegrationSettings' => 'auto_calling',
        'updateVoiceSurveyIntegrationSettings' => 'auto_calling',
        'triggerSurveyCall' => 'auto_calling',
        'retrySurveyCall' => 'auto_calling',
        'cancelSurveyCall' => 'auto_calling',
        'fetchOrderSurveyStatus' => 'auto_calling',
        'fetchSurveyBalance' => 'auto_calling',
        'fetchSurveyHistory' => 'auto_calling',
        'fetchSurveyBroadcasts' => 'auto_calling',
        'fetchSurveySummary' => 'auto_calling',
        'initiateRechargeCheckout' => 'auto_calling',
        'fetchRechargeHistory' => 'auto_calling',
        'fetchWhatsAppSettings' => 'whatsapp',
        'updateWhatsAppSettings' => 'whatsapp',
        'updateWhatsAppWelcomeExperience' => 'whatsapp',
        'testWhatsAppConnection' => 'whatsapp',
        'fetchWhatsAppContacts' => 'whatsapp',
        'fetchWhatsAppMessages' => 'whatsapp',
        'createWhatsAppConversation' => 'whatsapp',
        'markWhatsAppConversationRead' => 'whatsapp',
        'sendWhatsAppMessage' => 'whatsapp',
        'sendWhatsAppMediaMessage' => 'whatsapp',
        'fetchWhatsAppTemplates' => 'whatsapp',
        'sendWhatsAppTemplate' => 'whatsapp',
        'fetchMessengerSettings' => 'messenger',
        'updateMessengerSettings' => 'messenger',
        'testMessengerConnection' => 'messenger',
        'subscribeMessengerPage' => 'messenger',
        'fetchMessengerProfile' => 'messenger',
        'updateMessengerProfile' => 'messenger',
        'fetchMessengerContacts' => 'messenger',
        'fetchMessengerMessages' => 'messenger',
        'markMessengerConversationRead' => 'messenger',
        'sendMessengerMessage' => 'messenger',
        'sendMessengerMediaMessage' => 'messenger',
        'sendMessengerQuickReplies' => 'messenger',
        'sendMessengerCard' => 'messenger',
        'sendMessengerReaction' => 'messenger',
        'sendMessengerSenderAction' => 'messenger',
        'fetchWooCommerceStores' => 'woocommerce',
        'saveWooCommerceStore' => 'woocommerce',
        'deleteWooCommerceStore' => 'woocommerce',
        'testWooCommerceStore' => 'woocommerce',
        'registerWooCommerceWebhook' => 'woocommerce',
        'syncWooCommerceOrders' => 'woocommerce',
        'checkWebhookHealth' => 'woocommerce',
        'repairWebhook' => 'woocommerce',
        'fetchMetaAdsConnectionStatus' => 'marketing',
        'fetchMetaAdsSyncCache' => 'marketing',
        'fetchMetaAdsSyncStatus' => 'marketing',
        'fetchMetaAds' => 'marketing',
        'fetchMetaAdById' => 'marketing',
        'fetchMetaAdsFilters' => 'marketing',
        'fetchMetaAdInsightsDaily' => 'marketing',
        'fetchMetaAdInsightsDemographics' => 'marketing',
        'fetchMetaAdInsightsPlacements' => 'marketing',
        'fetchMetaAdInsightsDevices' => 'marketing',
        'fetchMarketingDashboard' => 'marketing',
        'syncMetaAds' => 'marketing',
        'submitCarryBeeExchangeOrder' => 'carrybee_courier',
        'fetchCarryBeeOrderDetails' => 'carrybee_courier',
        'submitPaperflyExchangeOrder' => 'paperfly_courier',
        'fetchPaperflyOrderTracking' => 'paperfly_courier',
        'syncExchangeConsignmentStatuses' => 'courier_automation',
        'processCustomerFraudCheck' => 'fraud_checker',
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

        // Check if this is a sub-capability
        $parentKey = self::SUB_CAPABILITY_PARENTS[$capability] ?? null;
        if ($parentKey !== null) {
            // Parent capability must be enabled
            if (empty($capabilities[$parentKey])) {
                throw new ApiException('This feature is not enabled for this installation.', 403, 'FEATURE_LOCKED', [
                    'capability' => $parentKey,
                ]);
            }
            // Check sub-capability override (stored in capabilities.subCapabilities)
            $subCapabilities = $capabilities['subCapabilities'] ?? [];
            if (is_array($subCapabilities) && array_key_exists($capability, $subCapabilities) && $subCapabilities[$capability] === false) {
                throw new ApiException('This feature is not enabled for this installation.', 403, 'FEATURE_LOCKED', [
                    'capability' => $capability,
                ]);
            }
            return;
        }

        // Regular capability check
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
        $subCapabilities = $capabilities['subCapabilities'] ?? [];
        if (!is_array($subCapabilities)) {
            $subCapabilities = [];
        }
        $hasCourierPayload = isset($payload['steadfast']) || isset($payload['carryBee']) || isset($payload['paperfly']) || isset($payload['pathao']);
        $hasFraudPayload = isset($payload['fraudChecker']);

        if ($hasCourierPayload && empty($capabilities['courier_automation'])) {
            throw new ApiException('Courier automation is not enabled for this installation.', 403, 'FEATURE_LOCKED', [
                'capability' => 'courier_automation',
            ]);
        }

        // Check individual courier sub-capabilities for settings
        if (isset($payload['steadfast']) && !empty($capabilities['courier_automation']) && ($subCapabilities['steadfast_courier'] ?? true) === false) {
            throw new ApiException('Steadfast courier is not enabled for this installation.', 403, 'FEATURE_LOCKED', [
                'capability' => 'steadfast_courier',
            ]);
        }
        if (isset($payload['carryBee']) && !empty($capabilities['courier_automation']) && ($subCapabilities['carrybee_courier'] ?? true) === false) {
            throw new ApiException('CarryBee courier is not enabled for this installation.', 403, 'FEATURE_LOCKED', [
                'capability' => 'carrybee_courier',
            ]);
        }
        if (isset($payload['paperfly']) && !empty($capabilities['courier_automation']) && ($subCapabilities['paperfly_courier'] ?? true) === false) {
            throw new ApiException('Paperfly courier is not enabled for this installation.', 403, 'FEATURE_LOCKED', [
                'capability' => 'paperfly_courier',
            ]);
        }
        if (isset($payload['pathao']) && !empty($capabilities['courier_automation']) && ($subCapabilities['pathao_courier'] ?? true) === false) {
            throw new ApiException('Pathao courier is not enabled for this installation.', 403, 'FEATURE_LOCKED', [
                'capability' => 'pathao_courier',
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

        $decodedSubCapabilities = $decoded['subCapabilities'] ?? null;
        if (is_array($decodedSubCapabilities)) {
            $subCapabilities = [];
            foreach (self::SUB_CAPABILITY_PARENTS as $key => $_parent) {
                if (array_key_exists($key, $decodedSubCapabilities) && is_bool($decodedSubCapabilities[$key])) {
                    $subCapabilities[$key] = $decodedSubCapabilities[$key];
                }
            }
            if ($subCapabilities !== []) {
                $capabilities['subCapabilities'] = $subCapabilities;
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
