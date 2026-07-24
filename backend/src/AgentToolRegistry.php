<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class AgentToolRegistry
{
    public function __construct(
        private Database $database,
        private Auth $auth,
        private Config $config,
        private BusinessActionDispatcher $dispatcher,
    ) {
    }

    /** @return array<int, array<string, mixed>> */
    public function definitions(array $domains = []): array
    {
        $wanted = array_fill_keys(array_map(static fn($value): string => strtolower(trim((string) $value)), $domains), true);
        $definitions = [];
        foreach ($this->metaDefinitions() as $definition) {
            if ($this->isDefinitionAllowed($definition)) $definitions[] = $definition;
        }
        foreach ($this->catalog() as $definition) {
            if ($wanted !== [] && !isset($wanted[$definition['namespace']])) continue;
            $backendAction = trim((string) ($definition['backendAction'] ?? ''));
            if ($backendAction !== '' && !$this->dispatcher->hasAction($backendAction)) continue;
            if (!$this->isDefinitionAllowed($definition)) continue;
            $definitions[] = $definition;
        }
        return $definitions;
    }

    /** @return array<int, array<string, mixed>> */
    public function modelDefinitions(array $domains = []): array
    {
        return array_map(static fn(array $definition): array => [
            'name' => $definition['name'],
            'description' => $definition['description'],
            'inputSchema' => $definition['inputSchema'],
        ], $this->definitions($domains));
    }

    public function find(string $toolName): ?array
    {
        foreach ($this->definitions([]) as $definition) {
            if (($definition['name'] ?? '') === $toolName) return $definition;
        }
        return null;
    }

    /** @return array<int, array<string, mixed>> */
    public function discover(string $query, int $limit = 12): array
    {
        $needle = strtolower(trim($query));
        $matches = [];
        foreach ($this->definitions([]) as $definition) {
            if (in_array($definition['name'], ['discover_tools', 'describe_tool'], true)) continue;
            $haystack = strtolower($definition['name'] . ' ' . $definition['namespace'] . ' ' . $definition['description']);
            if ($needle === '' || str_contains($haystack, $needle)) {
                $matches[] = [
                    'name' => $definition['name'],
                    'namespace' => $definition['namespace'],
                    'description' => $definition['description'],
                    'classification' => $definition['classification'],
                    'activityLabel' => $definition['activityLabel'],
                ];
            }
        }
        return array_slice($matches, 0, max(1, min(30, $limit)));
    }

    public function validateArguments(array $definition, array $arguments): array
    {
        $schema = is_array($definition['inputSchema'] ?? null) ? $definition['inputSchema'] : ['type' => 'object'];
        $this->validateValue($arguments, $schema, 'arguments');
        return $arguments;
    }

    /** @return array<string, mixed> */
    public function executeRead(array $definition, array $arguments, string $runId, string $toolCallId, array $settings): array
    {
        $this->assertAllowed($definition);
        $name = (string) $definition['name'];
        if ($name === 'discover_tools') {
            return ['tools' => $this->discover((string) ($arguments['query'] ?? ''), (int) ($arguments['limit'] ?? 12))];
        }
        if ($name === 'describe_tool') {
            $target = $this->find((string) ($arguments['name'] ?? ''));
            if ($target === null) throw new RuntimeException('That tool is not available to this user.');
            return ['tool' => [
                'name' => $target['name'],
                'namespace' => $target['namespace'],
                'description' => $target['description'],
                'classification' => $target['classification'],
                'inputSchema' => $target['inputSchema'],
                'confirmationRequired' => $target['confirmationRequired'],
            ]];
        }
        if ($name === 'request_clarification') {
            return ['needsInput' => true, 'question' => trim((string) ($arguments['question'] ?? 'Please provide the missing information.'))];
        }
        if ($name === 'query_business_data') {
            $user = $this->auth->requireUser();
            $guard = new AgentSqlGuard($this->database);
            $datasets = $this->allowedDatasets();
            $columns = $guard->datasetColumns(array_keys($datasets));
            return $guard->execute(
                (string) ($arguments['sql'] ?? ''),
                $columns,
                (string) $user['id'],
                $runId,
                $toolCallId,
                (int) ($settings['query_row_limit'] ?? 100),
                (int) ($settings['query_timeout_ms'] ?? 15000),
                (int) ($settings['query_max_columns'] ?? 30),
                (int) ($settings['query_max_bytes'] ?? 100000),
            );
        }

        if ($name === 'inventory_analyze_low_stock') {
            return $this->analyzeLowStock($arguments);
        }
        if ($name === 'inventory_compare_stock') {
            return $this->compareInventoryStock($arguments);
        }

        $backendAction = (string) ($definition['backendAction'] ?? '');
        $arguments['agentReadOnly'] = true;
        if (str_starts_with($backendAction, 'fetchMeta') || $backendAction === 'fetchMarketingDashboard') {
            // Normal dashboard reads may start an automatic provider sync or
            // schema repair. Agent reads stay local and read-only; refreshes
            // and synchronization have explicitly confirmed action tools.
            $arguments['skipSchemaEnsure'] = true;
        }
        if (in_array($backendAction, ['fetchMetaAds', 'fetchMarketingDashboard'], true)) $arguments['skipAutoSync'] = true;
        if (in_array($backendAction, ['fetchMetaAdInsightsDaily', 'fetchMetaAdInsightsDemographics', 'fetchMetaAdInsightsPlacements', 'fetchMetaAdInsightsDevices'], true)) {
            $arguments['skipRemoteFetch'] = true;
        }
        $this->assertModuleInfrastructureReady($backendAction);
        $result = $this->dispatcher->dispatch($backendAction, $arguments);
        return $this->compactResult($result);
    }

    /** @return array<string, mixed> */
    public function preflightAction(array $definition, array $arguments): array
    {
        $this->assertAllowed($definition);
        if (($definition['classification'] ?? '') !== 'action') throw new RuntimeException('This is not an action tool.');
        $action = (string) ($definition['backendAction'] ?? '');
        $modelArguments = $arguments;
        if (in_array($action, ['sendWhatsAppMediaMessage', 'sendMessengerMediaMessage'], true)) unset($modelArguments['attachmentId']);
        if (in_array($action, ['createCustomer', 'createVendor', 'createProduct', 'createCategory', 'createUnit', 'createAccount', 'createOrder', 'createBill', 'createTransaction', 'createTransfer'], true)) unset($modelArguments['id']);
        $this->validateArguments($definition, $modelArguments);

        if ($action === 'createCustomer') $this->assertNoDuplicate('customers', 'phone', (string) ($arguments['phone'] ?? ''), 'customer');
        if ($action === 'createVendor') $this->assertNoDuplicate('vendors', 'phone', (string) ($arguments['phone'] ?? ''), 'vendor');
        if ($action === 'createProduct') $this->assertNoDuplicate('products', 'name', (string) ($arguments['name'] ?? ''), 'product');
        if ($action === 'createUnit') $this->assertNoDuplicate('units', 'short_name', (string) ($arguments['shortName'] ?? ''), 'unit', false);
        if ($action === 'createOrder') $this->preflightDocument($arguments, 'customerId', 'customers', true);
        if ($action === 'createBill') $this->preflightDocument($arguments, 'vendorId', 'vendors', false);
        if ($action === 'createTransfer') $this->preflightTransfer($arguments);
        if (in_array($action, ['sendWhatsAppMediaMessage', 'sendMessengerMediaMessage'], true)) $this->preflightMediaAttachment($arguments);
        if ($action === 'analyzeLead') $this->assertLeadExists((string) ($arguments['leadId'] ?? ''));
        if ($action === 'markLeadSuggestionSent') $this->assertLeadSuggestionExists((string) ($arguments['suggestionId'] ?? ''));
        $this->assertModuleInfrastructureReady($action);
        $this->assertActionReferencesExist($action, $arguments);
        $this->assertReferencedRecordExists($action, $arguments);
        $this->dispatcher->assertActionScope($action, $arguments);

        return [
            'label' => (string) $definition['activityLabel'],
            'toolName' => (string) $definition['name'],
            'version' => (string) $definition['version'],
            'effect' => $this->effectForAction($action),
            'values' => $this->businessPreview($arguments, '', $action),
        ];
    }

    /** @return mixed */
    public function executeAction(array $definition, array $arguments): mixed
    {
        $this->assertAllowed($definition);
        if (($definition['classification'] ?? '') !== 'action') throw new RuntimeException('This is not an action tool.');
        $action = (string) $definition['backendAction'];
        if (in_array($action, ['sendWhatsAppMediaMessage', 'sendMessengerMediaMessage'], true)) {
            $arguments = $this->hydrateMediaAttachment($arguments);
        }
        if ($action === 'analyzeLead') $arguments['suppressOrderCreation'] = true;
        return $this->dispatcher->dispatch($action, $arguments);
    }

    /** @return array<string, mixed> */
    public function compactForModel(mixed $result): array
    {
        return $this->compactResult($result);
    }

    /** @return array<string, array<string, mixed>> */
    public function definitionsByName(array $domains = []): array
    {
        $map = [];
        foreach ($this->definitions($domains) as $definition) $map[(string) $definition['name']] = $definition;
        return $map;
    }

    private function metaDefinitions(): array
    {
        return [
            $this->definition('discover_tools', 'meta', 'Search permitted MamePilot tool namespaces. Use this when the initial domain tools do not cover the goal.', 'read', 'Discovering relevant tools...', null, null, [
                'type' => 'object',
                'properties' => ['query' => ['type' => 'string'], 'limit' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 30]],
                'required' => ['query'],
                'additionalProperties' => false,
            ]),
            $this->definition('describe_tool', 'meta', 'Load the full server-owned input schema for one permitted tool.', 'read', 'Loading tool details...', null, null, [
                'type' => 'object', 'properties' => ['name' => ['type' => 'string']], 'required' => ['name'], 'additionalProperties' => false,
            ]),
            $this->definition('request_clarification', 'meta', 'Stop and ask the user one concise question when required business information is missing.', 'read', 'Preparing a clarification...', null, null, [
                'type' => 'object', 'properties' => ['question' => ['type' => 'string', 'minLength' => 1]], 'required' => ['question'], 'additionalProperties' => false,
            ]),
            $this->definition('query_business_data', 'analysis', 'Fallback-only read query for analysis not efficiently expressible with typed tools. It accepts one restricted SELECT or WITH ... SELECT over permitted business datasets. Never use it when a typed tool can answer the question.', 'read', 'Analyzing permitted business data...', null, null, [
                'type' => 'object', 'properties' => ['sql' => ['type' => 'string', 'minLength' => 1]], 'required' => ['sql'], 'additionalProperties' => false,
            ]),
        ];
    }

    /** @return array<int, array<string, mixed>> */
    private function catalog(): array
    {
        $rows = [];
        $groups = [
            'dashboard' => [
                'capability' => 'dashboard',
                'reads' => ['fetchDashboardSnapshot'],
                'actions' => [],
            ],
            'reports' => [
                'capability' => 'advanced_reports',
                'reads' => ['fetchIncomeSummaryReport', 'fetchExpenseSummaryReport', 'fetchIncomeVsExpenseReport', 'fetchProfitLossReport', 'fetchProductQuantitySoldReport', 'fetchCustomerSalesReport', 'fetchUserActivityPerformanceReportPage', 'fetchUserActivityPerformanceLog'],
                'actions' => [],
            ],
            'sales' => [
                'capability' => 'sales',
                'reads' => ['fetchOrders', 'fetchOrdersPage', 'fetchOrderSearchPreview', 'fetchOrderById', 'fetchOrdersByCustomerId', 'fetchOrderByNumber', 'fetchCustomers', 'fetchCustomersPage', 'fetchCustomersMini', 'fetchCustomerById'],
                'actions' => ['createOrder', 'updateOrder', 'completePickedOrder', 'processOrderReturnExchange', 'deleteOrder', 'createCustomer', 'updateCustomer', 'deleteCustomer'],
            ],
            'leads' => [
                'capability' => 'automatic_leads',
                'reads' => ['fetchLeadsPage', 'fetchLeadById', 'fetchLeadIntelligence', 'fetchLeadEvents'],
                'actions' => ['analyzeLead', 'markLeadSuggestionSent'],
            ],
            'inventory' => [
                'capability' => 'inventory',
                'reads' => ['fetchProducts', 'fetchProductsPage', 'fetchProductsMini', 'fetchProductsSearch', 'fetchProductById', 'fetchCategories', 'fetchCategoriesById', 'fetchUnits', 'fetchUnitById'],
                'actions' => ['createProduct', 'updateProduct', 'deleteProduct', 'createCategory', 'updateCategory', 'createUnit', 'updateUnit'],
            ],
            'purchases' => [
                'capability' => 'purchases',
                'reads' => ['fetchBills', 'fetchBillsPage', 'fetchBillsByVendorId', 'fetchBillById', 'fetchVendors', 'fetchVendorsPage', 'fetchVendorById'],
                'actions' => ['createBill', 'updateBill', 'processBillReturn', 'deleteBill', 'createVendor', 'updateVendor', 'deleteVendor'],
            ],
            'banking' => [
                'capability' => 'banking',
                'reads' => ['fetchAccounts', 'fetchAccountById', 'fetchTransactions', 'fetchTransactionsPage', 'fetchTransactionById'],
                'actions' => ['createAccount', 'updateAccount', 'createTransaction', 'createTransfer', 'updateTransaction', 'reviewTransactionApproval', 'deleteTransaction'],
            ],
            'payroll' => [
                'capability' => 'human_resources',
                'reads' => ['fetchEmployeeOrderCounts', 'fetchPayrollEmployees', 'fetchPayrollHistory', 'fetchPayrollSummaries', 'fetchEmployeeWalletCards', 'fetchEmployeeWalletCardsPage', 'fetchMyWallet', 'fetchWalletActivity', 'fetchWalletActivityPage'],
                'actions' => ['markPayrollPaid', 'payEmployeeWallet'],
            ],
            'whatsapp' => [
                'capability' => 'whatsapp',
                'reads' => ['fetchWhatsAppContacts', 'fetchWhatsAppMessages', 'fetchWhatsAppTemplates'],
                'actions' => ['createWhatsAppConversation', 'markWhatsAppConversationRead', 'sendWhatsAppMessage', 'sendWhatsAppMediaMessage', 'sendWhatsAppTemplate'],
            ],
            'messenger' => [
                'capability' => 'messenger',
                'reads' => ['fetchMessengerContacts', 'fetchMessengerMessages', 'fetchMessengerProfile'],
                'actions' => ['markMessengerConversationRead', 'sendMessengerMessage', 'sendMessengerMediaMessage', 'sendMessengerQuickReplies', 'sendMessengerCard', 'sendMessengerReaction'],
            ],
            'courier' => [
                'capability' => 'courier_automation',
                'reads' => ['fetchCarryBeeStores', 'fetchCarryBeeCities', 'fetchCarryBeeZones', 'fetchCarryBeeAreas', 'fetchCarryBeeOrderDetails', 'fetchSteadfastStatusByTrackingCode', 'fetchPaperflyOrderTracking', 'fetchPathaoOrderInfo'],
                'actions' => ['submitCarryBeeOrder', 'submitCarryBeeExchangeOrder', 'syncCarryBeeTransferStatuses', 'submitSteadfastOrder', 'syncSteadfastDeliveryStatuses', 'submitPaperflyOrder', 'submitPaperflyExchangeOrder', 'syncPaperflyOrderStatuses', 'submitPathaoOrder', 'syncPathaoDeliveryStatuses', 'syncExchangeConsignmentStatuses'],
            ],
            'fraud' => [
                'capability' => 'fraud_checker',
                'reads' => [],
                'actions' => ['processCustomerFraudCheck'],
            ],
            'marketing' => [
                'capability' => 'marketing',
                'reads' => ['fetchMetaAdsConnectionStatus', 'fetchMetaAdsSyncCache', 'fetchMetaAdsSyncStatus', 'fetchMetaAds', 'fetchMetaAdById', 'fetchMetaAdsFilters', 'fetchMetaAdInsightsDaily', 'fetchMetaAdInsightsDemographics', 'fetchMetaAdInsightsPlacements', 'fetchMetaAdInsightsDevices', 'fetchMarketingDashboard'],
                'actions' => ['syncMetaAds'],
            ],
            'woocommerce' => [
                'capability' => 'woocommerce',
                'reads' => ['fetchWooCommerceStores', 'checkWebhookHealth'],
                'actions' => ['syncWooCommerceOrders'],
            ],
            'auto_calling' => [
                'capability' => 'auto_calling',
                'reads' => ['fetchOrderSurveyStatus', 'fetchSurveyBalance', 'fetchSurveyHistory', 'fetchSurveyBroadcasts', 'fetchSurveySummary'],
                'actions' => ['triggerSurveyCall', 'retrySurveyCall', 'cancelSurveyCall'],
            ],
            'recycle_bin' => [
                'capability' => 'recycle_bin_undoer',
                'reads' => ['fetchRecycleBinItems', 'fetchRecycleBinPage'],
                'actions' => ['restoreDeletedItem', 'revertOrderStatus'],
            ],
        ];

        foreach ($groups as $namespace => $group) {
            foreach ($group['reads'] as $action) {
                $rows[] = $this->definition(
                    $this->toolName($namespace, $action),
                    $namespace,
                    $this->descriptionForAction($action, false),
                    'read',
                    $this->activityForAction($action),
                    $action,
                    $this->permissionForAction($action),
                    $this->schemaForAction($action),
                    (string) $group['capability']
                );
            }
            foreach ($group['actions'] as $action) {
                $rows[] = $this->definition(
                    $this->toolName($namespace, $action),
                    $namespace,
                    $this->descriptionForAction($action, true),
                    'action',
                    $this->activityForAction($action),
                    $action,
                    $this->permissionForAction($action),
                    $this->schemaForAction($action),
                    (string) $group['capability']
                );
            }
        }
        $rows[] = $this->definition(
            'inventory_analyze_low_stock',
            'inventory',
            'Analyze permitted active products at or below a selected stock threshold without exposing unrelated columns.',
            'read',
            'Analyzing low-stock products...',
            null,
            'products.view',
            $this->schemaForAction('analyzeLowStock'),
            'inventory'
        );
        $rows[] = $this->definition(
            'inventory_compare_stock',
            'inventory',
            'Compare current quantity, purchase value, and potential sale value for selected products or a category.',
            'read',
            'Comparing inventory stock...',
            null,
            'products.view',
            $this->schemaForAction('compareInventoryStock'),
            'inventory'
        );
        return $rows;
    }

    private function definition(string $name, string $namespace, string $description, string $classification, string $activity, ?string $backendAction, string|array|null $permission, array $schema, ?string $capability = null): array
    {
        return [
            'name' => $name,
            'version' => '1.0.0',
            'namespace' => $namespace,
            'description' => $description,
            'classification' => $classification,
            'activityLabel' => $activity,
            'requiredCapability' => $capability,
            'requiredPermission' => $permission,
            'recordScopePolicy' => 'existing_service',
            'inputSchema' => $schema,
            'confirmationRequired' => $classification === 'action',
            'idempotencyPolicy' => $classification === 'action' ? 'bundle_item_key' : 'none',
            'backendAction' => $backendAction,
        ];
    }

    private function isDefinitionAllowed(array $definition): bool
    {
        try { $this->assertAllowed($definition); return true; } catch (\Throwable) { return false; }
    }

    private function assertAllowed(array $definition): void
    {
        if (($definition['name'] ?? '') === 'query_business_data') {
            $role = trim((string) ($this->auth->requireUser()['role'] ?? ''));
            if (!in_array($role, ['Admin', 'Developer'], true)) {
                throw new RuntimeException('The SQL analysis fallback is restricted to administrators; use scoped domain tools instead.');
            }
        }
        $action = trim((string) ($definition['backendAction'] ?? ''));
        if ($action !== '') (new FeatureAccess($this->database, $this->auth))->assertActionAllowed($action);
        $capability = trim((string) ($definition['requiredCapability'] ?? ''));
        if ($capability !== '') {
            $user = $this->auth->requireUser();
            if ((string) ($user['role'] ?? '') !== 'Developer') {
                $capabilities = (new FeatureAccess($this->database, $this->auth))->fetchCapabilities();
                $parents = [
                    'recycle_bin_undoer' => 'recycle_bin_undoer',
                    'human_resources' => 'human_resources',
                    'banking' => 'banking',
                    'courier_automation' => 'courier_automation',
                ];
                $key = $parents[$capability] ?? $capability;
                if (empty($capabilities[$key])) throw new RuntimeException('This module is not enabled for the installation.');
            }
        }
        $permission = $definition['requiredPermission'] ?? null;
        if ($permission !== null && !$this->hasPermission($permission)) {
            throw new RuntimeException('The current user does not have permission to use this tool.');
        }
        $adminOnly = [
            'createAccount', 'updateAccount', 'createCategory', 'updateCategory', 'createUnit', 'updateUnit',
            'fetchRecycleBinItems', 'fetchRecycleBinPage', 'restoreDeletedItem',
            'triggerSurveyCall', 'retrySurveyCall', 'cancelSurveyCall', 'syncMetaAds', 'syncWooCommerceOrders',
            'fetchSurveyBalance', 'fetchSurveyHistory', 'fetchSurveyBroadcasts', 'fetchSurveySummary',
            'fetchWooCommerceStores', 'checkWebhookHealth', 'fetchMetaAdsConnectionStatus',
            'fetchMessengerProfile',
            'fetchUserActivityPerformanceReportPage', 'fetchUserActivityPerformanceLog',
            'syncCarryBeeTransferStatuses', 'syncPaperflyOrderStatuses', 'syncSteadfastDeliveryStatuses',
            'syncPathaoDeliveryStatuses', 'syncExchangeConsignmentStatuses',
        ];
        if (in_array($action, $adminOnly, true)) {
            $role = trim((string) ($this->auth->requireUser()['role'] ?? ''));
            if (!in_array($role, ['Admin', 'Developer'], true)) throw new RuntimeException('This tool is restricted to administrators.');
        }
    }

    private function hasPermission(string|array $required): bool
    {
        $user = $this->auth->requireUser();
        $role = trim((string) ($user['role'] ?? ''));
        if (in_array($role, ['Admin', 'Developer'], true)) return true;
        $requiredPermissions = is_array($required) ? $required : [$required];
        $permissions = $this->permissionsForRole($role);
        foreach ($requiredPermissions as $permission) {
            if (!empty($permissions[(string) $permission])) return true;
        }
        return false;
    }

    /** @return array<string, bool> */
    private function permissionsForRole(string $role): array
    {
        $defaults = $role === 'Employee' ? [
            'dashboard.viewEmployee' => true, 'orders.view' => true, 'orders.create' => true,
            'orders.editOwn' => true, 'customers.view' => true, 'customers.create' => true,
            'customers.edit' => true, 'products.view' => true, 'wallet.view' => true,
        ] : [];
        $row = $this->database->fetchOne('SELECT permissions FROM role_permissions WHERE role_name = :role LIMIT 1', [':role' => $role]);
        $stored = json_decode((string) ($row['permissions'] ?? '{}'), true);
        return is_array($stored) ? array_merge($defaults, $stored) : $defaults;
    }

    /** @return array<string, bool> */
    private function allowedDatasets(): array
    {
        $definitions = $this->definitions([]);
        $namespaces = [];
        foreach ($definitions as $definition) $namespaces[(string) $definition['namespace']] = true;
        $byNamespace = [
            'dashboard' => ['orders', 'customers', 'products', 'bills', 'transactions', 'accounts'],
            'reports' => ['orders', 'customers', 'products', 'bills', 'vendors', 'transactions', 'accounts', 'users', 'payroll_payments', 'wallet_entries'],
            'sales' => ['orders', 'customers', 'products'],
            'leads' => ['leads', 'lead_events', 'lead_suggestions', 'customers', 'products'],
            'inventory' => ['products', 'categories', 'units'],
            'purchases' => ['bills', 'vendors', 'products'],
            'banking' => ['accounts', 'transactions'],
            'payroll' => ['users', 'payroll_payments', 'wallet_entries', 'wallet_payouts', 'orders'],
            'whatsapp' => ['whatsapp_contacts', 'whatsapp_messages'],
            'messenger' => ['messenger_contacts', 'messenger_messages'],
            'courier' => ['orders'],
            'fraud' => ['fraud_checks', 'customers'],
            'marketing' => ['meta_ads', 'meta_ads_insights_daily'],
            'woocommerce' => ['woocommerce_stores', 'orders'],
            'auto_calling' => ['voice_survey_calls', 'voice_survey_events', 'orders'],
            'recycle_bin' => ['orders', 'customers', 'products', 'bills', 'vendors', 'transactions', 'accounts', 'users'],
        ];
        $tables = [];
        foreach ($namespaces as $namespace => $_) foreach ($byNamespace[$namespace] ?? [] as $table) $tables[$table] = true;
        return $tables;
    }

    private function schemaForAction(string $action): array
    {
        $strictObject = static fn(array $properties = [], array $required = []): array => ['type' => 'object', 'properties' => $properties, 'required' => $required, 'additionalProperties' => false];
        $idList = ['type' => 'array', 'items' => ['type' => 'string', 'minLength' => 1]];
        $numberFilter = ['type' => 'object', 'properties' => [
            'operator' => ['type' => 'string', 'enum' => ['=', '<', '>']],
            'value' => ['type' => 'number'],
        ], 'required' => ['operator', 'value'], 'additionalProperties' => false];
        $pageFields = [
            'page' => ['type' => 'integer', 'minimum' => 1],
            'pageSize' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 100],
            'search' => ['type' => 'string'],
        ];
        $dateRange = [
            'filterRange' => ['type' => 'string', 'enum' => ['Today', 'This Week', 'This Month', 'This Year', 'Custom', 'All Time']],
            'customDates' => ['type' => 'object', 'properties' => ['from' => ['type' => 'string'], 'to' => ['type' => 'string']], 'additionalProperties' => false],
            'search' => ['type' => 'string'],
        ];

        if (in_array($action, ['fetchDashboardSnapshot', 'fetchIncomeSummaryReport', 'fetchExpenseSummaryReport', 'fetchProfitLossReport', 'fetchProductQuantitySoldReport', 'fetchCustomerSalesReport'], true)) return $strictObject($dateRange);
        if ($action === 'fetchIncomeVsExpenseReport') return $strictObject();
        if ($action === 'fetchEmployeeOrderCounts') return $strictObject([
            'createdByIds' => ['type' => 'array', 'minItems' => 1, 'items' => ['type' => 'string']],
            'from' => ['type' => 'string'], 'to' => ['type' => 'string'],
        ], ['createdByIds']);
        if ($action === 'fetchUserActivityPerformanceReportPage') return $strictObject(array_merge($dateRange, [
            'page' => ['type' => 'integer', 'minimum' => 1], 'pageSize' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 25],
            'searchOperator' => ['type' => 'string'], 'roleFilter' => ['type' => 'string'], 'roleOperator' => ['type' => 'string'],
            'activityFilter' => ['type' => 'string'], 'activityOperator' => ['type' => 'string'], 'onlyActive' => ['type' => 'boolean'],
        ]));
        if ($action === 'fetchUserActivityPerformanceLog') return $strictObject(array_merge($dateRange, [
            'userId' => ['type' => 'string', 'minLength' => 1], 'page' => ['type' => 'integer', 'minimum' => 1],
            'pageSize' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 100], 'activityType' => ['type' => 'string'],
        ]), ['userId']);

        if (in_array($action, ['fetchOrders', 'fetchCustomers', 'fetchCustomersMini', 'fetchVendors', 'fetchProductsMini', 'fetchAccounts', 'fetchTransactions', 'fetchPayrollEmployees', 'fetchEmployeeWalletCards', 'fetchMyWallet'], true)) return $strictObject();
        if ($action === 'fetchProducts') return $strictObject(['category' => ['type' => 'string']]);
        if ($action === 'fetchCategories') return $strictObject(['type' => ['type' => 'string', 'enum' => ['Income', 'Expense', 'Product', 'Other']]]);
        if ($action === 'fetchUnits') return $strictObject();
        if ($action === 'fetchLeadsPage') return $strictObject(array_merge($pageFields, [
            'status' => ['type' => 'string'], 'channel' => ['type' => 'string', 'enum' => ['messenger', 'whatsapp']],
        ]));
        if ($action === 'fetchOrdersPage') return $strictObject(array_merge($pageFields, [
            'status' => ['type' => 'string'], 'statusNot' => ['type' => 'string'],
            'paymentStatus' => ['type' => 'string'], 'paymentStatusNot' => ['type' => 'string'],
            'sourceAd' => ['type' => 'string'], 'sourceAdNot' => ['type' => 'string'],
            'orderNumber' => ['type' => 'string'], 'orderNumberNot' => ['type' => 'string'],
            'customerName' => ['type' => 'string'], 'customerNameNot' => ['type' => 'string'],
            'customerPhone' => ['type' => 'string'], 'customerPhoneNot' => ['type' => 'string'],
            'company' => ['type' => 'string'], 'companyNot' => ['type' => 'string'],
            'courier' => ['type' => 'string'], 'courierNot' => ['type' => 'string'],
            'from' => ['type' => 'string'], 'to' => ['type' => 'string'],
            'createdByIds' => $idList, 'createdByNotIds' => $idList,
        ]));
        if ($action === 'fetchCustomersPage') return $strictObject(array_merge($pageFields, [
            'name' => ['type' => 'string'], 'nameNot' => ['type' => 'string'],
            'phone' => ['type' => 'string'], 'phoneNot' => ['type' => 'string'],
            'address' => ['type' => 'string'], 'addressNot' => ['type' => 'string'],
            'createdByIds' => $idList, 'createdByNotIds' => $idList,
            'totalOrders' => $numberFilter, 'dueAmount' => $numberFilter,
        ]));
        if ($action === 'fetchVendorsPage') return $strictObject(array_merge($pageFields, [
            'name' => ['type' => 'string'], 'nameNot' => ['type' => 'string'],
            'phone' => ['type' => 'string'], 'phoneNot' => ['type' => 'string'],
            'address' => ['type' => 'string'], 'addressNot' => ['type' => 'string'],
            'purchases' => $numberFilter, 'payable' => $numberFilter,
        ]));
        if ($action === 'fetchProductsPage') return $strictObject(array_merge($pageFields, [
            'name' => ['type' => 'string'], 'nameNot' => ['type' => 'string'],
            'category' => ['type' => 'string'], 'categoryNot' => ['type' => 'string'],
            'createdByIds' => $idList, 'createdByNotIds' => $idList,
            'stock' => $numberFilter, 'salePrice' => $numberFilter, 'purchasePrice' => $numberFilter,
        ]));
        if ($action === 'fetchBillsPage') return $strictObject(array_merge($pageFields, [
            'status' => ['type' => 'string'], 'billStatus' => ['type' => 'string'], 'billStatusNot' => ['type' => 'string'],
            'paymentStatus' => ['type' => 'string'], 'paymentStatusNot' => ['type' => 'string'],
            'billNumber' => ['type' => 'string'], 'billNumberNot' => ['type' => 'string'],
            'vendorName' => ['type' => 'string'], 'vendorNameNot' => ['type' => 'string'],
            'vendorPhone' => ['type' => 'string'], 'vendorPhoneNot' => ['type' => 'string'],
            'from' => ['type' => 'string'], 'to' => ['type' => 'string'],
            'createdByIds' => $idList, 'createdByNotIds' => $idList,
        ]));
        if ($action === 'fetchTransactionsPage') return $strictObject(array_merge($pageFields, [
            'type' => ['type' => 'string'], 'typeNot' => ['type' => 'string'],
            'category' => ['type' => 'string'], 'categoryNot' => ['type' => 'string'],
            'account' => ['type' => 'string'], 'accountNot' => ['type' => 'string'],
            'contact' => ['type' => 'string'], 'contactNot' => ['type' => 'string'],
            'paymentMethod' => ['type' => 'string'], 'paymentMethodNot' => ['type' => 'string'],
            'approvalStatus' => ['type' => 'string'], 'approvalStatusNot' => ['type' => 'string'],
            'from' => ['type' => 'string'], 'to' => ['type' => 'string'],
            'createdByIds' => $idList, 'createdByNotIds' => $idList,
        ]));
        if ($action === 'fetchPayrollHistory') return $strictObject([
            'employeeId' => ['type' => 'string'], 'periodStart' => ['type' => 'string'], 'periodEnd' => ['type' => 'string'],
        ]);
        if ($action === 'fetchPayrollSummaries') return $strictObject([
            'employeeId' => ['type' => 'string'], 'periodStart' => ['type' => 'string', 'minLength' => 1], 'periodEnd' => ['type' => 'string', 'minLength' => 1],
        ], ['periodStart', 'periodEnd']);
        if ($action === 'fetchEmployeeWalletCardsPage') return $strictObject($pageFields);
        if ($action === 'fetchWalletActivity') return $strictObject([
            'employeeId' => ['type' => 'string'], 'entryTypes' => ['type' => 'array', 'items' => ['type' => 'string']],
        ]);
        if ($action === 'fetchWalletActivityPage') return $strictObject(array_merge($pageFields, [
            'employeeId' => ['type' => 'string'], 'entryTypes' => ['type' => 'array', 'items' => ['type' => 'string']],
        ]));
        if ($action === 'fetchRecycleBinPage') return $strictObject(array_merge($pageFields, [
            'entityType' => ['type' => 'string'], 'entityTypeNot' => ['type' => 'string'],
            'deletedBy' => ['type' => 'string'], 'deletedByNot' => ['type' => 'string'],
            'title' => ['type' => 'string'], 'titleNot' => ['type' => 'string'],
            'deletedDate' => ['type' => 'object', 'properties' => [
                'operator' => ['type' => 'string', 'enum' => ['on', 'before', 'after']], 'value' => ['type' => 'string'],
            ], 'required' => ['operator', 'value'], 'additionalProperties' => false],
        ]));

        if ($action === 'fetchCarryBeeStores' || $action === 'fetchCarryBeeCities') return $strictObject();
        if ($action === 'fetchCarryBeeZones') return $strictObject(['cityId' => ['type' => 'string', 'minLength' => 1]], ['cityId']);
        if ($action === 'fetchCarryBeeAreas') return $strictObject(['cityId' => ['type' => 'string', 'minLength' => 1], 'zoneId' => ['type' => 'string', 'minLength' => 1]], ['cityId', 'zoneId']);
        if ($action === 'fetchCarryBeeOrderDetails') return $strictObject(['orderId' => ['type' => 'string'], 'consignmentId' => ['type' => 'string']]);
        if ($action === 'fetchSteadfastStatusByTrackingCode') return $strictObject(['orderId' => ['type' => 'string'], 'trackingCode' => ['type' => 'string']]);
        if ($action === 'fetchPaperflyOrderTracking') return $strictObject(['orderId' => ['type' => 'string'], 'referenceNumber' => ['type' => 'string']]);
        if ($action === 'fetchPathaoOrderInfo') return $strictObject(['orderId' => ['type' => 'string'], 'consignmentId' => ['type' => 'string']]);

        if ($action === 'fetchWooCommerceStores') return $strictObject();
        if ($action === 'checkWebhookHealth') return $strictObject(['storeId' => ['type' => 'string', 'minLength' => 1]], ['storeId']);
        if ($action === 'syncWooCommerceOrders') return $strictObject([
            'storeId' => ['type' => 'string', 'minLength' => 1], 'maxOrders' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 1000],
        ], ['storeId']);

        if ($action === 'fetchOrderSurveyStatus') return $strictObject(['orderId' => ['type' => 'string', 'minLength' => 1]], ['orderId']);
        if ($action === 'fetchSurveyBalance' || $action === 'fetchSurveySummary') return $strictObject();
        if ($action === 'fetchSurveyHistory' || $action === 'fetchSurveyBroadcasts') return $strictObject([
            'page' => ['type' => 'integer', 'minimum' => 1], 'pageSize' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 100],
            'startDate' => ['type' => 'string'], 'endDate' => ['type' => 'string'],
        ]);

        if ($action === 'fetchMetaAdsConnectionStatus' || $action === 'fetchMetaAdsSyncCache' || $action === 'fetchMetaAdsSyncStatus' || $action === 'fetchMetaAdsFilters' || $action === 'syncMetaAds') return $strictObject();
        if ($action === 'fetchMetaAdById') return $strictObject(['id' => ['type' => 'string', 'minLength' => 1]], ['id']);
        if (in_array($action, ['fetchMetaAdInsightsDaily', 'fetchMetaAdInsightsDemographics', 'fetchMetaAdInsightsPlacements', 'fetchMetaAdInsightsDevices'], true)) return $strictObject([
            'id' => ['type' => 'string', 'minLength' => 1],
        ], ['id']);
        if ($action === 'fetchMetaAds') return $strictObject([
            'from' => ['type' => 'string'], 'to' => ['type' => 'string'], 'businessId' => ['type' => 'string'],
            'businessOperator' => ['type' => 'string'], 'adAccountId' => ['type' => 'string'], 'adAccountOperator' => ['type' => 'string'],
            'campaignId' => ['type' => 'string'], 'campaignOperator' => ['type' => 'string'], 'status' => ['type' => 'string'],
            'statusOperator' => ['type' => 'string'], 'search' => ['type' => 'string'], 'searchOperator' => ['type' => 'string'],
        ]);
        if ($action === 'fetchMarketingDashboard') return $strictObject(['from' => ['type' => 'string'], 'to' => ['type' => 'string']]);

        if (in_array($action, ['fetchWhatsAppMessages', 'fetchMessengerMessages'], true)) return $strictObject([
            'contactId' => ['type' => 'string', 'minLength' => 1], 'limit' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 100], 'before' => ['type' => 'string'],
        ], ['contactId']);
        if (in_array($action, ['fetchWhatsAppContacts', 'fetchMessengerContacts'], true)) return $strictObject([
            'search' => ['type' => 'string'], 'limit' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 100],
        ]);
        if ($action === 'fetchWhatsAppTemplates' || $action === 'fetchMessengerProfile') return $strictObject();

        if (in_array($action, ['fetchOrderById', 'fetchCustomerById', 'fetchProductById', 'fetchVendorById', 'fetchBillById', 'fetchAccountById', 'fetchTransactionById', 'fetchUserById', 'fetchLeadById', 'fetchUnitById', 'fetchCategoriesById'], true)) return $strictObject(['id' => ['type' => 'string', 'minLength' => 1]], ['id']);
        if ($action === 'fetchOrderByNumber') return $strictObject(['orderNumber' => ['type' => 'string', 'minLength' => 1]], ['orderNumber']);
        if ($action === 'fetchOrdersByCustomerId') return $strictObject(['customerId' => ['type' => 'string', 'minLength' => 1]], ['customerId']);
        if ($action === 'fetchBillsByVendorId') return $strictObject(['vendorId' => ['type' => 'string', 'minLength' => 1]], ['vendorId']);
        if (in_array($action, ['fetchLeadIntelligence', 'fetchLeadEvents'], true)) return $strictObject(['leadId' => ['type' => 'string', 'minLength' => 1]], ['leadId']);
        if ($action === 'fetchOrderSearchPreview') return $strictObject(['search' => ['type' => 'string', 'minLength' => 1], 'limit' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 20]], ['search']);
        if ($action === 'fetchProductsSearch') return $strictObject(['q' => ['type' => 'string', 'minLength' => 1], 'limit' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 200]], ['q']);
        if ($action === 'analyzeLowStock') return $strictObject([
            'threshold' => ['type' => 'number', 'minimum' => 0], 'category' => ['type' => 'string'],
            'limit' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 100],
        ]);
        if ($action === 'compareInventoryStock') return $strictObject([
            'productIds' => ['type' => 'array', 'minItems' => 1, 'items' => ['type' => 'string']],
            'category' => ['type' => 'string'], 'limit' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 100],
        ]);
        if (str_ends_with($action, 'Page')) return $strictObject($pageFields);
        if (in_array($action, ['createCustomer', 'createVendor'], true)) return $strictObject([
            'name' => ['type' => 'string', 'minLength' => 1], 'phone' => ['type' => 'string', 'minLength' => 1], 'address' => ['type' => 'string'],
        ], ['name', 'phone']);
        if ($action === 'createProduct') return $strictObject([
            'name' => ['type' => 'string', 'minLength' => 1], 'category' => ['type' => 'string'], 'unitId' => ['type' => 'string'],
            'salePrice' => ['type' => 'number', 'minimum' => 0], 'purchasePrice' => ['type' => 'number', 'minimum' => 0],
            'stock' => ['type' => 'number', 'minimum' => 0], 'dynamicPricing' => ['type' => 'string'],
        ], ['name', 'salePrice', 'purchasePrice', 'stock']);
        if ($action === 'createAccount') return $strictObject([
            'name' => ['type' => 'string', 'minLength' => 1], 'type' => ['type' => 'string', 'minLength' => 1],
            'openingBalance' => ['type' => 'number'], 'currentBalance' => ['type' => 'number'],
        ], ['name', 'type']);
        if ($action === 'createTransaction') return $strictObject([
            'type' => ['type' => 'string', 'enum' => ['Income', 'Expense']], 'category' => ['type' => 'string', 'minLength' => 1],
            'accountId' => ['type' => 'string', 'minLength' => 1], 'amount' => ['type' => 'number', 'exclusiveMinimum' => 0],
            'date' => ['type' => 'string'], 'description' => ['type' => 'string'], 'paymentMethod' => ['type' => 'string'],
            'referenceId' => ['type' => 'string'], 'contactId' => ['type' => 'string'],
        ], ['type', 'category', 'accountId', 'amount']);
        if ($action === 'createTransfer') return $strictObject([
            'accountId' => ['type' => 'string', 'minLength' => 1], 'toAccountId' => ['type' => 'string', 'minLength' => 1],
            'amount' => ['type' => 'number', 'exclusiveMinimum' => 0], 'date' => ['type' => 'string'], 'description' => ['type' => 'string'],
        ], ['accountId', 'toAccountId', 'amount']);
        if ($action === 'createCategory') return $strictObject([
            'name' => ['type' => 'string', 'minLength' => 1], 'type' => ['type' => 'string', 'enum' => ['Income', 'Expense', 'Product', 'Other']],
            'color' => ['type' => 'string'], 'parentId' => ['type' => 'string'],
        ], ['name', 'type']);
        if ($action === 'createUnit') return $strictObject([
            'name' => ['type' => 'string', 'minLength' => 1], 'shortName' => ['type' => 'string', 'minLength' => 1],
            'description' => ['type' => 'string'], 'isFraction' => ['type' => 'boolean'],
        ], ['name', 'shortName']);
        if ($action === 'createOrder') return $this->documentSchema('customerId');
        if ($action === 'createBill') return $this->documentSchema('vendorId');
        if ($action === 'updateOrder') return $strictObject([
            'id' => ['type' => 'string', 'minLength' => 1],
            'updates' => ['type' => 'object', 'properties' => [
                'status' => ['type' => 'string', 'enum' => ['On Hold', 'Processing', 'Courier assigned', 'Picked', 'Completed', 'Exchange processing', 'Exchange picked', 'Exchange delivered', 'Exchange returned', 'Exchange cancelled', 'Returned', 'Cancelled']],
                'customerId' => ['type' => 'string'], 'orderDate' => ['type' => 'string'], 'orderNumber' => ['type' => 'string'],
                'items' => ['type' => 'array', 'minItems' => 1, 'items' => $this->documentItemSchema()],
                'subtotal' => ['type' => 'number'], 'discount' => ['type' => 'number'], 'shipping' => ['type' => 'number'],
                'total' => ['type' => 'number'], 'paidAmount' => ['type' => 'number'], 'notes' => ['type' => 'string'],
                'paymentAmount' => ['type' => 'number', 'minimum' => 0], 'paymentAccountId' => ['type' => 'string'],
                'paymentMethod' => ['type' => 'string'], 'paymentDate' => ['type' => 'string'],
                'refundAmount' => ['type' => 'number', 'minimum' => 0], 'refundAccountId' => ['type' => 'string'],
                'refundPaymentMethod' => ['type' => 'string'], 'refundCategoryId' => ['type' => 'string'], 'paidAt' => ['type' => 'string'],
                'sourceAd' => ['type' => 'string'],
            ], 'additionalProperties' => false],
        ], ['id', 'updates']);
        if ($action === 'updateBill') return $strictObject([
            'id' => ['type' => 'string', 'minLength' => 1],
            'updates' => ['type' => 'object', 'properties' => [
                'status' => ['type' => 'string', 'enum' => ['On Hold', 'Processing', 'Received', 'Paid', 'Returned', 'Cancelled']],
                'vendorId' => ['type' => 'string'], 'billDate' => ['type' => 'string'], 'billNumber' => ['type' => 'string'],
                'items' => ['type' => 'array', 'minItems' => 1, 'items' => $this->documentItemSchema()],
                'subtotal' => ['type' => 'number'], 'discount' => ['type' => 'number'], 'shipping' => ['type' => 'number'],
                'total' => ['type' => 'number'], 'paidAmount' => ['type' => 'number'], 'notes' => ['type' => 'string'],
                'paymentAmount' => ['type' => 'number', 'minimum' => 0], 'refundAmount' => ['type' => 'number', 'minimum' => 0],
                'accountId' => ['type' => 'string'], 'paymentMethod' => ['type' => 'string'], 'transactionDate' => ['type' => 'string'],
            ], 'additionalProperties' => false],
        ], ['id', 'updates']);
        if (in_array($action, ['updateCustomer', 'updateVendor'], true)) return $strictObject([
            'id' => ['type' => 'string', 'minLength' => 1],
            'updates' => ['type' => 'object', 'properties' => [
                'name' => ['type' => 'string', 'minLength' => 1], 'phone' => ['type' => 'string', 'minLength' => 1], 'address' => ['type' => 'string'],
            ], 'additionalProperties' => false],
        ], ['id', 'updates']);
        if ($action === 'updateProduct') return $strictObject([
            'id' => ['type' => 'string', 'minLength' => 1],
            'updates' => ['type' => 'object', 'properties' => [
                'name' => ['type' => 'string', 'minLength' => 1], 'slug' => ['type' => 'string'],
                'category' => ['type' => 'string'], 'unitId' => ['type' => 'string'],
                'salePrice' => ['type' => 'number', 'minimum' => 0], 'purchasePrice' => ['type' => 'number', 'minimum' => 0],
                'stock' => ['type' => 'number', 'minimum' => 0], 'dynamicPricing' => ['type' => 'string'],
            ], 'additionalProperties' => false],
        ], ['id', 'updates']);
        if ($action === 'updateAccount') return $strictObject([
            'id' => ['type' => 'string', 'minLength' => 1],
            'updates' => ['type' => 'object', 'properties' => [
                'name' => ['type' => 'string', 'minLength' => 1], 'type' => ['type' => 'string', 'minLength' => 1],
                'openingBalance' => ['type' => 'number'], 'currentBalance' => ['type' => 'number'],
            ], 'additionalProperties' => false],
        ], ['id', 'updates']);
        if ($action === 'updateCategory') return $strictObject([
            'id' => ['type' => 'string', 'minLength' => 1],
            'updates' => ['type' => 'object', 'properties' => [
                'name' => ['type' => 'string', 'minLength' => 1], 'type' => ['type' => 'string', 'enum' => ['Income', 'Expense', 'Product', 'Other']],
                'color' => ['type' => 'string'], 'parentId' => ['type' => 'string'],
            ], 'additionalProperties' => false],
        ], ['id', 'updates']);
        if ($action === 'updateUnit') return $strictObject([
            'id' => ['type' => 'string', 'minLength' => 1],
            'updates' => ['type' => 'object', 'properties' => [
                'name' => ['type' => 'string', 'minLength' => 1], 'shortName' => ['type' => 'string', 'minLength' => 1],
                'description' => ['type' => 'string'], 'isFraction' => ['type' => 'boolean'],
            ], 'additionalProperties' => false],
        ], ['id', 'updates']);
        if ($action === 'updateTransaction') return $strictObject([
            'id' => ['type' => 'string', 'minLength' => 1],
            'updates' => ['type' => 'object', 'properties' => [
                'date' => ['type' => 'string'], 'type' => ['type' => 'string', 'enum' => ['Income', 'Expense', 'Transfer']],
                'category' => ['type' => 'string'], 'accountId' => ['type' => 'string'], 'toAccountId' => ['type' => 'string'],
                'amount' => ['type' => 'number', 'exclusiveMinimum' => 0], 'description' => ['type' => 'string'],
                'referenceId' => ['type' => 'string'], 'contactId' => ['type' => 'string'], 'paymentMethod' => ['type' => 'string'],
            ], 'additionalProperties' => false],
        ], ['id', 'updates']);
        if ($action === 'completePickedOrder') return $strictObject([
            'orderId' => ['type' => 'string', 'minLength' => 1], 'outcome' => ['type' => 'string', 'enum' => ['Delivered', 'Returned']],
            'date' => ['type' => 'string'], 'accountId' => ['type' => 'string'], 'amount' => ['type' => 'number'],
            'paymentMethod' => ['type' => 'string'], 'categoryId' => ['type' => 'string'],
            'refundAmount' => ['type' => 'number'], 'refundAccountId' => ['type' => 'string'],
        ], ['orderId', 'outcome']);
        if ($action === 'reviewTransactionApproval') return $strictObject([
            'transactionId' => ['type' => 'string', 'minLength' => 1], 'decision' => ['type' => 'string', 'enum' => ['approve', 'decline']], 'note' => ['type' => 'string'],
        ], ['transactionId', 'decision']);
        if ($action === 'processOrderReturnExchange') return $strictObject([
            'orderId' => ['type' => 'string', 'minLength' => 1], 'returnAction' => ['type' => 'string', 'enum' => ['partialReturn', 'exchange']],
            'items' => ['type' => 'array', 'minItems' => 1, 'items' => ['type' => 'object', 'properties' => [
                'productId' => ['type' => 'string', 'minLength' => 1], 'lineIndex' => ['type' => 'integer', 'minimum' => 0],
                'returnQty' => ['type' => 'integer', 'minimum' => 0], 'exchangeQty' => ['type' => 'integer', 'minimum' => 0],
                'replacementItems' => ['type' => 'array', 'items' => $this->documentItemSchema()],
            ], 'required' => ['productId'], 'additionalProperties' => false]],
            'refundAmount' => ['type' => 'number'], 'extraCollectionAmount' => ['type' => 'number'], 'accountId' => ['type' => 'string'],
            'paymentMethod' => ['type' => 'string'], 'categoryId' => ['type' => 'string'], 'note' => ['type' => 'string'], 'date' => ['type' => 'string'],
        ], ['orderId', 'returnAction', 'items']);
        if ($action === 'processBillReturn') return $strictObject([
            'billId' => ['type' => 'string', 'minLength' => 1], 'items' => ['type' => 'array', 'minItems' => 1, 'items' => ['type' => 'object', 'properties' => [
                'productId' => ['type' => 'string', 'minLength' => 1], 'lineIndex' => ['type' => 'integer', 'minimum' => 0],
                'returnQty' => ['type' => 'integer', 'exclusiveMinimum' => 0],
            ], 'required' => ['productId', 'returnQty'], 'additionalProperties' => false]],
            'refundAmount' => ['type' => 'number'], 'accountId' => ['type' => 'string'], 'paymentMethod' => ['type' => 'string'],
            'categoryId' => ['type' => 'string'], 'note' => ['type' => 'string'], 'date' => ['type' => 'string'],
        ], ['billId', 'items']);
        if (str_starts_with($action, 'delete')) return $strictObject([
            'id' => ['type' => 'string', 'minLength' => 1],
        ], ['id']);
        if (in_array($action, ['triggerSurveyCall', 'retrySurveyCall', 'cancelSurveyCall'], true)) return $strictObject([
            'orderId' => ['type' => 'string', 'minLength' => 1],
        ], ['orderId']);
        if ($action === 'analyzeLead') return $strictObject(['leadId' => ['type' => 'string', 'minLength' => 1]], ['leadId']);
        if ($action === 'markLeadSuggestionSent') return $strictObject([
            'suggestionId' => ['type' => 'string', 'minLength' => 1], 'messageId' => ['type' => 'string'],
        ], ['suggestionId']);
        if ($action === 'createWhatsAppConversation') return $strictObject([
            'phoneNumber' => ['type' => 'string', 'minLength' => 7], 'name' => ['type' => 'string'],
        ], ['phoneNumber']);
        if ($action === 'markWhatsAppConversationRead' || $action === 'markMessengerConversationRead') return $strictObject([
            'contactId' => ['type' => 'string', 'minLength' => 1],
        ], ['contactId']);
        if ($action === 'sendWhatsAppMessage') return $strictObject([
            'contactId' => ['type' => 'string', 'minLength' => 1], 'text' => ['type' => 'string', 'minLength' => 1],
        ], ['contactId', 'text']);
        if ($action === 'sendMessengerMessage') return $strictObject([
            'contactId' => ['type' => 'string', 'minLength' => 1], 'text' => ['type' => 'string', 'minLength' => 1], 'replyToMid' => ['type' => 'string'],
        ], ['contactId', 'text']);
        if ($action === 'sendWhatsAppTemplate') return $strictObject([
            'contactId' => ['type' => 'string', 'minLength' => 1], 'templateName' => ['type' => 'string', 'minLength' => 1],
            'languageCode' => ['type' => 'string'], 'components' => ['type' => 'array'],
        ], ['contactId', 'templateName']);
        if ($action === 'sendMessengerQuickReplies') return $strictObject([
            'contactId' => ['type' => 'string', 'minLength' => 1], 'text' => ['type' => 'string', 'minLength' => 1],
            'options' => ['type' => 'array', 'minItems' => 1, 'items' => ['type' => 'object', 'properties' => [
                'title' => ['type' => 'string', 'minLength' => 1],
            ], 'required' => ['title'], 'additionalProperties' => false]], 'replyToMid' => ['type' => 'string'],
        ], ['contactId', 'text', 'options']);
        if ($action === 'sendMessengerCard') return $strictObject([
            'contactId' => ['type' => 'string', 'minLength' => 1], 'title' => ['type' => 'string', 'minLength' => 1],
            'subtitle' => ['type' => 'string'], 'imageUrl' => ['type' => 'string'], 'buttons' => ['type' => 'array', 'items' => ['type' => 'object', 'properties' => [
                'title' => ['type' => 'string', 'minLength' => 1], 'value' => ['type' => 'string', 'minLength' => 1],
                'type' => ['type' => 'string', 'enum' => ['web_url', 'postback']],
            ], 'required' => ['title', 'value'], 'additionalProperties' => false]],
        ], ['contactId', 'title']);
        if ($action === 'sendMessengerReaction') return $strictObject([
            'contactId' => ['type' => 'string', 'minLength' => 1], 'messageId' => ['type' => 'string', 'minLength' => 1], 'reaction' => ['type' => 'string'],
        ], ['contactId', 'messageId']);
        if ($action === 'sendWhatsAppMediaMessage' || $action === 'sendMessengerMediaMessage') return $strictObject([
            'contactId' => ['type' => 'string', 'minLength' => 1],
            'attachmentIndex' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 3, 'description' => 'One-based position of a file attached to the current user message.'],
            'caption' => ['type' => 'string'], 'replyToMid' => ['type' => 'string'],
        ], ['contactId', 'attachmentIndex']);
        if ($action === 'submitSteadfastOrder') return $strictObject([
            'orderId' => ['type' => 'string', 'minLength' => 1],
        ], ['orderId']);
        if ($action === 'submitPaperflyOrder' || $action === 'submitPaperflyExchangeOrder') return $strictObject([
            'orderId' => ['type' => 'string', 'minLength' => 1], 'storeName' => ['type' => 'string'],
            'maxWeightKg' => ['type' => 'number', 'exclusiveMinimum' => 0],
        ], ['orderId']);
        if ($action === 'submitPathaoOrder') return $strictObject([
            'orderId' => ['type' => 'string', 'minLength' => 1], 'specialInstruction' => ['type' => 'string'],
            'deliveryType' => ['type' => 'integer', 'minimum' => 1], 'itemType' => ['type' => 'integer', 'minimum' => 1],
            'itemQuantity' => ['type' => 'integer', 'minimum' => 1], 'itemWeight' => ['type' => 'number', 'exclusiveMinimum' => 0],
        ], ['orderId']);
        if ($action === 'submitCarryBeeOrder') return $strictObject([
            'orderId' => ['type' => 'string', 'minLength' => 1], 'cityId' => ['type' => 'string', 'minLength' => 1],
            'zoneId' => ['type' => 'string', 'minLength' => 1], 'areaId' => ['type' => 'string'], 'deliveryType' => ['type' => 'integer'],
            'productType' => ['type' => 'integer'], 'itemWeight' => ['type' => 'number', 'exclusiveMinimum' => 0],
        ], ['orderId', 'cityId', 'zoneId']);
        if ($action === 'submitCarryBeeExchangeOrder') return $strictObject([
            'orderId' => ['type' => 'string', 'minLength' => 1], 'consignmentId' => ['type' => 'string'],
            'collectableAmount' => ['type' => 'number'], 'itemQuantity' => ['type' => 'integer'],
        ], ['orderId']);
        if (in_array($action, ['syncCarryBeeTransferStatuses', 'syncSteadfastDeliveryStatuses', 'syncPaperflyOrderStatuses', 'syncPathaoDeliveryStatuses', 'syncExchangeConsignmentStatuses'], true)) return $strictObject();
        if ($action === 'processCustomerFraudCheck') return $strictObject([
            'customerId' => ['type' => 'string', 'minLength' => 1],
        ], ['customerId']);
        if ($action === 'markPayrollPaid' || $action === 'payEmployeeWallet') return $strictObject([
            'employeeId' => ['type' => 'string', 'minLength' => 1], 'periodStart' => ['type' => 'string', 'minLength' => 1],
            'periodEnd' => ['type' => 'string', 'minLength' => 1], 'accountId' => ['type' => 'string', 'minLength' => 1],
            'paymentMethod' => ['type' => 'string', 'minLength' => 1], 'categoryId' => ['type' => 'string', 'minLength' => 1],
            'bonusAmount' => ['type' => 'number'], 'deductionAmount' => ['type' => 'number'], 'note' => ['type' => 'string'],
        ], ['employeeId', 'periodStart', 'periodEnd', 'accountId', 'paymentMethod', 'categoryId']);
        if ($action === 'restoreDeletedItem') return $strictObject([
            'entityType' => ['type' => 'string', 'enum' => ['customer', 'order', 'bill', 'transaction', 'vendor', 'product']],
            'id' => ['type' => 'string', 'minLength' => 1],
        ], ['entityType', 'id']);
        if ($action === 'revertOrderStatus') return $strictObject([
            'orderId' => ['type' => 'string', 'minLength' => 1],
            'targetStatus' => ['type' => 'string', 'enum' => ['On Hold', 'Processing', 'Courier assigned', 'Picked', 'Completed', 'Exchange processing', 'Exchange picked', 'Exchange delivered', 'Exchange returned', 'Exchange cancelled', 'Returned', 'Cancelled']],
        ], ['orderId', 'targetStatus']);
        if (preg_match('/(ById|delete|restore|complete|return|submit|trigger|retry|cancel|mark|review|reaction|read)/i', $action) === 1) {
            return $strictObject(['id' => ['type' => 'string'], 'orderId' => ['type' => 'string'], 'customerId' => ['type' => 'string'], 'conversationId' => ['type' => 'string']], []);
        }
        if (str_contains($action, 'Message')) return $strictObject(['contactId' => ['type' => 'string'], 'recipientId' => ['type' => 'string'], 'message' => ['type' => 'string'], 'text' => ['type' => 'string']], []);
        return $strictObject();
    }

    private function documentSchema(string $partyKey): array
    {
        $dateKey = $partyKey === 'customerId' ? 'orderDate' : 'billDate';
        $allowedStatuses = $partyKey === 'customerId'
            ? ['On Hold', 'Processing']
            : ['On Hold', 'Processing'];
        $properties = [
            $partyKey => ['description' => 'Existing record id or a dependency reference to an earlier action result.'],
            $dateKey => ['type' => 'string'],
            'status' => ['type' => 'string', 'enum' => $allowedStatuses],
            'items' => ['type' => 'array', 'minItems' => 1, 'items' => $this->documentItemSchema()],
            'subtotal' => ['type' => 'number', 'minimum' => 0], 'discount' => ['type' => 'number', 'minimum' => 0],
            'shipping' => ['type' => 'number', 'minimum' => 0], 'total' => ['type' => 'number', 'minimum' => 0],
            'paidAmount' => ['type' => 'number', 'minimum' => 0], 'notes' => ['type' => 'string'],
        ];
        if ($partyKey === 'customerId') {
            $properties['pageId'] = ['type' => 'string'];
            $properties['sourceAd'] = ['type' => 'string'];
        }
        return [
            'type' => 'object',
            'properties' => $properties,
            'required' => [$partyKey, 'items', 'subtotal', 'total'],
            'additionalProperties' => false,
        ];
    }

    /** @return array<string, mixed> */
    private function documentItemSchema(): array
    {
        return [
            'type' => 'object',
            'properties' => [
                'productId' => ['description' => 'Existing product id or a dependency reference to an earlier action result.'],
                'productName' => ['type' => 'string'],
                'quantity' => ['type' => 'number', 'exclusiveMinimum' => 0],
                'rate' => ['type' => 'number', 'minimum' => 0],
                'amount' => ['type' => 'number', 'minimum' => 0],
                'originalRate' => ['type' => 'number', 'minimum' => 0],
                'dynamicDiscount' => ['type' => 'number', 'minimum' => 0],
                'discountEligible' => ['type' => 'boolean'],
            ],
            'required' => ['productId', 'quantity', 'rate', 'amount'],
            'additionalProperties' => false,
        ];
    }

    private function validateValue(mixed $value, array $schema, string $path): void
    {
        $type = strtolower((string) ($schema['type'] ?? ''));
        $valid = match ($type) {
            'object' => is_array($value) && !array_is_list($value),
            'array' => is_array($value),
            'string' => is_string($value),
            'integer' => is_int($value) || (is_numeric($value) && (int) $value == $value),
            'number' => is_int($value) || is_float($value) || is_numeric($value),
            'boolean' => is_bool($value),
            '' => true,
            default => true,
        };
        if (!$valid) throw new RuntimeException($path . ' has the wrong type.');
        if ($type === 'string' && isset($schema['minLength']) && mb_strlen((string) $value) < (int) $schema['minLength']) throw new RuntimeException($path . ' is required.');
        if (isset($schema['enum']) && is_array($schema['enum']) && !in_array($value, $schema['enum'], true)) throw new RuntimeException($path . ' has an unsupported value.');
        if (($type === 'number' || $type === 'integer') && isset($schema['exclusiveMinimum']) && (float) $value <= (float) $schema['exclusiveMinimum']) throw new RuntimeException($path . ' must be greater than ' . $schema['exclusiveMinimum'] . '.');
        if (($type === 'number' || $type === 'integer') && isset($schema['minimum']) && (float) $value < (float) $schema['minimum']) throw new RuntimeException($path . ' is below the allowed minimum.');
        if (($type === 'number' || $type === 'integer') && isset($schema['maximum']) && (float) $value > (float) $schema['maximum']) throw new RuntimeException($path . ' exceeds the allowed maximum.');
        if ($type === 'object') {
            foreach (($schema['required'] ?? []) as $required) if (!array_key_exists((string) $required, $value)) throw new RuntimeException($path . '.' . $required . ' is required.');
            foreach (($schema['properties'] ?? []) as $name => $child) if (array_key_exists($name, $value) && is_array($child)) $this->validateValue($value[$name], $child, $path . '.' . $name);
            if (($schema['additionalProperties'] ?? true) === false) {
                foreach (array_keys($value) as $name) if (!array_key_exists($name, $schema['properties'] ?? [])) throw new RuntimeException($path . '.' . $name . ' is not allowed.');
            }
        }
        if ($type === 'array') {
            if (isset($schema['minItems']) && count($value) < (int) $schema['minItems']) throw new RuntimeException($path . ' needs more items.');
            foreach ($value as $index => $item) if (is_array($schema['items'] ?? null)) $this->validateValue($item, $schema['items'], $path . '[' . $index . ']');
        }
    }

    private function preflightDocument(array $arguments, string $partyKey, string $partyTable, bool $checkStock): void
    {
        $partyValue = $arguments[$partyKey] ?? '';
        $partyIsReference = $this->isDependencyReference($partyValue);
        if (!$partyIsReference) {
            $partyId = trim((string) $partyValue);
            $party = $this->database->fetchOne('SELECT id, name FROM `' . $partyTable . '` WHERE id = :id AND deleted_at IS NULL LIMIT 1', [':id' => $partyId]);
            if ($party === null) throw new RuntimeException('The selected ' . rtrim($partyTable, 's') . ' no longer exists.');
        }
        $calculatedSubtotal = 0.0;
        foreach (($arguments['items'] ?? []) as $item) {
            if (!is_array($item)) continue;
            $quantity = (float) ($item['quantity'] ?? 0);
            if ($quantity <= 0) throw new RuntimeException('Every line item needs a positive quantity.');
            $rate = round((float) ($item['rate'] ?? 0), 2);
            $amount = round((float) ($item['amount'] ?? ($rate * $quantity)), 2);
            if ($rate < 0 || abs($amount - round($rate * $quantity, 2)) > 0.01) {
                throw new RuntimeException('Every line item amount must equal its rate multiplied by quantity.');
            }
            $calculatedSubtotal += $amount;
            $productValue = $item['productId'] ?? $item['id'] ?? '';
            if ($this->isDependencyReference($productValue)) continue;
            $productId = trim((string) $productValue);
            if ($productId === '') continue;
            $product = $this->database->fetchOne('SELECT id, name, stock FROM products WHERE id = :id AND deleted_at IS NULL LIMIT 1', [':id' => $productId]);
            if ($product === null) throw new RuntimeException('A selected product no longer exists.');
            if ($checkStock && (float) ($product['stock'] ?? 0) < $quantity && in_array((string) ($arguments['status'] ?? 'On Hold'), ['Processing', 'Courier assigned', 'Picked', 'Completed'], true)) {
                throw new RuntimeException('There is not enough stock for ' . (string) ($product['name'] ?? 'a selected product') . '.');
            }
        }
        $calculatedSubtotal = round($calculatedSubtotal, 2);
        $submittedSubtotal = round((float) ($arguments['subtotal'] ?? 0), 2);
        $discount = round((float) ($arguments['discount'] ?? 0), 2);
        $shipping = round((float) ($arguments['shipping'] ?? 0), 2);
        $submittedTotal = round((float) ($arguments['total'] ?? 0), 2);
        $expectedTotal = round(max(0.0, $calculatedSubtotal - $discount + $shipping), 2);
        if (abs($submittedSubtotal - $calculatedSubtotal) > 0.01) throw new RuntimeException('The subtotal does not match the selected items.');
        if ($discount < 0 || $discount > $calculatedSubtotal) throw new RuntimeException('The discount must be between zero and the subtotal.');
        if ($shipping < 0 || abs($submittedTotal - $expectedTotal) > 0.01) throw new RuntimeException('The document total is invalid.');
    }

    private function assertNoDuplicate(string $table, string $column, string $value, string $label, bool $usesSoftDelete = true): void
    {
        if (trim($value) === '') return;
        $row = $this->database->fetchOne(
            'SELECT id, name FROM `' . $table . '` WHERE `' . $column . '` = :value' . ($usesSoftDelete ? ' AND deleted_at IS NULL' : '') . ' LIMIT 1',
            [':value' => trim($value)]
        );
        if ($row !== null) throw new RuntimeException('A ' . $label . ' named ' . (string) ($row['name'] ?? '') . ' already uses that ' . str_replace('_', ' ', $column) . '.');
    }

    private function preflightTransfer(array $arguments): void
    {
        $fromValue = $arguments['accountId'] ?? '';
        $toValue = $arguments['toAccountId'] ?? '';
        $amount = (float) ($arguments['amount'] ?? 0);
        if ($amount <= 0) throw new RuntimeException('Transfer amount must be greater than zero.');
        if ($this->isDependencyReference($fromValue) || $this->isDependencyReference($toValue)) {
            if ($fromValue === $toValue) throw new RuntimeException('The source and destination accounts must be different.');
            return;
        }
        $fromId = trim((string) $fromValue);
        $toId = trim((string) $toValue);
        if ($fromId === '' || $toId === '') throw new RuntimeException('Both transfer accounts are required.');
        if ($fromId === $toId) throw new RuntimeException('The source and destination accounts must be different.');
        $from = $this->database->fetchOne('SELECT id, name, current_balance FROM accounts WHERE id = :id LIMIT 1', [':id' => $fromId]);
        $to = $this->database->fetchOne('SELECT id, name FROM accounts WHERE id = :id LIMIT 1', [':id' => $toId]);
        if ($from === null || $to === null) throw new RuntimeException('A selected transfer account no longer exists.');
        if ((float) ($from['current_balance'] ?? 0) < $amount) throw new RuntimeException('The source account does not have enough available balance.');
    }

    private function preflightMediaAttachment(array $arguments): void
    {
        $attachmentId = trim((string) ($arguments['attachmentId'] ?? ''));
        if ($attachmentId === '') throw new RuntimeException('Choose one of the files attached to the current message.');
        $this->ownedAttachment($attachmentId);
    }

    private function assertLeadExists(string $leadId): void
    {
        $id = trim($leadId);
        if ($id === '') throw new RuntimeException('Select a lead to analyze.');
        $row = $this->database->fetchOne('SELECT id FROM lead_profiles WHERE id = :id AND archived_at IS NULL LIMIT 1', [':id' => $id]);
        if ($row === null) throw new RuntimeException('The selected lead no longer exists.');
    }

    private function assertLeadSuggestionExists(string $suggestionId): void
    {
        $id = trim($suggestionId);
        if ($id === '') throw new RuntimeException('Select a lead suggestion.');
        $row = $this->database->fetchOne("SELECT id FROM lead_suggestions WHERE id = :id AND status = 'available' LIMIT 1", [':id' => $id]);
        if ($row === null) throw new RuntimeException('The selected lead suggestion is no longer available.');
    }

    private function assertModuleInfrastructureReady(string $action): void
    {
        $requiredTables = match (true) {
            str_contains($action, 'WhatsApp') => ['whatsapp_settings', 'whatsapp_contacts', 'whatsapp_messages'],
            str_contains($action, 'Messenger') => ['messenger_settings', 'messenger_contacts', 'messenger_messages'],
            str_contains($action, 'Lead') => ['lead_profiles', 'lead_suggestions', 'lead_events', 'lead_analysis_runs'],
            default => [],
        };
        $requiredColumns = match (true) {
            str_contains($action, 'WhatsApp') => [
                'whatsapp_settings' => ['welcome_message', 'get_started_enabled', 'ice_breakers_json'],
                'whatsapp_contacts' => ['welcome_sent_at'],
                'whatsapp_messages' => ['media_mime_type', 'file_name', 'reply_to_message_id'],
            ],
            str_contains($action, 'Messenger') => [
                'messenger_settings' => ['page_id', 'page_access_token', 'human_agent_enabled'],
                'messenger_contacts' => ['psid', 'last_user_message_at', 'unread_count'],
                'messenger_messages' => ['mid', 'reply_to_mid', 'reaction', 'quick_replies_json'],
            ],
            str_contains($action, 'Lead') => [
                'lead_profiles' => ['source_channel', 'profile_json', 'last_analyzed_message_id', 'archived_at'],
                'lead_suggestions' => ['status', 'sent_message_id'],
                'lead_events' => ['lead_id', 'event_type', 'payload_json'],
                'lead_analysis_runs' => ['lead_id', 'status', 'result_json'],
            ],
            default => [],
        };
        foreach ($requiredTables as $table) {
            $row = $this->database->fetchOne(
                'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table LIMIT 1',
                [':table' => $table]
            );
            if ($row === null) throw new RuntimeException('This module needs the latest database migration before Mame AI can use it.');
        }
        foreach ($requiredColumns as $table => $columns) {
            foreach ($columns as $column) {
                $row = $this->database->fetchOne(
                    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column LIMIT 1',
                    [':table' => $table, ':column' => $column]
                );
                if ($row === null) throw new RuntimeException('This module needs the latest database migration before Mame AI can use it.');
            }
        }
    }

    private function assertActionReferencesExist(string $action, array $arguments): void
    {
        $checks = [];
        if ($action === 'updateOrder') {
            $updates = is_array($arguments['updates'] ?? null) ? $arguments['updates'] : [];
            $checks = [['customers', $updates['customerId'] ?? null], ['accounts', $updates['paymentAccountId'] ?? null], ['accounts', $updates['refundAccountId'] ?? null]];
        } elseif ($action === 'updateBill') {
            $updates = is_array($arguments['updates'] ?? null) ? $arguments['updates'] : [];
            $checks = [['vendors', $updates['vendorId'] ?? null], ['accounts', $updates['accountId'] ?? null]];
        } elseif (in_array($action, ['createTransaction', 'createTransfer'], true)) {
            $checks = [['accounts', $arguments['accountId'] ?? null], ['accounts', $arguments['toAccountId'] ?? null]];
        } elseif (in_array($action, ['markPayrollPaid', 'payEmployeeWallet'], true)) {
            $checks = [['users', $arguments['employeeId'] ?? null], ['accounts', $arguments['accountId'] ?? null], ['categories', $arguments['categoryId'] ?? null]];
        }
        foreach ($checks as [$table, $value]) {
            if ($value === null || $this->isDependencyReference($value) || trim((string) $value) === '') continue;
            $softDeleteSql = in_array($table, ['customers', 'vendors'], true) ? ' AND deleted_at IS NULL' : '';
            $row = $this->database->fetchOne('SELECT id FROM `' . $table . '` WHERE id = :id' . $softDeleteSql . ' LIMIT 1', [':id' => trim((string) $value)]);
            if ($row === null) throw new RuntimeException('A selected referenced record no longer exists.');
        }
    }

    /** @return array<string, mixed> */
    private function analyzeLowStock(array $arguments): array
    {
        $threshold = max(0.0, (float) ($arguments['threshold'] ?? 5));
        $limit = max(1, min(100, (int) ($arguments['limit'] ?? 25)));
        $category = trim((string) ($arguments['category'] ?? ''));
        $where = ['deleted_at IS NULL', 'stock <= :threshold'];
        $bindings = [':threshold' => $threshold];
        if ($category !== '') {
            $where[] = 'category = :category';
            $bindings[':category'] = $category;
        }
        $rows = $this->database->fetchAll(
            'SELECT id, name, category, stock, sale_price, purchase_price FROM products WHERE ' . implode(' AND ', $where) . ' ORDER BY stock ASC, name ASC LIMIT ' . $limit,
            $bindings
        );
        $records = array_map(static fn(array $row): array => [
            'id' => (string) $row['id'],
            'name' => (string) $row['name'],
            'category' => (string) ($row['category'] ?? ''),
            'stock' => (float) ($row['stock'] ?? 0),
            'purchaseValue' => (float) ($row['stock'] ?? 0) * (float) ($row['purchase_price'] ?? 0),
            'potentialSaleValue' => (float) ($row['stock'] ?? 0) * (float) ($row['sale_price'] ?? 0),
        ], $rows);
        return [
            'threshold' => $threshold,
            'category' => $category !== '' ? $category : null,
            'count' => count($records),
            'outOfStockCount' => count(array_filter($records, static fn(array $row): bool => (float) $row['stock'] <= 0)),
            'records' => $records,
            'truncated' => count($records) === $limit,
        ];
    }

    /** @return array<string, mixed> */
    private function compareInventoryStock(array $arguments): array
    {
        $limit = max(1, min(100, (int) ($arguments['limit'] ?? 50)));
        $productIds = array_values(array_unique(array_filter(array_map(static fn($id): string => trim((string) $id), is_array($arguments['productIds'] ?? null) ? $arguments['productIds'] : []))));
        $category = trim((string) ($arguments['category'] ?? ''));
        $where = ['deleted_at IS NULL'];
        $bindings = [];
        if ($productIds !== []) {
            $placeholders = [];
            foreach (array_slice($productIds, 0, 100) as $index => $id) {
                $key = ':product_' . $index;
                $placeholders[] = $key;
                $bindings[$key] = $id;
            }
            $where[] = 'id IN (' . implode(', ', $placeholders) . ')';
        }
        if ($category !== '') {
            $where[] = 'category = :category';
            $bindings[':category'] = $category;
        }
        $rows = $this->database->fetchAll(
            'SELECT id, name, category, stock, sale_price, purchase_price FROM products WHERE ' . implode(' AND ', $where) . ' ORDER BY stock DESC, name ASC LIMIT ' . $limit,
            $bindings
        );
        $records = array_map(static fn(array $row): array => [
            'id' => (string) $row['id'],
            'name' => (string) $row['name'],
            'category' => (string) ($row['category'] ?? ''),
            'stock' => (float) ($row['stock'] ?? 0),
            'purchasePrice' => (float) ($row['purchase_price'] ?? 0),
            'salePrice' => (float) ($row['sale_price'] ?? 0),
            'purchaseValue' => (float) ($row['stock'] ?? 0) * (float) ($row['purchase_price'] ?? 0),
            'potentialSaleValue' => (float) ($row['stock'] ?? 0) * (float) ($row['sale_price'] ?? 0),
        ], $rows);
        return [
            'count' => count($records),
            'totalUnits' => array_sum(array_column($records, 'stock')),
            'totalPurchaseValue' => array_sum(array_column($records, 'purchaseValue')),
            'totalPotentialSaleValue' => array_sum(array_column($records, 'potentialSaleValue')),
            'records' => $records,
            'truncated' => count($records) === $limit,
        ];
    }

    /** @return array<string, mixed> */
    private function hydrateMediaAttachment(array $arguments): array
    {
        $attachment = $this->ownedAttachment(trim((string) ($arguments['attachmentId'] ?? '')));
        $storageRoot = realpath(dirname(__DIR__) . '/storage');
        $path = realpath(dirname(__DIR__) . '/storage/' . str_replace(['/', '\\'], DIRECTORY_SEPARATOR, (string) $attachment['storage_path']));
        if ($storageRoot === false || $path === false) throw new RuntimeException('The selected attachment is no longer available.');
        $rootPrefix = rtrim(str_replace('\\', '/', strtolower($storageRoot)), '/') . '/';
        $normalizedPath = str_replace('\\', '/', strtolower($path));
        if (!str_starts_with($normalizedPath, $rootPrefix) || !is_file($path)) throw new RuntimeException('The selected attachment is unavailable.');
        $bytes = file_get_contents($path);
        if ($bytes === false || $bytes === '') throw new RuntimeException('The selected attachment could not be read.');
        $arguments['dataUrl'] = 'data:' . (string) $attachment['mime_type'] . ';base64,' . base64_encode($bytes);
        $arguments['fileName'] = (string) $attachment['original_name'];
        $arguments['mimeType'] = (string) $attachment['mime_type'];
        unset($arguments['attachmentIndex'], $arguments['attachmentId']);
        return $arguments;
    }

    /** @return array<string, mixed> */
    private function ownedAttachment(string $attachmentId): array
    {
        $user = $this->auth->requireUser();
        $attachment = $this->database->fetchOne(
            "SELECT id, original_name, storage_path, mime_type, size_bytes FROM agent_attachments WHERE id = :id AND user_id = :user_id AND retention_state = 'active' AND deleted_at IS NULL LIMIT 1",
            [':id' => $attachmentId, ':user_id' => (string) ($user['id'] ?? '')]
        );
        if ($attachment === null) throw new RuntimeException('The selected attachment is not available to this user.');
        return $attachment;
    }

    private function isDependencyReference(mixed $value): bool
    {
        return (is_array($value) && isset($value['$fromStep']))
            || (is_string($value) && preg_match('/^\{\{step:\d+:result(?:\.[A-Za-z0-9_.-]+)?\}\}$/', trim($value)) === 1);
    }

    private function assertReferencedRecordExists(string $action, array $arguments): void
    {
        if (str_starts_with($action, 'create')) return;
        $idValue = $arguments['id'] ?? '';
        if (($idValue === '' || $idValue === null) && (str_contains($action, 'Order') || str_contains($action, 'Survey') || str_contains($action, 'Courier') || str_contains($action, 'Steadfast') || str_contains($action, 'CarryBee') || str_contains($action, 'Paperfly') || str_contains($action, 'Pathao'))) $idValue = $arguments['orderId'] ?? '';
        if (($idValue === '' || $idValue === null) && str_contains($action, 'Bill')) $idValue = $arguments['billId'] ?? '';
        if (($idValue === '' || $idValue === null) && str_contains($action, 'Transaction')) $idValue = $arguments['transactionId'] ?? '';
        if (($idValue === '' || $idValue === null) && str_contains($action, 'Fraud')) $idValue = $arguments['customerId'] ?? '';
        if ($this->isDependencyReference($idValue)) return;
        $id = trim((string) $idValue);
        if ($id === '') return;
        $table = match (true) {
            str_contains($action, 'Customer') => 'customers', str_contains($action, 'Vendor') => 'vendors',
            str_contains($action, 'Product') => 'products', str_contains($action, 'Order') => 'orders',
            str_contains($action, 'Bill') => 'bills', str_contains($action, 'Transaction') => 'transactions',
            str_contains($action, 'Account') => 'accounts', str_contains($action, 'Category') => 'categories',
            str_contains($action, 'Unit') => 'units', str_contains($action, 'Survey') => 'orders',
            str_contains($action, 'Steadfast') || str_contains($action, 'CarryBee') || str_contains($action, 'Paperfly') || str_contains($action, 'Pathao') => 'orders',
            str_contains($action, 'Fraud') => 'customers', default => '',
        };
        if ($table === '') return;
        $softDeleted = in_array($table, ['customers', 'vendors', 'products', 'orders', 'bills', 'transactions'], true);
        $row = $this->database->fetchOne('SELECT id FROM `' . $table . '` WHERE id = :id' . ($softDeleted ? ' AND deleted_at IS NULL' : '') . ' LIMIT 1', [':id' => $id]);
        if ($row === null) throw new RuntimeException('The selected record no longer exists.');
    }

    private function businessPreview(mixed $value, string $key = '', string $action = ''): mixed
    {
        if ($this->isDependencyReference($value)) {
            $step = is_array($value)
                ? max(1, (int) ($value['$fromStep'] ?? 1))
                : (preg_match('/^\{\{step:(\d+):/', trim((string) $value), $matches) === 1 ? (int) $matches[1] : 1);
            return 'Result from action ' . $step;
        }
        if (!is_array($value)) return $value;
        $result = [];
        foreach ($value as $childKey => $childValue) {
            $name = (string) $childKey;
            if ($this->isSecretKey($name)) continue;
            if (preg_match('/(^id$|Id$|_id$)/', $name) === 1 && is_string($childValue)) {
                if ($name === 'id' && str_starts_with($action, 'create')) continue;
                $label = $this->resolveRecordLabel($name, $childValue, $action);
                $result[preg_replace('/Id$|_id$/', '', $name) ?: 'record'] = $label ?: 'Selected record';
                continue;
            }
            $result[$name] = $this->businessPreview($childValue, $name, $action);
        }
        return $result;
    }

    private function resolveRecordLabel(string $key, string $id, string $action = ''): string
    {
        $lookup = strtolower($key . ' ' . $action);
        $table = match (true) {
            str_contains($lookup, 'customer') => 'customers', str_contains($lookup, 'vendor') => 'vendors',
            str_contains($lookup, 'product') => 'products', str_contains($lookup, 'order') => 'orders',
            str_contains($lookup, 'bill') => 'bills', str_contains($lookup, 'account') || str_contains($lookup, 'transfer') => 'accounts',
            str_contains($lookup, 'transaction') => 'transactions', str_contains($lookup, 'category') => 'categories', str_contains($lookup, 'unit') => 'units',
            str_contains($lookup, 'user') || str_contains($lookup, 'employee') => 'users',
            str_contains($lookup, 'attachment') => 'agent_attachments', default => '',
        };
        if ($table === '') return '';
        $labelColumn = match ($table) { 'orders' => 'order_number', 'bills' => 'bill_number', 'transactions' => 'transaction_id', 'agent_attachments' => 'original_name', default => 'name' };
        $row = $this->database->fetchOne('SELECT `' . $labelColumn . '` AS label FROM `' . $table . '` WHERE id = :id LIMIT 1', [':id' => $id]);
        return trim((string) ($row['label'] ?? ''));
    }

    private function compactResult(mixed $result): array
    {
        $redacted = $this->redact($result);
        if (!is_array($redacted)) return ['result' => $redacted];
        if (array_is_list($redacted) && count($redacted) > 50) return ['records' => array_slice($redacted, 0, 50), 'total' => count($redacted), 'truncated' => true];
        foreach (['data', 'items', 'records'] as $key) {
            if (is_array($redacted[$key] ?? null) && array_is_list($redacted[$key]) && count($redacted[$key]) > 50) {
                $total = count($redacted[$key]);
                $redacted[$key] = array_slice($redacted[$key], 0, 50);
                $redacted['truncated'] = true;
                $redacted['totalAvailable'] = $total;
            }
        }
        return $redacted;
    }

    private function redact(mixed $value): mixed
    {
        if (!is_array($value)) {
            if (is_string($value) && strlen($value) > 4000) return mb_substr($value, 0, 4000) . '...';
            return $value;
        }
        $safe = [];
        foreach ($value as $key => $child) {
            if ($this->isSecretKey((string) $key)) continue;
            $safe[$key] = $this->redact($child);
        }
        return $safe;
    }

    private function isSecretKey(string $key): bool
    {
        return preg_match('/password|secret|token|api.?key|consumer.?key|credential|authorization|webhook|private.?key|raw.?payload|data.?url|storage.?path|file.?path/i', $key) === 1;
    }

    private function permissionForAction(string $action): string|array|null
    {
        return match (true) {
            $action === 'fetchDashboardSnapshot' => ['dashboard.viewAdmin', 'dashboard.viewEmployee'],
            str_contains($action, 'Report') => 'reports.view',
            str_starts_with($action, 'fetchLead') => 'leads.view',
            $action === 'analyzeLead' || $action === 'markLeadSuggestionSent' => 'leads.edit',
            str_starts_with($action, 'fetchMeta') || $action === 'fetchMarketingDashboard' => 'marketing.view',
            $action === 'syncMetaAds' => 'marketing.syncAds',
            str_contains($action, 'Order') && str_starts_with($action, 'fetch') => 'orders.view',
            $action === 'createOrder' => 'orders.create',
            $action === 'updateOrder' => ['orders.editOwn', 'orders.editAny', 'orders.cancelOwn', 'orders.cancelAny', 'orders.moveOnHoldToProcessingOwn', 'orders.moveOnHoldToProcessingAny', 'orders.sendToCourierOwn', 'orders.sendToCourierAny', 'orders.moveToPickedOwn', 'orders.moveToPickedAny'],
            $action === 'deleteOrder' => ['orders.deleteOwn', 'orders.deleteAny'],
            $action === 'completePickedOrder' => ['orders.markCompletedOwn', 'orders.markCompletedAny'],
            $action === 'processOrderReturnExchange' => ['orders.processReturnExchangeOwn', 'orders.processReturnExchangeAny'],
            str_contains($action, 'Customer') && str_starts_with($action, 'fetch') => 'customers.view',
            $action === 'createCustomer' => 'customers.create', $action === 'updateCustomer' => 'customers.edit', $action === 'deleteCustomer' => 'customers.delete',
            str_contains($action, 'Product') && str_starts_with($action, 'fetch') => 'products.view',
            $action === 'createProduct' => 'products.create', $action === 'updateProduct' => 'products.edit', $action === 'deleteProduct' => 'products.delete',
            str_contains($action, 'Category') || str_contains($action, 'Unit') => ['products.view', 'products.create', 'products.edit', 'products.delete'],
            str_contains($action, 'Bill') && str_starts_with($action, 'fetch') => 'bills.view',
            $action === 'createBill' => 'bills.create', $action === 'updateBill' => ['bills.editOwn', 'bills.editAny', 'bills.cancelOwn', 'bills.cancelAny', 'bills.moveOnHoldToProcessingOwn', 'bills.moveOnHoldToProcessingAny', 'bills.markReceivedOwn', 'bills.markReceivedAny', 'bills.markPaidOwn', 'bills.markPaidAny'], $action === 'deleteBill' => ['bills.deleteOwn', 'bills.deleteAny'], $action === 'processBillReturn' => ['bills.processReturnOwn', 'bills.processReturnAny'],
            str_contains($action, 'Vendor') && str_starts_with($action, 'fetch') => 'vendors.view',
            $action === 'createVendor' => 'vendors.create', $action === 'updateVendor' => 'vendors.edit', $action === 'deleteVendor' => 'vendors.delete',
            str_contains($action, 'Account') && str_starts_with($action, 'fetch') => 'accounts.view',
            $action === 'createAccount' => 'accounts.create', $action === 'updateAccount' => 'accounts.edit', $action === 'deleteAccount' => 'accounts.delete',
            str_contains($action, 'Transaction') && str_starts_with($action, 'fetch') => 'transactions.view',
            $action === 'createTransaction' => ['transactions.create', 'transfers.create'], $action === 'updateTransaction' => 'transactions.edit', $action === 'deleteTransaction' => 'transactions.delete',
            $action === 'createTransfer' => 'transfers.create',
            $action === 'fetchEmployeeOrderCounts' => 'payroll.view',
            in_array($action, ['fetchPayrollEmployees', 'fetchPayrollHistory', 'fetchPayrollSummaries'], true) => ['payroll.view', 'wallet.view'],
            str_contains($action, 'Payroll') && str_starts_with($action, 'fetch') => 'payroll.view', $action === 'markPayrollPaid' => 'payroll.pay',
            str_contains($action, 'User') && str_starts_with($action, 'fetch') => ['payroll.view', 'users.view'],
            str_contains($action, 'Wallet') && str_starts_with($action, 'fetch') => 'wallet.view', $action === 'payEmployeeWallet' => 'payroll.pay',
            str_contains($action, 'RecycleBin') && str_starts_with($action, 'fetch') => 'recycleBin.view', $action === 'restoreDeletedItem' => 'recycleBin.restore',
            $action === 'revertOrderStatus' => ['orders.markCompletedOwn', 'orders.markCompletedAny', 'orders.markReturnedOwn', 'orders.markReturnedAny'],
            str_starts_with($action, 'fetchUserActivityPerformance') => 'reports.view',
            str_contains($action, 'Fraud') => 'fraudChecker.check',
            str_starts_with($action, 'fetchCarryBee') || str_starts_with($action, 'fetchSteadfast') || str_starts_with($action, 'fetchPaperfly') || str_starts_with($action, 'fetchPathao') => 'orders.view',
            str_starts_with($action, 'submitCarryBee') || str_starts_with($action, 'submitPaperfly') || $action === 'submitSteadfastOrder' || $action === 'submitPathaoOrder' => ['orders.sendToCourierOwn', 'orders.sendToCourierAny'],
            default => null,
        };
    }

    private function toolName(string $namespace, string $action): string
    {
        $snake = strtolower((string) preg_replace('/(?<!^)[A-Z]/', '_$0', $action));
        return $namespace . '_' . $snake;
    }

    private function descriptionForAction(string $action, bool $isAction): string
    {
        $verb = $isAction ? 'Prepare this existing MamePilot operation for exact user confirmation: ' : 'Read permitted MamePilot business data: ';
        return $verb . strtolower($this->humanize($action)) . '. The existing backend service remains authoritative.';
    }

    private function activityForAction(string $action): string
    {
        $label = $this->humanize($action);
        $label = preg_replace('/^(Fetch|Get|Check) /', 'Loading ', $label) ?: $label;
        return rtrim($label, '.') . '...';
    }

    private function humanize(string $value): string
    {
        return trim((string) preg_replace('/(?<!^)([A-Z])/', ' $1', $value));
    }

    private function effectForAction(string $action): string
    {
        return match (true) {
            str_contains($action, 'Order') => 'May change order status, stock, customer totals, wallet credit, notifications, or courier/automation integrations according to the existing order rules.',
            str_contains($action, 'Bill') => 'May change purchase stock, vendor totals, payment state, and related financial records.',
            str_contains($action, 'Transaction') || str_contains($action, 'Account') => 'May change account balances and financial reporting.',
            str_contains($action, 'Payroll') || str_contains($action, 'Wallet') => 'May create payroll or wallet payments and update employee balances.',
            str_contains($action, 'Message') || str_contains($action, 'WhatsApp') || str_contains($action, 'Messenger') => 'Will send or change messaging data through the configured provider.',
            str_contains($action, 'Courier') || str_contains($action, 'Steadfast') || str_contains($action, 'CarryBee') || str_contains($action, 'Paperfly') || str_contains($action, 'Pathao') => 'Will call the configured courier provider and may update tracking/status fields.',
            str_contains($action, 'sync') || str_contains($action, 'Sync') => 'Will contact the configured integration and persist synchronized records or statuses.',
            default => 'Will change MamePilot business data using the same validation and side effects as the normal application.',
        };
    }
}
