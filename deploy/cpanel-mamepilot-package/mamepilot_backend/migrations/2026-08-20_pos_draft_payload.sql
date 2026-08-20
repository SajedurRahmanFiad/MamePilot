-- POS drafts persist the full transaction state (customer, items, discount
-- mode/value, VAT rate, notes, payment allocation, received amount) as a
-- JSON envelope in the new `data` column.

ALTER TABLE `pos_drafts`
  ADD COLUMN IF NOT EXISTS `data` JSON NULL AFTER `note`;