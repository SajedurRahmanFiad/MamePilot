import React, { useState, useEffect } from 'react';
import { BatchEventType } from '../types';
import { useBatchesPage, useBatchEventTypes, useAccounts, usePaymentMethods } from '../src/hooks/useQueries';
import { useCreateBatchEvent } from '../src/hooks/useMutations';
import { Button, NumericInput } from '../components';
import { theme } from '../theme';
import { formatAge } from '../src/utils/batchUtils';

interface BatchEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const BatchEventModal: React.FC<BatchEventModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { data: batchesData } = useBatchesPage(1, 10000);
  const batches = batchesData?.data ?? [];
  const { data: eventTypes = [] } = useBatchEventTypes();
  const { data: accounts = [] } = useAccounts();
  const { data: paymentMethods = [] } = usePaymentMethods();

  const [selectedBatchId, setSelectedBatchId] = useState<string>('');
  const [selectedEventTypeId, setSelectedEventTypeId] = useState<string>('');
  const [selectedEventType, setSelectedEventType] = useState<BatchEventType | null>(null);
  const [eventDate, setEventDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [populationChange, setPopulationChange] = useState<number>(0);
  const [expenseAmount, setExpenseAmount] = useState<number>(0);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const createEventMutation = useCreateBatchEvent();
  const selectedBatch = batches.find(b => b.id === selectedBatchId);

  useEffect(() => {
    if (isOpen) {
      setSelectedBatchId('');
      setSelectedEventTypeId('');
      setSelectedEventType(null);
      setEventDate(new Date().toISOString().split('T')[0]);
      setPopulationChange(0);
      setExpenseAmount(0);
      setSelectedAccountId('');
      setSelectedPaymentMethod('');
      setNotes('');
    }
  }, [isOpen]);

  useEffect(() => {
    const et = eventTypes.find(e => e.id === selectedEventTypeId);
    setSelectedEventType(et || null);
  }, [selectedEventTypeId, eventTypes]);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!selectedBatchId || !selectedEventTypeId) return;

    try {
      await createEventMutation.mutateAsync({
        batchId: selectedBatchId,
        eventTypeId: selectedEventTypeId,
        eventDate,
        populationChange: selectedEventType?.requiresPopulationChange ? populationChange : 0,
        expenseAmount: selectedEventType?.requiresExpenseAmount ? expenseAmount : 0,
        accountId: selectedEventType?.requiresAccountId ? selectedAccountId : undefined,
        paymentMethod: selectedEventType?.requiresPaymentMethod ? selectedPaymentMethod : undefined,
        notes: selectedEventType?.requiresNotes ? notes : undefined,
      });
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error('Failed to create batch event:', err);
    }
  };

  const isSubmitDisabled = !selectedBatchId || !selectedEventTypeId || createEventMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative ${theme.colors.bg.primary} border ${theme.colors.border.primary} rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto`}>
        <div className={`p-6 border-b ${theme.colors.border.primary}`}>
          <h2 className={`text-lg font-black ${theme.colors.text.primary}`}>Record Batch Event</h2>
          <p className={`text-sm ${theme.colors.text.secondary} mt-1`}>Log an event for a living product batch.</p>
        </div>

        <div className="p-6 space-y-4">
          {/* Batch Selection */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Batch</label>
            <select
              className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] ${theme.colors.text.primary}`}
              value={selectedBatchId}
              onChange={e => setSelectedBatchId(e.target.value)}
            >
              <option value="">Select Batch...</option>
              {batches.map(batch => (
                <option key={batch.id} value={batch.id}>
                  {batch.name} (Pop: {batch.population} | Age: {formatAge(batch.averageAgeDays)})
                </option>
              ))}
            </select>
          </div>

          {/* Event Type Selection */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Event Type</label>
            <select
              className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] ${theme.colors.text.primary}`}
              value={selectedEventTypeId}
              onChange={e => setSelectedEventTypeId(e.target.value)}
            >
              <option value="">Select Event Type...</option>
              {eventTypes.map(et => (
                <option key={et.id} value={et.id}>{et.name}</option>
              ))}
            </select>
          </div>

          {/* Event Date */}
          <div className="space-y-1">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Event Date</label>
            <input
              type="date"
              className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] ${theme.colors.text.primary}`}
              value={eventDate}
              onChange={e => setEventDate(e.target.value)}
            />
          </div>

          {/* Dynamic Fields Based on Event Type */}
          {selectedEventType && (
            <>
              {selectedEventType.requiresPopulationChange && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                    Population Change {selectedEventType.stockAdjustmentDirection === 'decrease' ? '(reduce)' : selectedEventType.stockAdjustmentDirection === 'increase' ? '(add)' : ''}
                  </label>
                  <NumericInput
                    value={populationChange}
                    onChange={setPopulationChange}
                    className="bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] px-4 py-3"
                    allowDecimals={false}
                    min={selectedEventType.stockAdjustmentDirection === 'decrease' ? -(selectedBatch?.population ?? 0) : 0}
                    max={selectedEventType.stockAdjustmentDirection === 'increase' ? 99999 : selectedBatch?.population ?? 0}
                  />
                </div>
              )}

              {selectedEventType.requiresExpenseAmount && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                    Expense Amount (BDT)
                  </label>
                  <NumericInput
                    value={expenseAmount}
                    onChange={setExpenseAmount}
                    className="bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] px-4 py-3"
                    allowDecimals={true}
                    decimalPlaces={2}
                    min={0}
                  />
                </div>
              )}

              {selectedEventType.requiresAccountId && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Account</label>
                  <select
                    className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] ${theme.colors.text.primary}`}
                    value={selectedAccountId}
                    onChange={e => setSelectedAccountId(e.target.value)}
                  >
                    <option value="">Select Account...</option>
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>{acc.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {selectedEventType.requiresPaymentMethod && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Payment Method</label>
                  <select
                    className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] ${theme.colors.text.primary}`}
                    value={selectedPaymentMethod}
                    onChange={e => setSelectedPaymentMethod(e.target.value)}
                  >
                    <option value="">Select Payment Method...</option>
                    {paymentMethods.map(pm => (
                      <option key={pm.id} value={pm.id}>{pm.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {selectedEventType.requiresNotes && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Notes</label>
                  <textarea
                    className={`w-full px-4 py-3 bg-gray-50 border rounded-xl focus:ring-2 focus:ring-[#3c5a82] min-h-[100px] ${theme.colors.text.primary}`}
                    value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="Enter event details..."
                  />
                </div>
              )}
            </>
          )}
        </div>

        <div className={`p-6 border-t ${theme.colors.border.primary} flex gap-4 justify-end`}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={isSubmitDisabled}
          >
            {createEventMutation.isPending ? 'Recording...' : 'Record Event'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default BatchEventModal;
