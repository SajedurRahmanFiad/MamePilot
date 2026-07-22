-- WooCommerce order sync integration.
-- Multiple WooCommerce stores can be connected; each maps to a company page for
-- invoice branding. Orders arrive via signed webhooks (or manual REST sync) and
-- are recorded in woocommerce_order_links for idempotency and activity history.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_system TINYINT(1) NOT NULL DEFAULT 0 AFTER role;

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

ALTER TABLE woocommerce_stores ADD COLUMN IF NOT EXISTS webhook_base_url VARCHAR(1000) NULL AFTER webhook_secret;

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
