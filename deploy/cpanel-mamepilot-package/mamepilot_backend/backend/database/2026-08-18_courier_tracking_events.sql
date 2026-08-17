-- ============================================================
-- Courier tracking events: store Steadfast tracking_update
-- webhook messages (tracking_message + updated_at) for display
-- in the order detail "Courier tracking" timeline.
-- Run this migration on existing databases before deploying.
-- ============================================================

CREATE TABLE IF NOT EXISTS courier_tracking_events (
  id VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  event_key CHAR(64) NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  consignment_id VARCHAR(255) NULL,
  merchant_reference VARCHAR(255) NULL,
  tracking_message TEXT NULL,
  event_at DATETIME NULL,
  received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_courier_tracking_provider_event (provider, event_key),
  KEY idx_courier_tracking_order_at (order_id, event_at),
  CONSTRAINT fk_courier_tracking_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;