CREATE TABLE IF NOT EXISTS app_capability_settings (
  id VARCHAR(64) NOT NULL,
  capabilities LONGTEXT NULL,
  license_key VARCHAR(255) NULL,
  license_api_url VARCHAR(500) NULL,
  license_owner_token VARCHAR(500) NULL,
  tier_key VARCHAR(64) NULL,
  plan_name VARCHAR(255) NULL,
  license_status VARCHAR(64) NOT NULL DEFAULT 'local',
  renewal_date DATETIME NULL,
  override_enabled TINYINT(1) NOT NULL DEFAULT 0,
  available_tiers LONGTEXT NULL,
  pricing_metadata LONGTEXT NULL,
  last_synced_at DATETIME NULL,
  last_sync_status VARCHAR(64) NULL,
  last_sync_message TEXT NULL,
  sync_grace_until DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `app_capability_settings`
  ADD COLUMN `license_owner_token` VARCHAR(500) NULL,
  ADD COLUMN `tier_key` VARCHAR(64) NULL,
  ADD COLUMN `override_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `available_tiers` LONGTEXT NULL,
  ADD COLUMN `pricing_metadata` LONGTEXT NULL;

CREATE TABLE IF NOT EXISTS payment_gateway_settings (
  id VARCHAR(64) NOT NULL,
  piprapay_base_url VARCHAR(500) NULL,
  piprapay_api_key VARCHAR(500) NULL,
  piprapay_merchant_id VARCHAR(255) NULL,
  piprapay_ipn_secret VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `service_subscription_settings`
  ADD COLUMN `plan_name` VARCHAR(255) NULL,
  ADD COLUMN `billing_interval` VARCHAR(32) NULL,
  ADD COLUMN `subscription_status` VARCHAR(64) NOT NULL DEFAULT 'unconfigured',
  ADD COLUMN `current_period_end` DATETIME NULL;

ALTER TABLE `service_subscription_payments`
  ADD COLUMN `local_reference` VARCHAR(255) NULL,
  ADD COLUMN `gateway_payment_id` VARCHAR(255) NULL,
  ADD COLUMN `gateway_name` VARCHAR(64) NULL,
  ADD COLUMN `billing_interval` VARCHAR(32) NULL,
  ADD COLUMN `invoice_url` VARCHAR(500) NULL,
  ADD COLUMN `raw_payload` LONGTEXT NULL;

CREATE TABLE IF NOT EXISTS payment_webhook_logs (
  id VARCHAR(64) NOT NULL,
  gateway VARCHAR(64) NOT NULL,
  event_id VARCHAR(255) NULL,
  local_reference VARCHAR(255) NULL,
  status VARCHAR(64) NULL,
  verified TINYINT(1) NOT NULL DEFAULT 0,
  raw_payload LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_webhook_logs_gateway_event (gateway, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
