-- Ensure all columns referenced by the view exist, then recreate the view.
-- sp_add_col is idempotent (skips if column already exists).
-- This merges changes from: 2026-08-15 (timestamps), 2026-08-16
-- (payment_received_at/refund_issued_at), 2026-08-20 (pos), and
-- 2026-08-21 (action-required flags) into a single safe migration.

-- 1. Ensure sp_add_col procedure exists (idempotent).
DROP PROCEDURE IF EXISTS sp_add_col;
DELIMITER $$
CREATE PROCEDURE sp_add_col(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$
DELIMITER ;

-- 2. Ensure all order columns that the view references exist.
CALL sp_add_col('orders', 'vat_rate', 'DECIMAL(5,2) NOT NULL DEFAULT 0');
CALL sp_add_col('orders', 'vat_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0');
CALL sp_add_col('orders', 'is_pos', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('orders', 'processed_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'courier_assigned_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'picked_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'completed_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'returned_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'cancelled_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'partial_delivered_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'exchange_processing_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'exchange_picked_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'exchange_delivered_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'exchange_returned_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'exchange_cancelled_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'partial_delivery_action_required', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('orders', 'courier_return_action_required', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('orders', 'payment_received_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'refund_issued_at', 'DATETIME NULL');

-- 3. Recreate the view with the full column set.
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
  o.partial_delivery_action_required AS partialDeliveryActionRequired,
  o.courier_return_action_required AS courierReturnActionRequired,
  o.payment_received_at AS paymentReceivedAt,
  o.refund_issued_at AS refundIssuedAt
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id
LEFT JOIN users u ON u.id = o.created_by
WHERE o.deleted_at IS NULL;
