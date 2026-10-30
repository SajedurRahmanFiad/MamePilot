-- Add percentage wallet credits and sofa-cover delivery person payroll.
ALTER TABLE `payroll_settings`
  ADD COLUMN IF NOT EXISTS `unit_amount_type` VARCHAR(16) NOT NULL DEFAULT 'amount';

CREATE TABLE IF NOT EXISTS delivery_person_payments (
  id VARCHAR(64) NOT NULL,
  delivery_person_id VARCHAR(64) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  period_kind VARCHAR(16) NOT NULL,
  period_label VARCHAR(255) NOT NULL,
  order_count_snapshot INT NOT NULL DEFAULT 0,
  base_amount_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  bonus_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  deduction_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  amount_snapshot DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  is_partial TINYINT(1) NOT NULL DEFAULT 0,
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
  KEY idx_delivery_person_payments_person_period (delivery_person_id, period_start, period_end),
  KEY idx_delivery_person_payments_paid_at (paid_at),
  UNIQUE KEY uq_delivery_person_payments_transaction (transaction_id),
  CONSTRAINT fk_delivery_person_payments_person FOREIGN KEY (delivery_person_id) REFERENCES delivery_persons (id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_person_payments_transaction FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE SET NULL,
  CONSTRAINT fk_delivery_person_payments_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_person_payments_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_person_payments_paid_by FOREIGN KEY (paid_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
