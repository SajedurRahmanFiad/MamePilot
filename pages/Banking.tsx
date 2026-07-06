
import React, { useState, useMemo } from 'react';
import { Account } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { Button, NumericInput } from '../components';
import { theme } from '../theme';
import { useAccounts } from '../src/hooks/useQueries';
import { useCreateAccount, useDeleteAccount } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { LoadingOverlay } from '../components';
import { useSearch } from '../src/contexts/SearchContext';

const Banking: React.FC = () => {
  const { data: accounts = [], isLoading } = useAccounts();
  const { searchQuery } = useSearch();
  const createAccountMutation = useCreateAccount();
  const deleteAccountMutation = useDeleteAccount();
  const toast = useToastNotifications();

  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) {
      return accounts;
    }
    
    const query = searchQuery.toLowerCase();
    return accounts.filter(account => 
      account.name.toLowerCase().includes(query) ||
      account.type.toLowerCase().includes(query)
    );
  }, [accounts, searchQuery]);
  
  const [showAddModal, setShowAddModal] = useState(false);
  const [openDeleteMenu, setOpenDeleteMenu] = useState<string | null>(null);
  const [newAcc, setNewAcc] = useState<{ name: string; type: 'Bank' | 'Cash'; openingBalance: number }>({ 
    name: '', 
    type: 'Bank', 
    openingBalance: 0 
  });

  const handleAddAccount = async () => {
    if (!newAcc.name) return;
    try {
      await createAccountMutation.mutateAsync({
        name: newAcc.name,
        type: newAcc.type,
        openingBalance: newAcc.openingBalance,
        currentBalance: newAcc.openingBalance
      });
      // Reset form - mutation hook will update the accounts list automatically
      setShowAddModal(false);
      setNewAcc({ name: '', type: 'Bank', openingBalance: 0 });
    } catch (err) {
      console.error('Failed to create account:', err);
      toast.error('Failed to create account. Please try again.');
    }
  };

  const handleDeleteAccount = async (accountId: string) => {
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;

    if (account.currentBalance !== 0) {
      toast.warning(`Cannot delete account "${account.name}" because it has a balance of ৳${account.currentBalance}. Please transfer the balance to another account first.`);
      return;
    }

    if (!confirm(`Are you sure you want to delete the account "${account.name}"?`)) return;

    try {
      await deleteAccountMutation.mutateAsync(accountId);
      // Mutation hook will update the accounts list automatically
      setOpenDeleteMenu(null);
    } catch (err) {
      console.error('Failed to delete account:', err);
      toast.error('Failed to delete account. Please try again.');
    }
  };

  const totalBalance = filteredAccounts.reduce((sum, acc) => sum + acc.currentBalance, 0);

  return (
    <div className="space-y-6">
      <LoadingOverlay isLoading={isLoading} message="Loading accounts..." />
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div />
        <Button
          onClick={() => setShowAddModal(true)}
          variant="primary"
          size="md"
          icon={ICONS.Plus}
          disabled={createAccountMutation.isPending}
        >
          Add Account
        </Button>
      </div>

      {/* Summary Card */}
      <div className={`${theme.colors.primary[600]} rounded-xl p-8 text-white shadow-xl shadow-[#0f2f57]/20 relative overflow-hidden`}>
        <div className="relative z-10">
          <p className="text-[#c7dff5] font-medium text-sm mb-1 uppercase tracking-wider">Total Combined Balance</p>
          <h1 className="text-lg font-black">{formatCurrency(totalBalance)}</h1>
          <div className="mt-8 flex gap-6">
            <div>
              <p className="text-[#a8c5e8] text-xs font-bold uppercase">Bank Accounts</p>
              <p className="text-lg font-bold">{accounts.filter(a => a.type === 'Bank').length}</p>
            </div>
            <div className="w-px bg-[#0f2f57]/50 h-10"></div>
            <div>
              <p className="text-[#a8c5e8] text-xs font-bold uppercase">Cash Accounts</p>
              <p className="text-lg font-bold">{accounts.filter(a => a.type === 'Cash').length}</p>
            </div>
          </div>
        </div>
        <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
          <div className="w-48 h-48 border-[24px] border-white rounded-full"></div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredAccounts.map((acc) => (
          <div key={acc.id} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow group relative">
            <div className="flex justify-between items-start mb-4">
              <div className={`p-3 rounded-xl ${acc.type === 'Bank' ? `bg-[#e6f0ff]` : 'bg-orange-50 text-orange-600'}`}>
                {acc.type === 'Bank' ? ICONS.Banking : ICONS.Banking}
              </div>
              <div className="relative">
                <button 
                  onClick={() => setOpenDeleteMenu(openDeleteMenu === acc.id ? null : acc.id)}
                  className="text-gray-400 hover:text-gray-600 p-2 hover:bg-gray-100 rounded-lg transition-all"
                >
                  {ICONS.More}
                </button>
                {openDeleteMenu === acc.id && (
                  <div className="absolute right-0 mt-1 w-40 bg-white border border-gray-100 rounded-lg shadow-lg z-50 py-1">
                    <button
                      onClick={() => handleDeleteAccount(acc.id)}
                      disabled={acc.currentBalance !== 0 || deleteAccountMutation.isPending}
                      className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 font-bold ${
                        acc.currentBalance !== 0 || deleteAccountMutation.isPending
                          ? 'text-gray-400 cursor-not-allowed'
                          : 'text-red-600 hover:bg-red-50'
                      }`}
                      title={acc.currentBalance !== 0 ? 'Account must have zero balance to delete' : 'Delete account'}
                    >
                      {ICONS.Delete} Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
            <h3 className="text-lg font-bold text-gray-900">{acc.name}</h3>
            <p className="text-xs text-gray-400 font-medium uppercase tracking-tight mb-4">{acc.type} Account</p>
            <div className="space-y-2 pt-4 border-t border-gray-50">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Opening Balance</span>
                <span className="font-semibold text-gray-700">{formatCurrency(acc.openingBalance)}</span>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className="text-sm font-bold text-gray-900">Current Balance</span>
                <span className={`text-lg font-black`}>{formatCurrency(acc.currentBalance)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Account Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={() => setShowAddModal(false)}></div>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 animate-in fade-in zoom-in duration-200">
            <div className="p-6 border-b">
              <h3 className="text-xl font-bold text-gray-900">Add New Account</h3>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">Account Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. City Bank - 0987" 
                  className="w-full px-4 py-2 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-emerald-500"
                  value={newAcc.name}
                  onChange={e => setNewAcc({...newAcc, name: e.target.value})}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">Account Type</label>
                <select 
                  className="w-full px-4 py-2 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-emerald-500"
                  value={newAcc.type}
                  onChange={e => setNewAcc({...newAcc, type: e.target.value as 'Bank' | 'Cash'})}
                >
                  <option value="Bank">Bank</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">Opening Balance</label>
                <NumericInput 
                  value={newAcc.openingBalance}
                  onChange={value => setNewAcc({...newAcc, openingBalance: value})}
                  className="bg-gray-50 border rounded-xl focus:ring-2 focus:ring-emerald-500 px-4 py-2"
                  allowDecimals={true}
                  decimalPlaces={2}
                />
              </div>
            </div>
            <div className="p-6 bg-gray-50 rounded-b-2xl flex gap-3">
              <Button 
                onClick={() => setShowAddModal(false)}
                variant="ghost"
                disabled={createAccountMutation.isPending}
              >
                Cancel
              </Button>
              <Button 
                onClick={handleAddAccount}
                variant="primary"
                size="md"
                className="flex-1"
                disabled={createAccountMutation.isPending || !newAcc.name}
              >
                {createAccountMutation.isPending ? 'Creating...' : 'Create Account'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Banking;


