<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class MasterDataApi extends BaseService
{
    public function me(array $params = []): array
    {
        return $this->mapUser($this->currentUser());
    }

    public function bootstrapSession(array $params = []): array
    {
        return [
            'user' => $this->mapUser($this->currentUser()),
            'permissions' => $this->buildPermissionsSettingsPayload(),
            'capabilities' => $this->fetchCapabilitySettings(),
        ];
    }

    public function loginUser(array $params): array
    {
        $phone = trim((string) ($params['phone'] ?? ''));
        $password = (string) ($params['password'] ?? '');
        if ($phone === '' || $password === '') {
            return ['user' => null, 'error' => 'Phone and password are required.'];
        }

        $row = $this->database->fetchOne(
            'SELECT * FROM users WHERE phone = :phone AND deleted_at IS NULL LIMIT 1',
            [':phone' => $phone]
        );

        if ($row === null) {
            return ['user' => null, 'error' => 'User not found'];
        }

        $hash = (string) ($row['password_hash'] ?? '');
        if ($hash === '' || !password_verify($password, $hash)) {
            return ['user' => null, 'error' => 'Invalid password'];
        }

        return [
            'user' => $this->mapUser($row),
            'token' => $this->auth->issueToken($row),
            'error' => null,
        ];
    }

    public function fetchUsers(array $params = []): array
    {
        $rows = $this->database->fetchAll(
            'SELECT id, name, phone, role, image, created_at, deleted_at, deleted_by
             FROM users
             WHERE deleted_at IS NULL
             ORDER BY created_at DESC, name ASC'
        );

        return array_map(fn(array $row): array => $this->mapUser($row), $rows);
    }

    public function fetchUsersPage(array $params): array
    {
        $page = max(1, (int) ($params['page'] ?? 1));
        $pageSize = max(1, min(200, (int) ($params['pageSize'] ?? self::DEFAULT_PAGE_SIZE)));
        $offset = ($page - 1) * $pageSize;
        $search = trim((string) ($params['search'] ?? ''));
        $role = trim((string) ($params['role'] ?? ''));

        $where = 'WHERE deleted_at IS NULL';
        $bindings = [];

        if ($role !== '' && $role !== 'All') {
            $where .= ' AND role = :role';
            $bindings[':role'] = $role;
        }

        if ($search !== '') {
            $where .= ' AND (name LIKE :search_name OR phone LIKE :search_phone OR role LIKE :search_role)';
            $bindings[':search_name'] = '%' . $search . '%';
            $bindings[':search_phone'] = '%' . $search . '%';
            $bindings[':search_role'] = '%' . $search . '%';
        }

        $countRow = $this->database->fetchOne("SELECT COUNT(*) AS count FROM users {$where}", $bindings);
        $rows = $this->database->fetchAll(
            "SELECT id, name, phone, role, image, created_at, deleted_at, deleted_by
             FROM users
             {$where}
             ORDER BY created_at DESC, name ASC
             LIMIT {$pageSize} OFFSET {$offset}",
            $bindings
        );
        $roleRows = $this->database->fetchAll(
            'SELECT DISTINCT role FROM users WHERE deleted_at IS NULL ORDER BY role ASC'
        );

        return [
            'data' => array_map(fn(array $row): array => $this->mapUser($row), $rows),
            'count' => (int) ($countRow['count'] ?? 0),
            'roles' => array_values(array_filter(array_map(
                static fn(array $row): string => trim((string) ($row['role'] ?? '')),
                $roleRows
            ))),
        ];
    }

    public function fetchUsersMini(array $params = []): array
    {
        return $this->database->fetchAll(
            'SELECT id, name FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC, name ASC'
        );
    }

    public function fetchUserByPhone(array $params): ?array
    {
        $phone = trim((string) ($params['phone'] ?? ''));
        if ($phone === '') {
            return null;
        }

        $row = $this->database->fetchOne(
            'SELECT * FROM users WHERE phone = :phone AND deleted_at IS NULL LIMIT 1',
            [':phone' => $phone]
        );

        return $row ? $this->mapUser($row) : null;
    }

    public function fetchUserById(array $params): ?array
    {
        $id = trim((string) ($params['id'] ?? ''));
        if ($id === '') {
            return null;
        }

        $row = $this->database->fetchOne(
            'SELECT * FROM users WHERE id = :id AND deleted_at IS NULL LIMIT 1',
            [':id' => $id]
        );

        return $row ? $this->mapUser($row) : null;
    }

    public function createUser(array $params): array
    {
        $requiresAdmin = PHP_SAPI !== 'cli' && PHP_SAPI !== 'phpdbg';
        if ($requiresAdmin) {
            $existingUser = $this->database->fetchOne('SELECT id FROM users WHERE deleted_at IS NULL LIMIT 1');
            if ($existingUser !== null) {
                $this->requireAdmin();
            }
        }

        $password = (string) ($params['password'] ?? '');
        if ($password === '') {
            throw new RuntimeException('Password is required to create a user.');
        }

        $requestedRole = trim((string) ($params['role'] ?? 'Employee'));
        if ($requestedRole === 'Developer') {
            throw new RuntimeException('Developer users can only be assigned directly in the database.');
        }

        $id = $this->stringId($params['id'] ?? null);
        $this->database->execute(
            'INSERT INTO users (id, name, phone, role, image, password_hash, created_at, updated_at)
             VALUES (:id, :name, :phone, :role, :image, :password_hash, :created_at, :updated_at)',
            [
                ':id' => $id,
                ':name' => trim((string) ($params['name'] ?? '')),
                ':phone' => trim((string) ($params['phone'] ?? '')),
                ':role' => $requestedRole,
                ':image' => $this->nullableString($params['image'] ?? null),
                ':password_hash' => password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]),
                ':created_at' => $this->database->nowUtc(),
                ':updated_at' => $this->database->nowUtc(),
            ]
        );

        return $this->fetchUserById(['id' => $id]) ?? throw new RuntimeException('Failed to create user.');
    }

    public function updateUser(array $params): array
    {
        $this->requireAdmin();
        $id = trim((string) ($params['id'] ?? ''));
        if ($id === '') {
            throw new RuntimeException('User id is required.');
        }

        $existing = $this->database->fetchOne(
            'SELECT id, role FROM users WHERE id = :id AND deleted_at IS NULL LIMIT 1',
            [':id' => $id]
        );
        if ($existing === null) {
            throw new RuntimeException('User not found.');
        }

        $updates = $params['updates'] ?? [];
        if (!is_array($updates)) {
            $updates = [];
        }

        $payload = [];
        if (array_key_exists('name', $updates)) {
            $payload['name'] = trim((string) $updates['name']);
        }
        if (array_key_exists('phone', $updates)) {
            $payload['phone'] = trim((string) $updates['phone']);
        }
        if (array_key_exists('role', $updates)) {
            $requestedRole = trim((string) $updates['role']);
            $currentRole = trim((string) ($existing['role'] ?? ''));
            if ($requestedRole === 'Developer' || ($currentRole === 'Developer' && $requestedRole !== 'Developer')) {
                throw new RuntimeException('Developer role changes can only be made directly in the database.');
            }
            $payload['role'] = $requestedRole;
        }
        if (array_key_exists('image', $updates)) {
            $payload['image'] = $this->nullableString($updates['image']);
        }
        if (!empty($updates['password'])) {
            $payload['password_hash'] = password_hash((string) $updates['password'], PASSWORD_BCRYPT, ['cost' => 12]);
        }

        $this->touchUpdate('users', $id, $payload);
        return $this->fetchUserById(['id' => $id]) ?? throw new RuntimeException('User not found.');
    }

    public function deleteUser(array $params): array
    {
        $this->requireAdmin();
        $id = trim((string) ($params['id'] ?? ''));
        $existing = $this->database->fetchOne(
            'SELECT id, role FROM users WHERE id = :id AND deleted_at IS NULL LIMIT 1',
            [':id' => $id]
        );
        if ($existing !== null && trim((string) ($existing['role'] ?? '')) === 'Developer') {
            throw new RuntimeException('Developer users cannot be archived from the app.');
        }

        $this->softDelete('users', $id);
        return ['success' => true];
    }

    public function fetchCustomers(array $params = []): array
    {
        $rows = $this->database->fetchAll(
            'SELECT id, name, phone, address, total_orders, due_amount, created_by, created_at, deleted_at, deleted_by
             FROM customers
             WHERE deleted_at IS NULL
             ORDER BY created_at DESC'
        );

        return array_map(fn(array $row): array => $this->mapCustomer($row), $rows);
    }

    public function fetchCustomersPage(array $params): array
    {
        $page = max(1, (int) ($params['page'] ?? 1));
        $pageSize = max(1, min(200, (int) ($params['pageSize'] ?? self::DEFAULT_PAGE_SIZE)));
        $offset = ($page - 1) * $pageSize;
        $search = trim((string) ($params['search'] ?? ''));

        $where = 'WHERE deleted_at IS NULL';
        $bindings = [];
        if ($search !== '') {
            $where .= ' AND (name LIKE :search_name OR phone LIKE :search_phone OR address LIKE :search_address)';
            $bindings[':search_name'] = '%' . $search . '%';
            $bindings[':search_phone'] = '%' . $search . '%';
            $bindings[':search_address'] = '%' . $search . '%';
        }

        $countRow = $this->database->fetchOne("SELECT COUNT(*) AS count FROM customers {$where}", $bindings);
        $rows = $this->database->fetchAll(
            "SELECT id, name, phone, address, total_orders, due_amount, created_by, created_at, deleted_at, deleted_by
             FROM customers
             {$where}
             ORDER BY created_at DESC
             LIMIT {$pageSize} OFFSET {$offset}",
            $bindings
        );

        return [
            'data' => array_map(fn(array $row): array => $this->mapCustomer($row), $rows),
            'count' => (int) ($countRow['count'] ?? 0),
        ];
    }

    public function fetchCustomersMini(array $params = []): array
    {
        return $this->database->fetchAll(
            'SELECT id, name, phone FROM customers WHERE deleted_at IS NULL ORDER BY created_at DESC'
        );
    }

    public function fetchCustomerById(array $params): ?array
    {
        $id = trim((string) ($params['id'] ?? ''));
        if ($id === '' || str_starts_with($id, 'temp-')) {
            return null;
        }

        $row = $this->database->fetchOne(
            'SELECT * FROM customers WHERE id = :id AND deleted_at IS NULL LIMIT 1',
            [':id' => $id]
        );

        return $row ? $this->mapCustomer($row) : null;
    }

    public function createCustomer(array $params): array
    {
        $actor = $this->currentUser();
        $id = $this->stringId($params['id'] ?? null);
        $this->database->execute(
            'INSERT INTO customers (id, name, phone, address, total_orders, due_amount, created_by, created_at, updated_at)
             VALUES (:id, :name, :phone, :address, :total_orders, :due_amount, :created_by, :created_at, :updated_at)',
            [
                ':id' => $id,
                ':name' => trim((string) ($params['name'] ?? '')),
                ':phone' => trim((string) ($params['phone'] ?? '')),
                ':address' => $this->nullableString($params['address'] ?? null),
                ':total_orders' => (int) ($params['totalOrders'] ?? 0),
                ':due_amount' => $this->formatMoney($params['dueAmount'] ?? 0),
                ':created_by' => (string) $actor['id'],
                ':created_at' => $this->database->nowUtc(),
                ':updated_at' => $this->database->nowUtc(),
            ]
        );

        return $this->fetchCustomerById(['id' => $id]) ?? throw new RuntimeException('Failed to create customer.');
    }

    public function updateCustomer(array $params): array
    {
        $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));
        $updates = is_array($params['updates'] ?? null) ? $params['updates'] : [];
        $payload = [];

        if (array_key_exists('name', $updates)) {
            $payload['name'] = trim((string) $updates['name']);
        }
        if (array_key_exists('phone', $updates)) {
            $payload['phone'] = trim((string) $updates['phone']);
        }
        if (array_key_exists('address', $updates)) {
            $payload['address'] = $this->nullableString($updates['address']);
        }
        if (array_key_exists('totalOrders', $updates)) {
            $payload['total_orders'] = (int) $updates['totalOrders'];
        }
        if (array_key_exists('dueAmount', $updates)) {
            $payload['due_amount'] = $this->formatMoney($updates['dueAmount']);
        }

        $this->touchUpdate('customers', $id, $payload);
        return $this->fetchCustomerById(['id' => $id]) ?? throw new RuntimeException('Customer not found.');
    }

    public function deleteCustomer(array $params): array
    {
        $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));
        if (str_starts_with($id, 'temp-')) {
            throw new RuntimeException('Cannot delete unsaved customer. Please refresh and try again.');
        }
        $this->softDelete('customers', $id);
        return ['success' => true];
    }

    public function fetchVendors(array $params = []): array
    {
        $rows = $this->database->fetchAll(
            'SELECT id, name, phone, address, total_purchases, due_amount, created_by, created_at, deleted_at, deleted_by
             FROM vendors
             WHERE deleted_at IS NULL
             ORDER BY created_at DESC'
        );

        return array_map(fn(array $row): array => $this->mapVendor($row), $rows);
    }

    public function fetchVendorsPage(array $params): array
    {
        $page = max(1, (int) ($params['page'] ?? 1));
        $pageSize = max(1, min(200, (int) ($params['pageSize'] ?? self::DEFAULT_PAGE_SIZE)));
        $offset = ($page - 1) * $pageSize;
        $search = trim((string) ($params['search'] ?? ''));

        $where = 'WHERE deleted_at IS NULL';
        $bindings = [];
        if ($search !== '') {
            $where .= ' AND (name LIKE :search_name OR phone LIKE :search_phone OR address LIKE :search_address)';
            $bindings[':search_name'] = '%' . $search . '%';
            $bindings[':search_phone'] = '%' . $search . '%';
            $bindings[':search_address'] = '%' . $search . '%';
        }

        $countRow = $this->database->fetchOne("SELECT COUNT(*) AS count FROM vendors {$where}", $bindings);
        $rows = $this->database->fetchAll(
            "SELECT id, name, phone, address, total_purchases, due_amount, created_by, created_at, deleted_at, deleted_by
             FROM vendors
             {$where}
             ORDER BY created_at DESC
             LIMIT {$pageSize} OFFSET {$offset}",
            $bindings
        );

        return [
            'data' => array_map(fn(array $row): array => $this->mapVendor($row), $rows),
            'count' => (int) ($countRow['count'] ?? 0),
        ];
    }

    public function fetchVendorById(array $params): ?array
    {
        $id = trim((string) ($params['id'] ?? ''));
        if ($id === '') {
            return null;
        }

        $row = $this->database->fetchOne(
            'SELECT * FROM vendors WHERE id = :id AND deleted_at IS NULL LIMIT 1',
            [':id' => $id]
        );

        return $row ? $this->mapVendor($row) : null;
    }

    public function createVendor(array $params): array
    {
        $actor = $this->currentUser();
        $id = $this->stringId($params['id'] ?? null);
        $this->database->execute(
            'INSERT INTO vendors (id, name, phone, address, total_purchases, due_amount, created_by, created_at, updated_at)
             VALUES (:id, :name, :phone, :address, :total_purchases, :due_amount, :created_by, :created_at, :updated_at)',
            [
                ':id' => $id,
                ':name' => trim((string) ($params['name'] ?? '')),
                ':phone' => trim((string) ($params['phone'] ?? '')),
                ':address' => $this->nullableString($params['address'] ?? null),
                ':total_purchases' => (int) ($params['totalPurchases'] ?? 0),
                ':due_amount' => $this->formatMoney($params['dueAmount'] ?? 0),
                ':created_by' => (string) $actor['id'],
                ':created_at' => $this->database->nowUtc(),
                ':updated_at' => $this->database->nowUtc(),
            ]
        );

        return $this->fetchVendorById(['id' => $id]) ?? throw new RuntimeException('Failed to create vendor.');
    }

    public function updateVendor(array $params): array
    {
        $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));
        $updates = is_array($params['updates'] ?? null) ? $params['updates'] : [];
        $payload = [];

        if (array_key_exists('name', $updates)) {
            $payload['name'] = trim((string) $updates['name']);
        }
        if (array_key_exists('phone', $updates)) {
            $payload['phone'] = trim((string) $updates['phone']);
        }
        if (array_key_exists('address', $updates)) {
            $payload['address'] = $this->nullableString($updates['address']);
        }
        if (array_key_exists('totalPurchases', $updates)) {
            $payload['total_purchases'] = (int) $updates['totalPurchases'];
        }
        if (array_key_exists('dueAmount', $updates)) {
            $payload['due_amount'] = $this->formatMoney($updates['dueAmount']);
        }

        $this->touchUpdate('vendors', $id, $payload);
        return $this->fetchVendorById(['id' => $id]) ?? throw new RuntimeException('Vendor not found.');
    }

    public function deleteVendor(array $params): array
    {
        $this->currentUser();
        $this->softDelete('vendors', trim((string) ($params['id'] ?? '')));
        return ['success' => true];
    }

    public function fetchProducts(array $params = []): array
    {
        $category = trim((string) ($params['category'] ?? ''));
        $sql = 'SELECT id, name, image, category, sale_price, purchase_price, stock, created_by, created_at, deleted_at, deleted_by
                FROM products
                WHERE deleted_at IS NULL';
        $bindings = [];
        if ($category !== '') {
            $sql .= ' AND category = :category';
            $bindings[':category'] = $category;
        }
        $sql .= ' ORDER BY created_at DESC';

        $rows = $this->database->fetchAll($sql, $bindings);
        return array_map(fn(array $row): array => $this->mapProduct($row), $rows);
    }

    public function fetchProductsPage(array $params): array
    {
        $page = max(1, (int) ($params['page'] ?? 1));
        $pageSize = max(1, min(200, (int) ($params['pageSize'] ?? self::DEFAULT_PAGE_SIZE)));
        $offset = ($page - 1) * $pageSize;
        $search = trim((string) ($params['search'] ?? ''));
        $category = trim((string) ($params['category'] ?? ''));
        $createdByIds = is_array($params['createdByIds'] ?? null) ? $params['createdByIds'] : [];

        $where = 'WHERE deleted_at IS NULL';
        $bindings = [];
        if ($search !== '') {
            $where .= ' AND name LIKE :search';
            $bindings[':search'] = '%' . $search . '%';
        }
        if ($category !== '') {
            $where .= ' AND category = :category';
            $bindings[':category'] = $category;
        }
        $createdByIds = array_values(array_filter(array_map('strval', $createdByIds), static fn(string $id): bool => trim($id) !== ''));
        if ($createdByIds !== []) {
            [$placeholders, $inBindings] = $this->inClause($createdByIds, 'created_by');
            $where .= ' AND created_by IN (' . implode(', ', $placeholders) . ')';
            $bindings += $inBindings;
        }

        $countRow = $this->database->fetchOne("SELECT COUNT(*) AS count FROM products {$where}", $bindings);
        $rows = $this->database->fetchAll(
            "SELECT id, name, category, sale_price, purchase_price, stock, created_by, created_at, deleted_at, deleted_by
             FROM products
             {$where}
             ORDER BY created_at DESC
             LIMIT {$pageSize} OFFSET {$offset}",
            $bindings
        );

        return [
            'data' => array_map(fn(array $row): array => $this->mapProduct($row), $rows),
            'count' => (int) ($countRow['count'] ?? 0),
        ];
    }

    public function fetchProductsMini(array $params = []): array
    {
        $rows = $this->database->fetchAll(
            'SELECT id, name, sale_price, purchase_price, stock FROM products WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100'
        );

        return array_map(fn(array $row): array => $this->mapProduct($row), $rows);
    }

    public function fetchProductsSearch(array $params): array
    {
        $query = trim((string) ($params['q'] ?? ''));
        $limit = max(1, min(200, (int) ($params['limit'] ?? 50)));
        if ($query === '') {
            return [];
        }

        $rows = $this->database->fetchAll(
            "SELECT id, name, sale_price, purchase_price, stock
             FROM products
             WHERE deleted_at IS NULL AND name LIKE :search
             ORDER BY created_at DESC
             LIMIT {$limit}",
            [':search' => '%' . $query . '%']
        );

        return array_map(fn(array $row): array => $this->mapProduct($row), $rows);
    }

    public function fetchProductById(array $params): ?array
    {
        $id = trim((string) ($params['id'] ?? ''));
        if ($id === '') {
            return null;
        }

        $row = $this->database->fetchOne(
            'SELECT * FROM products WHERE id = :id AND deleted_at IS NULL LIMIT 1',
            [':id' => $id]
        );

        return $row ? $this->mapProduct($row) : null;
    }

    public function fetchProductImagesByIds(array $params): array
    {
        $productIds = is_array($params['productIds'] ?? null) ? $params['productIds'] : [];
        $productIds = array_values(array_filter(array_map('strval', $productIds), static fn(string $id): bool => trim($id) !== ''));
        if ($productIds === []) {
            return [];
        }

        [$placeholders, $bindings] = $this->inClause($productIds, 'product');
        return $this->database->fetchAll(
            'SELECT id, image FROM products WHERE deleted_at IS NULL AND id IN (' . implode(', ', $placeholders) . ')',
            $bindings
        );
    }

    public function createProduct(array $params): array
    {
        $actor = $this->currentUser();
        $id = $this->stringId($params['id'] ?? null);
        $this->database->execute(
            'INSERT INTO products (id, name, image, category, sale_price, purchase_price, stock, created_by, created_at, updated_at)
             VALUES (:id, :name, :image, :category, :sale_price, :purchase_price, :stock, :created_by, :created_at, :updated_at)',
            [
                ':id' => $id,
                ':name' => trim((string) ($params['name'] ?? '')),
                ':image' => $this->nullableString($params['image'] ?? null),
                ':category' => $this->nullableString($params['category'] ?? null),
                ':sale_price' => $this->formatMoney($params['salePrice'] ?? 0),
                ':purchase_price' => $this->formatMoney($params['purchasePrice'] ?? 0),
                ':stock' => (int) ($params['stock'] ?? 0),
                ':created_by' => (string) $actor['id'],
                ':created_at' => $this->database->nowUtc(),
                ':updated_at' => $this->database->nowUtc(),
            ]
        );

        return $this->fetchProductById(['id' => $id]) ?? throw new RuntimeException('Failed to create product.');
    }

    public function updateProduct(array $params): array
    {
        $this->currentUser();
        $id = trim((string) ($params['id'] ?? ''));
        $updates = is_array($params['updates'] ?? null) ? $params['updates'] : [];
        $payload = [];

        if (array_key_exists('name', $updates)) {
            $payload['name'] = trim((string) $updates['name']);
        }
        if (array_key_exists('image', $updates)) {
            $payload['image'] = $this->nullableString($updates['image']);
        }
        if (array_key_exists('category', $updates)) {
            $payload['category'] = $this->nullableString($updates['category']);
        }
        if (array_key_exists('salePrice', $updates)) {
            $payload['sale_price'] = $this->formatMoney($updates['salePrice']);
        }
        if (array_key_exists('purchasePrice', $updates)) {
            $payload['purchase_price'] = $this->formatMoney($updates['purchasePrice']);
        }
        if (array_key_exists('stock', $updates)) {
            $payload['stock'] = (int) $updates['stock'];
        }

        $this->touchUpdate('products', $id, $payload);
        return $this->fetchProductById(['id' => $id]) ?? throw new RuntimeException('Product not found.');
    }

    public function deleteProduct(array $params): array
    {
        $this->currentUser();
        $this->softDelete('products', trim((string) ($params['id'] ?? '')));
        return ['success' => true];
    }

    public function fetchAccounts(array $params = []): array
    {
        $rows = $this->database->fetchAll('SELECT * FROM accounts ORDER BY created_at DESC');
        return array_map(fn(array $row): array => $this->mapAccount($row), $rows);
    }

    public function fetchAccountById(array $params): ?array
    {
        $id = trim((string) ($params['id'] ?? ''));
        if ($id === '') {
            return null;
        }

        $row = $this->database->fetchOne('SELECT * FROM accounts WHERE id = :id LIMIT 1', [':id' => $id]);
        return $row ? $this->mapAccount($row) : null;
    }

    public function createAccount(array $params): array
    {
        $this->requireAdmin();
        $id = $this->stringId($params['id'] ?? null);
        $openingBalance = $this->formatMoney($params['openingBalance'] ?? 0);
        $currentBalance = array_key_exists('currentBalance', $params)
            ? $this->formatMoney($params['currentBalance'])
            : $openingBalance;

        $this->database->execute(
            'INSERT INTO accounts (id, name, type, opening_balance, current_balance, created_at, updated_at)
             VALUES (:id, :name, :type, :opening_balance, :current_balance, :created_at, :updated_at)',
            [
                ':id' => $id,
                ':name' => trim((string) ($params['name'] ?? '')),
                ':type' => trim((string) ($params['type'] ?? 'Cash')),
                ':opening_balance' => $openingBalance,
                ':current_balance' => $currentBalance,
                ':created_at' => $this->database->nowUtc(),
                ':updated_at' => $this->database->nowUtc(),
            ]
        );

        return $this->fetchAccountById(['id' => $id]) ?? throw new RuntimeException('Failed to create account.');
    }

    public function updateAccount(array $params): array
    {
        $this->requireAdmin();
        $id = trim((string) ($params['id'] ?? ''));
        $updates = is_array($params['updates'] ?? null) ? $params['updates'] : [];
        $payload = [];
        if (array_key_exists('name', $updates)) {
            $payload['name'] = trim((string) $updates['name']);
        }
        if (array_key_exists('type', $updates)) {
            $payload['type'] = trim((string) $updates['type']);
        }
        if (array_key_exists('openingBalance', $updates)) {
            $payload['opening_balance'] = $this->formatMoney($updates['openingBalance']);
        }
        if (array_key_exists('currentBalance', $updates)) {
            $payload['current_balance'] = $this->formatMoney($updates['currentBalance']);
        }

        $this->touchUpdate('accounts', $id, $payload);
        return $this->fetchAccountById(['id' => $id]) ?? throw new RuntimeException('Account not found.');
    }

    public function deleteAccount(array $params): array
    {
        $this->requireAdmin();
        $id = trim((string) ($params['id'] ?? ''));
        $this->database->execute('DELETE FROM accounts WHERE id = :id', [':id' => $id]);
        return ['success' => true];
    }

    public function fetchCategories(array $params = []): array
    {
        $type = trim((string) ($params['type'] ?? ''));
        $sql = 'SELECT * FROM categories';
        $bindings = [];
        if ($type !== '') {
            $sql .= ' WHERE type = :type';
            $bindings[':type'] = $type;
        }
        $sql .= ' ORDER BY name ASC';
        $rows = $this->database->fetchAll($sql, $bindings);

        return array_map(fn(array $row): array => $this->mapCategory($row), $rows);
    }

    public function fetchCategoriesById(array $params): ?array
    {
        $row = $this->database->fetchOne(
            'SELECT * FROM categories WHERE id = :id LIMIT 1',
            [':id' => trim((string) ($params['id'] ?? ''))]
        );
        return $row ? $this->mapCategory($row) : null;
    }

    public function createCategory(array $params): array
    {
        $this->requireAdmin();
        $id = $this->stringId($params['id'] ?? null);
        $this->database->execute(
            'INSERT INTO categories (id, name, type, color, parent_id, created_at, updated_at)
             VALUES (:id, :name, :type, :color, :parent_id, :created_at, :updated_at)',
            [
                ':id' => $id,
                ':name' => trim((string) ($params['name'] ?? '')),
                ':type' => trim((string) ($params['type'] ?? 'Other')),
                ':color' => trim((string) ($params['color'] ?? '#3B82F6')),
                ':parent_id' => $this->nullableString($params['parentId'] ?? null),
                ':created_at' => $this->database->nowUtc(),
                ':updated_at' => $this->database->nowUtc(),
            ]
        );

        return $this->fetchCategoriesById(['id' => $id]) ?? throw new RuntimeException('Failed to create category.');
    }

    public function updateCategory(array $params): array
    {
        $this->requireAdmin();
        $id = trim((string) ($params['id'] ?? ''));
        $updates = is_array($params['updates'] ?? null) ? $params['updates'] : [];
        $payload = [];
        if (array_key_exists('name', $updates)) {
            $payload['name'] = trim((string) $updates['name']);
        }
        if (array_key_exists('type', $updates)) {
            $payload['type'] = trim((string) $updates['type']);
        }
        if (array_key_exists('color', $updates)) {
            $payload['color'] = trim((string) $updates['color']);
        }
        if (array_key_exists('parentId', $updates)) {
            $payload['parent_id'] = $this->nullableString($updates['parentId']);
        }
        $this->touchUpdate('categories', $id, $payload);
        return $this->fetchCategoriesById(['id' => $id]) ?? throw new RuntimeException('Category not found.');
    }

    public function deleteCategory(array $params): array
    {
        $this->requireAdmin();
        $this->database->execute('DELETE FROM categories WHERE id = :id', [':id' => trim((string) ($params['id'] ?? ''))]);
        return ['success' => true];
    }

    public function fetchPaymentMethods(array $params = []): array
    {
        $activeOnly = !array_key_exists('activeOnly', $params) || (bool) $params['activeOnly'];
        $sql = 'SELECT * FROM payment_methods';
        if ($activeOnly) {
            $sql .= ' WHERE is_active = 1';
        }
        $sql .= ' ORDER BY name ASC';
        $rows = $this->database->fetchAll($sql);

        return array_map(fn(array $row): array => $this->mapPaymentMethod($row), $rows);
    }

    public function fetchPaymentMethodById(array $params): ?array
    {
        $row = $this->database->fetchOne(
            'SELECT * FROM payment_methods WHERE id = :id LIMIT 1',
            [':id' => trim((string) ($params['id'] ?? ''))]
        );
        return $row ? $this->mapPaymentMethod($row) : null;
    }

    public function createPaymentMethod(array $params): array
    {
        $this->requireAdmin();
        $id = $this->stringId($params['id'] ?? null);
        $this->database->execute(
            'INSERT INTO payment_methods (id, name, description, is_active, created_at, updated_at)
             VALUES (:id, :name, :description, 1, :created_at, :updated_at)',
            [
                ':id' => $id,
                ':name' => trim((string) ($params['name'] ?? '')),
                ':description' => $this->nullableString($params['description'] ?? null),
                ':created_at' => $this->database->nowUtc(),
                ':updated_at' => $this->database->nowUtc(),
            ]
        );

        return $this->fetchPaymentMethodById(['id' => $id]) ?? throw new RuntimeException('Failed to create payment method.');
    }

    public function updatePaymentMethod(array $params): array
    {
        $this->requireAdmin();
        $id = trim((string) ($params['id'] ?? ''));
        $updates = is_array($params['updates'] ?? null) ? $params['updates'] : [];
        $payload = [];
        if (array_key_exists('name', $updates)) {
            $payload['name'] = trim((string) $updates['name']);
        }
        if (array_key_exists('description', $updates)) {
            $payload['description'] = $this->nullableString($updates['description']);
        }
        if (array_key_exists('isActive', $updates)) {
            $payload['is_active'] = $updates['isActive'] ? 1 : 0;
        }
        $this->touchUpdate('payment_methods', $id, $payload);
        return $this->fetchPaymentMethodById(['id' => $id]) ?? throw new RuntimeException('Payment method not found.');
    }

    public function deletePaymentMethod(array $params): array
    {
        $this->requireAdmin();
        $this->database->execute(
            'DELETE FROM payment_methods WHERE id = :id',
            [':id' => trim((string) ($params['id'] ?? ''))]
        );
        return ['success' => true];
    }

    public function fetchUnits(array $params = []): array
    {
        $rows = $this->database->fetchAll('SELECT * FROM units ORDER BY name ASC');
        return array_map(fn(array $row): array => $this->mapUnit($row), $rows);
    }

    public function fetchUnitById(array $params): ?array
    {
        $row = $this->database->fetchOne(
            'SELECT * FROM units WHERE id = :id LIMIT 1',
            [':id' => trim((string) ($params['id'] ?? ''))]
        );
        return $row ? $this->mapUnit($row) : null;
    }

    public function createUnit(array $params): array
    {
        $this->requireAdmin();
        $id = strtolower(trim((string) ($params['shortName'] ?? $params['id'] ?? '')));
        if ($id === '') {
            throw new RuntimeException('Unit short name is required.');
        }

        $this->database->execute(
            'INSERT INTO units (id, name, short_name, description, created_at, updated_at)
             VALUES (:id, :name, :short_name, :description, :created_at, :updated_at)',
            [
                ':id' => $id,
                ':name' => trim((string) ($params['name'] ?? '')),
                ':short_name' => trim((string) ($params['shortName'] ?? '')),
                ':description' => $this->nullableString($params['description'] ?? null),
                ':created_at' => $this->database->nowUtc(),
                ':updated_at' => $this->database->nowUtc(),
            ]
        );

        return $this->fetchUnitById(['id' => $id]) ?? throw new RuntimeException('Failed to create unit.');
    }

    public function updateUnit(array $params): array
    {
        $this->requireAdmin();
        $id = trim((string) ($params['id'] ?? ''));
        $updates = is_array($params['updates'] ?? null) ? $params['updates'] : [];
        $payload = [];
        if (array_key_exists('name', $updates)) {
            $payload['name'] = trim((string) $updates['name']);
        }
        if (array_key_exists('shortName', $updates)) {
            $payload['short_name'] = trim((string) $updates['shortName']);
        }
        if (array_key_exists('description', $updates)) {
            $payload['description'] = $this->nullableString($updates['description']);
        }
        $this->touchUpdate('units', $id, $payload);
        return $this->fetchUnitById(['id' => $id]) ?? throw new RuntimeException('Unit not found.');
    }

    public function deleteUnit(array $params): array
    {
        $this->requireAdmin();
        $this->database->execute('DELETE FROM units WHERE id = :id', [':id' => trim((string) ($params['id'] ?? ''))]);
        return ['success' => true];
    }

    public function fetchCompanySettings(array $params = []): array
    {
        $row = $this->database->fetchOne('SELECT * FROM company_settings LIMIT 1');
        $pages = $this->normalizeCompanyPages($row['pages'] ?? [], $row ?? []);
        $globalPage = $this->getGlobalCompanyPage($pages);

        return [
            'id' => (string) ($row['id'] ?? 'company-default'),
            'name' => (string) ($globalPage['name'] ?? 'Mame Pilot'),
            'phone' => (string) ($globalPage['phone'] ?? '+880'),
            'email' => (string) ($globalPage['email'] ?? 'info@company.com'),
            'address' => (string) ($globalPage['address'] ?? ''),
            'logo' => (string) ($globalPage['logo'] ?? '/uploads/Avatar.png'),
            'pages' => $pages,
        ];
    }

    public function updateCompanySettings(array $params): array
    {
        $this->requireAdmin();
        $current = $this->fetchCompanySettings();
        $pages = [];

        if (array_key_exists('pages', $params)) {
            $pages = $this->normalizeCompanyPages($params['pages'], $current);
        } else {
            $pages = $this->normalizeCompanyPages($current['pages'] ?? [], $current);
            $globalIndex = 0;

            foreach ($pages as $index => $page) {
                if ((bool) ($page['isGlobalBranding'] ?? false)) {
                    $globalIndex = $index;
                    break;
                }
            }

            $pages[$globalIndex] = $this->normalizeCompanyPage(
                [
                    ...$pages[$globalIndex],
                    'name' => $params['name'] ?? $pages[$globalIndex]['name'],
                    'phone' => $params['phone'] ?? $pages[$globalIndex]['phone'],
                    'email' => $params['email'] ?? $pages[$globalIndex]['email'],
                    'address' => array_key_exists('address', $params) ? $params['address'] : $pages[$globalIndex]['address'],
                    'logo' => array_key_exists('logo', $params) ? $params['logo'] : $pages[$globalIndex]['logo'],
                    'isGlobalBranding' => true,
                ],
                $globalIndex
            );
            $pages = $this->normalizeCompanyPages($pages, $current);
        }

        $globalPage = $this->getGlobalCompanyPage($pages);

        return $this->saveSingleton(
            'company_settings',
            'company-default',
            [
                'name' => $globalPage['name'] ?? $current['name'],
                'phone' => $globalPage['phone'] ?? $current['phone'],
                'email' => $globalPage['email'] ?? $current['email'],
                'address' => $globalPage['address'] ?? $current['address'],
                'logo' => $globalPage['logo'] ?? $current['logo'],
                'pages' => $this->jsonEncode($pages),
            ],
            fn(): array => $this->fetchCompanySettings()
        );
    }

    public function fetchOrderSettings(array $params = []): array
    {
        $row = $this->database->fetchOne('SELECT * FROM order_settings LIMIT 1');
        return [
            'prefix' => (string) ($row['prefix'] ?? 'ORD-'),
            'nextNumber' => (int) ($row['next_number'] ?? 1),
        ];
    }

    public function updateOrderSettings(array $params): array
    {
        $this->requireAdmin();
        $current = $this->fetchOrderSettings();
        return $this->saveSingleton(
            'order_settings',
            'order-default',
            [
                'prefix' => $params['prefix'] ?? $current['prefix'],
                'next_number' => array_key_exists('nextNumber', $params) ? (int) $params['nextNumber'] : $current['nextNumber'],
            ],
            fn(): array => $this->fetchOrderSettings()
        );
    }

    public function fetchInvoiceSettings(array $params = []): array
    {
        $row = $this->database->fetchOne('SELECT * FROM invoice_settings LIMIT 1');
        return [
            'title' => (string) ($row['title'] ?? 'Invoice'),
            'logoWidth' => (int) ($row['logo_width'] ?? 120),
            'logoHeight' => (int) ($row['logo_height'] ?? 120),
            'footer' => (string) ($row['footer'] ?? ''),
        ];
    }

    public function updateInvoiceSettings(array $params): array
    {
        $this->requireAdmin();
        $current = $this->fetchInvoiceSettings();
        return $this->saveSingleton(
            'invoice_settings',
            'invoice-default',
            [
                'title' => $params['title'] ?? $current['title'],
                'logo_width' => array_key_exists('logoWidth', $params) ? (int) $params['logoWidth'] : $current['logoWidth'],
                'logo_height' => array_key_exists('logoHeight', $params) ? (int) $params['logoHeight'] : $current['logoHeight'],
                'footer' => array_key_exists('footer', $params) ? $params['footer'] : $current['footer'],
            ],
            fn(): array => $this->fetchInvoiceSettings()
        );
    }

    public function fetchSystemDefaults(array $params = []): array
    {
        $row = $this->database->fetchOne('SELECT * FROM system_defaults LIMIT 1');
        $capabilitySettings = $this->fetchCapabilitySettings();
        return [
            'defaultAccountId' => (string) ($row['default_account_id'] ?? ''),
            'defaultPaymentMethod' => (string) ($row['default_payment_method'] ?? ''),
            'incomeCategoryId' => (string) ($row['income_category_id'] ?? ''),
            'expenseCategoryId' => (string) ($row['expense_category_id'] ?? ''),
            'recordsPerPage' => (int) ($row['records_per_page'] ?? 10),
            'maxTransactionAmount' => (float) ($row['max_transaction_amount'] ?? 0),
            'whiteLabel' => (bool) (($capabilitySettings['capabilities']['whitelabel'] ?? null) ?? ($row['white_label'] ?? 0)),
        ];
    }

    public function updateSystemDefaults(array $params): array
    {
        $this->requireAdmin();
        $current = $this->fetchSystemDefaults();
        return $this->saveSingleton(
            'system_defaults',
            'system-default',
            [
                'default_account_id' => array_key_exists('defaultAccountId', $params) ? $this->nullableString($params['defaultAccountId']) : $current['defaultAccountId'],
                'default_payment_method' => array_key_exists('defaultPaymentMethod', $params) ? $this->nullableString($params['defaultPaymentMethod']) : $current['defaultPaymentMethod'],
                'income_category_id' => array_key_exists('incomeCategoryId', $params) ? $this->nullableString($params['incomeCategoryId']) : $current['incomeCategoryId'],
                'expense_category_id' => array_key_exists('expenseCategoryId', $params) ? $this->nullableString($params['expenseCategoryId']) : $current['expenseCategoryId'],
                'records_per_page' => array_key_exists('recordsPerPage', $params) ? (int) $params['recordsPerPage'] : $current['recordsPerPage'],
                'max_transaction_amount' => array_key_exists('maxTransactionAmount', $params) ? $this->formatMoney($params['maxTransactionAmount']) : $this->formatMoney($current['maxTransactionAmount'] ?? 0),
                'white_label' => array_key_exists('whiteLabel', $params) ? (int) (bool) $params['whiteLabel'] : (int) ($current['whiteLabel'] ?? false),
            ],
            fn(): array => $this->fetchSystemDefaults()
        );
    }

    private function normalizeCapabilities($value): array
    {
        $defaults = FeatureAccess::defaultCapabilities();
        $raw = is_array($value) ? $value : $this->jsonDecodeAssoc($value);
        foreach ($defaults as $key => $default) {
            if (array_key_exists($key, $raw)) {
                $defaults[$key] = (bool) $raw[$key];
            }
        }

        return $defaults;
    }

    private function capabilityRow(): ?array
    {
        return $this->tableExists('app_capability_settings')
            ? $this->database->fetchOne('SELECT * FROM app_capability_settings LIMIT 1')
            : null;
    }

    public function fetchCapabilitySettings(array $params = []): array
    {
        $user = null;
        try {
            $user = $this->currentUser();
        } catch (\Throwable) {
            $user = null;
        }
        $isDeveloper = trim((string) ($user['role'] ?? '')) === 'Developer';
        $row = $this->capabilityRow();
        $capabilities = $this->normalizeCapabilities($row['capabilities'] ?? null);

        return [
            'capabilities' => $capabilities,
            'tierKey' => $this->nullableString($row['tier_key'] ?? null),
            'planName' => $this->nullableString($row['plan_name'] ?? null),
            'licenseStatus' => (string) ($row['license_status'] ?? 'local'),
            'renewalDate' => $this->toIso($row['renewal_date'] ?? null),
            'overrideEnabled' => !empty($row['override_enabled']),
            'availableTiers' => $this->normalizeLicenseTiers($row['available_tiers'] ?? null),
            'pricingMetadata' => $this->jsonDecodeAssoc($row['pricing_metadata'] ?? null),
            'lastSyncedAt' => $this->toIso($row['last_synced_at'] ?? null),
            'lastSyncStatus' => $this->nullableString($row['last_sync_status'] ?? null),
            'lastSyncMessage' => $this->nullableString($row['last_sync_message'] ?? null),
            'syncGraceUntil' => $this->toIso($row['sync_grace_until'] ?? null),
            'licenseKey' => $isDeveloper ? (string) ($row['license_key'] ?? '') : '',
            'licenseApiUrl' => $isDeveloper ? (string) ($row['license_api_url'] ?? '') : '',
            'licenseOwnerToken' => $isDeveloper ? (string) ($row['license_owner_token'] ?? '') : '',
        ];
    }

    public function updateCapabilitySettings(array $params): array
    {
        if (empty($params['__skipDeveloperCheck'])) {
            $this->requireDeveloperUser();
        }
        if (!$this->tableExists('app_capability_settings')) {
            throw new RuntimeException('Capability settings table is missing. Run the latest migration first.');
        }

        $current = $this->fetchCapabilitySettings();
        $capabilities = array_key_exists('capabilities', $params)
            ? $this->normalizeCapabilities($params['capabilities'])
            : $this->normalizeCapabilities($current['capabilities'] ?? []);

        $row = $this->capabilityRow();
        $id = (string) ($row['id'] ?? 'app-capabilities-default');
        $payload = [
            'capabilities' => $this->jsonEncode($capabilities),
            'license_key' => array_key_exists('licenseKey', $params) ? $this->nullableString($params['licenseKey']) : $this->nullableString($row['license_key'] ?? null),
            'license_api_url' => array_key_exists('licenseApiUrl', $params) ? $this->nullableString($params['licenseApiUrl']) : $this->nullableString($row['license_api_url'] ?? null),
            'license_owner_token' => array_key_exists('licenseOwnerToken', $params) ? $this->nullableString($params['licenseOwnerToken']) : $this->nullableString($row['license_owner_token'] ?? null),
            'tier_key' => array_key_exists('tierKey', $params) ? $this->nullableString($params['tierKey']) : $this->nullableString($row['tier_key'] ?? null),
            'plan_name' => array_key_exists('planName', $params) ? $this->nullableString($params['planName']) : $this->nullableString($row['plan_name'] ?? null),
            'license_status' => array_key_exists('licenseStatus', $params) ? trim((string) $params['licenseStatus']) : (string) ($row['license_status'] ?? 'local'),
            'renewal_date' => array_key_exists('renewalDate', $params) && $params['renewalDate'] ? $this->normalizeDateTimeInput((string) $params['renewalDate']) : ($row['renewal_date'] ?? null),
            'override_enabled' => array_key_exists('overrideEnabled', $params) ? (!empty($params['overrideEnabled']) ? 1 : 0) : (int) ($row['override_enabled'] ?? 0),
            'available_tiers' => array_key_exists('availableTiers', $params) ? $this->jsonEncode($this->normalizeLicenseTiers($params['availableTiers'])) : ($row['available_tiers'] ?? null),
            'pricing_metadata' => array_key_exists('pricingMetadata', $params) ? $this->jsonEncode(is_array($params['pricingMetadata']) ? $params['pricingMetadata'] : []) : ($row['pricing_metadata'] ?? null),
            'last_sync_status' => array_key_exists('lastSyncStatus', $params) ? trim((string) $params['lastSyncStatus']) : 'manual',
            'last_sync_message' => array_key_exists('lastSyncMessage', $params) ? $this->nullableString($params['lastSyncMessage']) : 'Saved manually by developer.',
        ];

        foreach (['license_owner_token', 'tier_key', 'override_enabled', 'available_tiers', 'pricing_metadata'] as $column) {
            if (!$this->columnExists('app_capability_settings', $column)) {
                unset($payload[$column]);
            }
        }

        if ($row !== null) {
            $payload['updated_at'] = $this->database->nowUtc();
            [$setClause, $bindings] = $this->database->buildSetClause($payload);
            $bindings[':id'] = $id;
            $this->database->execute("UPDATE app_capability_settings SET {$setClause} WHERE id = :id", $bindings);
        } else {
            $payload['id'] = $id;
            $payload['created_at'] = $this->database->nowUtc();
            $payload['updated_at'] = $this->database->nowUtc();
            $columns = implode(', ', array_keys($payload));
            $placeholders = implode(', ', array_map(static fn(string $column): string => ':' . $column, array_keys($payload)));
            $bindings = [];
            foreach ($payload as $column => $value) {
                $bindings[':' . $column] = $value;
            }
            $this->database->execute("INSERT INTO app_capability_settings ({$columns}) VALUES ({$placeholders})", $bindings);
        }

        $this->database->execute(
            'UPDATE system_defaults SET white_label = :white_label, updated_at = :updated_at',
            [
                ':white_label' => !empty($capabilities['whitelabel']) ? 1 : 0,
                ':updated_at' => $this->database->nowUtc(),
            ]
        );

        return $this->fetchCapabilitySettings();
    }

    public function fetchCentralLicenseTiers(array $params = []): array
    {
        $this->requireDeveloperUser();
        $settingsRow = $this->capabilityRow();
        $apiUrl = trim((string) ($params['licenseApiUrl'] ?? $settingsRow['license_api_url'] ?? ''));
        if ($apiUrl === '') {
            throw new RuntimeException('License API URL is required before loading tiers.');
        }

        $response = $this->centralLicenseRequest($apiUrl, null, 'list_tiers');
        $tiers = $this->normalizeLicenseTiers($response['tiers'] ?? []);

        $this->updateCapabilitySettings([
            '__skipDeveloperCheck' => true,
            'licenseApiUrl' => $apiUrl,
            'licenseOwnerToken' => $params['licenseOwnerToken'] ?? $settingsRow['license_owner_token'] ?? null,
            'availableTiers' => $tiers,
            'lastSyncStatus' => 'tiers_loaded',
            'lastSyncMessage' => 'Central license tiers loaded successfully.',
        ]);

        return ['tiers' => $tiers];
    }

    public function createOrUpdateCentralLicense(array $params): array
    {
        $this->requireDeveloperUser();
        $settingsRow = $this->capabilityRow();
        $apiUrl = trim((string) ($params['licenseApiUrl'] ?? $settingsRow['license_api_url'] ?? ''));
        $ownerToken = trim((string) ($params['licenseOwnerToken'] ?? $settingsRow['license_owner_token'] ?? ''));
        $tierKey = trim((string) ($params['tierKey'] ?? ''));
        if ($apiUrl === '' || $ownerToken === '' || $tierKey === '') {
            throw new RuntimeException('License API URL, owner token, and tier are required.');
        }

        $licenseKey = trim((string) ($params['licenseKey'] ?? $settingsRow['license_key'] ?? ''));
        $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
        $payload = [
            'license_key' => $licenseKey ?: null,
            'client_name' => trim((string) ($params['clientName'] ?? $host ?: 'MamePilot Client')),
            'domain' => trim((string) ($params['domain'] ?? $host)),
            'tier_key' => $tierKey,
            'status' => trim((string) ($params['status'] ?? 'active')),
            'renewal_date' => $params['renewalDate'] ?? $settingsRow['renewal_date'] ?? null,
        ];

        $response = $this->centralLicenseRequest($apiUrl, $ownerToken, 'create_or_update_license', $payload);
        return $this->storeResolvedLicensePayload($response, $apiUrl, $ownerToken, 'Central license saved successfully.');
    }

    public function updateCentralLicenseOverride(array $params): array
    {
        $this->requireDeveloperUser();
        $settingsRow = $this->capabilityRow();
        $apiUrl = trim((string) ($params['licenseApiUrl'] ?? $settingsRow['license_api_url'] ?? ''));
        $ownerToken = trim((string) ($params['licenseOwnerToken'] ?? $settingsRow['license_owner_token'] ?? ''));
        $licenseKey = trim((string) ($params['licenseKey'] ?? $settingsRow['license_key'] ?? ''));
        if ($apiUrl === '' || $ownerToken === '' || $licenseKey === '') {
            throw new RuntimeException('License API URL, owner token, and license key are required.');
        }

        $capabilities = array_keys(array_filter($this->normalizeCapabilities($params['capabilities'] ?? [])));
        $response = $this->centralLicenseRequest($apiUrl, $ownerToken, 'update_license_override', [
            'license_key' => $licenseKey,
            'capabilities' => $capabilities,
        ]);

        return $this->storeResolvedLicensePayload($response, $apiUrl, $ownerToken, 'Central capability override saved successfully.');
    }

    public function resetCentralLicenseOverride(array $params = []): array
    {
        $this->requireDeveloperUser();
        $settingsRow = $this->capabilityRow();
        $apiUrl = trim((string) ($params['licenseApiUrl'] ?? $settingsRow['license_api_url'] ?? ''));
        $ownerToken = trim((string) ($params['licenseOwnerToken'] ?? $settingsRow['license_owner_token'] ?? ''));
        $licenseKey = trim((string) ($params['licenseKey'] ?? $settingsRow['license_key'] ?? ''));
        if ($apiUrl === '' || $ownerToken === '' || $licenseKey === '') {
            throw new RuntimeException('License API URL, owner token, and license key are required.');
        }

        $response = $this->centralLicenseRequest($apiUrl, $ownerToken, 'reset_license_override', [
            'license_key' => $licenseKey,
        ]);

        return $this->storeResolvedLicensePayload($response, $apiUrl, $ownerToken, 'Central capability override reset to tier defaults.');
    }

    public function syncLicenseCapabilities(array $params = []): array
    {
        $cronSecret = trim((string) ($params['cronSecret'] ?? ''));
        $expectedCronSecret = trim((string) ($this->config->get('LICENSE_CRON_SECRET', '') ?? ''));
        if ($cronSecret === '' || $expectedCronSecret === '' || !hash_equals($expectedCronSecret, $cronSecret)) {
            $user = $this->currentUser();
            if (!$this->hasAdminAccess((string) ($user['role'] ?? ''))) {
                throw new ApiException('Admin access required.', 403, 'ADMIN_ACCESS_REQUIRED');
            }
            if (
                trim((string) ($user['role'] ?? '')) !== 'Developer'
                && (array_key_exists('licenseKey', $params) || array_key_exists('licenseApiUrl', $params))
            ) {
                throw new ApiException('Developer access required.', 403, 'DEVELOPER_ACCESS_REQUIRED');
            }
        }

        $settingsRow = $this->capabilityRow();
        $licenseKey = trim((string) ($params['licenseKey'] ?? $settingsRow['license_key'] ?? ''));
        $apiUrl = trim((string) ($params['licenseApiUrl'] ?? $settingsRow['license_api_url'] ?? ''));
        if ($licenseKey === '' || $apiUrl === '') {
            throw new RuntimeException('License key and license API URL are required before syncing.');
        }

        $response = $this->httpJson('POST', $apiUrl, [], [
            'action' => 'resolve_license',
            'license_key' => $licenseKey,
            'domain' => $_SERVER['HTTP_HOST'] ?? '',
        ]);
        if ($response['status'] < 200 || $response['status'] >= 300 || !is_array($response['json'])) {
            $this->updateCapabilitySettings([
                '__skipDeveloperCheck' => true,
                'licenseKey' => $licenseKey,
                'licenseApiUrl' => $apiUrl,
                'lastSyncStatus' => 'failed',
            ]);
            throw new RuntimeException('License sync failed.');
        }

        return $this->storeResolvedLicensePayload($response['json'], $apiUrl, $settingsRow['license_owner_token'] ?? null, 'License capabilities synced successfully.');
    }

    private function centralLicenseRequest(string $apiUrl, ?string $ownerToken, string $action, array $payload = []): array
    {
        $apiUrl = trim($apiUrl);
        $headers = ['Accept' => 'application/json'];
        $ownerToken = trim((string) ($ownerToken ?? ''));
        if ($ownerToken !== '') {
            $headers['X-MamePilot-Owner-Token'] = $ownerToken;
        }

        $response = $this->httpJson('POST', $apiUrl, $headers, ['action' => $action] + $payload);
        if ($response['status'] < 200 || $response['status'] >= 300 || !is_array($response['json'])) {
            $message = is_array($response['json'] ?? null)
                ? (string) (($response['json']['error'] ?? null) ?: 'Central license request failed.')
                : 'Central license request failed.';
            if ((int) $response['status'] === 404) {
                $message = 'Central license API endpoint not found at ' . $apiUrl . '. Upload deploy/central-license-api-template.php as api.php on the license subdomain, then use the full /api.php URL.';
            }
            throw new RuntimeException($message);
        }

        return $response['json'];
    }

    private function storeResolvedLicensePayload(array $payload, string $apiUrl, $ownerToken, string $message): array
    {
        $licenseKey = trim((string) ($payload['license_key'] ?? $payload['licenseKey'] ?? ''));
        $pricingMetadata = is_array($payload['pricing_metadata'] ?? null)
            ? $payload['pricing_metadata']
            : (is_array($payload['pricingMetadata'] ?? null) ? $payload['pricingMetadata'] : []);

        $this->updateCapabilitySettings([
            '__skipDeveloperCheck' => true,
            'capabilities' => $this->capabilityMapFromRemote($payload['capabilities'] ?? $payload['enabled_capabilities'] ?? []),
            'licenseKey' => $licenseKey,
            'licenseApiUrl' => $apiUrl,
            'licenseOwnerToken' => $ownerToken,
            'tierKey' => $payload['tier_key'] ?? $payload['tierKey'] ?? null,
            'planName' => $payload['plan_name'] ?? $payload['planName'] ?? null,
            'licenseStatus' => $payload['status'] ?? 'active',
            'renewalDate' => $payload['renewal_date'] ?? $payload['renewalDate'] ?? null,
            'overrideEnabled' => !empty($payload['override_enabled'] ?? $payload['overrideEnabled'] ?? false),
            'availableTiers' => $payload['available_tiers'] ?? $payload['availableTiers'] ?? [],
            'pricingMetadata' => $pricingMetadata,
            'lastSyncStatus' => 'success',
            'lastSyncMessage' => $message,
        ]);

        $row = $this->capabilityRow();
        if ($row !== null) {
            $this->touchUpdate('app_capability_settings', (string) $row['id'], [
                'last_synced_at' => $this->database->nowUtc(),
                'last_sync_status' => 'success',
                'last_sync_message' => $message,
            ]);
        }

        $this->syncLocalSubscriptionPlanFromLicense($payload, $pricingMetadata);
        return $this->fetchCapabilitySettings();
    }

    private function syncLocalSubscriptionPlanFromLicense(array $payload, array $pricingMetadata): void
    {
        if (!$this->tableExists('service_subscription_settings')) {
            return;
        }

        $monthlyAmount = max(0.0, (float) ($pricingMetadata['monthly'] ?? $pricingMetadata['monthly_price'] ?? 0));
        $planName = $this->nullableString($payload['plan_name'] ?? $payload['planName'] ?? null);
        $status = trim((string) ($payload['status'] ?? 'active')) ?: 'active';
        $renewalDate = $this->nullableString($payload['renewal_date'] ?? $payload['renewalDate'] ?? null);
        $currentPeriodEnd = $renewalDate !== null ? $this->normalizeDateTimeInput($renewalDate) : null;
        $row = $this->database->fetchOne('SELECT id, billing_interval FROM service_subscription_settings LIMIT 1');
        $settingsId = (string) ($row['id'] ?? 'service-subscriptions-default');
        $updates = [
            'plan_name' => $planName,
            'billing_interval' => $this->nullableString($row['billing_interval'] ?? null) ?? 'monthly',
            'subscription_status' => $status,
            'current_period_end' => $currentPeriodEnd,
            'due_at' => $currentPeriodEnd,
        ];
        if ($monthlyAmount > 0) {
            $updates['total_amount'] = $this->formatMoney($monthlyAmount);
        }

        if ($row !== null) {
            $this->touchUpdate('service_subscription_settings', $settingsId, $updates);
            return;
        }

        $updates['id'] = $settingsId;
        $updates['warning_days'] = 7;
        $updates['billing_version'] = 1;
        $updates['created_at'] = $this->database->nowUtc();
        $updates['updated_at'] = $this->database->nowUtc();
        $columns = implode(', ', array_keys($updates));
        $placeholders = implode(', ', array_map(static fn(string $column): string => ':' . $column, array_keys($updates)));
        $bindings = [];
        foreach ($updates as $column => $value) {
            $bindings[':' . $column] = $value;
        }
        $this->database->execute("INSERT INTO service_subscription_settings ({$columns}) VALUES ({$placeholders})", $bindings);
    }

    private function capabilityMapFromRemote($rawCapabilities): array
    {
        $capabilityMap = FeatureAccess::defaultCapabilities();
        $isList = is_array($rawCapabilities) && ($rawCapabilities === [] || array_keys($rawCapabilities) === range(0, count($rawCapabilities) - 1));
        if ($isList) {
            foreach ($capabilityMap as $key => $_) {
                $capabilityMap[$key] = in_array($key, $rawCapabilities, true);
            }
            return $capabilityMap;
        }

        return $this->normalizeCapabilities($rawCapabilities);
    }

    private function normalizeLicenseTiers($tiers): array
    {
        $rows = is_array($tiers) ? array_values($tiers) : $this->jsonDecodeList($tiers);
        $normalized = [];
        foreach ($rows as $row) {
            if (!is_array($row)) {
                continue;
            }
            $tierKey = trim((string) ($row['tierKey'] ?? $row['tier_key'] ?? ''));
            if ($tierKey === '') {
                continue;
            }
            $capabilities = is_array($row['capabilities'] ?? null) ? array_values($row['capabilities']) : [];
            $normalized[] = [
                'tierKey' => $tierKey,
                'tierName' => (string) ($row['tierName'] ?? $row['tier_name'] ?? ucfirst(str_replace('_', ' ', $tierKey))),
                'monthlyPrice' => (float) ($row['monthlyPrice'] ?? $row['monthly_price'] ?? 0),
                'yearlyPrice' => (float) ($row['yearlyPrice'] ?? $row['yearly_price'] ?? 0),
                'capabilities' => array_values(array_filter(array_map('strval', $capabilities))),
            ];
        }

        return $normalized;
    }

    public function fetchPaymentGatewaySettings(array $params = []): array
    {
        $this->requireDeveloperUser();
        $row = $this->tableExists('payment_gateway_settings')
            ? $this->database->fetchOne('SELECT * FROM payment_gateway_settings LIMIT 1')
            : null;

        return [
            'piprapayBaseUrl' => (string) ($row['piprapay_base_url'] ?? ''),
            'piprapayApiKey' => (string) ($row['piprapay_api_key'] ?? ''),
            'piprapayMerchantId' => (string) ($row['piprapay_merchant_id'] ?? ''),
            'piprapayIpnSecret' => (string) ($row['piprapay_ipn_secret'] ?? ''),
        ];
    }

    public function updatePaymentGatewaySettings(array $params): array
    {
        $this->requireDeveloperUser();
        if (!$this->tableExists('payment_gateway_settings')) {
            throw new RuntimeException('Payment gateway settings table is missing. Run the latest migration first.');
        }

        $row = $this->database->fetchOne('SELECT id FROM payment_gateway_settings LIMIT 1');
        $id = (string) ($row['id'] ?? 'payment-gateway-default');
        $payload = [
            'piprapay_base_url' => $this->nullableString($params['piprapayBaseUrl'] ?? null),
            'piprapay_api_key' => $this->nullableString($params['piprapayApiKey'] ?? null),
            'piprapay_merchant_id' => $this->nullableString($params['piprapayMerchantId'] ?? null),
            'piprapay_ipn_secret' => $this->nullableString($params['piprapayIpnSecret'] ?? null),
        ];

        if ($row !== null) {
            $this->touchUpdate('payment_gateway_settings', $id, $payload);
        } else {
            $payload['id'] = $id;
            $payload['created_at'] = $this->database->nowUtc();
            $payload['updated_at'] = $this->database->nowUtc();
            $columns = implode(', ', array_keys($payload));
            $placeholders = implode(', ', array_map(static fn(string $column): string => ':' . $column, array_keys($payload)));
            $bindings = [];
            foreach ($payload as $column => $value) {
                $bindings[':' . $column] = $value;
            }
            $this->database->execute("INSERT INTO payment_gateway_settings ({$columns}) VALUES ({$placeholders})", $bindings);
        }

        return $this->fetchPaymentGatewaySettings();
    }

    public function fetchLocalUsageSummary(array $params = []): array
    {
        $this->requireDeveloperUser();
        $count = function (string $table, string $where = ''): int {
            if (!$this->tableExists($table)) {
                return 0;
            }
            $row = $this->database->fetchOne("SELECT COUNT(*) AS count FROM {$table} {$where}");
            return (int) ($row['count'] ?? 0);
        };

        return [
            'activeUsers' => $count('users', 'WHERE deleted_at IS NULL'),
            'totalTransactions' => $count('transactions', 'WHERE deleted_at IS NULL'),
            'totalOrders' => $count('orders', 'WHERE deleted_at IS NULL'),
            'totalBills' => $count('bills', 'WHERE deleted_at IS NULL'),
            'totalCustomers' => $count('customers', 'WHERE deleted_at IS NULL'),
            'totalProducts' => $count('products', 'WHERE deleted_at IS NULL'),
        ];
    }

    public function initiatePipraPayCheckout(array $params): array
    {
        $user = $this->currentUser();
        if (!$this->hasAdminAccess((string) ($user['role'] ?? ''))) {
            throw new ApiException('Admin access required.', 403, 'ADMIN_ACCESS_REQUIRED');
        }
        if (!$this->tableExists('payment_gateway_settings') || !$this->tableExists('service_subscription_payments')) {
            throw new RuntimeException('Payment gateway tables are missing. Run the latest migration first.');
        }

        $gateway = $this->database->fetchOne('SELECT * FROM payment_gateway_settings LIMIT 1');
        $baseUrl = preg_replace('#/api$#', '', rtrim(trim((string) ($gateway['piprapay_base_url'] ?? '')), '/'));
        $apiKey = trim((string) ($gateway['piprapay_api_key'] ?? ''));
        if ($baseUrl === '' || $apiKey === '') {
            throw new RuntimeException('PipraPay gateway is not configured yet.');
        }

        $interval = trim((string) ($params['interval'] ?? 'monthly')) === 'yearly' ? 'yearly' : 'monthly';
        $capabilitySettings = $this->fetchCapabilitySettings();
        $pricing = is_array($capabilitySettings['pricingMetadata'] ?? null) ? $capabilitySettings['pricingMetadata'] : [];
        $amount = max(0.0, (float) ($pricing[$interval] ?? 0));
        if ($amount <= 0) {
            $amount = max(0.0, (float) ($params['amount'] ?? 0));
        }
        if ($amount <= 0) {
            $overview = $this->buildServiceSubscriptionOverview($user);
            $amount = (float) ($overview['totalAmount'] ?? 0);
        }
        if ($amount <= 0) {
            throw new RuntimeException('Checkout amount must be greater than zero.');
        }

        $settings = $this->tableExists('service_subscription_settings') ? $this->database->fetchOne('SELECT * FROM service_subscription_settings LIMIT 1') : null;
        $billingVersion = max(1, (int) ($settings['billing_version'] ?? 1));
        $reference = 'SUB-' . strtoupper(substr($this->uuid4(), 0, 12));

        $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
        $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
        if ($origin !== '') {
            $returnBase = $origin;
        } else {
            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            $returnBase = $scheme . '://' . $host;
        }
        $metadataArray = [
            'local_reference' => $reference,
            'billing_interval' => $interval,
            'billing_version' => (string) $billingVersion,
            'license_key' => (string) (($capabilitySettings['licenseKey'] ?? '') ?: ''),
            'tier_key' => (string) (($capabilitySettings['tierKey'] ?? '') ?: ''),
            'plan_name' => (string) (($capabilitySettings['planName'] ?? '') ?: ''),
            'domain' => $host,
        ];
        $payload = [
            'full_name' => (string) ($user['name'] ?? 'Admin'),
            'email_address' => (string) (($user['email'] ?? null) ?: 'admin@example.com'),
            'mobile_number' => (string) (($user['phone'] ?? null) ?: '01700000000'),
            'amount' => round($amount, 2),
            'currency' => 'BDT',
            'order_id' => $reference,
            'metadata' => json_encode($metadataArray),
            'return_url' => $returnBase . '/api/?action=pipraPayReturn&reference=' . rawurlencode($reference),
            'webhook_url' => $returnBase . '/api/?action=handlePipraPayIpn',
        ];

        $response = $this->httpJson('POST', $baseUrl . '/api/checkout/redirect', [
            'mhs-piprapay-api-key' => $apiKey,
            'Accept' => 'application/json',
        ], $payload);
        if ($response['status'] < 200 || $response['status'] >= 300 || !is_array($response['json'])) {
            throw new RuntimeException('PipraPay checkout initialization failed: ' . $this->jsonEncode($response['json']));
        }

        $body = $response['json'];
        $checkoutUrl = (string) ($body['pp_url'] ?? $body['checkout_url'] ?? $body['url'] ?? $body['data']['pp_url'] ?? $body['data']['checkout_url'] ?? '');
        $gatewayPaymentId = (string) ($body['pp_id'] ?? $body['payment_id'] ?? $body['data']['pp_id'] ?? '');
        if ($checkoutUrl === '') {
            throw new RuntimeException('PipraPay did not return a checkout URL.');
        }

        $paymentId = $this->uuid4();
        $actorId = (string) ($user['id'] ?? $this->resolveSystemActorId());
        $this->database->execute(
            'INSERT INTO service_subscription_payments (
                id, billing_version, local_reference, gateway_payment_id, gateway_name, billing_interval,
                amount, base_amount, tip_amount, payment_method_id, payment_method_name, transaction_id,
                submitted_by, status, submitted_at, reactivate_at, processed_at, raw_payload, created_at, updated_at
             ) VALUES (
                :id, :billing_version, :local_reference, :gateway_payment_id, :gateway_name, :billing_interval,
                :amount, :base_amount, :tip_amount, NULL, :payment_method_name, :transaction_id,
                :submitted_by, :status, :submitted_at, NULL, NULL, :raw_payload, :created_at, :updated_at
             )',
            [
                ':id' => $paymentId,
                ':billing_version' => $billingVersion,
                ':local_reference' => $reference,
                ':gateway_payment_id' => $gatewayPaymentId ?: null,
                ':gateway_name' => 'piprapay',
                ':billing_interval' => $interval,
                ':amount' => $this->formatMoney($amount),
                ':base_amount' => $this->formatMoney($amount),
                ':tip_amount' => $this->formatMoney(0),
                ':payment_method_name' => 'PipraPay',
                ':transaction_id' => $gatewayPaymentId ?: $reference,
                ':submitted_by' => $actorId,
                ':status' => 'processing',
                ':submitted_at' => $this->database->nowUtc(),
                ':raw_payload' => $this->jsonEncode($body),
                ':created_at' => $this->database->nowUtc(),
                ':updated_at' => $this->database->nowUtc(),
            ]
        );

        return [
            'checkoutUrl' => $checkoutUrl,
            'localReference' => $reference,
            'gatewayPaymentId' => $gatewayPaymentId,
        ];
    }

    public function pipraPayReturn(array $params = []): array
    {
        $reference = trim((string) ($params['reference'] ?? ''));
        $status = strtolower(trim((string) ($params['status'] ?? $params['payment_status'] ?? '')));

        // Determine payment outcome
        $isSuccess = in_array($status, ['completed', 'complete', 'success', 'successful', 'paid', ''], true);
        $isCancelled = in_array($status, ['cancelled', 'canceled'], true);
        $paymentState = $isCancelled ? 'cancelled' : ($isSuccess ? 'success' : 'failed');

        // Build redirect base from Origin or HTTP_HOST
        $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? $_SERVER['HTTP_REFERER'] ?? '');
        if ($origin !== '') {
            $parsed = parse_url($origin);
            $base = ($parsed['scheme'] ?? 'http') . '://' . ($parsed['host'] ?? '') . (isset($parsed['port']) ? ':' . $parsed['port'] : '');
        } else {
            $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            $base = $scheme . '://' . $host;
        }

        $qs = '?payment=' . $paymentState;
        if ($reference !== '') {
            $qs .= '&reference=' . rawurlencode($reference);
        }
        header('Location: ' . $base . '/#/subscriptions' . $qs);
        exit;
    }

    public function handlePipraPayIpn(array $params = []): array
    {
        $gateway = $this->tableExists('payment_gateway_settings')
            ? $this->database->fetchOne('SELECT * FROM payment_gateway_settings LIMIT 1')
            : null;
        $apiKey = trim((string) ($gateway['piprapay_api_key'] ?? ''));
        $baseUrl = preg_replace('#/api$#', '', rtrim(trim((string) ($gateway['piprapay_base_url'] ?? '')), '/'));
        
        $eventId = trim((string) ($params['pp_id'] ?? $params['payment_id'] ?? $params['transaction_id'] ?? $params['order_id'] ?? ''));
        $rawMetadata = $params['metadata'] ?? null;
        $metadata = is_array($rawMetadata) ? $rawMetadata : (is_string($rawMetadata) ? (json_decode($rawMetadata, true) ?: []) : []);
        $reference = trim((string) ($metadata['local_reference'] ?? $params['order_id'] ?? $params['local_reference'] ?? ''));
        $status = strtolower(trim((string) ($params['status'] ?? $params['payment_status'] ?? '')));

        if ($eventId !== '' && $this->tableExists('payment_webhook_logs')) {
            $existing = $this->database->fetchOne(
                'SELECT id FROM payment_webhook_logs WHERE gateway = :gateway AND event_id = :event_id LIMIT 1',
                [':gateway' => 'piprapay', ':event_id' => $eventId]
            );
            if ($existing !== null) {
                return ['success' => true, 'duplicate' => true];
            }
        }

        if ($baseUrl !== '' && $apiKey !== '' && $eventId !== '') {
            $verify = $this->httpJson('POST', $baseUrl . '/api/verify-payment', [
                'mhs-piprapay-api-key' => $apiKey,
                'Accept' => 'application/json',
            ], ['pp_id' => $eventId]);
            if ($verify['status'] >= 200 && $verify['status'] < 300 && is_array($verify['json'])) {
                $verified = $verify['json'];
                $status = strtolower(trim((string) ($verified['status'] ?? $verified['payment_status'] ?? $status)));
                if ($reference === '') {
                    $verifiedRawMeta = $verified['metadata'] ?? null;
                    $verifiedMeta = is_array($verifiedRawMeta) ? $verifiedRawMeta : (is_string($verifiedRawMeta) ? (json_decode($verifiedRawMeta, true) ?: []) : []);
                    $reference = trim((string) ($verified['order_id'] ?? $verifiedMeta['local_reference'] ?? ''));
                }
            }
        }

        $isSuccess = in_array($status, ['completed', 'complete', 'success', 'successful', 'paid'], true);
        $isFailure = in_array($status, ['failed', 'cancelled', 'canceled', 'expired'], true);
        $payment = $reference !== ''
            ? $this->database->fetchOne('SELECT * FROM service_subscription_payments WHERE local_reference = :reference LIMIT 1', [':reference' => $reference])
            : null;
        if ($payment === null && $eventId !== '') {
            $payment = $this->database->fetchOne('SELECT * FROM service_subscription_payments WHERE gateway_payment_id = :gateway_payment_id OR transaction_id = :transaction_id LIMIT 1', [
                ':gateway_payment_id' => $eventId,
                ':transaction_id' => $eventId,
            ]);
        }

        if ($payment !== null) {
            $nextStatus = $isSuccess ? 'approved' : ($isFailure ? 'rejected' : (string) ($payment['status'] ?? 'processing'));
            $this->touchUpdate('service_subscription_payments', (string) $payment['id'], [
                'gateway_payment_id' => $eventId ?: ($payment['gateway_payment_id'] ?? null),
                'transaction_id' => $eventId ?: ($payment['transaction_id'] ?? $reference),
                'status' => $nextStatus,
                'processed_at' => $isSuccess ? $this->database->nowUtc() : ($payment['processed_at'] ?? null),
                'raw_payload' => $this->jsonEncode($params),
            ]);

            if ($isSuccess) {
                $this->extendSubscriptionFromPayment($payment);
            } elseif ($isFailure) {
                $this->markSubscriptionPastDue();
            }
        }

        if ($this->tableExists('payment_webhook_logs')) {
            $this->database->execute(
                'INSERT INTO payment_webhook_logs (id, gateway, event_id, local_reference, status, verified, raw_payload, created_at)
                 VALUES (:id, :gateway, :event_id, :local_reference, :status, :verified, :raw_payload, :created_at)',
                [
                    ':id' => $this->uuid4(),
                    ':gateway' => 'piprapay',
                    ':event_id' => $eventId ?: null,
                    ':local_reference' => $reference ?: null,
                    ':status' => $status ?: null,
                    ':verified' => 1,
                    ':raw_payload' => $this->jsonEncode($params),
                    ':created_at' => $this->database->nowUtc(),
                ]
            );
        }

        return ['success' => true];
    }

    /**
     * @return array{status:int, body:string, json:mixed}
     */
    private function httpJson(string $method, string $url, array $headers = [], ?array $jsonBody = null): array
    {
        $body = $jsonBody !== null ? json_encode($jsonBody, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null;

        if (function_exists('curl_init')) {
            $handle = curl_init($url);
            if ($handle === false) {
                throw new RuntimeException('Failed to initialize HTTP request.');
            }

            $headerList = [];
            foreach ($headers as $name => $value) {
                $headerList[] = $name . ': ' . $value;
            }
            if ($body !== null) {
                $headerList[] = 'Content-Type: application/json';
            }

            curl_setopt_array($handle, [
                CURLOPT_CUSTOMREQUEST => strtoupper($method),
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_HTTPHEADER => $headerList,
                CURLOPT_TIMEOUT => 30,
                CURLOPT_CONNECTTIMEOUT => 15,
                CURLOPT_FOLLOWLOCATION => true,
                CURLOPT_SSL_VERIFYPEER => true,
                CURLOPT_SSL_VERIFYHOST => 2,
            ]);

            if ($body !== null) {
                curl_setopt($handle, CURLOPT_POSTFIELDS, $body);
            }

            $responseBody = curl_exec($handle);
            if ($responseBody === false) {
                $message = curl_error($handle) ?: 'Unknown cURL error';
                curl_close($handle);
                throw new RuntimeException($message);
            }

            $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
            curl_close($handle);
        } else {
            $headerList = [];
            foreach ($headers as $name => $value) {
                $headerList[] = $name . ': ' . $value;
            }
            if ($body !== null) {
                $headerList[] = 'Content-Type: application/json';
            }

            $context = stream_context_create([
                'http' => [
                    'method' => strtoupper($method),
                    'header' => implode("\r\n", $headerList),
                    'content' => $body ?? '',
                    'timeout' => 30,
                    'ignore_errors' => true,
                ],
            ]);

            $responseBody = file_get_contents($url, false, $context);
            if ($responseBody === false) {
                throw new RuntimeException('HTTP request failed.');
            }

            $status = 200;
            foreach (($http_response_header ?? []) as $headerLine) {
                if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $headerLine, $matches) === 1) {
                    $status = (int) $matches[1];
                    break;
                }
            }
        }

        $decoded = json_decode((string) $responseBody, true);
        return [
            'status' => $status,
            'body' => (string) $responseBody,
            'json' => $decoded,
        ];
    }

    private function resolveSystemActorId(): string
    {
        $row = $this->database->fetchOne(
            "SELECT id FROM users WHERE role IN ('Developer', 'Admin') AND deleted_at IS NULL ORDER BY FIELD(role, 'Developer', 'Admin'), created_at ASC LIMIT 1"
        );

        return (string) ($row['id'] ?? '');
    }

    private function extendSubscriptionFromPayment(array $payment): void
    {
        if (!$this->tableExists('service_subscription_settings')) {
            return;
        }

        $settings = $this->database->fetchOne('SELECT * FROM service_subscription_settings LIMIT 1');
        if ($settings === null) {
            return;
        }

        $interval = trim((string) ($payment['billing_interval'] ?? 'monthly')) === 'yearly' ? 'yearly' : 'monthly';
        $now = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
        $currentEnd = $this->parseDateTimeValue((string) ($settings['current_period_end'] ?? $settings['due_at'] ?? ''), new \DateTimeZone('UTC'));
        $base = $currentEnd instanceof \DateTimeImmutable && $currentEnd > $now ? $currentEnd : $now;
        $nextEnd = $base->modify($interval === 'yearly' ? '+365 days' : '+30 days');
        $settingsId = (string) ($settings['id'] ?? 'service-subscriptions-default');
        $billingVersion = max(1, (int) ($settings['billing_version'] ?? 1)) + 1;

        $this->touchUpdate('service_subscription_settings', $settingsId, [
            'subscription_status' => 'active',
            'billing_interval' => $interval,
            'current_period_end' => $nextEnd->format('Y-m-d H:i:s'),
            'due_at' => $nextEnd->format('Y-m-d H:i:s'),
            'billing_version' => $billingVersion,
        ]);
    }

    private function markSubscriptionPastDue(): void
    {
        if (!$this->tableExists('service_subscription_settings')) {
            return;
        }

        $settings = $this->database->fetchOne('SELECT * FROM service_subscription_settings LIMIT 1');
        if ($settings === null) {
            return;
        }

        $this->touchUpdate('service_subscription_settings', (string) $settings['id'], [
            'subscription_status' => 'past_due',
        ]);
    }

    public function fetchCourierSettings(array $params = []): array
    {
        $row = $this->database->fetchOne('SELECT * FROM courier_settings LIMIT 1');
        $hasFraudCheckerColumn = $this->columnExists('courier_settings', 'fraud_checker_api_key');
        return [
            'steadfast' => [
                'baseUrl' => (string) ($row['steadfast_base_url'] ?? ''),
                'apiKey' => (string) ($row['steadfast_api_key'] ?? ''),
                'secretKey' => (string) ($row['steadfast_secret_key'] ?? ''),
            ],
            'carryBee' => [
                'baseUrl' => (string) ($row['carrybee_base_url'] ?? ''),
                'clientId' => (string) ($row['carrybee_client_id'] ?? ''),
                'clientSecret' => (string) ($row['carrybee_client_secret'] ?? ''),
                'clientContext' => (string) ($row['carrybee_client_context'] ?? ''),
                'storeId' => (string) ($row['carrybee_store_id'] ?? ''),
            ],
            'paperfly' => [
                'baseUrl' => (string) ($row['paperfly_base_url'] ?? ''),
                'username' => (string) ($row['paperfly_username'] ?? ''),
                'password' => (string) ($row['paperfly_password'] ?? ''),
                'paperflyKey' => (string) ($row['paperfly_key'] ?? ''),
                'defaultShopName' => (string) ($row['paperfly_default_shop_name'] ?? ''),
                'maxWeightKg' => (float) ($row['paperfly_max_weight_kg'] ?? 0.3),
            ],
            'fraudChecker' => [
                'apiKey' => $hasFraudCheckerColumn ? (string) ($row['fraud_checker_api_key'] ?? '') : '',
            ],
        ];
    }

    public function updateCourierSettings(array $params): array
    {
        $this->requireAdmin();
        $current = $this->fetchCourierSettings();
        $steadfast = is_array($params['steadfast'] ?? null) ? $params['steadfast'] : [];
        $carryBee = is_array($params['carryBee'] ?? null) ? $params['carryBee'] : [];
        $paperfly = is_array($params['paperfly'] ?? null) ? $params['paperfly'] : [];
        $fraudChecker = is_array($params['fraudChecker'] ?? null) ? $params['fraudChecker'] : [];
        $hasFraudCheckerColumn = $this->columnExists('courier_settings', 'fraud_checker_api_key');

        if (
            !$hasFraudCheckerColumn
            && array_key_exists('apiKey', $fraudChecker)
            && trim((string) $fraudChecker['apiKey']) !== trim((string) ($current['fraudChecker']['apiKey'] ?? ''))
        ) {
            throw new RuntimeException('Fraud Checker settings column is missing. Run the fraud checker migration first.');
        }

        $updates = [
            'steadfast_base_url' => $steadfast['baseUrl'] ?? $current['steadfast']['baseUrl'],
            'steadfast_api_key' => $steadfast['apiKey'] ?? $current['steadfast']['apiKey'],
            'steadfast_secret_key' => $steadfast['secretKey'] ?? $current['steadfast']['secretKey'],
            'carrybee_base_url' => $carryBee['baseUrl'] ?? $current['carryBee']['baseUrl'],
            'carrybee_client_id' => $carryBee['clientId'] ?? $current['carryBee']['clientId'],
            'carrybee_client_secret' => $carryBee['clientSecret'] ?? $current['carryBee']['clientSecret'],
            'carrybee_client_context' => $carryBee['clientContext'] ?? $current['carryBee']['clientContext'],
            'carrybee_store_id' => $carryBee['storeId'] ?? $current['carryBee']['storeId'],
            'paperfly_base_url' => $paperfly['baseUrl'] ?? $current['paperfly']['baseUrl'],
            'paperfly_username' => $paperfly['username'] ?? $current['paperfly']['username'],
            'paperfly_password' => $paperfly['password'] ?? $current['paperfly']['password'],
            'paperfly_key' => $paperfly['paperflyKey'] ?? $current['paperfly']['paperflyKey'],
            'paperfly_default_shop_name' => $paperfly['defaultShopName'] ?? $current['paperfly']['defaultShopName'],
            'paperfly_max_weight_kg' => array_key_exists('maxWeightKg', $paperfly) ? (float) $paperfly['maxWeightKg'] : $current['paperfly']['maxWeightKg'],
        ];

        if ($hasFraudCheckerColumn) {
            $updates['fraud_checker_api_key'] = $fraudChecker['apiKey'] ?? $current['fraudChecker']['apiKey'];
        }

        return $this->saveSingleton(
            'courier_settings',
            'courier-default',
            $updates,
            fn(): array => $this->fetchCourierSettings()
        );
    }

    public function fetchPermissionsSettings(array $params = []): array
    {
        return $this->buildPermissionsSettingsPayload();
    }

    public function updatePermissionsSettings(array $params): array
    {
        $this->requireAdmin();
        $roles = is_array($params['roles'] ?? null) ? $params['roles'] : [];
        if (!$this->tableExists('role_permissions')) {
            throw new RuntimeException('Permissions table is missing. Run the permissions migration first.');
        }

        $customRoleNames = [];
        foreach ($roles as $roleConfig) {
            if (!is_array($roleConfig)) {
                continue;
            }

            $roleName = $this->normalizeRoleName((string) ($roleConfig['roleName'] ?? ''));
            if ($roleName === '' || $this->isReservedPermissionRole($roleName)) {
                continue;
            }

            $permissions = $this->normalizeRolePermissions(
                $roleConfig['permissions'] ?? null,
                $this->defaultRolePermissions($roleName),
                $roleName
            );
            $now = $this->database->nowUtc();
            $isCustom = !$this->isBuiltInPermissionRole($roleName);
            if ($isCustom) {
                $customRoleNames[$roleName] = $roleName;
            }

            $this->database->execute(
                'INSERT INTO role_permissions (role_name, permissions, is_custom, created_at, updated_at)
                 VALUES (:role_name, :permissions, :is_custom, :created_at, :updated_at)
                 ON DUPLICATE KEY UPDATE
                   permissions = VALUES(permissions),
                   is_custom = VALUES(is_custom),
                   updated_at = VALUES(updated_at)',
                [
                    ':role_name' => $roleName,
                    ':permissions' => $this->jsonEncode($permissions),
                    ':is_custom' => $isCustom ? 1 : 0,
                    ':created_at' => $now,
                    ':updated_at' => $now,
                ]
            );
        }

        $customRoleNames = array_values($customRoleNames);
        if ($customRoleNames === []) {
            $this->database->execute('DELETE FROM role_permissions WHERE is_custom = 1');
        } else {
            [$placeholders, $bindings] = $this->inClause($customRoleNames, 'permission_role_name');
            $this->database->execute(
                'DELETE FROM role_permissions WHERE is_custom = 1 AND role_name NOT IN (' . implode(', ', $placeholders) . ')',
                $bindings
            );
        }

        $builtInRoleNames = array_values(self::BUILT_IN_PERMISSION_ROLES);
        if ($builtInRoleNames !== []) {
            $builtInPlaceholders = [];
            $builtInBindings = [];
            foreach ($builtInRoleNames as $index => $roleName) {
                $placeholder = ':builtin_role_' . $index;
                $builtInPlaceholders[] = $placeholder;
                $builtInBindings[$placeholder] = $roleName;
            }

            $this->database->execute(
                'DELETE FROM role_permissions WHERE is_custom = 0 AND role_name NOT IN (' . implode(', ', $builtInPlaceholders) . ')',
                $builtInBindings
            );
        }

        $this->database->execute(
            'DELETE FROM role_permissions WHERE role_name = :deprecated_role_name',
            [':deprecated_role_name' => 'Employee1']
        );

        $this->permissionsSettingsPayloadCache = null;
        return $this->fetchPermissionsSettings();
    }

    private function requireDeveloperUser(): array
    {
        $user = $this->currentUser();
        if (trim((string) ($user['role'] ?? '')) !== 'Developer') {
            throw new ApiException('Developer access required.', 403, 'DEVELOPER_ACCESS_REQUIRED');
        }

        return $user;
    }

    private function formatLocalDateTimeLabel(?string $value): string
    {
        $trimmed = trim((string) ($value ?? ''));
        if ($trimmed === '') {
            return '';
        }

        try {
            $date = new \DateTimeImmutable($trimmed, new \DateTimeZone('UTC'));
        } catch (\Exception) {
            return $trimmed;
        }

        return $date
            ->setTimezone(new \DateTimeZone($this->config->timezone()))
            ->format('j M Y, g:i A');
    }

    private function extractLocalDayOfMonthFromDateTime(?string $value): ?int
    {
        $trimmed = trim((string) ($value ?? ''));
        if ($trimmed === '') {
            return null;
        }

        try {
            $date = new \DateTimeImmutable($trimmed, new \DateTimeZone('UTC'));
        } catch (\Exception) {
            return null;
        }

        return (int) $date
            ->setTimezone(new \DateTimeZone($this->config->timezone()))
            ->format('j');
    }

    /**
     * @param array<string, mixed>|null $settingsRow
     * @param array<string, mixed> $state
     */
    private function resolveServiceSubscriptionResetDayOfMonth(?array $settingsRow, array $state): ?int
    {
        $configuredDay = (int) ($settingsRow['reset_day_of_month'] ?? 0);
        if ($configuredDay >= 1 && $configuredDay <= 31) {
            return $configuredDay;
        }

        return $this->extractLocalDayOfMonthFromDateTime((string) ($settingsRow['due_at'] ?? $state['dueAt'] ?? ''));
    }

    /**
     * @return array{0:int, 1:int, 2:int}
     */
    private function parseTimeOfDayParts(?string $value): array
    {
        $parts = explode(':', trim((string) ($value ?? '')));
        if (count($parts) >= 2) {
            return [
                max(0, min(23, (int) $parts[0])),
                max(0, min(59, (int) $parts[1])),
                max(0, min(59, (int) ($parts[2] ?? 0))),
            ];
        }

        return [0, 0, 0];
    }

    private function calculateNextServiceSubscriptionDueAt(int $resetDayOfMonth, ?string $preferredTimeOfDay = null): string
    {
        $timezone = new \DateTimeZone($this->config->timezone());
        $nowLocal = new \DateTimeImmutable('now', $timezone);
        [$hour, $minute, $second] = $this->parseTimeOfDayParts($preferredTimeOfDay);

        $targetYear = (int) $nowLocal->format('Y');
        $targetMonth = (int) $nowLocal->format('n');
        $lastDayOfMonth = cal_days_in_month(CAL_GREGORIAN, $targetMonth, $targetYear);
        $targetDay = min(max(1, $resetDayOfMonth), $lastDayOfMonth);

        $candidate = $nowLocal
            ->setDate($targetYear, $targetMonth, $targetDay)
            ->setTime($hour, $minute, $second);

        if ($candidate->getTimestamp() <= $nowLocal->getTimestamp()) {
            $targetMonth++;
            if ($targetMonth > 12) {
                $targetMonth = 1;
                $targetYear++;
            }

            $lastDayOfMonth = cal_days_in_month(CAL_GREGORIAN, $targetMonth, $targetYear);
            $targetDay = min(max(1, $resetDayOfMonth), $lastDayOfMonth);
            $candidate = $candidate
                ->setDate($targetYear, $targetMonth, $targetDay)
                ->setTime($hour, $minute, $second);
        }

        return $candidate
            ->setTimezone(new \DateTimeZone('UTC'))
            ->format('Y-m-d H:i:s');
    }

    /**
     * @param mixed $value
     * @return array<string, mixed>
     */
    private function normalizeNotificationActionConfig($value, array $targetRoles = []): array
    {
        $raw = is_array($value) ? $value : $this->jsonDecodeAssoc($value);
        $kind = trim((string) ($raw['kind'] ?? 'none'));
        if (!in_array($kind, ['none', 'link', 'decision', 'link_and_decision'], true)) {
            $kind = 'none';
        }

        $decisionMode = trim((string) ($raw['decisionMode'] ?? 'record_only'));
        if (!in_array($decisionMode, ['record_only', 'transaction_approval'], true)) {
            $decisionMode = 'record_only';
        }

        $decisionScope = trim((string) ($raw['decisionScope'] ?? 'all_users'));
        if (!in_array($decisionScope, ['single_user', 'all_users'], true)) {
            $decisionScope = 'all_users';
        }

        $config = [
            'kind' => $kind,
        ];

        foreach (['linkLabel', 'linkUrl', 'acceptLabel', 'declineLabel'] as $field) {
            $fieldValue = trim((string) ($raw[$field] ?? ''));
            if ($fieldValue !== '') {
                $config[$field] = $fieldValue;
            }
        }

        if (in_array($kind, ['decision', 'link_and_decision'], true)) {
            $config['decisionMode'] = $decisionMode;
            if ($decisionMode === 'transaction_approval') {
                $decisionScope = 'single_user';
            } elseif ($targetRoles !== [] && !$this->notificationTargetsAdminAccessOnly($targetRoles)) {
                $decisionScope = 'all_users';
            }
            $config['decisionScope'] = $decisionScope;
        }

        if (is_array($raw['decisionContext'] ?? null) && $raw['decisionContext'] !== []) {
            $config['decisionContext'] = $raw['decisionContext'];
        }

        return $config;
    }

    /**
     * @param mixed $value
     * @return array<int, string>
     */
    private function normalizeNotificationTargetRoles($value): array
    {
        $roles = is_array($value) ? $value : $this->jsonDecodeList($value);
        $normalized = [];
        foreach ($roles as $role) {
            $roleName = trim((string) $role);
            if ($roleName !== '' && !in_array($roleName, $normalized, true)) {
                $normalized[] = $roleName;
            }
        }

        return $normalized;
    }

    /**
     * @param array<int, string> $roles
     */
    private function notificationTargetsAdminAccessOnly(array $roles): bool
    {
        if ($roles === []) {
            return false;
        }

        foreach ($roles as $role) {
            if (!$this->hasAdminAccess(trim((string) $role))) {
                return false;
            }
        }

        return true;
    }

    /**
     * @return array<string, mixed>
     */
    private function mapNotificationRecipient(array $row): array
    {
        return [
            'userId' => (string) ($row['user_id'] ?? $row['id'] ?? ''),
            'userName' => $this->nullableString($row['user_name'] ?? $row['name'] ?? null),
            'userRole' => $this->nullableString($row['user_role'] ?? $row['role'] ?? null),
            'isRead' => (int) ($row['is_read'] ?? 0) === 1,
            'readAt' => $this->toIso($row['read_at'] ?? null),
            'actionResult' => $this->nullableString($row['action_result'] ?? null),
            'actedAt' => $this->toIso($row['acted_at'] ?? null),
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function fetchNotificationTargetViewerRows(array $notification): array
    {
        $targetRoles = $this->normalizeNotificationTargetRoles($notification['target_roles'] ?? $notification['targetRoles'] ?? []);
        if ($targetRoles === []) {
            return [];
        }

        [$placeholders, $bindings] = $this->inClause($targetRoles, 'notification_target_role');
        if (!$this->tableExists('notification_receipts')) {
            return $this->database->fetchAll(
                'SELECT
                    u.id AS user_id,
                    u.name AS user_name,
                    u.role AS user_role,
                    0 AS is_read,
                    NULL AS read_at,
                    NULL AS action_result,
                    NULL AS acted_at
                 FROM users u
                 WHERE u.deleted_at IS NULL
                   AND u.role IN (' . implode(', ', $placeholders) . ')
                 ORDER BY
                   CASE u.role
                     WHEN \'Admin\' THEN 0
                     WHEN \'Developer\' THEN 1
                     ELSE 2
                   END,
                   u.name ASC',
                $bindings
            );
        }

        return $this->database->fetchAll(
            'SELECT
                u.id AS user_id,
                u.name AS user_name,
                u.role AS user_role,
                IFNULL(nr.is_read, 0) AS is_read,
                nr.read_at,
                nr.action_result,
                nr.acted_at
             FROM users u
             LEFT JOIN notification_receipts nr
               ON nr.user_id = u.id
              AND nr.notification_id = :notification_id
             WHERE u.deleted_at IS NULL
               AND u.role IN (' . implode(', ', $placeholders) . ')
             ORDER BY
               CASE u.role
                 WHEN \'Admin\' THEN 0
                 WHEN \'Developer\' THEN 1
                 ELSE 2
               END,
               u.name ASC',
            [':notification_id' => (string) ($notification['id'] ?? '')] + $bindings
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function buildNotificationDetailPayload(array $notification): array
    {
        $mappedNotification = $this->mapNotification($notification);
        $recipientRows = $this->fetchNotificationTargetViewerRows($notification);
        $recipients = array_map(fn(array $row): array => $this->mapNotificationRecipient($row), $recipientRows);
        $readCount = count(array_filter(
            $recipients,
            static fn(array $recipient): bool => (bool) ($recipient['isRead'] ?? false)
        ));
        $actedCount = count(array_filter(
            $recipients,
            static fn(array $recipient): bool => trim((string) ($recipient['actionResult'] ?? '')) !== ''
        ));
        $acceptedCount = count(array_filter(
            $recipients,
            static fn(array $recipient): bool => (string) ($recipient['actionResult'] ?? '') === 'accepted'
        ));
        $declinedCount = count(array_filter(
            $recipients,
            static fn(array $recipient): bool => (string) ($recipient['actionResult'] ?? '') === 'declined'
        ));

        return [
            'notification' => $mappedNotification,
            'recipients' => $recipients,
            'summary' => [
                'recipientCount' => count($recipients),
                'readCount' => $readCount,
                'actedCount' => $actedCount,
                'acceptedCount' => $acceptedCount,
                'declinedCount' => $declinedCount,
            ],
        ];
    }

    /**
     * @param array<int, string> $userIds
     */
    private function haveAllNotificationTargetUsersActed(string $notificationId, array $userIds): bool
    {
        if ($notificationId === '' || $userIds === [] || !$this->tableExists('notification_receipts')) {
            return false;
        }

        [$placeholders, $bindings] = $this->inClause($userIds, 'notification_target_user');
        $row = $this->database->fetchOne(
            'SELECT COUNT(*) AS acted_count
             FROM notification_receipts
             WHERE notification_id = :notification_id
               AND user_id IN (' . implode(', ', $placeholders) . ')
               AND action_result IS NOT NULL',
            [':notification_id' => $notificationId] + $bindings
        );

        return (int) ($row['acted_count'] ?? 0) >= count($userIds);
    }

    /**
     * @param array<string, mixed> $notification
     * @param array<string, mixed> $metadataPatch
     */
    private function deactivateNotificationWithMetadata(array $notification, array $metadataPatch = []): void
    {
        $notificationId = trim((string) ($notification['id'] ?? ''));
        if ($notificationId === '' || !$this->tableExists('notifications')) {
            return;
        }

        $now = $this->database->nowUtc();
        $metadata = array_merge(
            $this->jsonDecodeAssoc($notification['metadata'] ?? []),
            $metadataPatch
        );

        $this->database->execute(
            'UPDATE notifications
             SET is_active = 0,
                 ends_at = COALESCE(ends_at, :ends_at),
                 metadata = :metadata,
                 updated_at = :updated_at
             WHERE id = :id',
            [
                ':id' => $notificationId,
                ':ends_at' => $now,
                ':metadata' => $this->jsonEncode($metadata),
                ':updated_at' => $now,
            ]
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function mapNotification(array $row): array
    {
        $metadata = $this->jsonDecodeAssoc($row['metadata'] ?? $row['notification_metadata'] ?? []);
        $targetRoles = $this->normalizeNotificationTargetRoles($row['target_roles'] ?? $row['targetRoles'] ?? []);
        return [
            'id' => (string) ($row['id'] ?? ''),
            'subject' => (string) ($row['subject'] ?? ''),
            'contentHtml' => (string) ($row['content_html'] ?? $row['contentHtml'] ?? ''),
            'targetRoles' => $targetRoles,
            'startsAt' => $this->toIso($row['starts_at'] ?? $row['startsAt'] ?? null),
            'endsAt' => $this->toIso($row['ends_at'] ?? $row['endsAt'] ?? null),
            'createdAt' => $this->toIso($row['created_at'] ?? $row['createdAt'] ?? null),
            'updatedAt' => $this->toIso($row['updated_at'] ?? $row['updatedAt'] ?? null),
            'createdBy' => $this->nullableString($row['created_by'] ?? $row['createdBy'] ?? null),
            'createdByName' => $this->nullableString($row['created_by_name'] ?? $row['createdByName'] ?? null),
            'isActive' => (int) ($row['is_active'] ?? $row['isActive'] ?? 1) === 1,
            'isSystemGenerated' => (int) ($row['is_system_generated'] ?? $row['isSystemGenerated'] ?? 0) === 1,
            'systemKey' => $this->nullableString($row['system_key'] ?? $row['systemKey'] ?? null),
            'isRead' => (int) ($row['is_read'] ?? $row['isRead'] ?? 0) === 1,
            'readAt' => $this->toIso($row['read_at'] ?? $row['readAt'] ?? null),
            'actionResult' => $this->nullableString($row['action_result'] ?? $row['actionResult'] ?? null),
            'actedAt' => $this->toIso($row['acted_at'] ?? $row['actedAt'] ?? null),
            'actionConfig' => $this->normalizeNotificationActionConfig($row['action_config'] ?? $row['actionConfig'] ?? [], $targetRoles),
            'metadata' => $metadata !== [] ? $metadata : null,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function mapServiceSubscriptionItem(array $row): array
    {
        return [
            'id' => (string) ($row['id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'description' => $this->nullableString($row['description'] ?? null),
            'amount' => array_key_exists('amount', $row) && $row['amount'] !== null ? (float) $row['amount'] : null,
            'isOptional' => (int) ($row['is_optional'] ?? 0) === 1,
            'isActive' => (int) ($row['is_active'] ?? 1) === 1,
            'displayOrder' => (int) ($row['display_order'] ?? 0),
            'systemKey' => $this->nullableString($row['system_key'] ?? null),
            'createdAt' => $this->toIso($row['created_at'] ?? null),
            'updatedAt' => $this->toIso($row['updated_at'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function mapServiceSubscriptionMethod(array $row): array
    {
        return [
            'id' => (string) ($row['id'] ?? ''),
            'name' => (string) ($row['name'] ?? ''),
            'description' => $this->nullableString($row['description'] ?? null),
            'isActive' => (int) ($row['is_active'] ?? 1) === 1,
            'displayOrder' => (int) ($row['display_order'] ?? 0),
            'createdAt' => $this->toIso($row['created_at'] ?? null),
            'updatedAt' => $this->toIso($row['updated_at'] ?? null),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function mapServiceSubscriptionPayment(array $row): array
    {
        return [
            'id' => (string) ($row['id'] ?? ''),
            'billingVersion' => (int) ($row['billing_version'] ?? 1),
            'localReference' => $this->nullableString($row['local_reference'] ?? null),
            'gatewayPaymentId' => $this->nullableString($row['gateway_payment_id'] ?? null),
            'gatewayName' => $this->nullableString($row['gateway_name'] ?? null),
            'billingInterval' => $this->nullableString($row['billing_interval'] ?? null),
            'invoiceUrl' => $this->nullableString($row['invoice_url'] ?? null),
            'amount' => (float) ($row['amount'] ?? 0),
            'baseAmount' => (float) ($row['base_amount'] ?? 0),
            'tipAmount' => (float) ($row['tip_amount'] ?? 0),
            'paymentMethodId' => $this->nullableString($row['payment_method_id'] ?? null),
            'paymentMethodName' => (string) ($row['payment_method_name'] ?? ''),
            'transactionId' => (string) ($row['transaction_id'] ?? ''),
            'submittedBy' => (string) ($row['submitted_by'] ?? ''),
            'submittedByName' => $this->nullableString($row['submitted_by_name'] ?? null),
            'status' => (string) ($row['status'] ?? 'processing'),
            'submittedAt' => $this->toIso($row['submitted_at'] ?? null),
            'reactivateAt' => $this->toIso($row['reactivate_at'] ?? null),
            'processedAt' => $this->toIso($row['processed_at'] ?? null),
            'createdAt' => $this->toIso($row['created_at'] ?? null),
            'updatedAt' => $this->toIso($row['updated_at'] ?? null),
        ];
    }

    /**
     * @param array<int, string> $targetRoles
     * @param array<string, mixed> $actionConfig
     * @param array<string, mixed> $metadata
     */
    private function upsertSystemNotification(
        string $systemKey,
        string $subject,
        string $contentHtml,
        array $targetRoles,
        array $actionConfig = [],
        array $metadata = [],
        bool $isActive = true,
        ?string $startsAt = null,
        ?string $endsAt = null
    ): void {
        if (
            !$this->tableExists('notifications')
            || !$this->columnExists('notifications', 'system_key')
            || !$this->columnExists('notifications', 'action_config')
        ) {
            return;
        }

        $notificationId = trim($systemKey);
        if ($notificationId === '') {
            return;
        }

        $now = $this->database->nowUtc();
        $this->database->execute(
            'INSERT INTO notifications (
                id, system_key, subject, content_html, target_roles, starts_at, ends_at,
                action_config, metadata, created_by, is_active, is_system_generated, created_at, updated_at
             ) VALUES (
                :id, :system_key, :subject, :content_html, :target_roles, :starts_at, :ends_at,
                :action_config, :metadata, NULL, :is_active, 1, :created_at, :updated_at
             )
             ON DUPLICATE KEY UPDATE
                subject = VALUES(subject),
                content_html = VALUES(content_html),
                target_roles = VALUES(target_roles),
                starts_at = VALUES(starts_at),
                ends_at = VALUES(ends_at),
                action_config = VALUES(action_config),
                metadata = VALUES(metadata),
                is_active = VALUES(is_active),
                updated_at = VALUES(updated_at)',
            [
                ':id' => $notificationId,
                ':system_key' => $systemKey,
                ':subject' => $subject,
                ':content_html' => $contentHtml,
                ':target_roles' => $this->jsonEncode($targetRoles),
                ':starts_at' => $startsAt,
                ':ends_at' => $endsAt,
                ':action_config' => $this->jsonEncode($actionConfig),
                ':metadata' => $this->jsonEncode($metadata),
                ':is_active' => $isActive ? 1 : 0,
                ':created_at' => $now,
                ':updated_at' => $now,
            ]
        );
    }

    /**
     * @param array<int, string> $exceptKeys
     */
    private function deactivateSystemNotificationsByPrefix(string $prefix, array $exceptKeys = []): void
    {
        if (
            !$this->tableExists('notifications')
            || !$this->columnExists('notifications', 'system_key')
        ) {
            return;
        }

        $bindings = [
            ':updated_at' => $this->database->nowUtc(),
            ':ends_at' => $this->database->nowUtc(),
            ':prefix' => $prefix,
        ];
        $sql = 'UPDATE notifications
                SET is_active = 0,
                    ends_at = COALESCE(ends_at, :ends_at),
                    updated_at = :updated_at
                WHERE system_key LIKE :prefix';

        if ($exceptKeys !== []) {
            [$placeholders, $inBindings] = $this->inClause($exceptKeys, 'notification_key');
            $sql .= ' AND system_key NOT IN (' . implode(', ', $placeholders) . ')';
            $bindings += $inBindings;
        }

        $this->database->execute($sql, $bindings);
    }

    /**
     * @return array<string, mixed>
     */
    private function buildServiceSubscriptionOverview(array $user): array
    {
        $state = $this->serviceLifecycle()->getState();
        $settingsRow = $this->tableExists('service_subscription_settings')
            ? $this->database->fetchOne('SELECT * FROM service_subscription_settings LIMIT 1')
            : null;

        $items = $this->tableExists('service_subscription_items')
            ? array_map(fn(array $row): array => $this->mapServiceSubscriptionItem($row), $this->database->fetchAll(
                'SELECT * FROM service_subscription_items ORDER BY is_active DESC, display_order ASC, created_at ASC'
            ))
            : [];

        $methods = $this->tableExists('service_subscription_methods')
            ? array_map(fn(array $row): array => $this->mapServiceSubscriptionMethod($row), $this->database->fetchAll(
                'SELECT * FROM service_subscription_methods ORDER BY is_active DESC, display_order ASC, created_at ASC'
            ))
            : [];

        $payments = [];
        if ($this->tableExists('service_subscription_payments')) {
            $paymentRows = $this->database->fetchAll(
                "SELECT p.*, submitter.name AS submitted_by_name
                 FROM service_subscription_payments p
                 LEFT JOIN users submitter ON submitter.id = p.submitted_by
                 ORDER BY p.submitted_at DESC, p.created_at DESC
                 LIMIT 100"
            );
            $payments = array_map(fn(array $row): array => $this->mapServiceSubscriptionPayment($row), $paymentRows);
        }

        $billingVersion = max(1, (int) ($settingsRow['billing_version'] ?? $state['billingVersion'] ?? 1));
        $capabilityRow = $this->capabilityRow();
        $pricingMetadata = $this->jsonDecodeAssoc($capabilityRow['pricing_metadata'] ?? null);
        $monthlyAmount = max(0.0, (float) ($pricingMetadata['monthly'] ?? $settingsRow['total_amount'] ?? 0));
        $yearlyAmount = max(0.0, (float) ($pricingMetadata['yearly'] ?? ($monthlyAmount > 0 ? $monthlyAmount * 12 : 0)));
        $currentPayment = null;
        foreach ($payments as $payment) {
            if ((int) ($payment['billingVersion'] ?? 0) === $billingVersion) {
                $currentPayment = $payment;
                break;
            }
        }

        return [
            'state' => (string) ($state['state'] ?? 'unconfigured'),
            'writeBlocked' => (bool) ($state['writeBlocked'] ?? false),
            'canManageConfig' => trim((string) ($user['role'] ?? '')) === 'Developer',
            'planName' => $this->nullableString($settingsRow['plan_name'] ?? null),
            'billingInterval' => $this->nullableString($settingsRow['billing_interval'] ?? null),
            'subscriptionStatus' => $this->nullableString($settingsRow['subscription_status'] ?? null),
            'currentPeriodEnd' => $this->toIso($settingsRow['current_period_end'] ?? null),
            'dueAt' => $this->toIso($settingsRow['due_at'] ?? $state['dueAt'] ?? null),
            'resetDayOfMonth' => $this->resolveServiceSubscriptionResetDayOfMonth($settingsRow, $state),
            'warningDays' => max(1, (int) ($settingsRow['warning_days'] ?? $state['warningDays'] ?? 7)),
            'billingVersion' => $billingVersion,
            'totalAmount' => $monthlyAmount,
            'yearlyAmount' => $yearlyAmount,
            'pricingMetadata' => $pricingMetadata,
            'minimumPaymentAmount' => $monthlyAmount,
            'nagadNumber' => $this->nullableString($settingsRow['nagad_number'] ?? null),
            'items' => $items,
            'methods' => $methods,
            'currentPayment' => $currentPayment,
            'payments' => $payments,
        ];
    }

    /**
     * @param array<string, mixed> $overview
     */
    private function syncServiceSubscriptionNotifications(array $overview): void
    {
        $prefix = 'service-subscription-%';
        $activeKey = null;
        $state = trim((string) ($overview['state'] ?? ''));
        $dueLabel = $this->formatLocalDateTimeLabel((string) ($overview['dueAt'] ?? ''));
        $linkUrl = '/subscriptions';
        $actionConfig = [
            'kind' => 'link',
            'linkLabel' => 'Open subscriptions',
            'linkUrl' => $linkUrl,
        ];

        if ($state === 'renewing') {
            $activeKey = 'service-subscription-renewing-v' . (int) ($overview['billingVersion'] ?? 1);
        } elseif ($state === 'expired') {
            $activeKey = 'service-subscription-expired-v' . (int) ($overview['billingVersion'] ?? 1);
        } elseif ($state === 'warning') {
            $activeKey = 'service-subscription-warning-v' . (int) ($overview['billingVersion'] ?? 1);
        }

        if (
            $this->tableExists('notifications')
            && $this->columnExists('notifications', 'system_key')
        ) {
            $activeRows = $this->database->fetchAll(
                'SELECT system_key
                 FROM notifications
                 WHERE system_key LIKE :prefix
                   AND is_active = 1',
                [':prefix' => $prefix]
            );
            $activeKeys = array_values(array_unique(array_filter(array_map(
                static fn(array $row): string => trim((string) ($row['system_key'] ?? '')),
                $activeRows
            ))));
            sort($activeKeys);
            $desiredKeys = $activeKey !== null ? [$activeKey] : [];
            sort($desiredKeys);

            if ($activeKeys === $desiredKeys) {
                return;
            }
        }

        if ($state === 'renewing') {
            $this->upsertSystemNotification(
                $activeKey,
                'Service renewal is processing',
                '<p>A renewal payment is being processed. The backend will be available again within 10 minutes.</p><p><a href="' . htmlspecialchars($linkUrl, ENT_QUOTES, 'UTF-8') . '">Click Here</a> to view the subscription status.</p>',
                ['Admin', 'Developer'],
                $actionConfig,
                [
                    'state' => 'renewing',
                    'billingVersion' => (int) ($overview['billingVersion'] ?? 1),
                ],
                true,
                $this->database->nowUtc(),
                null
            );
        } elseif ($state === 'expired') {
            $this->upsertSystemNotification(
                $activeKey,
                'Backend services have expired',
                '<p>The backend tools have expired. Please renew the services from <strong>Subscriptions</strong>.</p><p>' . ($dueLabel !== '' ? 'Due date: <strong>' . htmlspecialchars($dueLabel, ENT_QUOTES, 'UTF-8') . '</strong>.</p><p>' : '') . '<a href="' . htmlspecialchars($linkUrl, ENT_QUOTES, 'UTF-8') . '">Click Here</a> to renew them.</p>',
                ['Admin', 'Developer'],
                $actionConfig,
                [
                    'state' => 'expired',
                    'billingVersion' => (int) ($overview['billingVersion'] ?? 1),
                ],
                true,
                $this->database->nowUtc(),
                null
            );
        } elseif ($state === 'warning') {
            $this->upsertSystemNotification(
                $activeKey,
                'Backend services will expire soon',
                '<p>The shared backend services will expire soon. Please make the renewal payment before <strong>' . htmlspecialchars($dueLabel, ENT_QUOTES, 'UTF-8') . '</strong>.</p><p><a href="' . htmlspecialchars($linkUrl, ENT_QUOTES, 'UTF-8') . '">Click Here</a> to open the subscription page.</p>',
                ['Admin', 'Developer'],
                $actionConfig,
                [
                    'state' => 'warning',
                    'billingVersion' => (int) ($overview['billingVersion'] ?? 1),
                ],
                true,
                $this->database->nowUtc(),
                null
            );
        }

        $this->deactivateSystemNotificationsByPrefix($prefix, $activeKey !== null ? [$activeKey] : []);
    }

    public function fetchMyNotifications(array $params = []): array
    {
        $user = $this->currentUser();
        $hasNotificationsTable = $this->tableExists('notifications');
        if (!$hasNotificationsTable) {
            return [
                'items' => [],
                'unreadCount' => 0,
            ];
        }

        $hasReceiptsTable = $this->tableExists('notification_receipts');

        if ($this->hasAdminAccess((string) ($user['role'] ?? ''))) {
            $this->syncServiceSubscriptionNotifications($this->buildServiceSubscriptionOverview($user));
        }

        $now = $this->database->nowUtc();
        $baseBindings = [
            ':role_needle' => '%"' . trim((string) ($user['role'] ?? '')) . '"%',
            ':starts_now' => $now,
            ':ends_now' => $now,
        ];
        $queryBindings = $baseBindings;
        if ($hasReceiptsTable) {
            $queryBindings[':user_id'] = (string) ($user['id'] ?? '');
        }

        try {
            $rows = $this->database->fetchAll(
                $hasReceiptsTable
                ? "SELECT
                        n.*,
                        creator.name AS created_by_name,
                        nr.is_read,
                        nr.read_at,
                        nr.action_result,
                        nr.acted_at
                     FROM notifications n
                     LEFT JOIN users creator
                       ON creator.id = n.created_by
                     LEFT JOIN notification_receipts nr
                       ON nr.notification_id = n.id
                      AND nr.user_id = :user_id
                     WHERE n.target_roles LIKE :role_needle
                       AND (n.starts_at IS NULL OR n.starts_at <= :starts_now)
                       AND (n.ends_at IS NULL OR n.ends_at >= :ends_now)
                       AND n.is_active = 1
                       AND nr.notification_id IS NULL
                     ORDER BY COALESCE(n.starts_at, n.created_at) DESC, n.created_at DESC
                     LIMIT 200"
                : "SELECT
                        n.*,
                        creator.name AS created_by_name,
                        0 AS is_read,
                        NULL AS read_at,
                        NULL AS action_result,
                        NULL AS acted_at
                     FROM notifications n
                     LEFT JOIN users creator
                       ON creator.id = n.created_by
                     WHERE n.target_roles LIKE :role_needle
                       AND (n.starts_at IS NULL OR n.starts_at <= :starts_now)
                       AND (n.ends_at IS NULL OR n.ends_at >= :ends_now)
                       AND n.is_active = 1
                     ORDER BY COALESCE(n.starts_at, n.created_at) DESC, n.created_at DESC
                     LIMIT 200",
                $queryBindings
            );
        } catch (\Throwable $e) {
            return [
                'items' => [],
                'unreadCount' => 0,
            ];
        }

        $items = array_map(fn(array $row): array => $this->mapNotification($row), $rows);
        $unreadCount = count(array_filter(
            $items,
            static fn(array $item): bool => !((bool) ($item['isRead'] ?? false)) && ((bool) ($item['isActive'] ?? true))
        ));

        return [
            'items' => $items,
            'unreadCount' => $unreadCount,
        ];
    }

    public function fetchMyNotificationsPaginated(array $params = []): array
    {
        $user = $this->currentUser();
        $hasNotificationsTable = $this->tableExists('notifications');
        if (!$hasNotificationsTable) {
            return [
                'items' => [],
                'total' => 0,
                'page' => 1,
                'pageSize' => 10,
                'totalPages' => 0,
            ];
        }

        $page = max(1, (int) ($params['page'] ?? 1));
        $pageSize = max(1, min(100, (int) ($params['pageSize'] ?? 10)));
        $offset = ($page - 1) * $pageSize;

        $hasReceiptsTable = $this->tableExists('notification_receipts');

        if ($this->hasAdminAccess((string) ($user['role'] ?? ''))) {
            $this->syncServiceSubscriptionNotifications($this->buildServiceSubscriptionOverview($user));
        }

        $now = $this->database->nowUtc();
        $baseBindings = [
            ':role_needle' => '%"' . trim((string) ($user['role'] ?? '')) . '"%',
            ':starts_now' => $now,
            ':ends_now' => $now,
        ];
        $queryBindings = $baseBindings;
        if ($hasReceiptsTable) {
            $queryBindings[':user_id'] = (string) ($user['id'] ?? '');
        }

        // Build base WHERE clause
        $whereClause = "WHERE n.target_roles LIKE :role_needle
                          AND (n.starts_at IS NULL OR n.starts_at <= :starts_now)
                          AND (n.ends_at IS NULL OR n.ends_at >= :ends_now)
                          AND n.is_active = 1";

        // Get total count
        try {
            $countResult = $this->database->fetchOne("SELECT COUNT(*) as total FROM notifications n {$whereClause}", $baseBindings);
            $total = (int) ($countResult['total'] ?? 0);
        } catch (\Throwable $e) {
            // If count fails, return empty
            return [
                'items' => [],
                'total' => 0,
                'page' => $page,
                'pageSize' => $pageSize,
                'totalPages' => 0,
            ];
        }

        $totalPages = max(1, (int) ceil($total / $pageSize));

        // Get paginated results - show ALL notifications (both read and unread)
        try {
            if ($hasReceiptsTable) {
                $query = "SELECT
                            n.*,
                            creator.name AS created_by_name,
                            IFNULL(nr.is_read, 0) AS is_read,
                            nr.read_at,
                            nr.action_result,
                            nr.acted_at
                         FROM notifications n
                         LEFT JOIN users creator ON creator.id = n.created_by
                         LEFT JOIN notification_receipts nr ON nr.notification_id = n.id AND nr.user_id = :user_id
                         {$whereClause}
                         ORDER BY COALESCE(n.starts_at, n.created_at) DESC, n.created_at DESC
                         LIMIT {$pageSize} OFFSET {$offset}";
            } else {
                $query = "SELECT
                            n.*,
                            creator.name AS created_by_name,
                            0 AS is_read,
                            NULL AS read_at,
                            NULL AS action_result,
                            NULL AS acted_at
                         FROM notifications n
                         LEFT JOIN users creator ON creator.id = n.created_by
                         {$whereClause}
                         ORDER BY COALESCE(n.starts_at, n.created_at) DESC, n.created_at DESC
                         LIMIT {$pageSize} OFFSET {$offset}";
            }

            $rows = $this->database->fetchAll($query, $queryBindings);
            $items = array_map(fn(array $row): array => $this->mapNotification($row), $rows);
        } catch (\Throwable $e) {
            // If query fails, return what we have
            $items = [];
        }

        return [
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
            'totalPages' => $totalPages,
        ];
    }

    public function fetchAllNotifications(array $params = []): array
    {
        $this->requireDeveloperUser();
        if (!$this->tableExists('notifications')) {
            return [];
        }

        $rows = $this->database->fetchAll(
            "SELECT n.*, creator.name AS created_by_name
             FROM notifications n
             LEFT JOIN users creator ON creator.id = n.created_by
             ORDER BY n.created_at DESC
             LIMIT 500"
        );

        return array_map(fn(array $row): array => $this->mapNotification($row), $rows);
    }

    public function fetchNotificationHistoryPage(array $params = []): array
    {
        $this->requireDeveloperUser();
        if (!$this->tableExists('notifications')) {
            return [
                'items' => [],
                'total' => 0,
                'page' => 1,
                'pageSize' => 12,
                'totalPages' => 0,
            ];
        }

        $page = max(1, (int) ($params['page'] ?? 1));
        $pageSize = max(1, min(100, (int) ($params['pageSize'] ?? 12)));
        $offset = ($page - 1) * $pageSize;

        $countRow = $this->database->fetchOne('SELECT COUNT(*) AS total FROM notifications');
        $total = (int) ($countRow['total'] ?? 0);
        $totalPages = $total > 0 ? (int) ceil($total / $pageSize) : 0;

        $rows = $this->database->fetchAll(
            "SELECT n.*, creator.name AS created_by_name
             FROM notifications n
             LEFT JOIN users creator ON creator.id = n.created_by
             ORDER BY n.created_at DESC
             LIMIT {$pageSize} OFFSET {$offset}"
        );

        return [
            'items' => array_map(fn(array $row): array => $this->mapNotification($row), $rows),
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
            'totalPages' => $totalPages,
        ];
    }

    public function fetchNotificationById(array $params): ?array
    {
        $this->requireDeveloperUser();
        if (!$this->tableExists('notifications')) {
            return null;
        }

        $notificationId = trim((string) ($params['id'] ?? ''));
        if ($notificationId === '') {
            throw new RuntimeException('Notification id is required.');
        }

        $row = $this->database->fetchOne(
            "SELECT n.*, creator.name AS created_by_name
             FROM notifications n
             LEFT JOIN users creator ON creator.id = n.created_by
             WHERE n.id = :id
             LIMIT 1",
            [':id' => $notificationId]
        );

        return $row !== null ? $this->buildNotificationDetailPayload($row) : null;
    }

    public function createNotification(array $params): array
    {
        $developer = $this->requireDeveloperUser();
        if (!$this->tableExists('notifications')) {
            throw new RuntimeException('Notifications table is missing. Run the latest migration first.');
        }

        $subject = trim((string) ($params['subject'] ?? ''));
        $contentHtml = trim((string) ($params['contentHtml'] ?? ''));
        $targetRoles = $this->normalizeNotificationTargetRoles($params['targetRoles'] ?? []);
        if ($subject === '') {
            throw new RuntimeException('Notification subject is required.');
        }
        if ($contentHtml === '') {
            throw new RuntimeException('Notification content is required.');
        }
        if ($targetRoles === []) {
            throw new RuntimeException('Select at least one target role.');
        }

        $startsAt = array_key_exists('startsAt', $params)
            ? $this->nullableString($params['startsAt'])
            : $this->database->nowUtc();
        $startsAt = $startsAt !== null ? $this->normalizeDateTimeInput($startsAt) : $this->database->nowUtc();
        $actionConfig = $this->normalizeNotificationActionConfig($params['actionConfig'] ?? [], $targetRoles);

        $id = $this->uuid4();
        $now = $this->database->nowUtc();
        $this->database->execute(
            'INSERT INTO notifications (
                id, system_key, subject, content_html, target_roles, starts_at, ends_at,
                action_config, metadata, created_by, is_active, is_system_generated, created_at, updated_at
             ) VALUES (
                :id, NULL, :subject, :content_html, :target_roles, :starts_at, :ends_at,
                :action_config, :metadata, :created_by, 1, 0, :created_at, :updated_at
             )',
            [
                ':id' => $id,
                ':subject' => $subject,
                ':content_html' => $contentHtml,
                ':target_roles' => $this->jsonEncode($targetRoles),
                ':starts_at' => $startsAt,
                ':ends_at' => null,
                ':action_config' => $this->jsonEncode($actionConfig),
                ':metadata' => $this->jsonEncode([]),
                ':created_by' => (string) ($developer['id'] ?? ''),
                ':created_at' => $now,
                ':updated_at' => $now,
            ]
        );

        $row = $this->database->fetchOne(
            "SELECT n.*, creator.name AS created_by_name
             FROM notifications n
             LEFT JOIN users creator ON creator.id = n.created_by
             WHERE n.id = :id
             LIMIT 1",
            [':id' => $id]
        );

        return $row !== null ? $this->mapNotification($row) : throw new RuntimeException('Failed to create notification.');
    }

    public function markNotificationRead(array $params): array
    {
        $user = $this->currentUser();
        $notificationIds = [];
        $primaryId = trim((string) ($params['notificationId'] ?? ''));
        if ($primaryId !== '') {
            $notificationIds[] = $primaryId;
        }
        if (is_array($params['notificationIds'] ?? null)) {
            foreach ($params['notificationIds'] as $candidateId) {
                $trimmedId = trim((string) $candidateId);
                if ($trimmedId !== '' && !in_array($trimmedId, $notificationIds, true)) {
                    $notificationIds[] = $trimmedId;
                }
            }
        }

        if ($notificationIds === [] || !$this->tableExists('notifications') || !$this->tableExists('notification_receipts')) {
            return ['success' => true];
        }

        $roleNeedle = '%"' . trim((string) ($user['role'] ?? '')) . '"%';
        if (count($notificationIds) === 1) {
            $notification = $this->database->fetchOne(
                'SELECT id FROM notifications WHERE id = :id AND target_roles LIKE :role_needle LIMIT 1',
                [
                    ':id' => $notificationIds[0],
                    ':role_needle' => $roleNeedle,
                ]
            );
            if ($notification === null) {
                throw new RuntimeException('Notification not found.');
            }
            $allowedIds = [(string) ($notification['id'] ?? '')];
        } else {
            [$placeholders, $bindings] = $this->inClause($notificationIds, 'notification_id');
            $rows = $this->database->fetchAll(
                'SELECT id
                 FROM notifications
                 WHERE id IN (' . implode(', ', $placeholders) . ')
                   AND target_roles LIKE :role_needle',
                [':role_needle' => $roleNeedle] + $bindings
            );
            $allowedIds = array_values(array_filter(array_map(
                static fn(array $row): string => trim((string) ($row['id'] ?? '')),
                $rows
            )));
            if ($allowedIds === []) {
                return ['success' => true];
            }
        }

        $now = $this->database->nowUtc();
        $this->database->transaction(function () use ($allowedIds, $user, $now): void {
            foreach ($allowedIds as $notificationId) {
                $this->database->execute(
                    'INSERT INTO notification_receipts (
                        notification_id, user_id, is_read, read_at, action_result, acted_at, created_at, updated_at
                     ) VALUES (
                        :notification_id, :user_id, 1, :read_at, NULL, NULL, :created_at, :updated_at
                     )
                     ON DUPLICATE KEY UPDATE
                        is_read = 1,
                        read_at = COALESCE(notification_receipts.read_at, VALUES(read_at)),
                        updated_at = VALUES(updated_at)',
                    [
                        ':notification_id' => $notificationId,
                        ':user_id' => (string) ($user['id'] ?? ''),
                        ':read_at' => $now,
                        ':created_at' => $now,
                        ':updated_at' => $now,
                    ]
                );
            }
        });

        return ['success' => true];
    }

    public function respondToNotification(array $params): array
    {
        $user = $this->currentUser();
        $notificationId = trim((string) ($params['notificationId'] ?? ''));
        $decision = trim((string) ($params['decision'] ?? ''));
        if ($notificationId === '') {
            throw new RuntimeException('Notification id is required.');
        }
        if (!in_array($decision, ['accepted', 'declined'], true)) {
            throw new RuntimeException('A valid notification decision is required.');
        }
        if (!$this->tableExists('notifications') || !$this->tableExists('notification_receipts')) {
            throw new RuntimeException('Notifications migration is missing. Run the latest migration first.');
        }

        return $this->database->transaction(function () use ($user, $notificationId, $decision): array {
            $notification = $this->database->fetchOne(
                'SELECT * FROM notifications WHERE id = :id AND target_roles LIKE :role_needle LIMIT 1 FOR UPDATE',
                [
                    ':id' => $notificationId,
                    ':role_needle' => '%"' . trim((string) ($user['role'] ?? '')) . '"%',
                ]
            );
            if ($notification === null) {
                throw new RuntimeException('Notification not found.');
            }
            if ((int) ($notification['is_active'] ?? 1) !== 1) {
                throw new RuntimeException('This notification is no longer active.');
            }

            $targetRoles = $this->normalizeNotificationTargetRoles($notification['target_roles'] ?? []);
            $actionConfig = $this->normalizeNotificationActionConfig($notification['action_config'] ?? [], $targetRoles);
            $kind = (string) ($actionConfig['kind'] ?? 'none');
            if (!in_array($kind, ['decision', 'link_and_decision'], true)) {
                throw new RuntimeException('This notification does not support decisions.');
            }

            if ((string) ($actionConfig['decisionMode'] ?? 'record_only') === 'transaction_approval') {
                $decisionContext = is_array($actionConfig['decisionContext'] ?? null) ? $actionConfig['decisionContext'] : [];
                $transactionId = trim((string) ($decisionContext['transactionId'] ?? ''));
                if ($transactionId === '') {
                    throw new RuntimeException('Transaction approval context is missing.');
                }

                $this->serviceLifecycle()->assertActionAllowed('reviewTransactionApproval');
                $operations = new OperationsApi($this->database, $this->auth, $this->config);
                $operations->reviewTransactionApproval([
                    'transactionId' => $transactionId,
                    'decision' => $decision === 'accepted' ? 'approve' : 'decline',
                ]);
            }

            $now = $this->database->nowUtc();
            $this->database->execute(
                'INSERT INTO notification_receipts (
                    notification_id, user_id, is_read, read_at, action_result, acted_at, created_at, updated_at
                 ) VALUES (
                    :notification_id, :user_id, 1, :read_at, :action_result, :acted_at, :created_at, :updated_at
                 )
                 ON DUPLICATE KEY UPDATE
                    is_read = 1,
                    read_at = COALESCE(notification_receipts.read_at, VALUES(read_at)),
                    action_result = VALUES(action_result),
                    acted_at = VALUES(acted_at),
                    updated_at = VALUES(updated_at)',
                [
                    ':notification_id' => $notificationId,
                    ':user_id' => (string) ($user['id'] ?? ''),
                    ':read_at' => $now,
                    ':action_result' => $decision,
                    ':acted_at' => $now,
                    ':created_at' => $now,
                    ':updated_at' => $now,
                ]
            );

            if ((string) ($actionConfig['decisionMode'] ?? 'record_only') === 'transaction_approval') {
                return ['success' => true];
            }

            $decisionScope = (string) ($actionConfig['decisionScope'] ?? 'all_users');
            if ($decisionScope === 'single_user') {
                $this->deactivateNotificationWithMetadata($notification, [
                    'decisionScope' => 'single_user',
                    'resolvedDecision' => $decision,
                    'resolvedAt' => $this->toIso($now),
                    'resolvedByUserId' => (string) ($user['id'] ?? ''),
                    'resolvedByName' => $this->nullableString($user['name'] ?? null),
                ]);
                return ['success' => true];
            }

            $targetViewerIds = array_values(array_filter(array_map(
                static fn(array $row): string => trim((string) ($row['user_id'] ?? '')),
                $this->fetchNotificationTargetViewerRows($notification)
            )));
            if ($this->haveAllNotificationTargetUsersActed($notificationId, $targetViewerIds)) {
                $this->deactivateNotificationWithMetadata($notification, [
                    'decisionScope' => 'all_users',
                    'allUsersActedAt' => $this->toIso($now),
                ]);
            }

            return ['success' => true];
        });
    }

    public function fetchServiceSubscriptionOverview(array $params = []): array
    {
        $user = $this->currentUser();
        return $this->buildServiceSubscriptionOverview($user);
    }

    public function saveServiceSubscriptionSettings(array $params): array
    {
        $developer = $this->requireDeveloperUser();
        if (
            !$this->tableExists('service_subscription_settings')
            || !$this->tableExists('service_subscription_items')
            || !$this->tableExists('service_subscription_methods')
            || !$this->tableExists('service_subscription_payments')
        ) {
            throw new RuntimeException('Service subscription tables are missing. Run the latest migration first.');
        }

        return $this->database->transaction(function () use ($developer, $params): array {
            $settingsRow = $this->database->fetchOne(
                'SELECT * FROM service_subscription_settings LIMIT 1 FOR UPDATE'
            );
            $hasResetScheduleColumns =
                $this->columnExists('service_subscription_settings', 'reset_day_of_month')
                && $this->columnExists('service_subscription_settings', 'reset_time_of_day');

            $currentVersion = max(1, (int) ($settingsRow['billing_version'] ?? 1));
            $currentDueAt = $this->nullableString($settingsRow['due_at'] ?? null);
            $currentTotalAmount = (float) ($settingsRow['total_amount'] ?? 0);
            $nextWarningDays = array_key_exists('warningDays', $params)
                ? max(1, (int) $params['warningDays'])
                : max(1, (int) ($settingsRow['warning_days'] ?? 7));
            $nextTotalAmount = array_key_exists('totalAmount', $params)
                ? max(0.0, (float) $params['totalAmount'])
                : $currentTotalAmount;
            $nextNagadNumber = array_key_exists('nagadNumber', $params)
                ? $this->nullableString($params['nagadNumber'])
                : $this->nullableString($settingsRow['nagad_number'] ?? null);
            $existingResetDay = $this->resolveServiceSubscriptionResetDayOfMonth($settingsRow, ['dueAt' => $currentDueAt]) ?? 1;
            $existingResetTime = $this->nullableString($hasResetScheduleColumns ? ($settingsRow['reset_time_of_day'] ?? null) : null);
            if ($existingResetTime === null && $currentDueAt !== null && strtotime($currentDueAt) !== false) {
                $existingResetTime = gmdate('H:i:s', strtotime($currentDueAt));
            }

            $legacyDueAt = array_key_exists('dueAt', $params)
                ? $this->nullableString($params['dueAt'])
                : null;
            $legacyDueAt = $legacyDueAt !== null ? $this->normalizeDateTimeInput($legacyDueAt) : null;
            $requestedResetDay = array_key_exists('resetDayOfMonth', $params)
                ? max(1, min(31, (int) $params['resetDayOfMonth']))
                : null;

            $nextResetDay = $requestedResetDay
                ?? ($legacyDueAt !== null ? $this->extractLocalDayOfMonthFromDateTime($legacyDueAt) : null)
                ?? $existingResetDay;
            $nextResetTime = $existingResetTime ?? ($legacyDueAt !== null && strtotime($legacyDueAt) !== false ? gmdate('H:i:s', strtotime($legacyDueAt)) : '00:00:00');
            $now = $this->database->nowUtc();

            $approvedCurrentVersion = $this->database->fetchOne(
                "SELECT id
                 FROM service_subscription_payments
                 WHERE billing_version = :billing_version
                   AND status = 'approved'
                 LIMIT 1",
                [':billing_version' => $currentVersion]
            );
            $shouldPreservePastDueAt =
                $currentDueAt !== null
                && strtotime($currentDueAt) !== false
                && strtotime($currentDueAt) <= strtotime($now)
                && $approvedCurrentVersion === null;

            if ($shouldPreservePastDueAt) {
                $nextDueAt = $currentDueAt;
            } elseif ($legacyDueAt !== null && $requestedResetDay === null) {
                $nextDueAt = $legacyDueAt;
            } elseif ($nextResetDay !== null) {
                $nextDueAt = $this->calculateNextServiceSubscriptionDueAt($nextResetDay, $nextResetTime);
            } else {
                $nextDueAt = $currentDueAt;
            }
            $billingVersion = $currentVersion;
            $settingsId = (string) ($settingsRow['id'] ?? 'service-subscriptions-default');

            if ($settingsRow === null) {
                $columns = [
                    'id',
                    'due_at',
                    'warning_days',
                    'total_amount',
                    'nagad_number',
                    'billing_version',
                    'created_by',
                    'updated_by',
                    'created_at',
                    'updated_at',
                ];
                $placeholders = [
                    ':id',
                    ':due_at',
                    ':warning_days',
                    ':total_amount',
                    ':nagad_number',
                    ':billing_version',
                    ':created_by',
                    ':updated_by',
                    ':created_at',
                    ':updated_at',
                ];
                $insertParams = [
                    ':id' => $settingsId,
                    ':due_at' => $nextDueAt,
                    ':warning_days' => $nextWarningDays,
                    ':total_amount' => $this->formatMoney($nextTotalAmount),
                    ':nagad_number' => $nextNagadNumber,
                    ':billing_version' => $billingVersion,
                    ':created_by' => (string) ($developer['id'] ?? ''),
                    ':updated_by' => (string) ($developer['id'] ?? ''),
                    ':created_at' => $now,
                    ':updated_at' => $now,
                ];
                if ($hasResetScheduleColumns) {
                    array_splice($columns, 2, 0, ['reset_day_of_month', 'reset_time_of_day']);
                    array_splice($placeholders, 2, 0, [':reset_day_of_month', ':reset_time_of_day']);
                    $insertParams[':reset_day_of_month'] = $nextResetDay;
                    $insertParams[':reset_time_of_day'] = $nextResetTime;
                }

                $this->database->execute(
                    'INSERT INTO service_subscription_settings (
                        ' . implode(', ', $columns) . '
                     ) VALUES (
                        ' . implode(', ', $placeholders) . '
                     )',
                    $insertParams
                );
            } else {
                $settingsPayload = [
                    'due_at' => $nextDueAt,
                    'warning_days' => $nextWarningDays,
                    'total_amount' => $this->formatMoney($nextTotalAmount),
                    'nagad_number' => $nextNagadNumber,
                    'billing_version' => $billingVersion,
                    'updated_by' => (string) ($developer['id'] ?? ''),
                ];
                if ($hasResetScheduleColumns) {
                    $settingsPayload['reset_day_of_month'] = $nextResetDay;
                    $settingsPayload['reset_time_of_day'] = $nextResetTime;
                }

                $this->touchUpdate('service_subscription_settings', $settingsId, $settingsPayload);
            }

            $items = is_array($params['items'] ?? null) ? $params['items'] : [];
            foreach ($items as $index => $item) {
                if (!is_array($item)) {
                    continue;
                }

                $existingItem = null;
                $systemKey = $this->nullableString($item['systemKey'] ?? null);
                $itemId = trim((string) ($item['id'] ?? ''));
                if ($itemId !== '') {
                    $existingItem = $this->database->fetchOne(
                        'SELECT id FROM service_subscription_items WHERE id = :id LIMIT 1',
                        [':id' => $itemId]
                    );
                } elseif ($systemKey !== null) {
                    $existingItem = $this->database->fetchOne(
                        'SELECT id FROM service_subscription_items WHERE system_key = :system_key LIMIT 1',
                        [':system_key' => $systemKey]
                    );
                    $itemId = (string) ($existingItem['id'] ?? '');
                }
                if ($itemId === '') {
                    $itemId = $this->uuid4();
                }

                $payload = [
                    'name' => trim((string) ($item['name'] ?? '')),
                    'description' => $this->nullableString($item['description'] ?? null),
                    'amount' => array_key_exists('amount', $item) && $item['amount'] !== null
                        ? $this->formatMoney((float) $item['amount'])
                        : null,
                    'is_optional' => !empty($item['isOptional']) ? 1 : 0,
                    'is_active' => array_key_exists('isActive', $item) ? (!empty($item['isActive']) ? 1 : 0) : 1,
                    'display_order' => array_key_exists('displayOrder', $item) ? (int) $item['displayOrder'] : (($index + 1) * 10),
                    'system_key' => $systemKey,
                ];
                if ($payload['name'] === '') {
                    continue;
                }

                if ($existingItem !== null) {
                    $this->touchUpdate('service_subscription_items', $itemId, $payload);
                } else {
                    $this->database->execute(
                        'INSERT INTO service_subscription_items (
                            id, name, description, amount, is_optional, is_active, display_order,
                            system_key, created_at, updated_at
                         ) VALUES (
                            :id, :name, :description, :amount, :is_optional, :is_active, :display_order,
                            :system_key, :created_at, :updated_at
                         )',
                        [
                            ':id' => $itemId,
                            ':name' => $payload['name'],
                            ':description' => $payload['description'],
                            ':amount' => $payload['amount'],
                            ':is_optional' => $payload['is_optional'],
                            ':is_active' => $payload['is_active'],
                            ':display_order' => $payload['display_order'],
                            ':system_key' => $payload['system_key'],
                            ':created_at' => $now,
                            ':updated_at' => $now,
                        ]
                    );
                }
            }

            $methods = is_array($params['methods'] ?? null) ? $params['methods'] : [];
            foreach ($methods as $index => $method) {
                if (!is_array($method)) {
                    continue;
                }

                $methodId = trim((string) ($method['id'] ?? ''));
                $existingMethod = null;
                if ($methodId !== '') {
                    $existingMethod = $this->database->fetchOne(
                        'SELECT id FROM service_subscription_methods WHERE id = :id LIMIT 1',
                        [':id' => $methodId]
                    );
                }
                if ($methodId === '') {
                    $methodId = $this->uuid4();
                }

                $payload = [
                    'name' => trim((string) ($method['name'] ?? '')),
                    'description' => $this->nullableString($method['description'] ?? null),
                    'is_active' => array_key_exists('isActive', $method) ? (!empty($method['isActive']) ? 1 : 0) : 1,
                    'display_order' => array_key_exists('displayOrder', $method) ? (int) $method['displayOrder'] : (($index + 1) * 10),
                ];
                if ($payload['name'] === '') {
                    continue;
                }

                if ($existingMethod !== null) {
                    $this->touchUpdate('service_subscription_methods', $methodId, $payload);
                } else {
                    $this->database->execute(
                        'INSERT INTO service_subscription_methods (
                            id, name, description, is_active, display_order, created_at, updated_at
                         ) VALUES (
                            :id, :name, :description, :is_active, :display_order, :created_at, :updated_at
                         )',
                        [
                            ':id' => $methodId,
                            ':name' => $payload['name'],
                            ':description' => $payload['description'],
                            ':is_active' => $payload['is_active'],
                            ':display_order' => $payload['display_order'],
                            ':created_at' => $now,
                            ':updated_at' => $now,
                        ]
                    );
                }
            }

            $overview = $this->buildServiceSubscriptionOverview($developer);
            $this->syncServiceSubscriptionNotifications($overview);
            return $overview;
        });
    }

    public function submitServiceSubscriptionPayment(array $params): array
    {
        $user = $this->currentUser();
        if (!$this->hasAdminAccess((string) ($user['role'] ?? ''))) {
            throw new ApiException('Admin access required.', 403, 'ADMIN_ACCESS_REQUIRED');
        }
        if (
            !$this->tableExists('service_subscription_settings')
            || !$this->tableExists('service_subscription_methods')
            || !$this->tableExists('service_subscription_payments')
        ) {
            throw new RuntimeException('Service subscription tables are missing. Run the latest migration first.');
        }

        return $this->database->transaction(function () use ($user, $params): array {
            $settingsRow = $this->database->fetchOne(
                'SELECT * FROM service_subscription_settings LIMIT 1 FOR UPDATE'
            );
            if ($settingsRow === null) {
                throw new RuntimeException('Service subscription settings are not configured yet.');
            }

            $billingVersion = max(1, (int) ($settingsRow['billing_version'] ?? 1));
            $minimumAmount = (float) ($settingsRow['total_amount'] ?? 0);
            $amount = max(0.0, (float) ($params['amount'] ?? 0));
            if ($amount < $minimumAmount) {
                throw new RuntimeException('Entered amount cannot be lower than the required renewal amount.');
            }

            $paymentMethodId = trim((string) ($params['paymentMethodId'] ?? ''));
            $transactionId = trim((string) ($params['transactionId'] ?? ''));
            if ($paymentMethodId === '') {
                throw new RuntimeException('Select a payment method.');
            }
            if ($transactionId === '') {
                throw new RuntimeException('Transaction id is required.');
            }

            $methodRow = $this->database->fetchOne(
                'SELECT id, name, is_active FROM service_subscription_methods WHERE id = :id LIMIT 1',
                [':id' => $paymentMethodId]
            );
            if ($methodRow === null || (int) ($methodRow['is_active'] ?? 0) !== 1) {
                throw new RuntimeException('Selected payment method is not available.');
            }

            $approvedCurrentVersion = $this->database->fetchOne(
                "SELECT id
                 FROM service_subscription_payments
                 WHERE billing_version = :billing_version
                   AND status = 'approved'
                 LIMIT 1",
                [':billing_version' => $billingVersion]
            );
            if ($approvedCurrentVersion !== null) {
                return $this->buildServiceSubscriptionOverview($user);
            }

            $existingProcessing = $this->database->fetchOne(
                "SELECT id
                 FROM service_subscription_payments
                 WHERE billing_version = :billing_version
                   AND status = 'processing'
                 ORDER BY submitted_at DESC
                 LIMIT 1",
                [':billing_version' => $billingVersion]
            );
            if ($existingProcessing !== null) {
                return $this->buildServiceSubscriptionOverview($user);
            }

            $delaySeconds = random_int(300, 600);
            $submittedAt = new \DateTimeImmutable('now', new \DateTimeZone('UTC'));
            $reactivateAt = $submittedAt->modify('+' . $delaySeconds . ' seconds');
            $paymentId = $this->uuid4();
            $now = $submittedAt->format('Y-m-d H:i:s');

            $this->database->execute(
                'INSERT INTO service_subscription_payments (
                    id, billing_version, amount, base_amount, tip_amount, payment_method_id,
                    payment_method_name, transaction_id, submitted_by, status,
                    submitted_at, reactivate_at, processed_at, created_at, updated_at
                 ) VALUES (
                    :id, :billing_version, :amount, :base_amount, :tip_amount, :payment_method_id,
                    :payment_method_name, :transaction_id, :submitted_by, :status,
                    :submitted_at, :reactivate_at, NULL, :created_at, :updated_at
                 )',
                [
                    ':id' => $paymentId,
                    ':billing_version' => $billingVersion,
                    ':amount' => $this->formatMoney($amount),
                    ':base_amount' => $this->formatMoney($minimumAmount),
                    ':tip_amount' => $this->formatMoney(max(0, $amount - $minimumAmount)),
                    ':payment_method_id' => (string) ($methodRow['id'] ?? ''),
                    ':payment_method_name' => (string) ($methodRow['name'] ?? ''),
                    ':transaction_id' => $transactionId,
                    ':submitted_by' => (string) ($user['id'] ?? ''),
                    ':status' => 'processing',
                    ':submitted_at' => $now,
                    ':reactivate_at' => $reactivateAt->format('Y-m-d H:i:s'),
                    ':created_at' => $now,
                    ':updated_at' => $now,
                ]
            );

            $overview = $this->buildServiceSubscriptionOverview($user);
            $this->syncServiceSubscriptionNotifications($overview);
            return $overview;
        });
    }
}
