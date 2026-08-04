-- Replace browser polling with signed courier webhooks and keep the provider
-- charge payload separate from the accounting transaction it may create.
ALTER TABLE `courier_settings`
  ADD COLUMN IF NOT EXISTS `automatically_deduct_shipping_costs` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `carrybee_webhook_signature` VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS `paperfly_webhook_secret` VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS `pathao_webhook_header` VARCHAR(128) NULL,
  ADD COLUMN IF NOT EXISTS `pathao_webhook_secret` VARCHAR(500) NULL;

CREATE TABLE IF NOT EXISTS `courier_webhook_events` (
  `id` VARCHAR(64) NOT NULL,
  `provider` VARCHAR(32) NOT NULL,
  `event_key` CHAR(64) NOT NULL,
  `event_name` VARCHAR(128) NOT NULL,
  `order_id` VARCHAR(64) NULL,
  `merchant_reference` VARCHAR(255) NULL,
  `consignment_id` VARCHAR(255) NULL,
  `event_at` DATETIME NULL,
  `payload` LONGTEXT NOT NULL,
  `processing_status` VARCHAR(32) NOT NULL DEFAULT 'received',
  `processing_message` TEXT NULL,
  `received_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `processed_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_courier_webhook_provider_event` (`provider`, `event_key`),
  KEY `idx_courier_webhook_order_received` (`order_id`, `received_at`),
  KEY `idx_courier_webhook_provider_received` (`provider`, `received_at`),
  CONSTRAINT `fk_courier_webhook_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `courier_order_charges` (
  `id` VARCHAR(64) NOT NULL,
  `provider` VARCHAR(32) NOT NULL,
  `charge_key` CHAR(64) NOT NULL,
  `order_id` VARCHAR(64) NULL,
  `consignment_id` VARCHAR(255) NULL,
  `merchant_reference` VARCHAR(255) NULL,
  `cod_fee` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `delivery_fee` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_charge` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `currency` VARCHAR(8) NOT NULL DEFAULT 'BDT',
  `source_event_id` VARCHAR(64) NULL,
  `provider_updated_at` DATETIME NULL,
  `expense_transaction_id` VARCHAR(64) NULL,
  `expense_status` VARCHAR(32) NOT NULL DEFAULT 'not_recorded',
  `expense_error` TEXT NULL,
  `expense_recorded_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_courier_charge_provider_key` (`provider`, `charge_key`),
  KEY `idx_courier_charge_order` (`order_id`, `provider`),
  KEY `idx_courier_charge_consignment` (`provider`, `consignment_id`),
  KEY `idx_courier_charge_reference` (`provider`, `merchant_reference`),
  CONSTRAINT `fk_courier_charge_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_courier_charge_event` FOREIGN KEY (`source_event_id`) REFERENCES `courier_webhook_events` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_courier_charge_transaction` FOREIGN KEY (`expense_transaction_id`) REFERENCES `transactions` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
