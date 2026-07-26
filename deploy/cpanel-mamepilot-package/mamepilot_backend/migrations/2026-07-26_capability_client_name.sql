-- Persist the central-license client name locally so Developer Subscriptions
-- can restore the field after a reload without depending on a live API call.
ALTER TABLE `app_capability_settings`
  ADD COLUMN IF NOT EXISTS `client_name` VARCHAR(255) NULL;
