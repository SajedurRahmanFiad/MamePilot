SET NAMES utf8mb4;
SET time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS license_tiers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tier_key VARCHAR(64) NOT NULL UNIQUE,
  tier_name VARCHAR(255) NOT NULL,
  monthly_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  yearly_price DECIMAL(10,2) NOT NULL DEFAULT 0,
  capabilities LONGTEXT NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS licenses (
  license_key VARCHAR(255) NOT NULL PRIMARY KEY,
  client_name VARCHAR(255) NOT NULL,
  domain VARCHAR(255) NULL,
  tier_key VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL DEFAULT 'active',
  renewal_date DATETIME NULL,
  capability_overrides LONGTEXT NULL,
  override_enabled TINYINT(1) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS maintenance_settings (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  target_deployments LONGTEXT NULL,
  deployment_scope VARCHAR(32) NOT NULL DEFAULT 'all',
  image_url VARCHAR(1000) NULL,
  caption VARCHAR(500) NULL,
  subtitle TEXT NULL,
  explanation TEXT NULL,
  ends_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO maintenance_settings (id, enabled) VALUES ('maintenance', 0)
  ON DUPLICATE KEY UPDATE id = VALUES(id);

ALTER TABLE maintenance_settings
  ADD COLUMN IF NOT EXISTS target_deployments LONGTEXT NULL AFTER enabled,
  ADD COLUMN IF NOT EXISTS deployment_scope VARCHAR(32) NOT NULL DEFAULT 'all' AFTER target_deployments,
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(1000) NULL AFTER deployment_scope,
  ADD COLUMN IF NOT EXISTS caption VARCHAR(500) NULL AFTER image_url,
  ADD COLUMN IF NOT EXISTS subtitle TEXT NULL AFTER caption,
  ADD COLUMN IF NOT EXISTS explanation TEXT NULL AFTER subtitle,
  ADD COLUMN IF NOT EXISTS ends_at DATETIME NULL AFTER explanation;

INSERT INTO license_tiers (tier_key, tier_name, monthly_price, yearly_price, capabilities, sort_order) VALUES
('copilot', 'Co-Pilot', 299, 3200, '["dashboard","inventory","sales"]', 1),
('pilot', 'Pilot', 599, 6800, '["dashboard","inventory","sales","purchases","banking","fraud_checker","courier_automation","recycle_bin_undoer"]', 2),
('captain', 'Captain', 999, 11500, '["dashboard","inventory","sales","recycle_bin_undoer","purchases","banking","human_resources","advanced_reports","fraud_checker","whitelabel","custom_roles","courier_automation"]', 3),
('autopilot', 'Autopilot', 1799, 20800, '["dashboard","inventory","sales","recycle_bin_undoer","purchases","banking","human_resources","advanced_reports","fraud_checker","whitelabel","custom_roles","courier_automation","marketing","enterprise_ai_agent"]', 4)
ON DUPLICATE KEY UPDATE tier_name = VALUES(tier_name), monthly_price = VALUES(monthly_price), yearly_price = VALUES(yearly_price), capabilities = VALUES(capabilities), sort_order = VALUES(sort_order);

CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  subject VARCHAR(255) NOT NULL,
  content_html LONGTEXT NOT NULL,
  target_roles LONGTEXT NOT NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  action_config LONGTEXT NULL,
  metadata LONGTEXT NULL,
  created_by VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_system_generated TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE notifications
  ENGINE = InnoDB,
  DEFAULT CHARSET = utf8mb4,
  COLLATE = utf8mb4_unicode_ci,
  MODIFY COLUMN id VARCHAR(64) NOT NULL;

CREATE TABLE IF NOT EXISTS notification_receipts (
  notification_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  read_at DATETIME NULL,
  action_result VARCHAR(32) NULL,
  acted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id, user_id),
  KEY idx_notification_receipts_user_read (user_id, is_read, read_at),
  KEY idx_notification_receipts_action_result (action_result),
  CONSTRAINT fk_notification_receipts_notification FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE notification_receipts
  ENGINE = InnoDB,
  DEFAULT CHARSET = utf8mb4,
  COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  license_key VARCHAR(255) NOT NULL,
  webhook_url VARCHAR(1024) NOT NULL,
  webhook_secret VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_delivery_at DATETIME NULL,
  last_delivery_status INT NULL,
  failure_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_webhook_subscriptions_license (license_key),
  KEY idx_webhook_subscriptions_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration: add deployment targeting to notifications
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS target_deployments LONGTEXT NULL AFTER target_roles,
  ADD COLUMN IF NOT EXISTS deployment_scope VARCHAR(32) NULL DEFAULT 'all' AFTER target_deployments;

-- Migration: add deployment tracking to notification_receipts
ALTER TABLE notification_receipts
  ADD COLUMN IF NOT EXISTS license_key VARCHAR(255) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS user_name VARCHAR(255) NULL AFTER license_key,
  ADD COLUMN IF NOT EXISTS user_role VARCHAR(64) NULL AFTER user_name,
  ADD KEY IF NOT EXISTS idx_notification_receipts_license (license_key);
