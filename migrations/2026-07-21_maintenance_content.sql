-- Add dynamic maintenance page content and an optional automatic expiry.
ALTER TABLE `app_capability_settings`
  ADD COLUMN IF NOT EXISTS `maintenance_image_url` VARCHAR(1000) NULL,
  ADD COLUMN IF NOT EXISTS `maintenance_caption` VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS `maintenance_subtitle` TEXT NULL,
  ADD COLUMN IF NOT EXISTS `maintenance_explanation` TEXT NULL,
  ADD COLUMN IF NOT EXISTS `maintenance_ends_at` DATETIME NULL;
