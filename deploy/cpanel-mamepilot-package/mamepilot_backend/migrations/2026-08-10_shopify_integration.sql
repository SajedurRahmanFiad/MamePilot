-- Shopify Admin GraphQL integration, SKU-based product matching, phone-based
-- customer matching, persistent webhook delivery, and order deduplication.

ALTER TABLE products ADD COLUMN IF NOT EXISTS sku VARCHAR(191) NULL AFTER slug;
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_sku ON products (sku);

CREATE TABLE IF NOT EXISTS shopify_stores (
  id VARCHAR(64) NOT NULL,
  store_name VARCHAR(191) NOT NULL,
  store_url VARCHAR(500) NOT NULL,
  access_token VARCHAR(255) NULL,
  api_secret VARCHAR(255) NULL,
  webhook_secret VARCHAR(255) NULL,
  webhook_base_url VARCHAR(1000) NULL,
  webhook_id VARCHAR(255) NULL,
  company_page_id VARCHAR(64) NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  last_synced_at DATETIME NULL,
  last_products_synced_at DATETIME NULL,
  last_orders_synced_at DATETIME NULL,
  last_sync_status VARCHAR(32) NULL,
  last_sync_message VARCHAR(1000) NULL,
  products_synced INT NOT NULL DEFAULT 0,
  orders_synced INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_shopify_stores_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shopify_order_links (
  id VARCHAR(64) NOT NULL,
  store_id VARCHAR(64) NOT NULL,
  shopify_order_id VARCHAR(255) NOT NULL,
  shopify_order_number VARCHAR(64) NULL,
  dedupe_key VARCHAR(191) NULL,
  order_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'imported',
  message VARCHAR(1000) NULL,
  payload_hash VARCHAR(64) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shopify_order_links_store_order (store_id, shopify_order_id),
  UNIQUE KEY uq_shopify_order_links_store_dedupe (store_id, dedupe_key),
  KEY idx_shopify_order_links_store_created (store_id, created_at),
  CONSTRAINT fk_shopify_order_links_store FOREIGN KEY (store_id) REFERENCES shopify_stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shopify_product_links (
  id VARCHAR(64) NOT NULL,
  store_id VARCHAR(64) NOT NULL,
  shopify_product_id VARCHAR(255) NOT NULL,
  shopify_variant_id VARCHAR(255) NOT NULL DEFAULT '0',
  sku VARCHAR(191) NULL,
  product_id VARCHAR(64) NOT NULL,
  auto_created TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shopify_product_links_remote (store_id, shopify_product_id, shopify_variant_id),
  KEY idx_shopify_product_links_product (product_id),
  CONSTRAINT fk_shopify_product_links_store FOREIGN KEY (store_id) REFERENCES shopify_stores(id) ON DELETE CASCADE,
  CONSTRAINT fk_shopify_product_links_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE shopify_stores ADD COLUMN IF NOT EXISTS api_secret VARCHAR(255) NULL AFTER access_token;
ALTER TABLE shopify_stores MODIFY COLUMN webhook_id VARCHAR(255) NULL;
ALTER TABLE shopify_stores ADD COLUMN IF NOT EXISTS last_products_synced_at DATETIME NULL AFTER last_synced_at;
ALTER TABLE shopify_stores ADD COLUMN IF NOT EXISTS last_orders_synced_at DATETIME NULL AFTER last_products_synced_at;
ALTER TABLE shopify_stores ADD COLUMN IF NOT EXISTS products_synced INT NOT NULL DEFAULT 0 AFTER last_sync_message;

ALTER TABLE shopify_order_links MODIFY COLUMN shopify_order_id VARCHAR(255) NOT NULL;
ALTER TABLE shopify_order_links ADD COLUMN IF NOT EXISTS dedupe_key VARCHAR(191) NULL AFTER shopify_order_number;
CREATE UNIQUE INDEX IF NOT EXISTS uq_shopify_order_links_store_dedupe ON shopify_order_links (store_id, dedupe_key);

ALTER TABLE shopify_product_links MODIFY COLUMN shopify_product_id VARCHAR(255) NOT NULL;
ALTER TABLE shopify_product_links MODIFY COLUMN shopify_variant_id VARCHAR(255) NOT NULL DEFAULT '0';

CREATE TABLE IF NOT EXISTS shopify_webhook_subscriptions (
  id VARCHAR(64) NOT NULL,
  store_id VARCHAR(64) NOT NULL,
  topic VARCHAR(64) NOT NULL,
  remote_id VARCHAR(255) NOT NULL,
  uri VARCHAR(1000) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shopify_webhook_subscriptions_store_topic (store_id, topic),
  UNIQUE KEY uq_shopify_webhook_subscriptions_remote (store_id, remote_id),
  KEY idx_shopify_webhook_subscriptions_store (store_id),
  CONSTRAINT fk_shopify_webhook_subscriptions_store FOREIGN KEY (store_id) REFERENCES shopify_stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shopify_webhook_events (
  id VARCHAR(64) NOT NULL,
  store_id VARCHAR(64) NOT NULL,
  webhook_id VARCHAR(255) NOT NULL,
  event_id VARCHAR(255) NULL,
  topic VARCHAR(64) NOT NULL,
  resource_id VARCHAR(255) NULL,
  payload_hash VARCHAR(64) NOT NULL,
  payload LONGTEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'processing',
  message VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shopify_webhook_events_store_webhook (store_id, webhook_id),
  KEY idx_shopify_webhook_events_status_created (status, created_at),
  CONSTRAINT fk_shopify_webhook_events_store FOREIGN KEY (store_id) REFERENCES shopify_stores(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
