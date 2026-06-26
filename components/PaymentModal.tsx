import React from 'react';
import { Button, NumericInput } from './index';
import { formatCurrency } from '../constants';
import { theme } from '../theme';
import { Account } from '../types';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: () => void | Promise<void>;
  accounts: Account[];
  paymentForm: {
    date: string;
    accountId: string;
    amount: number;
  };
  setPaymentForm: (form: any) => void;
  isLoading: boolean;
  variant?: 'orders' | 'details';
}

const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  accounts,
  paymentForm,
  setPaymentForm,
  isLoading,
  variant = 'orders'
}) => {
  if (!isOpen) return null;

  const isOrdersVariant = variant === 'orders';

  if (isOrdersVariant) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={onClose}></div>
        <div className="bg-white w-full max-w-md rounded-[2.5rem] p-10 z-[210] animate-in zoom-in-95 duration-200 border border-[#ebf4ff]">
          <h3 className="text-2xl font-black text-gray-900 mb-8">Receive Payment</h3>
          <div className="space-y-6">
            <div className="space-y-1">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-2">Payment Date</label>
              <input 
                type="date" 
                value={paymentForm.date} 
                onChange={e => setPaymentForm({...paymentForm, date: e.target.value})} 
                className="w-full px-6 py-3.5 bg-gray-50 border border-gray-100 rounded-lg font-bold focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-2">Select Account</label>
              <select 
                value={paymentForm.accountId} 
                onChange={e => setPaymentForm({...paymentForm, accountId: e.target.value})} 
                className="w-full px-6 py-3.5 bg-gray-50 border border-gray-100 rounded-lg font-bold focus:ring-2 focus:ring-emerald-500 outline-none"
              >
                <option value="">Select an account...</option>
                {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name} ({formatCurrency(acc.currentBalance)})</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-2">Amount (BDT)</label>
              <NumericInput 
                value={paymentForm.amount} 
                onChange={amount => setPaymentForm({...paymentForm, amount})} 
                className={`bg-[#ebf4ff] border-2 border-[#c7dff5] text-lg ${theme.colors.primary[600]}`}
                disabled={isLoading}
                decimalPlaces={2}
                allowDecimals={true}
              />
            </div>

            <div className="pt-6 flex gap-4">
              <Button 
                onClick={onClose} 
                variant="ghost" 
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button 
                onClick={onSubmit} 
                variant="primary" 
                size="md" 
                className="flex-1"
                disabled={isLoading} 
                loading={isLoading}
              >
                Add Payment
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Details variant
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="bg-white w-full max-w-md rounded-xl p-8 z-[130] animate-in zoom-in-95 duration-200">
        <h3 className="text-xl font-bold text-gray-900 mb-6">Order Payment</h3>
        <div className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Payment Date</label>
            <input 
              type="date" 
              value={paymentForm.date} 
              onChange={e => setPaymentForm({...paymentForm, date: e.target.value})} 
              className="w-full px-4 py-3 bg-gray-50 border rounded-xl"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Select Account</label>
            <select 
              value={paymentForm.accountId} 
              onChange={e => setPaymentForm({...paymentForm, accountId: e.target.value})} 
              className="w-full px-4 py-3 bg-gray-50 border rounded-xl"
            >
              <option value="">Select an account...</option>
              {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name} ({formatCurrency(acc.currentBalance)})</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Amount to Pay</label>
            <NumericInput 
              value={paymentForm.amount} 
              onChange={amount => setPaymentForm({...paymentForm, amount})} 
              className="bg-gray-50 border"
              disabled={isLoading}
              decimalPlaces={2}
              allowDecimals={true}
            />
          </div>
          <div className="pt-4 flex gap-3">
            <Button 
              onClick={onClose} 
              variant="ghost" 
              className="flex-1" 
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button 
              onClick={onSubmit} 
              variant="primary" 
              size="md" 
              className="flex-1" 
              loading={isLoading} 
              disabled={isLoading}
            >
              Save Payment
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentModal;
