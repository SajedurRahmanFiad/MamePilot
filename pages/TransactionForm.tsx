import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { db } from '../db';
import { Transaction } from '../types';
import { ICONS, formatCurrency } from '../constants';
import { Button, NumericInput } from '../components';
import { theme } from '../theme';
import { useAccounts, useCategories, usePaymentMethods, useSystemDefaults, useTransaction } from '../src/hooks/useQueries';
import { useCreateTransaction, useUpdateTransaction } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { getPreservedRouteState } from '../src/utils/navigation';
import { buildLocalDateTime, compressImage, formatDate, getTodayDate, normalizeUtcTimestamp, openAttachmentPreview } from '../utils';
import { useRolePermissions } from '../src/hooks/useRolePermissions';

type TransactionFormState = {
  date: string;
  time: string;
  paymentMethod: string;
  accountId: string;
  amount: number;
  description: string;
  category: string;
  attachmentName: string;
  attachmentUrl: string;
};

const getDefaultTimeValue = (): string =>
  new Date().toLocaleTimeString('en-BD', { hour: '2-digit', minute: '2-digit', hour12: false });

const createInitialFormState = (): TransactionFormState => ({
  date: getTodayDate(),
  time: getDefaultTimeValue(),
  paymentMethod: 'Cash',
  accountId: '',
  amount: 0,
  description: '',
  category: '',
  attachmentName: '',
  attachmentUrl: '',
});

const toInputDateValue = (value?: string | null): string => {
  const raw = normalizeUtcTimestamp(value) || String(value || '').trim();
  if (!raw) return getTodayDate();

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return getTodayDate();

  return parsed.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
};

const toInputTimeValue = (value?: string | null): string => {
  const raw = normalizeUtcTimestamp(value) || String(value || '').trim();
  if (!raw) return getDefaultTimeValue();
  if (raw.length <= 10) return '00:00';

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return getDefaultTimeValue();

  return parsed.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Dhaka',
  });
};

const TransactionForm: React.FC = () => {
  const { id, type } = useParams<{ id?: string; type?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const user = db.currentUser;
  const isEdit = Boolean(id);

  const { data: accounts = [] } = useAccounts();
  const { data: systemDefaults } = useSystemDefaults();
  const { data: paymentMethods = [] } = usePaymentMethods();
  const { data: allCategories = [] } = useCategories();
  const {
    data: existingTransaction,
    isPending: existingTransactionLoading,
    error: existingTransactionError,
  } = useTransaction(isEdit ? id : undefined);
  const createTransactionMutation = useCreateTransaction();
  const updateTransactionMutation = useUpdateTransaction();
  const toast = useToastNotifications();

  const transactionType = isEdit
    ? existingTransaction?.type
    : type === 'expense'
      ? 'Expense'
      : 'Income';
  const isIncome = transactionType === 'Income';

  const categories = useMemo(
    () => allCategories.filter((category) => category.type === transactionType),
    [allCategories, transactionType]
  );

  const [form, setForm] = useState<TransactionFormState>(createInitialFormState);
  const initializedEditRef = useRef(false);

  useEffect(() => {
    if (isEdit) return;

    setForm((current) => {
      const defaultCategory = isIncome ? systemDefaults?.incomeCategoryId : systemDefaults?.expenseCategoryId;
      const nextState = {
        ...current,
        paymentMethod: current.paymentMethod || systemDefaults?.paymentMethod || 'Cash',
        accountId: current.accountId || systemDefaults?.accountId || accounts[0]?.id || '',
        category: current.category || defaultCategory || categories[0]?.id || '',
      };

      if (
        nextState.paymentMethod === current.paymentMethod &&
        nextState.accountId === current.accountId &&
        nextState.category === current.category
      ) {
        return current;
      }

      return nextState;
    });
  }, [
    isEdit,
    isIncome,
    accounts,
    categories,
    systemDefaults?.accountId,
    systemDefaults?.paymentMethod,
    systemDefaults?.incomeCategoryId,
    systemDefaults?.expenseCategoryId,
  ]);

  useEffect(() => {
    if (!isEdit || !existingTransaction || initializedEditRef.current) return;

    setForm({
      date: toInputDateValue(existingTransaction.date || existingTransaction.createdAt),
      time: toInputTimeValue(existingTransaction.date || existingTransaction.createdAt),
      paymentMethod: existingTransaction.paymentMethod || systemDefaults?.paymentMethod || 'Cash',
      accountId: existingTransaction.accountId || systemDefaults?.accountId || accounts[0]?.id || '',
      amount: existingTransaction.amount,
      description: existingTransaction.description || '',
      category: existingTransaction.category || '',
      attachmentName: existingTransaction.attachmentName || '',
      attachmentUrl: existingTransaction.attachmentUrl || '',
    });
    initializedEditRef.current = true;
  }, [
    isEdit,
    existingTransaction,
    accounts,
    systemDefaults?.accountId,
    systemDefaults?.paymentMethod,
  ]);

  const handleClose = () => {
    const navState = getPreservedRouteState(location.state);

    if (navState.backMode === 'history' && window.history.length > 1) {
      navigate(-1);
      return;
    }

    if (navState.from) {
      navigate(navState.from);
      return;
    }

    navigate('/transactions');
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      try {
        const compressed = await compressImage(file, { maxWidth: 1600, maxHeight: 1600, quality: 0.82 });
        setForm((current) => ({
          ...current,
          attachmentName: file.name,
          attachmentUrl: compressed,
        }));
        return;
      } catch { /* fallback below */ }
    }

    const reader = new FileReader();
    reader.onload = () => {
      setForm((current) => ({
        ...current,
        attachmentName: file.name,
        attachmentUrl: reader.result as string,
      }));
    };
    reader.readAsDataURL(file);
  };

  const isLoading = createTransactionMutation.isPending || updateTransactionMutation.isPending;

  const handleSave = async () => {
    if (form.amount <= 0) {
      toast.warning('Amount must be greater than 0');
      return;
    }
    if (!form.accountId) {
      toast.warning('Please select an account');
      return;
    }
    if (!form.category) {
      toast.warning('Please select a category');
      return;
    }

    if (!user?.id) {
      toast.warning('User session expired. Please log in again.');
      return;
    }

    try {
      if (!isIncome) {
        const account = accounts.find((entry) => entry.id === form.accountId);
        const reclaimedAmount = isEdit && existingTransaction?.type === 'Expense' && existingTransaction.accountId === form.accountId
          ? existingTransaction.amount
          : 0;
        const availableBalance = (account?.currentBalance || 0) + reclaimedAmount;

        if (account && availableBalance < form.amount) {
          toast.error(`Insufficient balance. Account has ${formatCurrency(availableBalance)} available but transaction requires ${formatCurrency(form.amount)}`);
          return;
        }
      }

      const localDateTime = buildLocalDateTime(form.date, form.time);
      if (!localDateTime) {
        toast.warning('Please enter a valid date and time');
        return;
      }

      const dateStr = formatDate(form.date);
      const timeStr = form.time;
      const isoDatetime = localDateTime.toISOString();

      const transactionPayload: Partial<Transaction> = {
        type: isIncome ? 'Income' : 'Expense',
        date: isoDatetime,
        paymentMethod: form.paymentMethod,
        accountId: form.accountId,
        amount: form.amount,
        description: form.description,
        category: form.category,
        attachmentName: form.attachmentName,
        attachmentUrl: form.attachmentUrl,
      };

      if (isEdit && existingTransaction) {
        const updatedTransaction = await updateTransactionMutation.mutateAsync({
          id: existingTransaction.id,
          updates: transactionPayload,
        });
        if (updatedTransaction.approvalStatus === 'pending') {
          toast.info(`${isIncome ? 'Income' : 'Expense'} updated and sent for admin approval.`);
        } else {
          toast.success(`${isIncome ? 'Income' : 'Expense'} updated successfully`);
        }
      } else {
        const transaction: Omit<Transaction, 'id'> = {
          ...transactionPayload,
          createdBy: user.id,
          history: {
            created: `Created by ${user.name} on ${dateStr}, at ${timeStr}`,
          },
        } as Omit<Transaction, 'id'>;

        const createdTransaction = await createTransactionMutation.mutateAsync(transaction);
        if (createdTransaction.approvalStatus === 'pending') {
          toast.info(`${isIncome ? 'Income' : 'Expense'} recorded and sent for admin approval.`);
        } else {
          toast.success(`${isIncome ? 'Income' : 'Expense'} recorded successfully`);
        }
      }

      handleClose();
    } catch (error) {
      console.error('Failed to save transaction:', error);
      toast.error(error instanceof Error ? error.message : `Could not ${isEdit ? 'update' : 'save'} the transaction. Please try again.`);
    }
  };

  if (!user) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Not Authenticated</h2>
        <p className="text-gray-500 mb-6">Please log in first.</p>
        <Button onClick={() => navigate('/login')} variant="primary">Back to Login</Button>
      </div>
    );
  }

  if (isEdit && existingTransactionLoading) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Loading...</h2>
        <p className="text-gray-500 mb-6">Fetching transaction details...</p>
      </div>
    );
  }

  if (isEdit && (existingTransactionError || !existingTransaction)) {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Transaction Not Found</h2>
        <p className="text-gray-500 mb-6">{existingTransactionError?.message || 'This transaction could not be loaded.'}</p>
        <Button onClick={handleClose} variant="primary">Back to Transactions</Button>
      </div>
    );
  }

  if (isEdit && existingTransaction?.type === 'Transfer') {
    return (
      <div className="p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Transfer Editing Unsupported</h2>
        <p className="text-gray-500 mb-6">Transfers should continue to be managed from the transfer workflow.</p>
        <Button onClick={handleClose} variant="primary">Back to Transactions</Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto animate-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="md:text-2xl text-xl font-black text-gray-900 tracking-tight">{isEdit ? 'Edit' : 'Record'} {isIncome ? 'Income' : 'Expense'}</h2>
        </div>
        <button onClick={handleClose} className="p-3 text-gray-400 hover:text-gray-600 bg-white border border-gray-100 rounded-lg shadow-sm">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l18 18"></path></svg>
        </button>
      </div>

      <div className="bg-white p-8 lg:p-12 rounded-lg border border-gray-100 shadow-xl shadow-gray-200/20 space-y-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Amount (BDT)</label>
            <NumericInput
              value={form.amount}
              onChange={(value) => setForm({ ...form, amount: value })}
              className={`text-lg bg-gray-50 border-2 border-transparent focus:border-[#3c5a82] focus:bg-white rounded-xl px-6 py-4 transition-all ${isIncome ? theme.colors.primary.text : 'text-red-600'}`}
              allowDecimals={true}
              decimalPlaces={2}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Date</label>
            <input
              type="date"
              className="w-full px-6 py-4 bg-gray-50 border-transparent focus:border-[#3c5a82] focus:bg-white rounded-lg text-lg font-bold"
              value={form.date}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Time</label>
            <input
              type="time"
              className="w-full px-6 py-4 bg-gray-50 border-transparent focus:border-[#3c5a82] focus:bg-white rounded-lg text-lg font-bold"
              value={form.time}
              onChange={(event) => setForm({ ...form, time: event.target.value })}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Connected Account</label>
            <select
              className="w-full px-6 py-4 bg-gray-50 border-transparent focus:border-[#3c5a82] focus:bg-white rounded-xl font-bold"
              value={form.accountId}
              onChange={(event) => setForm({ ...form, accountId: event.target.value })}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Category</label>
            <select
              className="w-full px-6 py-4 bg-gray-50 border-transparent focus:border-[#3c5a82] focus:bg-white rounded-xl font-bold"
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
            >
              <option value="">Select a category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>{category.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Payment Method</label>
            <select
              className="w-full px-6 py-4 bg-gray-50 border-transparent focus:border-[#3c5a82] focus:bg-white rounded-xl font-bold"
              value={form.paymentMethod}
              onChange={(event) => setForm({ ...form, paymentMethod: event.target.value })}
            >
              {paymentMethods.map((paymentMethod) => (
                <option key={paymentMethod.id} value={paymentMethod.name}>{paymentMethod.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Attachment</label>
            <div className="relative">
              <input
                type="file"
                className="hidden"
                id="file-upload"
                onChange={handleFileUpload}
              />
              <label
                htmlFor="file-upload"
                className="w-full px-6 py-4 bg-gray-50 border-transparent hover:bg-gray-100 rounded-lg font-bold pl-14 flex items-center cursor-pointer transition-colors"
              >
                {form.attachmentName || (isEdit ? 'Keep existing file or upload a new one' : 'Choose file to upload')}
              </label>
              <div className="absolute left-6 top-1/2 -translate-y-1/2 text-gray-400">
                {ICONS.Print}
              </div>
            </div>
            {form.attachmentUrl && (
              <button
                type="button"
                onClick={() => {
                  if (!openAttachmentPreview(form.attachmentUrl)) {
                    toast.error('Unable to open attachment');
                  }
                }}
                className="mt-3 inline-flex items-center gap-2 px-3 py-2 text-xs font-bold text-[#0f2f57] bg-[#ebf4ff] hover:bg-[#dbe9fa] rounded-lg transition-colors"
              >
                {ICONS.View}
                <span>View attachment</span>
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-black text-gray-400 uppercase tracking-widest">Description</label>
          <textarea
            className="w-full px-6 py-4 bg-gray-50 border-transparent focus:border-[#3c5a82] focus:bg-white rounded-lg font-medium h-32 outline-none"
            placeholder="What was this transaction for?"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </div>

        <Button
          onClick={handleSave}
          variant={isIncome ? 'primary' : 'danger'}
          size="lg"
          className="w-full"
          disabled={isLoading}
          loading={isLoading}
        >
          {isEdit ? 'Update' : 'Finalize'} {isIncome ? 'Income' : 'Expense'}
        </Button>
      </div>
    </div>
  );
};

export default TransactionForm;
