-- Product units and dynamic pricing upgrade compatibility.
-- These columns were added to the fresh-install table definitions in v0.0.52,
-- but existing installations also need explicit additive DDL.

ALTER TABLE `units`
  ADD COLUMN IF NOT EXISTS `is_fraction` TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE `products`
  ADD COLUMN IF NOT EXISTS `unit_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `dynamic_pricing` LONGTEXT NULL;
