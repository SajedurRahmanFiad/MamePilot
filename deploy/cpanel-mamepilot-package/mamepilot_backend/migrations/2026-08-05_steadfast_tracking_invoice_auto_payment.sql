-- Preserve Steadfast's returned identifiers/URL and optionally settle orders
-- when a courier confirms delivery.
ALTER TABLE `courier_settings`
  ADD COLUMN IF NOT EXISTS `steadfast_invoice` VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS `automatically_mark_paid_after_delivery` TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE `orders`
  ADD COLUMN IF NOT EXISTS `steadfast_tracking_link` VARCHAR(1000) NULL,
  ADD COLUMN IF NOT EXISTS `steadfast_invoice` VARCHAR(100) NULL;
ALTER TABLE `orders`
  ADD UNIQUE KEY IF NOT EXISTS `uq_orders_steadfast_invoice` (`steadfast_invoice`);

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
  o.source_ad AS sourceAd
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id
LEFT JOIN users u ON u.id = o.created_by
WHERE o.deleted_at IS NULL;
