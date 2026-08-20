-- POS module: point-of-sale quick sales.
--
-- 1. customers.is_walkin marks the anonymous walk-in customer used by POS
--    quick-sale orders so it never shows in normal customer lists.
-- 2. orders.vat_rate / orders.vat_amount capture VAT separately from subtotal
--    so totals survive rate changes and POS receipts can show the tax line.
-- 3. pos_drafts stores unfinished POS carts per user.
-- 4. orders_with_customer_creator exposes the new order columns.
ALTER TABLE `customers`
  ADD COLUMN IF NOT EXISTS `is_walkin` TINYINT(1) NOT NULL DEFAULT 0 AFTER `address`;

-- Shared walk-in customer used by POS quick-sale orders.
INSERT INTO customers (id, name, phone, address, is_walkin, created_at, updated_at)
VALUES ('walkin-customer', 'Walk-in Customer', '0', '', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  is_walkin = 1;

ALTER TABLE `orders`
  ADD COLUMN IF NOT EXISTS `vat_rate` DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER `discount`,
  ADD COLUMN IF NOT EXISTS `vat_amount` DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER `vat_rate`;

CREATE TABLE IF NOT EXISTS `pos_drafts` (
  `id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) NOT NULL,
  `items` JSON NOT NULL,
  `note` TEXT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pos_drafts_user` (`user_id`),
  CONSTRAINT `fk_pos_drafts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Expose VAT through the order list view.
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