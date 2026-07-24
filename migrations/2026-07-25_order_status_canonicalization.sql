-- Created is the progress label for the initial On Hold state, not a separate
-- persisted order status. Preserve the distinct exchange workflow statuses
-- used by older orders whose terminal state was previously collapsed.
UPDATE orders
SET status = 'On Hold'
WHERE status = 'Created';

UPDATE orders
SET status = 'Exchange processing'
WHERE status = 'Processing'
  AND JSON_VALID(COALESCE(history, '')) = 1
  AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeProcessing')), '')) <> '';

UPDATE orders
SET status = 'Exchange picked'
WHERE status = 'Picked'
  AND JSON_VALID(COALESCE(history, '')) = 1
  AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangePicked')), '')) <> '';

UPDATE orders
SET status = 'Exchange delivered'
WHERE status = 'Completed'
  AND JSON_VALID(COALESCE(history, '')) = 1
  AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeDelivered')), '')) <> '';

UPDATE orders
SET status = 'Exchange returned'
WHERE status = 'Returned'
  AND JSON_VALID(COALESCE(history, '')) = 1
  AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeReturned')), '')) <> '';

UPDATE orders
SET status = 'Exchange cancelled'
WHERE status = 'Cancelled'
  AND JSON_VALID(COALESCE(history, '')) = 1
  AND TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(history, '$.exchangeCancelled')), '')) <> '';
