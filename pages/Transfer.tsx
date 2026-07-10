
import React, { useState } from 'react';
import { db } from '../db';
import { formatCurrency } from '../constants';
import { Button, NumericInput } from '../components';
import { theme } from '../theme';
import { useAccounts } from '../src/hooks/useQueries';
import { useCreateTransaction } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { buildLocalDateTime, getTodayDate } from '../utils';
import { useRolePermissions } from '../src/hooks/useRolePermissions';

const Transfer: React.FC = () => {
  const user = db.currentUser;
  const { data: accounts = [] } = useAccounts();
  const createTransactionMutation = useCreateTransaction();
  const toast = useToastNotifications();
  const { canViewAccountBalances } = useRolePermissions();
  
  const [form, setForm] = useState({
    date: getTodayDate(),
    time: new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false }),
    fromAccountId: '',
    toAccountId: '',
    amount: 0,
    description: '',
  });

  const handleSave = async () => {
    if (!form.amount || !form.fromAccountId || !form.toAccountId) {
      toast.warning('Please fill in all fields.');
      return;
    }
    if (form.fromAccountId === form.toAccountId) {
      toast.warning('Cannot transfer to the same account.');
      return;
    }

    const fromAccount = accounts.find(a => a.id === form.fromAccountId);
    const toAccount = accounts.find(a => a.id === form.toAccountId);

    if (fromAccount && toAccount) {
      if (fromAccount.currentBalance < form.amount) {
        toast.warning('Insufficient balance in source account.');
        return;
      }

      try {
        if (!user?.id) {
          toast.warning('User session expired. Please log in again.');
          return;
        }

        // Create full ISO datetime from date and time
        const fullDatetime = buildLocalDateTime(form.date, form.time);
        if (!fullDatetime) {
          toast.warning('Please enter a valid date and time.');
          return;
        }
        const isoDatetime = fullDatetime.toISOString();

        await createTransactionMutation.mutateAsync({
          type: 'Transfer',
          date: isoDatetime,
          accountId: form.fromAccountId,
          toAccountId: form.toAccountId,
          amount: form.amount,
          description: form.description || `Transfer from ${fromAccount.name} to ${toAccount.name}`,
          category: 'Transfer',
          paymentMethod: 'Internal Transfer',
          createdBy: user.id,
        });

        toast.success('Transfer completed successfully');
        setForm({
          date: getTodayDate(),
          time: new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false }),
          fromAccountId: '',
          toAccountId: '',
          amount: 0,
          description: '',
        });
      } catch (err) {
        console.error('Transfer failed:', err);
        toast.error('Failed to complete transfer: ' + (err instanceof Error ? err.message : 'Unknown error'));
      }
    }
  };

  return (
    <div className="max-w-3xl mx-auto animate-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8 flex items-center justify-between">
        <div />
      </div>

      <div className="bg-white p-8 lg:p-12 rounded-lg border border-gray-100 shadow-xl space-y-8">
        <div className="space-y-2">
          <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Amount to Transfer (BDT)</label>
          <NumericInput 
            value={form.amount} 
            onChange={amount => setForm({...form, amount})} 
            className={`text-lg ${theme.colors.primary[600]} bg-[#ebf4ff] border-2 border-transparent focus:border-[#3c5a82] rounded-xl px-6 py-4`}
            allowDecimals={true}
            decimalPlaces={2}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">From Account (Source)</label>
            <select className={`w-full px-6 py-4 bg-gray-50 border-transparent focus:border-[#3c5a82] focus:bg-white rounded-lg font-bold`} value={form.fromAccountId} onChange={e => setForm({...form, fromAccountId: e.target.value})}>
              <option value="">Select an account</option>
              {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name} ({formatCurrency(acc.currentBalance)})</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">To Account (Destination)</label>
            <select className={`w-full px-6 py-4 bg-gray-50 border-transparent focus:border-[#3c5a82] focus:bg-white rounded-lg font-bold`} value={form.toAccountId} onChange={e => setForm({...form, toAccountId: e.target.value})}>
              <option value="">Select an account</option>
              {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name} ({formatCurrency(acc.currentBalance)})</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Transfer Date</label>
            <input type="date" className={`w-full px-6 py-4 bg-gray-50 border-transparent focus:border-[#3c5a82] focus:bg-white rounded-lg text-lg font-bold`} value={form.date} onChange={e => setForm({...form, date: e.target.value})} />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Transfer Time</label>
            <input type="time" className={`w-full px-6 py-4 bg-gray-50 border-transparent focus:border-[#3c5a82] focus:bg-white rounded-lg text-lg font-bold`} value={form.time} onChange={e => setForm({...form, time: e.target.value})} />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Memo / Description</label>
          <textarea className={`w-full px-6 py-4 bg-gray-50 border-transparent focus:border-[#3c5a82] focus:bg-white rounded-lg font-medium h-32 outline-none`} placeholder="Reason for transfer..." value={form.description} onChange={e => setForm({...form, description: e.target.value})} />
        </div>

        <Button onClick={handleSave} variant="primary" size="lg" className="w-full" disabled={createTransactionMutation.isPending}>
          {createTransactionMutation.isPending ? 'Processing Transfer...' : 'Execute Transfer'}
        </Button>
      </div>
    </div>
  );
};

export default Transfer;
