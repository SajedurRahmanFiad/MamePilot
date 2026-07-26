-- Keep the resolved tier selectable locally and control upgrade-feature visibility per deployment.
-- Additive only: existing deployments continue showing available features by default.

ALTER TABLE `app_capability_settings`
  ADD COLUMN IF NOT EXISTS `tier_key` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `show_inactive_subscription_features` TINYINT(1) NOT NULL DEFAULT 1;
