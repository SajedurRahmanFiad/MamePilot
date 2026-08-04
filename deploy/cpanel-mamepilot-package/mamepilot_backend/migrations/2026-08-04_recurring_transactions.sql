-- Independent recurring transaction schedules and idempotent generated occurrences.

CREATE TABLE IF NOT EXISTS recurring_transactions (
  id VARCHAR(64) NOT NULL,
  type VARCHAR(16) NOT NULL,
  account_id VARCHAR(64) NOT NULL,
  category_id VARCHAR(64) NOT NULL,
  payment_method VARCHAR(191) NOT NULL,
  amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  note TEXT NULL,
  recurrence_interval VARCHAR(16) NOT NULL,
  start_at DATETIME NOT NULL,
  next_run_at DATETIME NOT NULL,
  next_attempt_at DATETIME NULL,
  last_run_at DATETIME NULL,
  last_transaction_id VARCHAR(64) NULL,
  run_count INT UNSIGNED NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_error TEXT NULL,
  last_error_at DATETIME NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_recurring_transactions_due (is_active, next_run_at, next_attempt_at),
  KEY idx_recurring_transactions_account (account_id),
  KEY idx_recurring_transactions_category (category_id),
  KEY idx_recurring_transactions_creator (created_by),
  CONSTRAINT fk_recurring_transactions_account FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE RESTRICT,
  CONSTRAINT fk_recurring_transactions_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE RESTRICT,
  CONSTRAINT fk_recurring_transactions_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recurring_transaction_worker_state (
  id TINYINT UNSIGNED NOT NULL,
  worker_started_at DATETIME NULL,
  worker_heartbeat_at DATETIME NULL,
  worker_last_success_at DATETIME NULL,
  worker_last_error_at DATETIME NULL,
  worker_last_error TEXT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE transactions
  ADD COLUMN recurring_transaction_id VARCHAR(64) NULL AFTER reference_id,
  ADD COLUMN recurring_scheduled_for DATETIME NULL AFTER recurring_transaction_id,
  ADD UNIQUE KEY uq_transactions_recurring_occurrence (recurring_transaction_id, recurring_scheduled_for),
  ADD KEY idx_transactions_recurring_transaction (recurring_transaction_id);
