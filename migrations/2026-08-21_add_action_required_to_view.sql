-- Add partialDeliveryActionRequired and courierReturnActionRequired to the
-- orders_with_customer_creator view so fetchOrdersPage can SELECT them.
-- The columns already exist on the orders table (added 2026-08-20).

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
  o.partial_delivery_action_required AS partialDeliveryActionRequired,
  o.courier_return_action_required AS courierReturnActionRequired
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id
LEFT JOIN users u ON u.id = o.created_by
WHERE o.deleted_at IS NULL;
