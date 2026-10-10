<?php

declare(strict_types=1);

namespace App;

use InvalidArgumentException;

final class ExternalDataApi extends BaseService
{
    private const RESOURCE_CONFIG = [
        'orders' => [
            'table' => 'orders', 'alias' => 'o', 'permission' => 'orders.view', 'action' => 'fetchOrdersPage',
            'scope' => 'orders.read', 'sort' => [
                'created_at' => 'o.created_at', 'order_date' => 'o.order_date', 'order_number' => 'o.order_number',
                'total' => 'o.total', 'paid_amount' => 'o.paid_amount', 'status' => 'o.status',
            ],
            'search' => ['o.id', 'o.order_number', 'o.status', 'c.name', 'c.phone', 'o.source_ad', 'o.notes'],
        ],
        'customers' => [
            'table' => 'customers', 'alias' => 'c', 'permission' => 'customers.view', 'action' => 'fetchCustomersPage',
            'scope' => 'customers.read', 'sort' => [
                'created_at' => 'c.created_at', 'name' => 'c.name', 'total_orders' => 'c.total_orders', 'due_amount' => 'c.due_amount',
            ],
            'search' => ['c.id', 'c.name', 'c.phone', 'c.address'],
        ],
        'transactions' => [
            'table' => 'transactions', 'alias' => 't', 'permission' => 'transactions.view', 'action' => 'fetchTransactionsPage',
            'scope' => 'transactions.read', 'sort' => [
                'created_at' => 't.created_at', 'date' => 't.date', 'amount' => 't.amount', 'type' => 't.type',
            ],
            'search' => ['t.id', 't.description', 't.reference_id', 't.category', 'a.name', 'c.name', 'v.name'],
        ],
        'bills' => [
            'table' => 'bills', 'alias' => 'b', 'permission' => 'bills.view', 'action' => 'fetchBillsPage',
            'scope' => 'bills.read', 'sort' => [
                'created_at' => 'b.created_at', 'bill_date' => 'b.bill_date', 'bill_number' => 'b.bill_number',
                'total' => 'b.total', 'paid_amount' => 'b.paid_amount', 'status' => 'b.status',
            ],
            'search' => ['b.id', 'b.bill_number', 'b.status', 'v.name', 'v.phone', 'b.notes'],
        ],
        'vendors' => [
            'table' => 'vendors', 'alias' => 'v', 'permission' => 'vendors.view', 'action' => 'fetchVendorsPage',
            'scope' => 'vendors.read', 'sort' => [
                'created_at' => 'v.created_at', 'name' => 'v.name', 'total_purchases' => 'v.total_purchases', 'due_amount' => 'v.due_amount',
            ],
            'search' => ['v.id', 'v.name', 'v.phone', 'v.address'],
        ],
        'accounts' => [
            'table' => 'accounts', 'alias' => 'a', 'permission' => 'accounts.view', 'action' => 'fetchAccounts',
            'scope' => 'accounts.read', 'sort' => [
                'created_at' => 'a.created_at', 'name' => 'a.name', 'type' => 'a.type', 'current_balance' => 'a.current_balance',
            ],
            'search' => ['a.id', 'a.name', 'a.type'],
        ],
    ];

    public static function matchesPath(string $path): bool
    {
        return preg_match('#(?:^|/)api/v1(?:/|$)#', $path) === 1
            || preg_match('#^/v1(?:/|$)#', $path) === 1;
    }

    /** @return array{status: int, body: array<string, mixed>}|null */
    public function handleRequest(string $method, string $path, array $query, array $body): ?array
    {
        $route = $this->routeFromPath($path);
        if ($route === null) {
            return null;
        }

        [$resource, $recordId] = $route;
        if ($resource === 'keys') {
            $keyId = $recordId !== '' ? $recordId : null;
            $status = $method === 'POST' && $keyId === null ? 201 : 200;
            return ['status' => $status, 'body' => (new ExternalApiKeyService($this->database, $this->auth, $this->config))->handleManagementRequest($method, $keyId, $body)];
        }

        if (!isset(self::RESOURCE_CONFIG[$resource])) {
            throw new ApiException('Unknown external API resource.', 404, 'RESOURCE_NOT_FOUND');
        }
        if ($method !== 'GET') {
            throw new ApiException('External data endpoints are read-only.', 405, 'METHOD_NOT_ALLOWED');
        }

        $secret = Http::bearerToken();
        if ($secret === null) {
            throw new ApiException('API key authentication is required.', 401, 'INVALID_API_KEY');
        }
        $keyService = new ExternalApiKeyService($this->database, $this->auth, $this->config);
        $keyContext = $keyService->authenticate($secret, $resource);
        try {
            $scope = self::RESOURCE_CONFIG[$resource]['scope'];
            if (!in_array($scope, $keyContext['scopes'], true)) {
                throw new ApiException('API key does not have access to this resource.', 403, 'INSUFFICIENT_SCOPE');
            }

            $resourceApi = new self($this->database, $keyContext['auth'], $this->config);
            $response = $resourceApi->readResource($resource, $recordId, $query, $keyContext);
            $keyService->logRequest($keyContext['id'], $resource, $method, $response['status']);
            return $response;
        } catch (ApiException $exception) {
            $keyService->logRequest($keyContext['id'], $resource, $method, $exception->httpStatus());
            throw $exception;
        } catch (\Throwable $exception) {
            $keyService->logRequest($keyContext['id'], $resource, $method, 500);
            throw $exception;
        }
    }

    /** @param array<string, mixed> $keyContext
     *  @return array{status: int, body: array<string, mixed>}
     */
    private function readResource(string $resource, string $recordId, array $query, array $keyContext): array
    {
        $config = self::RESOURCE_CONFIG[$resource];
        $this->currentUser();
        if ($resource === 'accounts' && !empty($query['include_deleted'])) {
            throw new ApiException('Accounts do not support soft-delete filtering.', 422, 'UNSUPPORTED_FILTER');
        }
        if (!$this->currentUserHasPermission($config['permission'])) {
            throw new ApiException('The API key issuer no longer has permission to read this resource.', 403, 'PERMISSION_DENIED');
        }
        (new ServiceLifecycle($this->database, $this->config))->assertActionAllowed($config['action']);
        (new FeatureAccess($this->database, $this->auth))->assertActionAllowed($config['action']);

        if ($resource === 'accounts') {
            $hasBalanceFilter = array_intersect(array_keys($query), [
                'min_opening_balance', 'max_opening_balance', 'min_current_balance', 'max_current_balance',
            ]) !== [];
            if (($hasBalanceFilter || in_array('accounts.read_balance', $keyContext['scopes'], true))
                && !in_array('accounts.read_balance', $keyContext['scopes'], true)) {
                throw new ApiException('API key does not have access to account balances.', 403, 'INSUFFICIENT_SCOPE');
            }
        }

        try {
            $filters = ExternalApiFilters::normalize($resource, $query);
        } catch (InvalidArgumentException $exception) {
            throw new ApiException($exception->getMessage(), 422, 'INVALID_FILTER');
        }
        if ($recordId !== '') {
            if (isset($filters['filters']['ids'])) {
                throw new ApiException('Do not combine a record id path with the ids filter.', 422, 'CONFLICTING_FILTERS');
            }
            $filters['filters']['ids'] = [$recordId];
            $filters['page'] = 1;
            $filters['page_size'] = 1;
        }

        $page = $this->queryResource($resource, $filters, $keyContext['scopes']);
        if ($recordId !== '') {
            if ($page['data'] === []) {
                throw new ApiException('Record not found.', 404, 'RECORD_NOT_FOUND');
            }
            return ['status' => 200, 'body' => ['data' => $page['data'][0]]];
        }

        return [
            'status' => 200,
            'body' => [
                'data' => $page['data'],
                'pagination' => [
                    'page' => $filters['page'],
                    'page_size' => $filters['page_size'],
                    'total' => $page['total'],
                    'has_more' => ($filters['page'] * $filters['page_size']) < $page['total'],
                ],
            ],
        ];
    }

    /** @param array<string, mixed> $filters
     *  @param list<string> $scopes
     *  @return array{data: list<array<string, mixed>>, total: int}
     */
    private function queryResource(string $resource, array $filters, array $scopes): array
    {
        $config = self::RESOURCE_CONFIG[$resource];
        $where = [];
        $bindings = [];
        $alias = $config['alias'];
        $table = $config['table'];
        $joins = '';
        $select = match ($resource) {
            'orders' => 'o.id, o.order_number, o.order_date, o.customer_id, o.page_id, o.created_by, o.status, o.items, o.subtotal, o.discount, o.shipping, o.total, o.paid_amount, o.notes, o.history, o.source_ad, o.created_at, o.updated_at, o.deleted_at, o.deleted_by, o.processed_at, o.courier_assigned_at, o.picked_at, o.completed_at, o.returned_at, o.cancelled_at, o.partial_delivered_at',
            'customers' => 'c.id, c.name, c.phone, c.address, c.total_orders, c.due_amount, c.created_by, c.created_at, c.updated_at, c.deleted_at, c.deleted_by',
            'transactions' => 't.id, t.date, t.type, t.category, t.account_id, t.to_account_id, t.amount, t.description, t.reference_id, t.contact_id, t.payment_method, t.created_by, t.approval_status, t.account_effect_applied, t.created_at, t.updated_at, t.deleted_at, t.deleted_by',
            'bills' => 'b.id, b.bill_number, b.bill_date, b.vendor_id, b.created_by, b.status, b.items, b.subtotal, b.discount, b.shipping, b.total, b.paid_amount, b.notes, b.history, b.created_at, b.updated_at, b.deleted_at, b.deleted_by',
            'vendors' => 'v.id, v.name, v.phone, v.address, v.total_purchases, v.due_amount, v.created_by, v.created_at, v.updated_at, v.deleted_at, v.deleted_by',
            'accounts' => in_array('accounts.read_balance', $scopes, true)
                ? 'a.id, a.name, a.type, a.opening_balance, a.current_balance, a.created_at, a.updated_at'
                : 'a.id, a.name, a.type, a.created_at, a.updated_at',
        };

        if ($resource === 'orders') {
            $joins = ' LEFT JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.created_by';
            $select .= ', c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address, u.name AS creator_name';
        } elseif ($resource === 'bills') {
            $joins = ' LEFT JOIN vendors v ON v.id = b.vendor_id LEFT JOIN users u ON u.id = b.created_by';
            $select .= ', v.name AS vendor_name, v.phone AS vendor_phone, v.address AS vendor_address, u.name AS creator_name';
        } elseif ($resource === 'transactions') {
            $joins = ' LEFT JOIN accounts a ON a.id = t.account_id LEFT JOIN customers c ON c.id = t.contact_id LEFT JOIN vendors v ON v.id = t.contact_id LEFT JOIN users u ON u.id = t.created_by';
            $select .= ', a.name AS account_name, COALESCE(c.name, v.name) AS contact_name, CASE WHEN c.id IS NOT NULL THEN "Customer" WHEN v.id IS NOT NULL THEN "Vendor" ELSE NULL END AS contact_type, u.name AS creator_name';
        }

        $hasDeletedAt = $resource !== 'accounts';
        if ($hasDeletedAt && empty($filters['filters']['include_deleted'])) {
            $where[] = $alias . '.deleted_at IS NULL';
        }
        if ($resource === 'customers' && empty($filters['filters']['include_walkin']) && $this->columnExists('customers', 'is_walkin')) {
            $where[] = 'COALESCE(c.is_walkin, 0) = 0';
        }

        $this->appendIdFilter($where, $bindings, $filters['filters'], $alias . '.id');
        $this->appendSharedFilters($where, $bindings, $filters['filters'], $alias);
        $this->appendResourceFilters($resource, $where, $bindings, $filters['filters']);

        $whereSql = $where === [] ? '' : ' WHERE ' . implode(' AND ', $where);
        $countRow = $this->database->fetchOne(
            "SELECT COUNT(*) AS count FROM `{$table}` {$alias}{$joins}{$whereSql}",
            $bindings
        );

        $sortColumn = $config['sort'][$filters['sort_by']];
        $sortDirection = strtoupper($filters['sort_direction']);
        $offset = ($filters['page'] - 1) * $filters['page_size'];
        $rows = $this->database->fetchAll(
            "SELECT {$select} FROM `{$table}` {$alias}{$joins}{$whereSql}
             ORDER BY {$sortColumn} {$sortDirection}, {$alias}.id {$sortDirection}
             LIMIT {$filters['page_size']} OFFSET {$offset}",
            $bindings
        );

        return [
            'data' => array_map(fn(array $row): array => $this->projectResource($resource, $row, $scopes), $rows),
            'total' => (int) ($countRow['count'] ?? 0),
        ];
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendIdFilter(array &$where, array &$bindings, array $filters, string $column): void
    {
        $ids = $filters['ids'] ?? null;
        if (!is_array($ids) || $ids === []) {
            return;
        }
        [$placeholders, $idBindings] = $this->inClause($ids, 'external_id');
        $where[] = $column . ' IN (' . implode(', ', $placeholders) . ')';
        $bindings += $idBindings;
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendSharedFilters(array &$where, array &$bindings, array $filters, string $alias): void
    {
        foreach ([
            ['created_from', 'created_at', '>='], ['created_to', 'created_at', '<='],
            ['updated_from', 'updated_at', '>='], ['updated_to', 'updated_at', '<='],
            ['updated_since', 'updated_at', '>='],
        ] as [$filter, $column, $operator]) {
            if (!isset($filters[$filter])) {
                continue;
            }
            $binding = ':external_' . $filter;
            $where[] = "{$alias}.{$column} {$operator} {$binding}";
            $bindings[$binding] = $filters[$filter];
        }

        if (isset($filters['search']) && $filters['search'] !== '') {
            $resource = null;
            foreach (self::RESOURCE_CONFIG as $name => $config) {
                if ($config['alias'] === $alias) {
                    $resource = $name;
                    break;
                }
            }
            if ($resource !== null) {
                $searchValue = '%' . str_replace(['=', '%', '_'], ['==', '=%', '=_'], $filters['search']) . '%';
                $clauses = [];
                foreach (self::RESOURCE_CONFIG[$resource]['search'] as $index => $column) {
                    $binding = ':external_search_' . $index;
                    $clauses[] = "CONVERT(COALESCE({$column}, '') USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE {$binding} ESCAPE '='";
                    $bindings[$binding] = $searchValue;
                }
                $where[] = '(' . implode(' OR ', $clauses) . ')';
            }
        }
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendResourceFilters(string $resource, array &$where, array &$bindings, array $filters): void
    {
        match ($resource) {
            'orders' => $this->appendOrderFilters($where, $bindings, $filters),
            'customers' => $this->appendCustomerFilters($where, $bindings, $filters),
            'transactions' => $this->appendTransactionFilters($where, $bindings, $filters),
            'bills' => $this->appendBillFilters($where, $bindings, $filters),
            'vendors' => $this->appendVendorFilters($where, $bindings, $filters),
            'accounts' => $this->appendAccountFilters($where, $bindings, $filters),
        };
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendOrderFilters(array &$where, array &$bindings, array $filters): void
    {
        foreach (['status', 'status_not'] as $statusKey) {
            if (!isset($filters[$statusKey])) continue;
            $statusValues = is_array($filters[$statusKey]) ? $filters[$statusKey] : explode(',', (string) $filters[$statusKey]);
            $filters[$statusKey] = implode(',', array_map(
                static fn($status): string => trim((string) $status) === 'Created' ? 'On Hold' : trim((string) $status),
                $statusValues
            ));
        }
        $canonicalStatus = $this->orderCanonicalStatusSql();
        $this->appendEnumFilter($where, $bindings, $filters, 'status', $canonicalStatus);
        $this->appendEnumFilter($where, $bindings, $filters, 'status_not', $canonicalStatus, true);
        $this->appendEnumFilter($where, $bindings, $filters, 'delivery_status', $this->orderDeliveryStatusSql());
        $this->appendEnumFilter($where, $bindings, $filters, 'payment_status', $this->orderPaymentStatusSql());
        $this->appendExactFilter($where, $bindings, $filters, 'customer_id', 'o.customer_id');
        $this->appendInFilter($where, $bindings, $filters, 'customer_ids', 'o.customer_id');
        $this->appendLikeFilter($where, $bindings, $filters, 'customer_phone', 'c.phone');
        $this->appendLikeFilter($where, $bindings, $filters, 'order_number', 'o.order_number');
        $this->appendExactFilter($where, $bindings, $filters, 'created_by_id', 'o.created_by');
        $this->appendInFilter($where, $bindings, $filters, 'created_by_ids', 'o.created_by');
        $this->appendExactFilter($where, $bindings, $filters, 'source_ad', 'o.source_ad');
        $this->appendExactFilter($where, $bindings, $filters, 'page_id', 'o.page_id');
        if (isset($filters['is_pos'])) {
            if (!$this->columnExists('orders', 'is_pos')) {
                throw new ApiException('is_pos is not supported by this database schema.', 422, 'UNSUPPORTED_FILTER');
            }
            $this->appendBooleanCondition($where, $bindings, $filters, 'is_pos', 'o.is_pos');
        }
        foreach ([
            ['min_amount', 'o.total', '>='], ['max_amount', 'o.total', '<='],
            ['min_paid', 'o.paid_amount', '>='], ['max_paid', 'o.paid_amount', '<='],
            ['min_due', $this->orderDueSql(), '>='], ['max_due', $this->orderDueSql(), '<='],
        ] as [$key, $column, $operator]) {
            $this->appendNumericCondition($where, $bindings, $filters, $key, $column, $operator);
        }
        $this->appendDateRange($where, $bindings, $filters, 'order_date_from', 'order_date_to', 'o.order_date');
        $this->appendStatusEventRange($where, $bindings, $filters, 'orders', [
            'processing' => 'processed_at', 'courier' => 'courier_assigned_at', 'picked' => 'picked_at',
            'delivered' => 'completed_at', 'returned' => 'returned_at', 'cancelled' => 'cancelled_at',
            'partially_delivered' => 'partial_delivered_at', 'exchange_processing' => 'exchange_processing_at',
            'exchange_picked' => 'exchange_picked_at', 'exchange_delivered' => 'exchange_delivered_at',
            'exchange_returned' => 'exchange_returned_at', 'exchange_cancelled' => 'exchange_cancelled_at',
            'repair_processing' => 'repair_processing_at', 'repair_picked' => 'repair_picked_at',
            'repair_delivered' => 'repair_delivered_at', 'repair_returned' => 'repair_returned_at',
            'repair_cancelled' => 'repair_cancelled_at',
        ]);
        $this->appendProductFilter($where, $bindings, $filters, 'o.items');
        $this->appendCourierFilter($where, $bindings, $filters);
    }

    private function orderDeliveryStatusSql(): string
    {
        return "CASE
            WHEN o.status IN ('Returned', 'Exchange returned', 'Repair returned') THEN 'returned'
            WHEN o.status IN ('Cancelled', 'Exchange cancelled', 'Repair canceled') THEN 'cancelled'
            WHEN o.status IN ('partially_delivered', 'pending_partial') OR o.partial_delivered_at IS NOT NULL THEN 'partially_delivered'
            WHEN o.status IN ('Completed', 'Exchange delivered', 'Repair delivered') THEN 'delivered'
            ELSE 'not_delivered'
        END";
    }

    private function orderCanonicalStatusSql(): string
    {
        $history = "CASE WHEN JSON_VALID(o.history) = 1 THEN o.history ELSE '{}' END";
        return "CASE
            WHEN o.status = 'Created' THEN 'On Hold'
            WHEN o.status = 'Processing' AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT({$history}, '$.exchangeProcessing')), '')) <> '' THEN 'Exchange processing'
            WHEN o.status = 'Picked' AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT({$history}, '$.exchangePicked')), '')) <> '' THEN 'Exchange picked'
            WHEN o.status = 'Completed' AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT({$history}, '$.exchangeDelivered')), '')) <> '' THEN 'Exchange delivered'
            WHEN o.status = 'Returned' AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT({$history}, '$.exchangeReturned')), '')) <> '' THEN 'Exchange returned'
            WHEN o.status = 'Cancelled' AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT({$history}, '$.exchangeCancelled')), '')) <> '' THEN 'Exchange cancelled'
            ELSE o.status
        END";
    }

    private function orderPaymentStatusSql(): string
    {
        $settlement = "CASE WHEN o.status IN ('Cancelled', 'Exchange cancelled', 'Repair canceled') THEN 0 ELSE o.total END";
        return "CASE
            WHEN o.paid_amount > {$settlement} THEN 'overpaid'
            WHEN o.paid_amount <= 0 AND LOWER(COALESCE(o.history, '')) LIKE '%refund%' THEN 'refunded'
            WHEN {$settlement} <= 0 THEN 'paid'
            WHEN o.paid_amount <= 0 THEN 'unpaid'
            WHEN o.paid_amount < {$settlement} THEN 'partially_paid'
            ELSE 'paid'
        END";
    }

    private function orderDueSql(): string
    {
        return 'GREATEST((CASE WHEN o.status IN ("Cancelled", "Exchange cancelled", "Repair canceled") THEN 0 ELSE o.total END) - o.paid_amount, 0)';
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendCustomerFilters(array &$where, array &$bindings, array $filters): void
    {
        $this->appendLikeFilter($where, $bindings, $filters, 'name', 'c.name');
        $this->appendLikeFilter($where, $bindings, $filters, 'phone', 'c.phone');
        $this->appendLikeFilter($where, $bindings, $filters, 'address', 'c.address');
        $this->appendExactFilter($where, $bindings, $filters, 'created_by_id', 'c.created_by');
        $this->appendInFilter($where, $bindings, $filters, 'created_by_ids', 'c.created_by');
        foreach ([
            ['total_orders_min', 'c.total_orders', '>='], ['total_orders_max', 'c.total_orders', '<='],
            ['due_min', 'c.due_amount', '>='], ['due_max', 'c.due_amount', '<='],
        ] as [$key, $column, $operator]) {
            $this->appendNumericCondition($where, $bindings, $filters, $key, $column, $operator);
        }
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendTransactionFilters(array &$where, array &$bindings, array $filters): void
    {
        $this->appendEnumFilter($where, $bindings, $filters, 'type', 't.type');
        $this->appendEnumFilter($where, $bindings, $filters, 'type_in', 't.type');
        $this->appendEnumFilter($where, $bindings, $filters, 'type_not', 't.type', true);
        $this->appendEnumFilter($where, $bindings, $filters, 'approval_status', 't.approval_status');
        $this->appendInFilter($where, $bindings, $filters, 'category_ids', 't.category');
        $this->appendExactFilter($where, $bindings, $filters, 'category', 't.category');
        $this->appendInFilter($where, $bindings, $filters, 'account_ids', 't.account_id');
        $this->appendExactFilter($where, $bindings, $filters, 'account_id', 't.account_id');
        $this->appendExactFilter($where, $bindings, $filters, 'to_account_id', 't.to_account_id');
        $this->appendExactFilter($where, $bindings, $filters, 'contact_id', 't.contact_id');
        $this->appendEnumFilter($where, $bindings, $filters, 'contact_type', 'CASE WHEN c.id IS NOT NULL THEN "Customer" WHEN v.id IS NOT NULL THEN "Vendor" ELSE NULL END');
        $this->appendLikeFilter($where, $bindings, $filters, 'payment_method', 't.payment_method');
        $this->appendExactFilter($where, $bindings, $filters, 'reference_id', 't.reference_id');
        $this->appendBooleanCondition($where, $bindings, $filters, 'account_effect_applied', 't.account_effect_applied');
        $this->appendExactFilter($where, $bindings, $filters, 'created_by_id', 't.created_by');
        $this->appendInFilter($where, $bindings, $filters, 'created_by_ids', 't.created_by');
        if (isset($filters['recurring_transaction_id']) && !$this->columnExists('transactions', 'recurring_transaction_id')) {
            throw new ApiException('recurring_transaction_id is not supported by this database schema.', 422, 'UNSUPPORTED_FILTER');
        }
        $this->appendExactFilter($where, $bindings, $filters, 'recurring_transaction_id', 't.recurring_transaction_id');
        $this->appendNumericCondition($where, $bindings, $filters, 'min_amount', 't.amount', '>=');
        $this->appendNumericCondition($where, $bindings, $filters, 'max_amount', 't.amount', '<=');
        $this->appendDateRange($where, $bindings, $filters, 'transaction_date_from', 'transaction_date_to', 't.date');
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendBillFilters(array &$where, array &$bindings, array $filters): void
    {
        $this->appendEnumFilter($where, $bindings, $filters, 'status', 'b.status');
        $this->appendEnumFilter($where, $bindings, $filters, 'status_not', 'b.status', true);
        $billStatusSql = "CASE
            WHEN b.status = 'Returned' OR TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(b.history, '$.returned')), '')) <> '' THEN 'returned'
            WHEN b.status = 'Cancelled' OR TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(b.history, '$.cancelled')), '')) <> '' THEN 'cancelled'
            WHEN b.status IN ('Received', 'Paid') THEN 'received'
            ELSE LOWER(REPLACE(b.status, ' ', '_'))
        END";
        $settlement = "CASE WHEN {$billStatusSql} = 'cancelled' THEN 0 WHEN {$billStatusSql} = 'returned' AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(b.history, '$.return')), '')) = '' THEN 0 ELSE b.total END";
        $paymentStatusSql = "CASE WHEN b.paid_amount > {$settlement} THEN 'overpaid' WHEN b.paid_amount <= 0 AND LOWER(COALESCE(b.history, '')) LIKE '%refund%' THEN 'refunded' WHEN {$settlement} <= 0 THEN 'paid' WHEN b.paid_amount <= 0 THEN 'unpaid' WHEN b.paid_amount < {$settlement} THEN 'partially_paid' ELSE 'paid' END";
        $this->appendEnumFilter($where, $bindings, $filters, 'bill_status', $billStatusSql);
        $this->appendEnumFilter($where, $bindings, $filters, 'payment_status', $paymentStatusSql);
        $this->appendExactFilter($where, $bindings, $filters, 'vendor_id', 'b.vendor_id');
        $this->appendInFilter($where, $bindings, $filters, 'vendor_ids', 'b.vendor_id');
        $this->appendLikeFilter($where, $bindings, $filters, 'vendor_name', 'v.name');
        $this->appendLikeFilter($where, $bindings, $filters, 'vendor_phone', 'v.phone');
        $this->appendLikeFilter($where, $bindings, $filters, 'bill_number', 'b.bill_number');
        $this->appendExactFilter($where, $bindings, $filters, 'created_by_id', 'b.created_by');
        $this->appendInFilter($where, $bindings, $filters, 'created_by_ids', 'b.created_by');
        $this->appendNumericCondition($where, $bindings, $filters, 'min_amount', 'b.total', '>=');
        $this->appendNumericCondition($where, $bindings, $filters, 'max_amount', 'b.total', '<=');
        $this->appendNumericCondition($where, $bindings, $filters, 'min_paid', 'b.paid_amount', '>=');
        $this->appendNumericCondition($where, $bindings, $filters, 'max_paid', 'b.paid_amount', '<=');
        $dueSql = "GREATEST({$settlement} - b.paid_amount, 0)";
        $this->appendNumericCondition($where, $bindings, $filters, 'min_due', $dueSql, '>=');
        $this->appendNumericCondition($where, $bindings, $filters, 'max_due', $dueSql, '<=');
        $this->appendDateRange($where, $bindings, $filters, 'bill_date_from', 'bill_date_to', 'b.bill_date');
        $this->appendStatusEventRange($where, $bindings, $filters, 'bills', [
            'processing' => 'processed_at', 'received' => 'received_at', 'paid' => 'paid_at',
            'returned' => 'returned_at', 'cancelled' => 'cancelled_at',
        ]);
        $this->appendProductFilter($where, $bindings, $filters, 'b.items');
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendVendorFilters(array &$where, array &$bindings, array $filters): void
    {
        $this->appendLikeFilter($where, $bindings, $filters, 'name', 'v.name');
        $this->appendLikeFilter($where, $bindings, $filters, 'phone', 'v.phone');
        $this->appendLikeFilter($where, $bindings, $filters, 'address', 'v.address');
        $this->appendExactFilter($where, $bindings, $filters, 'created_by_id', 'v.created_by');
        $this->appendInFilter($where, $bindings, $filters, 'created_by_ids', 'v.created_by');
        $this->appendNumericCondition($where, $bindings, $filters, 'total_purchases_min', 'v.total_purchases', '>=');
        $this->appendNumericCondition($where, $bindings, $filters, 'total_purchases_max', 'v.total_purchases', '<=');
        $this->appendNumericCondition($where, $bindings, $filters, 'payable_min', 'v.due_amount', '>=');
        $this->appendNumericCondition($where, $bindings, $filters, 'payable_max', 'v.due_amount', '<=');
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendAccountFilters(array &$where, array &$bindings, array $filters): void
    {
        $this->appendLikeFilter($where, $bindings, $filters, 'name', 'a.name');
        $this->appendEnumFilter($where, $bindings, $filters, 'type', 'a.type');
        foreach ([
            ['min_opening_balance', 'a.opening_balance', '>='], ['max_opening_balance', 'a.opening_balance', '<='],
            ['min_current_balance', 'a.current_balance', '>='], ['max_current_balance', 'a.current_balance', '<='],
        ] as [$key, $column, $operator]) {
            $this->appendNumericCondition($where, $bindings, $filters, $key, $column, $operator);
        }
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendExactFilter(array &$where, array &$bindings, array $filters, string $key, string $column): void
    {
        if (!isset($filters[$key]) || $filters[$key] === '') return;
        $binding = ':external_' . $key;
        $where[] = "{$column} = {$binding}";
        $bindings[$binding] = $filters[$key];
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendLikeFilter(array &$where, array &$bindings, array $filters, string $key, string $column): void
    {
        if (!isset($filters[$key]) || $filters[$key] === '') return;
        $binding = ':external_' . $key;
        $where[] = "CONVERT(COALESCE({$column}, '') USING utf8mb4) COLLATE utf8mb4_unicode_ci LIKE {$binding} ESCAPE '='";
        $bindings[$binding] = '%' . str_replace(['=', '%', '_'], ['==', '=%', '=_'], $filters[$key]) . '%';
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendEnumFilter(array &$where, array &$bindings, array $filters, string $key, string $column, bool $exclude = false): void
    {
        if (!isset($filters[$key]) || $filters[$key] === '') return;
        $values = is_array($filters[$key]) ? $filters[$key] : array_map('trim', explode(',', (string) $filters[$key]));
        $values = array_values(array_filter(array_map('strval', $values), static fn(string $value): bool => $value !== ''));
        if ($values === []) return;
        [$placeholders, $valueBindings] = $this->inClause($values, 'external_' . $key);
        $where[] = $column . ($exclude ? ' NOT IN (' : ' IN (') . implode(', ', $placeholders) . ')';
        $bindings += $valueBindings;
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendInFilter(array &$where, array &$bindings, array $filters, string $key, string $column): void
    {
        if (!isset($filters[$key])) return;
        $values = is_array($filters[$key]) ? $filters[$key] : array_map('trim', explode(',', (string) $filters[$key]));
        $values = array_values(array_filter(array_map('strval', $values), static fn(string $value): bool => $value !== ''));
        if ($values === []) return;
        [$placeholders, $valueBindings] = $this->inClause($values, 'external_' . $key);
        $where[] = $column . ' IN (' . implode(', ', $placeholders) . ')';
        $bindings += $valueBindings;
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendNumericCondition(array &$where, array &$bindings, array $filters, string $key, string $column, string $operator): void
    {
        if (!isset($filters[$key])) return;
        $binding = ':external_' . $key;
        $where[] = "{$column} {$operator} {$binding}";
        $bindings[$binding] = $filters[$key];
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendBooleanCondition(array &$where, array &$bindings, array $filters, string $key, string $column): void
    {
        if (!isset($filters[$key])) return;
        $binding = ':external_' . $key;
        $where[] = "{$column} = {$binding}";
        $bindings[$binding] = $filters[$key] ? 1 : 0;
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendDateRange(array &$where, array &$bindings, array $filters, string $fromKey, string $toKey, string $column): void
    {
        $this->appendNumericCondition($where, $bindings, $filters, $fromKey, $column, '>=');
        $this->appendNumericCondition($where, $bindings, $filters, $toKey, $column, '<=');
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     *  @param array<string, string> $eventColumns
     */
    private function appendStatusEventRange(array &$where, array &$bindings, array $filters, string $table, array $eventColumns): void
    {
        if (!isset($filters['status_changed_from']) && !isset($filters['status_changed_to'])) return;
        $event = (string) ($filters['status_event'] ?? '');
        $column = $eventColumns[$event] ?? null;
        if ($column === null || !$this->columnExists($table, $column)) {
            throw new ApiException('status_event is missing or unsupported for this resource.', 422, 'UNSUPPORTED_FILTER');
        }
        $tableAlias = $table === 'orders' ? 'o' : 'b';
        if (isset($filters['status_changed_from'])) {
            $where[] = "{$tableAlias}.{$column} >= :external_status_from";
            $bindings[':external_status_from'] = $filters['status_changed_from'];
        }
        if (isset($filters['status_changed_to'])) {
            $where[] = "{$tableAlias}.{$column} <= :external_status_to";
            $bindings[':external_status_to'] = $filters['status_changed_to'];
        }
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendProductFilter(array &$where, array &$bindings, array $filters, string $itemsColumn): void
    {
        $productIds = [];
        if (isset($filters['product_id'])) $productIds[] = (string) $filters['product_id'];
        if (isset($filters['product_ids']) && is_array($filters['product_ids'])) $productIds = array_merge($productIds, $filters['product_ids']);
        $productIds = array_values(array_unique(array_filter($productIds)));
        if ($productIds === []) return;

        $conditions = [];
        foreach ($productIds as $index => $productId) {
            $binding = ':external_product_' . $index;
            $conditions[] = "JSON_SEARCH({$itemsColumn}, 'one', {$binding}, NULL, '$[*].productId') IS NOT NULL";
            $bindings[$binding] = $productId;
        }
        $where[] = '(JSON_VALID(' . $itemsColumn . ') = 1 AND (' . implode(' OR ', $conditions) . '))';
    }

    /** @param list<string> $where
     *  @param array<string, mixed> $bindings
     *  @param array<string, mixed> $filters
     */
    private function appendCourierFilter(array &$where, array &$bindings, array $filters): void
    {
        if (!isset($filters['courier']) || $filters['courier'] === '') return;
        $courier = strtolower((string) $filters['courier']);
        $knownColumns = [
            'steadfast' => 'o.steadfast_consignment_id', 'carrybee' => 'o.carrybee_consignment_id',
            'paperfly' => 'o.paperfly_tracking_number', 'pathao' => 'o.pathao_consignment_id',
        ];
        if (isset($knownColumns[$courier])) {
            $where[] = "(TRIM(COALESCE({$knownColumns[$courier]}, '')) <> '' OR LOWER(COALESCE(o.history, '')) LIKE :external_courier)";
        } else {
            $where[] = "LOWER(COALESCE(o.history, '')) LIKE :external_courier";
        }
        $bindings[':external_courier'] = '%' . $courier . '%';
    }

    private function projectResource(string $resource, array $row, array $scopes): array
    {
        $mapped = match ($resource) {
            'orders' => $this->mapOrder($row),
            'customers' => $this->mapCustomer($row),
            'transactions' => $this->mapTransaction($row),
            'bills' => $this->mapBill($row),
            'vendors' => $this->mapVendor($row),
            'accounts' => $this->mapAccount($row),
        };

        $fields = match ($resource) {
            'orders' => ['id', 'orderNumber', 'orderDate', 'customerId', 'customerName', 'customerPhone', 'customerAddress', 'status', 'items', 'subtotal', 'discount', 'shipping', 'total', 'paidAmount', 'notes', 'pageId', 'sourceAd', 'history', 'createdBy', 'creatorName', 'createdAt', 'deletedAt', 'deletedBy', 'processedAt', 'courierAssignedAt', 'pickedAt', 'completedAt', 'returnedAt', 'cancelledAt', 'partialDeliveredAt'],
            'customers' => ['id', 'name', 'phone', 'address', 'totalOrders', 'dueAmount', 'createdBy', 'createdAt', 'deletedAt', 'deletedBy'],
            'transactions' => ['id', 'date', 'type', 'category', 'accountId', 'accountName', 'toAccountId', 'amount', 'description', 'referenceId', 'contactId', 'contactName', 'contactType', 'paymentMethod', 'createdBy', 'creatorName', 'approvalStatus', 'accountEffectApplied', 'createdAt', 'deletedAt', 'deletedBy'],
            'bills' => ['id', 'billNumber', 'billDate', 'vendorId', 'vendorName', 'vendorPhone', 'vendorAddress', 'createdBy', 'creatorName', 'status', 'items', 'subtotal', 'discount', 'shipping', 'total', 'paidAmount', 'notes', 'history', 'createdAt', 'deletedAt', 'deletedBy'],
            'vendors' => ['id', 'name', 'phone', 'address', 'totalPurchases', 'dueAmount', 'createdBy', 'createdAt', 'deletedAt', 'deletedBy'],
            'accounts' => in_array('accounts.read_balance', $scopes, true)
                ? ['id', 'name', 'type', 'openingBalance', 'currentBalance']
                : ['id', 'name', 'type'],
        };

        $projected = array_intersect_key($mapped, array_flip($fields));
        if (isset($row['updated_at'])) {
            $projected['updatedAt'] = $this->toIso($row['updated_at']);
        }
        return $projected;
    }

    /** @return array{0: string, 1: string}|
     *  null
     */
    private function routeFromPath(string $path): ?array
    {
        if (preg_match('#(?:^|/)api/v1(?:/(.*))?$#', $path, $matches) === 1) {
            $tail = (string) ($matches[1] ?? '');
        } elseif (preg_match('#^/v1(?:/(.*))?$#', $path, $matches) === 1) {
            $tail = (string) ($matches[1] ?? '');
        } else {
            return null;
        }
        $segments = array_values(array_filter(explode('/', trim($tail, '/')), static fn(string $part): bool => $part !== ''));
        if ($segments === []) {
            throw new ApiException('External API resource is required.', 404, 'RESOURCE_NOT_FOUND');
        }
        if (count($segments) > 2) {
            throw new ApiException('Invalid external API path.', 404, 'RESOURCE_NOT_FOUND');
        }
        $resource = rawurldecode($segments[0]);
        $recordId = isset($segments[1]) ? rawurldecode($segments[1]) : '';
        if ($recordId !== '' && (str_contains($recordId, '/') || str_contains($recordId, "\0"))) {
            throw new ApiException('Invalid record id.', 404, 'RECORD_NOT_FOUND');
        }
        return [$resource, $recordId];
    }
}