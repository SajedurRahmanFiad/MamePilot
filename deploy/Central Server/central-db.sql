CREATE TABLE license_tiers (
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
);

CREATE TABLE licenses (
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
);

CREATE TABLE maintenance_settings (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO maintenance_settings (id, enabled) VALUES ('maintenance', 0)
  ON DUPLICATE KEY UPDATE enabled = VALUES(enabled);

INSERT INTO license_tiers (tier_key, tier_name, monthly_price, yearly_price, capabilities, sort_order) VALUES
('starter', 'Starter', 1990, 19900, '["dashboard","inventory","sales"]', 1),
('growth', 'Growth', 2990, 29900, '["dashboard","inventory","sales","purchases","banking","fraud_checker","courier_automation","recycle_bin_undoer"]', 2),
('advanced', 'Advanced', 4990, 49900, '["dashboard","inventory","sales","recycle_bin_undoer","purchases","banking","human_resources","advanced_reports","fraud_checker","whitelabel","custom_roles","courier_automation"]', 3);

CREATE TABLE notifications (
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
);

CREATE TABLE notification_receipts (
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
