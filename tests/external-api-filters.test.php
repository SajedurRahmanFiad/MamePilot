<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/backend/bootstrap.php';

use App\ExternalApiFilters;

function externalApiFilterAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function externalApiFilterExpectInvalid(callable $callback, string $message): void
{
    try {
        $callback();
    } catch (InvalidArgumentException) {
        return;
    }

    throw new RuntimeException($message);
}

$orders = ExternalApiFilters::normalize('orders', [
    'delivery_status' => 'delivered',
    'payment_status' => 'unpaid',
    'min_amount' => '200',
    'max_amount' => '400',
    'page_size' => '200',
]);
externalApiFilterAssert($orders['page_size'] === 200, 'Order page size should accept the supported maximum.');
externalApiFilterAssert($orders['filters']['min_amount'] === 200.0, 'Order amount filters should normalize numeric values.');
externalApiFilterAssert($orders['filters']['delivery_status'] === 'delivered', 'Order filters should preserve normalized values.');
$utcDate = ExternalApiFilters::normalize('orders', ['created_from' => '2026-10-11T12:00:00+06:00']);
externalApiFilterAssert($utcDate['filters']['created_from'] === '2026-10-11 06:00:00', 'Timestamp filters should normalize to UTC.');
$inclusiveEnd = ExternalApiFilters::normalize('orders', ['created_to' => '2026-10-11']);
externalApiFilterAssert($inclusiveEnd['filters']['created_to'] === '2026-10-11 23:59:59', 'Date-only upper bounds should include the full day.');

foreach (['customers', 'transactions', 'bills', 'vendors', 'accounts'] as $resource) {
    $normalized = ExternalApiFilters::normalize($resource, ['page' => '2', 'page_size' => '25']);
    externalApiFilterAssert($normalized['page'] === 2, $resource . ' should use the common pagination contract.');
}

externalApiFilterExpectInvalid(
    static fn() => ExternalApiFilters::normalize('orders', ['page_size' => '201']),
    'Page sizes over 200 must be rejected.'
);
externalApiFilterExpectInvalid(
    static fn() => ExternalApiFilters::normalize('orders', ['page' => '10000', 'page_size' => '200']),
    'Unbounded offsets must be rejected.'
);
externalApiFilterExpectInvalid(
    static fn() => ExternalApiFilters::normalize('orders', ['min_amount' => '500', 'max_amount' => '200']),
    'Inverted numeric ranges must be rejected.'
);
externalApiFilterExpectInvalid(
    static fn() => ExternalApiFilters::normalize('orders', ['min_amount' => '-1']),
    'Negative amount bounds must be rejected.'
);
externalApiFilterExpectInvalid(
    static fn() => ExternalApiFilters::normalize('orders', ['sort_by' => 'id; DROP TABLE orders']),
    'Untrusted sort expressions must be rejected.'
);
externalApiFilterExpectInvalid(
    static fn() => ExternalApiFilters::normalize('orders', ['unexpected' => 'value']),
    'Unknown filters must be rejected.'
);
externalApiFilterExpectInvalid(
    static fn() => ExternalApiFilters::normalize('orders', ['created_from' => '2026-99-99']),
    'Invalid calendar dates must be rejected.'
);
externalApiFilterExpectInvalid(
    static fn() => ExternalApiFilters::normalize('orders', ['created_from' => '2026-10-11T12:30:00']),
    'Timestamp filters must include a timezone.'
);
externalApiFilterExpectInvalid(
    static fn() => ExternalApiFilters::normalize('orders', ['payment_status' => 'maybe']),
    'Unsupported enum values must be rejected.'
);
externalApiFilterExpectInvalid(
    static fn() => ExternalApiFilters::normalize('orders', ['status_event' => 'delivered']),
    'Status event filters require at least one date bound.'
);
externalApiFilterExpectInvalid(
    static fn() => ExternalApiFilters::normalize('orders', ['status_event' => 'delivered,returned', 'status_changed_from' => '2026-10-01']),
    'Status event filters accept one event at a time.'
);

echo "External API filter tests passed.\n";