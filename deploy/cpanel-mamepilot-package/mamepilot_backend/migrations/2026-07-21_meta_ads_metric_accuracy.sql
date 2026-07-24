-- Store purchase value alongside daily spend so selected-range ROAS is
-- calculated as total purchase value / total spend instead of averaging ads.
ALTER TABLE `meta_ads_insights_daily`
  ADD COLUMN IF NOT EXISTS `purchase_value` DECIMAL(16,4) NULL AFTER `conversions`,
  ADD COLUMN IF NOT EXISTS `purchase_roas` DECIMAL(14,6) NULL AFTER `purchase_value`;
