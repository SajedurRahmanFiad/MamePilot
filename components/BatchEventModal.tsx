import React, { useState, useEffect, useMemo } from 'react';
import { BatchEventType } from '../types';
import { useBatchesPage, useBatchEventTypes, useAccounts, usePaymentMethods } from '../src/hooks/useQueries';
import { useCreateBatchEvent } from '../src/hooks/useMutations';
import { Button, NumericInput } from '../components';
import { ICONS } from '../constants';
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

  // Batch search state
  const [showBatchSearch, setShowBatchSearch] = useState(false);
  const [batchSearchTerm, setBatchSearchTerm] = useState('');

  const createEventMutation = useCreateBatchEvent();
  const selectedBatch = batches.find(b => b.id === selectedBatchId);

  const filteredBatches = useMemo(() => {
    if (!batchSearchTerm.trim()) return batches;
    const term = batchSearchTerm.trim().toLowerCase();
    return batches.filter(b =>
      b.name.toLowerCase().includes(term) ||
      (b.sku && b.sku.toLowerCase().includes(term)) ||
      (b.categoryName && b.categoryName.toLowerCase().includes(term))
    );
  }, [batches, batchSearchTerm]);

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
      setShowBatchSearch(false);
      setBatchSearchTerm('');
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
          {/* Batch Selection - Search Dropdown */}
          <div className="space-y-1 relative">
            <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Batch</label>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowBatchSearch(!showBatchSearch)}
                className="w-full text-left px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl hover:bg-white focus:ring-2 focus:ring-[#3c5a82] transition-all flex justify-between items-center group"
              >
                {selectedBatch ? (
                  <div className="flex-1 overflow-hidden">
                    <span className="font-bold block text-sm text-gray-900">{selectedBatch.name}</span>
                    <p className="text-[10px] text-gray-500 leading-none mt-0.5">
                      Pop: {selectedBatch.population} | Age: {formatAge(selectedBatch.averageAgeDays)}
                      {selectedBatch.sku ? ` | SKU: ${selectedBatch.sku}` : ''}
                    </p>
                  </div>
                ) : (
                  <span className="text-gray-400 text-sm">Select Batch...</span>
                )}
                <div className={`transition-transform duration-200 ${showBatchSearch ? 'rotate-90' : ''}`}>
                  {ICONS.ChevronRight}
                </div>
              </button>

              {showBatchSearch && (
                <div className="absolute top-full left-0 mt-2 w-full bg-white border border-gray-200 shadow-2xl rounded-lg z-[110] p-2 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                  <div className="relative mb-2">
                    <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none text-gray-300">
                      {ICONS.Search}
                    </div>
                    <input
                      autoFocus
                      type="text"
                      placeholder="Search batch name, SKU, category..."
                      className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-100 rounded-xl outline-none focus:ring-2 focus:ring-[#3c5a82] text-sm font-medium"
                      value={batchSearchTerm}
                      onChange={(e) => setBatchSearchTerm(e.target.value)}
                    />
                  </div>
                  <div className="max-h-[220px] overflow-y-auto space-y-0.5 custom-scrollbar">
                    {filteredBatches.length === 0 ? (
                      <div className="p-4 text-center text-gray-400 text-sm font-medium">No batches found</div>
                    ) : (
                      filteredBatches.map((batch) => (
                        <button
                          key={batch.id}
                          onClick={() => {
                            setSelectedBatchId(batch.id);
                            setShowBatchSearch(false);
                            setBatchSearchTerm('');
                          }}
                          className="w-full px-4 py-2.5 text-left hover:bg-[#ebf4ff] rounded-lg group transition-colors"
                        >
                          <p className="text-sm font-bold text-gray-800">{batch.name}</p>
                          <p className="text-[10px] text-gray-500">
                            Pop: {batch.population} | Age: {formatAge(batch.averageAgeDays)}
                            {batch.sku ? ` | SKU: ${batch.sku}` : ''}
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
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
