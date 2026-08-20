-- WooCommerce product import: catalog sync with variation-aware product
-- creation. Every product and variation becomes its own local product row
-- (for example "T-shirt (Red)" and "T-shirt (Blue)") using the variation
-- image and SKU (the product slug when no SKU exists).

ALTER TABLE woocommerce_stores ADD COLUMN IF NOT EXISTS products_synced INT NOT NULL DEFAULT 0 AFTER orders_synced;
ALTER TABLE woocommerce_stores ADD COLUMN IF NOT EXISTS last_products_synced_at DATETIME NULL AFTER products_synced;