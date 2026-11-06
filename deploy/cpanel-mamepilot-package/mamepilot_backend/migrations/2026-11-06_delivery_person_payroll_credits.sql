-- Add auditable, transaction-free delivery person payroll credits.
CALL sp_add_col('delivery_person_payments', 'credit_amount_snapshot', 'DECIMAL(12,2) NOT NULL DEFAULT 0.00');

CREATE TABLE IF NOT EXISTS delivery_person_payroll_credits (
  id VARCHAR(64) NOT NULL,
  delivery_person_id VARCHAR(64) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  note TEXT NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_delivery_person_payroll_credits_person_created (delivery_person_id, created_at),
  KEY idx_delivery_person_payroll_credits_created_by (created_by),
  CONSTRAINT fk_delivery_person_payroll_credits_person FOREIGN KEY (delivery_person_id) REFERENCES delivery_persons (id) ON DELETE CASCADE,
  CONSTRAINT fk_delivery_person_payroll_credits_created_by FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
