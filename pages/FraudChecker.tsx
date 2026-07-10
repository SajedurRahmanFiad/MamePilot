import React from 'react';
import { Button, FraudCheckResults } from '../components';
import { ICONS } from '../constants';
import { useCheckFraudCourierHistory } from '../src/hooks/useMutations';
import { useToastNotifications } from '../src/contexts/ToastContext';
import { normalizePhoneSearchValue, sanitizePhoneInput } from '../utils';
import { useRolePermissions } from '../src/hooks/useRolePermissions';

const isValidBangladeshPhone = (value: string): boolean => /^0\d{10}$/.test(value);

const FraudCheckerPage: React.FC = () => {
  const toast = useToastNotifications();
  const mutation = useCheckFraudCourierHistory();
  const { canViewFraudHistory } = useRolePermissions();
  const [phone, setPhone] = React.useState('');
  const normalizedPhone = normalizePhoneSearchValue(phone);
  const isValidPhone = isValidBangladeshPhone(normalizedPhone);

  const handleCheck = () => {
    if (!isValidPhone) {
      toast.warning('Enter a valid 11-digit phone number starting with 0.');
      return;
    }

    mutation.mutate({ phone: normalizedPhone });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-2" />

      <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-[0.18em] text-gray-400">Phone Number</label>
            <div className='flex flex-col gap-5 lg:flex-row'>
              <input
                type="text"
                inputMode="numeric"
                maxLength={11}
                value={phone}
                onChange={(event) => {
                  const nextValue = sanitizePhoneInput(event.target.value);
                  const nextNormalizedPhone = normalizePhoneSearchValue(nextValue);
                  if (nextValue === '' || nextNormalizedPhone.startsWith('0')) {
                    setPhone(nextValue);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleCheck();
                  }
                }}
                placeholder="017xxxxxxxx"
                className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-5 py-4 text-base font-bold text-gray-900 outline-none transition-all focus:border-[#0f2f57] focus:bg-white"
              />
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={handleCheck}
                loading={mutation.isPending}
                icon={ICONS.FraudChecker}
                className="w-full lg:w-auto lg:px-6 lg:py-4"
              >
                Check
              </Button>
            </div>
          </div>
        </div>
      </section>

      {mutation.error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-semibold text-red-600">
          {mutation.error.message}
        </div>
      ) : null}

      {mutation.isPending && !mutation.data ? (
        <div className="rounded-2xl border border-gray-100 bg-white px-6 py-16 text-center text-sm font-medium text-gray-400 shadow-sm">
          Checking courier history...
        </div>
      ) : null}

      {mutation.data ? (
        <FraudCheckResults result={mutation.data} />
      ) : (
        !mutation.isPending && (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-6 py-16 text-center text-sm font-medium text-gray-400">
            Enter a phone number and press Check to load courier history.
          </div>
        )
      )}
    </div>
  );
};

export default FraudCheckerPage;
