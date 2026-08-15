-- Dedicated datetime columns for bill status-change filtering.
-- Mirrors the Orders approach (2026-08-15_order_status_timestamp_columns) so the
-- Bills page can filter by each status's own timestamp instead of re-parsing
-- history text on every request. All timestamps are stored in UTC (Asia/Dhaka
-- wall-clock is a presentation concern).
--
-- Bills have no structured status journal, so the backfill parses the existing
-- human-readable history text (written in Bangladesh local time via the app's
-- formatHistoryMoment / server-side Dhaka labels, e.g. "... on 26 Aug 2026, at
-- 04:30 PM"). Both day-first ("26 Aug 2026") and month-first ("Jul 6, 2026")
-- English formats are recognised, as well as a trailing period. The LAST line of
-- each history key is authoritative and local time is converted to UTC with
-- CONVERT_TZ (Bangladesh is fixed UTC+6, no DST, so numeric offsets are exact).
-- Rows without a parseable event remain NULL and are simply not matched by
-- status-timestamp filters.
ALTER TABLE `bills`
  ADD COLUMN IF NOT EXISTS `processed_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `received_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `paid_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `returned_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `cancelled_at` DATETIME NULL;
ALTER TABLE `bills`
  ADD INDEX IF NOT EXISTS `idx_bills_processed_at` (`processed_at`),
  ADD INDEX IF NOT EXISTS `idx_bills_received_at` (`received_at`),
  ADD INDEX IF NOT EXISTS `idx_bills_paid_at` (`paid_at`),
  ADD INDEX IF NOT EXISTS `idx_bills_returned_at` (`returned_at`),
  ADD INDEX IF NOT EXISTS `idx_bills_cancelled_at` (`cancelled_at`);
ALTER TABLE `bills`
  ADD COLUMN IF NOT EXISTS `payment_received_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `refund_issued_at` DATETIME NULL;
ALTER TABLE `bills`
  ADD INDEX IF NOT EXISTS `idx_bills_payment_received_at` (`payment_received_at`),
  ADD INDEX IF NOT EXISTS `idx_bills_refund_issued_at` (`refund_issued_at`);

-- Backfill payment and refund timestamps from bills.history. Bills keep 'paid'
-- and 'refund' as separate keys holding only their own event lines, so each
-- source text is parsed directly (same dialects as the status backfill).
UPDATE bills
SET payment_received_at = COALESCE(SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ', NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')), '%e %b %Y %h:%i %p'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ', NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')), '%b %e %Y %h:%i %p'), '06:00:00'), SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'), SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ', NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')), '%e %b %Y %H:%i'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ', NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')), '%b %e %Y %H:%i'), '06:00:00'))
WHERE JSON_VALID(history) = 1
  AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')) IS NOT NULL
  AND payment_received_at IS NULL;

-- Refund issued: bills.history.refund (key holds only refund lines).
UPDATE bills
SET refund_issued_at = COALESCE(SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ', NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')), '%e %b %Y %h:%i %p'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ', NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')), '%b %e %Y %h:%i %p'), '06:00:00'), SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'), SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ', NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')), '%e %b %Y %H:%i'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ', NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')), '%b %e %Y %H:%i'), '06:00:00'))
WHERE JSON_VALID(history) = 1
  AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')) IS NOT NULL
  AND refund_issued_at IS NULL;

-- Backfill each timestamp from the recorded time the bill entered the status.
-- Normalise either date format into "YYYY-Mon-DD HH:MM:SS AM/PM" then parse.
UPDATE bills
SET
  processed_at = IFNULL(processed_at, CONVERT_TZ(
    STR_TO_DATE(
      REGEXP_REPLACE(REGEXP_REPLACE(
        SUBSTRING(
          SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '\n', -1),
          LOCATE(' on ', SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '\n', -1)) + 4
        ),
        '([0-9]{1,2}) ([A-Za-z]{3}) ([0-9]{4})[\\, ]*at ([0-9]{1,2}):([0-9]{2}) (AM|PM)[\\.\\s]*',
        '\\3-\\2-\\1 \\4:\\5:00 \\6'
      ),
      '([A-Za-z]{3}) ([0-9]{1,2}), ([0-9]{4})[\\, ]*at ([0-9]{1,2}):([0-9]{2}) (AM|PM)[\\.\\s]*',
      '\\3-\\1-\\2 \\4:\\5:00 \\6'),
      '%Y-%b-%d %h:%i:%s %p'
    ),
    '+06:00', '+00:00'
  )),
  received_at = IFNULL(received_at, CONVERT_TZ(
    STR_TO_DATE(
      REGEXP_REPLACE(REGEXP_REPLACE(
        SUBSTRING(
          SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')), '\n', -1),
          LOCATE(' on ', SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')), '\n', -1)) + 4
        ),
        '([0-9]{1,2}) ([A-Za-z]{3}) ([0-9]{4})[\\, ]*at ([0-9]{1,2}):([0-9]{2}) (AM|PM)[\\.\\s]*',
        '\\3-\\2-\\1 \\4:\\5:00 \\6'
      ),
      '([A-Za-z]{3}) ([0-9]{1,2}), ([0-9]{4})[\\, ]*at ([0-9]{1,2}):([0-9]{2}) (AM|PM)[\\.\\s]*',
      '\\3-\\1-\\2 \\4:\\5:00 \\6'),
      '%Y-%b-%d %h:%i:%s %p'
    ),
    '+06:00', '+00:00'
  )),
  paid_at = IFNULL(paid_at, CONVERT_TZ(
    STR_TO_DATE(
      REGEXP_REPLACE(REGEXP_REPLACE(
        SUBSTRING(
          SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '\n', -1),
          LOCATE(' on ', SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '\n', -1)) + 4
        ),
        '([0-9]{1,2}) ([A-Za-z]{3}) ([0-9]{4})[\\, ]*at ([0-9]{1,2}):([0-9]{2}) (AM|PM)[\\.\\s]*',
        '\\3-\\2-\\1 \\4:\\5:00 \\6'
      ),
      '([A-Za-z]{3}) ([0-9]{1,2}), ([0-9]{4})[\\, ]*at ([0-9]{1,2}):([0-9]{2}) (AM|PM)[\\.\\s]*',
      '\\3-\\1-\\2 \\4:\\5:00 \\6'),
      '%Y-%b-%d %h:%i:%s %p'
    ),
    '+06:00', '+00:00'
  )),
  returned_at = IFNULL(returned_at, CONVERT_TZ(
    STR_TO_DATE(
      REGEXP_REPLACE(REGEXP_REPLACE(
        SUBSTRING(
          SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '\n', -1),
          LOCATE(' on ', SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '\n', -1)) + 4
        ),
        '([0-9]{1,2}) ([A-Za-z]{3}) ([0-9]{4})[\\, ]*at ([0-9]{1,2}):([0-9]{2}) (AM|PM)[\\.\\s]*',
        '\\3-\\2-\\1 \\4:\\5:00 \\6'
      ),
      '([A-Za-z]{3}) ([0-9]{1,2}), ([0-9]{4})[\\, ]*at ([0-9]{1,2}):([0-9]{2}) (AM|PM)[\\.\\s]*',
      '\\3-\\1-\\2 \\4:\\5:00 \\6'),
      '%Y-%b-%d %h:%i:%s %p'
    ),
    '+06:00', '+00:00'
  )),
  cancelled_at = IFNULL(cancelled_at, CONVERT_TZ(
    STR_TO_DATE(
      REGEXP_REPLACE(REGEXP_REPLACE(
        SUBSTRING(
          SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '\n', -1),
          LOCATE(' on ', SUBSTRING_INDEX(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '\n', -1)) + 4
        ),
        '([0-9]{1,2}) ([A-Za-z]{3}) ([0-9]{4})[\\, ]*at ([0-9]{1,2}):([0-9]{2}) (AM|PM)[\\.\\s]*',
        '\\3-\\2-\\1 \\4:\\5:00 \\6'
      ),
      '([A-Za-z]{3}) ([0-9]{1,2}), ([0-9]{4})[\\, ]*at ([0-9]{1,2}):([0-9]{2}) (AM|PM)[\\.\\s]*',
      '\\3-\\1-\\2 \\4:\\5:00 \\6'),
      '%Y-%b-%d %h:%i:%s %p'
    ),
    '+06:00', '+00:00'
  ))
WHERE JSON_VALID(history);

-- Expose the new columns through the bill list view (used by fetchBillsPage).
DROP VIEW IF EXISTS `bills_with_vendor_creator`;
CREATE VIEW `bills_with_vendor_creator` AS
SELECT
  b.id,
  b.bill_number AS billNumber,
  b.bill_date AS billDate,
  b.vendor_id AS vendorId,
  v.name AS vendorName,
  v.phone AS vendorPhone,
  v.address AS vendorAddress,
  b.created_by AS createdBy,
  u.name AS creatorName,
  b.status,
  b.items,
  b.subtotal,
  b.discount,
  b.shipping,
  b.total,
  b.paid_amount AS paidAmount,
  b.notes,
  b.history,
  b.created_at AS createdAt,
  b.processed_at AS processedAt,
  b.received_at AS receivedAt,
  b.paid_at AS paidAt,
  b.returned_at AS returnedAt,
  b.cancelled_at AS cancelledAt,
  b.payment_received_at AS paymentReceivedAt,
  b.refund_issued_at AS refundIssuedAt,
  b.deleted_at AS deletedAt,
  b.deleted_by AS deletedBy
FROM bills b
LEFT JOIN vendors v ON v.id = b.vendor_id
LEFT JOIN users u ON u.id = b.created_by
WHERE b.deleted_at IS NULL;
