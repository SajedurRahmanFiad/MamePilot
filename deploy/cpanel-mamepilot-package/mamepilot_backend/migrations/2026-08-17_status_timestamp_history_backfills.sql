-- Status-timestamp history backfills for Orders and Bills.
--
-- The 2026-08-15 / 2026-08-16 column migrations only backfilled the new *_at
-- columns from the order_status_undo_events journal. Orders and bills created
-- before that journal, or whose events were deleted, kept NULL timestamps, so
-- every status-action filter on the Orders/Bills pages and the dashboard status
-- KPI cards returned zero. This migration reconstructs every timestamp.
--
-- Stage 1 (event journal): fills columns from the recorded status undo events
-- (earliest event wins). Stage 2 (history text): fills whatever the journal
-- missed from the legacy human-readable history JSON (four time dialects,
-- Asia/Dhaka wall-clock minus 6h -> UTC).
--
-- Each statement is @keep-data-backfill because it is a routine derived-data
-- rebuild that deployments need via schema-only.sql: it only fills NULL columns
-- and never overwrites, so re-running is always safe. The updateOrder write
-- path keeps columns current after this migration has populated them.
-- Reference copy for manual use: docs/status_timestamp_backfills.sql.

-- @keep-data-backfill stage 1. event-journal backfill (orders only)
UPDATE orders o
SET
  o.processed_at = IFNULL(o.processed_at, (
    SELECT MIN(e.created_at) FROM order_status_undo_events e
    WHERE e.order_id = o.id AND e.to_status = 'Processing' AND e.undone_at IS NULL
  )),
  o.courier_assigned_at = IFNULL(o.courier_assigned_at, (
    SELECT MIN(e.created_at) FROM order_status_undo_events e
    WHERE e.order_id = o.id AND e.to_status = 'Courier assigned' AND e.undone_at IS NULL
  )),
  o.picked_at = IFNULL(o.picked_at, (
    SELECT MIN(e.created_at) FROM order_status_undo_events e
    WHERE e.order_id = o.id AND e.to_status = 'Picked' AND e.undone_at IS NULL
  )),
  o.completed_at = IFNULL(o.completed_at, (
    SELECT MIN(e.created_at) FROM order_status_undo_events e
    WHERE e.order_id = o.id AND e.to_status = 'Completed' AND e.undone_at IS NULL
  )),
  o.returned_at = IFNULL(o.returned_at, (
    SELECT MIN(e.created_at) FROM order_status_undo_events e
    WHERE e.order_id = o.id AND e.to_status = 'Returned' AND e.undone_at IS NULL
  )),
  o.cancelled_at = IFNULL(o.cancelled_at, (
    SELECT MIN(e.created_at) FROM order_status_undo_events e
    WHERE e.order_id = o.id AND e.to_status = 'Cancelled' AND e.undone_at IS NULL
  )),
  o.partial_delivered_at = IFNULL(o.partial_delivered_at, (
    SELECT MIN(e.created_at) FROM order_status_undo_events e
    WHERE e.order_id = o.id AND e.to_status = 'partially_delivered' AND e.undone_at IS NULL
  )),
  o.exchange_processing_at = IFNULL(o.exchange_processing_at, (
    SELECT MIN(e.created_at) FROM order_status_undo_events e
    WHERE e.order_id = o.id AND e.to_status = 'Exchange processing' AND e.undone_at IS NULL
  )),
  o.exchange_picked_at = IFNULL(o.exchange_picked_at, (
    SELECT MIN(e.created_at) FROM order_status_undo_events e
    WHERE e.order_id = o.id AND e.to_status = 'Exchange picked' AND e.undone_at IS NULL
  )),
  o.exchange_delivered_at = IFNULL(o.exchange_delivered_at, (
    SELECT MIN(e.created_at) FROM order_status_undo_events e
    WHERE e.order_id = o.id AND e.to_status = 'Exchange delivered' AND e.undone_at IS NULL
  )),
  o.exchange_returned_at = IFNULL(o.exchange_returned_at, (
    SELECT MIN(e.created_at) FROM order_status_undo_events e
    WHERE e.order_id = o.id AND e.to_status = 'Exchange returned' AND e.undone_at IS NULL
  )),
  o.exchange_cancelled_at = IFNULL(o.exchange_cancelled_at, (
    SELECT MIN(e.created_at) FROM order_status_undo_events e
    WHERE e.order_id = o.id AND e.to_status = 'Exchange cancelled' AND e.undone_at IS NULL
  ))
WHERE o.id IN (
  SELECT DISTINCT order_id FROM order_status_undo_events
  WHERE undone_at IS NULL
    AND to_status IN ('Processing', 'Courier assigned', 'Picked', 'Completed', 'Returned', 'Cancelled', 'partially_delivered', 'Exchange processing', 'Exchange picked', 'Exchange delivered', 'Exchange returned', 'Exchange cancelled')
);

-- @keep-data-backfill Stage 2. history-text backfills (orders and bills)
-- Timestamp dialects found in history text:
--   1) Human DD MMM  "on 12 Aug 2026, at 05:25 PM"  -> Asia/Dhaka wall-clock -> UTC (minus 6h)
--   2) Human MMM DD  "on Aug 12, 2026, at 05:25 PM" -> Asia/Dhaka wall-clock -> UTC (minus 6h)
--   3) Webhook       "on 2026-08-12 19:31:50"       -> Asia/Dhaka webhook    -> UTC (minus 6h)
--   4) ISO           "on 2026-08-12T19:31:50+00:00" -> Asia/Dhaka webhook    -> UTC (minus 6h)
-- Earliest entry = first regex match (history lines append chronologically).

-- @keep-data-backfill 1. processed_at <- history.processing
UPDATE orders
SET processed_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')) IS NOT NULL AND processed_at IS NULL;

-- @keep-data-backfill 2. courier_assigned_at <- history.courier
UPDATE orders
SET courier_assigned_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.courier')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.courier')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.courier')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.courier')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.courier')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.courier')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.courier')) IS NOT NULL AND courier_assigned_at IS NULL;

-- @keep-data-backfill 3. picked_at <- history.picked
UPDATE orders
SET picked_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.picked')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.picked')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.picked')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.picked')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.picked')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.picked')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.picked')) IS NOT NULL AND picked_at IS NULL;

-- @keep-data-backfill 4. completed_at <- history.completed
UPDATE orders
SET completed_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.completed')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.completed')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.completed')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.completed')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.completed')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.completed')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.completed')) IS NOT NULL AND completed_at IS NULL;

-- @keep-data-backfill 5. returned_at <- history.returned
UPDATE orders
SET returned_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')) IS NOT NULL AND returned_at IS NULL;

-- @keep-data-backfill 6. cancelled_at <- history.cancelled
UPDATE orders
SET cancelled_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')) IS NOT NULL AND cancelled_at IS NULL;

-- @keep-data-backfill 7. partial_delivered_at <- history.partiallyDelivered
UPDATE orders
SET partial_delivered_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.partiallyDelivered')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.partiallyDelivered')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.partiallyDelivered')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.partiallyDelivered')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.partiallyDelivered')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.partiallyDelivered')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.partiallyDelivered')) IS NOT NULL AND partial_delivered_at IS NULL;

-- @keep-data-backfill 8. exchange_processing_at <- history.exchangeProcessing
UPDATE orders
SET exchange_processing_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')) IS NOT NULL AND exchange_processing_at IS NULL;

-- @keep-data-backfill 9. exchange_picked_at <- history.exchangePicked
UPDATE orders
SET exchange_picked_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')) IS NOT NULL AND exchange_picked_at IS NULL;

-- @keep-data-backfill 10. exchange_delivered_at <- history.exchangeDelivered
UPDATE orders
SET exchange_delivered_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')) IS NOT NULL AND exchange_delivered_at IS NULL;

-- @keep-data-backfill 11. exchange_returned_at <- history.exchangeReturned
UPDATE orders
SET exchange_returned_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')) IS NOT NULL AND exchange_returned_at IS NULL;

-- @keep-data-backfill 12. exchange_cancelled_at <- history.exchangeCancelled
UPDATE orders
SET exchange_cancelled_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')) IS NOT NULL AND exchange_cancelled_at IS NULL;

-- @keep-data-backfill 13. orders.payment_received_at <- history.payment ("Payment of ..." line)
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

-- @keep-data-backfill 14. orders.refund_issued_at <- history.payment ("Refund of ..." line)
UPDATE orders
SET refund_issued_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')
    ), '%e %b %Y %H:%i'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')
    ), '%b %e %Y %H:%i'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')) IS NOT NULL AND LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment'))) > 0 AND refund_issued_at IS NULL;

-- @keep-data-backfill 15. bills.processed_at <- history.processing
UPDATE bills
SET processed_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.processing')) IS NOT NULL AND processed_at IS NULL;

-- @keep-data-backfill 16. bills.received_at <- history.received
UPDATE bills
SET received_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.received')) IS NOT NULL AND received_at IS NULL;

-- @keep-data-backfill 17. bills.paid_at <- history.paid
UPDATE bills
SET paid_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')) IS NOT NULL AND paid_at IS NULL;

-- @keep-data-backfill 18. bills.returned_at <- history.returned
UPDATE bills
SET returned_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.returned')) IS NOT NULL AND returned_at IS NULL;

-- @keep-data-backfill 19. bills.cancelled_at <- history.cancelled
UPDATE bills
SET cancelled_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', ''))
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.cancelled')) IS NOT NULL AND cancelled_at IS NULL;

-- @keep-data-backfill 20. bills.payment_received_at <- history.paid
UPDATE bills
SET payment_received_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')
    ), '%e %b %Y %H:%i'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')
    ), '%b %e %Y %H:%i'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.paid')) IS NOT NULL AND payment_received_at IS NULL;

-- @keep-data-backfill 21. bills.refund_issued_at <- history.refund
UPDATE bills
SET refund_issued_at = COALESCE(
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')
    ), '%e %b %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')
    ), '%b %e %Y %h:%i %p'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ',
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')
    ), '%e %b %Y %H:%i'), '06:00:00'),
    SUBTIME(STR_TO_DATE(CONCAT(
        NULLIF(REPLACE(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ',
        NULLIF(REGEXP_SUBSTR(JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')
    ), '%b %e %Y %H:%i'), '06:00:00')
)
WHERE JSON_VALID(history) = 1 AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.refund')) IS NOT NULL AND refund_issued_at IS NULL;