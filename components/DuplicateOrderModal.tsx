import React from 'react';
import { Order } from '../types';
import { formatCurrency, ICONS } from '../constants';
import { Modal } from './Modal';

interface DuplicateOrderModalProps {
  isOpen: boolean;
  duplicateOrder: Order | null;
  onConfirm: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export const DuplicateOrderModal: React.FC<DuplicateOrderModalProps> = ({
  isOpen,
  duplicateOrder,
  onConfirm,
  onCancel,
  isLoading = false,
}) => {
  if (!isOpen || !duplicateOrder) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Similar Order Already Exists"
      size="xl"
      contentClassName="p-0 max-h-[80vh] overflow-hidden"
      footer={
        <>
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg font-semibold hover:bg-amber-700 transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Creating...' : 'Create Anyway'}
          </button>
        </>
      }
    >
      <div className="h-full flex flex-col overflow-hidden bg-gray-50">
        <div className="bg-white border-b border-gray-200 p-6">
          <div className="flex items-start gap-3">
            <div className="text-amber-600 mt-1">{ICONS.AlertCircle}</div>
            <div>
              <p className="text-sm font-bold text-gray-900">We found an order with the same customer and products.</p>
              <p className="text-sm text-gray-600 mt-2">Are you sure you want to create a duplicate?</p>
            </div>
          </div>
        </div>

        <div className="overflow-y-auto p-6">
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm">
            <div className="space-y-6">
              <div className="flex items-start justify-between gap-6">
                <div>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Order Number</p>
                  <p className="text-lg font-black text-gray-900 mt-1">#{duplicateOrder.orderNumber}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Order Date</p>
                  <p className="text-sm font-semibold text-gray-700 mt-1">{duplicateOrder.orderDate}</p>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-4">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-2 text-xs font-bold text-gray-500 uppercase">Product</th>
                      <th className="text-center py-2 text-xs font-bold text-gray-500 uppercase">Qty</th>
                      <th className="text-right py-2 text-xs font-bold text-gray-500 uppercase">Rate</th>
                      <th className="text-right py-2 text-xs font-bold text-gray-500 uppercase">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {duplicateOrder.items?.map((item, idx) => (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="py-2 text-gray-900 font-medium">{item.productName}</td>
                        <td className="py-2 text-center text-gray-700">{item.quantity}</td>
                        <td className="py-2 text-right text-gray-700">{formatCurrency(item.rate)}</td>
                        <td className="py-2 text-right font-semibold text-gray-900">{formatCurrency(item.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-gray-200 pt-4 space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Subtotal:</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(duplicateOrder.subtotal)}</span>
                </div>
                {duplicateOrder.discount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Discount:</span>
                    <span className="font-semibold text-red-600">-{formatCurrency(duplicateOrder.discount)}</span>
                  </div>
                )}
                {duplicateOrder.shipping > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Shipping:</span>
                    <span className="font-semibold text-gray-900">+{formatCurrency(duplicateOrder.shipping)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base border-t border-gray-200 pt-2">
                  <span className="font-bold text-gray-900">Total:</span>
                  <span className="font-black text-gray-900">{formatCurrency(duplicateOrder.total)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
};
