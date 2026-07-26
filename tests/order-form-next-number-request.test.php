<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$orderForm = (string) file_get_contents($root . '/pages/OrderForm.tsx');
$permissionsHook = (string) file_get_contents($root . '/src/hooks/useRolePermissions.ts');
$toastContext = (string) file_get_contents($root . '/src/contexts/ToastContext.tsx');

function nextNumberAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$guardDeclaration = strpos($orderForm, 'const orderNumberRequestedRef = React.useRef(false);');
$guardCheck = strpos($orderForm, '} else if (!isEdit && !orderNumberRequestedRef.current) {');
$guardSet = strpos($orderForm, 'orderNumberRequestedRef.current = true;');
$loadingSet = strpos($orderForm, 'setOrderNumberLoading(true);');

nextNumberAssert($guardDeclaration !== false, 'Order Form is missing the next-number request guard.');
nextNumberAssert($guardCheck !== false, 'Order Form does not check the request guard before fetching a preview.');
nextNumberAssert($guardSet !== false, 'Order Form does not synchronously mark the preview request as started.');
nextNumberAssert($loadingSet !== false && $guardSet < $loadingSet, 'The request guard must be set before loading state can rerender the form.');
nextNumberAssert(
    str_contains($orderForm, 'requestGeneration !== initializationGenerationRef.current'),
    'An older preview response can still overwrite a different order form after navigation.',
);
nextNumberAssert(
    str_contains($permissionsHook, 'const can = useCallback(')
        && str_contains($permissionsHook, 'const canAccessRecord = useCallback('),
    'Shared permission callbacks are not stable across rerenders.',
);
nextNumberAssert(
    str_contains($toastContext, 'return useMemo(() => ({'),
    'Toast notification helpers are not stable across rerenders.',
);

echo "Order Form next-number request checks passed.\n";
