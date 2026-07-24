-- MamePilot production-safe schema-only migration.

-- Generated from backend/database/schema.sql plus migrations/*.sql.

-- Contains row-preserving DDL only: no seed inserts and no business-row updates.

-- Helper procedures make row-preserving column and index changes idempotent on
-- MariaDB and MySQL versions that do not support every IF NOT EXISTS form.
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

DROP PROCEDURE IF EXISTS sp_create_idx;
DELIMITER $$
CREATE PROCEDURE sp_create_idx(IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_columns TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND INDEX_NAME = p_index
  ) THEN
    SET @sql = CONCAT('CREATE INDEX `', p_index, '` ON `', p_table, '` (', p_columns, ')');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_create_unique_idx;
DELIMITER $$
CREATE PROCEDURE sp_create_unique_idx(IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_columns TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND INDEX_NAME = p_index
  ) THEN
    SET @sql = CONCAT('CREATE UNIQUE INDEX `', p_index, '` ON `', p_table, '` (', p_columns, ')');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$
DELIMITER ;

DROP PROCEDURE IF EXISTS sp_drop_idx;
DELIMITER $$
CREATE PROCEDURE sp_drop_idx(IN p_table VARCHAR(64), IN p_index VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND INDEX_NAME = p_index
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` DROP INDEX `', p_index, '`');
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END $$
DELIMITER ;

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
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  image LONGTEXT NULL,
  email VARCHAR(255) NULL,
  address TEXT NULL,
  birthday DATE NULL,
  nid_passport_copy LONGTEXT NULL,
  gender VARCHAR(32) NULL,
  blood_group VARCHAR(16) NULL,
  nationality VARCHAR(128) NULL,
  cv LONGTEXT NULL,
  is_commission_based TINYINT(1) NOT NULL DEFAULT 0,
  fixed_salary DECIMAL(12,2) NULL,
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

CREATE TABLE IF NOT EXISTS units (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(100) NOT NULL,
  short_name VARCHAR(32) NOT NULL,
  description TEXT NULL,
  is_fraction TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_units_name (name),
  UNIQUE KEY uq_units_short_name (short_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NULL,
  image LONGTEXT NULL,
  category VARCHAR(255) NULL,
  unit_id VARCHAR(64) NULL,
  sale_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  purchase_price DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  stock INT NOT NULL DEFAULT 0,
  dynamic_pricing LONGTEXT NULL,
  created_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  deleted_by VARCHAR(64) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_products_slug (slug),
  KEY idx_products_name (name),
  KEY idx_products_category (category),
  KEY idx_products_created_by (created_by),
  KEY idx_products_created_at (created_at),
  KEY idx_products_deleted_at (deleted_at),
  KEY idx_products_deleted_created_at (deleted_at, created_at),
  CONSTRAINT fk_products_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_products_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_products_unit_id FOREIGN KEY (unit_id) REFERENCES units (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL sp_add_col('units', 'is_fraction', 'TINYINT(1) NOT NULL DEFAULT 0');

CALL sp_add_col('products', 'unit_id', 'VARCHAR(64) NULL');
CALL sp_add_col('products', 'dynamic_pricing', 'LONGTEXT NULL');

SET @mamepilot_product_unit_fk_sql = (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'products'
        AND CONSTRAINT_NAME = 'fk_products_unit_id'
        AND CONSTRAINT_TYPE = 'FOREIGN KEY'
    ),
    'SET @mamepilot_product_unit_fk_noop = 1',
    'ALTER TABLE `products` ADD CONSTRAINT `fk_products_unit_id` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL'
  )
);

PREPARE mamepilot_product_unit_fk_stmt FROM @mamepilot_product_unit_fk_sql;

EXECUTE mamepilot_product_unit_fk_stmt;

DEALLOCATE PREPARE mamepilot_product_unit_fk_stmt;

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

CALL sp_add_col('users', 'email', 'VARCHAR(255) NULL');
CALL sp_add_col('users', 'address', 'TEXT NULL');
CALL sp_add_col('users', 'birthday', 'DATE NULL');
CALL sp_add_col('users', 'nid_passport_copy', 'LONGTEXT NULL');
CALL sp_add_col('users', 'gender', 'VARCHAR(32) NULL');
CALL sp_add_col('users', 'blood_group', 'VARCHAR(16) NULL');
CALL sp_add_col('users', 'nationality', 'VARCHAR(128) NULL');
CALL sp_add_col('users', 'cv', 'LONGTEXT NULL');
CALL sp_add_col('users', 'is_commission_based', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('users', 'fixed_salary', 'DECIMAL(12,2) NULL');

CALL sp_add_col('system_defaults', 'white_label', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('system_defaults', 'theme_color', 'VARCHAR(32) NOT NULL DEFAULT ''#0f2f57''');

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
  pathao_enabled TINYINT(1) NOT NULL DEFAULT 0,
  pathao_base_url VARCHAR(255) NULL,
  pathao_client_id VARCHAR(255) NULL,
  pathao_client_secret VARCHAR(500) NULL,
  pathao_username VARCHAR(255) NULL,
  pathao_password VARCHAR(500) NULL,
  pathao_store_id VARCHAR(255) NULL,
  pathao_default_quantity INT NOT NULL DEFAULT 1,
  pathao_default_weight DECIMAL(10,2) NOT NULL DEFAULT 1.00,
  pathao_default_delivery_type INT NOT NULL DEFAULT 48,
  pathao_default_item_type INT NOT NULL DEFAULT 2,
  pathao_access_token TEXT NULL,
  pathao_refresh_token TEXT NULL,
  pathao_token_expires_at VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL sp_add_col('courier_settings', 'pathao_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('courier_settings', 'pathao_base_url', 'VARCHAR(255) NULL');
CALL sp_add_col('courier_settings', 'pathao_client_id', 'VARCHAR(255) NULL');
CALL sp_add_col('courier_settings', 'pathao_client_secret', 'VARCHAR(500) NULL');
CALL sp_add_col('courier_settings', 'pathao_username', 'VARCHAR(255) NULL');
CALL sp_add_col('courier_settings', 'pathao_password', 'VARCHAR(500) NULL');
CALL sp_add_col('courier_settings', 'pathao_store_id', 'VARCHAR(255) NULL');
CALL sp_add_col('courier_settings', 'pathao_default_quantity', 'INT NOT NULL DEFAULT 1');
CALL sp_add_col('courier_settings', 'pathao_default_weight', 'DECIMAL(10,2) NOT NULL DEFAULT 1.00');
CALL sp_add_col('courier_settings', 'pathao_default_delivery_type', 'INT NOT NULL DEFAULT 48');
CALL sp_add_col('courier_settings', 'pathao_default_item_type', 'INT NOT NULL DEFAULT 2');
CALL sp_add_col('courier_settings', 'pathao_access_token', 'TEXT NULL');
CALL sp_add_col('courier_settings', 'pathao_refresh_token', 'TEXT NULL');
CALL sp_add_col('courier_settings', 'pathao_token_expires_at', 'VARCHAR(64) NULL');

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
  maintenance_image_url VARCHAR(1000) NULL,
  maintenance_caption VARCHAR(500) NULL,
  maintenance_subtitle TEXT NULL,
  maintenance_explanation TEXT NULL,
  maintenance_ends_at DATETIME NULL,
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

CALL sp_add_col('app_capability_settings', 'license_owner_token', 'VARCHAR(500) NULL');
CALL sp_add_col('app_capability_settings', 'tier_key', 'VARCHAR(64) NULL');
CALL sp_add_col('app_capability_settings', 'override_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('app_capability_settings', 'maintenance_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('app_capability_settings', 'maintenance_image_url', 'VARCHAR(1000) NULL');
CALL sp_add_col('app_capability_settings', 'maintenance_caption', 'VARCHAR(500) NULL');
CALL sp_add_col('app_capability_settings', 'maintenance_subtitle', 'TEXT NULL');
CALL sp_add_col('app_capability_settings', 'maintenance_explanation', 'TEXT NULL');
CALL sp_add_col('app_capability_settings', 'maintenance_ends_at', 'DATETIME NULL');
CALL sp_add_col('app_capability_settings', 'available_tiers', 'LONGTEXT NULL');
CALL sp_add_col('app_capability_settings', 'pricing_metadata', 'LONGTEXT NULL');

CREATE TABLE IF NOT EXISTS payment_gateway_settings (
  id VARCHAR(64) NOT NULL,
  piprapay_base_url VARCHAR(500) NULL,
  piprapay_api_key VARCHAR(500) NULL,
  piprapay_merchant_id VARCHAR(255) NULL,
  piprapay_ipn_secret VARCHAR(500) NULL,
  piprapay_webhook_url VARCHAR(1000) NULL,
  piprapay_return_url VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_settings (
  id VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  main_provider VARCHAR(32) NOT NULL DEFAULT 'anthropic',
  anthropic_enabled TINYINT(1) NOT NULL DEFAULT 0,
  anthropic_base_url VARCHAR(500) NULL,
  anthropic_api_key VARCHAR(500) NULL,
  anthropic_model VARCHAR(255) NULL,
  anthropic_organization VARCHAR(255) NULL,
  anthropic_project VARCHAR(255) NULL,
  openai_enabled TINYINT(1) NOT NULL DEFAULT 0,
  openai_base_url VARCHAR(500) NULL,
  openai_api_key VARCHAR(500) NULL,
  openai_model VARCHAR(255) NULL,
  openai_organization VARCHAR(255) NULL,
  openai_project VARCHAR(255) NULL,
  google_enabled TINYINT(1) NOT NULL DEFAULT 0,
  google_base_url VARCHAR(500) NULL,
  google_api_key VARCHAR(500) NULL,
  google_model VARCHAR(255) NULL,
  google_organization VARCHAR(255) NULL,
  google_project VARCHAR(255) NULL,
  groq_enabled TINYINT(1) NOT NULL DEFAULT 0,
  groq_base_url VARCHAR(500) NULL,
  groq_api_key VARCHAR(500) NULL,
  groq_model VARCHAR(255) NULL,
  show_reasoning_summaries TINYINT(1) NOT NULL DEFAULT 1,
  show_tool_activity TINYINT(1) NOT NULL DEFAULT 1,
  max_reasoning_steps INT NOT NULL DEFAULT 8,
  max_tool_calls INT NOT NULL DEFAULT 12,
  query_row_limit INT NOT NULL DEFAULT 100,
  query_timeout_ms INT NOT NULL DEFAULT 15000,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_conversations (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'New conversation',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  last_message_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_conversations_user_id (user_id),
  KEY idx_agent_conversations_last_message_at (last_message_at),
  CONSTRAINT fk_agent_conversations_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_runs (
  id VARCHAR(64) NOT NULL,
  conversation_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'queued',
  main_provider VARCHAR(32) NULL,
  main_model VARCHAR(255) NULL,
  deterministic_provider VARCHAR(32) NULL,
  deterministic_model VARCHAR(255) NULL,
  current_step INT NOT NULL DEFAULT 0,
  max_steps INT NOT NULL DEFAULT 0,
  stream_token VARCHAR(128) NULL,
  error_message TEXT NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_runs_conversation_id (conversation_id),
  KEY idx_agent_runs_user_id (user_id),
  KEY idx_agent_runs_status (status),
  KEY idx_agent_runs_stream_token (stream_token),
  CONSTRAINT fk_agent_runs_conversation_id FOREIGN KEY (conversation_id) REFERENCES agent_conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_runs_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_messages (
  id VARCHAR(64) NOT NULL,
  conversation_id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NULL,
  role VARCHAR(16) NOT NULL,
  content LONGTEXT NULL,
  reasoning_summary LONGTEXT NULL,
  metadata_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_messages_conversation_id (conversation_id),
  KEY idx_agent_messages_run_id (run_id),
  KEY idx_agent_messages_created_at (created_at),
  CONSTRAINT fk_agent_messages_conversation_id FOREIGN KEY (conversation_id) REFERENCES agent_conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_messages_run_id FOREIGN KEY (run_id) REFERENCES agent_runs (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_run_events (
  id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  sequence_no INT NOT NULL,
  payload_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_run_events_run_id (run_id),
  KEY idx_agent_run_events_sequence_no (sequence_no),
  CONSTRAINT fk_agent_run_events_run_id FOREIGN KEY (run_id) REFERENCES agent_runs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  step_no INT NOT NULL DEFAULT 0,
  tool_name VARCHAR(64) NOT NULL,
  tool_input_json LONGTEXT NULL,
  tool_result_json LONGTEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  duration_ms INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_tool_calls_run_id (run_id),
  KEY idx_agent_tool_calls_step_no (step_no),
  CONSTRAINT fk_agent_tool_calls_run_id FOREIGN KEY (run_id) REFERENCES agent_runs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_db_query_audit (
  id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NULL,
  tool_call_id VARCHAR(64) NULL,
  user_id VARCHAR(64) NOT NULL,
  sql_text LONGTEXT NOT NULL,
  normalized_sql LONGTEXT NULL,
  row_count INT NOT NULL DEFAULT 0,
  duration_ms INT NOT NULL DEFAULT 0,
  safety_flags_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_db_query_audit_run_id (run_id),
  KEY idx_agent_db_query_audit_tool_call_id (tool_call_id),
  KEY idx_agent_db_query_audit_user_id (user_id),
  CONSTRAINT fk_agent_db_query_audit_run_id FOREIGN KEY (run_id) REFERENCES agent_runs (id) ON DELETE SET NULL,
  CONSTRAINT fk_agent_db_query_audit_tool_call_id FOREIGN KEY (tool_call_id) REFERENCES agent_tool_calls (id) ON DELETE SET NULL,
  CONSTRAINT fk_agent_db_query_audit_user_id FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL sp_add_col('payment_gateway_settings', 'piprapay_base_url', 'VARCHAR(500) NULL');
CALL sp_add_col('payment_gateway_settings', 'piprapay_api_key', 'VARCHAR(500) NULL');
CALL sp_add_col('payment_gateway_settings', 'piprapay_merchant_id', 'VARCHAR(255) NULL');
CALL sp_add_col('payment_gateway_settings', 'piprapay_ipn_secret', 'VARCHAR(500) NULL');
CALL sp_add_col('payment_gateway_settings', 'piprapay_webhook_url', 'VARCHAR(1000) NULL');
CALL sp_add_col('payment_gateway_settings', 'piprapay_return_url', 'VARCHAR(1000) NULL');

CALL sp_add_col('agent_settings', 'enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('agent_settings', 'main_provider', 'VARCHAR(32) NOT NULL DEFAULT ''anthropic''');
CALL sp_add_col('agent_settings', 'anthropic_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('agent_settings', 'anthropic_base_url', 'VARCHAR(500) NULL');
CALL sp_add_col('agent_settings', 'anthropic_api_key', 'VARCHAR(500) NULL');
CALL sp_add_col('agent_settings', 'anthropic_model', 'VARCHAR(255) NULL');
CALL sp_add_col('agent_settings', 'anthropic_organization', 'VARCHAR(255) NULL');
CALL sp_add_col('agent_settings', 'anthropic_project', 'VARCHAR(255) NULL');
CALL sp_add_col('agent_settings', 'openai_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('agent_settings', 'openai_base_url', 'VARCHAR(500) NULL');
CALL sp_add_col('agent_settings', 'openai_api_key', 'VARCHAR(500) NULL');
CALL sp_add_col('agent_settings', 'openai_model', 'VARCHAR(255) NULL');
CALL sp_add_col('agent_settings', 'openai_organization', 'VARCHAR(255) NULL');
CALL sp_add_col('agent_settings', 'openai_project', 'VARCHAR(255) NULL');
CALL sp_add_col('agent_settings', 'google_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('agent_settings', 'google_base_url', 'VARCHAR(500) NULL');
CALL sp_add_col('agent_settings', 'google_api_key', 'VARCHAR(500) NULL');
CALL sp_add_col('agent_settings', 'google_model', 'VARCHAR(255) NULL');
CALL sp_add_col('agent_settings', 'google_organization', 'VARCHAR(255) NULL');
CALL sp_add_col('agent_settings', 'google_project', 'VARCHAR(255) NULL');
CALL sp_add_col('agent_settings', 'groq_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('agent_settings', 'groq_base_url', 'VARCHAR(500) NULL');
CALL sp_add_col('agent_settings', 'groq_api_key', 'VARCHAR(500) NULL');
CALL sp_add_col('agent_settings', 'groq_model', 'VARCHAR(255) NULL');
CALL sp_add_col('agent_settings', 'show_reasoning_summaries', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL sp_add_col('agent_settings', 'show_tool_activity', 'TINYINT(1) NOT NULL DEFAULT 1');
CALL sp_add_col('agent_settings', 'max_reasoning_steps', 'INT NOT NULL DEFAULT 8');
CALL sp_add_col('agent_settings', 'max_tool_calls', 'INT NOT NULL DEFAULT 12');
CALL sp_add_col('agent_settings', 'query_row_limit', 'INT NOT NULL DEFAULT 100');
CALL sp_add_col('agent_settings', 'query_timeout_ms', 'INT NOT NULL DEFAULT 15000');

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

CALL sp_add_col('service_subscription_settings', 'plan_name', 'VARCHAR(255) NULL');
CALL sp_add_col('service_subscription_settings', 'billing_interval', 'VARCHAR(32) NULL');
CALL sp_add_col('service_subscription_settings', 'subscription_status', 'VARCHAR(64) NOT NULL DEFAULT ''unconfigured''');
CALL sp_add_col('service_subscription_settings', 'current_period_end', 'DATETIME NULL');

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

CALL sp_add_col('service_subscription_payments', 'local_reference', 'VARCHAR(255) NULL');
CALL sp_add_col('service_subscription_payments', 'gateway_payment_id', 'VARCHAR(255) NULL');
CALL sp_add_col('service_subscription_payments', 'gateway_name', 'VARCHAR(64) NULL');
CALL sp_add_col('service_subscription_payments', 'billing_interval', 'VARCHAR(32) NULL');
CALL sp_add_col('service_subscription_payments', 'invoice_url', 'VARCHAR(500) NULL');
CALL sp_add_col('service_subscription_payments', 'raw_payload', 'LONGTEXT NULL');
CALL sp_add_col('service_subscription_payments', 'transaction_id', 'VARCHAR(255) NULL');

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
  pathao_consignment_id VARCHAR(255) NULL,
  exchange_courier VARCHAR(32) NULL,
  exchange_steadfast_consignment_id VARCHAR(255) NULL,
  exchange_carrybee_consignment_id VARCHAR(255) NULL,
  exchange_paperfly_tracking_number VARCHAR(255) NULL,
  exchange_pathao_consignment_id VARCHAR(255) NULL,
  exchange_courier_history TEXT NULL,
  source_ad VARCHAR(64) NULL,
  survey_id VARCHAR(64) NULL,
  survey_status VARCHAR(32) NULL DEFAULT NULL,
  survey_response VARCHAR(16) NULL,
  survey_call_status VARCHAR(32) NULL,
  confirmation_status VARCHAR(32) NULL,
  survey_result_fetch_at DATETIME NULL,
  survey_next_retry_at DATETIME NULL,
  survey_retry_count INT NOT NULL DEFAULT 0,
  survey_last_retry_reason VARCHAR(32) NULL,
  survey_last_retry_at DATETIME NULL,
  survey_triggered_at DATETIME NULL,
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
  KEY idx_orders_pathao_consignment_id (pathao_consignment_id),
  KEY idx_orders_survey_status (survey_status),
  KEY idx_orders_confirmation_status (confirmation_status),
  KEY idx_orders_survey_next_retry_at (survey_next_retry_at),
  KEY idx_orders_deleted_at (deleted_at),
  CONSTRAINT fk_orders_customer_id FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE RESTRICT,
  CONSTRAINT fk_orders_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT fk_orders_deleted_by FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS voice_survey_settings (
  id VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  delay_minutes INT NOT NULL DEFAULT 5,
  api_token TEXT NULL,
  sender VARCHAR(64) NULL,
  template_name VARCHAR(191) NULL,
  webhook_secret VARCHAR(255) NULL,
  webhook_url VARCHAR(1000) NULL,
  max_survey_time_seconds INT NOT NULL DEFAULT 120,
  missed_call_retry_minutes INT NOT NULL DEFAULT 30,
  missed_call_retry_count INT NOT NULL DEFAULT 3,
  no_key_retry_minutes INT NOT NULL DEFAULT 10,
  no_key_retry_count INT NOT NULL DEFAULT 2,
  trigger_statuses TEXT NULL,
  cron_last_run DATETIME NULL,
  cron_last_success_at DATETIME NULL,
  cron_last_error TEXT NULL,
  cron_last_processed_count INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS voice_survey_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id VARCHAR(64) NOT NULL,
  survey_id VARCHAR(64) NULL,
  event_type VARCHAR(32) NOT NULL,
  call_status VARCHAR(32) NULL,
  response VARCHAR(32) NULL,
  details TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_voice_survey_events_order_created (order_id, created_at),
  KEY idx_voice_survey_events_survey_id (survey_id),
  CONSTRAINT fk_voice_survey_events_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS woocommerce_stores (
  id VARCHAR(64) NOT NULL,
  store_name VARCHAR(191) NOT NULL,
  store_url VARCHAR(500) NOT NULL,
  consumer_key VARCHAR(255) NULL,
  consumer_secret VARCHAR(255) NULL,
  webhook_secret VARCHAR(255) NULL,
  webhook_base_url VARCHAR(1000) NULL,
  webhook_id BIGINT NULL,
  company_page_id VARCHAR(64) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_synced_at DATETIME NULL,
  last_sync_status VARCHAR(32) NULL,
  last_sync_message VARCHAR(1000) NULL,
  orders_synced INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_woocommerce_stores_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS woocommerce_order_links (
  id VARCHAR(64) NOT NULL,
  store_id VARCHAR(64) NOT NULL,
  wc_order_id BIGINT NOT NULL,
  wc_order_number VARCHAR(64) NULL,
  order_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'imported',
  message VARCHAR(1000) NULL,
  payload_hash VARCHAR(64) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wc_order_links_store_order (store_id, wc_order_id),
  KEY idx_wc_order_links_store_created (store_id, created_at),
  CONSTRAINT fk_wc_order_links_store FOREIGN KEY (store_id) REFERENCES woocommerce_stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS woocommerce_product_links (
  id VARCHAR(64) NOT NULL,
  store_id VARCHAR(64) NOT NULL,
  wc_product_id BIGINT NOT NULL,
  wc_variation_id BIGINT NOT NULL DEFAULT 0,
  sku VARCHAR(191) NULL,
  product_id VARCHAR(64) NOT NULL,
  auto_created TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wc_product_links_remote (store_id, wc_product_id, wc_variation_id),
  KEY idx_wc_product_links_product (product_id),
  CONSTRAINT fk_wc_product_links_store FOREIGN KEY (store_id) REFERENCES woocommerce_stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_wc_product_links_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
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

CALL sp_add_col('transactions', 'transaction_id', 'VARCHAR(255) NULL');
CALL sp_add_col('transactions', 'account_name', 'VARCHAR(255) NULL');

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
  compensation_type VARCHAR(32) NOT NULL DEFAULT 'commission',
  fixed_salary_snapshot DECIMAL(12,2) NULL,
  base_amount_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  bonus_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  deduction_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  amount_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  wallet_payout_id VARCHAR(64) NULL,
  transaction_id VARCHAR(64) NULL,
  account_id VARCHAR(64) NULL,
  payment_method VARCHAR(255) NULL,
  category_id VARCHAR(64) NULL,
  paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_by VARCHAR(64) NOT NULL,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payroll_payments_employee_paid_at (employee_id, paid_at),
  KEY idx_payroll_payments_period (period_start, period_end),
  KEY idx_payroll_payments_employee_period (employee_id, period_start, period_end),
  UNIQUE KEY uq_payroll_payments_wallet_payout (wallet_payout_id),
  UNIQUE KEY uq_payroll_payments_transaction (transaction_id),
  CONSTRAINT fk_payroll_payments_employee FOREIGN KEY (employee_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_payroll_payments_paid_by FOREIGN KEY (paid_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL sp_add_col('payroll_payments', 'compensation_type', 'VARCHAR(32) NOT NULL DEFAULT ''commission''');
CALL sp_add_col('payroll_payments', 'fixed_salary_snapshot', 'DECIMAL(12,2) NULL');
CALL sp_add_col('payroll_payments', 'base_amount_snapshot', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00');
CALL sp_add_col('payroll_payments', 'bonus_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00');
CALL sp_add_col('payroll_payments', 'deduction_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00');
CALL sp_add_col('payroll_payments', 'wallet_payout_id', 'VARCHAR(64) NULL');
CALL sp_add_col('payroll_payments', 'transaction_id', 'VARCHAR(64) NULL');
CALL sp_add_col('payroll_payments', 'account_id', 'VARCHAR(64) NULL');
CALL sp_add_col('payroll_payments', 'payment_method', 'VARCHAR(255) NULL');
CALL sp_add_col('payroll_payments', 'category_id', 'VARCHAR(64) NULL');

CALL sp_create_idx('payroll_payments', 'idx_payroll_payments_employee_period', '`employee_id`, `period_start`, `period_end`');
CALL sp_create_unique_idx('payroll_payments', 'uq_payroll_payments_wallet_payout', '`wallet_payout_id`');
CALL sp_create_unique_idx('payroll_payments', 'uq_payroll_payments_transaction', '`transaction_id`');

CREATE TABLE IF NOT EXISTS wallet_payouts (
  id VARCHAR(64) NOT NULL,
  employee_id VARCHAR(64) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  payment_method VARCHAR(255) NOT NULL,
  category_id VARCHAR(64) NOT NULL,
  transaction_id VARCHAR(64) NOT NULL,
  payroll_payment_id VARCHAR(64) NULL,
  paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_by VARCHAR(64) NOT NULL,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wallet_payouts_transaction_id (transaction_id),
  UNIQUE KEY uq_wallet_payouts_payroll_payment (payroll_payment_id),
  KEY idx_wallet_payouts_employee_paid_at (employee_id, paid_at),
  KEY idx_wallet_payouts_paid_at (paid_at),
  CONSTRAINT fk_wallet_payouts_employee FOREIGN KEY (employee_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_wallet_payouts_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT fk_wallet_payouts_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT,
  CONSTRAINT fk_wallet_payouts_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_wallet_payouts_paid_by FOREIGN KEY (paid_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL sp_add_col('wallet_payouts', 'transaction_id', 'VARCHAR(64) NULL');
CALL sp_add_col('wallet_payouts', 'payroll_payment_id', 'VARCHAR(64) NULL');

CALL sp_create_unique_idx('wallet_payouts', 'uq_wallet_payouts_payroll_payment', '`payroll_payment_id`');

CREATE TABLE IF NOT EXISTS wallet_entries (
  id VARCHAR(64) NOT NULL,
  employee_id VARCHAR(64) NOT NULL,
  entry_type VARCHAR(32) NOT NULL,
  amount_delta DECIMAL(12,2) NOT NULL,
  unit_amount_snapshot DECIMAL(12,2) NULL,
  source_order_id VARCHAR(64) NULL,
  source_order_number VARCHAR(100) NULL,
  wallet_payout_id VARCHAR(64) NULL,
  payroll_payment_id VARCHAR(64) NULL,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY idx_wallet_entries_order_entry_type (source_order_id, entry_type),
  UNIQUE KEY uq_wallet_entries_wallet_payout_id (wallet_payout_id),
  KEY idx_wallet_entries_employee_created_at (employee_id, created_at),
  KEY idx_wallet_entries_created_at (created_at),
  KEY idx_wallet_entries_entry_type (entry_type),
  KEY idx_wallet_entries_payroll_payment (payroll_payment_id),
  UNIQUE KEY uq_wallet_entries_payroll_entry (payroll_payment_id, entry_type),
  CONSTRAINT fk_wallet_entries_employee FOREIGN KEY (employee_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_wallet_entries_order FOREIGN KEY (source_order_id) REFERENCES orders (id) ON DELETE SET NULL,
  CONSTRAINT fk_wallet_entries_wallet_payout FOREIGN KEY (wallet_payout_id) REFERENCES wallet_payouts (id) ON DELETE SET NULL,
  CONSTRAINT fk_wallet_entries_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL sp_add_col('wallet_entries', 'payroll_payment_id', 'VARCHAR(64) NULL');

CALL sp_create_idx('wallet_entries', 'idx_wallet_entries_order_entry_type', '`source_order_id`, `entry_type`');

CALL sp_drop_idx('wallet_entries', 'uq_wallet_entries_order_entry_type');
CALL sp_create_idx('wallet_entries', 'idx_wallet_entries_payroll_payment', '`payroll_payment_id`');
CALL sp_create_unique_idx('wallet_entries', 'uq_wallet_entries_payroll_entry', '`payroll_payment_id`, `entry_type`');

DROP VIEW IF EXISTS orders_with_customer_creator;

CALL sp_add_col('orders', 'pathao_consignment_id', 'VARCHAR(255) NULL');
CALL sp_add_col('orders', 'exchange_pathao_consignment_id', 'VARCHAR(255) NULL');
CALL sp_add_col('orders', 'source_ad', 'VARCHAR(64) NULL');

CALL sp_create_idx('orders', 'idx_orders_pathao_consignment_id', '`pathao_consignment_id`');

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
  o.pathao_consignment_id AS pathaoConsignmentId,
  o.exchange_courier AS exchangeCourier,
  o.exchange_steadfast_consignment_id AS exchangeSteadfastConsignmentId,
  o.exchange_carrybee_consignment_id AS exchangeCarrybeeConsignmentId,
  o.exchange_paperfly_tracking_number AS exchangePaperflyTrackingNumber,
  o.exchange_pathao_consignment_id AS exchangePathaoConsignmentId,
  o.exchange_courier_history AS exchangeCourierHistory,
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
  COALESCE(we.payroll_payment_id, wp.payroll_payment_id) AS payrollPaymentId,
  wp.transaction_id AS transactionId,
  wp.account_id AS accountId,
  a.name AS accountName,
  wp.payment_method AS paymentMethod,
  wp.category_id AS categoryId,
  c.name AS categoryName,
  pp.compensation_type AS compensationType,
  pp.base_amount_snapshot AS baseAmountSnapshot,
  pp.bonus_amount AS bonusAmount,
  pp.deduction_amount AS deductionAmount,
  pp.amount_snapshot AS netAmount,
  pp.period_start AS periodStart,
  pp.period_end AS periodEnd,
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
LEFT JOIN payroll_payments pp ON pp.id = COALESCE(we.payroll_payment_id, wp.payroll_payment_id)
LEFT JOIN accounts a ON a.id = wp.account_id
LEFT JOIN categories c ON c.id = wp.category_id
LEFT JOIN users creator_user ON creator_user.id = we.created_by
LEFT JOIN users paid_by_user ON paid_by_user.id = wp.paid_by;

-- Migration: 2026-06-21_capabilities_subscriptions.sql
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

CALL sp_add_col('app_capability_settings', 'license_owner_token', 'VARCHAR(500) NULL');
CALL sp_add_col('app_capability_settings', 'tier_key', 'VARCHAR(64) NULL');
CALL sp_add_col('app_capability_settings', 'override_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('app_capability_settings', 'available_tiers', 'LONGTEXT NULL');
CALL sp_add_col('app_capability_settings', 'pricing_metadata', 'LONGTEXT NULL');

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

CALL sp_add_col('service_subscription_settings', 'plan_name', 'VARCHAR(255) NULL');
CALL sp_add_col('service_subscription_settings', 'billing_interval', 'VARCHAR(32) NULL');
CALL sp_add_col('service_subscription_settings', 'subscription_status', 'VARCHAR(64) NOT NULL DEFAULT ''unconfigured''');
CALL sp_add_col('service_subscription_settings', 'current_period_end', 'DATETIME NULL');

CALL sp_add_col('service_subscription_payments', 'local_reference', 'VARCHAR(255) NULL');
CALL sp_add_col('service_subscription_payments', 'gateway_payment_id', 'VARCHAR(255) NULL');
CALL sp_add_col('service_subscription_payments', 'gateway_name', 'VARCHAR(64) NULL');
CALL sp_add_col('service_subscription_payments', 'billing_interval', 'VARCHAR(32) NULL');
CALL sp_add_col('service_subscription_payments', 'invoice_url', 'VARCHAR(500) NULL');
CALL sp_add_col('service_subscription_payments', 'raw_payload', 'LONGTEXT NULL');

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

-- Migration: 2026-06-22_central_notifications.sql
SET NAMES utf8mb4;

SET time_zone = '+00:00';

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

CALL sp_add_col('notifications', 'system_key', 'VARCHAR(191) NULL');
CALL sp_add_col('notifications', 'action_config', 'LONGTEXT NULL');
CALL sp_add_col('notifications', 'metadata', 'LONGTEXT NULL');
CALL sp_add_col('notifications', 'is_system_generated', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('notifications', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

CALL sp_add_col('notification_receipts', 'action_result', 'VARCHAR(32) NULL');
CALL sp_add_col('notification_receipts', 'acted_at', 'DATETIME NULL');
CALL sp_add_col('notification_receipts', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

-- Migration: 2026-06-26_system_categories.sql
CALL sp_add_col('categories', 'is_system', 'BOOLEAN DEFAULT FALSE NOT NULL');

-- Skipped data-mutating statement from 2026-06-26_system_categories.sql.

-- Migration: 2026-07-02_meta_ads.sql
CREATE TABLE IF NOT EXISTS meta_ads_oauth_states (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  redirect_after VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_meta_ads_oauth_states_user (user_id),
  KEY idx_meta_ads_oauth_states_expires (expires_at),
  CONSTRAINT fk_meta_ads_oauth_states_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta_ads_connections (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  meta_user_id VARCHAR(64) DEFAULT NULL,
  meta_user_name VARCHAR(255) DEFAULT NULL,
  access_token TEXT NOT NULL,
  token_type VARCHAR(64) DEFAULT NULL,
  expires_at DATETIME DEFAULT NULL,
  scopes TEXT DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_synced_at DATETIME DEFAULT NULL,
  sync_error TEXT DEFAULT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_ads_connections_user_meta (user_id, meta_user_id),
  KEY idx_meta_ads_connections_user (user_id),
  CONSTRAINT fk_meta_ads_connections_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta_businesses (
  id VARCHAR(64) NOT NULL,
  connection_id VARCHAR(64) NOT NULL,
  meta_business_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  verification_status VARCHAR(64) DEFAULT NULL,
  raw_json JSON DEFAULT NULL,
  last_synced_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_businesses_meta_id (meta_business_id),
  KEY idx_meta_businesses_connection (connection_id),
  CONSTRAINT fk_meta_businesses_connection FOREIGN KEY (connection_id) REFERENCES meta_ads_connections (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta_ad_accounts (
  id VARCHAR(64) NOT NULL,
  connection_id VARCHAR(64) NOT NULL,
  business_id VARCHAR(64) DEFAULT NULL,
  meta_ad_account_id VARCHAR(64) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  currency VARCHAR(16) DEFAULT NULL,
  account_status VARCHAR(64) DEFAULT NULL,
  timezone_name VARCHAR(128) DEFAULT NULL,
  raw_json JSON DEFAULT NULL,
  last_synced_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_ad_accounts_meta_id (meta_ad_account_id),
  KEY idx_meta_ad_accounts_connection (connection_id),
  KEY idx_meta_ad_accounts_business (business_id),
  CONSTRAINT fk_meta_ad_accounts_connection FOREIGN KEY (connection_id) REFERENCES meta_ads_connections (id) ON DELETE CASCADE,
  CONSTRAINT fk_meta_ad_accounts_business FOREIGN KEY (business_id) REFERENCES meta_businesses (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta_campaigns (
  id VARCHAR(64) NOT NULL,
  ad_account_id VARCHAR(64) NOT NULL,
  business_id VARCHAR(64) DEFAULT NULL,
  meta_campaign_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  objective VARCHAR(128) DEFAULT NULL,
  status VARCHAR(64) DEFAULT NULL,
  effective_status VARCHAR(64) DEFAULT NULL,
  buying_type VARCHAR(64) DEFAULT NULL,
  start_time DATETIME DEFAULT NULL,
  stop_time DATETIME DEFAULT NULL,
  raw_json JSON DEFAULT NULL,
  last_synced_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_campaigns_meta_id (meta_campaign_id),
  KEY idx_meta_campaigns_account (ad_account_id),
  KEY idx_meta_campaigns_business (business_id),
  CONSTRAINT fk_meta_campaigns_account FOREIGN KEY (ad_account_id) REFERENCES meta_ad_accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_meta_campaigns_business FOREIGN KEY (business_id) REFERENCES meta_businesses (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta_ad_sets (
  id VARCHAR(64) NOT NULL,
  campaign_id VARCHAR(64) DEFAULT NULL,
  ad_account_id VARCHAR(64) NOT NULL,
  business_id VARCHAR(64) DEFAULT NULL,
  meta_ad_set_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(64) DEFAULT NULL,
  effective_status VARCHAR(64) DEFAULT NULL,
  daily_budget DECIMAL(14,2) DEFAULT NULL,
  lifetime_budget DECIMAL(14,2) DEFAULT NULL,
  start_time DATETIME DEFAULT NULL,
  end_time DATETIME DEFAULT NULL,
  raw_json JSON DEFAULT NULL,
  last_synced_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_ad_sets_meta_id (meta_ad_set_id),
  KEY idx_meta_ad_sets_campaign (campaign_id),
  KEY idx_meta_ad_sets_account (ad_account_id),
  KEY idx_meta_ad_sets_business (business_id),
  CONSTRAINT fk_meta_ad_sets_campaign FOREIGN KEY (campaign_id) REFERENCES meta_campaigns (id) ON DELETE SET NULL,
  CONSTRAINT fk_meta_ad_sets_account FOREIGN KEY (ad_account_id) REFERENCES meta_ad_accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_meta_ad_sets_business FOREIGN KEY (business_id) REFERENCES meta_businesses (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta_ads (
  id VARCHAR(64) NOT NULL,
  ad_set_id VARCHAR(64) DEFAULT NULL,
  campaign_id VARCHAR(64) DEFAULT NULL,
  ad_account_id VARCHAR(64) NOT NULL,
  business_id VARCHAR(64) DEFAULT NULL,
  meta_ad_id VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(64) DEFAULT NULL,
  effective_status VARCHAR(64) DEFAULT NULL,
  configured_status VARCHAR(64) DEFAULT NULL,
  objective VARCHAR(128) DEFAULT NULL,
  creative_id VARCHAR(64) DEFAULT NULL,
  thumbnail_url TEXT DEFAULT NULL,
  image_url TEXT DEFAULT NULL,
  video_url TEXT DEFAULT NULL,
  primary_text TEXT DEFAULT NULL,
  headline TEXT DEFAULT NULL,
  description TEXT DEFAULT NULL,
  call_to_action VARCHAR(128) DEFAULT NULL,
  placements_json JSON DEFAULT NULL,
  spend DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  reach BIGINT NOT NULL DEFAULT 0,
  impressions BIGINT NOT NULL DEFAULT 0,
  clicks BIGINT NOT NULL DEFAULT 0,
  ctr DECIMAL(12,6) NOT NULL DEFAULT 0.000000,
  cpc DECIMAL(14,6) NOT NULL DEFAULT 0.000000,
  cpm DECIMAL(14,6) NOT NULL DEFAULT 0.000000,
  conversions DECIMAL(14,2) DEFAULT NULL,
  results DECIMAL(14,2) DEFAULT NULL,
  roas DECIMAL(14,6) DEFAULT NULL,
  metrics_json JSON DEFAULT NULL,
  creative_json JSON DEFAULT NULL,
  raw_json JSON DEFAULT NULL,
  created_time DATETIME DEFAULT NULL,
  updated_time DATETIME DEFAULT NULL,
  start_time DATETIME DEFAULT NULL,
  end_time DATETIME DEFAULT NULL,
  last_synced_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_ads_meta_id (meta_ad_id),
  KEY idx_meta_ads_status (effective_status, status),
  KEY idx_meta_ads_updated_time (updated_time),
  KEY idx_meta_ads_ad_set (ad_set_id),
  KEY idx_meta_ads_campaign (campaign_id),
  KEY idx_meta_ads_account (ad_account_id),
  KEY idx_meta_ads_business (business_id),
  CONSTRAINT fk_meta_ads_ad_set FOREIGN KEY (ad_set_id) REFERENCES meta_ad_sets (id) ON DELETE SET NULL,
  CONSTRAINT fk_meta_ads_campaign FOREIGN KEY (campaign_id) REFERENCES meta_campaigns (id) ON DELETE SET NULL,
  CONSTRAINT fk_meta_ads_account FOREIGN KEY (ad_account_id) REFERENCES meta_ad_accounts (id) ON DELETE CASCADE,
  CONSTRAINT fk_meta_ads_business FOREIGN KEY (business_id) REFERENCES meta_businesses (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration: 2026-07-08_meta_ads_currency_insights.sql
-- Meta Ads: Display Currency Settings + Insights Cache
-- Adds currency display configuration to meta_ads_settings
-- Adds per-ad insights breakdown cache table

-- Settings table with currency fields (created if missing, or columns added if table exists)
CREATE TABLE IF NOT EXISTS meta_ads_settings (
  id VARCHAR(64) NOT NULL,
  app_id VARCHAR(255) DEFAULT NULL,
  app_secret VARCHAR(500) DEFAULT NULL,
  redirect_uri VARCHAR(500) DEFAULT NULL,
  login_config_id VARCHAR(255) DEFAULT NULL,
  graph_version VARCHAR(64) DEFAULT NULL,
  oauth_scopes VARCHAR(500) DEFAULT NULL,
  display_currency_code VARCHAR(8) DEFAULT 'BDT',
  display_currency_rate_to_bdt DECIMAL(14,4) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insights cache: stores daily, demographics, placements, devices breakdowns
CREATE TABLE IF NOT EXISTS meta_ads_insights_cache (
  id VARCHAR(36) PRIMARY KEY,
  ad_id VARCHAR(64) NOT NULL,
  category VARCHAR(32) NOT NULL,
  data_json LONGTEXT,
  last_synced_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_insights_ad_category (ad_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL sp_create_idx('meta_ads_insights_cache', 'idx_meta_ads_insights_cache_ad', 'ad_id');

-- Migration: 2026-07-08_meta_ads_sync_cache.sql
-- Meta Ads Sync Cache Table
-- Stores the last sync results to avoid repeated API calls

CREATE TABLE IF NOT EXISTS meta_ads_sync_cache (
    id VARCHAR(36) PRIMARY KEY,
    sync_data LONGTEXT,
    last_synced_at DATETIME,
    sync_duration_ms INT,
    error_message LONGTEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CALL sp_create_idx('meta_ads_sync_cache', 'idx_meta_ads_sync_cache_synced_at', 'last_synced_at DESC');

-- Migration: 2026-07-10_grow_your_business.sql
-- Grow Your Business: Recommendations cache + OpenRouter provider + Business Growth settings
-- Adds business_recommendations table for AI-generated product insights
-- Adds business_growth_settings table for dedicated AI config
-- Adds openrouter provider columns to agent_settings

CREATE TABLE IF NOT EXISTS business_recommendations (
  id VARCHAR(64) NOT NULL,
  recommendation_type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description LONGTEXT NOT NULL,
  badge_color VARCHAR(16) NOT NULL DEFAULT 'green',
  priority INT NOT NULL DEFAULT 0,
  product_ids_json LONGTEXT NULL,
  metadata_json LONGTEXT NULL,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_business_recommendations_type (recommendation_type),
  KEY idx_business_recommendations_priority (priority),
  KEY idx_business_recommendations_generated (generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_growth_settings (
  id VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'openai',
  openai_base_url VARCHAR(500) NULL,
  openai_api_key VARCHAR(500) NULL,
  openai_model VARCHAR(255) NULL,
  anthropic_base_url VARCHAR(500) NULL,
  anthropic_api_key VARCHAR(500) NULL,
  anthropic_model VARCHAR(255) NULL,
  google_base_url VARCHAR(500) NULL,
  google_api_key VARCHAR(500) NULL,
  google_model VARCHAR(255) NULL,
  openrouter_base_url VARCHAR(500) NULL,
  openrouter_api_key VARCHAR(500) NULL,
  openrouter_model VARCHAR(255) NULL,
  groq_base_url VARCHAR(500) NULL,
  groq_api_key VARCHAR(500) NULL,
  groq_model VARCHAR(255) NULL,
  recommendation_cache_hours INT NOT NULL DEFAULT 6,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL sp_add_col('agent_settings', 'openrouter_enabled', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('agent_settings', 'openrouter_base_url', 'VARCHAR(500) NULL');
CALL sp_add_col('agent_settings', 'openrouter_api_key', 'VARCHAR(500) NULL');
CALL sp_add_col('agent_settings', 'openrouter_model', 'VARCHAR(255) NULL');

-- Migration: 2026-07-11_exchange_consignment.sql
CALL sp_add_col('orders', 'exchange_courier', 'TEXT');
CALL sp_add_col('orders', 'exchange_steadfast_consignment_id', 'TEXT');
CALL sp_add_col('orders', 'exchange_carrybee_consignment_id', 'TEXT');
CALL sp_add_col('orders', 'exchange_paperfly_tracking_number', 'TEXT');
CALL sp_add_col('orders', 'exchange_courier_history', 'TEXT');

-- Migration: 2026-07-11_meta_ads_insights_daily.sql
-- Daily Meta ads insights for range-accurate marketing dashboard metrics.
CREATE TABLE IF NOT EXISTS meta_ads_insights_daily (
  id VARCHAR(64) NOT NULL,
  ad_id VARCHAR(64) NOT NULL,
  meta_ad_id VARCHAR(64) NOT NULL,
  insight_date DATE NOT NULL,
  spend DECIMAL(14,4) NOT NULL DEFAULT 0,
  impressions INT NOT NULL DEFAULT 0,
  reach INT NOT NULL DEFAULT 0,
  clicks INT NOT NULL DEFAULT 0,
  ctr DECIMAL(12,6) DEFAULT NULL,
  cpc DECIMAL(14,4) DEFAULT NULL,
  cpm DECIMAL(14,4) DEFAULT NULL,
  conversions DECIMAL(14,4) DEFAULT NULL,
  currency VARCHAR(16) DEFAULT NULL,
  synced_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_ads_insights_daily_ad_date (ad_id, insight_date),
  KEY idx_meta_ads_insights_daily_date (insight_date),
  KEY idx_meta_ads_insights_daily_meta_ad (meta_ad_id),
  KEY idx_meta_ads_insights_daily_ad_date (ad_id, insight_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration: 2026-07-11_meta_ads_settings_exchange_rate_mode.sql
CALL sp_add_col('meta_ads_settings', 'exchange_rate_mode', 'VARCHAR(16) NOT NULL DEFAULT ''fixed''');
CALL sp_add_col('meta_ads_settings', 'vat_percentage', 'DECIMAL(5,2) DEFAULT NULL');
CALL sp_add_col('meta_ads_settings', 'realtime_rate_cache', 'DECIMAL(14,4) DEFAULT NULL');
CALL sp_add_col('meta_ads_settings', 'realtime_rate_updated_at', 'DATETIME DEFAULT NULL');

-- Migration: 2026-07-11_order_bill_return_exchange.sql


-- Migration: 2026-07-20_auto_calling_system.sql
-- Auto Calling System (AwajDigital Voice Survey)
-- Adds voice survey columns to orders table and creates voice_survey_settings table.
-- Uses webhooks for survey result delivery (not polling).

-- Voice survey settings table
CREATE TABLE IF NOT EXISTS voice_survey_settings (
  id VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  delay_minutes INT NOT NULL DEFAULT 5,
  api_token TEXT NULL,
  sender VARCHAR(64) NULL,
  template_name VARCHAR(191) NULL,
  webhook_secret VARCHAR(255) NULL,
  max_survey_time_seconds INT NOT NULL DEFAULT 120,
  missed_call_retry_minutes INT NOT NULL DEFAULT 30,
  missed_call_retry_count INT NOT NULL DEFAULT 3,
  no_key_retry_minutes INT NOT NULL DEFAULT 10,
  no_key_retry_count INT NOT NULL DEFAULT 2,
  trigger_statuses TEXT NULL,
  cron_last_run DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL sp_add_col('voice_survey_settings', 'trigger_statuses', 'TEXT NULL');

CALL sp_add_col('orders', 'survey_id', 'VARCHAR(64) NULL');
CALL sp_add_col('orders', 'survey_status', 'VARCHAR(32) NULL DEFAULT NULL');
CALL sp_add_col('orders', 'survey_response', 'VARCHAR(16) NULL');
CALL sp_add_col('orders', 'survey_call_status', 'VARCHAR(32) NULL');
CALL sp_add_col('orders', 'confirmation_status', 'VARCHAR(32) NULL');
CALL sp_add_col('orders', 'survey_result_fetch_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'survey_next_retry_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'survey_retry_count', 'INT NOT NULL DEFAULT 0');
CALL sp_add_col('orders', 'survey_last_retry_reason', 'VARCHAR(32) NULL');
CALL sp_add_col('orders', 'survey_last_retry_at', 'DATETIME NULL');
CALL sp_add_col('orders', 'survey_triggered_at', 'DATETIME NULL');

CALL sp_create_idx('orders', 'idx_orders_survey_status', 'survey_status');

CALL sp_create_idx('orders', 'idx_orders_confirmation_status', 'confirmation_status');

CALL sp_create_idx('orders', 'idx_orders_survey_next_retry_at', 'survey_next_retry_at');

-- Migration: 2026-07-20_payment_email_hardening.sql
-- Payment confirmation email settings and auto-calling recharge audit trail.
-- This migration is additive and does not modify existing business rows.

CREATE TABLE IF NOT EXISTS email_settings (
  id VARCHAR(64) NOT NULL,
  recipient_email VARCHAR(255) NULL,
  smtp_host VARCHAR(255) NULL,
  smtp_port INT NOT NULL DEFAULT 587,
  smtp_username VARCHAR(255) NULL,
  smtp_password VARCHAR(500) NULL,
  smtp_encryption VARCHAR(16) NOT NULL DEFAULT 'tls',
  sender_email VARCHAR(255) NULL,
  sender_name VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auto_calling_recharges (
  id VARCHAR(64) NOT NULL,
  local_reference VARCHAR(64) NULL,
  gateway_payment_id VARCHAR(255) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status VARCHAR(32) NOT NULL DEFAULT 'processing',
  submitted_by VARCHAR(64) NULL,
  submitted_at DATETIME NULL,
  processed_at DATETIME NULL,
  raw_payload LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auto_calling_recharges_reference (local_reference),
  KEY idx_recharges_status (status),
  KEY idx_recharges_gateway_payment (gateway_payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL sp_add_col('auto_calling_recharges', 'raw_payload', 'LONGTEXT NULL');

CALL sp_create_idx('auto_calling_recharges', 'idx_recharges_gateway_payment', 'gateway_payment_id');

CREATE TABLE IF NOT EXISTS developer_notes (
  id VARCHAR(64) NOT NULL,
  content LONGTEXT NULL,
  updated_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration: 2026-07-20_product_units_fractional_pricing.sql
CALL sp_add_col('units', 'is_fraction', 'TINYINT(1) NOT NULL DEFAULT 0');

CALL sp_add_col('products', 'unit_id', 'VARCHAR(64) NULL');
CALL sp_add_col('products', 'dynamic_pricing', 'LONGTEXT NULL');

-- Migration: 2026-07-21_maintenance_content.sql
CALL sp_add_col('app_capability_settings', 'maintenance_image_url', 'VARCHAR(1000) NULL');
CALL sp_add_col('app_capability_settings', 'maintenance_caption', 'VARCHAR(500) NULL');
CALL sp_add_col('app_capability_settings', 'maintenance_subtitle', 'TEXT NULL');
CALL sp_add_col('app_capability_settings', 'maintenance_explanation', 'TEXT NULL');
CALL sp_add_col('app_capability_settings', 'maintenance_ends_at', 'DATETIME NULL');

-- Migration: 2026-07-21_meta_ads_metric_accuracy.sql
CALL sp_add_col('meta_ads_insights_daily', 'purchase_value', 'DECIMAL(16,4) NULL AFTER `conversions`');
CALL sp_add_col('meta_ads_insights_daily', 'purchase_roas', 'DECIMAL(14,6) NULL AFTER `purchase_value`');

-- Migration: 2026-07-21_meta_messenger_platform.sql
-- Meta Messenger Platform shared inbox for Facebook Page conversations.
-- Message transport remains with Meta; these tables retain webhook history and Page configuration.

CREATE TABLE IF NOT EXISTS messenger_settings (
  id VARCHAR(64) NOT NULL,
  page_access_token TEXT NULL,
  page_id VARCHAR(64) NULL,
  verify_token VARCHAR(255) NULL,
  app_secret VARCHAR(500) NULL,
  graph_version VARCHAR(16) NOT NULL DEFAULT 'v25.0',
  page_name VARCHAR(191) NULL,
  page_username VARCHAR(191) NULL,
  page_picture_url VARCHAR(1000) NULL,
  human_agent_enabled TINYINT(1) NOT NULL DEFAULT 0,
  subscribed TINYINT(1) NOT NULL DEFAULT 0,
  subscribed_fields LONGTEXT NULL,
  greeting VARCHAR(160) NULL,
  get_started_enabled TINYINT(1) NOT NULL DEFAULT 0,
  ice_breakers_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messenger_contacts (
  id VARCHAR(64) NOT NULL,
  psid VARCHAR(191) NOT NULL,
  name VARCHAR(191) NULL,
  first_name VARCHAR(100) NULL,
  last_name VARCHAR(100) NULL,
  profile_picture_url VARCHAR(1000) NULL,
  locale VARCHAR(32) NULL,
  unread_count INT NOT NULL DEFAULT 0,
  last_message_preview VARCHAR(500) NULL,
  last_message_type VARCHAR(32) NULL,
  last_message_at DATETIME NULL,
  last_user_message_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_messenger_contacts_psid (psid),
  KEY idx_messenger_contacts_last_message (last_message_at),
  KEY idx_messenger_contacts_unread (unread_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messenger_messages (
  id VARCHAR(64) NOT NULL,
  contact_id VARCHAR(64) NOT NULL,
  mid VARCHAR(255) NULL,
  direction VARCHAR(16) NOT NULL,
  message_type VARCHAR(32) NOT NULL DEFAULT 'text',
  message_text LONGTEXT NULL,
  attachment_url VARCHAR(1500) NULL,
  attachment_id VARCHAR(255) NULL,
  attachments_json LONGTEXT NULL,
  media_mime_type VARCHAR(127) NULL,
  file_name VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'received',
  error_code VARCHAR(64) NULL,
  error_message TEXT NULL,
  reply_to_mid VARCHAR(255) NULL,
  reaction VARCHAR(64) NULL,
  reaction_actor VARCHAR(16) NULL,
  quick_reply_payload VARCHAR(500) NULL,
  quick_replies_json LONGTEXT NULL,
  payload_json LONGTEXT NULL,
  message_at DATETIME NOT NULL,
  created_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_messenger_messages_mid (mid),
  KEY idx_messenger_messages_contact_time (contact_id, message_at),
  KEY idx_messenger_messages_status (status),
  CONSTRAINT fk_messenger_messages_contact FOREIGN KEY (contact_id) REFERENCES messenger_contacts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration: 2026-07-21_meta_whatsapp_cloud_api.sql
-- Meta WhatsApp Cloud API inbox.
-- Message transport comes from Meta; these tables retain webhook-delivered history for the inbox UI.

CREATE TABLE IF NOT EXISTS whatsapp_settings (
  id VARCHAR(64) NOT NULL,
  access_token TEXT NULL,
  phone_number_id VARCHAR(64) NULL,
  business_account_id VARCHAR(64) NULL,
  verify_token VARCHAR(255) NULL,
  app_secret VARCHAR(500) NULL,
  graph_version VARCHAR(16) NOT NULL DEFAULT 'v25.0',
  display_phone_number VARCHAR(64) NULL,
  verified_name VARCHAR(191) NULL,
  quality_rating VARCHAR(32) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id VARCHAR(64) NOT NULL,
  wa_id VARCHAR(32) NOT NULL,
  phone_number VARCHAR(32) NOT NULL,
  name VARCHAR(191) NULL,
  profile_name VARCHAR(191) NULL,
  unread_count INT NOT NULL DEFAULT 0,
  last_message_preview VARCHAR(500) NULL,
  last_message_type VARCHAR(32) NULL,
  last_message_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_contacts_wa_id (wa_id),
  KEY idx_whatsapp_contacts_last_message_at (last_message_at),
  KEY idx_whatsapp_contacts_unread (unread_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id VARCHAR(64) NOT NULL,
  contact_id VARCHAR(64) NOT NULL,
  wa_message_id VARCHAR(255) NULL,
  direction VARCHAR(16) NOT NULL,
  message_type VARCHAR(32) NOT NULL DEFAULT 'text',
  message_text LONGTEXT NULL,
  caption TEXT NULL,
  media_id VARCHAR(255) NULL,
  media_url VARCHAR(500) NULL,
  media_mime_type VARCHAR(127) NULL,
  file_name VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'received',
  error_code VARCHAR(64) NULL,
  error_message TEXT NULL,
  reply_to_message_id VARCHAR(255) NULL,
  payload_json LONGTEXT NULL,
  message_at DATETIME NOT NULL,
  created_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_messages_wa_message_id (wa_message_id),
  KEY idx_whatsapp_messages_contact_time (contact_id, message_at),
  KEY idx_whatsapp_messages_status (status),
  CONSTRAINT fk_whatsapp_messages_contact FOREIGN KEY (contact_id) REFERENCES whatsapp_contacts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration: 2026-07-21_whatsapp_welcome_experience.sql
CALL sp_add_col('whatsapp_settings', 'welcome_message', 'TEXT NULL AFTER quality_rating');
CALL sp_add_col('whatsapp_settings', 'get_started_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER welcome_message');
CALL sp_add_col('whatsapp_settings', 'ice_breakers_json', 'LONGTEXT NULL AFTER get_started_enabled');

CALL sp_add_col('whatsapp_contacts', 'welcome_sent_at', 'DATETIME NULL AFTER last_message_at');

CALL sp_create_idx('whatsapp_contacts', 'idx_whatsapp_contacts_welcome_sent', 'welcome_sent_at');

-- Migration: 2026-07-21_woocommerce_integration.sql
CALL sp_add_col('users', 'is_system', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER role');

CREATE TABLE IF NOT EXISTS woocommerce_stores (
  id VARCHAR(64) NOT NULL,
  store_name VARCHAR(191) NOT NULL,
  store_url VARCHAR(500) NOT NULL,
  consumer_key VARCHAR(255) NULL,
  consumer_secret VARCHAR(255) NULL,
  webhook_secret VARCHAR(255) NULL,
  webhook_base_url VARCHAR(1000) NULL,
  webhook_id BIGINT NULL,
  company_page_id VARCHAR(64) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_synced_at DATETIME NULL,
  last_sync_status VARCHAR(32) NULL,
  last_sync_message VARCHAR(1000) NULL,
  orders_synced INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_woocommerce_stores_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL sp_add_col('woocommerce_stores', 'webhook_base_url', 'VARCHAR(1000) NULL AFTER webhook_secret');

CREATE TABLE IF NOT EXISTS woocommerce_order_links (
  id VARCHAR(64) NOT NULL,
  store_id VARCHAR(64) NOT NULL,
  wc_order_id BIGINT NOT NULL,
  wc_order_number VARCHAR(64) NULL,
  order_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'imported',
  message VARCHAR(1000) NULL,
  payload_hash VARCHAR(64) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wc_order_links_store_order (store_id, wc_order_id),
  KEY idx_wc_order_links_store_created (store_id, created_at),
  CONSTRAINT fk_wc_order_links_store FOREIGN KEY (store_id) REFERENCES woocommerce_stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS woocommerce_product_links (
  id VARCHAR(64) NOT NULL,
  store_id VARCHAR(64) NOT NULL,
  wc_product_id BIGINT NOT NULL,
  wc_variation_id BIGINT NOT NULL DEFAULT 0,
  sku VARCHAR(191) NULL,
  product_id VARCHAR(64) NOT NULL,
  auto_created TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_wc_product_links_remote (store_id, wc_product_id, wc_variation_id),
  KEY idx_wc_product_links_product (product_id),
  CONSTRAINT fk_wc_product_links_store FOREIGN KEY (store_id) REFERENCES woocommerce_stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_wc_product_links_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration: 2026-07-22_auto_calling_runtime_repair.sql
CALL sp_add_col('voice_survey_settings', 'webhook_url', 'VARCHAR(1000) NULL AFTER webhook_secret');

CREATE TABLE IF NOT EXISTS voice_survey_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id VARCHAR(64) NOT NULL,
  survey_id VARCHAR(64) NULL,
  event_type VARCHAR(32) NOT NULL,
  call_status VARCHAR(32) NULL,
  response VARCHAR(32) NULL,
  details TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_voice_survey_events_order_created (order_id, created_at),
  KEY idx_voice_survey_events_survey_id (survey_id),
  CONSTRAINT fk_voice_survey_events_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration: 2026-07-22_be_smart_llm_settings.sql
-- Central LLM profiles, per-feature model assignments, and Be smart controls.

CREATE TABLE IF NOT EXISTS llm_configurations (
  id VARCHAR(64) NOT NULL,
  label VARCHAR(191) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  base_url VARCHAR(500) NULL,
  api_key TEXT NULL,
  model VARCHAR(255) NOT NULL,
  organization VARCHAR(255) NULL,
  project VARCHAR(255) NULL,
  site_url VARCHAR(500) NULL,
  app_name VARCHAR(255) NULL,
  anthropic_version VARCHAR(32) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_llm_configurations_provider_enabled (provider, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS llm_feature_assignments (
  feature_key VARCHAR(64) NOT NULL,
  configuration_id VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (feature_key),
  KEY idx_llm_feature_assignments_configuration (configuration_id),
  CONSTRAINT fk_llm_feature_assignments_configuration
    FOREIGN KEY (configuration_id) REFERENCES llm_configurations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS be_smart_settings (
  id VARCHAR(64) NOT NULL,
  smart_customer_adding TINYINT(1) NOT NULL DEFAULT 0,
  smart_vendor_adding TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration: 2026-07-23_auto_calling_worker_health.sql
CALL sp_add_col('voice_survey_settings', 'cron_last_success_at', 'DATETIME NULL AFTER cron_last_run');
CALL sp_add_col('voice_survey_settings', 'cron_last_error', 'TEXT NULL AFTER cron_last_success_at');
CALL sp_add_col('voice_survey_settings', 'cron_last_processed_count', 'INT NOT NULL DEFAULT 0 AFTER cron_last_error');

-- Migration: 2026-07-23_lead_intelligence.sql
-- Lead intelligence, multimodal model profiles, analysis history, and realtime events.

CREATE TABLE IF NOT EXISTS multimodal_llm_configurations (
  id VARCHAR(64) NOT NULL,
  label VARCHAR(191) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  base_url VARCHAR(500) NULL,
  api_key TEXT NULL,
  model VARCHAR(255) NOT NULL,
  organization VARCHAR(255) NULL,
  project VARCHAR(255) NULL,
  site_url VARCHAR(500) NULL,
  app_name VARCHAR(255) NULL,
  anthropic_version VARCHAR(32) NULL,
  system_prompt LONGTEXT NULL,
  temperature DECIMAL(5,3) NOT NULL DEFAULT 0.100,
  max_tokens INT NOT NULL DEFAULT 4096,
  supports_vision TINYINT(1) NOT NULL DEFAULT 1,
  supports_audio TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_multimodal_llm_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS multimodal_llm_assignments (
  id VARCHAR(32) NOT NULL,
  configuration_id VARCHAR(64) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_multimodal_assignment_configuration FOREIGN KEY (configuration_id) REFERENCES multimodal_llm_configurations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_profiles (
  id VARCHAR(64) NOT NULL,
  source_channel VARCHAR(32) NOT NULL,
  messenger_contact_id VARCHAR(64) NULL,
  whatsapp_contact_id VARCHAR(64) NULL,
  assigned_model_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'new',
  stage VARCHAR(32) NOT NULL DEFAULT 'new',
  score DECIMAL(5,2) NOT NULL DEFAULT 0,
  order_probability DECIMAL(5,2) NOT NULL DEFAULT 0,
  profile_json LONGTEXT NOT NULL,
  last_analyzed_message_id VARCHAR(255) NULL,
  last_message_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lead_messenger_contact (messenger_contact_id),
  UNIQUE KEY uq_lead_whatsapp_contact (whatsapp_contact_id),
  KEY idx_leads_updated (updated_at),
  KEY idx_leads_status_score (status, score),
  CONSTRAINT fk_lead_model FOREIGN KEY (assigned_model_id) REFERENCES multimodal_llm_configurations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_analysis_runs (
  id VARCHAR(64) NOT NULL,
  lead_id VARCHAR(64) NOT NULL,
  trigger_message_id VARCHAR(255) NULL,
  model_id VARCHAR(64) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'queued',
  result_json LONGTEXT NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_lead_runs_lead_time (lead_id, created_at),
  CONSTRAINT fk_lead_runs_lead FOREIGN KEY (lead_id) REFERENCES lead_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_suggestions (
  id VARCHAR(64) NOT NULL,
  lead_id VARCHAR(64) NOT NULL,
  analysis_run_id VARCHAR(64) NULL,
  suggestion_type VARCHAR(32) NOT NULL,
  text LONGTEXT NOT NULL,
  reason TEXT NULL,
  confidence DECIMAL(5,2) NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'available',
  sent_message_id VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lead_suggestions_lead_status (lead_id, status, created_at),
  CONSTRAINT fk_lead_suggestions_lead FOREIGN KEY (lead_id) REFERENCES lead_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lead_events_cursor (id),
  KEY idx_lead_events_lead (lead_id, id),
  CONSTRAINT fk_lead_events_lead FOREIGN KEY (lead_id) REFERENCES lead_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration: 2026-07-24_mame_ai_agent_runtime.sql
CALL sp_add_col('llm_configurations', 'supports_tool_calling', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('llm_configurations', 'supports_structured_output', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('llm_configurations', 'supports_vision', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('llm_configurations', 'supports_audio', 'TINYINT(1) NOT NULL DEFAULT 0');
CALL sp_add_col('llm_configurations', 'context_window_tokens', 'INT NOT NULL DEFAULT 32768');
CALL sp_add_col('llm_configurations', 'default_output_tokens', 'INT NOT NULL DEFAULT 4096');

CALL sp_add_col('agent_settings', 'query_max_columns', 'INT NOT NULL DEFAULT 30');
CALL sp_add_col('agent_settings', 'query_max_bytes', 'INT NOT NULL DEFAULT 100000');
CALL sp_add_col('agent_settings', 'run_timeout_seconds', 'INT NOT NULL DEFAULT 240');
CALL sp_add_col('agent_settings', 'context_budget_tokens', 'INT NOT NULL DEFAULT 12000');
CALL sp_add_col('agent_settings', 'max_output_tokens', 'INT NOT NULL DEFAULT 4096');
CALL sp_add_col('agent_settings', 'retry_limit', 'INT NOT NULL DEFAULT 2');
CALL sp_add_col('agent_settings', 'confirmation_expiry_minutes', 'INT NOT NULL DEFAULT 15');
CALL sp_add_col('agent_settings', 'lease_seconds', 'INT NOT NULL DEFAULT 90');
CALL sp_add_col('agent_settings', 'worker_last_heartbeat', 'DATETIME NULL');
CALL sp_add_col('agent_settings', 'worker_last_success_at', 'DATETIME NULL');
CALL sp_add_col('agent_settings', 'worker_last_error_at', 'DATETIME NULL');
CALL sp_add_col('agent_settings', 'worker_last_error', 'TEXT NULL');

CALL sp_add_col('agent_conversations', 'summary', 'LONGTEXT NULL');
CALL sp_add_col('agent_conversations', 'summary_boundary_message_id', 'VARCHAR(64) NULL');
CALL sp_add_col('agent_conversations', 'summary_updated_at', 'DATETIME NULL');

CALL sp_add_col('agent_runs', 'active_conversation_key', 'VARCHAR(64) NULL');
CALL sp_add_col('agent_runs', 'route', 'VARCHAR(32) NULL');
CALL sp_add_col('agent_runs', 'routed_domains_json', 'LONGTEXT NULL');
CALL sp_add_col('agent_runs', 'fast_configuration_id', 'VARCHAR(64) NULL');
CALL sp_add_col('agent_runs', 'reasoning_configuration_id', 'VARCHAR(64) NULL');
CALL sp_add_col('agent_runs', 'multimodal_configuration_id', 'VARCHAR(64) NULL');
CALL sp_add_col('agent_runs', 'worker_id', 'VARCHAR(191) NULL');
CALL sp_add_col('agent_runs', 'lease_expires_at', 'DATETIME NULL');
CALL sp_add_col('agent_runs', 'heartbeat_at', 'DATETIME NULL');
CALL sp_add_col('agent_runs', 'attempts', 'INT NOT NULL DEFAULT 0');
CALL sp_add_col('agent_runs', 'cancellation_requested_at', 'DATETIME NULL');
CALL sp_add_col('agent_runs', 'cancellation_reason', 'TEXT NULL');
CALL sp_add_col('agent_runs', 'current_activity', 'VARCHAR(500) NULL');
CALL sp_add_col('agent_runs', 'tool_call_count', 'INT NOT NULL DEFAULT 0');
CALL sp_add_col('agent_runs', 'model_call_count', 'INT NOT NULL DEFAULT 0');
CALL sp_add_col('agent_runs', 'input_tokens', 'BIGINT NOT NULL DEFAULT 0');
CALL sp_add_col('agent_runs', 'output_tokens', 'BIGINT NOT NULL DEFAULT 0');
CALL sp_add_col('agent_runs', 'event_sequence', 'INT NOT NULL DEFAULT 0');
CALL sp_add_col('agent_runs', 'attachment_ids_json', 'LONGTEXT NULL');
CALL sp_add_col('agent_runs', 'resume_payload_json', 'LONGTEXT NULL');
CALL sp_create_unique_idx('agent_runs', 'uq_agent_runs_active_conversation', '`active_conversation_key`');
CALL sp_create_idx('agent_runs', 'idx_agent_runs_queue_lease', '`status`, `lease_expires_at`, `created_at`');
CALL sp_create_idx('agent_runs', 'idx_agent_runs_worker', '`worker_id`, `lease_expires_at`');

-- Skipped data-mutating statement from 2026-07-24_mame_ai_agent_runtime.sql.

CALL sp_add_col('agent_messages', 'attachment_ids_json', 'LONGTEXT NULL');
CALL sp_add_col('agent_messages', 'structured_reference_json', 'LONGTEXT NULL');

CALL sp_add_col('agent_tool_calls', 'provider_call_id', 'VARCHAR(191) NULL');
CALL sp_add_col('agent_tool_calls', 'tool_version', 'VARCHAR(32) NOT NULL DEFAULT ''1.0.0''');
CALL sp_add_col('agent_tool_calls', 'risk_class', 'VARCHAR(32) NOT NULL DEFAULT ''read''');
CALL sp_add_col('agent_tool_calls', 'error_message', 'TEXT NULL');
CALL sp_add_col('agent_tool_calls', 'confirmation_bundle_id', 'VARCHAR(64) NULL');
CALL sp_add_col('agent_tool_calls', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
CALL sp_create_unique_idx('agent_tool_calls', 'uq_agent_tool_calls_provider_id', '`run_id`, `provider_call_id`');
CALL sp_create_idx('agent_tool_calls', 'idx_agent_tool_calls_status', '`run_id`, `status`');

CALL sp_create_unique_idx('agent_run_events', 'uq_agent_run_events_sequence', '`run_id`, `sequence_no`');
CALL sp_create_idx('agent_run_events', 'idx_agent_run_events_cursor', '`run_id`, `sequence_no`, `created_at`');

CALL sp_add_col('agent_db_query_audit', 'allowed_datasets_json', 'LONGTEXT NULL');
CALL sp_add_col('agent_db_query_audit', 'returned_columns_json', 'LONGTEXT NULL');
CALL sp_add_col('agent_db_query_audit', 'decision', 'VARCHAR(32) NOT NULL DEFAULT ''allowed''');
CALL sp_add_col('agent_db_query_audit', 'error_message', 'TEXT NULL');

CREATE TABLE IF NOT EXISTS agent_action_bundles (
  id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  immutable_hash CHAR(64) NOT NULL,
  confirmation_token_hash CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  expires_at DATETIME NOT NULL,
  confirmed_by VARCHAR(64) NULL,
  confirmed_at DATETIME NULL,
  rejected_at DATETIME NULL,
  rejection_reason TEXT NULL,
  execution_started_at DATETIME NULL,
  execution_finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_action_bundles_run (run_id, created_at),
  KEY idx_agent_action_bundles_user_status (user_id, status, expires_at),
  CONSTRAINT fk_agent_action_bundles_run FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_action_bundles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_action_bundles_confirmer FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_action_items (
  id VARCHAR(64) NOT NULL,
  bundle_id VARCHAR(64) NOT NULL,
  position_no INT NOT NULL,
  tool_name VARCHAR(191) NOT NULL,
  tool_version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  dependencies_json LONGTEXT NULL,
  input_json LONGTEXT NOT NULL,
  preview_json LONGTEXT NULL,
  idempotency_key CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  result_json LONGTEXT NULL,
  error_message TEXT NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_action_items_position (bundle_id, position_no),
  UNIQUE KEY uq_agent_action_items_idempotency (idempotency_key),
  KEY idx_agent_action_items_status (bundle_id, status),
  CONSTRAINT fk_agent_action_items_bundle FOREIGN KEY (bundle_id) REFERENCES agent_action_bundles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_attachments (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(1000) NOT NULL,
  mime_type VARCHAR(191) NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256_hash CHAR(64) NOT NULL,
  retention_state VARCHAR(32) NOT NULL DEFAULT 'active',
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_attachments_user (user_id, retention_state, created_at),
  CONSTRAINT fk_agent_attachments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_model_calls (
  id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  phase VARCHAR(64) NOT NULL,
  profile_id VARCHAR(64) NULL,
  provider VARCHAR(32) NULL,
  model VARCHAR(255) NULL,
  provider_request_id VARCHAR(255) NULL,
  finish_reason VARCHAR(64) NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  duration_ms INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_model_calls_run (run_id, created_at),
  KEY idx_agent_model_calls_profile (profile_id, created_at),
  CONSTRAINT fk_agent_model_calls_run FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration: 2026-07-24_order_status_undo_journal.sql
CREATE TABLE IF NOT EXISTS order_status_undo_events (
  id VARCHAR(64) NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  order_number VARCHAR(100) NOT NULL,
  from_status VARCHAR(32) NOT NULL,
  to_status VARCHAR(32) NOT NULL,
  source_action VARCHAR(64) NOT NULL,
  before_snapshot LONGTEXT NOT NULL,
  after_snapshot LONGTEXT NOT NULL,
  transaction_ids LONGTEXT NULL,
  wallet_entry_ids LONGTEXT NULL,
  stock_deltas LONGTEXT NULL,
  created_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  undone_at DATETIME NULL,
  undone_by VARCHAR(64) NULL,
  undo_batch_id VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY idx_order_status_undo_events_order_active (order_id, undone_at, created_at),
  KEY idx_order_status_undo_events_batch (undo_batch_id),
  CONSTRAINT fk_order_status_undo_events_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_status_undo_events_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT fk_order_status_undo_events_undone_by FOREIGN KEY (undone_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migration: 2026-07-25_order_status_canonicalization.sql
-- Skipped data-mutating statement from 2026-07-25_order_status_canonicalization.sql.

-- Skipped data-mutating statement from 2026-07-25_order_status_canonicalization.sql.

-- Skipped data-mutating statement from 2026-07-25_order_status_canonicalization.sql.

-- Skipped data-mutating statement from 2026-07-25_order_status_canonicalization.sql.

-- Skipped data-mutating statement from 2026-07-25_order_status_canonicalization.sql.

-- Skipped data-mutating statement from 2026-07-25_order_status_canonicalization.sql.

DROP PROCEDURE IF EXISTS sp_add_col;
DROP PROCEDURE IF EXISTS sp_create_idx;
DROP PROCEDURE IF EXISTS sp_create_unique_idx;
DROP PROCEDURE IF EXISTS sp_drop_idx;
