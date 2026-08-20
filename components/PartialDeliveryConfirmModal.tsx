import React from 'react';
import { formatCurrency } from '../constants';
import { Order, ConfirmPartialDeliveryPayload } from '../types';
import PartialDeliveryForm from './PartialDeliveryForm';

interface PartialDeliveryConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: ConfirmPartialDeliveryPayload) => void | Promise<void>;
  order: Order | null;
  isLoading: boolean;
}

const PartialDeliveryConfirmModal: React.FC<PartialDeliveryConfirmModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  order,
  isLoading,
}) => {
  if (!isOpen || !order) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-[210] w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl border border-[#ebf4ff] bg-white p-8 animate-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-6 top-6 rounded-full border border-gray-200 bg-white p-2 text-gray-500 transition hover:border-gray-300 hover:text-gray-900"
          aria-label="Close"
        >
          x
        </button>

        <div className="mb-6">
          <h3 className="text-2xl font-black text-gray-900">Confirm Partial Delivery</h3>
          <p className="mt-1 text-sm text-gray-500 font-medium">
            Order #{order.orderNumber} · {formatCurrency(order.total)}
          </p>
        </div>

        <PartialDeliveryForm
          order={order}
          isActive={isOpen}
          isLoading={isLoading}
          onSubmit={onSubmit}
          onCancel={onClose}
        />
      </div>
    </div>
  );
};

export default PartialDeliveryConfirmModal;