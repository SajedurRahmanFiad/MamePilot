<?php
declare(strict_types=1);

namespace App;

use RuntimeException;
use Throwable;

final class MasterDataApi extends BaseService
{
    private const MAINTENANCE_DEFAULT_IMAGE_URL = '/uploads/Rat_avatar.png';
    private const MAINTENANCE_DEFAULT_CAPTION = 'A mouse is stuck in your server';
    private const MAINTENANCE_DEFAULT_SUBTITLE = 'Mame is actively chasing him with a piece of cheese to get it back to make the server work again.';
    private const MAINTENANCE_DEFAULT_EXPLANATION = "Some new updates are in progress. For the sake of safety and security, the server is currently turned off. You'll be able to access the app again as soon as the update is complete.";

    private function appendEncodedTextFilter(
        string &$where,
        array &$bindings,
        string $column,
        string $value,
        string $bindingName,
        bool $negative = false
    ): void {
        if ($value === '') return;

        $prefix = '__mp_filter_v1__:';
        $contains = false;
        if (str_starts_with($value, $prefix)) {
            $payload = substr($value, strlen($prefix));
            $separator = strpos($payload, ':');
            $mode = $separator === false ? '' : substr($payload, 0, $separator);
            if ($separator !== false && in_array($mode, ['equals', 'contains'], true)) {
                $value = rawurldecode(substr($payload, $separator + 1));
                $contains = $mode === 'contains';
            }
        } else {
            // Backward compatibility for navigation state created before tagged filters.
            $contains = strlen($value) >= 2 && str_starts_with($value, '%') && str_ends_with($value, '%');
            if ($contains) {
                $value = substr($value, 1, -1);
            }
        }
        if (!$contains) {
            $where .= " AND COALESCE({$column}, '') " . ($negative ? '<>' : '=') . " :{$bindingName}";
            $bindings[':' . $bindingName] = $value;
            return;
        }

        $escaped = str_replace(['=', '%', '_'], ['==', '=%', '=_'], $value);
        $where .= " AND COALESCE({$column}, '') " . ($negative ? 'NOT LIKE' : 'LIKE') . " :{$bindingName} ESCAPE '='";
        $bindings[':' . $bindingName] = '%' . $escaped . '%';
    }

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

        $maintenanceStatus = $this->fetchMaintenanceStatus();
        $isDeveloper = trim((string) ($row['role'] ?? '')) === 'Developer';
        if (!empty($maintenanceStatus['maintenanceEnabled']) && !$isDeveloper) {
            return ['user' => null, 'error' => 'Server under maintenance.'];
        }

        return [
            'user' => $this->mapUser($row),
            'token' => $this->auth->issueToken($row),
            'error' => null,
        ];
    }

    public function fetchMaintenanceStatus(array $params = []): array
    {
        $row = $this->capabilityRow();
        $status = $this->localMaintenanceStatus($row);
        $maintenanceEnabled = !empty($status['maintenanceEnabled']);

        if ($row !== null && trim((string) ($row['license_api_url'] ?? '')) !== '') {
            try {
                $status = $this->fetchRemoteMaintenanceStatus(
                    (string) $row['license_api_url'],
                    (string) ($row['license_owner_token'] ?? ''),
                    (string) ($row['license_key'] ?? '')
                );
                $remoteMaintenanceEnabled = !empty($status['maintenanceEnabled']);
                $maintenanceEnabled = $remoteMaintenanceEnabled;
                $this->persistLocalMaintenanceStatus((string) $row['id'], $status);
            } catch (\Throwable $exception) {
                // Preserve local maintenance state if central API is temporarily unavailable.
            }
        }

        $status['maintenanceEnabled'] = $maintenanceEnabled;
        return $status;
    }

    public function setMaintenanceStatus(array $params): array
    {
        $enabled = !empty($params['maintenanceEnabled'] ?? $params['maintenance_enabled'] ?? false);
        $this->requireDeveloperUser();

        $targetDeployments = $this->normalizeNotificationTargetRoles($params['targetDeployments'] ?? $params['target_deployments'] ?? []);
        $deploymentScope = trim((string) ($params['deploymentScope'] ?? $params['deployment_scope'] ?? 'all'));
        if (!in_array($deploymentScope, ['all', 'include', 'exclude'], true)) {
            $deploymentScope = 'all';
        }
        if ($deploymentScope === 'all') {
            $targetDeployments = [];
        } elseif ($enabled && $targetDeployments === []) {
            throw new RuntimeException('Select at least one deployment.');
        }

        $row = $this->capabilityRow();
        $apiUrl = trim((string) ($row['license_api_url'] ?? ''));
        $ownerToken = trim((string) ($row['license_owner_token'] ?? ''));
        $licenseKey = trim((string) ($row['license_key'] ?? ''));
        $imageInput = trim((string) ($params['imageUrl'] ?? $params['image_url'] ?? self::MAINTENANCE_DEFAULT_IMAGE_URL));
        $imageUrl = $this->normalizeUploadedFileValue(
            $imageInput !== '' ? $imageInput : self::MAINTENANCE_DEFAULT_IMAGE_URL,
            'maintenance',
            isset($params['imageName']) ? trim((string) $params['imageName']) : null
        ) ?? self::MAINTENANCE_DEFAULT_IMAGE_URL;
        if ($this->isDataUrl($imageUrl)) {
            throw new RuntimeException('Failed to store the maintenance image in the uploads folder.');
        }
        $caption = trim((string) ($params['caption'] ?? '')) ?: self::MAINTENANCE_DEFAULT_CAPTION;
        $subtitle = trim((string) ($params['subtitle'] ?? '')) ?: self::MAINTENANCE_DEFAULT_SUBTITLE;
        $explanation = trim((string) ($params['explanation'] ?? '')) ?: self::MAINTENANCE_DEFAULT_EXPLANATION;
        $endsAtInput = trim((string) ($params['endsAt'] ?? $params['ends_at'] ?? ''));
        $endsAt = $endsAtInput !== '' ? $this->normalizeDateTimeInput($endsAtInput) : null;
        if ($enabled && $endsAt !== null && strtotime($endsAt . ' UTC') <= time()) {
            $enabled = false;
        }

        $status = [
            'maintenanceEnabled' => $enabled,
            'maintenanceModeEnabled' => $enabled,
            'targetDeployments' => $targetDeployments,
            'deploymentScope' => $deploymentScope,
            'imageUrl' => $imageUrl,
            'caption' => $caption,
            'subtitle' => $subtitle,
            'explanation' => $explanation,
            'endsAt' => $this->toIso($endsAt),
        ];
        if ($apiUrl !== '') {
            $centralImageUrl = $this->absoluteMaintenanceImageUrl($imageUrl);
            $response = $this->centralLicenseRequest($apiUrl, $ownerToken, 'set_maintenance_status', [
                'maintenanceEnabled' => $enabled,
                'targetDeployments' => $targetDeployments,
                'deploymentScope' => $deploymentScope,
                'license_key' => $licenseKey,
                'imageUrl' => $centralImageUrl,
                'caption' => $caption,
                'subtitle' => $subtitle,
                'explanation' => $explanation,
                'endsAt' => $endsAt,
            ]);
            $status = $this->normalizeMaintenanceStatus($response, $status);
        } elseif ($deploymentScope !== 'all') {
            throw new RuntimeException('Central server configuration is required to target specific deployments.');
        }

        $this->persistLocalMaintenanceStatus((string) ($row['id'] ?? 'app-capabilities-default'), $status);
        return $status;
    }

    public function fetchUsers(array $params = []): array
    {
        $rows = $this->database->fetchAll(
            'SELECT id, name, phone, role, image, email, address, birthday, nid_passport_copy, gender, blood_group, nationality, cv, is_commission_based, fixed_salary, created_at, deleted_at, deleted_by
             FROM users
             WHERE deleted_at IS NULL AND COALESCE(is_system, 0) = 0
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

        $where = 'WHERE deleted_at IS NULL AND COALESCE(is_system, 0) = 0';
        $bindings = [];

        if ($role !== '' && $role !== 'All') {
            $where .= ' AND role = :role';
            $bindings[':role'] = $role;
        }
        $roleNot = trim((string) ($params['roleNot'] ?? ''));
        if ($roleNot !== '') {
            $where .= ' AND role <> :role_not';
            $bindings[':role_not'] = $roleNot;
        }

        if ($search !== '') {
            $where .= ' AND (name LIKE :search_name OR phone LIKE :search_phone OR role LIKE :search_role)';
            $bindings[':search_name'] = '%' . $search . '%';
            $bindings[':search_phone'] = '%' . $search . '%';
            $bindings[':search_role'] = '%' . $search . '%';
        }

        $this->appendEncodedTextFilter($where, $bindings, 'name', trim((string) ($params['name'] ?? '')), 'user_name');
        $this->appendEncodedTextFilter($where, $bindings, 'name', trim((string) ($params['nameNot'] ?? '')), 'user_name_not', true);
        $this->appendEncodedTextFilter($where, $bindings, 'phone', trim((string) ($params['phone'] ?? '')), 'user_phone');
        $this->appendEncodedTextFilter($where, $bindings, 'phone', trim((string) ($params['phoneNot'] ?? '')), 'user_phone_not', true);
        $this->appendEncodedTextFilter($where, $bindings, 'nationality', trim((string) ($params['nationality'] ?? '')), 'user_nationality');
        $this->appendEncodedTextFilter($where, $bindings, 'nationality', trim((string) ($params['nationalityNot'] ?? '')), 'user_nationality_not', true);
        foreach ([['gender', 'gender'], ['bloodGroup', 'blood_group']] as [$key, $column]) {
            $value = trim((string) ($params[$key] ?? ''));
            if ($value !== '') {
                $where .= " AND COALESCE({$column}, '') = :user_{$key}";
                $bindings[':user_' . $key] = $value === '__not_specified__' ? '' : $value;
            }
            $notValue = trim((string) ($params[$key . 'Not'] ?? ''));
            if ($notValue !== '') {
                $where .= " AND COALESCE({$column}, '') <> :user_{$key}_not";
                $bindings[':user_' . $key . '_not'] = $notValue === '__not_specified__' ? '' : $notValue;
            }
        }
        $joined = is_array($params['joined'] ?? null) ? $params['joined'] : [];
        $joinedValue = trim((string) ($joined['value'] ?? ''));
        $joinedOperator = ['on' => '=', 'before' => '<', 'after' => '>'][(string) ($joined['operator'] ?? '')] ?? null;
        if ($joinedOperator !== null && preg_match('/^\d{4}-\d{2}-\d{2}$/', $joinedValue)) {
            $where .= " AND DATE(created_at) {$joinedOperator} :joined_date";
            $bindings[':joined_date'] = $joinedValue;
        }

        $countRow = $this->database->fetchOne("SELECT COUNT(*) AS count FROM users {$where}", $bindings);
        $rows = $this->database->fetchAll(
            "SELECT id, name, phone, role, image, email, address, birthday, nid_passport_copy, gender, blood_group, nationality, cv, is_commission_based, fixed_salary, created_at, deleted_at, deleted_by
             FROM users
             {$where}
             ORDER BY created_at DESC, name ASC
             LIMIT {$pageSize} OFFSET {$offset}",
            $bindings
        );
        $roleRows = $this->database->fetchAll(
            'SELECT DISTINCT role FROM users WHERE deleted_at IS NULL AND COALESCE(is_system, 0) = 0 ORDER BY role ASC'
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
            'SELECT id, name FROM users WHERE deleted_at IS NULL AND COALESCE(is_system, 0) = 0 ORDER BY created_at DESC, name ASC'
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
        $fixedSalaryInput = $params['fixedSalary'] ?? $params['fixed_salary'] ?? null;
        $hasCommissionSelection = array_key_exists('isCommissionBased', $params) || array_key_exists('is_commission_based', $params);
        $isCommissionBased = $hasCommissionSelection
            ? !empty($params['isCommissionBased'] ?? $params['is_commission_based'] ?? false)
            : ($fixedSalaryInput === null || $fixedSalaryInput === '' || (float) $fixedSalaryInput <= 0);
        $fixedSalary = $isCommissionBased || $fixedSalaryInput === null || $fixedSalaryInput === ''
            ? null
            : (float) $fixedSalaryInput;
        if ($requestedRole === 'Employee' && !$isCommissionBased && ($fixedSalary === null || $fixedSalary <= 0)) {
            throw new RuntimeException('A fixed-salary employee must have a monthly salary greater than zero.');
        }
        $this->database->execute(
            'INSERT INTO users (
                id,
                name,
                phone,
                role,
                image,
                email,
                address,
                birthday,
                nid_passport_copy,
                gender,
                blood_group,
                nationality,
                cv,
                is_commission_based,
                fixed_salary,
                password_hash,
                created_at,
                updated_at
             ) VALUES (
                :id,
                :name,
                :phone,
                :role,
                :image,
                :email,
                :address,
                :birthday,
                :nid_passport_copy,
                :gender,
                :blood_group,
                :nationality,
                :cv,
                :is_commission_based,
                :fixed_salary,
                :password_hash,
                :created_at,
                :updated_at
             )',
            [
                ':id' => $id,
                ':name' => trim((string) ($params['name'] ?? '')),
                ':phone' => trim((string) ($params['phone'] ?? '')),
                ':role' => $requestedRole,
                ':image' => $this->normalizeUploadedFileValue($params['image'] ?? null, 'profile-pictures', isset($params['imageName']) ? trim((string) $params['imageName']) : null),
                ':email' => $this->nullableString($params['email'] ?? null),
                ':address' => $this->nullableString($params['address'] ?? null),
                ':birthday' => $this->nullableString($this->normalizeDateOnly((string) ($params['birthday'] ?? ''))),
                ':nid_passport_copy' => $this->normalizeUploadedFileValue($params['nidPassportCopy'] ?? $params['nid_passport_copy'] ?? null, 'documents', null),
                ':gender' => $this->nullableString($params['gender'] ?? null),
                ':blood_group' => $this->nullableString($params['bloodGroup'] ?? $params['blood_group'] ?? null),
                ':nationality' => $this->nullableString($params['nationality'] ?? null),
                ':cv' => $this->normalizeUploadedFileValue($params['cv'] ?? null, 'documents', null),
                ':is_commission_based' => $isCommissionBased ? 1 : 0,
                ':fixed_salary' => $fixedSalary,
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
            'SELECT id, role, is_commission_based, fixed_salary FROM users WHERE id = :id AND deleted_at IS NULL LIMIT 1',
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
            $payload['image'] = $this->normalizeUploadedFileValue($updates['image'] ?? null, 'profile-pictures', isset($updates['imageName']) ? trim((string) $updates['imageName']) : null);
        }
        if (array_key_exists('email', $updates)) {
            $payload['email'] = $this->nullableString($updates['email']);
        }
        if (array_key_exists('address', $updates)) {
            $payload['address'] = $this->nullableString($updates['address']);
        }
        if (array_key_exists('birthday', $updates)) {
            $payload['birthday'] = $this->nullableString($this->normalizeDateOnly((string) $updates['birthday']));
        }
        if (array_key_exists('nidPassportCopy', $updates) || array_key_exists('nid_passport_copy', $updates)) {
            $payload['nid_passport_copy'] = $this->normalizeUploadedFileValue($updates['nidPassportCopy'] ?? $updates['nid_passport_copy'] ?? null, 'documents', null);
        }
        if (array_key_exists('gender', $updates)) {
            $payload['gender'] = $this->nullableString($updates['gender']);
        }
        if (array_key_exists('bloodGroup', $updates) || array_key_exists('blood_group', $updates)) {
            $payload['blood_group'] = $this->nullableString($updates['bloodGroup'] ?? $updates['blood_group'] ?? null);
        }
        if (array_key_exists('nationality', $updates)) {
            $payload['nationality'] = $this->nullableString($updates['nationality']);
        }
        if (array_key_exists('cv', $updates)) {
            $payload['cv'] = $this->normalizeUploadedFileValue($updates['cv'] ?? null, 'documents', null);
        }
        if (array_key_exists('isCommissionBased', $updates) || array_key_exists('is_commission_based', $updates)) {
            $isCommissionBased = !empty($updates['isCommissionBased'] ?? $updates['is_commission_based'] ?? false);
            $payload['is_commission_based'] = $isCommissionBased ? 1 : 0;
            if ($isCommissionBased) {
                $payload['fixed_salary'] = null;
            }
        }
        if (array_key_exists('fixedSalary', $updates) || array_key_exists('fixed_salary', $updates)) {
            $fixedSalary = $updates['fixedSalary'] ?? $updates['fixed_salary'] ?? null;
            $payload['fixed_salary'] = $fixedSalary === null || $fixedSalary === '' ? null : (float) $fixedSalary;
        }
        if (!empty($updates['password'])) {
            $payload['password_hash'] = password_hash((string) $updates['password'], PASSWORD_BCRYPT, ['cost' => 12]);
        }

        $compensationTouched = array_key_exists('role', $updates)
            || array_key_exists('isCommissionBased', $updates)
            || array_key_exists('is_commission_based', $updates)
            || array_key_exists('fixedSalary', $updates)
            || array_key_exists('fixed_salary', $updates);
        $finalRole = (string) ($payload['role'] ?? $existing['role'] ?? '');
        $finalIsCommissionBased = array_key_exists('is_commission_based', $payload)
            ? (bool) $payload['is_commission_based']
            : !empty($existing['is_commission_based'] ?? false);
        $finalFixedSalary = array_key_exists('fixed_salary', $payload)
            ? $payload['fixed_salary']
            : ($existing['fixed_salary'] ?? null);
        if (
            $compensationTouched
            && $finalRole === 'Employee'
            && !$finalIsCommissionBased
            && ($finalFixedSalary === null || (float) $finalFixedSalary <= 0)
        ) {
            throw new RuntimeException('A fixed-salary employee must have a monthly salary greater than zero.');
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

        $this->appendEncodedTextFilter($where, $bindings, 'name', trim((string) ($params['name'] ?? '')), 'name');
        $this->appendEncodedTextFilter($where, $bindings, 'name', trim((string) ($params['nameNot'] ?? '')), 'name_not', true);
        $this->appendEncodedTextFilter($where, $bindings, 'phone', trim((string) ($params['phone'] ?? '')), 'phone');
        $this->appendEncodedTextFilter($where, $bindings, 'phone', trim((string) ($params['phoneNot'] ?? '')), 'phone_not', true);
        $this->appendEncodedTextFilter($where, $bindings, 'address', trim((string) ($params['address'] ?? '')), 'address');
        $this->appendEncodedTextFilter($where, $bindings, 'address', trim((string) ($params['addressNot'] ?? '')), 'address_not', true);

        foreach ([['createdByIds', false], ['createdByNotIds', true]] as [$key, $negative]) {
            $ids = is_array($params[$key] ?? null) ? array_values(array_filter(array_map('strval', $params[$key]))) : [];
            if ($ids === []) continue;
            [$placeholders, $idBindings] = $this->inClause($ids, $negative ? 'customer_creator_not' : 'customer_creator');
            $where .= ' AND created_by ' . ($negative ? 'NOT IN' : 'IN') . ' (' . implode(', ', $placeholders) . ')';
            $bindings += $idBindings;
        }

        foreach ([['totalOrders', 'total_orders'], ['dueAmount', 'due_amount']] as [$key, $column]) {
            $filter = is_array($params[$key] ?? null) ? $params[$key] : [];
            $operator = (string) ($filter['operator'] ?? '');
            $value = $filter['value'] ?? null;
            $sqlOperator = ['=' => '=', '≠' => '<>', '<' => '<', '>' => '>'][$operator] ?? null;
            if ($sqlOperator === null || !is_numeric($value)) continue;
            $bindingKey = $key === 'totalOrders' ? 'total_orders' : 'due_amount';
            $where .= " AND {$column} {$sqlOperator} :{$bindingKey}";
            $bindings[':' . $bindingKey] = (float) $value;
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
        $params = $this->resolveSmartContactInput($params, 'customer');
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
        $updates = $this->resolveSmartContactInput($updates, 'customer');
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
        $this->appendEncodedTextFilter($where, $bindings, 'name', trim((string) ($params['name'] ?? '')), 'vendor_name');
        $this->appendEncodedTextFilter($where, $bindings, 'name', trim((string) ($params['nameNot'] ?? '')), 'vendor_name_not', true);
        $this->appendEncodedTextFilter($where, $bindings, 'phone', trim((string) ($params['phone'] ?? '')), 'vendor_phone');
        $this->appendEncodedTextFilter($where, $bindings, 'phone', trim((string) ($params['phoneNot'] ?? '')), 'vendor_phone_not', true);
        $this->appendEncodedTextFilter($where, $bindings, 'address', trim((string) ($params['address'] ?? '')), 'vendor_address');
        $this->appendEncodedTextFilter($where, $bindings, 'address', trim((string) ($params['addressNot'] ?? '')), 'vendor_address_not', true);
        foreach ([['purchases', 'total_purchases'], ['payable', 'due_amount']] as [$key, $column]) {
            $filter = is_array($params[$key] ?? null) ? $params[$key] : [];
            $operator = ['=' => '=', '≠' => '<>', '<' => '<', '>' => '>'][(string) ($filter['operator'] ?? '')] ?? null;
            if ($operator === null || !is_numeric($filter['value'] ?? null)) continue;
            $bindingKey = 'vendor_' . $key;
            $where .= " AND {$column} {$operator} :{$bindingKey}";
            $bindings[':' . $bindingKey] = (float) $filter['value'];
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
        $params = $this->resolveSmartContactInput($params, 'vendor');
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
        $updates = $this->resolveSmartContactInput($updates, 'vendor');
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
        $sql = 'SELECT id, name, image, category, unit_id, sale_price, purchase_price, stock, dynamic_pricing, created_by, created_at, deleted_at, deleted_by
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
            $this->appendEncodedTextFilter($where, $bindings, 'category', $category, 'category');
        }
        $categoryNot = trim((string) ($params['categoryNot'] ?? ''));
        $this->appendEncodedTextFilter($where, $bindings, 'category', $categoryNot, 'category_not', true);
        $name = trim((string) ($params['name'] ?? ''));
        $this->appendEncodedTextFilter($where, $bindings, 'name', $name, 'name_filter');
        $nameNot = trim((string) ($params['nameNot'] ?? ''));
        $this->appendEncodedTextFilter($where, $bindings, 'name', $nameNot, 'name_not', true);
        $createdByIds = array_values(array_filter(array_map('strval', $createdByIds), static fn(string $id): bool => trim($id) !== ''));
        if ($createdByIds !== []) {
            [$placeholders, $inBindings] = $this->inClause($createdByIds, 'created_by');
            $where .= ' AND created_by IN (' . implode(', ', $placeholders) . ')';
            $bindings += $inBindings;
        }
        $createdByNotIds = is_array($params['createdByNotIds'] ?? null) ? array_values(array_filter(array_map('strval', $params['createdByNotIds']))) : [];
        if ($createdByNotIds !== []) {
            [$placeholders, $notBindings] = $this->inClause($createdByNotIds, 'product_created_by_not');
            $where .= ' AND created_by NOT IN (' . implode(', ', $placeholders) . ')';
            $bindings += $notBindings;
        }
        foreach ([['stock', 'stock'], ['salePrice', 'sale_price'], ['purchasePrice', 'purchase_price']] as [$key, $column]) {
            $filter = is_array($params[$key] ?? null) ? $params[$key] : [];
            $operator = ['=' => '=', '≠' => '<>', '<' => '<', '>' => '>'][(string) ($filter['operator'] ?? '')] ?? null;
            if ($operator === null || !is_numeric($filter['value'] ?? null)) continue;
            $bindingKey = 'product_' . strtolower(preg_replace('/(?<!^)[A-Z]/', '_$0', $key));
            $where .= " AND {$column} {$operator} :{$bindingKey}";
            $bindings[':' . $bindingKey] = (float) $filter['value'];
        }

        $countRow = $this->database->fetchOne("SELECT COUNT(*) AS count FROM products {$where}", $bindings);
        $rows = $this->database->fetchAll(
            "SELECT id, name, category, unit_id, sale_price, purchase_price, stock, dynamic_pricing, created_by, created_at, deleted_at, deleted_by
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
            'SELECT id, name, image, sale_price, purchase_price, stock, dynamic_pricing FROM products WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100'
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
            "SELECT id, name, image, sale_price, purchase_price, stock, dynamic_pricing
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
            'INSERT INTO products (id, name, image, category, unit_id, sale_price, purchase_price, stock, dynamic_pricing, created_by, created_at, updated_at)
             VALUES (:id, :name, :image, :category, :unit_id, :sale_price, :purchase_price, :stock, :dynamic_pricing, :created_by, :created_at, :updated_at)',
            [
                ':id' => $id,
                ':name' => trim((string) ($params['name'] ?? '')),
                ':image' => $this->normalizeUploadedFileValue($params['image'] ?? null, 'product-images', isset($params['imageName']) ? trim((string) $params['imageName']) : null),
                ':category' => $this->nullableString($params['category'] ?? null),
                ':unit_id' => $this->nullableString($params['unitId'] ?? null),
                ':sale_price' => $this->formatMoney($params['salePrice'] ?? 0),
                ':purchase_price' => $this->formatMoney($params['purchasePrice'] ?? 0),
                ':stock' => (int) ($params['stock'] ?? 0),
                ':dynamic_pricing' => $this->nullableString($params['dynamicPricing'] ?? null),
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
            $payload['image'] = $this->normalizeUploadedFileValue($updates['image'] ?? null, 'product-images', isset($updates['imageName']) ? trim((string) $updates['imageName']) : null);
        }
        if (array_key_exists('category', $updates)) {
            $payload['category'] = $this->nullableString($updates['category']);
        }
        if (array_key_exists('unitId', $updates)) {
            $payload['unit_id'] = $this->nullableString($updates['unitId']);
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
        if (array_key_exists('dynamicPricing', $updates)) {
            $payload['dynamic_pricing'] = $this->nullableString($updates['dynamicPricing']);
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
        
        // Check if category is a system category
        $category = $this->database->fetchOne(
            'SELECT is_system FROM categories WHERE id = :id LIMIT 1',
            [':id' => $id]
        );
        if ($category && $category['is_system']) {
            throw new RuntimeException('System categories cannot be edited.');
        }
        
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
        $id = trim((string) ($params['id'] ?? ''));
        
        // Check if category is a system category
        $category = $this->database->fetchOne(
            'SELECT is_system FROM categories WHERE id = :id LIMIT 1',
            [':id' => $id]
        );
        if ($category && $category['is_system']) {
            throw new RuntimeException('System categories cannot be deleted.');
        }
        
        $this->database->execute('DELETE FROM categories WHERE id = :id', [':id' => $id]);
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
                 VALUES (:id, :name, :description, :is_active, :created_at, :updated_at)',
                [
                    ':id' => $id,
                    ':name' => trim((string) ($params['name'] ?? '')),
                    ':description' => $this->nullableString($params['description'] ?? null),
                    ':is_active' => 1,
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
            'INSERT INTO units (id, name, short_name, description, is_fraction, created_at, updated_at)
             VALUES (:id, :name, :short_name, :description, :is_fraction, :created_at, :updated_at)',
            [
                ':id' => $id,
                ':name' => trim((string) ($params['name'] ?? '')),
                ':short_name' => trim((string) ($params['shortName'] ?? '')),
                ':description' => $this->nullableString($params['description'] ?? null),
                ':is_fraction' => (int) (!empty($params['isFraction'])),
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
        if (array_key_exists('isFraction', $updates)) {
            $payload['is_fraction'] = (int) !empty($updates['isFraction']);
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

        $saved = $this->saveSingleton(
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
        $this->purgeGlobalBrandingCache();
        return $saved;
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
            'themeColor' => trim((string) ($row['theme_color'] ?? '#0f2f57')),
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
                'theme_color' => array_key_exists('themeColor', $params) ? $this->nullableString($params['themeColor']) : $current['themeColor'],
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

        // Preserve sub-capabilities if present
        if (isset($raw['subCapabilities']) && is_array($raw['subCapabilities'])) {
            $defaults['subCapabilities'] = $raw['subCapabilities'];
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
        $maintenanceEnabled = !empty($row['maintenance_enabled'] ?? 0);

        if ($row !== null && trim((string) ($row['license_api_url'] ?? '')) !== '') {
            try {
                $remoteMaintenanceStatus = $this->fetchRemoteMaintenanceStatus(
                    (string) $row['license_api_url'],
                    (string) ($row['license_owner_token'] ?? ''),
                    (string) ($row['license_key'] ?? '')
                );
                $remoteMaintenanceEnabled = !empty($remoteMaintenanceStatus['maintenanceEnabled']);
                if ($remoteMaintenanceEnabled !== $maintenanceEnabled) {
                    $maintenanceEnabled = $remoteMaintenanceEnabled;
                    $this->touchUpdate('app_capability_settings', (string) $row['id'], [
                        'maintenance_enabled' => $maintenanceEnabled ? 1 : 0,
                    ]);
                }
            } catch (\Throwable $exception) {
                // Preserve local maintenance state if central API is temporarily unavailable.
            }
        }

        return [
            'capabilities' => $capabilities,
            'tierKey' => $this->nullableString($row['tier_key'] ?? null),
            'planName' => $this->nullableString($row['plan_name'] ?? null),
            'licenseStatus' => (string) ($row['license_status'] ?? 'local'),
            'renewalDate' => $this->toIso($row['renewal_date'] ?? null),
            'overrideEnabled' => !empty($row['override_enabled']),
            'maintenanceEnabled' => $maintenanceEnabled,
            'availableTiers' => $this->normalizeLicenseTiers($row['available_tiers'] ?? null),
            'pricingMetadata' => $this->jsonDecodeAssoc($row['pricing_metadata'] ?? null),
            'lastSyncedAt' => $this->toIso($row['last_synced_at'] ?? null),
            'lastSyncStatus' => $this->nullableString($row['last_sync_status'] ?? null),
            'lastSyncMessage' => $this->nullableString($row['last_sync_message'] ?? null),
            'syncGraceUntil' => $this->toIso($row['sync_grace_until'] ?? null),
            'licenseKey' => $isDeveloper ? (string) ($row['license_key'] ?? '') : '',
            'licenseApiUrl' => $isDeveloper ? (string) ($row['license_api_url'] ?? '') : '',
            'licenseOwnerToken' => $isDeveloper ? (string) ($row['license_owner_token'] ?? '') : '',
            'webhookUrl' => $isDeveloper ? (string) ($row['webhook_url'] ?? '') : '',
        ];
    }

    /** @return array<string, mixed> */
    private function fetchRemoteMaintenanceStatus(string $apiUrl, string $ownerToken, string $licenseKey): array
    {
        $response = $this->centralLicenseRequest($apiUrl, $ownerToken, 'fetch_maintenance_status', [
            'license_key' => trim($licenseKey),
        ]);
        return $this->normalizeMaintenanceStatus($response, $this->localMaintenanceStatus($this->capabilityRow()));
    }

    /** @return array<string, mixed> */
    private function localMaintenanceStatus(?array $row): array
    {
        $maintenanceEnabled = !empty($row['maintenance_enabled'] ?? 0);
        $endsAt = $this->toIso($row['maintenance_ends_at'] ?? null);
        if ($maintenanceEnabled && $endsAt !== null) {
            $deadline = strtotime($endsAt);
            if ($deadline !== false && $deadline <= time()) {
                $maintenanceEnabled = false;
                if ($row !== null && isset($row['id'])) {
                    $this->touchUpdate('app_capability_settings', (string) $row['id'], ['maintenance_enabled' => 0]);
                }
            }
        }

        return [
            'maintenanceEnabled' => $maintenanceEnabled,
            'maintenanceModeEnabled' => $maintenanceEnabled,
            'targetDeployments' => [],
            'deploymentScope' => 'all',
            'imageUrl' => trim((string) ($row['maintenance_image_url'] ?? '')) ?: self::MAINTENANCE_DEFAULT_IMAGE_URL,
            'caption' => trim((string) ($row['maintenance_caption'] ?? '')) ?: self::MAINTENANCE_DEFAULT_CAPTION,
            'subtitle' => trim((string) ($row['maintenance_subtitle'] ?? '')) ?: self::MAINTENANCE_DEFAULT_SUBTITLE,
            'explanation' => trim((string) ($row['maintenance_explanation'] ?? '')) ?: self::MAINTENANCE_DEFAULT_EXPLANATION,
            'endsAt' => $endsAt,
        ];
    }

    public function fetchGlobalBranding(array $params = []): array
    {
        $cacheKey = $this->globalBrandingCacheKey();
        if (function_exists('apcu_fetch')) {
            $hit = false;
            $cached = apcu_fetch($cacheKey, $hit);
            if ($hit && is_array($cached)) {
                return $cached;
            }
        }

        $cachePath = $this->globalBrandingCachePath();
        if (is_file($cachePath)) {
            $decoded = json_decode((string) @file_get_contents($cachePath), true);
            if (is_array($decoded) && isset($decoded['name'], $decoded['logo'], $decoded['version'])) {
                if (function_exists('apcu_store')) {
                    @apcu_store($cacheKey, $decoded, 86400);
                }
                return $decoded;
            }
        }

        $row = $this->database->fetchOne('SELECT name, logo, pages, updated_at FROM company_settings LIMIT 1');
        $pages = $this->normalizeCompanyPages($row['pages'] ?? [], $row ?? []);
        $globalPage = $this->getGlobalCompanyPage($pages);
        $branding = [
            'name' => (string) ($globalPage['name'] ?? $row['name'] ?? 'Mame Pilot'),
            'logo' => (string) ($globalPage['logo'] ?? $row['logo'] ?? '/uploads/Avatar.png'),
            'version' => (string) ($row['updated_at'] ?? 'default'),
        ];

        @file_put_contents($cachePath, $this->jsonEncode($branding), LOCK_EX);
        if (function_exists('apcu_store')) {
            @apcu_store($cacheKey, $branding, 86400);
        }
        return $branding;
    }

    /** @param array<string, mixed> $fallback @return array<string, mixed> */
    private function normalizeMaintenanceStatus(array $response, array $fallback): array
    {
        $deploymentScope = trim((string) ($response['deploymentScope'] ?? $response['deployment_scope'] ?? $fallback['deploymentScope'] ?? 'all'));
        if (!in_array($deploymentScope, ['all', 'include', 'exclude'], true)) {
            $deploymentScope = 'all';
        }
        $endsAtValue = trim((string) ($response['endsAt'] ?? $response['ends_at'] ?? $fallback['endsAt'] ?? ''));
        $maintenanceEnabled = !empty($response['maintenanceEnabled'] ?? $response['maintenance_enabled'] ?? $fallback['maintenanceEnabled'] ?? false);

        return [
            'maintenanceEnabled' => $maintenanceEnabled,
            'maintenanceModeEnabled' => !empty($response['maintenanceModeEnabled'] ?? $response['maintenance_mode_enabled'] ?? $fallback['maintenanceModeEnabled'] ?? $maintenanceEnabled),
            'targetDeployments' => $this->normalizeNotificationTargetRoles($response['targetDeployments'] ?? $response['target_deployments'] ?? $fallback['targetDeployments'] ?? []),
            'deploymentScope' => $deploymentScope,
            'imageUrl' => trim((string) ($response['imageUrl'] ?? $response['image_url'] ?? $fallback['imageUrl'] ?? '')) ?: self::MAINTENANCE_DEFAULT_IMAGE_URL,
            'caption' => trim((string) ($response['caption'] ?? $fallback['caption'] ?? '')) ?: self::MAINTENANCE_DEFAULT_CAPTION,
            'subtitle' => trim((string) ($response['subtitle'] ?? $fallback['subtitle'] ?? '')) ?: self::MAINTENANCE_DEFAULT_SUBTITLE,
            'explanation' => trim((string) ($response['explanation'] ?? $fallback['explanation'] ?? '')) ?: self::MAINTENANCE_DEFAULT_EXPLANATION,
            'endsAt' => $endsAtValue !== '' ? $this->toIso($endsAtValue) : null,
        ];
    }

    /** @param array<string, mixed> $status */
    private function persistLocalMaintenanceStatus(string $id, array $status): void
    {
        if ($id === '' || !$this->tableExists('app_capability_settings')) {
            return;
        }

        $endsAt = trim((string) ($status['endsAt'] ?? ''));
        $payload = [
            'maintenance_enabled' => !empty($status['maintenanceEnabled']) ? 1 : 0,
            'maintenance_image_url' => trim((string) ($status['imageUrl'] ?? '')) ?: self::MAINTENANCE_DEFAULT_IMAGE_URL,
            'maintenance_caption' => trim((string) ($status['caption'] ?? '')) ?: self::MAINTENANCE_DEFAULT_CAPTION,
            'maintenance_subtitle' => trim((string) ($status['subtitle'] ?? '')) ?: self::MAINTENANCE_DEFAULT_SUBTITLE,
            'maintenance_explanation' => trim((string) ($status['explanation'] ?? '')) ?: self::MAINTENANCE_DEFAULT_EXPLANATION,
            'maintenance_ends_at' => $endsAt !== '' ? $this->normalizeDateTimeInput($endsAt) : null,
        ];
        foreach (array_keys($payload) as $column) {
            if (!$this->columnExists('app_capability_settings', $column)) {
                unset($payload[$column]);
            }
        }
        $current = $this->capabilityRow();
        foreach ($payload as $column => $value) {
            $currentValue = $current[$column] ?? null;
            if (($currentValue === null && $value === null) || (string) $currentValue === (string) $value) {
                unset($payload[$column]);
            }
        }
        if ($payload !== []) {
            $this->touchUpdate('app_capability_settings', $id, $payload);
        }
    }

    private function absoluteMaintenanceImageUrl(string $imageUrl): string
    {
        $imageUrl = trim($imageUrl);
        if ($imageUrl === '' || $imageUrl === self::MAINTENANCE_DEFAULT_IMAGE_URL || preg_match('#^https?://#i', $imageUrl) === 1) {
            return $imageUrl !== '' ? $imageUrl : self::MAINTENANCE_DEFAULT_IMAGE_URL;
        }
        if (!str_starts_with($imageUrl, '/')) {
            return $imageUrl;
        }

        $baseUrl = rtrim(trim((string) ($this->config->get('APP_FRONTEND_URL', '') ?? '')), '/');
        if ($baseUrl === '') {
            $forwardedProto = trim((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
            $scheme = $forwardedProto !== ''
                ? strtolower(explode(',', $forwardedProto)[0])
                : ((!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http');
            $host = trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
            if ($host !== '') {
                $baseUrl = $scheme . '://' . $host;
            }
        }

        return $baseUrl !== '' ? $baseUrl . $imageUrl : $imageUrl;
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
            'maintenance_enabled' => array_key_exists('maintenanceEnabled', $params) ? (!empty($params['maintenanceEnabled']) ? 1 : 0) : (int) ($row['maintenance_enabled'] ?? 0),
            'available_tiers' => array_key_exists('availableTiers', $params) ? $this->jsonEncode($this->normalizeLicenseTiers($params['availableTiers'])) : ($row['available_tiers'] ?? null),
            'pricing_metadata' => array_key_exists('pricingMetadata', $params) ? $this->jsonEncode(is_array($params['pricingMetadata']) ? $params['pricingMetadata'] : []) : ($row['pricing_metadata'] ?? null),
            'last_sync_status' => array_key_exists('lastSyncStatus', $params) ? trim((string) $params['lastSyncStatus']) : 'manual',
            'last_sync_message' => array_key_exists('lastSyncMessage', $params) ? $this->nullableString($params['lastSyncMessage']) : 'Saved manually by developer.',
            'webhook_url' => array_key_exists('webhookUrl', $params) ? $this->nullableString($params['webhookUrl']) : ($row['webhook_url'] ?? null),
            'webhook_secret' => array_key_exists('webhookSecret', $params) ? $this->nullableString($params['webhookSecret']) : ($row['webhook_secret'] ?? null),
        ];

        foreach (['license_owner_token', 'tier_key', 'override_enabled', 'maintenance_enabled', 'available_tiers', 'pricing_metadata', 'webhook_url', 'webhook_secret'] as $column) {
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

    private function normalizePricingMetadata($pricingMetadata): array
    {
        if (!is_array($pricingMetadata)) {
            return [];
        }

        $normalized = [];
        foreach (['monthly', 'yearly'] as $key) {
            if (!array_key_exists($key, $pricingMetadata)) {
                continue;
            }
            $value = trim((string) ($pricingMetadata[$key] ?? ''));
            if ($value === '') {
                continue;
            }
            $number = (float) $value;
            if ($number < 0) {
                $number = 0.0;
            }
            $normalized[$key] = $number;
        }

        return $normalized;
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
        $pricingMetadata = $this->normalizePricingMetadata($params['pricingMetadata'] ?? null);
        $payload = [
            'license_key' => $licenseKey ?: null,
            'client_name' => trim((string) ($params['clientName'] ?? $host ?: 'MamePilot Client')),
            'domain' => trim((string) ($params['domain'] ?? $host)),
            'tier_key' => $tierKey,
            'status' => trim((string) ($params['status'] ?? 'active')),
            'renewal_date' => $params['renewalDate'] ?? $settingsRow['renewal_date'] ?? null,
            'pricing_metadata' => $pricingMetadata,
        ];

        $response = $this->centralLicenseRequest($apiUrl, $ownerToken, 'create_or_update_license', $payload);
        $result = $this->storeResolvedLicensePayload($response, $apiUrl, $ownerToken, 'Central license saved successfully.');
        if ($pricingMetadata !== []) {
            $this->updateCapabilitySettings([
                '__skipDeveloperCheck' => true,
                'pricingMetadata' => $pricingMetadata,
            ]);
            $result = $this->fetchCapabilitySettings();
        }
        return $result;
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
        $pricingMetadata = $this->normalizePricingMetadata($params['pricingMetadata'] ?? null);
        $response = $this->centralLicenseRequest($apiUrl, $ownerToken, 'update_license_override', [
            'license_key' => $licenseKey,
            'capabilities' => $capabilities,
            'pricing_metadata' => $pricingMetadata,
        ]);

        $result = $this->storeResolvedLicensePayload($response, $apiUrl, $ownerToken, 'Central capability override saved successfully.');
        if ($pricingMetadata !== []) {
            $this->updateCapabilitySettings([
                '__skipDeveloperCheck' => true,
                'pricingMetadata' => $pricingMetadata,
            ]);
            $result = $this->fetchCapabilitySettings();
        }
        return $result;
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
        $triedFallback = false;
        if ((stripos($apiUrl, '/api.php') === false) && (
            ($response['status'] === 404 || $response['status'] === 405)
            || ($response['status'] >= 200 && $response['status'] < 300 && !is_array($response['json']))
        )) {
            $fallbackUrl = rtrim($apiUrl, '/') . '/api.php';
            if ($fallbackUrl !== $apiUrl) {
                $fallbackResponse = $this->httpJson('POST', $fallbackUrl, $headers, ['action' => $action] + $payload);
                if ($fallbackResponse['status'] >= 200 && $fallbackResponse['status'] < 300 && is_array($fallbackResponse['json'])) {
                    return $fallbackResponse['json'];
                }
                $response = $fallbackResponse;
                $apiUrl = $fallbackUrl;
                $triedFallback = true;
            }
        }

        if ($response['status'] < 200 || $response['status'] >= 300 || !is_array($response['json'])) {
            $httpStatus = (int) $response['status'];
            $remoteError = is_array($response['json'] ?? null)
                ? (string) (($response['json']['error'] ?? null) ?: '')
                : '';
            $bodySnippet = is_string($response['body'] ?? null)
                ? substr(trim((string) $response['body']), 0, 200)
                : '';

            if ($httpStatus === 404) {
                $message = 'Central license API endpoint not found at ' . $apiUrl . '. Upload deploy/central-license-api-template.php as api.php on the license subdomain, then use the full /api.php URL.';
            } elseif ($remoteError !== '') {
                $message = 'Central server error (HTTP ' . $httpStatus . '): ' . $remoteError;
            } elseif ($httpStatus === 0) {
                $message = 'Could not connect to central server at ' . $apiUrl . '. Verify the URL is reachable from your PHP environment.';
            } else {
                $message = 'Central license request failed with HTTP ' . $httpStatus . ' at ' . $apiUrl . '.';
                if ($bodySnippet !== '') {
                    $message .= ' Response: ' . $bodySnippet;
                }
            }
            if ($triedFallback) {
                $message .= ' Tried fallback path /api.php automatically.';
            }
            throw new RuntimeException($message);
        }

        return $response['json'];
    }

    private function fetchCentralNotifications(array $params = []): array
    {
        $settingsRow = $this->capabilityRow();
        $apiUrl = trim((string) ($params['licenseApiUrl'] ?? $settingsRow['license_api_url'] ?? ''));
        $ownerToken = trim((string) ($params['licenseOwnerToken'] ?? $settingsRow['license_owner_token'] ?? ''));
        if ($apiUrl === '') {
            return [];
        }

        $action = array_key_exists('id', $params) && trim((string) ($params['id'] ?? '')) !== ''
            ? 'fetch_notification_by_id'
            : (!empty($params['includeAll']) ? 'list_notifications_all' : 'list_notifications');

        $payload = [];
        if ($action === 'fetch_notification_by_id') {
            $payload['id'] = trim((string) ($params['id'] ?? ''));
        } else {
            $payload['targetRoles'] = $params['targetRoles'] ?? [];
        }
        $userId = trim((string) ($params['userId'] ?? $params['user_id'] ?? ''));
        if ($userId !== '') {
            $payload['userId'] = $userId;
        }

        $response = $this->centralLicenseRequest($apiUrl, $ownerToken, $action, $payload);
        if ($action === 'fetch_notification_by_id') {
            if (!is_array($response['notification'])) {
                return [];
            }
            return [ $response['notification'] ];
        }

        if (!is_array($response['notifications'])) {
            return [];
        }

        return array_values(array_filter($response['notifications'], static fn($item): bool => is_array($item)));
    }

    private function syncCentralNotifications(array $targetRoles = []): void
    {
        if (!$this->tableExists('notifications')) {
            return;
        }

        $settingsRow = $this->capabilityRow();
        $apiUrl = trim((string) ($settingsRow['license_api_url'] ?? ''));
        if ($apiUrl === '') {
            return;
        }

        try {
            $notifications = $this->fetchCentralNotifications(['targetRoles' => $targetRoles]);
        } catch (Throwable $e) {
            return;
        }

        $remoteIds = [];
        foreach ($notifications as $notification) {
            if (!is_array($notification)) {
                continue;
            }
            $remoteIds[] = trim((string) ($notification['id'] ?? ''));
            if ($remoteIds[count($remoteIds) - 1] === '') {
                array_pop($remoteIds);
                continue;
            }
            $this->upsertCentralNotificationLocally($notification);
        }

        $roleNeedle = '%"' . trim((string) ($targetRoles[0] ?? '')) . '"%';
        if ($roleNeedle !== '%""%') {
            if ($remoteIds !== []) {
                [$placeholders, $bindings] = $this->inClause($remoteIds, 'notification_id');
                $this->database->execute(
                    'UPDATE notifications
                     SET is_active = 0, updated_at = :updated_at
                     WHERE system_key LIKE :central_key
                       AND target_roles LIKE :role_needle
                       AND id NOT IN (' . implode(', ', $placeholders) . ')',
                    array_merge([':central_key' => 'central:%', ':role_needle' => $roleNeedle, ':updated_at' => $this->database->nowUtc()], $bindings)
                );
            } else {
                $this->database->execute(
                    'UPDATE notifications
                     SET is_active = 0, updated_at = :updated_at
                     WHERE system_key LIKE :central_key
                       AND target_roles LIKE :role_needle',
                    [':central_key' => 'central:%', ':role_needle' => $roleNeedle, ':updated_at' => $this->database->nowUtc()]
                );
            }
        }
    }

    private function upsertCentralNotificationLocally(array $notification): void
    {
        $id = trim((string) ($notification['id'] ?? ''));
        if ($id === '' || !$this->tableExists('notifications')) {
            return;
        }

        $subject = trim((string) ($notification['subject'] ?? ''));
        $contentHtml = trim((string) ($notification['contentHtml'] ?? $notification['content_html'] ?? ''));
        $targetRoles = $this->normalizeNotificationTargetRoles($notification['targetRoles'] ?? $notification['target_roles'] ?? []);
        $startsAt = $this->nullableString($notification['startsAt'] ?? $notification['starts_at'] ?? null);
        $endsAt = $this->nullableString($notification['endsAt'] ?? $notification['ends_at'] ?? null);
        $actionConfig = is_array($notification['actionConfig'] ?? null) ? $notification['actionConfig'] : $this->jsonDecodeAssoc($notification['actionConfig'] ?? $notification['action_config'] ?? []);
        $metadata = is_array($notification['metadata'] ?? null) ? $notification['metadata'] : $this->jsonDecodeAssoc($notification['metadata'] ?? []);

        if ($subject === '' || $contentHtml === '' || $targetRoles === []) {
            return;
        }

        $now = $this->database->nowUtc();
        $this->database->execute(
            'INSERT INTO notifications (
                id, system_key, subject, content_html, target_roles, starts_at, ends_at,
                action_config, metadata, created_by, is_active, is_system_generated, created_at, updated_at
             ) VALUES (
                :id, :system_key, :subject, :content_html, :target_roles, :starts_at, :ends_at,
                :action_config, :metadata, NULL, 1, 0, :created_at, :updated_at
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
                ':id' => $id,
                ':system_key' => 'central:' . $id,
                ':subject' => $subject,
                ':content_html' => $contentHtml,
                ':target_roles' => $this->jsonEncode($targetRoles),
                ':starts_at' => $startsAt,
                ':ends_at' => $endsAt,
                ':action_config' => $this->jsonEncode($actionConfig),
                ':metadata' => $this->jsonEncode($metadata),
                ':created_at' => $this->normalizeDateTimeInput($notification['createdAt'] ?? $notification['created_at'] ?? $now),
                ':updated_at' => $this->normalizeDateTimeInput($notification['updatedAt'] ?? $notification['updated_at'] ?? $now),
            ]
        );
    }

    private function mapCentralNotification(array $notification): array
    {
        $mapped = $this->mapNotification($notification);
        $id = trim((string) ($mapped['id'] ?? $notification['id'] ?? ''));
        if ($id !== '' && trim((string) ($mapped['systemKey'] ?? '')) === '') {
            $mapped['systemKey'] = 'central:' . $id;
        }

        return $mapped;
    }

    private function storeResolvedLicensePayload(array $payload, string $apiUrl, $ownerToken, string $message): array
    {
        $licenseKey = trim((string) ($payload['license_key'] ?? $payload['licenseKey'] ?? ''));
        $pricingMetadata = is_array($payload['pricing_metadata'] ?? null)
            ? $payload['pricing_metadata']
            : (is_array($payload['pricingMetadata'] ?? null) ? $payload['pricingMetadata'] : []);
        $existingRow = $this->capabilityRow();
        $existingPricingMetadata = $this->normalizePricingMetadata($this->jsonDecodeAssoc($existingRow['pricing_metadata'] ?? null));
        if ($pricingMetadata === [] && $existingPricingMetadata !== []) {
            $pricingMetadata = $existingPricingMetadata;
        }

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
            'piprapayWebhookUrl' => (string) ($row['piprapay_webhook_url'] ?? ''),
        ];
    }

    public function fetchLlmSettings(array $params = []): array
    {
        $this->requireDeveloperUser();
        $assignments = [
            'information_extraction' => null,
            'mame_ai' => null,
            'business_growth' => null,
        ];
        if (!$this->tableExists('llm_configurations') || !$this->tableExists('llm_feature_assignments')) {
            return ['configurations' => [], 'assignments' => $assignments];
        }

        $client = new LlmClient($this->database, $this->config);
        $configurations = array_map(
            static fn(array $row): array => $client->mapConfiguration($row),
            $this->database->fetchAll('SELECT * FROM llm_configurations ORDER BY label ASC, created_at ASC')
        );
        foreach ($this->database->fetchAll('SELECT feature_key, configuration_id FROM llm_feature_assignments') as $row) {
            $feature = (string) ($row['feature_key'] ?? '');
            if (array_key_exists($feature, $assignments)) {
                $value = trim((string) ($row['configuration_id'] ?? ''));
                $assignments[$feature] = $value !== '' ? $value : null;
            }
        }

        return ['configurations' => $configurations, 'assignments' => $assignments];
    }

    public function updateLlmSettings(array $params): array
    {
        $this->requireDeveloperUser();
        if (!$this->tableExists('llm_configurations') || !$this->tableExists('llm_feature_assignments')) {
            throw new RuntimeException('LLM settings tables are missing. Run the latest database update first.');
        }

        $rows = is_array($params['configurations'] ?? null) ? array_values($params['configurations']) : [];
        if (count($rows) > 100) throw new ApiException('You can save up to 100 LLM configurations.', 422);
        $client = new LlmClient($this->database, $this->config);
        $configurations = [];
        $ids = [];
        foreach ($rows as $row) {
            if (!is_array($row)) continue;
            $config = $client->normalizeConfiguration($row);
            $id = trim((string) ($config['id'] ?? '')) ?: $this->uuid4();
            if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id)) throw new ApiException('An LLM configuration has an invalid id.', 422);
            if (array_key_exists($id, $ids)) throw new ApiException('Duplicate LLM configuration id.', 422);
            if ($config['label'] === '') throw new ApiException('Every LLM configuration needs a name.', 422);
            if ($config['apiKey'] === '') throw new ApiException($config['label'] . ' needs an API key.', 422);
            if ($config['model'] === '') throw new ApiException($config['label'] . ' needs a model.', 422);
            $config['id'] = $id;
            $configurations[] = $config;
            $ids[$id] = (bool) $config['enabled'];
        }

        $submittedAssignments = is_array($params['assignments'] ?? null) ? $params['assignments'] : [];
        $assignments = [];
        foreach (LlmClient::features() as $feature) {
            $configurationId = trim((string) ($submittedAssignments[$feature] ?? ''));
            if ($configurationId !== '' && !array_key_exists($configurationId, $ids)) {
                throw new ApiException('The selected model for ' . str_replace('_', ' ', $feature) . ' does not exist.', 422);
            }
            if ($configurationId !== '' && !$ids[$configurationId]) {
                throw new ApiException('The selected model for ' . str_replace('_', ' ', $feature) . ' is disabled.', 422);
            }
            $assignments[$feature] = $configurationId !== '' ? $configurationId : null;
        }

        $this->database->transaction(function () use ($configurations, $ids, $assignments): void {
            foreach ($configurations as $config) {
                $this->database->execute(
                    'INSERT INTO llm_configurations (
                        id, label, provider, enabled, base_url, api_key, model, organization, project,
                        site_url, app_name, anthropic_version, created_at, updated_at
                     ) VALUES (
                        :id, :label, :provider, :enabled, :base_url, :api_key, :model, :organization, :project,
                        :site_url, :app_name, :anthropic_version, :created_at, :updated_at
                     ) ON DUPLICATE KEY UPDATE
                        label = VALUES(label), provider = VALUES(provider), enabled = VALUES(enabled),
                        base_url = VALUES(base_url), api_key = VALUES(api_key), model = VALUES(model),
                        organization = VALUES(organization), project = VALUES(project), site_url = VALUES(site_url),
                        app_name = VALUES(app_name), anthropic_version = VALUES(anthropic_version), updated_at = VALUES(updated_at)',
                    [
                        ':id' => $config['id'],
                        ':label' => $config['label'],
                        ':provider' => $config['provider'],
                        ':enabled' => $config['enabled'] ? 1 : 0,
                        ':base_url' => $config['baseUrl'],
                        ':api_key' => $config['apiKey'],
                        ':model' => $config['model'],
                        ':organization' => $this->nullableString($config['organization']),
                        ':project' => $this->nullableString($config['project']),
                        ':site_url' => $this->nullableString($config['siteUrl']),
                        ':app_name' => $this->nullableString($config['appName']),
                        ':anthropic_version' => $config['anthropicVersion'],
                        ':created_at' => $this->database->nowUtc(),
                        ':updated_at' => $this->database->nowUtc(),
                    ]
                );
            }

            if ($ids === []) {
                $this->database->execute('DELETE FROM llm_configurations');
            } else {
                $bindings = [];
                $placeholders = [];
                foreach (array_keys($ids) as $index => $id) {
                    $key = ':llm_keep_' . $index;
                    $placeholders[] = $key;
                    $bindings[$key] = $id;
                }
                $this->database->execute('DELETE FROM llm_configurations WHERE id NOT IN (' . implode(', ', $placeholders) . ')', $bindings);
            }

            foreach ($assignments as $feature => $configurationId) {
                $this->database->execute(
                    'INSERT INTO llm_feature_assignments (feature_key, configuration_id, created_at, updated_at)
                     VALUES (:feature_key, :configuration_id, :created_at, :updated_at)
                     ON DUPLICATE KEY UPDATE configuration_id = VALUES(configuration_id), updated_at = VALUES(updated_at)',
                    [
                        ':feature_key' => $feature,
                        ':configuration_id' => $configurationId,
                        ':created_at' => $this->database->nowUtc(),
                        ':updated_at' => $this->database->nowUtc(),
                    ]
                );
            }
        });

        return $this->fetchLlmSettings();
    }

    public function discoverLlmModels(array $params): array
    {
        $this->requireDeveloperUser();
        $configuration = is_array($params['configuration'] ?? null) ? $params['configuration'] : $params;
        $models = (new LlmClient($this->database, $this->config))->discoverModels($configuration);
        return ['models' => $models];
    }

    public function fetchBeSmartSettings(array $params = []): array
    {
        $this->currentUser();
        $row = $this->tableExists('be_smart_settings')
            ? $this->database->fetchOne('SELECT * FROM be_smart_settings LIMIT 1')
            : null;
        return [
            'smartCustomerAdding' => !empty($row['smart_customer_adding'] ?? false),
            'smartVendorAdding' => !empty($row['smart_vendor_adding'] ?? false),
        ];
    }

    public function updateBeSmartSettings(array $params): array
    {
        $this->requireAdmin();
        if (!$this->tableExists('be_smart_settings')) {
            throw new RuntimeException('Be smart settings are missing. Run the latest database update first.');
        }
        return $this->saveSingleton(
            'be_smart_settings',
            'be-smart-default',
            [
                'smart_customer_adding' => !empty($params['smartCustomerAdding']) ? 1 : 0,
                'smart_vendor_adding' => !empty($params['smartVendorAdding']) ? 1 : 0,
            ],
            fn(): array => $this->fetchBeSmartSettings()
        );
    }

    public function fetchAgentSettings(array $params = []): array
    {
        $this->requireDeveloperUser();
        $row = $this->tableExists('agent_settings')
            ? $this->database->fetchOne('SELECT * FROM agent_settings LIMIT 1')
            : null;

        return [
            'enabled' => !empty($row['enabled'] ?? 0),
            'showReasoningSummaries' => !empty($row['show_reasoning_summaries'] ?? 1),
            'showToolActivity' => !empty($row['show_tool_activity'] ?? 1),
            'maxReasoningSteps' => max(1, (int) ($row['max_reasoning_steps'] ?? 8)),
            'maxToolCalls' => max(1, (int) ($row['max_tool_calls'] ?? 12)),
            'queryRowLimit' => max(1, (int) ($row['query_row_limit'] ?? 100)),
            'queryTimeoutMs' => max(1000, (int) ($row['query_timeout_ms'] ?? 15000)),
        ];
    }

    public function updateAgentSettings(array $params): array
    {
        $this->requireDeveloperUser();
        if (!$this->tableExists('agent_settings')) {
            throw new RuntimeException('Agent settings table is missing. Run the latest migration first.');
        }

        $payload = [
            'enabled' => !empty($params['enabled'] ?? false) ? 1 : 0,
            'show_reasoning_summaries' => !empty($params['showReasoningSummaries'] ?? true) ? 1 : 0,
            'show_tool_activity' => !empty($params['showToolActivity'] ?? true) ? 1 : 0,
            'max_reasoning_steps' => max(1, (int) ($params['maxReasoningSteps'] ?? 8)),
            'max_tool_calls' => max(1, (int) ($params['maxToolCalls'] ?? 12)),
            'query_row_limit' => max(1, (int) ($params['queryRowLimit'] ?? 100)),
            'query_timeout_ms' => max(1000, (int) ($params['queryTimeoutMs'] ?? 15000)),
        ];

        $this->saveSingleton('agent_settings', 'agent-settings-default', $payload, fn(): array => $this->fetchAgentSettings());
        return $this->fetchAgentSettings();
    }

    public function fetchBusinessGrowthSettings(array $params = []): array
    {
        $this->requireDeveloperUser();
        $row = $this->tableExists('business_growth_settings')
            ? $this->database->fetchOne('SELECT * FROM business_growth_settings LIMIT 1')
            : null;

        return [
            'recommendationCacheHours' => max(1, (int) ($row['recommendation_cache_hours'] ?? 6)),
        ];
    }

    public function updateBusinessGrowthSettings(array $params): array
    {
        $this->requireDeveloperUser();
        if (!$this->tableExists('business_growth_settings')) {
            throw new RuntimeException('Business growth settings table is missing. Run the latest migration first.');
        }

        $payload = [
            'recommendation_cache_hours' => max(1, (int) ($params['recommendationCacheHours'] ?? 6)),
        ];

        $this->saveSingleton('business_growth_settings', 'business-growth-default', $payload, fn(): array => $this->fetchBusinessGrowthSettings());
        return $this->fetchBusinessGrowthSettings();
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
            'piprapay_webhook_url' => $this->nullableString($params['piprapayWebhookUrl'] ?? null),
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
            'activeUsers' => $count('users', 'WHERE deleted_at IS NULL AND COALESCE(is_system, 0) = 0'),
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
        if (!is_array($gateway)) {
            // Create a default entry if none exists
            $defaultId = $this->uuid4();
            $this->database->execute(
                'INSERT INTO payment_gateway_settings (id) VALUES (:id)',
                [':id' => $defaultId]
            );
            $gateway = $this->database->fetchOne('SELECT * FROM payment_gateway_settings LIMIT 1');
            if (!is_array($gateway)) {
                throw new RuntimeException('Failed to initialize PipraPay gateway settings.');
            }
        }
        $gatewayBaseUrl = trim((string) ($gateway['piprapay_base_url'] ?? ''));
        $gatewayBaseUrl = rtrim($gatewayBaseUrl, '/');
        $baseUrl = $gatewayBaseUrl;
        $apiKey = trim((string) ($gateway['piprapay_api_key'] ?? ''));
        if ($baseUrl === '' || $apiKey === '') {
            throw new RuntimeException('PipraPay gateway is not configured yet. Please add the base URL and API key in Developer Settings > Payment Gateway.');
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
        $existingPayment = $this->database->fetchOne(
            "SELECT status FROM service_subscription_payments WHERE billing_version = :billing_version AND status IN ('processing', 'approved') ORDER BY submitted_at DESC LIMIT 1",
            [':billing_version' => $billingVersion]
        );
        if ($existingPayment !== null) {
            $existingStatus = strtolower((string) ($existingPayment['status'] ?? 'processing'));
            throw new RuntimeException($existingStatus === 'approved'
                ? 'This subscription period has already been paid.'
                : 'A subscription payment is already processing.');
        }
        $reference = 'SUB-' . strtoupper(substr($this->uuid4(), 0, 12));

        $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
        $forwardedProto = strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0]));
        $scheme = $forwardedProto === 'https' || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $returnBase = $scheme . '://' . $host;
        $metadataArray = [
            'local_reference' => $reference,
            'billing_interval' => $interval,
            'billing_version' => (string) $billingVersion,
            'license_key' => (string) (($capabilitySettings['licenseKey'] ?? '') ?: ''),
            'tier_key' => (string) (($capabilitySettings['tierKey'] ?? '') ?: ''),
            'plan_name' => (string) (($capabilitySettings['planName'] ?? '') ?: ''),
            'payment_datetime' => gmdate('c'),
            'payment_period' => $interval,
            'domain' => $host,
        ];
        $configuredWebhookUrl = trim((string) ($gateway['piprapay_webhook_url'] ?? ''));
        if ($configuredWebhookUrl === '') {
            $configuredWebhookUrl = $returnBase . '/api/?action=handlePipraPayIpn';
        }
        $configuredReturnUrl = trim((string) ($gateway['piprapay_return_url'] ?? ''));
        if ($configuredReturnUrl === '') {
            $configuredReturnUrl = $returnBase . '/#/subscriptions';
        } elseif (strpos($configuredReturnUrl, '#') === false) {
            $configuredReturnUrl = preg_replace('#(/subscriptions/?)(\?.*)?$#', '/#\1$2', $configuredReturnUrl);
        }
        $configuredReturnUrl = $this->appendUrlQueryParameter($configuredReturnUrl, 'reference', $reference);

        $payload = [
            'full_name' => (string) ($user['name'] ?? 'Admin'),
            'email_address' => (string) (($user['email'] ?? null) ?: 'admin@example.com'),
            'mobile_number' => (string) (($user['phone'] ?? null) ?: '01700000000'),
            'amount' => number_format(round($amount, 2), 2, '.', ''),
            'currency' => 'BDT',
            'metadata' => json_encode($metadataArray),
            'return_url' => $configuredReturnUrl,
            'webhook_url' => $configuredWebhookUrl,
        ];

        $response = $this->httpJson('POST', $this->pipraPayApiUrl($baseUrl, 'checkout/redirect'), [
            'MHS-PIPRAPAY-API-KEY' => $apiKey,
            'Accept' => 'application/json',
        ], $payload);
        if ($response['status'] < 200 || $response['status'] >= 300 || !is_array($response['json'])) {
            $details = [
                'status' => $response['status'] ?? 'unknown',
                'baseUrl' => $baseUrl,
                'apiKeySet' => !empty($apiKey),
                'response' => $response['json'] ?? $response['body'] ?? 'no response body',
            ];
            throw new RuntimeException('PipraPay checkout initialization failed: ' . $this->jsonEncode($details));
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
        $reference = trim((string) ($params['reference'] ?? $params['transaction_ref'] ?? $params['transaction_reference'] ?? $params['localReference'] ?? $params['local_reference'] ?? ''));
        $eventId = trim((string) ($params['pp_id'] ?? $params['payment_id'] ?? $params['transaction_id'] ?? $params['order_id'] ?? ''));
        if ($eventId === '' && $reference !== '' && $this->tableExists('service_subscription_payments')) {
            $payment = $this->database->fetchOne(
                'SELECT gateway_payment_id FROM service_subscription_payments WHERE local_reference = :reference OR transaction_id = :transaction_reference OR gateway_payment_id = :gateway_reference LIMIT 1',
                [
                    ':reference' => $reference,
                    ':transaction_reference' => $reference,
                    ':gateway_reference' => $reference,
                ]
            );
            $eventId = trim((string) ($payment['gateway_payment_id'] ?? ''));
        }

        $paymentState = 'processing';
        if ($eventId !== '') {
            try {
                $result = $this->verifyAndApplyPipraPayPayment($eventId, $reference, $params);
                $paymentOutcome = (string) ($result['paymentOutcome'] ?? '');
                $paymentState = $paymentOutcome === 'completed'
                    ? 'success'
                    : (in_array($paymentOutcome, ['canceled', 'cancelled'], true) ? 'cancelled' : (in_array($paymentOutcome, ['failed', 'unknown'], true) ? 'failed' : 'processing'));
                $reference = trim((string) ($result['reference'] ?? $reference));
            } catch (\Throwable $exception) {
                $paymentState = 'processing';
            }
        }

        $host = (string) ($_SERVER['HTTP_HOST'] ?? '');
        $forwardedProto = strtolower(trim(explode(',', (string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''))[0]));
        $scheme = $forwardedProto === 'https' || (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $base = $scheme . '://' . $host;

        $qs = '?payment=' . $paymentState;
        if ($reference !== '') {
            $qs .= '&reference=' . rawurlencode($reference);
        }
        if ($eventId !== '') {
            $qs .= '&pp_id=' . rawurlencode($eventId);
        }
        header('Location: ' . $base . '/#/subscriptions' . $qs);
        exit;
    }

    public function verifyPipraPayPayment(array $params = []): array
    {
        $user = $this->currentUser();
        if (!$this->hasAdminAccess((string) ($user['role'] ?? ''))) {
            throw new ApiException('Admin access required.', 403, 'ADMIN_ACCESS_REQUIRED');
        }

        $eventId = trim((string) ($params['ppId'] ?? $params['pp_id'] ?? $params['paymentId'] ?? $params['payment_id'] ?? $params['transaction_id'] ?? $params['order_id'] ?? ''));
        $reference = trim((string) ($params['reference'] ?? $params['transaction_ref'] ?? $params['transaction_reference'] ?? $params['localReference'] ?? $params['local_reference'] ?? ''));
        if ($eventId === '' && $reference !== '') {
            $payment = null;
            if ($this->tableExists('auto_calling_recharges')) {
                $payment = $this->database->fetchOne(
                    'SELECT gateway_payment_id FROM auto_calling_recharges WHERE local_reference = :reference OR gateway_payment_id = :gateway_reference LIMIT 1',
                    [':reference' => $reference, ':gateway_reference' => $reference]
                );
            }
            if ($payment === null && $this->tableExists('service_subscription_payments')) {
                $payment = $this->database->fetchOne(
                    'SELECT gateway_payment_id FROM service_subscription_payments WHERE local_reference = :reference OR transaction_id = :transaction_reference OR gateway_payment_id = :gateway_reference LIMIT 1',
                    [
                        ':reference' => $reference,
                        ':transaction_reference' => $reference,
                        ':gateway_reference' => $reference,
                    ]
                );
            }
            $eventId = trim((string) ($payment['gateway_payment_id'] ?? ''));
        }
        if ($eventId === '') {
            throw new RuntimeException('PipraPay payment id is required for verification.');
        }

        return $this->verifyAndApplyPipraPayPayment($eventId, $reference, $params);
    }

    public function handlePipraPayIpn(array $params = []): array
    {
        $eventId = trim((string) ($params['pp_id'] ?? $params['payment_id'] ?? $params['transaction_id'] ?? $params['order_id'] ?? ''));
        $rawMetadata = $params['metadata'] ?? null;
        $metadata = is_array($rawMetadata) ? $rawMetadata : (is_string($rawMetadata) ? (json_decode($rawMetadata, true) ?: []) : []);
        $reference = trim((string) ($metadata['local_reference'] ?? $params['order_id'] ?? $params['local_reference'] ?? ''));

        if ($eventId === '') {
            return ['success' => false, 'message' => 'Missing PipraPay payment id.'];
        }

        return $this->verifyAndApplyPipraPayPayment($eventId, $reference, $params);
    }

    private function verifyAndApplyPipraPayPayment(string $eventId, string $reference = '', array $rawPayload = []): array
    {
        $gateway = $this->tableExists('payment_gateway_settings')
            ? $this->database->fetchOne('SELECT * FROM payment_gateway_settings LIMIT 1')
            : null;
        $apiKey = trim((string) ($gateway['piprapay_api_key'] ?? ''));
        $gatewayBaseUrl = trim((string) ($gateway['piprapay_base_url'] ?? ''));
        $gatewayBaseUrl = rtrim($gatewayBaseUrl, '/');
        $baseUrl = $gatewayBaseUrl;
        $eventId = trim($eventId);
        $reference = trim($reference);
        if ($baseUrl === '' || $apiKey === '') {
            throw new RuntimeException('PipraPay gateway is not configured yet.');
        }
        if ($eventId === '') {
            throw new RuntimeException('PipraPay payment id is required for verification.');
        }

        $verify = $this->httpJson('POST', $this->pipraPayApiUrl($baseUrl, 'verify-payment'), [
            'MHS-PIPRAPAY-API-KEY' => $apiKey,
            'Accept' => 'application/json',
        ], ['pp_id' => $eventId]);
        if ($verify['status'] < 200 || $verify['status'] >= 300 || !is_array($verify['json'])) {
            throw new RuntimeException('PipraPay verification failed.');
        }

        $verified = $this->normalizePipraPayVerificationPayload($verify['json']);
        $status = strtolower(trim((string) ($verified['status'] ?? '')));
        $trustedReference = trim((string) ($verified['reference'] ?? ''));
        $verifiedPaymentId = trim((string) ($verified['paymentId'] ?? ''));
        if ($verifiedPaymentId !== '' && !hash_equals($eventId, $verifiedPaymentId)) {
            throw new RuntimeException('PipraPay verification returned a different payment id.');
        }

        $paymentOutcome = 'pending';
        $databaseStatus = 'processing';
        $paymentMessage = 'Payment is still pending verification.';
        if (in_array($status, ['completed', 'complete', 'success', 'successful', 'paid'], true)) {
            $paymentOutcome = 'completed';
            $databaseStatus = 'approved';
            $paymentMessage = 'Payment verified successfully. Your subscription has been renewed.';
        } elseif (in_array($status, ['pending', 'processing', 'initiated', 'unpaid', 'awaiting_payment', 'awaiting payment'], true) || $status === '') {
            $paymentOutcome = 'pending';
            $databaseStatus = 'processing';
            $paymentMessage = 'Payment is still pending verification.';
        } elseif (in_array($status, ['failed', 'failure', 'declined', 'expired'], true)) {
            $paymentOutcome = 'failed';
            $databaseStatus = 'failed';
            $paymentMessage = 'Payment failed. Please try again or use a different payment method.';
        } elseif (in_array($status, ['cancelled', 'canceled'], true)) {
            $paymentOutcome = 'canceled';
            $databaseStatus = 'canceled';
            $paymentMessage = 'Payment was cancelled by the user. No charges were made.';
        } elseif ($status !== '') {
            $paymentOutcome = 'unknown';
            $databaseStatus = 'error';
            $paymentMessage = 'Something went wrong while verifying the payment. Please contact the Mame Studios team for assistance.';
        }

        $isSuccess = $paymentOutcome === 'completed';
        $isFailure = in_array($paymentOutcome, ['failed', 'canceled', 'unknown'], true);
        $applyResult = $this->database->transaction(function () use (
            $eventId,
            $trustedReference,
            $status,
            $databaseStatus,
            $isSuccess,
            $isFailure,
            $verified,
            $rawPayload,
            $verify
        ): array {
            $metadata = is_array($verified['metadata'] ?? null) ? $verified['metadata'] : [];
            $declaredType = strtolower(trim((string) ($metadata['type'] ?? '')));
            $subscriptionBindings = [':gateway_event_id' => $eventId, ':transaction_event_id' => $eventId];
            $subscriptionConditions = '(gateway_payment_id = :gateway_event_id OR transaction_id = :transaction_event_id)';
            $rechargeBindings = [':recharge_event_id' => $eventId];
            $rechargeConditions = 'gateway_payment_id = :recharge_event_id';
            if ($trustedReference !== '') {
                $subscriptionConditions .= ' OR local_reference = :subscription_reference';
                $subscriptionBindings[':subscription_reference'] = $trustedReference;
                $rechargeConditions .= ' OR local_reference = :recharge_reference';
                $rechargeBindings[':recharge_reference'] = $trustedReference;
            }

            $recharge = null;
            if ($this->tableExists('auto_calling_recharges')) {
                $recharge = $this->database->fetchOne(
                    "SELECT * FROM auto_calling_recharges WHERE {$rechargeConditions} LIMIT 1 FOR UPDATE",
                    $rechargeBindings
                );
            }
            $subscription = $this->tableExists('service_subscription_payments')
                ? $this->database->fetchOne(
                    "SELECT * FROM service_subscription_payments WHERE {$subscriptionConditions} LIMIT 1 FOR UPDATE",
                    $subscriptionBindings
                )
                : null;

            $kind = $declaredType === 'auto_calling_recharge' || str_starts_with($trustedReference, 'RCH-')
                ? 'recharge'
                : 'subscription';
            $payment = $kind === 'recharge' ? $recharge : $subscription;
            if ($payment === null) {
                $kind = $recharge !== null ? 'recharge' : 'subscription';
                $payment = $recharge ?? $subscription;
            }
            if ($payment === null) {
                throw new RuntimeException('Verified PipraPay payment does not match a local checkout.');
            }

            $expectedReference = trim((string) ($payment['local_reference'] ?? ''));
            if ($trustedReference !== '' && $expectedReference !== '' && !hash_equals($expectedReference, $trustedReference)) {
                throw new RuntimeException('PipraPay payment reference does not match the local checkout.');
            }
            $verifiedAmount = $verified['amount'] ?? null;
            if ($verifiedAmount !== null && abs((float) $verifiedAmount - (float) ($payment['amount'] ?? 0)) > 0.009) {
                throw new RuntimeException('PipraPay payment amount does not match the local checkout.');
            }
            $verifiedCurrency = strtoupper(trim((string) ($verified['currency'] ?? '')));
            if ($verifiedCurrency !== '' && $verifiedCurrency !== 'BDT') {
                throw new RuntimeException('PipraPay payment currency does not match the local checkout.');
            }

            $previousStatus = strtolower(trim((string) ($payment['status'] ?? 'processing')));
            $nextStatus = $isSuccess ? 'approved' : ($isFailure ? $databaseStatus : $previousStatus);
            $newlyApproved = $isSuccess && $previousStatus !== 'approved';
            $processedAt = $isSuccess || $isFailure ? $this->database->nowUtc() : ($payment['processed_at'] ?? null);
            $storedPayload = $this->jsonEncode(['webhook' => $rawPayload, 'verified' => $verify['json']]);

            if ($kind === 'recharge') {
                $this->touchUpdate('auto_calling_recharges', (string) $payment['id'], [
                    'gateway_payment_id' => $eventId,
                    'status' => $nextStatus,
                    'processed_at' => $processedAt,
                    'raw_payload' => $storedPayload,
                ]);
            } else {
                $this->touchUpdate('service_subscription_payments', (string) $payment['id'], [
                    'gateway_payment_id' => $eventId,
                    'transaction_id' => $eventId,
                    'status' => $nextStatus,
                    'processed_at' => $processedAt,
                    'raw_payload' => $storedPayload,
                ]);
                if ($newlyApproved) {
                    $this->extendSubscriptionFromPayment($payment);
                }
            }

            if ($this->tableExists('payment_webhook_logs')) {
                $this->database->execute(
                    'INSERT INTO payment_webhook_logs (id, gateway, event_id, local_reference, status, verified, raw_payload, created_at)
                     VALUES (:id, :gateway, :event_id, :local_reference, :status, :verified, :raw_payload, :created_at)
                     ON DUPLICATE KEY UPDATE local_reference = VALUES(local_reference), status = VALUES(status), verified = VALUES(verified), raw_payload = VALUES(raw_payload)',
                    [
                        ':id' => $this->uuid4(),
                        ':gateway' => 'piprapay',
                        ':event_id' => $eventId,
                        ':local_reference' => $expectedReference ?: null,
                        ':status' => $status ?: null,
                        ':verified' => $isSuccess ? 1 : 0,
                        ':raw_payload' => $storedPayload,
                        ':created_at' => $this->database->nowUtc(),
                    ]
                );
            }

            return [
                'kind' => $kind,
                'payment' => $payment,
                'reference' => $expectedReference,
                'newlyApproved' => $newlyApproved,
            ];
        });

        $paymentKind = (string) $applyResult['kind'];
        $reference = (string) $applyResult['reference'];
        $emailSent = false;
        if ($isSuccess && (bool) $applyResult['newlyApproved']) {
            $emailSent = $this->sendPaymentConfirmationEmail($paymentKind, $applyResult['payment'], $reference, $eventId);
        }
        if ($isSuccess && $paymentKind === 'recharge') {
            $paymentMessage = 'Recharge payment verified. The balance top-up request is ready for processing.';
        }

        return [
            'success' => true,
            'paid' => $isSuccess,
            'status' => $status,
            'paymentOutcome' => $paymentOutcome,
            'paymentStatus' => $databaseStatus,
            'message' => $paymentMessage,
            'reference' => $reference,
            'paymentFound' => true,
            'paymentKind' => $paymentKind,
            'emailSent' => $emailSent,
        ];
    }

    private function normalizePipraPayVerificationPayload(array $payload): array
    {
        $data = is_array($payload['data'] ?? null) ? $payload['data'] : $payload;
        $metadataRaw = $data['metadata'] ?? $payload['metadata'] ?? null;
        $metadata = is_array($metadataRaw) ? $metadataRaw : (is_string($metadataRaw) ? (json_decode($metadataRaw, true) ?: []) : []);

        $statusValue = $data['status'] ?? $data['payment_status'] ?? $payload['status'] ?? $payload['payment_status'] ?? $data['pp_status'] ?? $payload['pp_status'] ?? '';
        $status = is_bool($statusValue)
            ? ($statusValue ? 'completed' : 'failed')
            : strtolower(trim((string) $statusValue));
        $reference = trim((string) (
            $metadata['local_reference'] ??
            $data['order_id'] ??
            $data['transaction_ref'] ??
            $data['transaction_reference'] ??
            $payload['order_id'] ??
            $payload['transaction_ref'] ??
            $payload['transaction_reference'] ??
            $metadata['transaction_ref'] ??
            $metadata['transaction_reference'] ??
            ''
        ));

        return [
            'status' => $status,
            'paymentId' => trim((string) ($data['pp_id'] ?? $payload['pp_id'] ?? '')),
            'reference' => $reference,
            'metadata' => $metadata,
            'amount' => isset($data['amount']) && is_numeric($data['amount'])
                ? (float) $data['amount']
                : (isset($data['paid_amount']) && is_numeric($data['paid_amount'])
                    ? (float) $data['paid_amount']
                    : (isset($data['charged_amount']) && is_numeric($data['charged_amount']) ? (float) $data['charged_amount'] : null)),
            'currency' => strtoupper(trim((string) ($data['currency'] ?? $payload['currency'] ?? ''))),
        ];
    }

    public function mameChat(array $params): array
    {
        $this->currentUser();

        $message = trim((string) ($params['message'] ?? ''));
        if ($message === '') {
            throw new ApiException('Message cannot be empty.', 400);
        }

        $executor = new AgentExecutor($this->database, $this->auth, $this->config);
        $run = $executor->startRun(['message' => $message, 'conversationId' => (string) ($params['conversationId'] ?? '')]);

        // Process synchronously
        if (!empty($run['runId']) && ($run['status'] ?? '') === 'queued') {
            try {
                $result = $executor->processQueuedRun(['runId' => $run['runId']]);
                return [
                    'answer' => (string) ($result['answer'] ?? ''),
                    'runId' => (string) ($run['runId'] ?? ''),
                    'conversationId' => (string) ($run['conversationId'] ?? ''),
                    'streamToken' => (string) ($run['streamToken'] ?? ''),
                    'status' => (string) ($result['status'] ?? 'completed'),
                ];
            } catch (\Throwable $ex) {
                return [
                    'answer' => 'I could not complete the analysis. Please try again.',
                    'runId' => (string) ($run['runId'] ?? ''),
                    'conversationId' => (string) ($run['conversationId'] ?? ''),
                    'streamToken' => (string) ($run['streamToken'] ?? ''),
                    'status' => 'failed',
                ];
            }
        }

        // Agent disabled or already completed
        return [
            'answer' => (string) ($run['answer'] ?? ''),
            'runId' => (string) ($run['runId'] ?? ''),
            'conversationId' => (string) ($run['conversationId'] ?? ''),
            'streamToken' => (string) ($run['streamToken'] ?? ''),
            'status' => (string) ($run['status'] ?? 'completed'),
        ];
    }

    public function agentRunStream(array $params): array
    {
        $this->currentUser();
        $executor = new AgentExecutor($this->database, $this->auth, $this->config);
        return $executor->fetchRunStream($params);
    }

    public function startAgentRun(array $params): array
    {
        $this->currentUser();
        $executor = new AgentExecutor($this->database, $this->auth, $this->config);
        return $executor->startRun($params);
    }

    public function fetchAgentRunStream(array $params): array
    {
        $this->currentUser();
        $executor = new AgentExecutor($this->database, $this->auth, $this->config);
        return $executor->fetchRunStream($params);
    }

    public function legacyMameChat(array $params): array
    {
        $this->currentUser();

        $message = trim((string) ($params['message'] ?? ''));
        if ($message === '') {
            throw new ApiException('Message cannot be empty.', 400);
        }

        $facts = $this->buildMameDatabaseFacts();
        $relevantRecords = $this->buildMameRelevantRecords($message);

        $systemMessage = <<<'TXT'
You are Mame, an exclusive AI assistant made by Mame Studios. Assist the user with business operations, customers, vendors, products, orders, bills, transactions, accounts, and settings.
Use only the facts provided below and the relevant database records section. Do not invent or hallucinate details not supported by the database summary or matching records. If the answer cannot be found in the provided facts, explain that it is not available and suggest a follow-up question.
If a write operation is requested, use the available tool actions only when the user explicitly asks to create or update data.
TXT;

        $prompt = "Business facts:\n" . implode("\n", $facts);
        if (!empty($relevantRecords)) {
            $prompt .= "\n\nRelevant database records:\n" . implode("\n", $relevantRecords);
        }

        $toolInstructions = $this->buildMameToolInstructions();
        if (!empty($toolInstructions)) {
            $prompt .= "\n\nAvailable tools:\n" . implode("\n", $toolInstructions);
        }

        $prompt .= "\n\nUser question:\n{$message}";

        try {
            $answer = (new LlmClient($this->database, $this->config))->generateForFeature(
                'mame_ai',
                $systemMessage,
                $prompt,
                [],
                ['temperature' => 0.3, 'maxTokens' => 4096]
            );
            return ['answer' => $this->maybeExecuteMameToolResponse($answer, $message)];
        } catch (\Throwable $exception) {
            throw new ApiException('Failed to generate Mame response: ' . $exception->getMessage(), 502);
        }
    }

    /**
     * @return string[]
     */
    private function buildMameDatabaseFacts(): array
    {
        $facts = [];

        $tables = $this->database->fetchAll(
            'SELECT TABLE_NAME
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
             ORDER BY TABLE_NAME ASC'
        );

        if (!empty($tables)) {
            $facts[] = 'Database tables and row counts:';
            foreach ($tables as $row) {
                $tableName = (string) ($row['TABLE_NAME'] ?? '');
                if ($tableName === '' || preg_match('/[^A-Za-z0-9_]/', $tableName) !== 0) {
                    continue;
                }

                try {
                    $quotedTable = $this->quoteIdentifier($tableName);
                    if ($this->columnExists($tableName, 'deleted_at')) {
                        $countRow = $this->database->fetchOne(
                            "SELECT COUNT(*) AS count FROM {$quotedTable} WHERE deleted_at IS NULL"
                        );
                    } else {
                        $countRow = $this->database->fetchOne(
                            "SELECT COUNT(*) AS count FROM {$quotedTable}"
                        );
                    }
                } catch (\Throwable $exception) {
                    continue;
                }

                $facts[] = sprintf(
                    '- %s: %s',
                    $tableName,
                    (int) ($countRow['count'] ?? 0)
                );
            }
        }

        if ($this->tableExists('orders')) {
            $recentOrders = $this->database->fetchAll(
                'SELECT o.order_number, o.status, o.created_at, c.name AS customer_name
                 FROM orders o
                 LEFT JOIN customers c ON c.id = o.customer_id
                 WHERE o.deleted_at IS NULL
                 ORDER BY o.created_at DESC
                 LIMIT 3'
            );
            if (!empty($recentOrders)) {
                $facts[] = 'Recent orders:';
                foreach ($recentOrders as $row) {
                    $facts[] = sprintf(
                        '- %s (%s) for %s',
                        (string) ($row['order_number'] ?? 'Unknown'),
                        (string) ($row['status'] ?? 'Unknown'),
                        $this->nullableString($row['customer_name']) ?? 'Unknown customer'
                    );
                }
            }
        }

        if ($this->tableExists('customers')) {
            $recentCustomers = $this->database->fetchAll(
                'SELECT name, phone, created_at
                 FROM customers
                 WHERE deleted_at IS NULL
                 ORDER BY created_at DESC
                 LIMIT 3'
            );
            if (!empty($recentCustomers)) {
                $facts[] = 'Recent customers:';
                foreach ($recentCustomers as $row) {
                    $facts[] = sprintf(
                        '- %s (%s)',
                        (string) ($row['name'] ?? 'Unknown'),
                        $this->nullableString($row['phone']) ?? 'No phone'
                    );
                }
            }
        }

        if ($this->tableExists('products')) {
            $recentProducts = $this->database->fetchAll(
                'SELECT name, sale_price, stock
                 FROM products
                 WHERE deleted_at IS NULL
                 ORDER BY created_at DESC
                 LIMIT 3'
            );
            if (!empty($recentProducts)) {
                $facts[] = 'Recent products:';
                foreach ($recentProducts as $row) {
                    $facts[] = sprintf(
                        '- %s (â‚¹%s, stock %s)',
                        (string) ($row['name'] ?? 'Unknown'),
                        (string) ($row['sale_price'] ?? '0'),
                        (string) ($row['stock'] ?? '0')
                    );
                }
            }
        }

        if ($this->tableExists('transactions')) {
            $recentTransactions = $this->database->fetchAll(
                'SELECT type, amount, created_at
                 FROM transactions
                 WHERE deleted_at IS NULL
                 ORDER BY created_at DESC
                 LIMIT 3'
            );
            if (!empty($recentTransactions)) {
                $facts[] = 'Recent transactions:';
                foreach ($recentTransactions as $row) {
                    $facts[] = sprintf(
                        '- %s %s',
                        (string) ($row['type'] ?? 'Unknown'),
                        (string) ($row['amount'] ?? '0')
                    );
                }
            }
        }

        if ($this->tableExists('bills')) {
            $recentBills = $this->database->fetchAll(
                'SELECT b.bill_number, b.status, b.bill_date, v.name AS vendor_name
                 FROM bills b
                 LEFT JOIN vendors v ON v.id = b.vendor_id
                 WHERE b.deleted_at IS NULL
                 ORDER BY b.bill_date DESC
                 LIMIT 3'
            );
            if (!empty($recentBills)) {
                $facts[] = 'Recent bills:';
                foreach ($recentBills as $row) {
                    $facts[] = sprintf(
                        '- %s (%s) for %s',
                        (string) ($row['bill_number'] ?? 'Unknown'),
                        (string) ($row['status'] ?? 'Unknown'),
                        $this->nullableString($row['vendor_name']) ?? 'Unknown vendor'
                    );
                }
            }
        }

        if ($this->tableExists('accounts')) {
            $recentAccounts = $this->database->fetchAll(
                'SELECT name, type, opening_balance, current_balance
                 FROM accounts
                 ORDER BY created_at DESC
                 LIMIT 3'
            );
            if (!empty($recentAccounts)) {
                $facts[] = 'Recent accounts:';
                foreach ($recentAccounts as $row) {
                    $facts[] = sprintf(
                        '- %s (%s, opening %s, current %s)',
                        (string) ($row['name'] ?? 'Unknown'),
                        (string) ($row['type'] ?? 'Unknown'),
                        (string) ($row['opening_balance'] ?? '0'),
                        (string) ($row['current_balance'] ?? '0')
                    );
                }
            }
        }

        return $facts;
    }

    /**
     * @return string[]
     */
    private function buildMameRelevantRecords(string $message): array
    {
        $patterns = $this->buildMameSearchPatterns($message);
        if ($patterns === []) {
            return [];
        }

        $records = [];

        $customerRows = $this->searchMameCustomers($patterns);
        if (!empty($customerRows)) {
            $records[] = 'Customers:';
            foreach ($customerRows as $row) {
                $records[] = sprintf(
                    '- %s: %s, phone %s, address %s, orders %s, due %s',
                    (string) ($row['id'] ?? ''),
                    (string) ($row['name'] ?? 'Unknown'),
                    $this->nullableString($row['phone']) ?? 'No phone',
                    $this->nullableString($row['address']) ?? 'No address',
                    (string) ($row['total_orders'] ?? '0'),
                    (string) ($row['due_amount'] ?? '0')
                );
            }
        }

        $vendorRows = $this->searchMameVendors($patterns);
        if (!empty($vendorRows)) {
            $records[] = 'Vendors:';
            foreach ($vendorRows as $row) {
                $records[] = sprintf(
                    '- %s: %s, phone %s, address %s, purchases %s, due %s',
                    (string) ($row['id'] ?? ''),
                    (string) ($row['name'] ?? 'Unknown'),
                    $this->nullableString($row['phone']) ?? 'No phone',
                    $this->nullableString($row['address']) ?? 'No address',
                    (string) ($row['total_purchases'] ?? '0'),
                    (string) ($row['due_amount'] ?? '0')
                );
            }
        }

        $orderRows = $this->searchMameOrders($patterns);
        if (!empty($orderRows)) {
            $records[] = 'Orders:';
            foreach ($orderRows as $row) {
                $records[] = sprintf(
                    '- %s: %s, customer %s, total %s, created %s',
                    (string) ($row['order_number'] ?? ''),
                    (string) ($row['status'] ?? 'Unknown'),
                    $this->nullableString($row['customer_name']) ?? 'Unknown customer',
                    (string) ($row['total'] ?? '0'),
                    (string) ($row['order_date'] ?? 'Unknown date')
                );
            }
        }

        $billRows = $this->searchMameBills($patterns);
        if (!empty($billRows)) {
            $records[] = 'Bills:';
            foreach ($billRows as $row) {
                $records[] = sprintf(
                    '- %s: %s, vendor %s, total %s, date %s',
                    (string) ($row['bill_number'] ?? ''),
                    (string) ($row['status'] ?? 'Unknown'),
                    $this->nullableString($row['vendor_name']) ?? 'Unknown vendor',
                    (string) ($row['total'] ?? '0'),
                    (string) ($row['bill_date'] ?? 'Unknown date')
                );
            }
        }

        $productRows = $this->searchMameProducts($patterns);
        if (!empty($productRows)) {
            $records[] = 'Products:';
            foreach ($productRows as $row) {
                $records[] = sprintf(
                    '- %s: category %s, price %s, stock %s',
                    (string) ($row['name'] ?? 'Unknown'),
                    $this->nullableString($row['category']) ?? 'No category',
                    (string) ($row['sale_price'] ?? '0'),
                    (string) ($row['stock'] ?? '0')
                );
            }
        }

        $accountRows = $this->searchMameAccounts($patterns);
        if (!empty($accountRows)) {
            $records[] = 'Accounts:';
            foreach ($accountRows as $row) {
                $records[] = sprintf(
                    '- %s: type %s, opening %s, current %s',
                    (string) ($row['name'] ?? 'Unknown'),
                    (string) ($row['type'] ?? 'Unknown'),
                    (string) ($row['opening_balance'] ?? '0'),
                    (string) ($row['current_balance'] ?? '0')
                );
            }
        }

        $transactionRows = $this->searchMameTransactions($patterns);
        if (!empty($transactionRows)) {
            $records[] = 'Transactions:';
            foreach ($transactionRows as $row) {
                $records[] = sprintf(
                    '- %s: %s, amount %s, account %s, date %s',
                    $this->nullableString($row['transaction_id']) ?? 'Unknown',
                    $this->nullableString($row['type']) ?? 'Unknown',
                    (string) ($row['amount'] ?? '0'),
                    $this->nullableString($row['account_name']) ?? 'Unknown account',
                    (string) ($row['created_at'] ?? 'Unknown date')
                );
            }
        }

        $settingsRows = $this->searchMameSettings($message);
        if (!empty($settingsRows)) {
            $records[] = 'Settings:';
            foreach ($settingsRows as $row) {
                $records[] = '- ' . json_encode($row, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            }
        }

        return $records;
    }

    /**
     * @return string[]
     */
    private function buildMameSearchPatterns(string $message): array
    {
        $clean = trim(preg_replace('/[^a-z0-9\s]/i', ' ', $message));
        if ($clean === '') {
            return [];
        }

        $terms = preg_split('/\s+/', strtolower($clean), -1, PREG_SPLIT_NO_EMPTY);
        $stopWords = [
            'about' => true, 'address' => true, 'addresses' => true, 'and' => true, 'any' => true,
            'are' => true, 'bill' => true, 'bills' => true, 'can' => true, 'customer' => true,
            'customers' => true, 'data' => true, 'detail' => true, 'details' => true, 'does' => true,
            'find' => true, 'for' => true, 'from' => true, 'give' => true, 'have' => true,
            'is' => true, 'me' => true, 'order' => true, 'orders' => true, 'phone' => true,
            'please' => true, 'product' => true, 'products' => true, 'show' => true, 'tell' => true,
            'the' => true, 'this' => true, 'to' => true, 'vendor' => true, 'vendors' => true,
            'what' => true, 'where' => true, 'who' => true, 'with' => true,
        ];
        $patterns = [];
        foreach ($terms as $term) {
            $term = trim($term);
            if ($term === '' || strlen($term) < 2) {
                continue;
            }
            if (isset($stopWords[$term]) && !preg_match('/\d/', $term)) {
                continue;
            }
            $patterns[] = '%' . $term . '%';
            if (count($patterns) >= 8) {
                break;
            }
        }

        return array_values(array_unique($patterns));
    }

    private function searchMameCustomers(array $patterns): array
    {
        if (!$this->tableExists('customers') || $patterns === []) {
            return [];
        }

        $bindings = [];
        $where = $this->buildMameLikeSearchSql(['name', 'phone', 'address'], $patterns, $bindings);
        if ($where === '') {
            return [];
        }

        return $this->database->fetchAll(
            'SELECT id, name, phone, address, total_orders, due_amount
             FROM customers
             WHERE deleted_at IS NULL AND (' . $where . ')
             ORDER BY created_at DESC
             LIMIT 3',
            $bindings
        );
    }

    private function searchMameVendors(array $patterns): array
    {
        if (!$this->tableExists('vendors') || $patterns === []) {
            return [];
        }

        $bindings = [];
        $where = $this->buildMameLikeSearchSql(['name', 'phone', 'address'], $patterns, $bindings);
        if ($where === '') {
            return [];
        }

        return $this->database->fetchAll(
            'SELECT id, name, phone, address, total_purchases, due_amount
             FROM vendors
             WHERE deleted_at IS NULL AND (' . $where . ')
             ORDER BY created_at DESC
             LIMIT 3',
            $bindings
        );
    }

    private function searchMameOrders(array $patterns): array
    {
        if (!$this->tableExists('orders') || $patterns === []) {
            return [];
        }

        $bindings = [];
        $where = $this->buildMameLikeSearchSql(['order_number', 'status'], $patterns, $bindings);
        if ($where === '') {
            return [];
        }

        return $this->database->fetchAll(
            'SELECT o.order_number, o.status, o.total, o.order_date, c.name AS customer_name
             FROM orders o
             LEFT JOIN customers c ON c.id = o.customer_id
             WHERE o.deleted_at IS NULL AND (' . $where . ')
             ORDER BY o.created_at DESC
             LIMIT 3',
            $bindings
        );
    }

    private function searchMameBills(array $patterns): array
    {
        if (!$this->tableExists('bills') || $patterns === []) {
            return [];
        }

        $bindings = [];
        $where = $this->buildMameLikeSearchSql(['bill_number', 'status'], $patterns, $bindings);
        if ($where === '') {
            return [];
        }

        return $this->database->fetchAll(
            'SELECT b.bill_number, b.status, b.total, b.bill_date, v.name AS vendor_name
             FROM bills b
             LEFT JOIN vendors v ON v.id = b.vendor_id
             WHERE b.deleted_at IS NULL AND (' . $where . ')
             ORDER BY b.bill_date DESC
             LIMIT 3',
            $bindings
        );
    }

    private function searchMameProducts(array $patterns): array
    {
        if (!$this->tableExists('products') || $patterns === []) {
            return [];
        }

        $bindings = [];
        $where = $this->buildMameLikeSearchSql(['name', 'category'], $patterns, $bindings);
        if ($where === '') {
            return [];
        }

        return $this->database->fetchAll(
            'SELECT name, category, sale_price, stock
             FROM products
             WHERE deleted_at IS NULL AND (' . $where . ')
             ORDER BY created_at DESC
             LIMIT 3',
            $bindings
        );
    }

    private function searchMameAccounts(array $patterns): array
    {
        if (!$this->tableExists('accounts') || $patterns === []) {
            return [];
        }

        $bindings = [];
        $where = $this->buildMameLikeSearchSql(['name', 'type'], $patterns, $bindings);
        if ($where === '') {
            return [];
        }

        return $this->database->fetchAll(
            'SELECT name, type, opening_balance, current_balance
             FROM accounts
             WHERE ' . $where . '
             ORDER BY created_at DESC
             LIMIT 3',
            $bindings
        );
    }

    private function searchMameTransactions(array $patterns): array
    {
        if (!$this->tableExists('transactions') || $patterns === []) {
            return [];
        }

        $bindings = [];
        $where = $this->buildMameLikeSearchSql(['transaction_id', 'type', 'account_name'], $patterns, $bindings);
        if ($where === '') {
            return [];
        }

        return $this->database->fetchAll(
            'SELECT transaction_id, type, amount, account_name, created_at
             FROM transactions
             WHERE deleted_at IS NULL AND (' . $where . ')
             ORDER BY created_at DESC
             LIMIT 3',
            $bindings
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function searchMameSettings(string $message): array
    {
        if (!$this->isMameSettingsQuery($message)) {
            return [];
        }

        $tables = [
            'company_settings',
            'order_settings',
            'invoice_settings',
            'app_capability_settings',
            'payment_gateway_settings',
            'service_subscription_settings',
            'courier_settings',
        ];

        $rows = [];
        foreach ($tables as $table) {
            if (!$this->tableExists($table)) {
                continue;
            }

            try {
                $row = $this->database->fetchOne("SELECT * FROM {$this->quoteIdentifier($table)} LIMIT 1");
                if (!is_array($row) || $row === []) {
                    continue;
                }

                $rows[] = array_merge(['table' => $table], $this->sanitizeMameSettingsRow($row));
            } catch (\Throwable $exception) {
                continue;
            }
        }

        return $rows;
    }

    private function isMameSettingsQuery(string $message): bool
    {
        $lower = strtolower($message);
        return str_contains($lower, 'setting')
            || str_contains($lower, 'configuration')
            || str_contains($lower, 'configure')
            || str_contains($lower, 'license')
            || str_contains($lower, 'gateway')
            || str_contains($lower, 'courier')
            || str_contains($lower, 'company');
    }

    /**
     * @param string[] $fields
     * @param string[] $patterns
     * @param array<string, string> $bindings
     */
    private function buildMameLikeSearchSql(array $fields, array $patterns, array &$bindings): string
    {
        $clauses = [];
        foreach ($fields as $field) {
            foreach ($patterns as $index => $pattern) {
                $name = ':mame_pattern_' . $field . '_' . $index;
                $bindings[$name] = $pattern;
                $clauses[] = 'LOWER(' . $field . ') LIKE ' . $name;
            }
        }

        return implode(' OR ', $clauses);
    }

    /**
     * @return array<string, mixed>
     */
    private function sanitizeMameSettingsRow(array $row): array
    {
        $sanitized = [];
        $sensitive = ['api_key', 'apiKey', 'secret', 'password', 'token', 'license_key', 'license_owner_token', 'piprapay_ipn_secret'];

        foreach ($row as $key => $value) {
            $lowerKey = strtolower((string) $key);
            $shouldExclude = false;
            foreach ($sensitive as $needle) {
                if (str_contains($lowerKey, strtolower($needle))) {
                    $shouldExclude = true;
                    break;
                }
            }
            if ($shouldExclude) {
                continue;
            }

            $sanitized[$key] = is_string($value) ? trim($value) : $value;
        }

        return $sanitized;
    }

    private function maybeExecuteMameToolResponse(string $answer, string $message): string
    {
        $tool = $this->parseMameToolResponse($answer);
        if ($tool === null) {
            return $answer;
        }

        $action = trim((string) ($tool['action'] ?? $tool['tool'] ?? ''));
        $payload = is_array($tool['payload'] ?? null) ? $tool['payload'] : [];

        if ($action === '' || strtolower($action) === 'none') {
            $missing = is_array($tool['missing'] ?? null) ? array_values(array_filter(array_map('strval', $tool['missing']))) : [];
            $fallback = trim((string) ($tool['answer'] ?? ''));
            if ($fallback !== '') {
                return $fallback;
            }

            return $missing !== []
                ? 'I need ' . implode(', ', $missing) . ' before I can do that.'
                : $answer;
        }

        try {
            $result = $this->executeMameToolAction($action, $payload);
            return $this->formatMameToolResult($result);
        } catch (\Throwable $exception) {
            return 'I could not complete that action: ' . $exception->getMessage();
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private function parseMameToolResponse(string $answer): ?array
    {
        $candidate = trim($answer);
        if ($candidate === '') {
            return null;
        }

        if (preg_match('/^```(?:json)?\s*(.*?)\s*```$/is', $candidate, $matches) === 1) {
            $candidate = trim((string) $matches[1]);
        }

        $decoded = json_decode($candidate, true);
        if (!is_array($decoded)) {
            $start = strpos($candidate, '{');
            $end = strrpos($candidate, '}');
            if ($start === false || $end === false || $end <= $start) {
                return null;
            }
            $decoded = json_decode(substr($candidate, $start, $end - $start + 1), true);
            if (!is_array($decoded)) {
                return null;
            }
        }

        if (!array_key_exists('action', $decoded) && !array_key_exists('tool', $decoded)) {
            return null;
        }

        if (!is_array($decoded['payload'] ?? null)) {
            $payload = $decoded;
            unset($payload['action'], $payload['tool'], $payload['missing'], $payload['answer']);
            $decoded['payload'] = $payload;
        }

        return $decoded;
    }

    /**
     * @return array<string, mixed>
     */
    private function executeMameToolAction(string $action, array $payload): array
    {
        $normalized = $this->normalizeMameToolAction($action);
        if ($normalized === '') {
            throw new RuntimeException('Unsupported Mame action.');
        }

        $entityUpdateActions = [
            'updateCustomer' => true,
            'updateVendor' => true,
            'updateProduct' => true,
            'updateAccount' => true,
            'updateOrder' => true,
            'updateBill' => true,
            'updateTransaction' => true,
        ];
        if (isset($entityUpdateActions[$normalized])) {
            $payload = $this->normalizeMameUpdatePayload($payload);
        }

        if ($normalized === 'createTransfer') {
            $payload['type'] = 'Transfer';
            $normalized = 'createTransaction';
        }

        $this->serviceLifecycle()->assertActionAllowed($normalized);
        $this->validateMameToolPayload($normalized, $payload);
        $operations = null;
        $operationsActions = [
            'createOrder' => true,
            'updateOrder' => true,
            'deleteOrder' => true,
            'createBill' => true,
            'updateBill' => true,
            'deleteBill' => true,
            'createTransaction' => true,
            'updateTransaction' => true,
            'deleteTransaction' => true,
        ];

        if (isset($operationsActions[$normalized])) {
            $operations = new OperationsApi($this->database, $this->auth, $this->config);
            $record = $operations->{$normalized}($payload);
        } else {
            $record = $this->{$normalized}($payload);
        }

        if ($record === null || $record === false) {
            throw new RuntimeException('No matching record was changed.');
        }
        if (is_array($record) && array_key_exists('success', $record) && !$record['success']) {
            throw new RuntimeException('The requested change was not applied.');
        }

        return [
            'action' => $normalized,
            'record' => is_array($record) ? $record : ['success' => (bool) $record],
        ];
    }

    private function normalizeMameToolAction(string $action): string
    {
        $key = strtolower(preg_replace('/[^a-z0-9]/i', '', $action));
        $actions = [
            'createcustomer' => 'createCustomer',
            'updatecustomer' => 'updateCustomer',
            'deletecustomer' => 'deleteCustomer',
            'createvendor' => 'createVendor',
            'updatevendor' => 'updateVendor',
            'deletevendor' => 'deleteVendor',
            'createproduct' => 'createProduct',
            'updateproduct' => 'updateProduct',
            'deleteproduct' => 'deleteProduct',
            'createaccount' => 'createAccount',
            'updateaccount' => 'updateAccount',
            'deleteaccount' => 'deleteAccount',
            'createorder' => 'createOrder',
            'updateorder' => 'updateOrder',
            'deleteorder' => 'deleteOrder',
            'createbill' => 'createBill',
            'updatebill' => 'updateBill',
            'deletebill' => 'deleteBill',
            'createtransaction' => 'createTransaction',
            'updatetransaction' => 'updateTransaction',
            'deletetransaction' => 'deleteTransaction',
            'createtransfer' => 'createTransfer',
            'updatecompanysettings' => 'updateCompanySettings',
            'updateordersettings' => 'updateOrderSettings',
            'updateinvoicesettings' => 'updateInvoiceSettings',
            'updatesystemdefaults' => 'updateSystemDefaults',
            'updatesettings' => 'updateSystemDefaults',
        ];

        return $actions[$key] ?? '';
    }

    /**
     * @return array<string, mixed>
     */
    private function normalizeMameUpdatePayload(array $payload): array
    {
        if (is_array($payload['updates'] ?? null)) {
            return $payload;
        }

        $updates = $payload;
        unset($updates['id']);

        return [
            'id' => $payload['id'] ?? '',
            'updates' => $updates,
        ];
    }

    private function validateMameToolPayload(string $action, array &$payload): void
    {
        $missing = [];
        $require = static function (string $field, string $label = '') use (&$missing, &$payload): void {
            $value = $payload[$field] ?? null;
            if ($value === null || (is_string($value) && trim($value) === '') || (is_array($value) && $value === [])) {
                $missing[] = $label !== '' ? $label : $field;
            }
        };

        $idRequiredActions = [
            'updateCustomer' => true,
            'deleteCustomer' => true,
            'updateVendor' => true,
            'deleteVendor' => true,
            'updateProduct' => true,
            'deleteProduct' => true,
            'updateAccount' => true,
            'deleteAccount' => true,
            'updateOrder' => true,
            'deleteOrder' => true,
            'updateBill' => true,
            'deleteBill' => true,
            'updateTransaction' => true,
            'deleteTransaction' => true,
        ];
        if (isset($idRequiredActions[$action])) {
            $require('id');
        }

        switch ($action) {
            case 'createCustomer':
            case 'createVendor':
                $require('name');
                $require('phone');
                break;
            case 'createProduct':
                $require('name');
                $require('salePrice');
                $require('purchasePrice');
                $require('stock');
                $payload['image'] = $payload['image'] ?? null;
                break;
            case 'createAccount':
                $require('name');
                $require('type');
                $payload['openingBalance'] = $payload['openingBalance'] ?? 0;
                break;
            case 'createOrder':
                $require('customerId', 'customer id');
                $require('items');
                $payload = $this->normalizeMameOrderLikePayload($payload, 'order');
                break;
            case 'createBill':
                $require('vendorId', 'vendor id');
                $require('items');
                $payload = $this->normalizeMameOrderLikePayload($payload, 'bill');
                break;
            case 'createTransaction':
                $require('type');
                $require('accountId', 'account id');
                $require('amount');
                $payload['type'] = trim((string) ($payload['type'] ?? 'Income')) ?: 'Income';
                if (strcasecmp((string) $payload['type'], 'Transfer') === 0) {
                    $require('toAccountId', 'to account id');
                    $payload['category'] = $payload['category'] ?? 'transfer';
                } else {
                    $require('category');
                }
                $payload['paymentMethod'] = $payload['paymentMethod'] ?? 'Cash';
                break;
        }

        if ($missing !== []) {
            throw new RuntimeException('Missing required value(s): ' . implode(', ', array_values(array_unique($missing))) . '.');
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function normalizeMameOrderLikePayload(array $payload, string $kind): array
    {
        $items = is_array($payload['items'] ?? null) ? $payload['items'] : [];
        $normalizedItems = [];
        $subtotal = 0.0;

        foreach ($items as $item) {
            if (!is_array($item)) {
                continue;
            }

            $quantity = (float) ($item['quantity'] ?? $item['qty'] ?? 0);
            $unitPrice = (float) ($item['unitPrice'] ?? $item['price'] ?? $item['salePrice'] ?? 0);
            $lineTotal = array_key_exists('lineTotal', $item) ? (float) $item['lineTotal'] : $quantity * $unitPrice;
            $subtotal += $lineTotal;

            $normalizedItems[] = array_merge($item, [
                'productId' => trim((string) ($item['productId'] ?? $item['id'] ?? '')),
                'quantity' => $quantity,
                'unitPrice' => $unitPrice,
                'lineTotal' => $lineTotal,
            ]);
        }

        $discount = (float) ($payload['discount'] ?? 0);
        $shipping = (float) ($payload['shipping'] ?? 0);
        $payload['items'] = $normalizedItems;
        $payload['subtotal'] = array_key_exists('subtotal', $payload) ? (float) $payload['subtotal'] : $subtotal;
        $payload['discount'] = $discount;
        $payload['shipping'] = $shipping;
        $payload['total'] = array_key_exists('total', $payload)
            ? (float) $payload['total']
            : max($payload['subtotal'] - $discount + $shipping, 0);
        $payload['paidAmount'] = (float) ($payload['paidAmount'] ?? 0);
        $payload['status'] = trim((string) ($payload['status'] ?? 'On Hold')) ?: 'On Hold';
        $payload['notes'] = $payload['notes'] ?? null;

        if ($kind === 'order' && empty($payload['orderDate'])) {
            unset($payload['orderDate']);
        }
        if ($kind === 'bill' && empty($payload['billDate'])) {
            unset($payload['billDate']);
        }

        return $payload;
    }

    private function formatMameToolResult(array $result): string
    {
        $action = (string) ($result['action'] ?? '');
        $record = is_array($result['record'] ?? null) ? $result['record'] : [];
        $verb = str_starts_with($action, 'delete') ? 'deleted' : (str_starts_with($action, 'update') ? 'updated' : 'created');
        $type = strtolower((string) preg_replace('/^(create|update|delete)/', '', $action));
        $label = $this->mameRecordLabel($record);

        $message = 'Done - ' . $verb . ' ' . ($type !== '' ? $type : 'record');
        if ($label !== '') {
            $message .= ': ' . $label;
        }
        $message .= '.';

        if ($action === 'createProduct') {
            $message .= ' Please update the product image manually from the product form.';
        }

        return $message;
    }

    private function mameRecordLabel(array $record): string
    {
        foreach (['orderNumber', 'billNumber', 'transactionId', 'name', 'id'] as $field) {
            $value = trim((string) ($record[$field] ?? ''));
            if ($value !== '') {
                return $value;
            }
        }

        return '';
    }

    private function quoteIdentifier(string $identifier): string
    {
        $safe = str_replace('`', '``', $identifier);
        return '`' . $safe . '`';
    }

    /**
     * @return string[]
     */
    private function buildMameToolInstructions(): array
    {
        return [
            'For read-only questions, answer directly using Business facts and Relevant database records.',
            'For write actions, respond with one JSON object only and no markdown: {"action":"createCustomer","payload":{"name":"Ayesha","phone":"017..."}}.',
            'If a required value is missing, respond with JSON only: {"action":"none","missing":["customer phone"],"answer":"Please provide the customer phone number."}.',
            'Allowed actions: createCustomer, updateCustomer, deleteCustomer, createVendor, updateVendor, deleteVendor, createProduct, updateProduct, deleteProduct, createAccount, updateAccount, deleteAccount, createOrder, updateOrder, deleteOrder, createBill, updateBill, deleteBill, createTransaction, updateTransaction, deleteTransaction, createTransfer, updateCompanySettings, updateOrderSettings, updateInvoiceSettings, updateSystemDefaults.',
            'Required create fields: customer/vendor need name and phone; product needs name, salePrice, purchasePrice, stock and image must be null unless the user provides an image URL; account needs name and type; order needs customerId and at least one item; bill needs vendorId and at least one item; transaction needs type, accountId, amount, category; transfer needs accountId, toAccountId, amount.',
            'Optional fields: orderDate, billDate, transaction date, notes, description, discount, shipping, paidAmount, address, due amounts, image, category, currentBalance. Order and bill dates default to creation date.',
            'For update and delete actions, id is required. Put changed fields inside payload.updates for updates.',
            'For products, after creating without an image, tell the user to update the product image manually.',
        ];
    }

    private function callGeminiChat(array $payload, string $apiKey): string
    {
        $endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent';
        $headers = ['Content-Type' => 'application/json'];
        $url = $endpoint;

        if (str_starts_with($apiKey, 'ya29.') || str_starts_with($apiKey, 'Bearer ')) {
            $cleanKey = preg_replace('/^Bearer\s+/i', '', $apiKey);
            $headers['Authorization'] = 'Bearer ' . $cleanKey;
        } else {
            $headers['x-goog-api-key'] = $apiKey;
        }

        $systemContent = (string) ($payload['messages'][0]['content'] ?? '');
        $userContent = (string) ($payload['messages'][1]['content'] ?? '');

        $requestBody = [
            'contents' => [
                [
                    'role' => 'system',
                    'parts' => [
                        ['text' => $systemContent],
                    ],
                ],
                [
                    'role' => 'user',
                    'parts' => [
                        ['text' => $userContent],
                    ],
                ],
            ],
            'generationConfig' => [
                'temperature' => $payload['temperature'] ?? 0.3,
                'topP' => 0.95,
                'candidateCount' => 1,
            ],
        ];

        $response = $this->httpJson(
            'POST',
            $url,
            $headers,
            $requestBody
        );

        $json = $response['json'] ?? null;
        if ($response['status'] !== 200) {
            $message = 'HTTP ' . $response['status'];
            if (is_array($json) && isset($json['error']['message'])) {
                $message .= ': ' . $json['error']['message'];
            }
            throw new RuntimeException($message);
        }

        $text = $this->extractGeminiResponseText($json);
        if ($text !== '') {
            return $text;
        }

        throw new RuntimeException('Unexpected Gemini response format.');
    }

    private function extractGeminiResponseText(mixed $json): string
    {
        if (!is_array($json)) {
            return '';
        }

        if (isset($json['candidates'][0]['content'])) {
            $candidate = $json['candidates'][0]['content'];
            if (is_string($candidate)) {
                return trim($candidate);
            }
            if (is_array($candidate)) {
                if (isset($candidate['text'])) {
                    return trim((string) $candidate['text']);
                }
                if (isset($candidate['parts'][0]['text'])) {
                    return trim((string) $candidate['parts'][0]['text']);
                }
            }
        }

        if (isset($json['output']['content']) && is_array($json['output']['content'])) {
            foreach ($json['output']['content'] as $contentItem) {
                if (is_array($contentItem) && isset($contentItem['type']) && $contentItem['type'] === 'output_text' && isset($contentItem['text'])) {
                    return trim((string) $contentItem['text']);
                }
            }
        }

        if (isset($json['candidates'][0]['content'])) {
            $candidate = $json['candidates'][0]['content'];
            if (is_string($candidate)) {
                return trim($candidate);
            }
            if (is_array($candidate)) {
                foreach ($candidate as $item) {
                    if (is_string($item)) {
                        return trim($item);
                    }
                    if (is_array($item)) {
                        if (isset($item['text'])) {
                            return trim((string) $item['text']);
                        }
                        if (isset($item['content']) && is_string($item['content'])) {
                            return trim($item['content']);
                        }
                    }
                }
            }
        }

        if (isset($json['output'][0]['content']) && is_array($json['output'][0]['content'])) {
            foreach ($json['output'][0]['content'] as $contentItem) {
                if (!is_array($contentItem)) {
                    continue;
                }
                if (isset($contentItem['type']) && $contentItem['type'] === 'output_text' && isset($contentItem['text'])) {
                    return trim((string) $contentItem['text']);
                }
                if (isset($contentItem['text'])) {
                    return trim((string) $contentItem['text']);
                }
                if (isset($contentItem['content']) && is_string($contentItem['content'])) {
                    return trim($contentItem['content']);
                }
            }
        }

        return '';
    }

    private function callOpenRouterChat(array $payload, string $apiKey): string
    {
        $payload['model'] = 'nex-agi/nex-n2-pro:free';

        $response = $this->httpJson(
            'POST',
            'https://openrouter.ai/v1/chat/completions',
            ['Authorization' => 'Bearer ' . $apiKey],
            $payload
        );

        $json = $response['json'] ?? null;
        if (is_array($json)) {
            if (isset($json['choices'][0]['message']['content'])) {
                return trim((string) $json['choices'][0]['message']['content']);
            }
            if (isset($json['choices'][0]['message']['content'][0]['text'])) {
                return trim((string) $json['choices'][0]['message']['content'][0]['text']);
            }
            if (isset($json['choices'][0]['text'])) {
                return trim((string) $json['choices'][0]['text']);
            }
            if (isset($json['choices'][0]['delta']['content'])) {
                return trim((string) $json['choices'][0]['delta']['content']);
            }
        }

        throw new RuntimeException('Unexpected OpenRouter response format.');
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
            "SELECT id FROM users WHERE role IN ('Developer', 'Admin') AND deleted_at IS NULL AND COALESCE(is_system, 0) = 0 ORDER BY FIELD(role, 'Developer', 'Admin'), created_at ASC LIMIT 1"
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
            'pathao' => [
                'baseUrl' => (string) ($row['pathao_base_url'] ?? ''),
                'clientId' => (string) ($row['pathao_client_id'] ?? ''),
                'clientSecret' => (string) ($row['pathao_client_secret'] ?? ''),
                'username' => (string) ($row['pathao_username'] ?? ''),
                'password' => (string) ($row['pathao_password'] ?? ''),
                'storeId' => (string) ($row['pathao_store_id'] ?? ''),
                'defaultQuantity' => (int) ($row['pathao_default_quantity'] ?? 1),
                'defaultWeight' => (float) ($row['pathao_default_weight'] ?? 1.0),
                'defaultDeliveryType' => (int) ($row['pathao_default_delivery_type'] ?? 48),
                'defaultItemType' => (int) ($row['pathao_default_item_type'] ?? 2),
                'accessToken' => (string) ($row['pathao_access_token'] ?? ''),
                'refreshToken' => (string) ($row['pathao_refresh_token'] ?? ''),
                'tokenExpiresAt' => (string) ($row['pathao_token_expires_at'] ?? ''),
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
        $pathao = is_array($params['pathao'] ?? null) ? $params['pathao'] : [];
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
            'pathao_base_url' => $pathao['baseUrl'] ?? $current['pathao']['baseUrl'],
            'pathao_client_id' => $pathao['clientId'] ?? $current['pathao']['clientId'],
            'pathao_client_secret' => $pathao['clientSecret'] ?? $current['pathao']['clientSecret'],
            'pathao_username' => $pathao['username'] ?? $current['pathao']['username'],
            'pathao_password' => $pathao['password'] ?? $current['pathao']['password'],
            'pathao_store_id' => $pathao['storeId'] ?? $current['pathao']['storeId'],
            'pathao_default_quantity' => array_key_exists('defaultQuantity', $pathao) ? (int) $pathao['defaultQuantity'] : $current['pathao']['defaultQuantity'],
            'pathao_default_weight' => array_key_exists('defaultWeight', $pathao) ? (float) $pathao['defaultWeight'] : $current['pathao']['defaultWeight'],
            'pathao_default_delivery_type' => array_key_exists('defaultDeliveryType', $pathao) ? (int) $pathao['defaultDeliveryType'] : $current['pathao']['defaultDeliveryType'],
            'pathao_default_item_type' => array_key_exists('defaultItemType', $pathao) ? (int) $pathao['defaultItemType'] : $current['pathao']['defaultItemType'],
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

    private function globalBrandingCacheKey(): string
    {
        return 'mamepilot:global-branding:' . hash('sha256', __DIR__);
    }

    private function globalBrandingCachePath(): string
    {
        return rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR)
            . DIRECTORY_SEPARATOR
            . 'mamepilot_global_branding_' . hash('sha256', __DIR__) . '.json';
    }

    private function purgeGlobalBrandingCache(): void
    {
        if (function_exists('apcu_delete')) {
            @apcu_delete($this->globalBrandingCacheKey());
        }
        $path = $this->globalBrandingCachePath();
        if (is_file($path)) {
            @unlink($path);
        }
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

    private function resolveSmartContactInput(array $params, string $contactType): array
    {
        if (!array_key_exists('smartInput', $params)) return $params;
        $text = trim((string) ($params['smartInput'] ?? ''));
        unset($params['smartInput']);
        if ($text === '') throw new ApiException('Paste the raw name, phone, and address before saving.', 422, 'SMART_INPUT_REQUIRED');

        $capabilities = (new FeatureAccess($this->database, $this->auth))->fetchCapabilities();
        $settingColumn = $contactType === 'vendor' ? 'smart_vendor_adding' : 'smart_customer_adding';
        $settings = $this->tableExists('be_smart_settings')
            ? $this->database->fetchOne('SELECT smart_customer_adding, smart_vendor_adding FROM be_smart_settings LIMIT 1')
            : null;
        if (empty($capabilities['be_smart']) || empty($settings[$settingColumn] ?? false)) {
            throw new ApiException('Smart ' . $contactType . ' adding is not enabled.', 403, 'SMART_ADDING_DISABLED');
        }

        $prompt = <<<'PROMPT'
You're a very fast but extremely accurate information extractor.Extract from this text and return ONLY valid JSON (no markdown, no extra text):
{
  "name": "<provided full customer name (typically the first line) or 'N/A'>",
  "phone": "<primary phone number or 'N/A'>",
  "additionalPhone": "<comma-separated additional phones or empty string>",
  "address": "<full address or 'N/A'>"
}

If there are multiple phone numbers, put the first in "phone" and rest in "additionalPhone" (comma-separated). If any field is missing, use 'N/A' for name and address, and 'N/A' for phone if no valid number is found.
IMPORTANT:
    1. For phone numbers only: Remove any whitespaces, convert Bengali digits to English. Keep Bangladesh local phone number format - MUST BE 11 DIGITS and START WITH 0. If a number starts with +880 or just 1, convert it to 0 format.
    2. Do not translate or modify name and address text, just extract as-is (except trimming). If missing, use 'N/A'. IMPORTANT: ALWAYS MAKE SURE THE PHONE NUMBER IS CORRECT BY EVERY DIGIT
    3. Remove labels like 'Name:', 'Phone:', 'Address:' if present.
    4. Return only the JSON object. Ignore any irrelevant extra text.

Text: 
PROMPT;
        $prompt .= $text;

        $response = (new LlmClient($this->database, $this->config))->generateForFeature(
            'information_extraction',
            $prompt,
            'Return the JSON object now.',
            [],
            ['temperature' => 0.0, 'maxTokens' => 1024]
        );
        $json = trim($response);
        $json = preg_replace('/^```(?:json)?\s*/i', '', $json) ?? $json;
        $json = preg_replace('/\s*```$/', '', $json) ?? $json;
        if (!str_starts_with($json, '{')) {
            $start = strpos($json, '{');
            $end = strrpos($json, '}');
            if ($start !== false && $end !== false && $end > $start) $json = substr($json, $start, $end - $start + 1);
        }
        $extracted = json_decode($json, true);
        if (!is_array($extracted)) {
            throw new ApiException('The selected LLM did not return valid contact information. Please try again.', 422, 'SMART_EXTRACTION_INVALID_JSON');
        }

        $phone = $this->normalizeBangladeshPhone((string) ($extracted['phone'] ?? ''));
        if ($phone === null) {
            throw new ApiException('A valid 11-digit Bangladesh phone number could not be extracted. Check the pasted text and try again.', 422, 'SMART_EXTRACTION_INVALID_PHONE');
        }
        $name = trim((string) ($extracted['name'] ?? ''));
        $address = trim((string) ($extracted['address'] ?? ''));
        $params['name'] = $name !== '' ? $name : 'N/A';
        $params['phone'] = $phone;
        $params['address'] = $address !== '' ? $address : 'N/A';
        return $params;
    }

    private function normalizeBangladeshPhone(string $value): ?string
    {
        $value = strtr($value, [
            '০' => '0', '১' => '1', '২' => '2', '৩' => '3', '৪' => '4',
            '৫' => '5', '৬' => '6', '৭' => '7', '৮' => '8', '৯' => '9',
        ]);
        $segments = preg_split('/[,;|\/\r\n]+/u', $value) ?: [$value];
        foreach ($segments as $segment) {
            $digits = preg_replace('/\D+/', '', $segment) ?? '';
            if (str_starts_with($digits, '00880')) $digits = substr($digits, 5);
            elseif (str_starts_with($digits, '880')) $digits = substr($digits, 3);
            if (strlen($digits) === 10 && str_starts_with($digits, '1')) $digits = '0' . $digits;
            if (preg_match('/^0\d{10}$/', $digits) === 1) return $digits;
        }
        return null;
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
            'deploymentKey' => $this->nullableString($row['deployment_key'] ?? $row['deploymentKey'] ?? $row['license_key'] ?? null),
            'deploymentName' => $this->nullableString($row['deployment_name'] ?? $row['deploymentName'] ?? null),
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
                   AND COALESCE(u.is_system, 0) = 0
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
               AND COALESCE(u.is_system, 0) = 0
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
            'deployments' => [],
            'summary' => [
                'recipientCount' => count($recipients),
                'readCount' => $readCount,
                'actedCount' => $actedCount,
                'acceptedCount' => $acceptedCount,
                'declinedCount' => $declinedCount,
            ],
        ];
    }

    private function buildCentralNotificationDetailPayload(array $notification): array
    {
        $mappedNotification = $this->mapCentralNotification($notification);
        $isRead = (bool) ($mappedNotification['isRead'] ?? false);
        $actionResult = trim((string) ($mappedNotification['actionResult'] ?? ''));

        $recipients = [];
        $deployments = [];
        try {
            $centralDetail = $this->fetchCentralNotificationRecipients(trim((string) ($notification['id'] ?? '')));
            $recipients = $centralDetail['recipients'] ?? [];
            $deployments = $centralDetail['deployments'] ?? [];
        } catch (\Throwable $e) {
            // Fall back to basic detail if central fetch fails
        }

        if ($recipients === []) {
            $recipients = [
                [
                    'userId' => (string) ($mappedNotification['createdBy'] ?? ''),
                    'userName' => $this->nullableString($mappedNotification['createdByName'] ?? null),
                    'userRole' => null,
                    'deploymentKey' => null,
                    'deploymentName' => null,
                    'isRead' => $isRead,
                    'readAt' => $mappedNotification['readAt'] ?? null,
                    'actionResult' => $mappedNotification['actionResult'] ?? null,
                    'actedAt' => $mappedNotification['actedAt'] ?? null,
                ],
            ];
        }

        $readCount = count(array_filter($recipients, static fn(array $r): bool => (bool) ($r['isRead'] ?? false)));
        $actedCount = count(array_filter($recipients, static fn(array $r): bool => trim((string) ($r['actionResult'] ?? '')) !== ''));
        $acceptedCount = count(array_filter($recipients, static fn(array $r): bool => (string) ($r['actionResult'] ?? '') === 'accepted'));
        $declinedCount = count(array_filter($recipients, static fn(array $r): bool => (string) ($r['actionResult'] ?? '') === 'declined'));

        return [
            'notification' => $mappedNotification,
            'recipients' => $recipients,
            'deployments' => $deployments,
            'summary' => [
                'recipientCount' => count($recipients),
                'readCount' => $readCount,
                'actedCount' => $actedCount,
                'acceptedCount' => $acceptedCount,
                'declinedCount' => $declinedCount,
            ],
        ];
    }

    private function fetchCentralNotificationRecipients(string $notificationId): array
    {
        $settingsRow = $this->capabilityRow();
        $apiUrl = trim((string) ($settingsRow['license_api_url'] ?? ''));
        $ownerToken = trim((string) ($settingsRow['license_owner_token'] ?? ''));
        if ($apiUrl === '' || $notificationId === '') {
            return ['recipients' => [], 'deployments' => []];
        }

        try {
            $response = $this->centralLicenseRequest($apiUrl, $ownerToken, 'fetch_notification_recipients', [
                'id' => $notificationId,
            ]);
            return [
                'recipients' => is_array($response['recipients'] ?? null) ? $response['recipients'] : [],
                'deployments' => is_array($response['deployments'] ?? null) ? $response['deployments'] : [],
            ];
        } catch (\Throwable $e) {
            return ['recipients' => [], 'deployments' => []];
        }
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function fetchCentralDeployments(): array
    {
        $settingsRow = $this->capabilityRow();
        $apiUrl = trim((string) ($settingsRow['license_api_url'] ?? ''));
        $ownerToken = trim((string) ($settingsRow['license_owner_token'] ?? ''));
        if ($apiUrl === '') {
            throw new ApiException(
                'Central server is not configured. Set License API URL and Owner Token in Developer Settings > Capabilities.',
                503,
                'CENTRAL_NOT_CONFIGURED'
            );
        }

        try {
            $response = $this->centralLicenseRequest($apiUrl, $ownerToken, 'list_deployments');
            return is_array($response['deployments'] ?? null) ? $response['deployments'] : [];
        } catch (ApiException $e) {
            throw $e;
        } catch (\Throwable $e) {
            throw new ApiException(
                'Failed to fetch deployments from central server: ' . $e->getMessage(),
                502,
                'CENTRAL_FETCH_FAILED'
            );
        }
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
            'targetDeployments' => $this->normalizeNotificationTargetRoles($row['target_deployments'] ?? $row['targetDeployments'] ?? []),
            'deploymentScope' => trim((string) ($row['deployment_scope'] ?? $row['deploymentScope'] ?? 'all')),
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
        $terminalPayment = null;
        $processingPayment = null;
        foreach ($payments as $payment) {
            if ((int) ($payment['billingVersion'] ?? 0) !== $billingVersion) {
                continue;
            }

            $status = strtolower(trim((string) ($payment['status'] ?? 'processing')));
            if (in_array($status, ['approved', 'failed', 'canceled', 'cancelled'], true)) {
                $terminalPayment = $payment;
                break;
            }

            if ($processingPayment === null && $status === 'processing') {
                $processingPayment = $payment;
            }
        }

        $currentPayment = $terminalPayment ?? $processingPayment;

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
                '<p>A renewal payment is being processed. The subscription will be available again within 10 minutes.</p><p><a href="' . htmlspecialchars($linkUrl, ENT_QUOTES, 'UTF-8') . '">Click Here</a> to view the subscription status.</p>',
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
                '<p>Your subscription has expired. Please renew it from <strong>Subscriptions</strong>.</p><p>' . ($dueLabel !== '' ? 'Due date: <strong>' . htmlspecialchars($dueLabel, ENT_QUOTES, 'UTF-8') . '</strong>.</p><p>' : '') . '<a href="' . htmlspecialchars($linkUrl, ENT_QUOTES, 'UTF-8') . '">Click Here</a> to renew them.</p>',
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
                '<p>Your subscription will expire soon. Please make the renewal payment before <strong>' . htmlspecialchars($dueLabel, ENT_QUOTES, 'UTF-8') . '</strong>.</p><p><a href="' . htmlspecialchars($linkUrl, ENT_QUOTES, 'UTF-8') . '">Click Here</a> to open the subscription page.</p>',
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

    /**
     * Webhook endpoint: receives notifications pushed from the central server.
     * No authentication required - signature verification is used instead.
     */
    public function receiveCentralNotification(array $params = []): array
    {
        // Get raw body for signature verification
        $rawBody = file_get_contents('php://input') ?: '';
        $body = json_decode($rawBody, true);
        if (!is_array($body)) {
            $body = $params;
        }

        // Verify webhook signature if configured
        $signature = trim((string) ($_SERVER['HTTP_X_MAMEPILOT_SIGNATURE'] ?? ''));
        $settingsRow = $this->capabilityRow();
        $webhookSecret = trim((string) ($settingsRow['webhook_secret'] ?? ''));

        if ($webhookSecret === '') {
            throw new RuntimeException('Notification webhook is not registered with a signing secret.');
        }
        if ($signature === '') {
            throw new RuntimeException('Missing notification webhook signature.');
        }
        $expectedSignature = hash_hmac('sha256', $rawBody, $webhookSecret);
        if (!hash_equals($expectedSignature, $signature)) {
            throw new RuntimeException('Invalid webhook signature.');
        }

        $event = trim((string) ($body['event'] ?? ''));
        if ($event !== 'notification.created') {
            return ['success' => true, 'message' => 'Event ignored.'];
        }

        $notification = $body['notification'] ?? null;
        if (!is_array($notification)) {
            throw new RuntimeException('Missing notification payload.');
        }

        $this->upsertCentralNotificationLocally($notification);

        // Broadcast to connected SSE clients
        $this->broadcastNotificationEvent($notification);

        return ['success' => true, 'message' => 'Notification received and saved.'];
    }

    /**
     * Register this deployment's webhook URL with the central server.
     */
    public function registerWebhookWithCentral(array $params = []): array
    {
        $settingsRow = $this->capabilityRow();
        $apiUrl = trim((string) ($settingsRow['license_api_url'] ?? ''));
        $ownerToken = trim((string) ($settingsRow['license_owner_token'] ?? ''));
        $licenseKey = trim((string) ($settingsRow['license_key'] ?? ''));

        if ($apiUrl === '' || $licenseKey === '') {
            return ['success' => false, 'message' => 'Central server not configured.'];
        }

        // Build the webhook URL for this deployment
        $webhookUrl = trim((string) ($params['webhookUrl'] ?? ''));
        if ($webhookUrl === '') {
            // Auto-detect from current request
            $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
            $host = trim((string) ($_SERVER['HTTP_HOST'] ?? ''));
            $scriptName = trim((string) ($_SERVER['SCRIPT_NAME'] ?? ''));
            if ($host !== '' && $scriptName !== '') {
                $webhookUrl = $scheme . '://' . $host . '/' . ltrim($scriptName, '/') . '?action=receiveCentralNotification';
            }
        }

        if ($webhookUrl === '') {
            return ['success' => false, 'message' => 'Could not determine webhook URL.'];
        }

        // Generate and store webhook secret
        $webhookSecret = trim((string) ($params['webhookSecret'] ?? ''));
        if ($webhookSecret === '') {
            $webhookSecret = bin2hex(random_bytes(32));
        }

        try {
            $response = $this->centralLicenseRequest($apiUrl, $ownerToken, 'register_webhook', [
                'license_key' => $licenseKey,
                'webhook_url' => $webhookUrl,
                'webhook_secret' => $webhookSecret,
            ]);

            // Store the webhook secret locally for signature verification
            $this->updateCapabilitySettings([
                '__skipDeveloperCheck' => true,
                'webhookSecret' => $webhookSecret,
                'webhookUrl' => $webhookUrl,
            ]);

            return ['success' => true, 'message' => 'Webhook registered with central server.', 'webhookUrl' => $webhookUrl];
        } catch (\Throwable $e) {
            return ['success' => false, 'message' => 'Failed to register webhook: ' . $e->getMessage()];
        }
    }

    /**
     * Unregister this deployment's webhook from the central server.
     */
    public function unregisterWebhookFromCentral(array $params = []): array
    {
        $settingsRow = $this->capabilityRow();
        $apiUrl = trim((string) ($settingsRow['license_api_url'] ?? ''));
        $ownerToken = trim((string) ($settingsRow['license_owner_token'] ?? ''));
        $licenseKey = trim((string) ($settingsRow['license_key'] ?? ''));

        if ($apiUrl === '' || $licenseKey === '') {
            return ['success' => false, 'message' => 'Central server not configured.'];
        }

        $webhookUrl = trim((string) ($settingsRow['webhook_url'] ?? ''));

        try {
            $response = $this->centralLicenseRequest($apiUrl, $ownerToken, 'unregister_webhook', [
                'license_key' => $licenseKey,
                'webhook_url' => $webhookUrl,
            ]);

            return ['success' => true, 'message' => 'Webhook unregistered from central server.'];
        } catch (\Throwable $e) {
            return ['success' => false, 'message' => 'Failed to unregister webhook: ' . $e->getMessage()];
        }
    }

    /**
     * Broadcast notification event to connected SSE clients.
     */
    private function broadcastNotificationEvent(array $notification): void
    {
        $broadcastDir = sys_get_temp_dir() . '/mamepilot_notification_broadcasts';
        if (!is_dir($broadcastDir)) {
            @mkdir($broadcastDir, 0777, true);
        }

        // Use microtime for unique filenames to avoid overwrites
        $microtime = microtime(true);
        $filename = $broadcastDir . '/evt_' . str_replace('.', '_', sprintf('%.6f', $microtime)) . '_' . bin2hex(random_bytes(4)) . '.json';

        $payload = json_encode([
            'event' => 'notification.created',
            'notification' => $notification,
            'timestamp' => $microtime,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        @file_put_contents($filename, $payload);

        // Clean up old broadcast files (older than 60 seconds)
        $cutoff = $microtime - 60;
        $files = glob($broadcastDir . '/evt_*.json');
        if (is_array($files)) {
            foreach ($files as $f) {
                if (filemtime($f) < $cutoff) {
                    @unlink($f);
                }
            }
        }
    }

    /**
     * SSE endpoint: streams real-time notification events to the frontend.
     */
    public function streamNotifications(array $params = []): void
    {
        // For SSE, we need to authenticate via query param since EventSource doesn't support headers
        $token = trim((string) ($_GET['token'] ?? $params['token'] ?? ''));
        if ($token !== '') {
            // Validate token and get user
            $user = $this->auth->userFromToken($token);
            if ($user === null) {
                http_response_code(401);
                echo "event: error\ndata: {\"error\": \"Invalid token\"}\n\n";
                flush();
                return;
            }
        } else {
            $user = $this->currentUser();
        }

        // Set SSE headers
        header('Content-Type: text/event-stream');
        header('Cache-Control: no-cache');
        header('Connection: keep-alive');
        header('X-Accel-Buffering: no');

        $broadcastDir = sys_get_temp_dir() . '/mamepilot_notification_broadcasts';
        $lastEventTime = 0.0;
        $heartbeatInterval = 30; // seconds
        $lastHeartbeat = time();

        // Disable output buffering
        while (ob_get_level() > 0) {
            ob_end_flush();
        }

        echo "event: connected\ndata: " . json_encode(['userId' => (string) ($user['id'] ?? ''), 'role' => (string) ($user['role'] ?? '')]) . "\n\n";
        flush();

        while (true) {
            // Check for broadcast files in the directory
            if (is_dir($broadcastDir)) {
                $files = glob($broadcastDir . '/evt_*.json');
                if (is_array($files)) {
                    // Sort by filename which encodes microtime
                    sort($files);
                    foreach ($files as $file) {
                        $content = @file_get_contents($file);
                        if ($content === false) {
                            continue;
                        }
                        $data = json_decode($content, true);
                        if (!is_array($data)) {
                            continue;
                        }
                        $ts = (float) ($data['timestamp'] ?? 0);
                        if ($ts <= $lastEventTime) {
                            continue;
                        }
                        $lastEventTime = $ts;

                        // Check if this notification targets the user's role
                        $notification = $data['notification'] ?? [];
                        $targetRoles = $notification['targetRoles'] ?? [];
                        $userRole = (string) ($user['role'] ?? '');

                        if (empty($targetRoles) || in_array($userRole, $targetRoles, true)) {
                            echo "event: notification\ndata: " . json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n\n";
                            flush();
                        }
                    }
                }
            }

            // Send heartbeat
            if (time() - $lastHeartbeat >= $heartbeatInterval) {
                echo ": heartbeat\n\n";
                flush();
                $lastHeartbeat = time();
            }

            // Check if client disconnected
            if (connection_aborted()) {
                break;
            }

            usleep(200000); // 200ms polling (reduced from 500ms)
        }
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
                     ORDER BY COALESCE(n.starts_at, n.created_at) DESC, n.created_at DESC"
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
                     ORDER BY COALESCE(n.starts_at, n.created_at) DESC, n.created_at DESC",
                $queryBindings
            );
        } catch (\Throwable $e) {
            $rows = [];
        }

        $items = array_map(fn(array $row): array => $this->mapNotification($row), $rows);
        $indexedItems = [];
        foreach ($items as $item) {
            $indexedItems[(string) ($item['id'] ?? '')] = $item;
        }

        try {
            $centralNotifications = $this->fetchCentralNotifications([
                'targetRoles' => [trim((string) ($user['role'] ?? ''))],
                'userId' => (string) ($user['id'] ?? ''),
            ]);
            foreach ($centralNotifications as $notification) {
                if (!is_array($notification)) {
                    continue;
                }
                $notificationId = trim((string) ($notification['id'] ?? ''));
                if ($notificationId === '') {
                    continue;
                }
                // Cache central notification locally so it persists even if central fetch fails later.
                $this->upsertCentralNotificationLocally($notification);

                $isRead = (bool) ($notification['isRead'] ?? false);
                if (array_key_exists($notificationId, $indexedItems)) {
                    if ($isRead) {
                        unset($indexedItems[$notificationId]);
                        continue;
                    }
                    $indexedItems[$notificationId] = $this->mapCentralNotification($notification);
                    continue;
                }

                if ($isRead) {
                    continue;
                }

                $indexedItems[$notificationId] = $this->mapCentralNotification($notification);
            }
        } catch (Throwable) {
            // Ignore central fetch failures and continue with local notifications.
        }

        $items = array_values($indexedItems);
        usort($items, static fn(array $a, array $b): int => strcmp((string) ($b['updatedAt'] ?? ''), (string) ($a['updatedAt'] ?? '')));

        $unreadCount = count(array_filter(
            $items,
            static fn(array $item): bool => !((bool) ($item['isRead'] ?? false)) && ((bool) ($item['isActive'] ?? true))
        ));

        return [
            'items' => array_slice($items, 0, 200),
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

        $localRows = [];
        try {
            $localRows = $this->database->fetchAll(
                $hasReceiptsTable
                ? "SELECT
                            n.*,
                            creator.name AS created_by_name,
                            IFNULL(nr.is_read, 0) AS is_read,
                            nr.read_at,
                            nr.action_result,
                            nr.acted_at
                         FROM notifications n
                         LEFT JOIN users creator ON creator.id = n.created_by
                         LEFT JOIN notification_receipts nr ON nr.notification_id = n.id AND nr.user_id = :user_id
                        WHERE n.target_roles LIKE :role_needle
                          AND (n.starts_at IS NULL OR n.starts_at <= :starts_now)
                          AND (n.ends_at IS NULL OR n.ends_at >= :ends_now)
                          AND n.is_active = 1
                         ORDER BY COALESCE(n.starts_at, n.created_at) DESC, n.created_at DESC"
                : "SELECT
                            n.*,
                            creator.name AS created_by_name,
                            0 AS is_read,
                            NULL AS read_at,
                            NULL AS action_result,
                            NULL AS acted_at
                         FROM notifications n
                         LEFT JOIN users creator ON creator.id = n.created_by
                        WHERE n.target_roles LIKE :role_needle
                          AND (n.starts_at IS NULL OR n.starts_at <= :starts_now)
                          AND (n.ends_at IS NULL OR n.ends_at >= :ends_now)
                          AND n.is_active = 1
                         ORDER BY COALESCE(n.starts_at, n.created_at) DESC, n.created_at DESC",
                $queryBindings
            );
        } catch (\Throwable $e) {
            // Ignore local fetch failures and fall back to remote-only result set.
        }

        $items = array_map(fn(array $row): array => $this->mapNotification($row), $localRows);
        usort($items, static fn(array $a, array $b): int => strcmp((string) ($b['updatedAt'] ?? ''), (string) ($a['updatedAt'] ?? '')));

        $remoteItems = [];
        try {
            $centralNotifications = $this->fetchCentralNotifications([
                'targetRoles' => [trim((string) ($user['role'] ?? ''))],
                'userId' => (string) ($user['id'] ?? ''),
            ]);
            foreach ($centralNotifications as $notification) {
                if (!is_array($notification)) {
                    continue;
                }
                // Cache central notification locally so it persists even if central fetch fails later.
                $this->upsertCentralNotificationLocally($notification);
                $remoteItems[] = $notification;
            }
        } catch (Throwable) {
            // Ignore central fetch failures and continue with local notifications.
        }

        if ($remoteItems !== []) {
            $existingIndexesById = [];
            foreach ($items as $index => $item) {
                $existingId = trim((string) ($item['id'] ?? ''));
                if ($existingId !== '') {
                    $existingIndexesById[$existingId] = $index;
                }
            }

            foreach ($remoteItems as $notification) {
                $notificationId = trim((string) ($notification['id'] ?? ''));
                if ($notificationId === '') {
                    continue;
                }

                $mappedNotification = $this->mapCentralNotification($notification);
                if (array_key_exists($notificationId, $existingIndexesById)) {
                    $items[$existingIndexesById[$notificationId]] = $mappedNotification;
                    continue;
                }

                $existingIndexesById[$notificationId] = count($items);
                $items[] = $mappedNotification;
            }
            usort($items, static fn(array $a, array $b): int => strcmp((string) ($b['updatedAt'] ?? ''), (string) ($a['updatedAt'] ?? '')));
        }

        $total = count($items);
        $totalPages = max(1, (int) ceil($total / $pageSize));
        $pageItems = array_slice($items, $offset, $pageSize);

        return [
            'items' => $pageItems,
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

        try {
            $this->syncCentralNotifications([]);
        } catch (Throwable) {
            // Ignore central sync failures and continue with local notifications.
        }

        $items = [];
        try {
            $rows = $this->database->fetchAll(
                "SELECT n.*, creator.name AS created_by_name
                 FROM notifications n
                 LEFT JOIN users creator ON creator.id = n.created_by
                 ORDER BY n.created_at DESC
                 LIMIT 500"
            );
            $items = array_map(fn(array $row): array => $this->mapNotification($row), $rows);
        } catch (\Throwable $e) {
            // Ignore local fetch failures and continue with remote results only.
        }

        usort($items, static fn(array $a, array $b): int => strcmp((string) ($b['updatedAt'] ?? ''), (string) ($a['updatedAt'] ?? '')));
        return array_slice($items, 0, 500);
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

        $items = [];
        try {
            $rows = $this->database->fetchAll(
                "SELECT n.*, creator.name AS created_by_name
                 FROM notifications n
                 LEFT JOIN users creator ON creator.id = n.created_by
                 WHERE (n.system_key IS NULL OR n.system_key NOT LIKE 'central:%')
                 ORDER BY n.created_at DESC"
            );
            $items = array_map(fn(array $row): array => $this->mapNotification($row), $rows);
        } catch (\Throwable $e) {
            // Ignore local fetch failures and continue with remote results only.
        }

        try {
            $centralNotifications = $this->fetchCentralNotifications([
                'userId' => (string) ($this->currentUser()['id'] ?? ''),
                'includeAll' => true,
            ]);
            foreach ($centralNotifications as $notification) {
                if (!is_array($notification)) {
                    continue;
                }
                $items[] = $this->mapCentralNotification($notification);
            }
        } catch (Throwable $e) {
            // Ignore central fetch failures.
        }

        usort($items, static fn(array $a, array $b): int => strcmp((string) ($b['updatedAt'] ?? ''), (string) ($a['updatedAt'] ?? '')));
        $total = count($items);
        $totalPages = $total > 0 ? (int) ceil($total / $pageSize) : 0;

        return [
            'items' => array_slice($items, $offset, $pageSize),
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

        $currentUser = $this->currentUser();
        if ($row !== null) {
            $systemKey = trim((string) ($row['system_key'] ?? ''));
            if ($systemKey !== '' && strpos($systemKey, 'central:') === 0) {
                $centralNotification = $this->fetchCentralNotifications([
                    'id' => $notificationId,
                    'userId' => (string) ($currentUser['id'] ?? ''),
                ]);
                if (is_array($centralNotification) && count($centralNotification) === 1) {
                    return $this->buildCentralNotificationDetailPayload($centralNotification[0]);
                }
            }

            return $this->buildNotificationDetailPayload($row);
        }

        $centralNotification = $this->fetchCentralNotifications([
            'id' => $notificationId,
            'userId' => (string) ($currentUser['id'] ?? ''),
        ]);
        if (is_array($centralNotification) && count($centralNotification) === 1) {
            return $this->buildCentralNotificationDetailPayload($centralNotification[0]);
        }

        return null;
    }

    public function fetchDeployments(array $params = []): array
    {
        $this->requireDeveloperUser();
        return $this->fetchCentralDeployments();
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
        $endsAt = array_key_exists('endsAt', $params) ? $this->nullableString($params['endsAt']) : null;
        $endsAt = $endsAt !== null ? $this->normalizeDateTimeInput($endsAt) : null;
        $actionConfig = $this->normalizeNotificationActionConfig($params['actionConfig'] ?? [], $targetRoles);
        $metadata = array_key_exists('metadata', $params)
            ? (is_array($params['metadata']) ? $params['metadata'] : (is_string($params['metadata']) ? json_decode((string) $params['metadata'], true) : []))
            : [];
        if (!is_array($metadata)) {
            $metadata = [];
        }

        $settingsRow = $this->capabilityRow();
        $apiUrl = trim((string) ($settingsRow['license_api_url'] ?? ''));
        $ownerToken = trim((string) ($settingsRow['license_owner_token'] ?? ''));

        $targetDeployments = $this->normalizeNotificationTargetRoles($params['targetDeployments'] ?? []);
        $deploymentScope = trim((string) ($params['deploymentScope'] ?? 'all'));
        if (!in_array($deploymentScope, ['all', 'include', 'exclude'], true)) {
            $deploymentScope = 'all';
        }

        $payload = [
            'subject' => $subject,
            'contentHtml' => $contentHtml,
            'targetRoles' => $targetRoles,
            'targetDeployments' => $targetDeployments,
            'deploymentScope' => $deploymentScope,
            'startsAt' => $startsAt,
            'endsAt' => $endsAt,
            'actionConfig' => $actionConfig,
            'metadata' => $metadata,
        ];

        if ($apiUrl !== '') {
            try {
                $response = $this->centralLicenseRequest($apiUrl, $ownerToken, 'create_notification', $payload);
                if (!is_array($response['notification'] ?? null)) {
                    throw new RuntimeException('Central notification response is invalid.');
                }

                $notification = $response['notification'];
                $this->upsertCentralNotificationLocally($notification);
                return array_merge(
                    ['isRead' => false, 'isActive' => true, 'createdBy' => null, 'createdByName' => null, 'actionResult' => null, 'actedAt' => null],
                    $notification
                );
            } catch (\Throwable $e) {
                throw new RuntimeException('Failed to create notification on central server: ' . $e->getMessage());
            }
        }

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
                ':ends_at' => $endsAt,
                ':action_config' => $this->jsonEncode($actionConfig),
                ':metadata' => $this->jsonEncode($metadata),
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
        $requestedIds = [];
        $primaryId = trim((string) ($params['notificationId'] ?? ''));
        if ($primaryId !== '') {
            $requestedIds[] = $primaryId;
        }
        if (is_array($params['notificationIds'] ?? null)) {
            foreach ($params['notificationIds'] as $candidateId) {
                $trimmedId = trim((string) $candidateId);
                if ($trimmedId !== '' && !in_array($trimmedId, $requestedIds, true)) {
                    $requestedIds[] = $trimmedId;
                }
            }
        }

        if ($requestedIds === []) {
            return ['success' => true];
        }

        $roleNeedle = '%"' . trim((string) ($user['role'] ?? '')) . '"%';
        $localAllowedIds = [];
        $centralIds = [];
        $missingIds = $requestedIds;

        if ($this->tableExists('notifications')) {
            if (count($requestedIds) === 1) {
                $notification = $this->database->fetchOne(
                    'SELECT id, target_roles, system_key FROM notifications WHERE id = :id AND target_roles LIKE :role_needle LIMIT 1',
                    [
                        ':id' => $requestedIds[0],
                        ':role_needle' => $roleNeedle,
                    ]
                );
                if ($notification !== null) {
                    $systemKey = trim((string) ($notification['system_key'] ?? ''));
                    if (strpos($systemKey, 'central:') === 0) {
                        $centralIds[] = (string) ($notification['id'] ?? '');
                    } else {
                        $localAllowedIds[] = (string) ($notification['id'] ?? '');
                    }
                    $missingIds = [];
                }
            } else {
                [$placeholders, $bindings] = $this->inClause($requestedIds, 'notification_id');
                $rows = $this->database->fetchAll(
                    'SELECT id, system_key FROM notifications WHERE id IN (' . implode(', ', $placeholders) . ') AND target_roles LIKE :role_needle',
                    [':role_needle' => $roleNeedle] + $bindings
                );
                foreach ($rows as $row) {
                    $id = (string) ($row['id'] ?? '');
                    $systemKey = trim((string) ($row['system_key'] ?? ''));
                    if (strpos($systemKey, 'central:') === 0) {
                        $centralIds[] = $id;
                    } else {
                        $localAllowedIds[] = $id;
                    }
                }
                $missingIds = array_values(array_diff($requestedIds, array_merge($localAllowedIds, $centralIds)));
            }
        }

        $settingsRow = $this->capabilityRow();
        $apiUrl = trim((string) ($settingsRow['license_api_url'] ?? ''));
        $ownerToken = trim((string) ($settingsRow['license_owner_token'] ?? ''));
        if ($missingIds !== [] && $apiUrl !== '') {
            foreach ($missingIds as $missingId) {
                try {
                    $centralNotifications = $this->fetchCentralNotifications([
                        'id' => $missingId,
                        'userId' => (string) ($user['id'] ?? ''),
                    ]);
                    if (is_array($centralNotifications) && count($centralNotifications) === 1) {
                        $notification = $centralNotifications[0];
                        $targetRoles = $this->normalizeNotificationTargetRoles($notification['targetRoles'] ?? $notification['target_roles'] ?? []);
                        if (in_array((string) ($user['role'] ?? ''), $targetRoles, true)) {
                            $centralIds[] = $missingId;
                        }
                    }
                } catch (Throwable $e) {
                    // Ignore central lookup failures for missing IDs.
                }
            }
        }

        $centralIds = array_values(array_unique(array_filter($centralIds)));
        if ($centralIds !== [] && $apiUrl !== '') {
            try {
                $settingsRowForLicense = $this->capabilityRow();
                $this->centralLicenseRequest($apiUrl, $ownerToken, 'mark_notification_read', [
                    'notificationIds' => $centralIds,
                    'userId' => (string) ($user['id'] ?? ''),
                    'licenseKey' => trim((string) ($settingsRowForLicense['license_key'] ?? '')),
                    'userName' => trim((string) ($user['name'] ?? '')),
                    'userRole' => trim((string) ($user['role'] ?? '')),
                ]);
            } catch (Throwable) {
                // Ignore remote mark failures so local notification state can still be updated.
            }
        }

        // Always write local receipt for central IDs regardless of central API success
        if ($centralIds !== [] && $this->tableExists('notification_receipts')) {
            $now = $this->database->nowUtc();
            [$placeholders, $bindings] = $this->inClause($centralIds, 'id');
            $localCentralRows = $this->database->fetchAll(
                'SELECT id FROM notifications WHERE id IN (' . implode(', ', $placeholders) . ')',
                $bindings
            );
            $localCentralIds = array_map(
                fn(array $row): string => (string) ($row['id'] ?? ''),
                $localCentralRows
            );

            foreach ($localCentralIds as $notificationId) {
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
        }

        if ($localAllowedIds === [] || !$this->tableExists('notification_receipts')) {
            return ['success' => true];
        }

        $now = $this->database->nowUtc();
        $this->database->transaction(function () use ($localAllowedIds, $user, $now): void {
            foreach ($localAllowedIds as $notificationId) {
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

        $settingsRow = $this->capabilityRow();
        $apiUrl = trim((string) ($settingsRow['license_api_url'] ?? ''));
        $ownerToken = trim((string) ($settingsRow['license_owner_token'] ?? ''));

        $localNotification = null;
        if ($this->tableExists('notifications')) {
            $localNotification = $this->database->fetchOne(
                'SELECT * FROM notifications WHERE id = :id AND target_roles LIKE :role_needle LIMIT 1 FOR UPDATE',
                [
                    ':id' => $notificationId,
                    ':role_needle' => '%"' . trim((string) ($user['role'] ?? '')) . '"%',
                ]
            );
        }

        $isCentralNotification = false;
        $notification = $localNotification;
        $systemKey = trim((string) ($localNotification['system_key'] ?? ''));
        if ($localNotification === null || strpos($systemKey, 'central:') === 0) {
            $isCentralNotification = true;
            if ($apiUrl !== '') {
                try {
                    $centralResult = $this->fetchCentralNotifications([
                        'id' => $notificationId,
                        'userId' => (string) ($user['id'] ?? ''),
                    ]);
                    if (is_array($centralResult) && count($centralResult) === 1) {
                        $notification = $centralResult[0];
                    }
                } catch (Throwable $e) {
                    if ($localNotification === null) {
                        throw $e;
                    }
                }
            }
        }

        if ($notification === null) {
            throw new RuntimeException('Notification not found.');
        }
        if (((int) ($notification['is_active'] ?? $notification['isActive'] ?? 1)) !== 1) {
            throw new RuntimeException('This notification is no longer active.');
        }

        $targetRoles = $this->normalizeNotificationTargetRoles($notification['target_roles'] ?? $notification['targetRoles'] ?? []);
        if (!in_array((string) ($user['role'] ?? ''), $targetRoles, true)) {
            throw new RuntimeException('This notification is not assigned to your role.');
        }
        $actionConfig = $this->normalizeNotificationActionConfig($notification['action_config'] ?? $notification['actionConfig'] ?? [], $targetRoles);
        $kind = (string) ($actionConfig['kind'] ?? 'none');
        if (!in_array($kind, ['decision', 'link_and_decision'], true)) {
            throw new RuntimeException('This notification does not support decisions.');
        }

        if ($isCentralNotification && $apiUrl !== '') {
            $this->centralLicenseRequest($apiUrl, $ownerToken, 'respond_to_notification', [
                'notificationId' => $notificationId,
                'userId' => (string) ($user['id'] ?? ''),
                'decision' => $decision,
                'resolvedByName' => $this->nullableString($user['name'] ?? null),
                'licenseKey' => trim((string) ($settingsRow['license_key'] ?? '')),
                'userName' => trim((string) ($user['name'] ?? '')),
                'userRole' => trim((string) ($user['role'] ?? '')),
            ]);
            return ['success' => true];
        }

        if (!$this->tableExists('notification_receipts')) {
            throw new RuntimeException('Notifications migration is missing. Run the latest migration first.');
        }

        return $this->database->transaction(function () use ($user, $notificationId, $decision, $notification, $actionConfig): array {
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

    // ── Developer Notes ──────────────────────────────────────────────

    public function fetchDeveloperNotes(array $params = []): array
    {
        $this->requireDeveloperUser();
        $row = $this->database->fetchOne('SELECT content, updated_at FROM developer_notes LIMIT 1');
        return [
            'content' => (string) ($row['content'] ?? ''),
            'updatedAt' => $this->toIso($row['updated_at'] ?? null),
        ];
    }

    public function updateDeveloperNotes(array $params): array
    {
        $user = $this->requireDeveloperUser();
        $content = (string) ($params['content'] ?? '');
        $now = $this->database->nowUtc();
        $userId = (string) ($user['id'] ?? '');

        $existing = $this->database->fetchOne('SELECT id FROM developer_notes LIMIT 1');
        if ($existing !== null) {
            $this->database->execute(
                'UPDATE developer_notes SET content = :content, updated_by = :updated_by, updated_at = :updated_at WHERE id = :id',
                [':content' => $content, ':updated_by' => $userId, ':updated_at' => $now, ':id' => $existing['id']]
            );
        } else {
            $id = $this->stringId(null);
            $this->database->execute(
                'INSERT INTO developer_notes (id, content, updated_by, created_at, updated_at) VALUES (:id, :content, :updated_by, :created_at, :updated_at)',
                [':id' => $id, ':content' => $content, ':updated_by' => $userId, ':created_at' => $now, ':updated_at' => $now]
            );
        }

        return ['success' => true, 'updatedAt' => $now];
    }

    // ── Email Settings ───────────────────────────────────────────────

    public function fetchEmailSettings(array $params = []): array
    {
        $this->requireDeveloperUser();
        $row = $this->database->fetchOne('SELECT * FROM email_settings LIMIT 1');
        if ($row === null) {
            return [
                'recipientEmail' => '',
                'smtpHost' => '',
                'smtpPort' => 587,
                'smtpUsername' => '',
                'smtpPassword' => '',
                'smtpEncryption' => 'tls',
                'senderEmail' => '',
                'senderName' => '',
            ];
        }
        return [
            'recipientEmail' => (string) ($row['recipient_email'] ?? ''),
            'smtpHost' => (string) ($row['smtp_host'] ?? ''),
            'smtpPort' => (int) ($row['smtp_port'] ?? 587),
            'smtpUsername' => (string) ($row['smtp_username'] ?? ''),
            'smtpPassword' => (string) ($row['smtp_password'] ?? ''),
            'smtpEncryption' => (string) ($row['smtp_encryption'] ?? 'tls'),
            'senderEmail' => (string) ($row['sender_email'] ?? ''),
            'senderName' => (string) ($row['sender_name'] ?? ''),
        ];
    }

    public function updateEmailSettings(array $params): array
    {
        $user = $this->requireDeveloperUser();
        $now = $this->database->nowUtc();

        $data = [
            'recipient_email' => $this->nullableString($params['recipientEmail'] ?? null),
            'smtp_host' => $this->nullableString($params['smtpHost'] ?? null),
            'smtp_port' => (int) ($params['smtpPort'] ?? 587),
            'smtp_username' => $this->nullableString($params['smtpUsername'] ?? null),
            'smtp_password' => $this->nullableString($params['smtpPassword'] ?? null),
            'smtp_encryption' => in_array(($params['smtpEncryption'] ?? 'tls'), ['tls', 'ssl', 'none'], true) ? $params['smtpEncryption'] : 'tls',
            'sender_email' => $this->nullableString($params['senderEmail'] ?? null),
            'sender_name' => $this->nullableString($params['senderName'] ?? null),
        ];

        $existing = $this->database->fetchOne('SELECT id FROM email_settings LIMIT 1');
        if ($existing !== null) {
            [$setClause, $setParams] = $this->database->buildSetClause($data);
            $this->database->execute(
                "UPDATE email_settings SET {$setClause}, updated_at = :updated_at WHERE id = :id",
                array_merge($setParams, [':updated_at' => $now, ':id' => $existing['id']])
            );
        } else {
            $id = $this->stringId(null);
            $columns = implode(', ', array_keys($data));
            $placeholders = implode(', ', array_map(fn($k) => ':' . $k, array_keys($data)));
            $bindings = [];
            foreach ($data as $k => $v) {
                $bindings[':' . $k] = $v;
            }
            $bindings[':id'] = $id;
            $bindings[':now'] = $now;
            $this->database->execute(
                "INSERT INTO email_settings (id, {$columns}, created_at, updated_at) VALUES (:id, {$placeholders}, :now, :now)",
                $bindings
            );
        }

        return ['success' => true];
    }

    private function sendPaymentConfirmationEmail(string $kind, array $payment, string $reference, string $gatewayPaymentId): bool
    {
        $amount = number_format((float) ($payment['amount'] ?? 0), 2, '.', ',');
        $safeReference = htmlspecialchars($reference, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeGatewayId = htmlspecialchars($gatewayPaymentId, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $safeAmount = htmlspecialchars($amount, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $isRecharge = $kind === 'recharge';
        $subject = $isRecharge ? 'Auto-calling recharge payment confirmed' : 'Subscription renewal payment confirmed';
        $nextStep = $isRecharge
            ? 'The payment is verified. Process the corresponding AwajDigital balance top-up.'
            : 'The subscription period has been renewed automatically.';
        $html = '<!doctype html><html><body style="font-family:Arial,sans-serif;color:#172033">'
            . '<h2 style="margin:0 0 16px">' . htmlspecialchars($subject, ENT_QUOTES, 'UTF-8') . '</h2>'
            . '<p>' . htmlspecialchars($nextStep, ENT_QUOTES, 'UTF-8') . '</p>'
            . '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse">'
            . '<tr><td><strong>Amount</strong></td><td>BDT ' . $safeAmount . '</td></tr>'
            . '<tr><td><strong>Reference</strong></td><td>' . $safeReference . '</td></tr>'
            . '<tr><td><strong>PipraPay ID</strong></td><td>' . $safeGatewayId . '</td></tr>'
            . '</table></body></html>';

        return $this->sendEmailNotification($subject, $html);
    }

    public function sendEmailNotification(string $subject, string $htmlBody): bool
    {
        $row = $this->database->fetchOne('SELECT * FROM email_settings LIMIT 1');
        if ($row === null) {
            return false;
        }

        $host = trim((string) ($row['smtp_host'] ?? ''));
        $username = trim((string) ($row['smtp_username'] ?? ''));
        $password = (string) ($row['smtp_password'] ?? '');
        $recipient = trim((string) ($row['recipient_email'] ?? ''));
        if ($host === '' || !filter_var($recipient, FILTER_VALIDATE_EMAIL)) {
            return false;
        }

        $port = (int) ($row['smtp_port'] ?? 587);
        $encryption = (string) ($row['smtp_encryption'] ?? 'tls');
        $senderEmail = trim((string) (($row['sender_email'] ?? null) ?: $username));
        $senderName = trim((string) (($row['sender_name'] ?? null) ?: 'MamePilot'));
        if (!filter_var($senderEmail, FILTER_VALIDATE_EMAIL) || $port < 1 || $port > 65535) {
            return false;
        }

        try {
            return $this->sendSmtpMessage(
                $host,
                $port,
                $encryption,
                $username,
                $password,
                $senderEmail,
                $senderName,
                $recipient,
                $subject,
                $htmlBody
            );
        } catch (\Throwable $exception) {
            error_log('[SMTP] Email delivery failed: ' . $exception->getMessage());
            return false;
        }
    }

    private function sendSmtpMessage(
        string $host,
        int $port,
        string $encryption,
        string $username,
        string $password,
        string $senderEmail,
        string $senderName,
        string $recipient,
        string $subject,
        string $htmlBody
    ): bool {
        $remote = ($encryption === 'ssl' ? 'ssl://' : 'tcp://') . $host . ':' . $port;
        $errorNumber = 0;
        $errorMessage = '';
        $socket = @stream_socket_client($remote, $errorNumber, $errorMessage, 20, STREAM_CLIENT_CONNECT);
        if (!is_resource($socket)) {
            throw new RuntimeException('Could not connect to the configured SMTP server.');
        }
        stream_set_timeout($socket, 20);

        try {
            $this->expectSmtpResponse($socket, [220]);
            $serverName = preg_replace('/[^A-Za-z0-9.-]/', '', (string) ($_SERVER['SERVER_NAME'] ?? 'localhost')) ?: 'localhost';
            $this->writeSmtpCommand($socket, 'EHLO ' . $serverName, [250]);

            if ($encryption === 'tls') {
                $this->writeSmtpCommand($socket, 'STARTTLS', [220]);
                if (!@stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) {
                    throw new RuntimeException('SMTP TLS negotiation failed.');
                }
                $this->writeSmtpCommand($socket, 'EHLO ' . $serverName, [250]);
            }

            if ($username !== '') {
                $this->writeSmtpCommand($socket, 'AUTH LOGIN', [334]);
                $this->writeSmtpCommand($socket, base64_encode($username), [334]);
                $this->writeSmtpCommand($socket, base64_encode($password), [235]);
            }

            $this->writeSmtpCommand($socket, 'MAIL FROM:<' . $senderEmail . '>', [250]);
            $this->writeSmtpCommand($socket, 'RCPT TO:<' . $recipient . '>', [250, 251]);
            $this->writeSmtpCommand($socket, 'DATA', [354]);

            $encodedSubject = '=?UTF-8?B?' . base64_encode(str_replace(["\r", "\n"], '', $subject)) . '?=';
            $encodedName = '=?UTF-8?B?' . base64_encode(str_replace(["\r", "\n"], '', $senderName)) . '?=';
            $headers = [
                'Date: ' . gmdate('D, d M Y H:i:s O'),
                'Message-ID: <' . bin2hex(random_bytes(16)) . '@' . $serverName . '>',
                'From: ' . $encodedName . ' <' . $senderEmail . '>',
                'To: <' . $recipient . '>',
                'Reply-To: <' . $senderEmail . '>',
                'Subject: ' . $encodedSubject,
                'MIME-Version: 1.0',
                'Content-Type: text/html; charset=UTF-8',
                'Content-Transfer-Encoding: 8bit',
            ];
            $message = implode("\r\n", $headers) . "\r\n\r\n" . str_replace(["\r\n", "\r"], "\n", $htmlBody);
            $message = str_replace("\n", "\r\n", $message);
            $message = preg_replace('/(?m)^\./', '..', $message) ?? $message;
            fwrite($socket, $message . "\r\n.\r\n");
            $this->expectSmtpResponse($socket, [250]);
            @fwrite($socket, "QUIT\r\n");
            return true;
        } finally {
            fclose($socket);
        }
    }

    /** @param resource $socket */
    private function writeSmtpCommand($socket, string $command, array $expectedCodes): void
    {
        if (fwrite($socket, $command . "\r\n") === false) {
            throw new RuntimeException('Failed to write to the SMTP server.');
        }
        $this->expectSmtpResponse($socket, $expectedCodes);
    }

    /** @param resource $socket */
    private function expectSmtpResponse($socket, array $expectedCodes): void
    {
        $response = '';
        $code = 0;
        while (($line = fgets($socket, 515)) !== false) {
            $response .= $line;
            if (preg_match('/^(\d{3})([ -])/', $line, $matches) === 1) {
                $code = (int) $matches[1];
                if ($matches[2] === ' ') {
                    break;
                }
            }
        }
        if (!in_array($code, $expectedCodes, true)) {
            $safeResponse = trim(preg_replace('/[\r\n]+/', ' ', $response) ?? '');
            throw new RuntimeException('SMTP server rejected the request (' . $code . '): ' . mb_substr($safeResponse, 0, 200));
        }
    }
}
