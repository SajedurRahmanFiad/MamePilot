<?php

declare(strict_types=1);

function accountBalanceAdjustmentAssert(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = dirname(__DIR__);
$banking = (string) file_get_contents($root . '/pages/Banking.tsx');
$modal = (string) file_get_contents($root . '/components/AccountBalanceAdjustmentModal.tsx');
$operations = (string) file_get_contents($root . '/backend/src/OperationsApi.php');

accountBalanceAdjustmentAssert(
    str_contains($banking, "openBalanceAdjustment(acc, 'withdraw')")
        && str_contains($banking, "openBalanceAdjustment(acc, 'deposit')")
        && str_contains($banking, "can('transactions.create') && hasSubCapability('transactions')")
        && str_contains($banking, '<AccountBalanceAdjustmentModal'),
    'Every account action menu must expose permission-gated Withdraw and Deposit modals.',
);

accountBalanceAdjustmentAssert(
    str_contains($modal, 'useCreateTransaction()')
        && str_contains($modal, "type: isDeposit ? 'Income' : 'Expense'")
        && str_contains($modal, 'accountId: account.id')
        && str_contains($modal, "category: isDeposit ? 'Deposit' : 'Withdrawal'")
        && str_contains($modal, "paymentMethod: 'Account Adjustment'")
        && str_contains($modal, "transaction.approvalStatus === 'pending'"),
    'Deposits and withdrawals must be registered through the shared transaction service and preserve approval behavior.',
);

accountBalanceAdjustmentAssert(
    str_contains($modal, 'amount > account.currentBalance')
        && str_contains($operations, "throw new RuntimeException('Transaction amount must be greater than zero.')")
        && str_contains($operations, '$this->assertTransactionHasAvailableBalance($transactionDraft);')
        && str_contains($operations, '$this->applyTransactionAccountEffect([array_merge($transactionDraft, $approvalState)], \'apply\');'),
    'Balance adjustments must reject invalid or overdrawn amounts and use the atomic transaction balance effect.',
);

echo "Account deposit and withdrawal contracts passed.\n";
