-- Sofa Cover delivery, collage, and repair lifecycle schema.
-- This migration ensures the database includes the columns and indexes needed by
-- the Sofa Cover business mode before order creation and processing can proceed.

CREATE TABLE IF NOT EXISTS `delivery_persons` (
  `id` VARCHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `phone` VARCHAR(64) NOT NULL,
  `image` LONGTEXT NULL,
  `email` VARCHAR(255) NULL,
  `address` TEXT NULL,
  `birthday` DATE NULL,
  `nid_passport_copy` LONGTEXT NULL,
  `gender` VARCHAR(32) NULL,
  `blood_group` VARCHAR(16) NULL,
  `nationality` VARCHAR(128) NULL,
  `cv` LONGTEXT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  `deleted_by` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_delivery_persons_phone` (`phone`),
  KEY `idx_delivery_persons_name` (`name`),
  KEY `idx_delivery_persons_deleted_at` (`deleted_at`),
  CONSTRAINT `fk_delivery_persons_deleted_by` FOREIGN KEY (`deleted_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `orders`
  ADD COLUMN IF NOT EXISTS `collage_urls` LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS `delivery_person_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `delivery_person_name` VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS `delivery_person_shipping_cost` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS `delivery_person_shipping_expense_recorded` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `delivery_person_shipping_expense_transaction_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `repair_processing_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `repair_picked_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `repair_delivered_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `repair_cancelled_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `repair_returned_at` DATETIME NULL;

CREATE INDEX IF NOT EXISTS `idx_orders_delivery_person_id` ON `orders` (`delivery_person_id`);
CREATE INDEX IF NOT EXISTS `idx_orders_repair_processing_at` ON `orders` (`repair_processing_at`);
CREATE INDEX IF NOT EXISTS `idx_orders_repair_picked_at` ON `orders` (`repair_picked_at`);
CREATE INDEX IF NOT EXISTS `idx_orders_repair_delivered_at` ON `orders` (`repair_delivered_at`);
CREATE INDEX IF NOT EXISTS `idx_orders_repair_cancelled_at` ON `orders` (`repair_cancelled_at`);
CREATE INDEX IF NOT EXISTS `idx_orders_repair_returned_at` ON `orders` (`repair_returned_at`);
