-- Add vaccine product detail fields to existing installations.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS manufacturer VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS batch_lot_number VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS expiry_date DATE NULL,
  ADD COLUMN IF NOT EXISTS recommended_dose_sequence TEXT NULL,
  ADD COLUMN IF NOT EXISTS notes TEXT NULL;
