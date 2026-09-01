-- Per-user unit_amount for commission/hybrid compensation (falls back to global payroll_settings.unit_amount)
ALTER TABLE users
  ADD COLUMN unit_amount DECIMAL(12,2) NULL AFTER fixed_salary;
