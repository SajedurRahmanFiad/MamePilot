import assert from 'node:assert/strict';

import {
  APP_TIME_ZONE,
  buildLocalDateTime,
  formatActivityStatusTimestamp,
  formatDateTime,
  formatHistoryTextForTimeline,
  getCurrentTime,
  getDateTimeFilters,
  getTodayDate,
  parseHistoryTimestamp,
} from '../utils.ts';

assert.equal(APP_TIME_ZONE, 'Asia/Dhaka');

assert.equal(
  parseHistoryTimestamp('Marked as processing on 28 Jul 2026, at 11:30 PM')?.toISOString(),
  '2026-07-28T17:30:00.000Z',
  'legacy readable history must be interpreted as Bangladesh wall time',
);
assert.equal(
  parseHistoryTimestamp('Marked as processing on July 28, 2026, at 11:30 PM')?.toISOString(),
  '2026-07-28T17:30:00.000Z',
  'month-first legacy history must remain compatible',
);
assert.equal(
  parseHistoryTimestamp('System update on 2026-07-28 17:30:00')?.toISOString(),
  '2026-07-28T17:30:00.000Z',
  'timezone-less database timestamps are UTC by contract',
);

assert.equal(formatDateTime('2026-07-28T18:30:00Z'), '29 Jul 2026, 12:30 AM');
assert.equal(
  formatHistoryTextForTimeline('Marked as processing on 28 Jul 2026, at 11:30 PM'),
  'Marked as processing on 28 Jul 2026, at 11:30 PM',
  'a Bangladesh history string must not be shifted a second time',
);
assert.equal(
  formatHistoryTextForTimeline(
    'Marked as processing on 29 Jul 2026, at 03:00 AM',
    '2026-07-28T15:00:00Z',
  ),
  'Marked as processing on 28 Jul 2026, at 09:00 PM',
  'server-authored status event timestamps must win over readable client text',
);

assert.equal(getTodayDate(new Date('2026-07-28T17:59:59Z')), '2026-07-28');
assert.equal(getTodayDate(new Date('2026-07-28T18:00:00Z')), '2026-07-29');
assert.equal(getCurrentTime(new Date('2026-07-28T18:30:00Z')), '00:30');
assert.equal(
  buildLocalDateTime('2026-07-28', '23:30')?.toISOString(),
  '2026-07-28T17:30:00.000Z',
  'Bangladesh date/time inputs must be converted to UTC independently of browser timezone',
);

const customRange = getDateTimeFilters('Custom', {
  from: '2026-07-28T00:00',
  to: '2026-07-28T23:59',
});
assert.deepEqual(customRange, {
  from: '2026-07-27T18:00:00.000Z',
  to: '2026-07-28T17:59:59.999Z',
});

const nearMidnightNow = new Date('2026-07-28T18:30:00Z'); // 29 Jul, 12:30 AM in Dhaka
assert.equal(
  formatActivityStatusTimestamp(new Date('2026-07-28T18:00:00Z'), nearMidnightNow),
  '12:00 AM',
);
assert.equal(
  formatActivityStatusTimestamp(new Date('2026-07-28T17:30:00Z'), nearMidnightNow),
  'Yesterday, 11:30 PM',
);

console.log('Bangladesh timezone runtime assertions passed.');
