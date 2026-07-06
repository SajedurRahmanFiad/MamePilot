-- MamePilot pure schema file.
-- Safe for fresh installs and repeated production updates.
-- This file must not contain INSERT/seed data.

SET NAMES utf8mb4;
SET time_zone = '+00:00';
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(64) NOT NULL,
  role VARCHAR(32) NOT NULL,
  image LONGTEXT NULL,
  password_hash VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by VARCHAR(64) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_phone (phone),
  KEY idx_users_role (role),
  KEY idx_users_created_at (created_at),
  KEY idx_users_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(64) NOT NULL,
  address TEXT NULL,
  total_orders INT NOT NULL DEFAULT 0,
  due_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY idx_customers_name (name),
  KEY idx_customers_phone (phone),
  KEY idx_customers_created_by (created_by),
  KEY idx_customers_created_at (created_at),
  KEY idx_customers_deleted_at (deleted_at),
  KEY idx_customers_deleted_created_at (deleted_at, created_at),
  CONSTRAINT fk_customers_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_customers_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS vendors (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(64) NOT NULL,
  address TEXT NULL,
  total_purchases INT NOT NULL DEFAULT 0,
  due_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY idx_vendors_name (name),
  KEY idx_vendors_phone (phone),
  KEY idx_vendors_created_by (created_by),
  KEY idx_vendors_created_at (created_at),
  KEY idx_vendors_deleted_at (deleted_at),
  KEY idx_vendors_deleted_created_at (deleted_at, created_at),
  CONSTRAINT fk_vendors_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_vendors_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  image LONGTEXT NULL,
  category VARCHAR(255) NULL,
  sale_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  purchase_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  stock INT NOT NULL DEFAULT 0,
  created_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY idx_products_name (name),
  KEY idx_products_category (category),
  KEY idx_products_created_by (created_by),
  KEY idx_products_created_at (created_at),
  KEY idx_products_deleted_at (deleted_at),
  KEY idx_products_deleted_created_at (deleted_at, created_at),
  CONSTRAINT fk_products_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_products_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS accounts (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(32) NOT NULL,
  opening_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  current_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_accounts_name (name),
  KEY idx_accounts_type (type),
  KEY idx_accounts_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS categories (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(32) NOT NULL,
  color VARCHAR(16) NOT NULL DEFAULT '#3B82F6',
  parent_id VARCHAR(64) NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_categories_name_type (name, type),
  KEY idx_categories_type (type),
  KEY idx_categories_parent_id (parent_id),
  CONSTRAINT fk_categories_parent_id FOREIGN KEY (parent_id) REFERENCES categories (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS payment_methods (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_methods_name (name),
  KEY idx_payment_methods_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS units (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(100) NOT NULL,
  short_name VARCHAR(32) NOT NULL,
  description TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_units_name (name),
  UNIQUE KEY uq_units_short_name (short_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS company_settings (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL DEFAULT 'MamePilot',
  phone VARCHAR(64) NULL,
  email VARCHAR(255) NULL,
  address TEXT NULL,
  logo LONGTEXT NULL,
  pages LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS order_settings (
  id VARCHAR(64) NOT NULL,
  prefix VARCHAR(32) NOT NULL DEFAULT 'ORD-',
  next_number BIGINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS invoice_settings (
  id VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'Invoice',
  logo_width INT NOT NULL DEFAULT 120,
  logo_height INT NOT NULL DEFAULT 120,
  footer TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS system_defaults (
  id VARCHAR(64) NOT NULL,
  default_account_id VARCHAR(64) NULL,
  default_payment_method VARCHAR(255) NULL,
  income_category_id VARCHAR(64) NULL,
  expense_category_id VARCHAR(64) NULL,
  records_per_page INT NOT NULL DEFAULT 10,
  max_transaction_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  white_label TINYINT(1) NOT NULL DEFAULT 0,
  theme_color VARCHAR(32) NOT NULL DEFAULT '#0f2f57',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_system_defaults_account FOREIGN KEY (default_account_id) REFERENCES accounts (id) ON DELETE SET NULL,
  CONSTRAINT fk_system_defaults_income_category FOREIGN KEY (income_category_id) REFERENCES categories (id) ON DELETE SET NULL,
  CONSTRAINT fk_system_defaults_expense_category FOREIGN KEY (expense_category_id) REFERENCES categories (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Upgrade compatibility for existing databases
ALTER TABLE `system_defaults`
  ADD COLUMN IF NOT EXISTS `white_label` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `theme_color` VARCHAR(32) NOT NULL DEFAULT '#0f2f57';
CREATE TABLE IF NOT EXISTS courier_settings (
  id VARCHAR(64) NOT NULL,
  steadfast_enabled TINYINT(1) NOT NULL DEFAULT 0,
  steadfast_base_url VARCHAR(255) NULL,
  steadfast_api_key VARCHAR(500) NULL,
  steadfast_secret_key VARCHAR(500) NULL,
  carrybee_enabled TINYINT(1) NOT NULL DEFAULT 0,
  carrybee_base_url VARCHAR(255) NULL,
  carrybee_client_id VARCHAR(255) NULL,
  carrybee_client_secret VARCHAR(500) NULL,
  carrybee_client_context VARCHAR(255) NULL,
  carrybee_store_id VARCHAR(255) NULL,
  paperfly_base_url VARCHAR(255) NULL,
  paperfly_username VARCHAR(255) NULL,
  paperfly_password VARCHAR(500) NULL,
  paperfly_key VARCHAR(500) NULL,
  paperfly_default_shop_name VARCHAR(255) NULL,
  paperfly_max_weight_kg DECIMAL(10,3) NOT NULL DEFAULT 0.300,
  fraud_checker_api_key VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS role_permissions (
  role_name VARCHAR(64) NOT NULL,
  permissions LONGTEXT NULL,
  is_custom TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (role_name),
  KEY idx_role_permissions_is_custom (is_custom)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  maintenance_enabled TINYINT(1) NOT NULL DEFAULT 0,
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
  ADD COLUMN IF NOT EXISTS `license_owner_token` VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS `tier_key` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `override_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `maintenance_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `available_tiers` LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS `pricing_metadata` LONGTEXT NULL;
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
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(64) NOT NULL,
  system_key VARCHAR(191) NULL,
  subject VARCHAR(255) NOT NULL,
  content_html LONGTEXT NOT NULL,
  target_roles LONGTEXT NOT NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  action_config LONGTEXT NULL,
  metadata LONGTEXT NULL,
  created_by VARCHAR(64) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  is_system_generated TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notifications_system_key (system_key),
  KEY idx_notifications_active_window (is_active, starts_at, ends_at),
  KEY idx_notifications_created_by (created_by),
  KEY idx_notifications_created_at (created_at),
  CONSTRAINT fk_notifications_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
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
  CONSTRAINT fk_notification_receipts_notification FOREIGN KEY (notification_id) REFERENCES notifications (id) ON DELETE CASCADE,
  CONSTRAINT fk_notification_receipts_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS service_subscription_settings (
  id VARCHAR(64) NOT NULL,
  plan_name VARCHAR(255) NULL,
  billing_interval VARCHAR(32) NULL,
  subscription_status VARCHAR(64) NOT NULL DEFAULT 'unconfigured',
  current_period_end DATETIME NULL,
  due_at DATETIME NULL,
  reset_day_of_month TINYINT UNSIGNED NULL,
  reset_time_of_day TIME NULL,
  warning_days INT NOT NULL DEFAULT 7,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  nagad_number VARCHAR(64) NULL,
  billing_version INT NOT NULL DEFAULT 1,
  created_by VARCHAR(64) NULL,
  updated_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_service_subscription_settings_due_at (due_at),
  CONSTRAINT fk_service_subscription_settings_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_service_subscription_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `service_subscription_settings`
  ADD COLUMN IF NOT EXISTS `plan_name` VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS `billing_interval` VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS `subscription_status` VARCHAR(64) NOT NULL DEFAULT 'unconfigured',
  ADD COLUMN IF NOT EXISTS `current_period_end` DATETIME NULL;
CREATE TABLE IF NOT EXISTS service_subscription_items (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  amount DECIMAL(12,2) NULL,
  is_optional TINYINT(1) NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 0,
  system_key VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_subscription_items_system_key (system_key),
  KEY idx_service_subscription_items_active_order (is_active, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS service_subscription_methods (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  display_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_service_subscription_methods_active_order (is_active, display_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS service_subscription_payments (
  id VARCHAR(64) NOT NULL,
  billing_version INT NOT NULL,
  local_reference VARCHAR(255) NULL,
  gateway_payment_id VARCHAR(255) NULL,
  gateway_name VARCHAR(64) NULL,
  billing_interval VARCHAR(32) NULL,
  invoice_url VARCHAR(500) NULL,
  raw_payload LONGTEXT NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  base_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  tip_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  payment_method_id VARCHAR(64) NULL,
  payment_method_name VARCHAR(255) NOT NULL,
  transaction_id VARCHAR(255) NOT NULL,
  submitted_by VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'processing',
  submitted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reactivate_at DATETIME NULL,
  processed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_service_subscription_payments_version_tx (billing_version, transaction_id),
  KEY idx_service_subscription_payments_status_ready (status, reactivate_at),
  KEY idx_service_subscription_payments_billing_version (billing_version, submitted_at),
  KEY idx_service_subscription_payments_submitted_by (submitted_by),
  CONSTRAINT fk_service_subscription_payments_method FOREIGN KEY (payment_method_id) REFERENCES service_subscription_methods (id) ON DELETE SET NULL,
  CONSTRAINT fk_service_subscription_payments_submitted_by FOREIGN KEY (submitted_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `service_subscription_payments`
  ADD COLUMN IF NOT EXISTS `local_reference` VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS `gateway_payment_id` VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS `gateway_name` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `billing_interval` VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS `invoice_url` VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS `raw_payload` LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS `transaction_id` VARCHAR(255) NULL;
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
CREATE TABLE IF NOT EXISTS payroll_settings (
  id VARCHAR(64) NOT NULL,
  singleton TINYINT(1) NOT NULL DEFAULT 1,
  unit_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  counted_statuses LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payroll_settings_singleton (singleton)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(64) NOT NULL,
  order_number VARCHAR(100) NOT NULL,
  order_seq BIGINT NULL,
  order_date DATE NOT NULL,
  customer_id VARCHAR(64) NOT NULL,
  page_id VARCHAR(64) NULL,
  created_by VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  items LONGTEXT NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  shipping DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  notes TEXT NULL,
  history LONGTEXT NULL,
  page_snapshot LONGTEXT NULL,
  carrybee_consignment_id VARCHAR(255) NULL,
  steadfast_consignment_id VARCHAR(255) NULL,
  paperfly_tracking_number VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by VARCHAR(64) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_orders_order_number (order_number),
  UNIQUE KEY uq_orders_order_seq (order_seq),
  KEY idx_orders_customer_id (customer_id),
  KEY idx_orders_page_id (page_id),
  KEY idx_orders_created_by (created_by),
  KEY idx_orders_status_created_at (status, created_at),
  KEY idx_orders_order_date_created_at (order_date, created_at),
  KEY idx_orders_deleted_created_at (deleted_at, created_at),
  KEY idx_orders_deleted_status_created_at (deleted_at, status, created_at),
  KEY idx_orders_deleted_created_by_created_at (deleted_at, created_by, created_at),
  KEY idx_orders_carrybee_consignment_id (carrybee_consignment_id),
  KEY idx_orders_steadfast_consignment_id (steadfast_consignment_id),
  KEY idx_orders_paperfly_tracking_number (paperfly_tracking_number),
  KEY idx_orders_deleted_at (deleted_at),
  CONSTRAINT fk_orders_customer_id FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE RESTRICT,
  CONSTRAINT fk_orders_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_orders_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS bills (
  id VARCHAR(64) NOT NULL,
  bill_number VARCHAR(100) NOT NULL,
  bill_seq BIGINT NULL,
  bill_date DATE NOT NULL,
  vendor_id VARCHAR(64) NOT NULL,
  created_by VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL,
  items LONGTEXT NULL,
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  shipping DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  total DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  notes TEXT NULL,
  history LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by VARCHAR(64) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bills_bill_number (bill_number),
  UNIQUE KEY uq_bills_bill_seq (bill_seq),
  KEY idx_bills_vendor_id (vendor_id),
  KEY idx_bills_created_by (created_by),
  KEY idx_bills_status_created_at (status, created_at),
  KEY idx_bills_bill_date_created_at (bill_date, created_at),
  KEY idx_bills_deleted_created_at (deleted_at, created_at),
  KEY idx_bills_deleted_created_by_created_at (deleted_at, created_by, created_at),
  KEY idx_bills_deleted_at (deleted_at),
  CONSTRAINT fk_bills_vendor_id FOREIGN KEY (vendor_id) REFERENCES vendors (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bills_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bills_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(64) NOT NULL,
  date DATETIME NOT NULL,
  type VARCHAR(32) NOT NULL,
  category VARCHAR(255) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  transaction_id VARCHAR(255) NULL,
  account_name VARCHAR(255) NULL,
  to_account_id VARCHAR(64) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  description TEXT NOT NULL,
  reference_id VARCHAR(64) NULL,
  contact_id VARCHAR(64) NULL,
  payment_method VARCHAR(255) NOT NULL,
  attachment_name TEXT NULL,
  attachment_url LONGTEXT NULL,
  created_by VARCHAR(64) NOT NULL,
  history LONGTEXT NULL,
  approval_status VARCHAR(32) NOT NULL DEFAULT 'approved',
  account_effect_applied TINYINT(1) NOT NULL DEFAULT 1,
  approval_requested_by VARCHAR(64) NULL,
  approval_requested_at DATETIME NULL,
  approved_by VARCHAR(64) NULL,
  approved_at DATETIME NULL,
  declined_by VARCHAR(64) NULL,
  declined_at DATETIME NULL,
  approval_note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY idx_transactions_account_id (account_id),
  KEY idx_transactions_to_account_id (to_account_id),
  KEY idx_transactions_created_by (created_by),
  KEY idx_transactions_type_created_at (type, created_at),
  KEY idx_transactions_date_created_at (date, created_at),
  KEY idx_transactions_deleted_created_at (deleted_at, created_at),
  KEY idx_transactions_deleted_created_by_created_at (deleted_at, created_by, created_at),
  KEY idx_transactions_deleted_type_created_at (deleted_at, type, created_at),
  KEY idx_transactions_deleted_approval_status_created_at (deleted_at, approval_status, created_at),
  KEY idx_transactions_reference_id (reference_id),
  KEY idx_transactions_contact_id (contact_id),
  KEY idx_transactions_deleted_at (deleted_at),
  CONSTRAINT fk_transactions_account_id FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT fk_transactions_to_account_id FOREIGN KEY (to_account_id) REFERENCES accounts (id) ON DELETE SET NULL,
  CONSTRAINT fk_transactions_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_transactions_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `transactions`
  ADD COLUMN IF NOT EXISTS `transaction_id` VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS `account_name` VARCHAR(255) NULL;
CREATE TABLE IF NOT EXISTS payroll_payments (
  id VARCHAR(64) NOT NULL,
  employee_id VARCHAR(64) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_kind VARCHAR(16) NOT NULL,
  period_label VARCHAR(255) NOT NULL,
  unit_amount_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  counted_statuses_snapshot LONGTEXT NULL,
  order_count_snapshot INT NOT NULL DEFAULT 0,
  amount_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_by VARCHAR(64) NOT NULL,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payroll_payments_employee_paid_at (employee_id, paid_at),
  KEY idx_payroll_payments_period (period_start, period_end),
  CONSTRAINT fk_payroll_payments_employee FOREIGN KEY (employee_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_payroll_payments_paid_by FOREIGN KEY (paid_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS wallet_payouts (
  id VARCHAR(64) NOT NULL,
  employee_id VARCHAR(64) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  payment_method VARCHAR(255) NOT NULL,
  category_id VARCHAR(64) NOT NULL,
  transaction_id VARCHAR(64) NOT NULL,
  paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_by VARCHAR(64) NOT NULL,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wallet_payouts_transaction_id (transaction_id),
  KEY idx_wallet_payouts_employee_paid_at (employee_id, paid_at),
  KEY idx_wallet_payouts_paid_at (paid_at),
  CONSTRAINT fk_wallet_payouts_employee FOREIGN KEY (employee_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_wallet_payouts_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT fk_wallet_payouts_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT,
  CONSTRAINT fk_wallet_payouts_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_wallet_payouts_paid_by FOREIGN KEY (paid_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `wallet_payouts`
  ADD COLUMN IF NOT EXISTS `transaction_id` VARCHAR(64) NULL;
CREATE TABLE IF NOT EXISTS wallet_entries (
  id VARCHAR(64) NOT NULL,
  employee_id VARCHAR(64) NOT NULL,
  entry_type VARCHAR(32) NOT NULL,
  amount_delta DECIMAL(12,2) NOT NULL,
  unit_amount_snapshot DECIMAL(12,2) NULL,
  source_order_id VARCHAR(64) NULL,
  source_order_number VARCHAR(100) NULL,
  wallet_payout_id VARCHAR(64) NULL,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(64) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wallet_entries_order_entry_type (source_order_id, entry_type),
  UNIQUE KEY uq_wallet_entries_wallet_payout_id (wallet_payout_id),
  KEY idx_wallet_entries_employee_created_at (employee_id, created_at),
  KEY idx_wallet_entries_created_at (created_at),
  KEY idx_wallet_entries_entry_type (entry_type),
  CONSTRAINT fk_wallet_entries_employee FOREIGN KEY (employee_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_wallet_entries_order FOREIGN KEY (source_order_id) REFERENCES orders (id) ON DELETE SET NULL,
  CONSTRAINT fk_wallet_entries_wallet_payout FOREIGN KEY (wallet_payout_id) REFERENCES wallet_payouts (id) ON DELETE SET NULL,
  CONSTRAINT fk_wallet_entries_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
DROP VIEW IF EXISTS orders_with_customer_creator;
ALTER TABLE `orders`
  ADD COLUMN IF NOT EXISTS `source_ad` VARCHAR(64) NULL;
CREATE VIEW orders_with_customer_creator AS
SELECT
  o.id,
  o.order_number AS orderNumber,
  o.order_date AS orderDate,
  o.customer_id AS customerId,
  o.page_id AS pageId,
  c.name AS customerName,
  c.phone AS customerPhone,
  c.address AS customerAddress,
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
  o.paperfly_tracking_number AS paperflyTrackingNumber,
  o.source_ad AS sourceAd
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id
LEFT JOIN users u ON u.id = o.created_by
WHERE o.deleted_at IS NULL;
DROP VIEW IF EXISTS bills_with_vendor_creator;
CREATE VIEW bills_with_vendor_creator AS
SELECT
  b.id,
  b.bill_number AS billNumber,
  b.bill_date AS billDate,
  b.vendor_id AS vendorId,
  v.name AS vendorName,
  v.phone AS vendorPhone,
  v.address AS vendorAddress,
  b.created_by AS createdBy,
  u.name AS creatorName,
  b.status,
  b.items,
  b.subtotal,
  b.discount,
  b.shipping,
  b.total,
  b.paid_amount AS paidAmount,
  b.notes,
  b.history,
  b.created_at AS createdAt,
  b.deleted_at AS deletedAt,
  b.deleted_by AS deletedBy
FROM bills b
LEFT JOIN vendors v ON v.id = b.vendor_id
LEFT JOIN users u ON u.id = b.created_by
WHERE b.deleted_at IS NULL;
DROP VIEW IF EXISTS transactions_with_relations;
CREATE VIEW transactions_with_relations AS
SELECT
  t.id,
  t.date,
  t.type,
  t.category,
  t.account_id AS accountId,
  a.name AS accountName,
  t.to_account_id AS toAccountId,
  t.amount,
  t.description,
  t.reference_id AS referenceId,
  t.contact_id AS contactId,
  COALESCE(c.name, v.name) AS contactName,
  CASE
    WHEN c.id IS NOT NULL THEN 'Customer'
    WHEN v.id IS NOT NULL THEN 'Vendor'
    ELSE NULL
  END AS contactType,
  t.payment_method AS paymentMethod,
  t.attachment_name AS attachmentName,
  t.attachment_url AS attachmentUrl,
  t.created_by AS createdBy,
  u.name AS creatorName,
  t.approval_status AS approvalStatus,
  t.account_effect_applied AS accountEffectApplied,
  t.approval_requested_at AS approvalRequestedAt,
  t.approved_at AS approvedAt,
  t.declined_at AS declinedAt,
  t.approval_note AS approvalNote,
  t.created_at AS createdAt,
  t.deleted_at AS deletedAt,
  t.deleted_by AS deletedBy
FROM transactions t
LEFT JOIN accounts a ON a.id = t.account_id
LEFT JOIN customers c ON c.id = t.contact_id
LEFT JOIN vendors v ON v.id = t.contact_id
LEFT JOIN users u ON u.id = t.created_by
WHERE t.deleted_at IS NULL;
DROP VIEW IF EXISTS employee_wallet_balances;
CREATE VIEW employee_wallet_balances AS
SELECT
  u.id AS employeeId,
  u.name AS employeeName,
  u.role AS employeeRole,
  ROUND(COALESCE(SUM(
    CASE
      WHEN we.entry_type IN ('order_credit', 'order_reversal')
        AND o.created_at >= '2026-03-31 18:00:00' THEN we.amount_delta
      WHEN we.entry_type NOT IN ('order_credit', 'order_reversal')
        AND we.created_at >= '2026-03-31 18:00:00' THEN we.amount_delta
      ELSE 0
    END
  ), 0), 2) AS currentBalance,
  ROUND(COALESCE(SUM(
    CASE
      WHEN we.entry_type = 'order_credit'
        AND o.created_at >= '2026-03-31 18:00:00' THEN we.amount_delta
      ELSE 0
    END
  ), 0), 2) AS totalEarned,
  ROUND(ABS(COALESCE(SUM(
    CASE
      WHEN we.entry_type = 'payout'
        AND we.created_at >= '2026-03-31 18:00:00' THEN we.amount_delta
      ELSE 0
    END
  ), 0)), 2) AS totalPaid,
  COALESCE(active_wallet_orders.credited_orders, 0) AS creditedOrders,
  MAX(
    CASE
      WHEN we.entry_type IN ('order_credit', 'order_reversal')
        AND o.created_at >= '2026-03-31 18:00:00' THEN we.created_at
      WHEN we.entry_type NOT IN ('order_credit', 'order_reversal')
        AND we.created_at >= '2026-03-31 18:00:00' THEN we.created_at
      ELSE NULL
    END
  ) AS lastActivityAt
FROM users u
LEFT JOIN wallet_entries we ON we.employee_id = u.id
LEFT JOIN orders o ON o.id = we.source_order_id
LEFT JOIN (
  SELECT
    active_order_credits.employee_id,
    COUNT(*) AS credited_orders
  FROM (
    SELECT
      we.employee_id,
      we.source_order_id
    FROM wallet_entries we
    INNER JOIN orders o ON o.id = we.source_order_id
    WHERE we.entry_type IN ('order_credit', 'order_reversal')
      AND o.created_at >= '2026-03-31 18:00:00'
    GROUP BY we.employee_id, we.source_order_id
    HAVING ROUND(COALESCE(SUM(we.amount_delta), 0), 2) > 0
  ) active_order_credits
  GROUP BY active_order_credits.employee_id
) active_wallet_orders ON active_wallet_orders.employee_id = u.id
WHERE u.role IN ('Employee')
  AND u.deleted_at IS NULL
GROUP BY u.id, u.name, u.role, active_wallet_orders.credited_orders;
DROP VIEW IF EXISTS wallet_activity_with_relations;
CREATE VIEW wallet_activity_with_relations AS
SELECT
  we.id,
  we.employee_id AS employeeId,
  employee_user.name AS employeeName,
  employee_user.role AS employeeRole,
  we.entry_type AS entryType,
  we.amount_delta AS amountDelta,
  we.unit_amount_snapshot AS unitAmountSnapshot,
  we.source_order_id AS orderId,
  COALESCE(we.source_order_number, o.order_number) AS orderNumber,
  we.wallet_payout_id AS payoutId,
  wp.transaction_id AS transactionId,
  wp.account_id AS accountId,
  a.name AS accountName,
  wp.payment_method AS paymentMethod,
  wp.category_id AS categoryId,
  c.name AS categoryName,
  we.note,
  we.created_at AS createdAt,
  we.created_by AS createdBy,
  creator_user.name AS createdByName,
  wp.paid_at AS paidAt,
  wp.paid_by AS paidBy,
  paid_by_user.name AS paidByName
FROM wallet_entries we
LEFT JOIN users employee_user ON employee_user.id = we.employee_id
LEFT JOIN orders o ON o.id = we.source_order_id
LEFT JOIN wallet_payouts wp ON wp.id = we.wallet_payout_id
LEFT JOIN accounts a ON a.id = wp.account_id
LEFT JOIN categories c ON c.id = wp.category_id
LEFT JOIN users creator_user ON creator_user.id = we.created_by
LEFT JOIN users paid_by_user ON paid_by_user.id = wp.paid_by;

