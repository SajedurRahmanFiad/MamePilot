import React, { useEffect, useMemo, useState } from 'react';
import type { Account } from '../types';
import { formatCurrency } from '../constants';
import { useCreateTransaction } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { Button } from './Button';
import { NumericInput } from './Input';
import { Modal } from './Modal';

export type AccountBalanceAction = 'withdraw' | 'deposit';

interface AccountBalanceAdjustmentModalProps {
  isOpen: boolean;
  account: Account | null;
  action: AccountBalanceAction;
  onClose: () => void;
}

const AccountBalanceAdjustmentModal: React.FC<AccountBalanceAdjustmentModalProps> = ({
  isOpen,
  account,
  action,
  onClose,
}) => {
  const createTransactionMutation = useCreateTransaction();
  const toast = useToastNotifications();
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState('');
  const isDeposit = action === 'deposit';
  const actionLabel = isDeposit ? 'Deposit' : 'Withdraw';

  useEffect(() => {
    if (!isOpen) return;
    setAmount(0);
    setDescription('');
  }, [account?.id, action, isOpen]);

  const resultingBalance = useMemo(() => {
    if (!account) return 0;
    return account.currentBalance + (isDeposit ? amount : -amount);
  }, [account, amount, isDeposit]);

  const handleClose = () => {
    if (!createTransactionMutation.isPending) onClose();
  };

  const handleSave = async () => {
    if (!account) return;
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.warning('Amount must be greater than 0.');
      return;
    }
    if (!isDeposit && amount > account.currentBalance) {
      toast.warning(`Insufficient balance. ${account.name} has ${formatCurrency(account.currentBalance)} available.`);
      return;
    }

    const transactionDescription = description.trim()
      || (isDeposit ? `Deposit to ${account.name}` : `Withdrawal from ${account.name}`);

    try {
      const transaction = await createTransactionMutation.mutateAsync({
        type: isDeposit ? 'Income' : 'Expense',
        date: new Date().toISOString(),
        accountId: account.id,
        amount,
        description: transactionDescription,
        category: isDeposit ? 'Deposit' : 'Withdrawal',
        paymentMethod: 'Account Adjustment',
      });

      if (transaction.approvalStatus === 'pending') {
        toast.info(`${actionLabel} recorded and sent for admin approval. The balance will update after approval.`);
      } else {
        toast.success(`${actionLabel} completed and registered in transactions.`);
      }
      onClose();
    } catch (error) {
      console.error(`Failed to ${action} account balance:`, error);
      toast.error(error instanceof Error ? error.message : `Could not complete the ${action}. Please try again.`);
    }
  };

  return (
    <Modal
      isOpen={isOpen && !!account}
      onClose={handleClose}
      title={`${actionLabel} Funds`}
      size="md"
      contentClassName="space-y-5"
      footer={(
        <>
          <Button onClick={handleClose} variant="secondary" disabled={createTransactionMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            variant={isDeposit ? 'primary' : 'danger'}
            loading={createTransactionMutation.isPending}
            disabled={!account || amount <= 0 || (!isDeposit && amount > account.currentBalance)}
          >
            {createTransactionMutation.isPending ? `Processing ${actionLabel}...` : `Confirm ${actionLabel}`}
          </Button>
        </>
      )}
    >
      {account && (
        <>
          <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4">
            <p className="text-xs font-black uppercase tracking-widest text-gray-400">Account</p>
            <div className="mt-2 flex items-center justify-between gap-4">
              <div>
                <p className="font-bold text-gray-900">{account.name}</p>
                <p className="text-xs font-medium uppercase text-gray-400">{account.type} Account</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-gray-500">Current Balance</p>
                <p className="font-black text-gray-900">{formatCurrency(account.currentBalance)}</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-gray-400">
              {actionLabel} Amount (BDT)
            </label>
            <NumericInput
              value={amount}
              onChange={setAmount}
              className="rounded-xl border-2 border-transparent bg-[#ebf4ff] px-5 py-4 text-lg font-black focus:border-[#3c5a82]"
              allowDecimals
              decimalPlaces={2}
              autoFocus
            />
            {!isDeposit && amount > account.currentBalance && (
              <p className="text-sm font-semibold text-red-600">
                Withdrawal cannot exceed the available balance.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-gray-100 px-4 py-3">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span className="font-medium text-gray-500">Balance after {actionLabel.toLowerCase()}</span>
              <span className={`font-black ${resultingBalance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {formatCurrency(resultingBalance)}
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-gray-400">Note (Optional)</label>
            <textarea
              className="h-24 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 font-medium outline-none focus:border-[#3c5a82] focus:bg-white"
              placeholder={`Reason for this ${actionLabel.toLowerCase()}...`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          <p className="text-xs font-medium leading-5 text-gray-500">
            This will be recorded as an {isDeposit ? 'Income' : 'Expense'} transaction for this account.
          </p>
        </>
      )}
    </Modal>
  );
};

export default AccountBalanceAdjustmentModal;
