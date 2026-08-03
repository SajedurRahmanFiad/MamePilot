<?php

declare(strict_types=1);

function editableTotalAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$root = dirname(__DIR__);
$orderForm = (string) file_get_contents($root . '/pages/OrderForm.tsx');
$operations = (string) file_get_contents($root . '/backend/src/OperationsApi.php');

editableTotalAssert(
    str_contains($orderForm, 'const calculatedTotal = roundMoney(Math.max(0, subtotal + parsedShipping));'),
    'The editable order total must retain the existing subtotal-plus-shipping calculation.',
);
editableTotalAssert(
    str_contains($orderForm, 'onChange={handleTotalChange}')
        && str_contains($orderForm, 'setDiscount(String(roundMoney(calculatedTotal - nextTotal)))'),
    'Typing in Total must update Discount immediately.',
);
editableTotalAssert(
    str_contains($orderForm, 'onChange={handleDiscountChange}')
        && str_contains($orderForm, 'const total = roundMoney(Math.max(0, calculatedTotal - parsedDiscount));'),
    'Typing in Discount must update Total immediately.',
);
editableTotalAssert(
    str_contains($orderForm, 'Math.min(calculatedTotal, Math.max(0, value))')
        && str_contains($orderForm, 'max={calculatedTotal}'),
    'Total and Discount must remain within the calculated order bounds.',
);
editableTotalAssert(
    str_contains($operations, "\$documentLabel === 'Order'")
        && str_contains($operations, 'round($calculatedSubtotal + max(0.0, $shipping), 2)'),
    'The order API must accept the discount required for a zero total when shipping is present.',
);

echo "Order Form editable-total checks passed.\n";
