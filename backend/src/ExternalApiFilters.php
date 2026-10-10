<?php

declare(strict_types=1);

namespace App;

use DateTimeImmutable;
use DateTimeZone;
use InvalidArgumentException;

final class ExternalApiFilters
{
    private const COMMON_FILTERS = [
        'page', 'page_size', 'search', 'ids', 'created_from', 'created_to',
        'updated_from', 'updated_to', 'updated_since', 'sort_by', 'sort_direction',
        'include_deleted',
    ];

    private const RESOURCE_FILTERS = [
        'orders' => [
            'status', 'status_not', 'delivery_status', 'payment_status', 'customer_id',
            'customer_ids', 'customer_phone', 'order_number', 'created_by_id',
            'created_by_ids', 'source_ad', 'courier', 'is_pos', 'page_id', 'min_amount',
            'max_amount', 'min_paid', 'max_paid', 'min_due', 'max_due', 'order_date_from',
            'order_date_to', 'status_event', 'status_changed_from', 'status_changed_to',
            'product_id', 'product_ids',
        ],
        'customers' => [
            'name', 'phone', 'address', 'created_by_id', 'created_by_ids',
            'total_orders_min', 'total_orders_max', 'due_min', 'due_max', 'include_walkin',
        ],
        'transactions' => [
            'type', 'type_in', 'type_not', 'category', 'category_ids', 'account_id',
            'account_ids', 'to_account_id', 'contact_id', 'contact_type', 'payment_method',
            'reference_id', 'approval_status', 'account_effect_applied', 'created_by_id',
            'created_by_ids', 'recurring_transaction_id', 'min_amount', 'max_amount',
            'transaction_date_from', 'transaction_date_to',
        ],
        'bills' => [
            'status', 'status_not', 'bill_status', 'payment_status', 'vendor_id',
            'vendor_ids', 'vendor_name', 'vendor_phone', 'bill_number', 'created_by_id',
            'created_by_ids', 'min_amount', 'max_amount', 'min_paid', 'max_paid', 'min_due',
            'max_due', 'bill_date_from', 'bill_date_to', 'status_event',
            'status_changed_from', 'status_changed_to', 'product_id', 'product_ids',
        ],
        'vendors' => [
            'name', 'phone', 'address', 'created_by_id', 'created_by_ids',
            'total_purchases_min', 'total_purchases_max', 'payable_min', 'payable_max',
        ],
        'accounts' => [
            'name', 'type', 'min_opening_balance', 'max_opening_balance',
            'min_current_balance', 'max_current_balance',
        ],
    ];

    private const SORT_FIELDS = [
        'orders' => ['created_at', 'order_date', 'order_number', 'total', 'paid_amount', 'status'],
        'customers' => ['created_at', 'name', 'total_orders', 'due_amount'],
        'transactions' => ['created_at', 'date', 'amount', 'type'],
        'bills' => ['created_at', 'bill_date', 'bill_number', 'total', 'paid_amount', 'status'],
        'vendors' => ['created_at', 'name', 'total_purchases', 'due_amount'],
        'accounts' => ['created_at', 'name', 'type', 'current_balance'],
    ];

    private const NUMERIC_FILTERS = [
        'min_amount', 'max_amount', 'min_paid', 'max_paid', 'min_due', 'max_due',
        'total_orders_min', 'total_orders_max', 'due_min', 'due_max',
        'total_purchases_min', 'total_purchases_max', 'payable_min', 'payable_max',
        'min_opening_balance', 'max_opening_balance', 'min_current_balance', 'max_current_balance',
    ];

    private const DATE_FILTERS = [
        'created_from', 'created_to', 'updated_from', 'updated_to', 'updated_since',
        'order_date_from', 'order_date_to', 'status_changed_from', 'status_changed_to',
        'transaction_date_from', 'transaction_date_to', 'bill_date_from', 'bill_date_to',
    ];

    private const ENUM_FILTERS = [
        'orders' => [
            'status' => ['Created', 'On Hold', 'Processing', 'Courier assigned', 'Picked', 'Completed', 'pending_delivered', 'pending_partial', 'partially_delivered', 'Exchange processing', 'Exchange picked', 'Exchange delivered', 'Exchange returned', 'Exchange cancelled', 'Repair processing', 'Repair Courier Assigned', 'Repair picked', 'Repair delivered', 'Repair canceled', 'Repair returned', 'Returned', 'Cancelled'],
            'status_not' => ['Created', 'On Hold', 'Processing', 'Courier assigned', 'Picked', 'Completed', 'pending_delivered', 'pending_partial', 'partially_delivered', 'Exchange processing', 'Exchange picked', 'Exchange delivered', 'Exchange returned', 'Exchange cancelled', 'Repair processing', 'Repair Courier Assigned', 'Repair picked', 'Repair delivered', 'Repair canceled', 'Repair returned', 'Returned', 'Cancelled'],
            'delivery_status' => ['delivered', 'partially_delivered', 'not_delivered', 'returned', 'cancelled'],
            'payment_status' => ['unpaid', 'partially_paid', 'paid', 'overpaid', 'refunded'],
            'status_event' => ['processing', 'courier', 'picked', 'delivered', 'returned', 'cancelled', 'partially_delivered', 'exchange_processing', 'exchange_picked', 'exchange_delivered', 'exchange_returned', 'exchange_cancelled', 'repair_processing', 'repair_picked', 'repair_delivered', 'repair_returned', 'repair_cancelled'],
        ],
        'transactions' => [
            'type' => ['Income', 'Expense', 'Transfer'],
            'type_in' => ['Income', 'Expense', 'Transfer'],
            'type_not' => ['Income', 'Expense', 'Transfer'],
            'approval_status' => ['approved', 'pending', 'declined'],
            'contact_type' => ['Customer', 'Vendor'],
        ],
        'bills' => [
            'status' => ['On Hold', 'Processing', 'Received', 'Paid', 'Returned', 'Cancelled'],
            'status_not' => ['On Hold', 'Processing', 'Received', 'Paid', 'Returned', 'Cancelled'],
            'bill_status' => ['on_hold', 'processing', 'received', 'returned', 'cancelled'],
            'payment_status' => ['unpaid', 'partially_paid', 'paid', 'overpaid', 'refunded'],
            'status_event' => ['processing', 'received', 'paid', 'returned', 'cancelled'],
        ],
        'accounts' => ['type' => ['Bank', 'Cash']],
    ];

    /**
     * @param array<string, mixed> $query
     * @return array{page: int, page_size: int, sort_by: string, sort_direction: string, filters: array<string, mixed>}
     */
    public static function normalize(string $resource, array $query): array
    {
        if (!isset(self::RESOURCE_FILTERS[$resource])) {
            throw new InvalidArgumentException('Unsupported external API resource.');
        }

        $allowed = array_flip(array_merge(self::COMMON_FILTERS, self::RESOURCE_FILTERS[$resource]));
        foreach ($query as $key => $_value) {
            if (!isset($allowed[$key])) {
                throw new InvalidArgumentException('Unsupported filter parameter: ' . $key);
            }
        }

        $page = self::boundedInteger($query['page'] ?? 1, 1, 1000000, 'page');
        $pageSize = self::boundedInteger($query['page_size'] ?? 100, 1, 200, 'page_size');
        if (($page - 1) * $pageSize > 1000000) {
            throw new InvalidArgumentException('Requested page offset exceeds the supported limit.');
        }
        $sortBy = $query['sort_by'] ?? 'created_at';
        if (!is_string($sortBy)) {
            throw new InvalidArgumentException('sort_by must be a string.');
        }
        if (!in_array($sortBy, self::SORT_FIELDS[$resource], true)) {
            throw new InvalidArgumentException('Unsupported sort_by for this resource.');
        }

        $sortDirectionInput = $query['sort_direction'] ?? 'desc';
        if (!is_string($sortDirectionInput)) {
            throw new InvalidArgumentException('sort_direction must be a string.');
        }
        $sortDirection = strtolower($sortDirectionInput);
        if (!in_array($sortDirection, ['asc', 'desc'], true)) {
            throw new InvalidArgumentException('sort_direction must be asc or desc.');
        }

        $filters = [];
        foreach (array_merge(self::COMMON_FILTERS, self::RESOURCE_FILTERS[$resource]) as $key) {
            if (!array_key_exists($key, $query) || in_array($key, ['page', 'page_size', 'sort_by', 'sort_direction'], true)) {
                continue;
            }
            $value = $query[$key];
            if (in_array($key, self::NUMERIC_FILTERS, true)) {
                $filters[$key] = self::numericValue($value, $key);
            } elseif (in_array($key, self::DATE_FILTERS, true)) {
                $filters[$key] = self::dateValue($value, $key);
            } elseif (in_array($key, ['ids', 'customer_ids', 'created_by_ids', 'product_ids', 'category_ids', 'account_ids', 'vendor_ids'], true)) {
                $filters[$key] = self::listValue($value, $key);
            } elseif (in_array($key, ['include_deleted', 'include_walkin', 'is_pos', 'account_effect_applied'], true)) {
                $filters[$key] = self::booleanValue($value, $key);
            } else {
                $filters[$key] = self::textValue($value, $key);
            }
        }

        self::validateEnums($resource, $filters);
        self::validateRanges($filters);

        return [
            'page' => $page,
            'page_size' => $pageSize,
            'sort_by' => $sortBy,
            'sort_direction' => $sortDirection,
            'filters' => $filters,
        ];
    }

    private static function boundedInteger($value, int $minimum, int $maximum, string $field): int
    {
        if (!is_scalar($value)) {
            throw new InvalidArgumentException($field . ' must be an integer.');
        }
        $validated = filter_var($value, FILTER_VALIDATE_INT);
        if ($validated === false || $validated < $minimum || $validated > $maximum) {
            throw new InvalidArgumentException($field . ' is outside the supported range.');
        }

        return $validated;
    }

    private static function numericValue($value, string $field): float
    {
        if (!is_scalar($value) || !is_numeric($value) || !is_finite((float) $value)) {
            throw new InvalidArgumentException($field . ' must be a finite number.');
        }

        $normalized = (float) $value;
        if ($normalized < 0) {
            throw new InvalidArgumentException($field . ' cannot be negative.');
        }
        return $normalized;
    }

    private static function dateValue($value, string $field): string
    {
        if (!is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/', $value) !== 1) {
            throw new InvalidArgumentException($field . ' must be an ISO-8601 date or timestamp.');
        }

        try {
            $datePart = substr($value, 0, 10);
            $calendarDate = DateTimeImmutable::createFromFormat('!Y-m-d', $datePart, new DateTimeZone('UTC'));
            if (!$calendarDate instanceof DateTimeImmutable || $calendarDate->format('Y-m-d') !== $datePart) {
                throw new InvalidArgumentException($field . ' is not a valid date.');
            }

            if (strlen($value) === 10) {
                return (str_ends_with($field, '_to') ? $calendarDate->setTime(23, 59, 59) : $calendarDate)->format('Y-m-d H:i:s');
            }
            return (new DateTimeImmutable($value))->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
        } catch (InvalidArgumentException $exception) {
            throw $exception;
        } catch (\Throwable) {
            throw new InvalidArgumentException($field . ' is not a valid date.');
        }
    }

    /** @return list<string> */
    private static function listValue($value, string $field): array
    {
        if (is_string($value)) {
            $values = explode(',', $value);
        } elseif (is_array($value)) {
            $values = $value;
        } else {
            throw new InvalidArgumentException($field . ' must be a comma-separated list.');
        }
        foreach ($values as $item) {
            if (!is_scalar($item)) {
                throw new InvalidArgumentException($field . ' values must be scalar.');
            }
        }

        $normalized = array_values(array_unique(array_filter(
            array_map(static fn($item): string => trim((string) $item), $values),
            static fn(string $item): bool => $item !== ''
        )));
        if ($normalized === [] || count($normalized) > 100) {
            throw new InvalidArgumentException($field . ' must contain between 1 and 100 values.');
        }

        return $normalized;
    }

    private static function booleanValue($value, string $field): bool
    {
        $normalized = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        if ($normalized === null) {
            throw new InvalidArgumentException($field . ' must be true or false.');
        }

        return $normalized;
    }

    private static function textValue($value, string $field): string
    {
        if (!is_scalar($value)) {
            throw new InvalidArgumentException($field . ' must be a scalar value.');
        }

        $normalized = trim((string) $value);
        if (strlen($normalized) > 255) {
            throw new InvalidArgumentException($field . ' cannot exceed 255 characters.');
        }

        return $normalized;
    }

    /** @param array<string, mixed> $filters */
    private static function validateRanges(array $filters): void
    {
        foreach ([
            ['min_amount', 'max_amount'], ['min_paid', 'max_paid'], ['min_due', 'max_due'],
            ['total_orders_min', 'total_orders_max'], ['due_min', 'due_max'],
            ['total_purchases_min', 'total_purchases_max'], ['payable_min', 'payable_max'],
            ['min_opening_balance', 'max_opening_balance'], ['min_current_balance', 'max_current_balance'],
        ] as [$minimumKey, $maximumKey]) {
            if (isset($filters[$minimumKey], $filters[$maximumKey]) && $filters[$minimumKey] > $filters[$maximumKey]) {
                throw new InvalidArgumentException($minimumKey . ' cannot exceed ' . $maximumKey . '.');
            }
        }

        foreach ([
            ['created_from', 'created_to'], ['updated_from', 'updated_to'],
            ['order_date_from', 'order_date_to'], ['transaction_date_from', 'transaction_date_to'],
            ['bill_date_from', 'bill_date_to'], ['status_changed_from', 'status_changed_to'],
        ] as [$fromKey, $toKey]) {
            if (isset($filters[$fromKey], $filters[$toKey]) && $filters[$fromKey] > $filters[$toKey]) {
                throw new InvalidArgumentException($fromKey . ' cannot be later than ' . $toKey . '.');
            }
        }

        if (isset($filters['status_event']) !== (isset($filters['status_changed_from']) || isset($filters['status_changed_to']))) {
            throw new InvalidArgumentException('status_event and at least one status_changed bound must be supplied together.');
        }
    }

    /** @param array<string, mixed> $filters */
    private static function validateEnums(string $resource, array $filters): void
    {
        foreach (self::ENUM_FILTERS[$resource] ?? [] as $key => $allowedValues) {
            if (!isset($filters[$key]) || $filters[$key] === '') continue;
            $values = is_array($filters[$key]) ? $filters[$key] : array_map('trim', explode(',', (string) $filters[$key]));
            if (str_ends_with($key, '_event') && count($values) !== 1) {
                throw new InvalidArgumentException($key . ' accepts one event at a time.');
            }
            foreach ($values as $value) {
                if (!in_array((string) $value, $allowedValues, true)) {
                    throw new InvalidArgumentException('Unsupported value for ' . $key . '.');
                }
            }
        }
    }
}