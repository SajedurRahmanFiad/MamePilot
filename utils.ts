/**
 * Utility Functions for Common Operations
 * These functions are reused across many components to avoid repetition
 */

import type { Bill, Order, Transaction } from './types';
import { OrderStatus, BillStatus } from './types';

const DYNAMIC_TEXT_FILTER_PREFIX = '__mp_filter_v1__:';

export const encodeDynamicTextFilterValue = (value: string, contains: boolean): string => (
  `${DYNAMIC_TEXT_FILTER_PREFIX}${contains ? 'contains' : 'equals'}:${encodeURIComponent(String(value ?? ''))}`
);

export const decodeDynamicTextFilterValue = (encoded: string): { value: string; contains: boolean } => {
  const raw = String(encoded ?? '');
  if (raw.startsWith(DYNAMIC_TEXT_FILTER_PREFIX)) {
    const payload = raw.slice(DYNAMIC_TEXT_FILTER_PREFIX.length);
    const separatorIndex = payload.indexOf(':');
    if (separatorIndex > 0) {
      const mode = payload.slice(0, separatorIndex);
      if (mode === 'equals' || mode === 'contains') {
        try {
          return {
            value: decodeURIComponent(payload.slice(separatorIndex + 1)),
            contains: mode === 'contains',
          };
        } catch {
          // Fall through to legacy/plain decoding for malformed external state.
        }
      }
    }
  }

  const contains = raw.length >= 2 && raw.startsWith('%') && raw.endsWith('%');
  return {
    value: contains ? raw.slice(1, -1) : raw,
    contains,
  };
};

export type FilterRange =
  | 'All Time'
  | 'Today'
  | 'Last 7 days'
  | 'Last 30 days'
  | 'This Week'
  | 'This Month'
  | 'This Year'
  | 'Custom';

export const APP_TIME_ZONE = 'Asia/Dhaka';
const UTC_OFFSET_SUFFIX_PATTERN = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_MINUTE_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}$/;
const DATE_TIME_SECOND_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/;
const ISO_TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:[zZ]|[+-]\d{2}:?\d{2})?/;
const HUMAN_HISTORY_TIMESTAMP_PATTERN = /(?:\bon\s+)?(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})(?:,?\s+at\s+|,\s*at\s*)(\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm|a\.m\.|p\.m\.))?)/i;
const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

type CalendarDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const isValidDate = (value: Date): boolean => !Number.isNaN(value.getTime());

const getTimeZoneParts = (value: Date, timeZone = APP_TIME_ZONE): CalendarDateTimeParts => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
};

const formatCalendarYmd = (parts: Pick<CalendarDateTimeParts, 'year' | 'month' | 'day'>): string => {
  const year = `${parts.year}`.padStart(4, '0');
  const month = `${parts.month}`.padStart(2, '0');
  const day = `${parts.day}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatYmd = (value: Date): string => formatCalendarYmd(getTimeZoneParts(value));

const parseCalendarYmd = (value: string): Pick<CalendarDateTimeParts, 'year' | 'month' | 'day'> | null => {
  if (!DATE_ONLY_PATTERN.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year
    || check.getUTCMonth() !== month - 1
    || check.getUTCDate() !== day
  ) return null;
  return { year, month, day };
};

const getTimeZoneOffsetMilliseconds = (value: Date, timeZone = APP_TIME_ZONE): number => {
  const parts = getTimeZoneParts(value, timeZone);
  const valueWithoutMilliseconds = Math.floor(value.getTime() / 1000) * 1000;
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - valueWithoutMilliseconds;
};

const buildTimeZoneDate = (
  parts: CalendarDateTimeParts,
  milliseconds = 0,
  timeZone = APP_TIME_ZONE,
): Date | null => {
  const utcGuess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, milliseconds);
  let candidate = new Date(utcGuess - getTimeZoneOffsetMilliseconds(new Date(utcGuess), timeZone));
  const correctedOffset = getTimeZoneOffsetMilliseconds(candidate, timeZone);
  candidate = new Date(utcGuess - correctedOffset);
  if (!isValidDate(candidate)) return null;

  const roundTrip = getTimeZoneParts(candidate, timeZone);
  if (
    roundTrip.year !== parts.year
    || roundTrip.month !== parts.month
    || roundTrip.day !== parts.day
    || roundTrip.hour !== parts.hour
    || roundTrip.minute !== parts.minute
    || roundTrip.second !== parts.second
  ) return null;
  return candidate;
};

const parseYmd = (value: string, endOfDay: boolean): Date | null => {
  const calendar = parseCalendarYmd(value);
  if (!calendar) return null;
  return buildTimeZoneDate({
    ...calendar,
    hour: endOfDay ? 23 : 0,
    minute: endOfDay ? 59 : 0,
    second: endOfDay ? 59 : 0,
  }, endOfDay ? 999 : 0);
};

const parseDateInput = (value: string): Date | null => {
  const ymd = parseYmd(value, false);
  if (ymd) return ymd;
  const raw = String(value || '').trim();
  const normalized = /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(raw) && !UTC_OFFSET_SUFFIX_PATTERN.test(raw)
    ? `${raw}Z`
    : raw;
  const date = new Date(normalized);
  return isValidDate(date) ? date : null;
};

const parseCustomDateBoundary = (value: string, edge: 'start' | 'end'): Date | null => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  if (DATE_ONLY_PATTERN.test(trimmed)) {
    return parseYmd(trimmed, edge === 'end');
  }

  if (DATE_TIME_MINUTE_PATTERN.test(trimmed) || DATE_TIME_SECOND_PATTERN.test(trimmed)) {
    const [datePart, timePart = '00:00'] = trimmed.replace('T', ' ').split(' ');
    const calendar = parseCalendarYmd(datePart);
    if (!calendar) return null;
    const [hour = 0, minute = 0, parsedSecond = 0] = timePart.split(':').map(Number);
    const second = DATE_TIME_MINUTE_PATTERN.test(trimmed) && edge === 'end' ? 59 : parsedSecond;
    return buildTimeZoneDate(
      { ...calendar, hour, minute, second },
      edge === 'end' ? 999 : 0,
    );
  }

  const date = parseDateInput(trimmed);
  if (!date) return null;

  if (DATE_TIME_MINUTE_PATTERN.test(trimmed)) {
    if (edge === 'end') {
      date.setSeconds(59, 999);
    } else {
      date.setSeconds(0, 0);
    }
    return date;
  }

  if (DATE_TIME_SECOND_PATTERN.test(trimmed)) {
    if (edge === 'end') {
      date.setMilliseconds(999);
    } else {
      date.setMilliseconds(0);
    }
  }

  return date;
};

export const toDateTimeLocalInputValue = (value: string, edge: 'start' | 'end' = 'start'): string => {
  const date = parseCustomDateBoundary(value, edge);
  if (!date) return '';

  const parts = getTimeZoneParts(date);
  const year = parts.year;
  const month = `${parts.month}`.padStart(2, '0');
  const day = `${parts.day}`.padStart(2, '0');
  const hours = `${parts.hour}`.padStart(2, '0');
  const minutes = `${parts.minute}`.padStart(2, '0');

  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export const normalizeUtcTimestamp = (value?: string | null): string => {
  if (!value) return '';
  const raw = String(value).trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const normalized = UTC_OFFSET_SUFFIX_PATTERN.test(raw) ? raw : `${raw}Z`;
  const date = new Date(normalized);
  return isValidDate(date) ? date.toISOString() : raw;
};

export const buildLocalDateTime = (dateValue: string, timeValue: string = '00:00'): Date | null => {
  const calendar = parseCalendarYmd(String(dateValue || '').trim());
  if (!calendar) return null;
  const [hoursStr = '0', minutesStr = '0', secondsStr = '0'] = String(timeValue || '').split(':');
  const hour = Number(hoursStr);
  const minute = Number(minutesStr);
  const second = Number(secondsStr);
  if (![hour, minute, second].every(Number.isFinite)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  return buildTimeZoneDate({ ...calendar, hour, minute, second });
};

export const combineDateAndTimeToIso = (dateValue: string, timeValue: string = '00:00'): string => {
  const localDateTime = buildLocalDateTime(dateValue, timeValue);
  return localDateTime ? localDateTime.toISOString() : '';
};

const parseHumanHistoryDate = (datePart: string, timePart: string): Date | null => {
  const normalizedDate = datePart.trim().replace(/,/g, '');
  const dayFirst = normalizedDate.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  const monthFirst = normalizedDate.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/);
  const day = Number(dayFirst?.[1] ?? monthFirst?.[2]);
  const monthName = String(dayFirst?.[2] ?? monthFirst?.[1] ?? '').toLowerCase();
  const month = MONTH_INDEX[monthName];
  const year = Number(dayFirst?.[3] ?? monthFirst?.[3]);
  if (!year || !month || !day) return null;

  const normalizedTime = timePart.trim().toLowerCase().replace(/\./g, '');
  const timeMatch = normalizedTime.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!timeMatch) return null;
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] || 0);
  const meridiem = timeMatch[4];
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = hour % 12 + (meridiem === 'pm' ? 12 : 0);
  }
  if (hour > 23 || minute > 59 || second > 59) return null;
  return buildTimeZoneDate({ year, month, day, hour, minute, second });
};

/**
 * Parse an activity-history timestamp without ever consulting the browser's
 * local timezone. ISO/database values are UTC; legacy readable values are
 * Bangladesh wall-clock values.
 */
export const parseHistoryTimestamp = (value?: string | null): Date | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const isoMatch = raw.match(ISO_TIMESTAMP_PATTERN);
  if (isoMatch?.[0]) {
    const normalized = normalizeUtcTimestamp(isoMatch[0]);
    const parsed = new Date(normalized);
    if (isValidDate(parsed)) return parsed;
  }

  const humanMatch = raw.match(HUMAN_HISTORY_TIMESTAMP_PATTERN);
  if (humanMatch?.[1] && humanMatch?.[2]) {
    const parsed = parseHumanHistoryDate(humanMatch[1], humanMatch[2]);
    if (parsed) return parsed;
  }

  if (UTC_OFFSET_SUFFIX_PATTERN.test(raw)) {
    const parsed = new Date(raw);
    if (isValidDate(parsed)) return parsed;
  }
  return null;
};

export const parseCreatedHistoryTimestamp = (value?: string | null): string => {
  return parseHistoryTimestamp(value)?.toISOString() || '';
};

const resolveActivityDate = (
  timestampValue?: string | null,
  dateOnlyValue?: string | null,
  historyCreatedValue?: string | null
): string => {
  return (
    normalizeUtcTimestamp(timestampValue) ||
    parseCreatedHistoryTimestamp(historyCreatedValue) ||
    String(dateOnlyValue || '').trim()
  );
};

export const getOrderActivityDate = (order: Pick<Order, 'createdAt' | 'orderDate' | 'history'>): string =>
  resolveActivityDate(order.createdAt, order.orderDate, order.history?.created);

export const getBillActivityDate = (bill: Pick<Bill, 'createdAt' | 'billDate' | 'history'>): string =>
  resolveActivityDate(bill.createdAt, bill.billDate, bill.history?.created);

/**
 * Map order status to the corresponding history field name that stores the timestamp
 */
export const getOrderStatusHistoryField = (status: OrderStatus): string | null => {
  const statusToHistoryField: Record<OrderStatus, string> = {
    [OrderStatus.CREATED]: 'created',
    [OrderStatus.ON_HOLD]: 'created',
    [OrderStatus.PROCESSING]: 'processing',
    [OrderStatus.COURIER_ASSIGNED]: 'courier',
    [OrderStatus.PICKED]: 'picked',
    [OrderStatus.COMPLETED]: 'completed',
    [OrderStatus.EXCHANGE_PROCESSING]: 'exchangeProcessing',
    [OrderStatus.EXCHANGE_PICKED]: 'exchangePicked',
    [OrderStatus.EXCHANGE_DELIVERED]: 'exchangeDelivered',
    [OrderStatus.EXCHANGE_RETURNED]: 'exchangeReturned',
    [OrderStatus.EXCHANGE_CANCELLED]: 'exchangeCancelled',
    [OrderStatus.RETURNED]: 'returned',
    [OrderStatus.CANCELLED]: 'cancelled',
  };
  return statusToHistoryField[status] ?? null;
};

/**
 * Map bill status to the corresponding history field name that stores the timestamp
 */
export const getBillStatusHistoryField = (status: BillStatus): string | null => {
  const statusToHistoryField: Record<BillStatus, string> = {
    [BillStatus.ON_HOLD]: 'created',
    [BillStatus.PROCESSING]: 'processing',
    [BillStatus.RECEIVED]: 'received',
    [BillStatus.PAID]: 'paid',
    [BillStatus.RETURNED]: 'returned',
    [BillStatus.CANCELLED]: 'cancelled',
  };
  return statusToHistoryField[status] ?? null;
};

/**
 * Extract ISO timestamp from a history field value.
 * History values can be either ISO timestamps or human-readable strings like "Marked delivered on 26 Jul 2025, at 04:30 PM"
 */
export const extractTimestampFromHistory = (historyValue: string | undefined | null): string => {
  if (!historyValue) return '';

  // If it's already an ISO timestamp, return it
  const parsed = parseHistoryTimestamp(historyValue);
  if (parsed) return parsed.toISOString();

  return '';
};

export const getTransactionActivityDate = (
  transaction: Pick<Transaction, 'createdAt' | 'date' | 'history'>
): string => {
  const timeAwareDate = transaction.date && String(transaction.date).trim().length > 10
    ? normalizeUtcTimestamp(transaction.date)
    : '';

  return (
    normalizeUtcTimestamp(transaction.createdAt) ||
    timeAwareDate ||
    parseCreatedHistoryTimestamp(transaction.history?.created) ||
    String(transaction.date || '').trim()
  );
};

const shiftCalendarYmd = (value: string, days: number): string => {
  const calendar = parseCalendarYmd(value);
  if (!calendar) return value;
  const shifted = new Date(Date.UTC(calendar.year, calendar.month - 1, calendar.day + days));
  return formatCalendarYmd({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  });
};

const buildDateRange = (
  filterRange: FilterRange,
  customDates: { from: string; to: string }
): { from?: Date; to?: Date } => {
  const now = new Date();
  const today = formatYmd(now);
  const todayCalendar = parseCalendarYmd(today)!;
  const todayStart = parseYmd(today, false)!;
  const todayEnd = parseYmd(today, true)!;

  if (filterRange === 'All Time') return {};

  if (filterRange === 'Today') {
    return { from: todayStart, to: todayEnd };
  }

  if (filterRange === 'Last 7 days') {
    return { from: parseYmd(shiftCalendarYmd(today, -6), false)!, to: todayEnd };
  }

  if (filterRange === 'Last 30 days') {
    return { from: parseYmd(shiftCalendarYmd(today, -29), false)!, to: todayEnd };
  }

  if (filterRange === 'This Week') {
    const weekday = new Date(Date.UTC(todayCalendar.year, todayCalendar.month - 1, todayCalendar.day)).getUTCDay();
    return { from: parseYmd(shiftCalendarYmd(today, -weekday), false)!, to: todayEnd };
  }

  if (filterRange === 'This Month') {
    const monthStart = formatCalendarYmd({ ...todayCalendar, day: 1 });
    return { from: parseYmd(monthStart, false)!, to: todayEnd };
  }

  if (filterRange === 'This Year') {
    const yearStart = formatCalendarYmd({ year: todayCalendar.year, month: 1, day: 1 });
    return { from: parseYmd(yearStart, false)!, to: todayEnd };
  }

  const from = parseCustomDateBoundary(customDates.from, 'start') || undefined;
  const to = parseCustomDateBoundary(customDates.to, 'end') || undefined;

  if (from && to && from.getTime() > to.getTime()) {
    return { from: to, to: from };
  }

  return { from, to };
};

export const getDateTimeFilters = (
  filterRange: FilterRange,
  customDates: { from: string; to: string }
): { from?: string; to?: string } => {
  const { from, to } = buildDateRange(filterRange, customDates);
  return {
    ...(from && { from: from.toISOString() }),
    ...(to && { to: to.toISOString() }),
  };
};

export const getDateOnlyFilters = (
  filterRange: FilterRange,
  customDates: { from: string; to: string }
): { from?: string; to?: string } => {
  const { from, to } = buildDateRange(filterRange, customDates);
  return {
    ...(from && { from: formatYmd(from) }),
    ...(to && { to: formatYmd(to) }),
  };
};

/**
 * Check if a date string falls within the given filter range
 */
export const isWithinDateRange = (
  dateStr: string,
  filterRange: FilterRange,
  customDates: { from: string; to: string }
): boolean => {
  const date = parseDateInput(dateStr);
  if (!date) return false;
  const { from, to } = buildDateRange(filterRange, customDates);
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
};

export type DateDisplayValue = string | Date | null | undefined;

const parseDisplayDate = (value: DateDisplayValue): { date: Date; hasTime: boolean; fallback: string } | null => {
  if (value instanceof Date) {
    return isValidDate(value) ? { date: value, hasTime: true, fallback: '' } : null;
  }

  const raw = String(value || '').trim();
  if (!raw) return null;
  const hasTime = raw.length > 10;
  if (!hasTime && DATE_ONLY_PATTERN.test(raw)) {
    const calendar = parseCalendarYmd(raw);
    if (!calendar) return null;
    return {
      date: new Date(Date.UTC(calendar.year, calendar.month - 1, calendar.day)),
      hasTime: false,
      fallback: raw,
    };
  }
  const normalized = hasTime ? normalizeUtcTimestamp(raw) || raw : raw;
  const date = parseDateInput(normalized);
  return date ? { date, hasTime, fallback: raw } : null;
};

/**
 * Canonical user-facing date format: 26 Jul 2025.
 * Date-only inputs are interpreted as calendar dates; timestamps are shown in Asia/Dhaka.
 */
export const formatDate = (value: DateDisplayValue): string => {
  const parsed = parseDisplayDate(value);
  if (!parsed) return value instanceof Date ? '' : String(value || '').trim();

  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: parsed.hasTime ? APP_TIME_ZONE : 'UTC',
  }).format(parsed.date);
};

export const formatDateTimeParts = (
  value?: DateDisplayValue
): { date: string; time: string } => {
  const parsed = parseDisplayDate(value);
  if (!parsed) return { date: value instanceof Date ? '' : String(value || '').trim(), time: '' };

  return {
    date: formatDate(value),
    time: parsed.hasTime ? parsed.date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: APP_TIME_ZONE,
    }) : '',
  };
};

/** Canonical user-facing timestamp format: 26 Jul 2025, 04:30 PM. */
export const formatDateTime = (value?: DateDisplayValue): string => {
  const { date, time } = formatDateTimeParts(value);
  return date && time ? `${date}, ${time}` : date;
};

/** Current HH:mm value in Bangladesh, suitable for time inputs. */
export const getCurrentTime = (now: Date = new Date()): string => {
  const parts = getTimeZoneParts(now);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
};

/** Human-readable history moment, always rendered as Bangladesh time. */
export const formatHistoryMoment = (value: DateDisplayValue = new Date()): string => {
  const { date, time } = formatDateTimeParts(value);
  return date && time ? `${date}, at ${time}` : date;
};

/** Status suffix using Bangladesh calendar boundaries for Today/Yesterday. */
export const formatActivityStatusTimestamp = (value: DateDisplayValue, now: Date = new Date()): string => {
  const parsed = value instanceof Date ? value : parseHistoryTimestamp(String(value || ''));
  if (!parsed || !isValidDate(parsed)) return '';
  const valueYmd = formatYmd(parsed);
  const todayYmd = formatYmd(now);
  const { time } = formatDateTimeParts(parsed);
  if (valueYmd === todayYmd) return time;
  if (valueYmd === shiftCalendarYmd(todayYmd, -1)) return `Yesterday, ${time}`;
  return `${formatDate(parsed)}, ${time}`;
};

/**
 * Normalize the readable timestamp inside activity text. An authoritative ISO
 * value (for example, a server-side order status event) wins over legacy text.
 */
export const formatHistoryTextForTimeline = (
  value?: string | null,
  authoritativeTimestamp?: string | null,
): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const authoritative = parseHistoryTimestamp(authoritativeTimestamp);

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parsed = authoritative || parseHistoryTimestamp(line);
      if (!parsed) return line;
      const { date, time } = formatDateTimeParts(parsed);
      if (!date || !time) return line;

      const humanMatch = line.match(HUMAN_HISTORY_TIMESTAMP_PATTERN);
      if (humanMatch && typeof humanMatch.index === 'number') {
        const matchedText = humanMatch[0];
        const hasOnPrefix = /^on\s+/i.test(matchedText);
        const replacement = `${hasOnPrefix ? 'on ' : ''}${date}, at ${time}`;
        return `${line.slice(0, humanMatch.index)}${replacement}${line.slice(humanMatch.index + matchedText.length)}`;
      }
      if (ISO_TIMESTAMP_PATTERN.test(line)) {
        return line.replace(ISO_TIMESTAMP_PATTERN, `${date}, at ${time}`);
      }
      return line;
    })
    .join('\n');
};

export const openAttachmentPreview = (attachmentUrl?: string | null): boolean => {
  const raw = String(attachmentUrl || '').trim();
  if (!raw || typeof window === 'undefined') return false;

  let previewUrl = raw;
  let shouldRevoke = false;

  try {
    if (raw.startsWith('data:')) {
      const [metadata, encodedPayload = ''] = raw.split(',', 2);
      const mimeType = metadata.match(/^data:([^;]+)/i)?.[1] || 'application/octet-stream';
      const isBase64 = /;base64/i.test(metadata);
      const decodedPayload = isBase64 ? atob(encodedPayload) : decodeURIComponent(encodedPayload);
      const bytes = new Uint8Array(decodedPayload.length);

      for (let index = 0; index < decodedPayload.length; index += 1) {
        bytes[index] = decodedPayload.charCodeAt(index);
      }

      previewUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
      shouldRevoke = true;
    }

    const openedWindow = window.open(previewUrl, '_blank', 'noopener,noreferrer');

    if (!openedWindow) {
      const fallbackLink = document.createElement('a');
      fallbackLink.href = previewUrl;
      fallbackLink.target = '_blank';
      fallbackLink.rel = 'noopener noreferrer';
      document.body.appendChild(fallbackLink);
      fallbackLink.click();
      fallbackLink.remove();
    }

    if (shouldRevoke) {
      window.setTimeout(() => URL.revokeObjectURL(previewUrl), 60_000);
    }

    return true;
  } catch (_error) {
    if (shouldRevoke) {
      URL.revokeObjectURL(previewUrl);
    }
    return false;
  }
};

export const getPreferredCourierFromHistory = (
  historyText?: string | null
): 'paperfly' | 'carrybee' | 'steadfast' | 'pathao' | null => {
  const normalized = String(historyText || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('paperfly')) return 'paperfly';
  if (normalized.includes('carrybee')) return 'carrybee';
  if (normalized.includes('pathao')) return 'pathao';
  if (normalized.includes('steadfast')) return 'steadfast';
  return null;
};

export const getCourierAutoFinalizedOutcome = (
  order?: Pick<Order, 'status' | 'history'> | null
): 'Delivered' | 'Returned' | null => {
  if (!order) return null;

  const outcome = order.status === 'Completed'
    ? 'Delivered'
    : order.status === 'Returned'
      ? 'Returned'
      : null;
  if (!outcome) return null;

  const historyText = String(
    outcome === 'Delivered' ? order.history?.completed : order.history?.returned
  ).trim().toLowerCase();
  const marker = outcome === 'Delivered'
    ? 'marked delivered automatically from'
    : 'marked returned automatically from';
  const hasKnownCourier = ['carrybee', 'paperfly', 'steadfast', 'pathao']
    .some((courier) => historyText.includes(courier));

  return historyText.includes(marker) && hasKnownCourier ? outcome : null;
};

export const extractSteadfastTrackingFromHistory = (historyText?: string | null): string => {
  const text = String(historyText || '').trim();
  if (!text || !text.toLowerCase().includes('steadfast')) return '';

  const patterns = [
    /tracking(?:\s*code)?\s*[:#-]?\s*([a-z0-9-]+)/i,
    /consignment(?:\s*id)?\s*[:#-]?\s*([a-z0-9-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return String(match[1]).trim();
  }

  return '';
};

export const getPaperflyReferenceNumber = (
  order: Pick<Order, 'orderNumber' | 'paperflyTrackingNumber'>
): string => {
  const orderReference = String(order.orderNumber || '').trim();
  if (orderReference) return orderReference;
  return String(order.paperflyTrackingNumber || '').trim();
};

/**
 * Get today's date in YYYY-MM-DD format
 */
export const getTodayDate = (now: Date = new Date()): string => {
  return formatYmd(now);
};

/**
 * Generate a random ID
 */
export const generateId = (): string => {
  return Math.random().toString(36).substr(2, 9);
};

/**
 * Clone and update an object while maintaining type safety
 */
export const cloneAndUpdate = <T extends Record<string, any>>(
  obj: T,
  updates: Partial<T>
): T => {
  return { ...obj, ...updates };
};

/**
 * Normalize a phone input string by stripping out any characters that are
 * not English or Bengali digits and capping the result to 11 characters
 * (the max length used throughout the app).
 */
export const sanitizePhoneInput = (value: string): string => {
  // Allow standard 0‑9 digits and Bengali digits (U+09E6–U+09EF).
  const digits = value.match(/[0-9\u09E6-\u09EF]/g);
  // join and truncate to 11 characters
  return (digits ? digits.join('') : '').slice(0, 11);
};

export const normalizePhoneSearchValue = (value: string): string => (
  sanitizePhoneInput(value).replace(/[\u09E6-\u09EF]/g, (digit) => String(digit.charCodeAt(0) - 0x09E6))
);

export const matchesNamePhoneSearch = (
  candidate: { name?: string | null; phone?: string | null },
  rawQuery: string
): boolean => {
  const query = String(rawQuery || '').trim().toLowerCase();
  if (!query) return true;

  const normalizedQueryPhone = normalizePhoneSearchValue(rawQuery);
  const candidateName = String(candidate.name || '').toLowerCase();
  const candidatePhone = String(candidate.phone || '').toLowerCase();
  const normalizedCandidatePhone = normalizePhoneSearchValue(String(candidate.phone || ''));

  return (
    candidateName.includes(query) ||
    candidatePhone.includes(query) ||
    (!!normalizedQueryPhone && normalizedCandidatePhone.includes(normalizedQueryPhone))
  );
};

/**
 * Compress an image file using the Canvas API.
 * Returns a base64 data URL of the compressed image (WebP for photos, PNG for transparency).
 * Preserves quality while reducing file size significantly.
 */
export const compressImage = (
  file: File,
  options: {
    maxWidth?: number;
    maxHeight?: number;
    quality?: number;
    force?: boolean;
  } = {},
): Promise<string> => {
  const {
    maxWidth = 1920,
    maxHeight = 1920,
    quality = 0.82,
    force = false,
  } = options;

  return new Promise((resolve, reject) => {
    // Skip compression for non-images and small files (< 200KB)
    if (!file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
      return;
    }

    if (!force && file.size < 200 * 1024) {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
      return;
    }

    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let { width, height } = img;

      // Scale down if exceeding max dimensions (preserve aspect ratio)
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        // Fallback: return original
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      // Use WebP for photos (better compression), PNG for images with transparency
      const outputType = file.type === 'image/png' ? 'image/png' : 'image/webp';
      const compressed = canvas.toDataURL(outputType, quality);

      // If compression didn't help, return original
      if (compressed.length > file.size * 1.3) {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
        return;
      }

      resolve(compressed);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      // Fallback: return original file as data URL
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    };

    img.src = objectUrl;
  });
};

/**
 * Resolve an upload path to a full, browser-accessible URL.
 * Handles paths like /uploads/product-images/xxx.webp and ensures they work
 * in both local dev (Vite) and production (cPanel) environments.
 */
export const resolveUploadUrl = (path?: string | null): string => {
  const raw = String(path || '').trim();
  if (!raw) return '';

  // Already a full URL or data URL — return as-is
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) {
    return raw;
  }

  // Normalize: ensure it starts with /
  const normalized = raw.startsWith('/') ? raw : `/${raw}`;

  // Encode spaces and special characters in the filename portion
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash >= 0) {
    const dir = normalized.substring(0, lastSlash);
    const file = normalized.substring(lastSlash + 1);
    return `${dir}/${encodeURIComponent(file).replace(/%20/g, ' ')}`;
  }

  return normalized;
};

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Calculate the financial result of returning existing items and optionally
 * adding exchange replacements. Existing discount is reduced only in
 * proportion to the existing merchandise returned; replacement merchandise
 * does not inherit or amplify the old discount.
 */
export const calculateReturnAdjustment = ({
  subtotal,
  discount,
  shipping,
  paidAmount,
  returnValue,
  replacementValue = 0,
  discountEligibleSubtotal,
  discountEligibleReturnValue,
}: {
  subtotal: number;
  discount: number;
  shipping: number;
  paidAmount: number;
  returnValue: number;
  replacementValue?: number;
  discountEligibleSubtotal?: number;
  discountEligibleReturnValue?: number;
}) => {
  const safeSubtotal = Math.max(0, Number(subtotal) || 0);
  const safeReturnValue = Math.min(safeSubtotal, Math.max(0, Number(returnValue) || 0));
  const safeReplacementValue = Math.max(0, Number(replacementValue) || 0);
  const safeDiscountEligibleSubtotal = Math.min(
    safeSubtotal,
    Math.max(0, Number(discountEligibleSubtotal ?? safeSubtotal) || 0),
  );
  const safeDiscountEligibleReturnValue = Math.min(
    safeDiscountEligibleSubtotal,
    Math.max(0, Number(discountEligibleReturnValue ?? safeReturnValue) || 0),
  );
  const remainingExistingSubtotal = Math.max(0, safeSubtotal - safeReturnValue);
  const remainingDiscountEligibleSubtotal = Math.max(0, safeDiscountEligibleSubtotal - safeDiscountEligibleReturnValue);
  const remainingRatio = safeDiscountEligibleSubtotal > 0
    ? remainingDiscountEligibleSubtotal / safeDiscountEligibleSubtotal
    : 0;
  const newDiscount = roundMoney(Math.min(Math.max(0, Number(discount) || 0), Math.max(0, Number(discount) || 0) * remainingRatio));
  const newSubtotal = roundMoney(remainingExistingSubtotal + safeReplacementValue);
  const newTotal = roundMoney(Math.max(0, newSubtotal - newDiscount + Math.max(0, Number(shipping) || 0)));
  const safePaidAmount = Math.max(0, Number(paidAmount) || 0);

  return {
    remainingExistingSubtotal: roundMoney(remainingExistingSubtotal),
    newSubtotal,
    newDiscount,
    newTotal,
    discountReduction: roundMoney(Math.max(0, (Number(discount) || 0) - newDiscount)),
    maxRefund: roundMoney(Math.max(0, safePaidAmount - newTotal)),
    maxCollection: roundMoney(Math.max(0, newTotal - safePaidAmount)),
  };
};
