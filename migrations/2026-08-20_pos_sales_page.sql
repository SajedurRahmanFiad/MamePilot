-- POS Sales page: keep point-of-sale orders out of the Orders page and give
-- the walk-in customer its standardized phone number.
--
-- 1. orders.is_pos flags orders created by createPosOrder so the Orders and
--    POS Sales pages can scope their listings with a single indexed flag.
-- 2. The shared walk-in customer's phone is normalized from the original
--    single-character '0' seed to '00000000000' (a reserved non-contact
--    number), keeping the seed value in this deployment idempotent.

UPDATE customers
SET phone = '00000000000'
WHERE id = 'walkin-customer'
  AND is_walkin = 1
  AND phone = '0';

ALTER TABLE `orders`
  ADD COLUMN IF NOT EXISTS `is_pos` TINYINT(1) NOT NULL DEFAULT 0 AFTER `vat_amount`;

ALTER TABLE `orders`
  ADD KEY IF NOT EXISTS `idx_orders_is_pos` (`is_pos`);

-- Backfill: point-of-sale orders created before this migration are exactly
-- those placed against the walk-in customer and/or carrying a POS VAT
-- capture (regular orders never set the VAT columns).
UPDATE orders SET is_pos = 1
WHERE (customer_id = 'walkin-customer' OR vat_rate <> 0 OR vat_amount <> 0)
  AND is_pos = 0;

-- Expose the flag through the order list view.
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
  o.vat_rate AS vatRate,
  o.vat_amount AS vatAmount,
  o.is_pos AS isPos,
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