-- Add exchange rate mode support to meta_ads_settings
-- Allows fixed rate (manual) or VAT-based rate (real-time market rate + VAT percentage)

ALTER TABLE meta_ads_settings
  ADD COLUMN exchange_rate_mode VARCHAR(16) NOT NULL DEFAULT 'fixed',
  ADD COLUMN vat_percentage DECIMAL(5,2) DEFAULT NULL,
  ADD COLUMN realtime_rate_cache DECIMAL(14,4) DEFAULT NULL,
  ADD COLUMN realtime_rate_updated_at DATETIME DEFAULT NULL;
