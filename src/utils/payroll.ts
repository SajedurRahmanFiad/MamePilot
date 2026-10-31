import { formatDate } from '../../utils';

export type PayrollPeriodMode = 'month' | 'custom';

export interface PayrollPeriodSelection {
  mode: PayrollPeriodMode;
  selectedMonth: string;
  customDates: { from: string; to: string };
}

export interface PayrollPeriod {
  mode: PayrollPeriodMode;
  periodKind: PayrollPeriodMode;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
}

const pad = (value: number): string => `${value}`.padStart(2, '0');

const formatDateOnly = (value: Date): string => {
  const year = value.getFullYear();
  const month = pad(value.getMonth() + 1);
  const day = pad(value.getDate());
  return `${year}-${month}-${day}`;
};

const parseDateOnly = (value: string): Date | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim())) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const buildDateRangeLabel = (periodStart: string, periodEnd: string): string => {
  const startLabel = formatDate(periodStart);
  const endLabel = formatDate(periodEnd);
  return startLabel === endLabel ? startLabel : `${startLabel} - ${endLabel}`;
};

export const getCurrentMonthValue = (compareDate: Date = new Date()): string =>
  `${compareDate.getFullYear()}-${pad(compareDate.getMonth() + 1)}`;

export const buildMonthlyPayrollPeriod = (selectedMonth: string): PayrollPeriod | null => {
  const raw = String(selectedMonth || '').trim();
  if (!/^\d{4}-\d{2}$/.test(raw)) return null;

  const [year, month] = raw.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0);

  return {
    mode: 'month',
    periodKind: 'month',
    periodStart: formatDateOnly(start),
    periodEnd: formatDateOnly(end),
    periodLabel: new Intl.DateTimeFormat('en-BD', {
      month: 'short',
      year: 'numeric',
    }).format(start),
  };
};

export const buildCustomPayrollPeriod = (
  fromDate: string,
  toDate: string
): PayrollPeriod | null => {
  const parsedFrom = parseDateOnly(fromDate);
  const parsedTo = parseDateOnly(toDate);
  if (!parsedFrom || !parsedTo) return null;

  const start = parsedFrom.getTime() <= parsedTo.getTime() ? parsedFrom : parsedTo;
  const end = parsedFrom.getTime() <= parsedTo.getTime() ? parsedTo : parsedFrom;
  const periodStart = formatDateOnly(start);
  const periodEnd = formatDateOnly(end);

  return {
    mode: 'custom',
    periodKind: 'custom',
    periodStart,
    periodEnd,
    periodLabel: buildDateRangeLabel(periodStart, periodEnd),
  };
};

export const buildPayrollPeriodFromSelection = (
  selection: PayrollPeriodSelection
): PayrollPeriod | null => {
  if (selection.mode === 'month') {
    return buildMonthlyPayrollPeriod(selection.selectedMonth);
  }

  return buildCustomPayrollPeriod(selection.customDates.from, selection.customDates.to);
};

export const isDateWithinPayrollPeriod = (
  value: string,
  periodStart: string,
  periodEnd: string
): boolean => {
  const raw = String(value || '').trim();
  if (!raw) return false;

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw;
  const activityDate = new Date(normalized);
  const startDate = parseDateOnly(periodStart);
  const endDate = parseDateOnly(periodEnd);

  if (
    Number.isNaN(activityDate.getTime()) ||
    !startDate ||
    !endDate
  ) {
    return false;
  }

  endDate.setHours(23, 59, 59, 999);
  return activityDate >= startDate && activityDate <= endDate;
};

export const formatPayrollDateRange = (periodStart: string, periodEnd: string): string =>
  buildDateRangeLabel(periodStart, periodEnd);
