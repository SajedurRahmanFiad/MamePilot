-- Ensure multi-rule vaccine dosage JSON is not truncated on existing products.
ALTER TABLE products
  MODIFY COLUMN recommended_dose_sequence TEXT NULL;