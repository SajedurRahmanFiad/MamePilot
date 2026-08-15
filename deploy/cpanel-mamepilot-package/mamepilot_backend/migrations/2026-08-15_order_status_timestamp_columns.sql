-- Dedicated datetime columns for order status-change filtering.
-- Replaces fragile history-text timestamp parsing on the Orders page by
-- giving each lifecycle status a first-class DATETIME column. All timestamps
-- are stored in UTC (Asia/Dhaka display is a presentation concern).
ALTER TABLE `orders`
  ADD COLUMN IF NOT EXISTS `processed_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `courier_assigned_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `picked_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `completed_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `returned_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `cancelled_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `partial_delivered_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `exchange_processing_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `exchange_picked_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `exchange_delivered_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `exchange_returned_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `exchange_cancelled_at` DATETIME NULL;
ALTER TABLE `orders`
  ADD INDEX IF NOT EXISTS `idx_orders_processed_at` (`processed_at`),
  ADD INDEX IF NOT EXISTS `idx_orders_courier_assigned_at` (`courier_assigned_at`),
  ADD INDEX IF NOT EXISTS `idx_orders_picked_at` (`picked_at`),
  ADD INDEX IF NOT EXISTS `idx_orders_completed_at` (`completed_at`),
  ADD INDEX IF NOT EXISTS `idx_orders_returned_at` (`returned_at`),
  ADD INDEX IF NOT EXISTS `idx_orders_cancelled_at` (`cancelled_at`),
  ADD INDEX IF NOT EXISTS `idx_orders_partial_delivered_at` (`partial_delivered_at`),
  ADD INDEX IF NOT EXISTS `idx_orders_exchange_processing_at` (`exchange_processing_at`),
  ADD INDEX IF NOT EXISTS `idx_orders_exchange_picked_at` (`exchange_picked_at`),
  ADD INDEX IF NOT EXISTS `idx_orders_exchange_delivered_at` (`exchange_delivered_at`),
  ADD INDEX IF NOT EXISTS `idx_orders_exchange_returned_at` (`exchange_returned_at`),
  ADD INDEX IF NOT EXISTS `idx_orders_exchange_cancelled_at` (`exchange_cancelled_at`);
ALTER TABLE `orders`
  ADD COLUMN IF NOT EXISTS `payment_received_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `refund_issued_at` DATETIME NULL;
ALTER TABLE `orders`
  ADD INDEX IF NOT EXISTS `idx_orders_payment_received_at` (`payment_received_at`),
  ADD INDEX IF NOT EXISTS `idx_orders_refund_issued_at` (`refund_issued_at`);

-- Backfill payment and refund timestamps from orders.history.payment.
-- The key mixes payment and refund lines; each column anchors on its own
-- line prefix (first matching line wins, lines append chronologically).
-- Timestamp dialects: 12h DD MMM / 12h MMM DD / webhook / ISO / 24h DD MMM.
UPDATE orders
SET payment_received_at = COALESCE(SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ', NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')), '%e %b %Y %h:%i %p'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ', NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')), '%b %e %Y %h:%i %p'), '06:00:00'), SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'), SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ', NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')), '%e %b %Y %H:%i'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ', NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Payment of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')), '%b %e %Y %H:%i'), '06:00:00'))
WHERE JSON_VALID(history) = 1
  AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')) IS NOT NULL
  AND payment_received_at IS NULL;

-- Refund issued: first 'Refund of' line in orders.history.payment.
UPDATE orders
SET refund_issued_at = COALESCE(SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ', NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')), '%e %b %Y %h:%i %p'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ', NULLIF(UPPER(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2} ?[AP]\.?M\.?'), '.', '')), '')), '%b %e %Y %h:%i %p'), '06:00:00'), SUBTIME(STR_TO_DATE(NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(:[0-9]{2})?'), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'), SUBTIME(STR_TO_DATE(NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2})?'), 'T', ' '), ''), '%Y-%m-%d %H:%i:%s'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2} [A-Za-z]{3,9} [0-9]{4}'), ''), ' ', NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')), '%e %b %Y %H:%i'), '06:00:00'), SUBTIME(STR_TO_DATE(CONCAT(NULLIF(REPLACE(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[A-Za-z]{3,9} [0-9]{1,2},? [0-9]{4}'), ',', ''), ''), ' ', NULLIF(REGEXP_SUBSTR(SUBSTRING_INDEX(SUBSTRING(JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')), LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')))), '\n', 1), '[0-9]{1,2}:[0-9]{2}(:[0-9]{2})?'), '')), '%b %e %Y %H:%i'), '06:00:00'))
WHERE JSON_VALID(history) = 1
  AND JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment')) IS NOT NULL AND LOCATE('Refund of', JSON_UNQUOTE(JSON_EXTRACT(history, '$.payment'))) > 0
  AND refund_issued_at IS NULL;

-- Backfill each timestamp from the earliest (deterministic) recorded time the
-- order first entered the corresponding status. Rows without any matching
-- event remain NULL so legacy history-text fallbacks keep working.
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

-- Expose the new columns through the order list view.
DROP VIEW IF EXISTS `orders_with_customer_creator`;
CREATE VIEW `orders_with_customer_creator` AS
SELECT
  o.id,
  o.order_number AS orderNumber,
  o.order_date AS orderDate,
  o.customer_id AS customerId,
  c.name AS customerName,
  c.phone AS customerPhone,
  c.address AS customerAddress,
  o.page_id AS pageId,
  o.created_by AS createdBy,
  u.name AS creatorName,
  o.status,
  o.items,
  o.subtotal,
  o.discount,
  o.shipping,
  o.total,
  o.paid_amount AS paidAmount,
  o.notes,
  o.history,
  o.page_snapshot AS pageSnapshot,
  o.created_at AS createdAt,
  o.deleted_at AS deletedAt,
  o.deleted_by AS deletedBy,
  o.carrybee_consignment_id AS carrybeeConsignmentId,
  o.steadfast_consignment_id AS steadfastConsignmentId,
  o.steadfast_invoice AS steadfastInvoice,
  o.steadfast_tracking_link AS steadfastTrackingLink,
  o.paperfly_tracking_number AS paperflyTrackingNumber,
  o.pathao_consignment_id AS pathaoConsignmentId,
  o.exchange_courier AS exchangeCourier,
  o.exchange_steadfast_consignment_id AS exchangeSteadfastConsignmentId,
  o.exchange_carrybee_consignment_id AS exchangeCarrybeeConsignmentId,
  o.exchange_paperfly_tracking_number AS exchangePaperflyTrackingNumber,
  o.exchange_pathao_consignment_id AS exchangePathaoConsignmentId,
  o.exchange_courier_history AS exchangeCourierHistory,
  o.source_ad AS sourceAd,
  o.processed_at AS processedAt,
  o.courier_assigned_at AS courierAssignedAt,
  o.picked_at AS pickedAt,
  o.completed_at AS completedAt,
  o.returned_at AS returnedAt,
  o.cancelled_at AS cancelledAt,
  o.partial_delivered_at AS partialDeliveredAt,
  o.exchange_processing_at AS exchangeProcessingAt,
  o.exchange_picked_at AS exchangePickedAt,
  o.exchange_delivered_at AS exchangeDeliveredAt,
  o.exchange_returned_at AS exchangeReturnedAt,
  o.exchange_cancelled_at AS exchangeCancelledAt,
  o.payment_received_at AS paymentReceivedAt,
  o.refund_issued_at AS refundIssuedAt
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id
LEFT JOIN users u ON u.id = o.created_by
WHERE o.deleted_at IS NULL;