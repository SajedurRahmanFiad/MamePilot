import React, { useEffect, useState } from 'react';
import { db } from '../db';
import { formatCurrency } from '../constants';
import { theme } from '../theme';
import { buildLocalDateTime, getCurrentTime, getTodayDate } from '../utils';
import { useAccounts } from '../src/hooks/useQueries';
import { useCreateTransfer } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useRolePermissions } from '../src/hooks/useRolePermissions';
import { Button } from './Button';
import { NumericInput } from './Input';
import { Modal } from './Modal';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const emptyTransferForm = () => ({
  date: getTodayDate(),
  time: getCurrentTime(),
  fromAccountId: '',
  toAccountId: '',
  amount: 0,
  description: '',
});

const TransferModal: React.FC<TransferModalProps> = ({ isOpen, onClose }) => {
  const user = db.currentUser;
  const { data: accounts = [], isPending: accountsLoading } = useAccounts({ enabled: isOpen });
  const createTransferMutation = useCreateTransfer();
  const toast = useToastNotifications();
  const { canViewAccountBalances } = useRolePermissions();
  const [form, setForm] = useState(emptyTransferForm);

  useEffect(() => {
    if (isOpen) setForm(emptyTransferForm());
  }, [isOpen]);

  const handleClose = () => {
    if (!createTransferMutation.isPending) onClose();
  };

  const handleSave = async () => {
    if (!form.amount || !form.fromAccountId || !form.toAccountId) {
      toast.warning('Please fill in all fields.');
      return;
    }
    if (form.fromAccountId === form.toAccountId) {
      toast.warning('Cannot transfer to the same account.');
      return;
    }

    const fromAccount = accounts.find((account) => account.id === form.fromAccountId);
    const toAccount = accounts.find((account) => account.id === form.toAccountId);
    if (!fromAccount || !toAccount) {
      toast.warning('Please select valid source and destination accounts.');
      return;
    }
    if (fromAccount.currentBalance < form.amount) {
      toast.warning('Insufficient balance in source account.');
      return;
    }
    if (!user?.id) {
      toast.warning('User session expired. Please log in again.');
      return;
    }

    const fullDatetime = buildLocalDateTime(form.date, form.time);
    if (!fullDatetime) {
      toast.warning('Please enter a valid date and time.');
      return;
    }

    try {
      await createTransferMutation.mutateAsync({
        type: 'Transfer',
        date: fullDatetime.toISOString(),
        accountId: form.fromAccountId,
        toAccountId: form.toAccountId,
        amount: form.amount,
        description: form.description || `Transfer from ${fromAccount.name} to ${toAccount.name}`,
        category: 'Transfer',
        paymentMethod: 'Internal Transfer',
        createdBy: user.id,
      });
      toast.success('Transfer completed successfully');
      onClose();
    } catch (err) {
      console.error('Transfer failed:', err);
      toast.error(err instanceof Error ? err.message : 'Could not complete the transfer. Please try again.');
    }
  };

  const accountLabel = (account: (typeof accounts)[number]) => canViewAccountBalances
    ? `${account.name} (${formatCurrency(account.currentBalance)})`
    : account.name;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Transfer Funds"
      size="lg"
      contentClassName="space-y-6"
      footer={(
        <>
          <Button onClick={handleClose} variant="secondary" disabled={createTransferMutation.isPending}>Cancel</Button>
          <Button
            onClick={handleSave}
            variant="primary"
            loading={createTransferMutation.isPending}
            disabled={accountsLoading || createTransferMutation.isPending || accounts.length < 2}
          >
            {createTransferMutation.isPending ? 'Processing Transfer...' : 'Execute Transfer'}
          </Button>
        </>
      )}
    >
      {accountsLoading ? (
        <div className="py-10 text-center text-sm font-medium text-gray-500">Loading accounts...</div>
      ) : accounts.length < 2 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-800">
          Add at least two accounts before creating a transfer.
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-gray-400">Amount to Transfer (BDT)</label>
            <NumericInput
              value={form.amount}
              onChange={(amount) => setForm({ ...form, amount })}
              className={`text-lg ${theme.colors.primary[600]} rounded-xl border-2 border-transparent bg-[#ebf4ff] px-6 py-4 focus:border-[#3c5a82]`}
              allowDecimals
              decimalPlaces={2}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-gray-400">From Account (Source)</label>
              <select
                className="w-full rounded-lg border-transparent bg-gray-50 px-5 py-3.5 font-bold focus:border-[#3c5a82] focus:bg-white"
                value={form.fromAccountId}
                onChange={(event) => setForm({ ...form, fromAccountId: event.target.value })}
              >
                <option value="">Select an account</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-gray-400">To Account (Destination)</label>
              <select
                className="w-full rounded-lg border-transparent bg-gray-50 px-5 py-3.5 font-bold focus:border-[#3c5a82] focus:bg-white"
                value={form.toAccountId}
                onChange={(event) => setForm({ ...form, toAccountId: event.target.value })}
              >
                <option value="">Select an account</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{accountLabel(account)}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-gray-400">Transfer Date</label>
              <input type="date" className="w-full rounded-lg border-transparent bg-gray-50 px-5 py-3.5 text-base font-bold focus:border-[#3c5a82] focus:bg-white" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-widest text-gray-400">Transfer Time</label>
              <input type="time" className="w-full rounded-lg border-transparent bg-gray-50 px-5 py-3.5 text-base font-bold focus:border-[#3c5a82] focus:bg-white" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-widest text-gray-400">Memo / Description</label>
            <textarea className="h-28 w-full rounded-lg border-transparent bg-gray-50 px-5 py-3.5 font-medium outline-none focus:border-[#3c5a82] focus:bg-white" placeholder="Reason for transfer..." value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </div>
        </>
      )}
    </Modal>
  );
};

export default TransferModal;
