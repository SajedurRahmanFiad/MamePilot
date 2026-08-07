<?php

declare(strict_types=1);

function dashboardProfitLossAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = dirname(__DIR__);
$dashboardConfig = (string) file_get_contents($root . '/src/dashboardConfig.ts');
$dashboardPage = (string) file_get_contents($root . '/pages/Dashboard.tsx');
$permissionsPanel = (string) file_get_contents($root . '/components/PermissionsSettingsPanel.tsx');
$permissionsUtils = (string) file_get_contents($root . '/src/utils/permissions.ts');
$profitLossPage = (string) file_get_contents($root . '/pages/reports/ProfitLoss.tsx');
$queryHooks = (string) file_get_contents($root . '/src/hooks/useQueries.ts');
$operations = (string) file_get_contents($root . '/backend/src/OperationsApi.php');
$baseService = (string) file_get_contents($root . '/backend/src/BaseService.php');
$masterData = (string) file_get_contents($root . '/backend/src/MasterDataApi.php');

foreach ([
    'admin.courierAssignedOrders',
    'admin.exchangedOrders',
    'admin.exchangeProcessingOrders',
    'admin.exchangePickedOrders',
    'admin.exchangeDeliveredOrders',
    'admin.exchangeReturnedOrders',
    'admin.exchangeCancelledOrders',
    'admin.paidOrders',
    'admin.partiallyPaidOrders',
    'admin.unpaidOrders',
    'admin.overpaidOrders',
    'admin.refundedOrders',
] as $dashboardKey) {
    dashboardProfitLossAssert(
        str_contains($dashboardConfig, "key: '{$dashboardKey}'")
            && str_contains($dashboardPage, "case '{$dashboardKey}'")
            && str_contains($baseService, "'{$dashboardKey}' => 'admin'"),
        "Dashboard KPI {$dashboardKey} is not registered end to end.",
    );
}

dashboardProfitLossAssert(
    str_contains($operations, "'Exchange picked' => 'exchangePicked'")
        && str_contains($operations, "'Partially Paid' => 'partiallyPaid'")
        && str_contains($operations, "'paymentCounts' => \$paymentCounts")
        && str_contains($operations, "'paymentTotals' => \$paymentTotals"),
    'Dashboard snapshots must expose exact exchange and payment-status metrics.',
);

dashboardProfitLossAssert(
    str_contains($permissionsUtils, 'BUILT_IN_PERMISSION_ROLES = [UserRole.ADMIN, UserRole.EMPLOYEE]')
        && str_contains($permissionsPanel, "const isAdminRole = selectedRole?.roleName === 'Admin'")
        && str_contains($permissionsPanel, 'disabled={isAdminRole}')
        && str_contains($permissionsPanel, 'only the dashboard can be changed')
        && str_contains($masterData, "\$permissions = \$roleName === 'Admin'")
        && str_contains($baseService, "if (\$normalizedRole === 'Developer') return self::ADMIN_DEFAULT_DASHBOARD_ID"),
    'Admin must be visible with immutable permissions and a persisted dashboard assignment.',
);

dashboardProfitLossAssert(
    str_contains($profitLossPage, 'brandedCompanies.map')
        && str_contains($profitLossPage, 'aria-hidden="true">+</span>')
        && str_contains($profitLossPage, 'company.logo')
        && str_contains($profitLossPage, 'company.name')
        && !str_contains($profitLossPage, 'company.address')
        && !str_contains($profitLossPage, 'company.phone')
        && str_contains($queryHooks, "'reports', 'profit-loss', filterRange, normalizedCustomDates.from, normalizedCustomDates.to, sortedIds")
        && str_contains($operations, "'companyPageIds' => \$companyPageIds")
        && str_contains($operations, 'company_income_order.page_id = :profit_loss_txn_page_')
        && str_contains($operations, 'o.page_id = :profit_loss_order_page_'),
    'Profit and Loss must filter by multiple companies and render selected or combined company branding.',
);

echo "Dashboard KPI, Admin dashboard, and company Profit/Loss contracts passed.\n";
