<?php

declare(strict_types=1);

function dashboardTransferAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = dirname(__DIR__);
$banking = (string) file_get_contents($root . '/pages/Banking.tsx');
$transferModal = (string) file_get_contents($root . '/components/TransferModal.tsx');
$queries = (string) file_get_contents($root . '/src/services/supabaseQueries.ts');
$mutations = (string) file_get_contents($root . '/src/hooks/useMutations.ts');
$app = (string) file_get_contents($root . '/App.tsx');
$sidebar = (string) file_get_contents($root . '/src/sidebarConfig.ts');
$contactModal = (string) file_get_contents($root . '/components/ContactCreateModal.tsx');
$dashboardPanel = (string) file_get_contents($root . '/components/DashboardSettingsPanel.tsx');
$permissionsPanel = (string) file_get_contents($root . '/components/PermissionsSettingsPanel.tsx');
$dashboardPage = (string) file_get_contents($root . '/pages/Dashboard.tsx');
$baseService = (string) file_get_contents($root . '/backend/src/BaseService.php');
$featureAccess = (string) file_get_contents($root . '/backend/src/FeatureAccess.php');
$dispatcher = (string) file_get_contents($root . '/backend/src/BusinessActionDispatcher.php');
$masterData = (string) file_get_contents($root . '/backend/src/MasterDataApi.php');
$schemaOnly = (string) file_get_contents($root . '/backend/database/schema-only.sql');

dashboardTransferAssert(
    str_contains($banking, 'onClick={openTransferModal}')
        && str_contains($banking, '<TransferModal isOpen={showTransferModal}')
        && str_contains($transferModal, 'Cannot transfer to the same account.')
        && str_contains($transferModal, 'Insufficient balance in source account.')
        && str_contains($transferModal, 'useCreateTransfer')
        && !str_contains($transferModal, 'useCreateTransaction')
        && str_contains($transferModal, "type: 'Transfer'")
        && !is_file($root . '/pages/Transfer.tsx'),
    'Transfers must use the Accounts modal while preserving the former transfer validation and transaction behavior.',
);

dashboardTransferAssert(
    str_contains($queries, "call<Transaction>('createTransfer', transaction)")
        && str_contains($mutations, 'export function useCreateTransfer()')
        && str_contains($mutations, 'mutationFn: createTransfer')
        && str_contains($featureAccess, "'createTransfer' => 'transfer'")
        && str_contains($dispatcher, "if (\$action === 'createTransfer')")
        && str_contains($dispatcher, "\$action = 'createTransaction'")
        && str_contains($dispatcher, "\$payload['type'] = 'Transfer'"),
    'The transfer modal must authorize through the transfer capability before using the shared transaction implementation.',
);

dashboardTransferAssert(
    str_contains($app, '<Navigate to="/banking/accounts?transfer=open" replace />')
        && !str_contains($sidebar, "to: '/banking/transfer'"),
    'The legacy transfer route must open the Accounts modal and the standalone sidebar destination must be removed.',
);

dashboardTransferAssert(
    str_contains($contactModal, '<InfoTooltip message="Name, phone, and address can be on separate lines or mixed together. They will be extracted when you save." />')
        && !str_contains($contactModal, 'Paste exactly what the'),
    'Be Smart guidance must live in the information tooltip rather than a separate section.',
);

dashboardTransferAssert(
    str_contains($dashboardPanel, 'draggable')
        && str_contains($dashboardPanel, 'Returned Orders')
        && str_contains($dashboardPanel, 'Add Dashboard')
        && str_contains($permissionsPanel, 'value={selectedRole.dashboardId}')
        && !str_contains($permissionsPanel, '>Admin Dashboard</span>')
        && !str_contains($permissionsPanel, '>Employee Dashboard</span>'),
    'Dashboard settings must support creation, ordered cards/widgets, and one dashboard dropdown per role.',
);

dashboardTransferAssert(
    str_contains($dashboardPage, 'dashboard.kpiCards.filter')
        && str_contains($dashboardPage, 'dashboard.widgets.filter')
        && str_contains($dashboardPage, "case 'admin.returnedOrders'")
        && str_contains($dashboardPage, 'enabledWidgets.map'),
    'The runtime dashboard must render enabled KPI cards and widgets in configured order.',
);

dashboardTransferAssert(
    str_contains($baseService, "ADMIN_DEFAULT_DASHBOARD_ID = 'admin-default'")
        && str_contains($baseService, "EMPLOYEE_DEFAULT_DASHBOARD_ID = 'employee-default'")
        && str_contains($masterData, 'public function updateDashboardSettings')
        && str_contains($masterData, 'dashboard_id = VALUES(dashboard_id)')
        && str_contains($schemaOnly, 'CREATE TABLE IF NOT EXISTS dashboard_configurations')
        && str_contains($schemaOnly, "CALL sp_add_col('role_permissions', 'dashboard_id'"),
    'Dashboard persistence and role assignment must be present in the API and generated schema-only migration.',
);

echo "Dashboard configuration and transfer-modal contracts passed.\n";
