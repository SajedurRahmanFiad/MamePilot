-- Record one idempotent purchase-price COGS calculation per order.
CREATE TABLE IF NOT EXISTS order_cogs_expenses (
  id VARCHAR(64) NOT NULL,
  order_id VARCHAR(64) NOT NULL,
  transaction_id VARCHAR(64) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status VARCHAR(32) NOT NULL DEFAULT 'recorded',
  breakdown LONGTEXT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'automatic',
  created_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_order_cogs_expenses_order (order_id),
  UNIQUE KEY uq_order_cogs_expenses_transaction (transaction_id),
  KEY idx_order_cogs_expenses_status (status),
  CONSTRAINT fk_order_cogs_expenses_order FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE,
  CONSTRAINT fk_order_cogs_expenses_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE SET NULL,
  CONSTRAINT fk_order_cogs_expenses_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO categories (id, name, type, color, is_system)
VALUES ('expense_purchases', 'Purchases', 'Expense', '#EF4444', TRUE)
ON DUPLICATE KEY UPDATE is_system = TRUE;

CALL sp_add_col('system_defaults', 'calculate_cogs_from_purchase_price', 'TINYINT(1) NOT NULL DEFAULT 0');
