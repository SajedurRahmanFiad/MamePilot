-- Add is_partial column to payroll_payments (TINYINT(1) DEFAULT 0) if not already present.
-- Existing rows default to 0 (full payment).
CALL sp_add_col('payroll_payments', 'is_partial', 'TINYINT(1) NOT NULL DEFAULT 0');
