-- Persist the normalized courier-history response used by Customer Trust
-- Details and Order Details. These additions are nullable and row-preserving.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS fraud_check_result LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS fraud_check_percentage DECIMAL(5,2) NULL,
  ADD COLUMN IF NOT EXISTS fraud_check_phone VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS fraud_checked_at DATETIME NULL;
