import React from 'react';
import { Button } from './Button';
import { Modal } from './Modal';
import { FraudCheckResults } from './FraudCheckResults';
import type { FraudCheckResult } from '../types';
import { formatDateTime, normalizePhoneSearchValue } from '../utils';

type FraudCheckModalProps = {
  isOpen: boolean;
  onClose: () => void;
  phone: string;
  customerName?: string;
  result?: FraudCheckResult | null;
  checkedAt?: string | null;
};

const isValidPhone = (value: string): boolean => /^0\d{10}$/.test(value);

export const FraudCheckModal: React.FC<FraudCheckModalProps> = ({
  isOpen,
  onClose,
  phone,
  customerName,
  result,
  checkedAt,
}) => {
  const normalizedPhone = normalizePhoneSearchValue(phone);
  const validPhone = isValidPhone(normalizedPhone);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Check Courier History"
      size="xl"
      contentClassName="max-h-[72vh]"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="rounded-2xl border border-gray-100 bg-gray-50 px-5 py-4">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-gray-400">Checking Phone</p>
          <div className="mt-2 flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <p className="text-lg font-black text-gray-900">{normalizedPhone || 'Phone unavailable'}</p>
            {customerName ? <p className="text-sm font-medium text-gray-500">{customerName}</p> : null}
          </div>
        </div>

        {!validPhone ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-800">
            This order does not have a valid 11-digit phone number starting with 0.
          </div>
        ) : null}

        {validPhone && !result ? (
          <div className="rounded-2xl border border-gray-100 bg-white px-6 py-14 text-center text-sm font-medium text-gray-400 shadow-sm">
            Courier history is being checked in the background.
          </div>
        ) : null}
        {validPhone && result ? (
          <>
            {checkedAt ? <p className="text-xs font-medium text-gray-400">Last checked {formatDateTime(checkedAt)}</p> : null}
            <FraudCheckResults result={result} />
          </>
        ) : null}
      </div>
    </Modal>
  );
};

export default FraudCheckModal;
