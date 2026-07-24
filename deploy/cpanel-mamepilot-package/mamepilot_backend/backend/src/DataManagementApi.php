<?php

declare(strict_types=1);

namespace App;

use RuntimeException;
use Throwable;

final class DataManagementApi extends BaseService
{
    private const MAX_IMPORT_ROWS = 250;

    /**
     * @return array<string, array<string, mixed>>
     */
    private function datasetDefinitions(): array
    {
        return [
            'orders' => [
                'label' => 'Orders',
                'description' => 'One row per order item. Reuse the same Order Number for additional items; missing customers and products are created automatically. Existing orders are never changed.',
                'fields' => [
                    $this->field('orderNumber', 'Order Number', true, ['order no', 'invoice number']),
                    $this->field('orderDate', 'Order Date', true, ['date'], 'date'),
                    $this->field('customerName', 'Customer Name', true, ['client name']),
                    $this->field('customerPhone', 'Customer Phone', true, ['phone', 'mobile', 'customer mobile']),
                    $this->field('customerAddress', 'Customer Address', false, ['delivery address']),
                    $this->field('companyPage', 'Company Page', false, ['page', 'brand']),
                    $this->field('status', 'Status', true, ['order status']),
                    $this->field('productName', 'Product Name', true, ['product', 'item name']),
                    $this->field('quantity', 'Quantity', true, ['qty'], 'number'),
                    $this->field('rate', 'Rate', true, ['price', 'unit price'], 'number'),
                    $this->field('discount', 'Discount', false, [], 'number'),
                    $this->field('shipping', 'Shipping', false, ['shipping cost', 'delivery charge'], 'number'),
                    $this->field('paidAmount', 'Paid Amount', false, ['paid'], 'number'),
                    $this->field('notes', 'Notes', false, ['note']),
                    $this->field('courier', 'Courier', false, ['courier service']),
                    $this->field('trackingNumber', 'Tracking Number', false, ['consignment id', 'tracking id']),
                    $this->field('sourceAd', 'Source Ad', false, ['ad source']),
                ],
                'sampleRow' => [
                    'orderNumber' => 'ORD-1001', 'orderDate' => '2026-07-22', 'customerName' => 'Rahim Ahmed',
                    'customerPhone' => '01700000000', 'customerAddress' => 'Dhanmondi, Dhaka', 'companyPage' => '',
                    'status' => 'On Hold', 'productName' => 'Premium T-Shirt', 'quantity' => '2', 'rate' => '850',
                    'discount' => '100', 'shipping' => '80', 'paidAmount' => '500', 'notes' => 'Call before delivery',
                    'courier' => '', 'trackingNumber' => '', 'sourceAd' => 'Facebook',
                ],
            ],
            'products' => [
                'label' => 'Products',
                'description' => 'Product catalog with human-readable category and unit names. Existing products are skipped, not overwritten.',
                'fields' => [
                    $this->field('name', 'Product Name', true, ['name', 'item name']),
                    $this->field('image', 'Image URL', false, ['image', 'photo']),
                    $this->field('category', 'Category', false, ['product category']),
                    $this->field('unitName', 'Unit Name', false, ['unit']),
                    $this->field('salePrice', 'Sale Price', true, ['selling price', 'price'], 'number'),
                    $this->field('purchasePrice', 'Purchase Price', false, ['cost price', 'buy price'], 'number'),
                    $this->field('stock', 'Stock', false, ['quantity', 'qty'], 'number'),
                    $this->field('dynamicPricing', 'Dynamic Pricing JSON', false, ['dynamic pricing'], 'json'),
                ],
                'sampleRow' => [
                    'name' => 'Premium T-Shirt', 'image' => '', 'category' => 'Clothing', 'unitName' => 'Piece',
                    'salePrice' => '850', 'purchasePrice' => '500', 'stock' => '25', 'dynamicPricing' => '',
                ],
            ],
            'customers' => [
                'label' => 'Customers',
                'description' => 'Customer contact details. Existing phone numbers are skipped; order counts and due amounts are calculated by the app.',
                'fields' => [
                    $this->field('name', 'Customer Name', true, ['name', 'client name']),
                    $this->field('phone', 'Customer Phone', true, ['phone', 'mobile', 'mobile number']),
                    $this->field('address', 'Address', false, ['customer address']),
                ],
                'sampleRow' => ['name' => 'Rahim Ahmed', 'phone' => '01700000000', 'address' => 'Dhanmondi, Dhaka'],
            ],
            'bills' => [
                'label' => 'Bills',
                'description' => 'One row per bill item. Reuse the same Bill Number for additional items; missing vendors and products are created automatically. Existing bills are never changed.',
                'fields' => [
                    $this->field('billNumber', 'Bill Number', true, ['bill no', 'invoice number']),
                    $this->field('billDate', 'Bill Date', true, ['date'], 'date'),
                    $this->field('vendorName', 'Vendor Name', true, ['supplier name']),
                    $this->field('vendorPhone', 'Vendor Phone', true, ['supplier phone', 'phone']),
                    $this->field('vendorAddress', 'Vendor Address', false, ['supplier address']),
                    $this->field('status', 'Status', true, ['bill status']),
                    $this->field('productName', 'Product Name', true, ['product', 'item name']),
                    $this->field('quantity', 'Quantity', true, ['qty'], 'number'),
                    $this->field('rate', 'Rate', true, ['price', 'unit price'], 'number'),
                    $this->field('discount', 'Discount', false, [], 'number'),
                    $this->field('shipping', 'Shipping', false, ['shipping cost', 'delivery charge'], 'number'),
                    $this->field('paidAmount', 'Paid Amount', false, ['paid'], 'number'),
                    $this->field('notes', 'Notes', false, ['note']),
                ],
                'sampleRow' => [
                    'billNumber' => 'BILL-1001', 'billDate' => '2026-07-22', 'vendorName' => 'Dhaka Supplier',
                    'vendorPhone' => '01800000000', 'vendorAddress' => 'Islampur, Dhaka', 'status' => 'On Hold',
                    'productName' => 'Premium T-Shirt', 'quantity' => '10', 'rate' => '500', 'discount' => '200',
                    'shipping' => '100', 'paidAmount' => '2000', 'notes' => 'Wholesale purchase',
                ],
            ],
            'vendors' => [
                'label' => 'Vendors',
                'description' => 'Vendor contact details. Existing phone numbers are skipped; purchase counts and due amounts are calculated by the app.',
                'fields' => [
                    $this->field('name', 'Vendor Name', true, ['name', 'supplier name']),
                    $this->field('phone', 'Vendor Phone', true, ['phone', 'supplier phone', 'mobile']),
                    $this->field('address', 'Address', false, ['vendor address', 'supplier address']),
                ],
                'sampleRow' => ['name' => 'Dhaka Supplier', 'phone' => '01800000000', 'address' => 'Islampur, Dhaka'],
            ],
            'transactions' => [
                'label' => 'Transactions',
                'description' => 'Income, expenses, and transfers using account names. Missing accounts are created automatically and existing transactions are never reapplied.',
                'fields' => [
                    $this->field('transactionId', 'Transaction ID', false, ['reference number', 'transaction no']),
                    $this->field('date', 'Date', true, ['transaction date'], 'datetime'),
                    $this->field('type', 'Type', true, ['transaction type']),
                    $this->field('category', 'Category', true, ['transaction category']),
                    $this->field('accountName', 'Account Name', true, ['account', 'from account']),
                    $this->field('accountType', 'Account Type', false, ['from account type']),
                    $this->field('toAccountName', 'To Account Name', false, ['destination account', 'to account']),
                    $this->field('toAccountType', 'To Account Type', false, ['destination account type']),
                    $this->field('amount', 'Amount', true, ['transaction amount'], 'number'),
                    $this->field('description', 'Description', true, ['details', 'note']),
                    $this->field('referenceNumber', 'Reference Number', false, ['order number', 'bill number']),
                    $this->field('contactPhone', 'Contact Phone', false, ['customer phone', 'vendor phone']),
                    $this->field('paymentMethod', 'Payment Method', true, ['payment mode', 'method']),
                    $this->field('attachmentName', 'Attachment Name', false, ['file name']),
                    $this->field('attachmentUrl', 'Attachment URL', false, ['attachment', 'file url']),
                    $this->field('approvalStatus', 'Approval Status', false, ['approval']),
                ],
                'sampleRow' => [
                    'transactionId' => 'TXN-1001', 'date' => '2026-07-22 10:30:00', 'type' => 'Income',
                    'category' => 'Sales', 'accountName' => 'Cash', 'accountType' => 'Cash',
                    'toAccountName' => '', 'toAccountType' => '', 'amount' => '1700',
                    'description' => 'Payment for Order ORD-1001', 'referenceNumber' => 'ORD-1001',
                    'contactPhone' => '01700000000', 'paymentMethod' => 'Cash', 'attachmentName' => '',
                    'attachmentUrl' => '', 'approvalStatus' => 'approved',
                ],
            ],
            'accounts' => [
                'label' => 'Accounts',
                'description' => 'Bank and cash accounts. Existing account names are skipped so their balances are never overwritten.',
                'fields' => [
                    $this->field('name', 'Account Name', true, ['name', 'bank name', 'cash account']),
                    $this->field('type', 'Account Type', true, ['type']),
                    $this->field('openingBalance', 'Opening Balance', false, ['starting balance'], 'number'),
                    $this->field('currentBalance', 'Current Balance', false, ['balance'], 'number'),
                ],
                'sampleRow' => [
                    'name' => 'Main Cash', 'type' => 'Cash', 'openingBalance' => '10000', 'currentBalance' => '12500',
                ],
            ],
            'users' => [
                'label' => 'Users',
                'description' => 'User profiles and roles. Existing phone numbers are skipped. Passwords are never exported; a password is required only for a brand-new user.',
                'fields' => [
                    $this->field('name', 'User Name', true, ['name', 'employee name']),
                    $this->field('phone', 'Phone', true, ['mobile', 'mobile number']),
                    $this->field('role', 'Role', true, ['user role']),
                    $this->field('password', 'Password For New User', false, ['password'], 'password'),
                    $this->field('image', 'Image URL', false, ['image', 'photo']),
                    $this->field('email', 'Email', false, ['email address']),
                    $this->field('address', 'Address'),
                    $this->field('birthday', 'Birthday', false, ['date of birth', 'dob'], 'date'),
                    $this->field('nidPassportCopy', 'NID or Passport URL', false, ['nid', 'passport']),
                    $this->field('gender', 'Gender'),
                    $this->field('bloodGroup', 'Blood Group', false, ['blood']),
                    $this->field('nationality', 'Nationality'),
                    $this->field('cv', 'CV URL', false, ['cv', 'resume']),
                    $this->field('isCommissionBased', 'Commission Based', false, ['is commission based'], 'boolean'),
                    $this->field('fixedSalary', 'Fixed Salary', false, ['salary', 'monthly salary'], 'number'),
                ],
                'sampleRow' => [
                    'name' => 'Karim Hasan', 'phone' => '01900000000', 'role' => 'Employee',
                    'password' => 'ChangeMe123!', 'image' => '', 'email' => 'karim@example.com',
                    'address' => 'Mirpur, Dhaka', 'birthday' => '1995-05-15', 'nidPassportCopy' => '',
                    'gender' => 'Male', 'bloodGroup' => 'B+', 'nationality' => 'Bangladeshi', 'cv' => '',
                    'isCommissionBased' => 'yes', 'fixedSalary' => '',
                ],
            ],
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function field(
        string $key,
        string $label,
        bool $required = false,
        array $aliases = [],
        ?string $format = null,
        ?string $requiredGroup = null
    ): array {
        return array_filter([
            'key' => $key,
            'label' => $label,
            'required' => $required,
            'aliases' => array_values($aliases),
            'format' => $format,
            'requiredGroup' => $requiredGroup,
        ], static fn($value): bool => $value !== null);
    }

    public function fetchDataManagementSchemas(array $params = []): array
    {
        $this->requireAdmin();
        $datasets = [];
        foreach ($this->datasetDefinitions() as $key => $definition) {
            $datasets[] = [
                'key' => $key,
                'label' => $definition['label'],
                'description' => $definition['description'],
                'fields' => $definition['fields'],
                'sampleRow' => $definition['sampleRow'],
            ];
        }

        return [
            'schemaVersion' => 3,
            'datasets' => $datasets,
            'settingsTabs' => array_values(array_map(
                static fn(array $definition): array => [
                    'key' => $definition['key'],
                    'label' => $definition['label'],
                    'description' => $definition['description'],
                ],
                $this->settingsTabDefinitions()
            )),
        ];
    }

    public function exportDataRecords(array $params): array
    {
        $this->requireAdmin();
        $entity = $this->requireDataset((string) ($params['entity'] ?? ''));
        $rows = match ($entity) {
            'orders' => $this->exportOrders(),
            'products' => $this->exportProducts(),
            'customers' => $this->exportCustomers(),
            'bills' => $this->exportBills(),
            'vendors' => $this->exportVendors(),
            'transactions' => $this->exportTransactions(),
            'accounts' => $this->exportAccounts(),
            'users' => $this->exportUsers(),
        };
        $definition = $this->datasetDefinitions()[$entity];

        return [
            'app' => 'MamePilot',
            'schemaVersion' => 3,
            'entity' => $entity,
            'exportedAt' => gmdate('c'),
            'filename' => sprintf('mamepilot-%s-%s.csv', $entity, gmdate('Y-m-d-His')),
            'fields' => $definition['fields'],
            'rows' => $rows,
        ];
    }

    public function importDataRecords(array $params): array
    {
        $actor = $this->requireAdmin();
        $entity = $this->requireDataset((string) ($params['entity'] ?? ''));
        $rows = is_array($params['rows'] ?? null) ? array_values($params['rows']) : [];
        if ($rows === []) {
            throw new RuntimeException('The import batch does not contain any rows.');
        }
        if (count($rows) > self::MAX_IMPORT_ROWS) {
            throw new RuntimeException('Import batches can contain at most ' . self::MAX_IMPORT_ROWS . ' rows.');
        }
        $rowOffset = max(0, (int) ($params['rowOffset'] ?? 0));
        $result = [
            'entity' => $entity,
            'processed' => count($rows),
            'created' => 0,
            'skipped' => 0,
            'failed' => 0,
            'errors' => [],
        ];

        $workItems = $this->prepareImportWorkItems($entity, $rows, $rowOffset);

        return $this->database->transaction(function () use ($actor, $entity, $workItems, $result): array {
            foreach ($workItems as $workItem) {
                $rawRow = $workItem['row'];
                $csvRowNumber = (int) $workItem['csvRow'];
                $sourceRowCount = (int) $workItem['sourceRowCount'];

                try {
                    $this->database->execute('SAVEPOINT data_import_row');
                    $operation = match ($entity) {
                        'orders' => $this->importOrder($rawRow, $actor),
                        'products' => $this->importProduct($rawRow, $actor),
                        'customers' => $this->importCustomer($rawRow, $actor),
                        'bills' => $this->importBill($rawRow, $actor),
                        'vendors' => $this->importVendor($rawRow, $actor),
                        'transactions' => $this->importTransaction($rawRow, $actor),
                        'accounts' => $this->importAccount($rawRow),
                        'users' => $this->importUser($rawRow),
                    };
                    $this->database->execute('RELEASE SAVEPOINT data_import_row');
                    $result[$operation]++;
                } catch (Throwable $exception) {
                    try {
                        $this->database->execute('ROLLBACK TO SAVEPOINT data_import_row');
                        $this->database->execute('RELEASE SAVEPOINT data_import_row');
                    } catch (Throwable $ignored) {
                        // If the database already released the savepoint, keep the
                        // original row error because it is the actionable failure.
                    }
                    $result['failed'] += $sourceRowCount;
                    if (count($result['errors']) < 100) {
                        $result['errors'][] = [
                            'row' => $csvRowNumber,
                            'message' => $this->safeImportError($exception),
                        ];
                    }
                }
            }

            return $result;
        });
    }

    /** @return array<string, array<string, mixed>> */
    private function settingsTabDefinitions(): array
    {
        return [
            'company' => [
                'key' => 'company', 'label' => 'Company',
                'description' => 'Company pages, branding, contact details, and logos.',
                'tables' => ['company_settings'],
            ],
            'order' => [
                'key' => 'order', 'label' => 'Order & Invoice',
                'description' => 'Order numbering and invoice layout settings.',
                'tables' => ['order_settings', 'invoice_settings'],
            ],
            'defaults' => [
                'key' => 'defaults', 'label' => 'Defaults',
                'description' => 'Default account, payment, categories, paging, and display preferences.',
                'tables' => ['system_defaults'],
            ],
            'be-smart' => [
                'key' => 'be-smart', 'label' => 'Be Smart',
                'description' => 'Smart customer and vendor entry preferences.',
                'tables' => ['be_smart_settings'],
            ],
            'wallet' => [
                'key' => 'wallet', 'label' => 'Wallet',
                'description' => 'Employee wallet amount and payable order statuses.',
                'tables' => ['payroll_settings'],
            ],
            'meta-ads' => [
                'key' => 'meta-ads', 'label' => 'Meta Ads',
                'description' => 'Meta Ads application, OAuth, currency, and reporting settings.',
                'tables' => ['meta_ads_settings'],
            ],
            'whatsapp' => [
                'key' => 'whatsapp', 'label' => 'WhatsApp',
                'description' => 'WhatsApp Cloud API credentials and profile settings.',
                'tables' => ['whatsapp_settings'],
            ],
            'messenger' => [
                'key' => 'messenger', 'label' => 'Messenger',
                'description' => 'Facebook Page Messenger credentials, profile, and welcome settings.',
                'tables' => ['messenger_settings'],
            ],
            'woocommerce' => [
                'key' => 'woocommerce', 'label' => 'WooCommerce',
                'description' => 'Configured WooCommerce stores and webhook settings.',
                'tables' => ['woocommerce_stores'],
            ],
            'permissions' => [
                'key' => 'permissions', 'label' => 'Permissions',
                'description' => 'Built-in and custom role permission settings.',
                'tables' => ['role_permissions'],
            ],
            'categories' => [
                'key' => 'categories', 'label' => 'Categories',
                'description' => 'Income and expense categories, including parent relationships.',
                'tables' => ['categories'],
            ],
            'payments' => [
                'key' => 'payments', 'label' => 'Payment Methods',
                'description' => 'Payment methods and their active state.',
                'tables' => ['payment_methods'],
            ],
            'units' => [
                'key' => 'units', 'label' => 'Units',
                'description' => 'Product units and fractional quantity settings.',
                'tables' => ['units'],
            ],
            'courier' => [
                'key' => 'courier', 'label' => 'Courier',
                'description' => 'Courier providers, Fraud Checker, and provider credentials.',
                'tables' => ['courier_settings'],
            ],
            'voice-survey' => [
                'key' => 'voice-survey', 'label' => 'Voice Survey',
                'description' => 'Automatic calling, retry, trigger, and integration settings.',
                'tables' => ['voice_survey_settings'],
            ],
        ];
    }

    /** @return array<int, string> */
    private function requireSettingsTabs($value): array
    {
        $requested = is_array($value) ? array_values($value) : [];
        $definitions = $this->settingsTabDefinitions();
        $selected = [];
        foreach ($requested as $key) {
            $key = trim((string) $key);
            if (isset($definitions[$key]) && !in_array($key, $selected, true)) {
                $selected[] = $key;
            }
        }
        if ($selected === []) {
            throw new RuntimeException('Select at least one Settings tab.');
        }
        return $selected;
    }

    /** @return array<string, mixed> */
    public function exportSettingsPackage(array $params): array
    {
        $this->requireAdmin();
        $selected = $this->requireSettingsTabs($params['tabs'] ?? []);
        $definitions = $this->settingsTabDefinitions();
        $tabs = [];
        foreach ($selected as $key) {
            $definition = $definitions[$key];
            $tables = [];
            foreach ($definition['tables'] as $table) {
                if (!$this->tableExists($table)) {
                    throw new RuntimeException($definition['label'] . ' settings are not available in this installation.');
                }
                $tables[$table] = $this->database->fetchAll("SELECT * FROM `{$table}` ORDER BY 1 ASC");
            }
            $tab = [
                'label' => $definition['label'],
                'tables' => $tables,
            ];
            if ($key === 'defaults') {
                $tab['references'] = $this->exportDefaultSettingReferences($tables['system_defaults'][0] ?? []);
            } elseif ($key === 'woocommerce') {
                $tab['references'] = ['companyPages' => $this->companyPageNames()];
            }
            $tabs[$key] = $tab;
        }

        return [
            'app' => 'MamePilot',
            'schemaVersion' => 1,
            'entity' => 'settings',
            'exportedAt' => gmdate('c'),
            'filename' => sprintf('mamepilot-settings-%s.json', gmdate('Y-m-d-His')),
            'tabs' => $tabs,
        ];
    }

    /** @return array<string, mixed> */
    private function exportDefaultSettingReferences(array $row): array
    {
        $accountId = trim((string) ($row['default_account_id'] ?? ''));
        $incomeCategoryId = trim((string) ($row['income_category_id'] ?? ''));
        $expenseCategoryId = trim((string) ($row['expense_category_id'] ?? ''));
        return [
            'defaultAccount' => $accountId !== ''
                ? $this->database->fetchOne('SELECT * FROM accounts WHERE id = :id LIMIT 1', [':id' => $accountId])
                : null,
            'incomeCategory' => $incomeCategoryId !== ''
                ? $this->database->fetchOne('SELECT * FROM categories WHERE id = :id LIMIT 1', [':id' => $incomeCategoryId])
                : null,
            'expenseCategory' => $expenseCategoryId !== ''
                ? $this->database->fetchOne('SELECT * FROM categories WHERE id = :id LIMIT 1', [':id' => $expenseCategoryId])
                : null,
        ];
    }

    /** @return array<string, mixed> */
    public function importSettingsPackage(array $params): array
    {
        $this->requireAdmin();
        $selected = $this->requireSettingsTabs($params['selectedTabs'] ?? []);
        $package = is_array($params['package'] ?? null) ? $params['package'] : [];
        if (($package['app'] ?? null) !== 'MamePilot' || ($package['entity'] ?? null) !== 'settings') {
            throw new RuntimeException('Select a MamePilot Settings export file.');
        }
        $packageTabs = is_array($package['tabs'] ?? null) ? $package['tabs'] : [];
        $definitions = $this->settingsTabDefinitions();
        $result = [
            'processed' => count($selected),
            'imported' => 0,
            'skipped' => 0,
            'failed' => 0,
            'recordsCreated' => 0,
            'recordsSkipped' => 0,
            'errors' => [],
        ];

        return $this->database->transaction(function () use ($selected, $packageTabs, $definitions, $result): array {
            foreach ($selected as $key) {
                $definition = $definitions[$key];
                try {
                    if (!isset($packageTabs[$key]) || !is_array($packageTabs[$key])) {
                        throw new RuntimeException($definition['label'] . ' is not included in this Settings file.');
                    }
                    $this->database->execute('SAVEPOINT settings_import_tab');
                    $counts = $this->importSettingsTab($key, $packageTabs[$key], $definition);
                    $this->database->execute('RELEASE SAVEPOINT settings_import_tab');
                    $result['recordsCreated'] += $counts['created'];
                    $result['recordsSkipped'] += $counts['skipped'];
                    if ($counts['created'] > 0) {
                        $result['imported']++;
                    } else {
                        $result['skipped']++;
                    }
                } catch (Throwable $exception) {
                    try {
                        $this->database->execute('ROLLBACK TO SAVEPOINT settings_import_tab');
                        $this->database->execute('RELEASE SAVEPOINT settings_import_tab');
                    } catch (Throwable $ignored) {
                        // Preserve the actionable tab error.
                    }
                    $result['failed']++;
                    $result['errors'][] = [
                        'tab' => $key,
                        'label' => $definition['label'],
                        'message' => $this->safeImportError($exception),
                    ];
                }
            }
            return $result;
        });
    }

    /** @return array{created: int, skipped: int} */
    private function importSettingsTab(string $key, array $payload, array $definition): array
    {
        $tables = is_array($payload['tables'] ?? null) ? $payload['tables'] : [];
        $counts = ['created' => 0, 'skipped' => 0];
        foreach ($definition['tables'] as $table) {
            if (!$this->tableExists($table)) {
                throw new RuntimeException($definition['label'] . ' settings are not available in this installation.');
            }
            $rows = is_array($tables[$table] ?? null) ? array_values($tables[$table]) : [];
            if ($table === 'categories') {
                $tableCounts = $this->importSettingsCategories($rows);
            } elseif ($table === 'payment_methods') {
                $tableCounts = $this->importSettingsPaymentMethods($rows);
            } elseif ($table === 'units') {
                $tableCounts = $this->importSettingsUnits($rows);
            } elseif ($table === 'role_permissions') {
                $tableCounts = $this->importSettingsPermissions($rows);
            } elseif ($table === 'woocommerce_stores') {
                $references = is_array($payload['references'] ?? null) ? $payload['references'] : [];
                $tableCounts = $this->importSettingsWooCommerceStores($rows, $references);
            } else {
                $row = isset($rows[0]) && is_array($rows[0]) ? $rows[0] : [];
                if ($table === 'system_defaults') {
                    $references = is_array($payload['references'] ?? null) ? $payload['references'] : [];
                    $row = $this->resolveImportedDefaultSettings($row, $references);
                } elseif ($table === 'company_settings') {
                    $row = $this->normalizeImportedCompanySettings($row);
                }
                $tableCounts = $row === [] ? ['created' => 0, 'skipped' => 1] : $this->mergeSettingsSingleton($table, $row);
                if ($table === 'company_settings' && $tableCounts['created'] > 0) {
                    $this->purgeImportedBrandingCache();
                }
            }
            $counts['created'] += $tableCounts['created'];
            $counts['skipped'] += $tableCounts['skipped'];
        }
        return $counts;
    }

    private function purgeImportedBrandingCache(): void
    {
        $cacheKey = 'mamepilot:global-branding:' . hash('sha256', __DIR__);
        if (function_exists('apcu_delete')) {
            @apcu_delete($cacheKey);
        }
        $cachePath = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
            . DIRECTORY_SEPARATOR
            . 'mamepilot_global_branding_' . hash('sha256', __DIR__) . '.json';
        if (is_file($cachePath)) {
            @unlink($cachePath);
        }
    }

    /** @return array<string, mixed> */
    private function normalizeImportedCompanySettings(array $row): array
    {
        if (isset($row['logo'])) {
            $row['logo'] = $this->normalizeUploadedFileValue($this->nullableString($row['logo']), 'logos');
        }
        $pages = $this->jsonDecodeList($row['pages'] ?? []);
        foreach ($pages as $index => $page) {
            if (!is_array($page)) {
                continue;
            }
            $page['logo'] = $this->normalizeUploadedFileValue($this->nullableString($page['logo'] ?? null), 'logos') ?? '';
            $pages[$index] = $page;
        }
        if ($pages !== []) {
            $row['pages'] = $this->jsonEncode($pages);
        }
        return $row;
    }

    /** @return array<string, mixed> */
    private function resolveImportedDefaultSettings(array $row, array $references): array
    {
        $account = is_array($references['defaultAccount'] ?? null) ? $references['defaultAccount'] : null;
        if ($account !== null) {
            $accountRow = [
                'name' => $account['name'] ?? '',
                'type' => $account['type'] ?? 'Bank',
                'openingBalance' => $account['opening_balance'] ?? 0,
                'currentBalance' => $account['current_balance'] ?? ($account['opening_balance'] ?? 0),
            ];
            $this->importAccount($accountRow);
            $matched = $this->database->fetchOne(
                'SELECT id FROM accounts WHERE LOWER(name) = LOWER(:name) ORDER BY created_at ASC LIMIT 1',
                [':name' => trim((string) $accountRow['name'])]
            );
            $row['default_account_id'] = $matched['id'] ?? null;
        } else {
            $row['default_account_id'] = null;
        }
        foreach (['incomeCategory' => 'income_category_id', 'expenseCategory' => 'expense_category_id'] as $referenceKey => $column) {
            $category = is_array($references[$referenceKey] ?? null) ? $references[$referenceKey] : null;
            if ($category === null) {
                $row[$column] = null;
                continue;
            }
            $row[$column] = $this->resolveOrCreateSettingsCategory($category)['id'];
        }
        $paymentMethod = trim((string) ($row['default_payment_method'] ?? ''));
        if ($paymentMethod !== '' && $this->database->fetchOne(
            'SELECT id FROM payment_methods WHERE LOWER(name) = LOWER(:name) LIMIT 1',
            [':name' => $paymentMethod]
        ) === null) {
            $this->insertSettingsRow('payment_methods', [
                'id' => $this->uuid4(), 'name' => $paymentMethod, 'description' => null, 'is_active' => 1,
            ]);
        }
        return $row;
    }

    /** @return array{created: int, skipped: int} */
    private function mergeSettingsSingleton(string $table, array $source): array
    {
        $columns = $this->settingsTableColumns($table);
        $data = [];
        foreach ($columns as $column) {
            if (in_array($column, ['id', 'created_at', 'updated_at'], true)) {
                continue;
            }
            if (array_key_exists($column, $source)) {
                $data[$column] = $source[$column];
            }
        }
        if ($data === []) {
            return ['created' => 0, 'skipped' => 1];
        }
        $existing = $this->database->fetchOne("SELECT id FROM `{$table}` LIMIT 1");
        if ($existing === null) {
            $this->insertSettingsRow($table, ['id' => $this->uuid4(), ...$data]);
        } else {
            $this->updateSettingsRow($table, (string) $existing['id'], $data);
        }
        return ['created' => 1, 'skipped' => 0];
    }

    /** @return array<int, string> */
    private function settingsTableColumns(string $table): array
    {
        $this->assertSettingsTable($table);
        return array_map(
            static fn(array $row): string => (string) $row['COLUMN_NAME'],
            $this->database->fetchAll(
                'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table ORDER BY ORDINAL_POSITION',
                [':table' => $table]
            )
        );
    }

    private function assertSettingsTable(string $table): void
    {
        $allowed = [];
        foreach ($this->settingsTabDefinitions() as $definition) {
            $allowed = array_merge($allowed, $definition['tables']);
        }
        if (!in_array($table, $allowed, true)) {
            throw new RuntimeException('Unsupported Settings import table.');
        }
    }

    /** @param array<string, mixed> $data */
    private function insertSettingsRow(string $table, array $data): void
    {
        $this->assertSettingsTable($table);
        $allowed = array_flip($this->settingsTableColumns($table));
        $data = array_intersect_key($data, $allowed);
        $columns = [];
        $placeholders = [];
        $bindings = [];
        foreach ($data as $column => $value) {
            $this->assertIdentifier((string) $column);
            $columns[] = '`' . $column . '`';
            $parameter = ':setting_insert_' . count($bindings);
            $placeholders[] = $parameter;
            $bindings[$parameter] = $value;
        }
        $this->database->execute(
            "INSERT INTO `{$table}` (" . implode(', ', $columns) . ') VALUES (' . implode(', ', $placeholders) . ')',
            $bindings
        );
    }

    /** @param array<string, mixed> $data */
    private function updateSettingsRow(string $table, string $id, array $data): void
    {
        $this->assertSettingsTable($table);
        $allowed = array_flip($this->settingsTableColumns($table));
        $data = array_intersect_key($data, $allowed);
        $parts = [];
        $bindings = [':settings_row_id' => $id];
        foreach ($data as $column => $value) {
            $this->assertIdentifier((string) $column);
            $parameter = ':setting_update_' . count($parts);
            $parts[] = '`' . $column . '` = ' . $parameter;
            $bindings[$parameter] = $value;
        }
        if ($parts !== []) {
            $this->database->execute(
                "UPDATE `{$table}` SET " . implode(', ', $parts) . ' WHERE id = :settings_row_id',
                $bindings
            );
        }
    }

    /** @return array{created: int, skipped: int} */
    private function importSettingsCategories(array $rows): array
    {
        $counts = ['created' => 0, 'skipped' => 0];
        $idMap = [];
        $createdIds = [];
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $sourceId = trim((string) ($row['id'] ?? ''));
            $resolved = $this->resolveOrCreateSettingsCategory($row);
            if ($sourceId !== '') {
                $idMap[$sourceId] = $resolved['id'];
            }
            $counts[$resolved['created'] ? 'created' : 'skipped']++;
            if ($resolved['created']) {
                $createdIds[$sourceId] = $resolved['id'];
            }
        }
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $sourceId = trim((string) ($row['id'] ?? ''));
            $sourceParentId = trim((string) ($row['parent_id'] ?? ''));
            if (isset($createdIds[$sourceId], $idMap[$sourceParentId])) {
                $this->updateSettingsRow('categories', $createdIds[$sourceId], ['parent_id' => $idMap[$sourceParentId]]);
            }
        }
        return $counts;
    }

    /** @return array{id: string, created: bool} */
    private function resolveOrCreateSettingsCategory(array $row): array
    {
        $name = trim((string) ($row['name'] ?? ''));
        $type = trim((string) ($row['type'] ?? ''));
        if ($name === '' || $type === '') {
            throw new RuntimeException('A Settings category is missing its name or type.');
        }
        $existing = $this->database->fetchOne(
            'SELECT id FROM categories WHERE LOWER(name) = LOWER(:name) AND LOWER(type) = LOWER(:type) LIMIT 1',
            [':name' => $name, ':type' => $type]
        );
        if ($existing !== null) {
            return ['id' => (string) $existing['id'], 'created' => false];
        }
        $id = $this->uuid4();
        $this->insertSettingsRow('categories', [
            'id' => $id,
            'name' => $name,
            'type' => $type,
            'color' => trim((string) ($row['color'] ?? '')) ?: '#3B82F6',
            'parent_id' => null,
            'is_system' => !empty($row['is_system']) ? 1 : 0,
        ]);
        return ['id' => $id, 'created' => true];
    }

    /** @return array{created: int, skipped: int} */
    private function importSettingsPaymentMethods(array $rows): array
    {
        $counts = ['created' => 0, 'skipped' => 0];
        foreach ($rows as $row) {
            $row = is_array($row) ? $row : [];
            $name = trim((string) ($row['name'] ?? ''));
            if ($name === '') {
                throw new RuntimeException('A payment method is missing its name.');
            }
            if ($this->database->fetchOne('SELECT id FROM payment_methods WHERE LOWER(name) = LOWER(:name) LIMIT 1', [':name' => $name]) !== null) {
                $counts['skipped']++;
                continue;
            }
            $this->insertSettingsRow('payment_methods', [
                'id' => $this->uuid4(), 'name' => $name,
                'description' => $row['description'] ?? null,
                'is_active' => !empty($row['is_active']) ? 1 : 0,
            ]);
            $counts['created']++;
        }
        return $counts;
    }

    /** @return array{created: int, skipped: int} */
    private function importSettingsUnits(array $rows): array
    {
        $counts = ['created' => 0, 'skipped' => 0];
        foreach ($rows as $row) {
            $row = is_array($row) ? $row : [];
            $name = trim((string) ($row['name'] ?? ''));
            $shortName = trim((string) ($row['short_name'] ?? ''));
            if ($name === '' || $shortName === '') {
                throw new RuntimeException('A unit is missing its name or short name.');
            }
            if ($this->database->fetchOne('SELECT id FROM units WHERE LOWER(name) = LOWER(:name) LIMIT 1', [':name' => $name]) !== null) {
                $counts['skipped']++;
                continue;
            }
            if ($this->database->fetchOne('SELECT id FROM units WHERE LOWER(short_name) = LOWER(:name) LIMIT 1', [':name' => $shortName]) !== null) {
                $shortName = substr($shortName, 0, 24) . '-' . substr($this->uuid4(), 0, 6);
            }
            $this->insertSettingsRow('units', [
                'id' => $this->uuid4(), 'name' => $name, 'short_name' => $shortName,
                'description' => $row['description'] ?? null,
                'is_fraction' => !empty($row['is_fraction']) ? 1 : 0,
            ]);
            $counts['created']++;
        }
        return $counts;
    }

    /** @return array{created: int, skipped: int} */
    private function importSettingsPermissions(array $rows): array
    {
        $counts = ['created' => 0, 'skipped' => 0];
        foreach ($rows as $row) {
            $row = is_array($row) ? $row : [];
            $roleName = trim((string) ($row['role_name'] ?? ''));
            if ($roleName === '') {
                throw new RuntimeException('A permission role is missing its name.');
            }
            if ($this->database->fetchOne('SELECT role_name FROM role_permissions WHERE role_name = :name LIMIT 1', [':name' => $roleName]) !== null) {
                $counts['skipped']++;
                continue;
            }
            $this->insertSettingsRow('role_permissions', [
                'role_name' => $roleName,
                'permissions' => $row['permissions'] ?? null,
                'is_custom' => !empty($row['is_custom']) ? 1 : 0,
            ]);
            $counts['created']++;
        }
        return $counts;
    }

    /** @return array{created: int, skipped: int} */
    private function importSettingsWooCommerceStores(array $rows, array $references): array
    {
        $counts = ['created' => 0, 'skipped' => 0];
        $sourcePages = is_array($references['companyPages'] ?? null) ? $references['companyPages'] : [];
        $targetPages = $this->companyPageNames();
        foreach ($rows as $row) {
            $row = is_array($row) ? $row : [];
            $storeUrl = rtrim(trim((string) ($row['store_url'] ?? '')), '/');
            if ($storeUrl === '') {
                throw new RuntimeException('A WooCommerce store is missing its URL.');
            }
            if ($this->database->fetchOne(
                'SELECT id FROM woocommerce_stores WHERE LOWER(TRIM(TRAILING \'/\' FROM store_url)) = LOWER(:url) LIMIT 1',
                [':url' => $storeUrl]
            ) !== null) {
                $counts['skipped']++;
                continue;
            }
            $sourcePageId = trim((string) ($row['company_page_id'] ?? ''));
            $targetPageId = isset($targetPages[$sourcePageId]) ? $sourcePageId : null;
            if ($targetPageId === null && isset($sourcePages[$sourcePageId])) {
                foreach ($targetPages as $candidateId => $candidateName) {
                    if (strcasecmp((string) $candidateName, (string) $sourcePages[$sourcePageId]) === 0) {
                        $targetPageId = $candidateId;
                        break;
                    }
                }
            }
            unset($row['id'], $row['created_at'], $row['updated_at']);
            $row['id'] = $this->uuid4();
            $row['store_url'] = $storeUrl;
            $row['company_page_id'] = $targetPageId;
            $this->insertSettingsRow('woocommerce_stores', $row);
            $counts['created']++;
        }
        return $counts;
    }

    /**
     * @param array<int, mixed> $rows
     * @return array<int, array{row: array<string, mixed>, csvRow: int, sourceRowCount: int}>
     */
    private function prepareImportWorkItems(string $entity, array $rows, int $rowOffset): array
    {
        if (!in_array($entity, ['orders', 'bills'], true)) {
            $items = [];
            foreach ($rows as $index => $row) {
                $csvRow = is_array($row) && isset($row['_csvRow'])
                    ? max(2, (int) $row['_csvRow'])
                    : $rowOffset + $index + 2;
                $items[] = [
                    'row' => is_array($row) ? $row : [],
                    'csvRow' => $csvRow,
                    'sourceRowCount' => 1,
                ];
            }
            return $items;
        }

        $numberKey = $entity === 'orders' ? 'orderNumber' : 'billNumber';
        $groups = [];
        foreach ($rows as $index => $row) {
            $row = is_array($row) ? $row : [];
            $number = trim((string) ($row[$numberKey] ?? ''));
            $csvRow = isset($row['_csvRow']) ? max(2, (int) $row['_csvRow']) : $rowOffset + $index + 2;
            $groupKey = $number !== '' ? strtolower($number) : '__missing_' . $index;
            if (!isset($groups[$groupKey])) {
                $groups[$groupKey] = [
                    'row' => $row,
                    'csvRow' => $csvRow,
                    'sourceRowCount' => 0,
                    'itemRows' => [],
                ];
            }
            foreach ($row as $key => $value) {
                if (trim((string) ($groups[$groupKey]['row'][$key] ?? '')) === '' && trim((string) $value) !== '') {
                    $groups[$groupKey]['row'][$key] = $value;
                }
            }
            $groups[$groupKey]['itemRows'][] = [
                'productName' => (string) ($row['productName'] ?? ''),
                'quantity' => (string) ($row['quantity'] ?? ''),
                'rate' => (string) ($row['rate'] ?? ''),
            ];
            $groups[$groupKey]['sourceRowCount']++;
        }

        $items = [];
        foreach ($groups as $group) {
            $group['row']['_itemRows'] = $group['itemRows'];
            unset($group['itemRows']);
            $items[] = $group;
        }
        return $items;
    }

    private function requireDataset(string $entity): string
    {
        $entity = strtolower(trim($entity));
        if (!array_key_exists($entity, $this->datasetDefinitions())) {
            throw new RuntimeException('Select a supported data type.');
        }
        return $entity;
    }

    private function safeImportError(Throwable $exception): string
    {
        $message = trim($exception->getMessage());
        if ($message === '') {
            return 'The row could not be imported.';
        }
        if (str_contains(strtolower($message), 'duplicate entry')) {
            return 'A record with the same unique value already exists.';
        }
        if (str_contains(strtolower($message), 'foreign key constraint')) {
            return 'A referenced record could not be found.';
        }
        return substr($message, 0, 500);
    }

    /** @return array<int, array<string, mixed>> */
    private function exportOrders(): array
    {
        $documents = $this->database->fetchAll(
            "SELECT o.order_number AS orderNumber,
                    o.order_date AS orderDate,
                    c.phone AS customerPhone,
                    c.name AS customerName,
                    c.address AS customerAddress,
                    o.page_id AS pageId,
                    o.page_snapshot AS pageSnapshotJson,
                    o.status,
                    o.items AS itemsJson,
                    o.discount,
                    o.shipping,
                    o.paid_amount AS paidAmount,
                    o.notes,
                    o.carrybee_consignment_id AS carrybeeConsignmentId,
                    o.steadfast_consignment_id AS steadfastConsignmentId,
                    o.paperfly_tracking_number AS paperflyTrackingNumber,
                    o.pathao_consignment_id AS pathaoConsignmentId,
                    o.source_ad AS sourceAd
             FROM orders o
             LEFT JOIN customers c ON c.id = o.customer_id
             WHERE o.deleted_at IS NULL
             ORDER BY o.created_at ASC, o.id ASC"
        );
        $pageNames = $this->companyPageNames();
        $rows = [];
        foreach ($documents as $document) {
            [$courier, $trackingNumber] = $this->courierAndTracking($document);
            $pageSnapshot = $this->jsonDecodeAssoc($document['pageSnapshotJson'] ?? []);
            $companyPage = $pageNames[(string) ($document['pageId'] ?? '')]
                ?? trim((string) ($pageSnapshot['name'] ?? ''));
            foreach ($this->jsonDecodeList($document['itemsJson'] ?? []) as $item) {
                $rows[] = [
                    'orderNumber' => (string) ($document['orderNumber'] ?? ''),
                    'orderDate' => (string) ($document['orderDate'] ?? ''),
                    'customerName' => (string) ($document['customerName'] ?? ''),
                    'customerPhone' => (string) ($document['customerPhone'] ?? ''),
                    'customerAddress' => (string) ($document['customerAddress'] ?? ''),
                    'companyPage' => $companyPage,
                    'status' => (string) ($document['status'] ?? ''),
                    'productName' => (string) ($item['productName'] ?? ''),
                    'quantity' => $item['quantity'] ?? 0,
                    'rate' => $item['rate'] ?? 0,
                    'discount' => $document['discount'] ?? 0,
                    'shipping' => $document['shipping'] ?? 0,
                    'paidAmount' => $document['paidAmount'] ?? 0,
                    'notes' => (string) ($document['notes'] ?? ''),
                    'courier' => $courier,
                    'trackingNumber' => $trackingNumber,
                    'sourceAd' => (string) ($document['sourceAd'] ?? ''),
                ];
            }
        }
        return $rows;
    }

    /** @return array<int, array<string, mixed>> */
    private function exportProducts(): array
    {
        return $this->database->fetchAll(
            "SELECT p.name,
                    p.image,
                    p.category,
                    un.name AS unitName,
                    p.sale_price AS salePrice,
                    p.purchase_price AS purchasePrice,
                    p.stock,
                    p.dynamic_pricing AS dynamicPricing
             FROM products p
             LEFT JOIN units un ON un.id = p.unit_id
             WHERE p.deleted_at IS NULL
             ORDER BY p.created_at ASC, p.id ASC"
        );
    }

    /** @return array<int, array<string, mixed>> */
    private function exportCustomers(): array
    {
        return $this->database->fetchAll(
            "SELECT c.name,
                    c.phone,
                    c.address
             FROM customers c
             WHERE c.deleted_at IS NULL
             ORDER BY c.created_at ASC, c.id ASC"
        );
    }

    /** @return array<int, array<string, mixed>> */
    private function exportBills(): array
    {
        $documents = $this->database->fetchAll(
            "SELECT b.bill_number AS billNumber,
                    b.bill_date AS billDate,
                    v.phone AS vendorPhone,
                    v.name AS vendorName,
                    v.address AS vendorAddress,
                    b.status,
                    b.items AS itemsJson,
                    b.discount,
                    b.shipping,
                    b.paid_amount AS paidAmount,
                    b.notes
             FROM bills b
             LEFT JOIN vendors v ON v.id = b.vendor_id
             WHERE b.deleted_at IS NULL
             ORDER BY b.created_at ASC, b.id ASC"
        );
        $rows = [];
        foreach ($documents as $document) {
            foreach ($this->jsonDecodeList($document['itemsJson'] ?? []) as $item) {
                $rows[] = [
                    'billNumber' => (string) ($document['billNumber'] ?? ''),
                    'billDate' => (string) ($document['billDate'] ?? ''),
                    'vendorName' => (string) ($document['vendorName'] ?? ''),
                    'vendorPhone' => (string) ($document['vendorPhone'] ?? ''),
                    'vendorAddress' => (string) ($document['vendorAddress'] ?? ''),
                    'status' => (string) ($document['status'] ?? ''),
                    'productName' => (string) ($item['productName'] ?? ''),
                    'quantity' => $item['quantity'] ?? 0,
                    'rate' => $item['rate'] ?? 0,
                    'discount' => $document['discount'] ?? 0,
                    'shipping' => $document['shipping'] ?? 0,
                    'paidAmount' => $document['paidAmount'] ?? 0,
                    'notes' => (string) ($document['notes'] ?? ''),
                ];
            }
        }
        return $rows;
    }

    /** @return array<int, array<string, mixed>> */
    private function exportVendors(): array
    {
        return $this->database->fetchAll(
            "SELECT v.name,
                    v.phone,
                    v.address
             FROM vendors v
             WHERE v.deleted_at IS NULL
             ORDER BY v.created_at ASC, v.id ASC"
        );
    }

    /** @return array<int, array<string, mixed>> */
    private function exportTransactions(): array
    {
        return $this->database->fetchAll(
            "SELECT t.transaction_id AS transactionId,
                    t.date,
                    t.type,
                    t.category,
                    COALESCE(a.name, t.account_name) AS accountName,
                    a.type AS accountType,
                    ta.name AS toAccountName,
                    ta.type AS toAccountType,
                    t.amount,
                    t.description,
                    COALESCE(o.order_number, b.bill_number, '') AS referenceNumber,
                    COALESCE(c.phone, v.phone, '') AS contactPhone,
                    t.payment_method AS paymentMethod,
                    t.attachment_name AS attachmentName,
                    t.attachment_url AS attachmentUrl,
                    t.approval_status AS approvalStatus
             FROM transactions t
             LEFT JOIN accounts a ON a.id = t.account_id
             LEFT JOIN accounts ta ON ta.id = t.to_account_id
             LEFT JOIN orders o ON o.id = t.reference_id
             LEFT JOIN bills b ON b.id = t.reference_id
             LEFT JOIN customers c ON c.id = t.contact_id
             LEFT JOIN vendors v ON v.id = t.contact_id
             WHERE t.deleted_at IS NULL
             ORDER BY t.date ASC, t.created_at ASC, t.id ASC"
        );
    }

    /** @return array<int, array<string, mixed>> */
    private function exportAccounts(): array
    {
        return $this->database->fetchAll(
            "SELECT a.name,
                    a.type,
                    a.opening_balance AS openingBalance,
                    a.current_balance AS currentBalance
             FROM accounts a
             ORDER BY a.created_at ASC, a.id ASC"
        );
    }

    /** @return array<int, array<string, mixed>> */
    private function exportUsers(): array
    {
        return $this->database->fetchAll(
            "SELECT u.name,
                    u.phone,
                    u.role,
                    '' AS password,
                    u.image,
                    u.email,
                    u.address,
                    u.birthday,
                    u.nid_passport_copy AS nidPassportCopy,
                    u.gender,
                    u.blood_group AS bloodGroup,
                    u.nationality,
                    u.cv,
                    u.is_commission_based AS isCommissionBased,
                    u.fixed_salary AS fixedSalary
             FROM users u
             WHERE u.deleted_at IS NULL AND COALESCE(u.is_system, 0) = 0
             ORDER BY u.created_at ASC, u.id ASC"
        );
    }

    /** @return array<string, string> */
    private function companyPageNames(): array
    {
        $settings = $this->database->fetchOne('SELECT * FROM company_settings LIMIT 1') ?? [];
        $names = [];
        foreach ($this->normalizeCompanyPages($settings['pages'] ?? [], $settings) as $page) {
            $id = trim((string) ($page['id'] ?? ''));
            if ($id !== '') {
                $names[$id] = (string) ($page['name'] ?? '');
            }
        }
        return $names;
    }

    /** @return array{0: string, 1: string} */
    private function courierAndTracking(array $row): array
    {
        foreach ([
            ['CarryBee', 'carrybeeConsignmentId'],
            ['Steadfast', 'steadfastConsignmentId'],
            ['Paperfly', 'paperflyTrackingNumber'],
            ['Pathao', 'pathaoConsignmentId'],
        ] as [$courier, $field]) {
            $tracking = trim((string) ($row[$field] ?? ''));
            if ($tracking !== '') {
                return [$courier, $tracking];
            }
        }
        return ['', ''];
    }

    private function text(array $row, string $key): string
    {
        return trim((string) ($row[$key] ?? ''));
    }

    private function requiredText(array $row, string $key, string $label): string
    {
        $value = $this->text($row, $key);
        if ($value === '') {
            throw new RuntimeException($label . ' is required.');
        }
        return $value;
    }

    private function number(array $row, string $key, float $default = 0.0): float
    {
        $raw = $this->text($row, $key);
        if ($raw === '') {
            return $default;
        }
        $normalized = str_replace([',', ' '], '', $raw);
        if (!is_numeric($normalized)) {
            throw new RuntimeException($key . ' must be a number.');
        }
        return round((float) $normalized, 2);
    }

    private function integer(array $row, string $key, int $default = 0): int
    {
        $raw = $this->text($row, $key);
        if ($raw === '') {
            return $default;
        }
        $normalized = str_replace([',', ' '], '', $raw);
        if (!is_numeric($normalized)) {
            throw new RuntimeException($key . ' must be a whole number.');
        }
        return (int) round((float) $normalized);
    }

    private function boolean(array $row, string $key, bool $default = false): bool
    {
        $raw = strtolower($this->text($row, $key));
        if ($raw === '') {
            return $default;
        }
        if (in_array($raw, ['1', 'true', 'yes', 'y', 'on'], true)) {
            return true;
        }
        if (in_array($raw, ['0', 'false', 'no', 'n', 'off'], true)) {
            return false;
        }
        throw new RuntimeException($key . ' must be yes/no or true/false.');
    }

    private function dateValue(array $row, string $key, bool $dateOnly = false, bool $required = false): ?string
    {
        $raw = $this->text($row, $key);
        if ($raw === '') {
            if ($required) {
                throw new RuntimeException($key . ' is required.');
            }
            return null;
        }
        $timestamp = strtotime($raw);
        if ($timestamp === false) {
            throw new RuntimeException($key . ' is not a valid date.');
        }
        return gmdate($dateOnly ? 'Y-m-d' : 'Y-m-d H:i:s', $timestamp);
    }

    /** @return array<int|string, mixed> */
    private function jsonValue(array $row, string $key, bool $list, bool $required = false): array
    {
        $raw = $this->text($row, $key);
        if ($raw === '') {
            if ($required) {
                throw new RuntimeException($key . ' is required.');
            }
            return [];
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded) || json_last_error() !== JSON_ERROR_NONE) {
            throw new RuntimeException($key . ' must contain valid JSON.');
        }
        if ($list && !array_is_list($decoded)) {
            throw new RuntimeException($key . ' must contain a JSON list.');
        }
        return $decoded;
    }

    private function createdAt(array $row): string
    {
        return $this->dateValue($row, 'createdAt') ?? $this->database->nowUtc();
    }

    private function resolveUserId(array $row, array $actor): string
    {
        $id = $this->text($row, 'createdById');
        if ($id !== '') {
            $found = $this->database->fetchOne('SELECT id FROM users WHERE id = :id AND deleted_at IS NULL LIMIT 1', [':id' => $id]);
            if ($found !== null) {
                return (string) $found['id'];
            }
        }
        $phone = $this->text($row, 'createdByPhone');
        if ($phone !== '') {
            $found = $this->database->fetchOne('SELECT id FROM users WHERE phone = :phone AND deleted_at IS NULL LIMIT 1', [':phone' => $phone]);
            if ($found !== null) {
                return (string) $found['id'];
            }
        }
        return (string) $actor['id'];
    }

    private function resolveCustomerId(array $row, array $actor): string
    {
        $phone = $this->requiredText($row, 'customerPhone', 'Customer Phone');
        $name = $this->requiredText($row, 'customerName', 'Customer Name');
        $found = $this->database->fetchOne('SELECT id FROM customers WHERE phone = :phone AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1', [':phone' => $phone]);
        if ($found !== null) {
            return (string) $found['id'];
        }
        $customerId = $this->uuid4();
        $this->insertRow('customers', [
            'id' => $customerId,
            'name' => $name,
            'phone' => $phone,
            'address' => $this->nullableString($row['customerAddress'] ?? null),
            'total_orders' => 0,
            'due_amount' => '0.00',
            'created_by' => (string) $actor['id'],
            'created_at' => $this->database->nowUtc(),
            'updated_at' => $this->database->nowUtc(),
        ]);
        return $customerId;
    }

    private function resolveVendorId(array $row, array $actor): string
    {
        $phone = $this->requiredText($row, 'vendorPhone', 'Vendor Phone');
        $name = $this->requiredText($row, 'vendorName', 'Vendor Name');
        $found = $this->database->fetchOne('SELECT id FROM vendors WHERE phone = :phone AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1', [':phone' => $phone]);
        if ($found !== null) {
            return (string) $found['id'];
        }
        $vendorId = $this->uuid4();
        $this->insertRow('vendors', [
            'id' => $vendorId,
            'name' => $name,
            'phone' => $phone,
            'address' => $this->nullableString($row['vendorAddress'] ?? null),
            'total_purchases' => 0,
            'due_amount' => '0.00',
            'created_by' => (string) $actor['id'],
            'created_at' => $this->database->nowUtc(),
            'updated_at' => $this->database->nowUtc(),
        ]);
        return $vendorId;
    }

    private function resolveAccountId(string $name, string $type, bool $required): ?string
    {
        if ($name !== '') {
            $found = $this->database->fetchOne('SELECT id FROM accounts WHERE LOWER(name) = LOWER(:name) ORDER BY created_at ASC LIMIT 1', [':name' => $name]);
            if ($found !== null) {
                return (string) $found['id'];
            }
        }
        if ($required) {
            if ($name === '') {
                throw new RuntimeException('Account Name is required.');
            }
            $accountId = $this->uuid4();
            $this->insertRow('accounts', [
                'id' => $accountId,
                'name' => $name,
                'type' => $type !== '' ? $type : 'Bank',
                'opening_balance' => '0.00',
                'current_balance' => '0.00',
                'created_at' => $this->database->nowUtc(),
                'updated_at' => $this->database->nowUtc(),
            ]);
            return $accountId;
        }
        return null;
    }

    private function resolveUnitId(array $row): ?string
    {
        $name = $this->text($row, 'unitName');
        if ($name !== '') {
            $found = $this->database->fetchOne(
                'SELECT id FROM units WHERE LOWER(name) = LOWER(:unit_name) OR LOWER(short_name) = LOWER(:unit_short_name) LIMIT 1',
                [':unit_name' => $name, ':unit_short_name' => $name]
            );
            if ($found !== null) {
                return (string) $found['id'];
            }
        }
        if ($name === '') {
            return null;
        }
        $unitId = $this->uuid4();
        $shortName = substr($name, 0, 32);
        $shortNameExists = $this->database->fetchOne('SELECT id FROM units WHERE LOWER(short_name) = LOWER(:name) LIMIT 1', [':name' => $shortName]);
        if ($shortNameExists !== null) {
            $shortName = substr($name, 0, 24) . '-' . substr($unitId, 0, 6);
        }
        $this->insertRow('units', [
            'id' => $unitId,
            'name' => $name,
            'short_name' => $shortName,
            'description' => null,
            'is_fraction' => 0,
            'created_at' => $this->database->nowUtc(),
            'updated_at' => $this->database->nowUtc(),
        ]);
        return $unitId;
    }

    /**
     * @param array<string, mixed> $data
     * @return 'created'|'skipped'
     */
    private function saveByIdentity(string $table, string $requestedId, ?string $identityColumn, string $identityValue, array $data): string
    {
        $this->assertSafeTable($table);
        $existing = null;
        if ($requestedId !== '') {
            $existing = $this->database->fetchOne("SELECT id FROM `{$table}` WHERE id = :id LIMIT 1", [':id' => $requestedId]);
        }
        if ($existing === null && $identityColumn !== null && $identityValue !== '') {
            $this->assertIdentifier($identityColumn);
            $existing = $this->database->fetchOne(
                "SELECT id FROM `{$table}` WHERE `{$identityColumn}` = :identity ORDER BY created_at ASC LIMIT 1",
                [':identity' => $identityValue]
            );
        }
        $now = $this->database->nowUtc();
        if ($existing !== null) {
            return 'skipped';
        }

        $data['id'] = $requestedId !== '' ? $requestedId : $this->uuid4();
        $data['created_at'] = $data['created_at'] ?? $now;
        $data['updated_at'] = $now;
        $this->insertRow($table, $data);
        return 'created';
    }

    private function assertSafeTable(string $table): void
    {
        if (!in_array($table, ['orders', 'products', 'customers', 'bills', 'vendors', 'transactions', 'users', 'units', 'accounts'], true)) {
            throw new RuntimeException('Unsupported import table.');
        }
    }

    private function assertIdentifier(string $identifier): void
    {
        if (!preg_match('/^[a-z][a-z0-9_]*$/', $identifier)) {
            throw new RuntimeException('Invalid import field.');
        }
    }

    /** @param array<string, mixed> $data */
    private function insertRow(string $table, array $data): void
    {
        $this->assertSafeTable($table);
        $columns = [];
        $placeholders = [];
        $bindings = [];
        foreach ($data as $column => $value) {
            $this->assertIdentifier((string) $column);
            $columns[] = '`' . $column . '`';
            $parameter = ':insert_' . count($bindings);
            $placeholders[] = $parameter;
            $bindings[$parameter] = $value;
        }
        $this->database->execute(
            "INSERT INTO `{$table}` (" . implode(', ', $columns) . ') VALUES (' . implode(', ', $placeholders) . ')',
            $bindings
        );
    }

    /** @param array<string, mixed> $data */
    private function updateRow(string $table, string $id, array $data): void
    {
        $this->assertSafeTable($table);
        $parts = [];
        $bindings = [':row_id' => $id];
        foreach ($data as $column => $value) {
            $this->assertIdentifier((string) $column);
            $parameter = ':update_' . count($parts);
            $parts[] = '`' . $column . '` = ' . $parameter;
            $bindings[$parameter] = $value;
        }
        if ($parts === []) {
            return;
        }
        $this->database->execute(
            "UPDATE `{$table}` SET " . implode(', ', $parts) . ' WHERE id = :row_id',
            $bindings
        );
    }

    /** @return 'created'|'skipped' */
    private function importCustomer(array $row, array $actor): string
    {
        $name = $this->requiredText($row, 'name', 'Customer Name');
        $phone = $this->requiredText($row, 'phone', 'Customer Phone');
        return $this->saveByIdentity('customers', '', 'phone', $phone, [
            'name' => $name,
            'phone' => $phone,
            'address' => $this->nullableString($row['address'] ?? null),
            'created_by' => $this->resolveUserId($row, $actor),
        ]);
    }

    /** @return 'created'|'skipped' */
    private function importVendor(array $row, array $actor): string
    {
        $name = $this->requiredText($row, 'name', 'Vendor Name');
        $phone = $this->requiredText($row, 'phone', 'Vendor Phone');
        return $this->saveByIdentity('vendors', '', 'phone', $phone, [
            'name' => $name,
            'phone' => $phone,
            'address' => $this->nullableString($row['address'] ?? null),
            'created_by' => $this->resolveUserId($row, $actor),
        ]);
    }

    /** @return 'created'|'skipped' */
    private function importProduct(array $row, array $actor): string
    {
        $name = $this->requiredText($row, 'name', 'Product Name');
        $existing = $this->database->fetchOne(
            'SELECT id FROM products WHERE LOWER(name) = LOWER(:name) ORDER BY created_at ASC LIMIT 1',
            [':name' => $name]
        );
        if ($existing !== null) {
            return 'skipped';
        }
        $dynamicPricing = $this->text($row, 'dynamicPricing');
        if ($dynamicPricing !== '') {
            $this->jsonValue($row, 'dynamicPricing', true);
        }
        $image = $this->normalizeUploadedFileValue(
            $this->nullableString($row['image'] ?? null),
            'product-images',
            isset($row['imageName']) ? trim((string) $row['imageName']) : null
        );
        return $this->saveByIdentity('products', '', 'name', $name, [
            'name' => $name,
            'image' => $image,
            'category' => $this->nullableString($row['category'] ?? null),
            'unit_id' => $this->resolveUnitId($row),
            'sale_price' => $this->formatMoney(max(0, $this->number($row, 'salePrice'))),
            'purchase_price' => $this->formatMoney(max(0, $this->number($row, 'purchasePrice'))),
            'stock' => max(0, $this->integer($row, 'stock')),
            'dynamic_pricing' => $dynamicPricing !== '' ? $dynamicPricing : null,
            'created_by' => $this->resolveUserId($row, $actor),
        ]);
    }

    /** @return array<int, array<string, mixed>> */
    private function resolveDocumentItems(array $row, array $actor, string $documentLabel, bool $purchase): array
    {
        $itemRows = is_array($row['_itemRows'] ?? null) ? $row['_itemRows'] : [[
            'productName' => $row['productName'] ?? '',
            'quantity' => $row['quantity'] ?? '',
            'rate' => $row['rate'] ?? '',
        ]];
        $items = [];
        foreach ($itemRows as $itemRow) {
            if (!is_array($itemRow)) {
                throw new RuntimeException($documentLabel . ' contains an invalid item row.');
            }
            $productName = $this->requiredText($itemRow, 'productName', 'Product Name');
            $quantity = $this->number($itemRow, 'quantity');
            $rate = $this->number($itemRow, 'rate');
            if ($quantity <= 0) {
                throw new RuntimeException('Quantity must be greater than zero.');
            }
            if ($rate < 0) {
                throw new RuntimeException('Rate cannot be negative.');
            }
            $product = $this->database->fetchOne(
                'SELECT id, name FROM products WHERE LOWER(name) = LOWER(:name) AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1',
                [':name' => $productName]
            );
            if ($product === null) {
                $productId = $this->uuid4();
                $this->insertRow('products', [
                    'id' => $productId,
                    'name' => $productName,
                    'image' => null,
                    'category' => null,
                    'unit_id' => null,
                    'sale_price' => $this->formatMoney($purchase ? 0 : $rate),
                    'purchase_price' => $this->formatMoney($purchase ? $rate : 0),
                    'stock' => 0,
                    'dynamic_pricing' => null,
                    'created_by' => (string) $actor['id'],
                    'created_at' => $this->database->nowUtc(),
                    'updated_at' => $this->database->nowUtc(),
                ]);
                $product = ['id' => $productId, 'name' => $productName];
            }
            $items[] = [
                'productId' => (string) $product['id'],
                'productName' => (string) $product['name'],
                'quantity' => $quantity,
                'rate' => $rate,
                'amount' => round($quantity * $rate, 2),
            ];
        }
        return $items;
    }

    /** @return array{0: string|null, 1: string|null} */
    private function resolveCompanyPageSelection(string $name): array
    {
        $settings = $this->database->fetchOne('SELECT * FROM company_settings LIMIT 1') ?? [];
        $pages = $this->normalizeCompanyPages($settings['pages'] ?? [], $settings);
        if ($name === '') {
            $globalPages = array_filter($pages, static fn(array $candidate): bool => !empty($candidate['isGlobalBranding']));
            $page = current($globalPages) ?: ($pages[0] ?? null);
            if (is_array($page)) {
                return [(string) $page['id'], $this->jsonEncode($page)];
            }
            return [null, null];
        }
        foreach ($pages as $page) {
            if (strcasecmp(trim((string) ($page['name'] ?? '')), $name) === 0) {
                return [(string) $page['id'], $this->jsonEncode($page)];
            }
        }
        throw new RuntimeException("Company Page '{$name}' was not found. Use the page name shown in Settings or leave it blank.");
    }

    /** @return array<string, string|null> */
    private function importedCourierColumns(array $row, array $previous): array
    {
        $columns = [
            'carrybee_consignment_id' => $this->nullableString($previous['carrybee_consignment_id'] ?? null),
            'steadfast_consignment_id' => $this->nullableString($previous['steadfast_consignment_id'] ?? null),
            'paperfly_tracking_number' => $this->nullableString($previous['paperfly_tracking_number'] ?? null),
            'pathao_consignment_id' => $this->nullableString($previous['pathao_consignment_id'] ?? null),
        ];
        $courier = strtolower($this->text($row, 'courier'));
        $tracking = $this->text($row, 'trackingNumber');
        if ($courier === '' && $tracking === '') {
            return $columns;
        }
        if ($courier === '' || $tracking === '') {
            throw new RuntimeException('Courier and Tracking Number must both be provided.');
        }
        $targetColumn = match ($courier) {
            'carrybee', 'carry bee' => 'carrybee_consignment_id',
            'steadfast' => 'steadfast_consignment_id',
            'paperfly', 'paper fly' => 'paperfly_tracking_number',
            'pathao' => 'pathao_consignment_id',
            default => throw new RuntimeException('Courier must be CarryBee, Steadfast, Paperfly, or Pathao.'),
        };
        foreach ($columns as $column => $_value) {
            $columns[$column] = $column === $targetColumn ? $tracking : null;
        }
        return $columns;
    }

    /** @return array{0: array<int, array<string, mixed>>, 1: float, 2: float} */
    private function documentAmounts(array $row, string $label): array
    {
        $items = $this->jsonValue($row, 'itemsJson', true, true);
        if ($items === []) {
            throw new RuntimeException($label . ' must contain at least one item.');
        }
        $calculatedSubtotal = 0.0;
        foreach ($items as $item) {
            if (!is_array($item)) {
                throw new RuntimeException($label . ' items must be JSON objects.');
            }
            $productId = trim((string) ($item['productId'] ?? ''));
            $quantity = (float) ($item['quantity'] ?? 0);
            $rate = (float) ($item['rate'] ?? 0);
            $amount = (float) ($item['amount'] ?? ($quantity * $rate));
            if ($productId === '' || $quantity <= 0 || $rate < 0 || abs($amount - round($quantity * $rate, 2)) > 0.01) {
                throw new RuntimeException($label . ' has an invalid item quantity, rate, or amount.');
            }
            $calculatedSubtotal += $amount;
        }
        $calculatedSubtotal = round($calculatedSubtotal, 2);
        $subtotal = $this->text($row, 'subtotal') === '' ? $calculatedSubtotal : $this->number($row, 'subtotal');
        $discount = max(0, $this->number($row, 'discount'));
        $shipping = max(0, $this->number($row, 'shipping'));
        $total = $this->text($row, 'total') === '' ? round(max(0, $subtotal - $discount + $shipping), 2) : $this->number($row, 'total');
        if (abs($subtotal - $calculatedSubtotal) > 0.01) {
            throw new RuntimeException($label . ' subtotal does not match its items.');
        }
        if ($discount > $subtotal || abs($total - round(max(0, $subtotal - $discount + $shipping), 2)) > 0.01) {
            throw new RuntimeException($label . ' total is invalid.');
        }
        return [$items, $subtotal, $total];
    }

    private function nextImportDocumentSequence(string $table, string $column): int
    {
        $allowed = [
            'orders' => 'order_seq',
            'bills' => 'bill_seq',
        ];
        if (($allowed[$table] ?? null) !== $column) {
            throw new RuntimeException('Unsupported document sequence.');
        }

        $row = $this->database->fetchOne(
            "SELECT COALESCE(MAX({$column}), 0) AS max_seq FROM {$table} FOR UPDATE"
        );
        return ((int) ($row['max_seq'] ?? 0)) + 1;
    }

    /** @return 'created'|'skipped' */
    private function importOrder(array $row, array $actor): string
    {
        $orderNumber = $this->requiredText($row, 'orderNumber', 'Order Number');
        if ($this->database->fetchOne('SELECT id FROM orders WHERE order_number = :number LIMIT 1', [':number' => $orderNumber]) !== null) {
            return 'skipped';
        }
        $row['itemsJson'] = $this->jsonEncode($this->resolveDocumentItems($row, $actor, 'Order', false));
        [$items, $subtotal, $total] = $this->documentAmounts($row, 'Order');
        $paidAmount = max(0, $this->number($row, 'paidAmount'));
        if ($paidAmount > $total) {
            throw new RuntimeException('Order Paid Amount cannot exceed Total.');
        }
        $previous = [];
        $orderSequence = $this->nextImportDocumentSequence('orders', 'order_seq');
        $customerId = $this->resolveCustomerId($row, $actor);
        $companyPageName = $this->text($row, 'companyPage');
        [$pageId, $pageSnapshot] = $companyPageName !== ''
            ? $this->resolveCompanyPageSelection($companyPageName)
            : ($previous !== []
                ? [$this->nullableString($previous['page_id'] ?? null), $this->nullableString($previous['page_snapshot'] ?? null)]
                : $this->resolveCompanyPageSelection(''));
        $courierColumns = $this->importedCourierColumns($row, $previous);
        $operation = $this->saveByIdentity('orders', '', 'order_number', $orderNumber, array_merge([
            'order_number' => $orderNumber,
            'order_seq' => $orderSequence,
            'order_date' => $this->dateValue($row, 'orderDate', true, true),
            'customer_id' => $customerId,
            'page_id' => $pageId,
            'created_by' => $this->resolveUserId($row, $actor),
            'status' => $this->canonicalOrderStatus($this->requiredText($row, 'status', 'Status')),
            'items' => $this->jsonEncode($items),
            'subtotal' => $this->formatMoney($subtotal),
            'discount' => $this->formatMoney(max(0, $this->number($row, 'discount'))),
            'shipping' => $this->formatMoney(max(0, $this->number($row, 'shipping'))),
            'total' => $this->formatMoney($total),
            'paid_amount' => $this->formatMoney($paidAmount),
            'notes' => $this->nullableString($row['notes'] ?? null),
            'history' => $previous['history'] ?? $this->jsonEncode([]),
            'page_snapshot' => $pageSnapshot,
            'source_ad' => $this->nullableString($row['sourceAd'] ?? null),
        ], $courierColumns));
        $this->syncCustomerSummary($customerId);
        $previousCustomerId = trim((string) ($previous['customer_id'] ?? ''));
        if ($previousCustomerId !== '' && $previousCustomerId !== $customerId) {
            $this->syncCustomerSummary($previousCustomerId);
        }
        return $operation;
    }

    /** @return 'created'|'skipped' */
    private function importBill(array $row, array $actor): string
    {
        $billNumber = $this->requiredText($row, 'billNumber', 'Bill Number');
        if ($this->database->fetchOne('SELECT id FROM bills WHERE bill_number = :number LIMIT 1', [':number' => $billNumber]) !== null) {
            return 'skipped';
        }
        $row['itemsJson'] = $this->jsonEncode($this->resolveDocumentItems($row, $actor, 'Bill', true));
        [$items, $subtotal, $total] = $this->documentAmounts($row, 'Bill');
        $paidAmount = max(0, $this->number($row, 'paidAmount'));
        if ($paidAmount > $total) {
            throw new RuntimeException('Bill Paid Amount cannot exceed Total.');
        }
        $previous = [];
        $billSequence = $this->nextImportDocumentSequence('bills', 'bill_seq');
        $vendorId = $this->resolveVendorId($row, $actor);
        $operation = $this->saveByIdentity('bills', '', 'bill_number', $billNumber, [
            'bill_number' => $billNumber,
            'bill_seq' => $billSequence,
            'bill_date' => $this->dateValue($row, 'billDate', true, true),
            'vendor_id' => $vendorId,
            'created_by' => $this->resolveUserId($row, $actor),
            'status' => $this->requiredText($row, 'status', 'Status'),
            'items' => $this->jsonEncode($items),
            'subtotal' => $this->formatMoney($subtotal),
            'discount' => $this->formatMoney(max(0, $this->number($row, 'discount'))),
            'shipping' => $this->formatMoney(max(0, $this->number($row, 'shipping'))),
            'total' => $this->formatMoney($total),
            'paid_amount' => $this->formatMoney($paidAmount),
            'notes' => $this->nullableString($row['notes'] ?? null),
            'history' => $previous['history'] ?? $this->jsonEncode([]),
        ]);
        $this->syncVendorSummary($vendorId);
        $previousVendorId = trim((string) ($previous['vendor_id'] ?? ''));
        if ($previousVendorId !== '' && $previousVendorId !== $vendorId) {
            $this->syncVendorSummary($previousVendorId);
        }
        return $operation;
    }

    private function syncCustomerSummary(string $customerId): void
    {
        $summary = $this->database->fetchOne(
            "SELECT COUNT(*) AS total_orders,
                    COALESCE(SUM(CASE WHEN status NOT IN ('Cancelled', 'Returned') THEN GREATEST(total - paid_amount, 0) ELSE 0 END), 0) AS due_amount
             FROM orders WHERE customer_id = :id AND deleted_at IS NULL",
            [':id' => $customerId]
        ) ?? [];
        $this->database->execute(
            'UPDATE customers SET total_orders = :count, due_amount = :due WHERE id = :id',
            [':count' => (int) ($summary['total_orders'] ?? 0), ':due' => $this->formatMoney($summary['due_amount'] ?? 0), ':id' => $customerId]
        );
    }

    private function syncVendorSummary(string $vendorId): void
    {
        $summary = $this->database->fetchOne(
            "SELECT COUNT(*) AS total_purchases,
                    COALESCE(SUM(CASE WHEN status <> 'Cancelled' THEN GREATEST(total - paid_amount, 0) ELSE 0 END), 0) AS due_amount
             FROM bills WHERE vendor_id = :id AND deleted_at IS NULL",
            [':id' => $vendorId]
        ) ?? [];
        $this->database->execute(
            'UPDATE vendors SET total_purchases = :count, due_amount = :due WHERE id = :id',
            [':count' => (int) ($summary['total_purchases'] ?? 0), ':due' => $this->formatMoney($summary['due_amount'] ?? 0), ':id' => $vendorId]
        );
    }

    /** @return 'created'|'skipped' */
    private function importTransaction(array $row, array $actor): string
    {
        $type = $this->requiredText($row, 'type', 'Type');
        if (!in_array($type, ['Income', 'Expense', 'Transfer'], true)) {
            throw new RuntimeException('Type must be Income, Expense, or Transfer.');
        }
        $transactionId = $this->text($row, 'transactionId');
        if ($transactionId !== '' && $this->database->fetchOne(
            'SELECT id FROM transactions WHERE transaction_id = :transaction_id ORDER BY created_at ASC LIMIT 1',
            [':transaction_id' => $transactionId]
        ) !== null) {
            return 'skipped';
        }
        $accountId = $this->resolveAccountId($this->text($row, 'accountName'), $this->text($row, 'accountType'), true);
        $toAccountId = $this->resolveAccountId($this->text($row, 'toAccountName'), $this->text($row, 'toAccountType'), $type === 'Transfer');
        if ($type === 'Transfer' && $accountId === $toAccountId) {
            throw new RuntimeException('Transfer source and destination accounts must be different.');
        }
        $amount = $this->number($row, 'amount');
        if ($amount <= 0) {
            throw new RuntimeException('Amount must be greater than zero.');
        }
        $approvalStatus = strtolower($this->text($row, 'approvalStatus'));
        if (!in_array($approvalStatus, ['approved', 'pending', 'declined'], true)) {
            $approvalStatus = 'approved';
        }
        $date = $this->dateValue($row, 'date', false, true);
        $category = $this->requiredText($row, 'category', 'Category');
        $description = $this->requiredText($row, 'description', 'Description');
        $paymentMethod = $this->requiredText($row, 'paymentMethod', 'Payment Method');
        $existing = $transactionId !== ''
            ? $this->database->fetchOne(
                'SELECT id, type, account_id, to_account_id, amount, account_effect_applied, history FROM transactions WHERE transaction_id = :transaction_id ORDER BY created_at ASC LIMIT 1',
                [':transaction_id' => $transactionId]
            )
            : $this->database->fetchOne(
                'SELECT id, type, account_id, to_account_id, amount, account_effect_applied, history
                 FROM transactions
                 WHERE date = :date AND type = :type AND category = :category AND account_id = :account_id
                   AND COALESCE(to_account_id, \'\') = :to_account_id AND amount = :amount
                   AND description = :description AND payment_method = :payment_method
                 ORDER BY created_at ASC LIMIT 1',
                [
                    ':date' => $date,
                    ':type' => $type,
                    ':category' => $category,
                    ':account_id' => $accountId,
                    ':to_account_id' => $toAccountId ?? '',
                    ':amount' => $this->formatMoney($amount),
                    ':description' => $description,
                    ':payment_method' => $paymentMethod,
                ]
            );
        if ($existing !== null) {
            return 'skipped';
        }
        $accountEffectApplied = $approvalStatus === 'approved';
        $operation = $this->saveByIdentity('transactions', '', null, '', [
            'transaction_id' => $transactionId !== '' ? $transactionId : null,
            'date' => $date,
            'type' => $type,
            'category' => $category,
            'account_id' => $accountId,
            'account_name' => $this->nullableString($row['accountName'] ?? null),
            'to_account_id' => $toAccountId,
            'amount' => $this->formatMoney($amount),
            'description' => $description,
            'reference_id' => $this->resolveReferenceNumber($this->text($row, 'referenceNumber')),
            'contact_id' => $this->resolveContactPhone($this->text($row, 'contactPhone')),
            'payment_method' => $paymentMethod,
            'attachment_name' => $this->nullableString($row['attachmentName'] ?? null),
            'attachment_url' => $this->nullableString($row['attachmentUrl'] ?? null),
            'created_by' => $this->resolveUserId($row, $actor),
            'history' => $this->jsonEncode([]),
            'approval_status' => $approvalStatus,
            'account_effect_applied' => $accountEffectApplied ? 1 : 0,
        ]);
        if ($accountEffectApplied) {
            $this->applyImportedTransactionAccountEffect([
                'type' => $type,
                'account_id' => $accountId,
                'to_account_id' => $toAccountId,
                'amount' => $amount,
            ], 1);
        }
        return $operation;
    }

    /** @return 'created'|'skipped' */
    private function importAccount(array $row): string
    {
        $name = $this->requiredText($row, 'name', 'Account Name');
        if ($this->database->fetchOne(
            'SELECT id FROM accounts WHERE LOWER(name) = LOWER(:name) ORDER BY created_at ASC LIMIT 1',
            [':name' => $name]
        ) !== null) {
            return 'skipped';
        }

        $type = $this->requiredText($row, 'type', 'Account Type');
        if (!in_array($type, ['Bank', 'Cash'], true)) {
            throw new RuntimeException('Account Type must be Bank or Cash.');
        }
        $openingBalance = $this->number($row, 'openingBalance');
        $currentBalance = $this->text($row, '_dependencyMode') === 'transactions'
            ? $openingBalance
            : $this->number($row, 'currentBalance', $openingBalance);

        return $this->saveByIdentity('accounts', '', 'name', $name, [
            'name' => $name,
            'type' => $type,
            'opening_balance' => $this->formatMoney($openingBalance),
            'current_balance' => $this->formatMoney($currentBalance),
        ]);
    }

    private function resolveReferenceNumber(string $number): ?string
    {
        if ($number === '') {
            return null;
        }
        $row = $this->database->fetchOne('SELECT id FROM orders WHERE order_number = :number AND deleted_at IS NULL LIMIT 1', [':number' => $number]);
        if ($row === null) {
            $row = $this->database->fetchOne('SELECT id FROM bills WHERE bill_number = :number AND deleted_at IS NULL LIMIT 1', [':number' => $number]);
        }
        return $row !== null ? (string) $row['id'] : null;
    }

    private function resolveContactPhone(string $phone): ?string
    {
        if ($phone === '') {
            return null;
        }
        $row = $this->database->fetchOne('SELECT id FROM customers WHERE phone = :phone AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1', [':phone' => $phone]);
        if ($row === null) {
            $row = $this->database->fetchOne('SELECT id FROM vendors WHERE phone = :phone AND deleted_at IS NULL ORDER BY created_at ASC LIMIT 1', [':phone' => $phone]);
        }
        return $row !== null ? (string) $row['id'] : null;
    }

    /** @param array<string, mixed> $transaction */
    private function applyImportedTransactionAccountEffect(array $transaction, int $direction): void
    {
        $type = (string) ($transaction['type'] ?? '');
        $accountId = trim((string) ($transaction['account_id'] ?? ''));
        $toAccountId = trim((string) ($transaction['to_account_id'] ?? ''));
        $amount = round((float) ($transaction['amount'] ?? 0), 2);
        if ($amount <= 0 || $accountId === '') {
            return;
        }

        $sourceDelta = match ($type) {
            'Income' => $amount * $direction,
            'Expense', 'Transfer' => -$amount * $direction,
            default => 0.0,
        };
        if ($sourceDelta !== 0.0) {
            $this->database->execute(
                'UPDATE accounts SET current_balance = current_balance + :delta, updated_at = :updated_at WHERE id = :id',
                [':delta' => $this->formatMoney($sourceDelta), ':updated_at' => $this->database->nowUtc(), ':id' => $accountId]
            );
        }
        if ($type === 'Transfer' && $toAccountId !== '') {
            $this->database->execute(
                'UPDATE accounts SET current_balance = current_balance + :delta, updated_at = :updated_at WHERE id = :id',
                [':delta' => $this->formatMoney($amount * $direction), ':updated_at' => $this->database->nowUtc(), ':id' => $toAccountId]
            );
        }
    }

    /** @return 'created'|'skipped' */
    private function importUser(array $row): string
    {
        $name = $this->requiredText($row, 'name', 'User Name');
        $phone = $this->requiredText($row, 'phone', 'Phone');
        $requestedId = '';
        $existing = $this->database->fetchOne('SELECT id, role FROM users WHERE phone = :phone LIMIT 1', [':phone' => $phone]);
        if ($existing !== null) {
            return 'skipped';
        }
        $role = $this->requiredText($row, 'role', 'Role');
        if ($role === 'Developer') {
            throw new RuntimeException('New Developer users cannot be created through CSV import.');
        }
        $password = $this->text($row, 'password');
        if ($existing === null && $password === '') {
            throw new RuntimeException('Password For New User is required for a brand-new user.');
        }
        $commissionBased = $this->boolean($row, 'isCommissionBased', true);
        $fixedSalary = $this->text($row, 'fixedSalary') === '' ? null : max(0, $this->number($row, 'fixedSalary'));
        if ($role === 'Employee' && !$commissionBased && ($fixedSalary === null || $fixedSalary <= 0)) {
            throw new RuntimeException('A fixed-salary employee must have a Fixed Salary greater than zero.');
        }
        $data = [
            'name' => $name,
            'phone' => $phone,
            'role' => $role,
            'is_system' => 0,
            'image' => $this->nullableString($row['image'] ?? null),
            'email' => $this->nullableString($row['email'] ?? null),
            'address' => $this->nullableString($row['address'] ?? null),
            'birthday' => $this->dateValue($row, 'birthday', true),
            'nid_passport_copy' => $this->nullableString($row['nidPassportCopy'] ?? null),
            'gender' => $this->nullableString($row['gender'] ?? null),
            'blood_group' => $this->nullableString($row['bloodGroup'] ?? null),
            'nationality' => $this->nullableString($row['nationality'] ?? null),
            'cv' => $this->nullableString($row['cv'] ?? null),
            'is_commission_based' => $commissionBased ? 1 : 0,
            'fixed_salary' => $commissionBased ? null : $fixedSalary,
        ];
        if ($password !== '') {
            $data['password_hash'] = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
        }
        return $this->saveByIdentity('users', $requestedId, 'phone', $phone, $data);
    }
}
