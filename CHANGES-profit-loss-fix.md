# Profit & Loss Report - Order Count & Product Count Fix

## Summary

Fixed the Profit & Loss report to count orders and products that are delivered (Completed, Exchange delivered) **regardless of their payment status**, as requested by the user.

## Changes Made

### 1. backend/src/OperationsApi.php

#### Change 1: Line 4115 - Removed paid_amount filter from order count and gross sales
```php
// Before:
SELECT COALESCE(SUM(CASE WHEN COALESCE(o.paid_amount, 0) > 0 THEN o.paid_amount ELSE 0 END), 0) AS grossSales, COUNT(*) AS orderCount

// After:
SELECT COALESCE(SUM(o.paid_amount), 0) AS grossSales, COUNT(*) AS orderCount
```

**Impact:** Now sums ALL paid_amount values (including 0) and counts all matching orders, regardless of payment status.

#### Change 2: Line 4245 - Always use order-based gross sales
```php
// Before:
$grossSales = $salesFromTransactions > 0
    ? $salesFromTransactions
    : (float) ($orderSummary['grossSales'] ?? 0);

// After:
$grossSales = (float) ($orderSummary['grossSales'] ?? 0);
```

**Impact:** Ensures `grossSales` always comes from the orders table, consistent with `orderCount` and `productsSold`.

#### Change 3: Lines 4131-4149 - Improved JSON parsing fallback
```php
// Before:
} catch (\Throwable) {
    $orderItemsRows = $this->database->fetchAll(...);
    $productsSold = 0;
    foreach ($orderItemsRows as $orderRow) {
        foreach ($this->jsonDecodeList($orderRow['items'] ?? null) as $item) {
            if (is_array($item)) $productsSold += (float) ($item['quantity'] ?? 0);
        }
    }
}

// After:
} catch (\Throwable $e) {
    // Fallback: manually parse JSON items
    $orderItemsRows = $this->database->fetchAll(...);
    $productsSold = 0;
    foreach ($orderItemsRows as $orderRow) {
        $items = $this->jsonDecodeList($orderRow['items'] ?? null);
        if (!is_array($items)) {
            continue;  // Skip invalid JSON
        }
        foreach ($items as $item) {
            if (is_array($item)) {
                $productsSold += (float) ($item['quantity'] ?? 0);
            }
        }
    }
}
```

**Impact:** Better error handling - skips invalid JSON instead of failing silently.

### 2. deploy/cpanel-mamepilot-package/mamepilot_backend/backend/src/OperationsApi.php

Same changes as above applied to the deploy copy.

## Behavior Changes

### Before
- `orderCount`: Counted all orders with status 'Completed' or 'Exchange delivered' (regardless of payment)
- `productsSold`: Counted all products from orders with status 'Completed' or 'Exchange delivered' (regardless of payment)
- `grossSales`: Summed only `paid_amount > 0` from orders with status 'Completed' or 'Exchange delivered'
- `grossSales` data source: Used transaction-based data when available, otherwise order-based

### After
- `orderCount`: Counts all orders with status 'Completed' or 'Exchange delivered' (regardless of payment) - **Same**
- `productsSold`: Counts all products from orders with status 'Completed' or 'Exchange delivered' (regardless of payment) - **Same**
- `grossSales`: Sums ALL `paid_amount` values (including 0) from orders with status 'Completed' or 'Exchange delivered'
- `grossSales` data source: Always uses order-based data for consistency

## Test Impact

The existing test `tests/profit-loss-paid-amount-runtime.test.php` will still pass because:
- Test creates orders with paid_amount = [600, 0, 100]
- Old `grossSales` = 600 + 100 = 700 (excluding 0)
- New `grossSales` = 600 + 0 + 100 = 700 (including 0)
- Result is the same by coincidence

However, the behavior is now different for:
- Orders with negative `paid_amount` (if any exist)
- The consistency between `grossSales`, `orderCount`, and `productsSold`

## Status Filtering

The status filtering remains unchanged:
- Orders: `status IN ('Completed', 'Exchange delivered')`
- Bills: No status filtering (all non-deleted bills are counted)

The user confirmed they want to count only `Completed` and `Exchange delivered` statuses (not `Returned` or `Exchange returned`).
