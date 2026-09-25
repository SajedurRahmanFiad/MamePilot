import React, { useEffect, useState } from 'react';
import { Button, CustomerCreateModal, Modal } from '../components';
import { ICONS } from '../constants';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { useSmsBalance, useSmsHistory, useSmsRechargeHistory, useSmsSummary } from '../src/hooks/useQueries';
import { useInitiateSmsRechargeCheckout, useSendSms } from '../src/hooks/useMutations';
import { fetchCustomersPage } from '../src/services/supabaseQueries';
import type { Customer } from '../types';

const Sms: React.FC = () => {
  const toast = useToastNotifications();
  const [open, setOpen] = useState(false);
  const [showRechargeModal, setShowRechargeModal] = useState(false);
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [custSearchTerm, setCustSearchTerm] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<Customer[]>([]);
  const [pendingSelected, setPendingSelected] = useState<Customer[]>([]);
  const [showCustomerCreate, setShowCustomerCreate] = useState(false);
  const [message, setMessage] = useState('');
  const [tableTab, setTableTab] = useState<'history' | 'recharge_history'>('history');
  const [amount, setAmount] = useState(0);
  const balance = useSmsBalance();
  const summary = useSmsSummary();
  const history = useSmsHistory();
  const recharges = useSmsRechargeHistory();
  const send = useSendSms();
  const recharge = useInitiateSmsRechargeCheckout();

  useEffect(() => {
    if (!open || customers.length > 0) return;
    void fetchCustomersPage(1, 20).then((result) => setCustomers(result.data || [])).catch(() => setCustomers([]));
  }, [open]);

  const findCustomers = async (value: string) => {
    setCustSearchTerm(value);
    if (!value.trim()) { setCustomers([]); return; }
    try { const result = await fetchCustomersPage(1, 20, value); setCustomers(result.data || []); }
    catch { setCustomers([]); }
  };

  const toggleCustomer = (customer: Customer) => {
    setPendingSelected((current) => {
      const next = current.some((item) => item.id === customer.id)
        ? current.filter((item) => item.id !== customer.id)
        : [...current, customer];
      setSelected(next);
      return next;
    });
  };

  const handleCustomerCreated = (customer: Customer) => {
    setPendingSelected((current) => [...current, customer]);
    setSelected((current) => [...current, customer]);
    setShowCustomerCreate(false);
  };

  const handleSend = async () => {
    try {
      await send.mutateAsync({ customerIds: selected.map((customer) => customer.id), message });
      toast.success('SMS sent successfully.');
      setOpen(false); setSelected([]); setPendingSelected([]); setMessage('');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'SMS could not be sent.'); }
  };

  const handleRecharge = async (rechargeAmount: number) => {
    try { const result = await recharge.mutateAsync(rechargeAmount); if (result.checkoutUrl) window.location.href = result.checkoutUrl; }
    catch (error) { toast.error(error instanceof Error ? error.message : 'Recharge could not be started.'); }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-black text-gray-900">SMS</h1><p className="text-sm text-gray-500">Campaign and automatic confirmation messages.</p></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => setShowRechargeModal(true)}>Recharge</Button><Button onClick={() => { setPendingSelected(selected); setOpen(true); }} icon={ICONS.Plus}>Initiate SMS</Button></div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[['Balance', balance.data?.success ? `৳${balance.data.balance.toFixed(2)}` : '—'], ['Total SMS', summary.data?.totalSms ?? 0], ['Pending SMS', summary.data?.pendingSms ?? 0], ['Last Recharge', summary.data?.lastRecharge ? new Date(summary.data.lastRecharge).toLocaleDateString() : '—']].map(([label, value]) => <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm" key={label}><p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{label}</p><p className="mt-2 text-2xl font-bold text-gray-900">{value}</p></div>)}</div>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="flex items-center border-b border-gray-100"><button onClick={() => setTableTab('history')} className={`border-b-2 px-5 py-3.5 text-sm font-bold ${tableTab === 'history' ? 'border-[#0f2f57] text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>SMS History</button><button onClick={() => setTableTab('recharge_history')} className={`border-b-2 px-5 py-3.5 text-sm font-bold ${tableTab === 'recharge_history' ? 'border-[#0f2f57] text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>Recharge History</button></div>
        {tableTab === 'history' ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-gray-100 bg-gray-50/50"><th className="p-4 text-xs uppercase text-gray-400">Recipients</th><th className="p-4 text-xs uppercase text-gray-400">Message</th><th className="p-4 text-xs uppercase text-gray-400">Status</th><th className="p-4 text-xs uppercase text-gray-400">Date</th></tr></thead><tbody>{(history.data || []).map((item: any) => <tr className="border-b border-gray-50" key={item.id}><td className="p-4">{item.recipients}</td><td className="max-w-xs truncate p-4">{item.message}</td><td className="p-4">{item.status}</td><td className="p-4">{item.created_at}</td></tr>)}</tbody></table></div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-gray-100 bg-gray-50/50"><th className="p-4 text-xs uppercase text-gray-400">Reference</th><th className="p-4 text-xs uppercase text-gray-400">Amount</th><th className="p-4 text-xs uppercase text-gray-400">Status</th><th className="p-4 text-xs uppercase text-gray-400">Date</th></tr></thead><tbody>{(recharges.data || []).map((item: any) => <tr className="border-b border-gray-50" key={item.id}><td className="p-4 font-bold">{item.local_reference}</td><td className="p-4">৳{item.amount}</td><td className="p-4">{item.status}</td><td className="p-4">{item.created_at}</td></tr>)}</tbody></table></div>}
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Initiate SMS" size="lg">
        <div className="space-y-4">
          <div className="relative space-y-1">
            <label className="ml-1 text-[10px] font-black uppercase tracking-widest text-gray-400">Select Customers</label>
            <button onClick={() => setShowCustomerSearch(!showCustomerSearch)} className="flex w-full items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-left transition-all hover:bg-white"><span className="flex-1 truncate text-sm font-bold text-gray-900">{pendingSelected.length ? `${pendingSelected.length} customer${pendingSelected.length === 1 ? '' : 's'} selected` : 'Select customers...'}</span>{ICONS.ChevronRight}</button>
            {showCustomerSearch && <div className="absolute bottom-full left-0 z-[110] mb-2 w-full rounded-lg border border-gray-200 bg-white p-2 shadow-2xl">
              <div className="relative mb-2"><div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-gray-300">{ICONS.Search}</div><input autoFocus type="text" placeholder="Search name or phone..." className="w-full rounded-xl border border-gray-100 bg-gray-50 py-2.5 pl-9 pr-4 text-sm font-medium outline-none" value={custSearchTerm} onChange={(event) => void findCustomers(event.target.value)} /></div>
              <div className="max-h-[220px] overflow-y-auto">{customers.length === 0 ? <div className="p-4 text-center text-sm font-medium text-gray-400">No customers found</div> : customers.map((customer) => <button type="button" key={customer.id} onClick={() => toggleCustomer(customer)} className="flex w-full items-center justify-between rounded-lg px-4 py-2.5 text-left hover:bg-[#ebf4ff]"><span><p className="truncate text-sm font-bold text-gray-800">{customer.name}</p><p className="truncate text-[10px] text-gray-400">{customer.phone}</p></span><input readOnly type="checkbox" checked={pendingSelected.some((item) => item.id === customer.id)} /></button>)}</div>
              <button type="button" onClick={() => setShowCustomerCreate(true)} className="mt-2 w-full border-t border-gray-50 py-3 text-[10px] font-black uppercase tracking-widest text-[#3c5a82] hover:bg-[#ebf4ff]">+ Add New Customer</button>
            </div>}
          </div>
          <p className="text-xs text-gray-500">Selected: {selected.map((customer) => customer.name).join(', ') || 'None'}</p>
          <label className="block"><span className="mb-1 block text-sm font-semibold">Message</span><textarea className="min-h-32 w-full rounded-xl border border-gray-200 px-4 py-3" value={message} onChange={(event) => setMessage(event.target.value)} /></label>
          <div className="flex justify-end"><Button onClick={() => void handleSend()} disabled={send.isPending || selected.length === 0 || !message.trim()}>Send SMS</Button></div>
        </div>
      </Modal>
      <Modal isOpen={showRechargeModal} onClose={() => setShowRechargeModal(false)} title="Recharge Balance">
        <div className="space-y-5">
          <p className="text-sm text-gray-500">Enter the amount you want to add to your SMS balance. You will be redirected to the payment gateway.</p>
          <label className="block space-y-2"><span className="text-sm font-semibold text-gray-700">Amount (BDT)</span><input type="number" min="1" step="0.01" value={amount || ''} onChange={(event) => setAmount(Number(event.target.value) || 0)} placeholder="e.g. 500" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm" /></label>
          <div className="flex justify-end gap-3"><Button variant="outline" onClick={() => setShowRechargeModal(false)}>Cancel</Button><Button onClick={() => void handleRecharge(amount)} loading={recharge.isPending} disabled={amount <= 0}>Proceed to Payment</Button></div>
        </div>
      </Modal>
      <CustomerCreateModal isOpen={showCustomerCreate} onClose={() => setShowCustomerCreate(false)} onCreated={handleCustomerCreated} />
    </div>
  );
};

export default Sms;
