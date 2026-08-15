-- Status-timestamp backfills for Orders and Bills (reference copy).
--
-- These backfill the dedicated *_at status timestamp columns from the legacy
-- human-readable history JSON. They are safe to re-run: each statement only
-- fills NULL columns and never overwrites. Both files follow the identical
-- pattern (four timestamp dialects, Asia/Dhaka wall-clock -> UTC).
--
-- Ordering note: the applied migration copies live in migrations/
--   - 2026-08-15_order_status_timestamp_columns.sql
--   - 2026-08-16_bill_status_timestamp_columns.sql
-- This file keeps the raw UPDATE statements for manual use on environments
-- where the migration has already run but the backfill needs to be repeated.
--
============================================================================
== ORDERS (2026-08-15_order_status_timestamp_columns.sql, second stage)  ==
============================================================================

-- Backfill remaining orders.*_at status timestamps from orders.history text.
-- Second stage of 2026-08-15_order_status_timestamp_columns.sql: fills the
-- columns still NULL because the order predates the order_status_undo_events
-- journal. Timestamp dialects found in history text:
--   1) Human DD MMM  "on 12 Aug 2026, at 05:25 PM"  -> Asia/Dhaka wall-clock -> UTC (minus 6h)
--   2) Human MMM DD  "on Aug 12, 2026, at 05:25 PM" -> Asia/Dhaka wall-clock -> UTC (minus 6h)
--   3) Webhook       "on 2026-08-12 19:31:50"       -> Asia/Dhaka webhook    -> UTC (minus 6h)
--   4) ISO           "on 2026-08-12T19:31:50+00:00" -> Asia/Dhaka webhook    -> UTC (minus 6h)
-- Earliest entry = first regex match (history lines append chronologically).
-- Safe to re-run: only fills NULL columns, never overwrites.

-- 1. processed_at <- history.processing
UPDATE orders
SET processed_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')) IS NOT NULL AND processed_at IS NULL;

-- 2. courier_assigned_at <- history.courier
UPDATE orders
SET courier_assigned_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.courier')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.courier')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.courier')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.courier')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.courier')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.courier')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.courier')) IS NOT NULL AND courier_assigned_at IS NULL;

-- 3. picked_at <- history.picked
UPDATE orders
SET picked_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.picked')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.picked')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.picked')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.picked')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.picked')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.picked')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.picked')) IS NOT NULL AND picked_at IS NULL;

-- 4. completed_at <- history.completed
UPDATE orders
SET completed_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.completed')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.completed')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.completed')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.completed')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.completed')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.completed')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.completed')) IS NOT NULL AND completed_at IS NULL;

-- 5. returned_at <- history.returned
UPDATE orders
SET returned_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')) IS NOT NULL AND returned_at IS NULL;

-- 6. cancelled_at <- history.cancelled
UPDATE orders
SET cancelled_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')) IS NOT NULL AND cancelled_at IS NULL;

-- 7. partial_delivered_at <- history.partiallyDelivered
UPDATE orders
SET partial_delivered_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.partiallyDelivered')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.partiallyDelivered')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.partiallyDelivered')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.partiallyDelivered')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.partiallyDelivered')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.partiallyDelivered')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.partiallyDelivered')) IS NOT NULL AND partial_delivered_at IS NULL;

-- 8. exchange_processing_at <- history.exchangeProcessing
UPDATE orders
SET exchange_processing_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')) IS NOT NULL AND exchange_processing_at IS NULL;

-- 9. exchange_picked_at <- history.exchangePicked
UPDATE orders
SET exchange_picked_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')) IS NOT NULL AND exchange_picked_at IS NULL;

-- 10. exchange_delivered_at <- history.exchangeDelivered
UPDATE orders
SET exchange_delivered_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')) IS NOT NULL AND exchange_delivered_at IS NULL;

-- 11. exchange_returned_at <- history.exchangeReturned
UPDATE orders
SET exchange_returned_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')) IS NOT NULL AND exchange_returned_at IS NULL;

-- 12. exchange_cancelled_at <- history.exchangeCancelled
UPDATE orders
SET exchange_cancelled_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')) IS NOT NULL AND exchange_cancelled_at IS NULL;

=====================================================================
== BILLS (2026-08-16_bill_status_timestamp_columns.sql, backfill) ==
=====================================================================

-- Backfill the bills.*_at status timestamps from bills.history text.
-- Bills have no structured status journal, so all columns are filled from the
-- human-readable history (same dialects as orders, all Asia/Dhaka local time):
--   1) Human DD MMM  "on 23 Jul 2026, at 02:17 PM"  -> Asia/Dhaka wall-clock -> UTC (minus 6h)
--   2) Human MMM DD  "on Jul 9, 2026, at 12:17 AM" -> Asia/Dhaka wall-clock -> UTC (minus 6h)
--   3) Webhook       "on 2026-07-23 02:17:00"      -> Asia/Dhaka webhook    -> UTC (minus 6h)
--   4) ISO           "on 2026-07-23T02:17:00+00:00"-> Asia/Dhaka webhook    -> UTC (minus 6h)
-- Safe to re-run: only fills NULL columns, never overwrites.

-- 1. processed_at <- history.processing
UPDATE bills
SET processed_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')) IS NOT NULL AND processed_at IS NULL;

-- 2. received_at <- history.received
UPDATE bills
SET received_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')) IS NOT NULL AND received_at IS NULL;

-- 3. paid_at <- history.paid
UPDATE bills
SET paid_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')) IS NOT NULL AND paid_at IS NULL;

-- 4. returned_at <- history.returned
UPDATE bills
SET returned_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')) IS NOT NULL AND returned_at IS NULL;

-- 5. cancelled_at <- history.cancelled
UPDATE bills
SET cancelled_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{1,2}:[0-9]{2} ?[AP]\\.?M\\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')) IS NOT NULL AND cancelled_at IS NULL;
========================================================================
== PAYMENT / REFUND (orders payment_received_at + refund_issued_at)   ==
== PAYMENT / REFUND (bills payment_received_at + refund_issued_at)    ==
========================================================================

-- Payment-received and refund-issued timestamps for Orders. Both read the
-- same orders.history.payment key, which mixes payment and refund lines, so
-- each UPDATE anchors on its own line prefix; the FIRST matching line wins
-- (history lines append chronologically). The dialect list adds the legacy
-- 24h "26 Jun 2026 at 01:24" line to the four standard dialects.

-- 1. orders.payment_received_at <- history.payment ("Payment of ..." line)
UPDATE orders
SET payment_received_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')
    ), '%e %b %Y %H:%i'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')
    ), '%b %e %Y %H:%i'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')) IS NOT NULL AND payment_received_at IS NULL;

-- 2. orders.refund_issued_at <- history.payment ("Refund of ..." line)
UPDATE orders
SET refund_issued_at = COALESCE(SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ', NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')), '%e %b %Y %h:%i %p'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ', NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')), '%b %e %Y %h:%i %p'), '06:00:00'), SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'), SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ', NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')), '%e %b %Y %H:%i'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ', NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')), '%b %e %Y %H:%i'), '06:00:00'))
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')) IS NOT NULL AND LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment'))) > 0 AND refund_issued_at IS NULL;

====================================================================
== BILLS payment_received_at + refund_issued_at (2026-08-16)      ==
====================================================================

-- Bills keep 'paid' and 'refund' as separate history keys holding only their
-- own event lines, so each source text is parsed directly.

-- 1. bills.payment_received_at <- history.paid
UPDATE bills
SET payment_received_at = COALESCE(SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ', NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')), '%e %b %Y %h:%i %p'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ', NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')), '%b %e %Y %h:%i %p'), '06:00:00'), SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'), SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ', NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')), '%e %b %Y %H:%i'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ', NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')), '%b %e %Y %H:%i'), '06:00:00'))
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')) IS NOT NULL AND payment_received_at IS NULL;

-- 2. bills.refund_issued_at <- history.refund
UPDATE bills
SET refund_issued_at = COALESCE(SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ', NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')), '%e %b %Y %h:%i %p'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ', NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')), '%b %e %Y %h:%i %p'), '06:00:00'), SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'), SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ', NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')), '%e %b %Y %H:%i'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ', NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')), '%b %e %Y %H:%i'), '06:00:00'))
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')) IS NOT NULL AND refund_issued_at IS NULL;
