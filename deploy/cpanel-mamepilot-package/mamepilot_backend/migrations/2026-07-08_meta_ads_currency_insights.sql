-- Meta Ads: Display Currency Settings + Insights Cache
-- Adds currency display configuration to meta_ads_settings
-- Adds per-ad insights breakdown cache table

-- Settings table with currency fields (created if missing, or columns added if table exists)
CREATE TABLE IF NOT EXISTS meta_ads_settings (
  id VARCHAR(64) NOT NULL,
  app_id VARCHAR(255) DEFAULT NULL,
  app_secret VARCHAR(500) DEFAULT NULL,
  redirect_uri VARCHAR(500) DEFAULT NULL,
  login_config_id VARCHAR(255) DEFAULT NULL,
  graph_version VARCHAR(64) DEFAULT NULL,
  oauth_scopes VARCHAR(500) DEFAULT NULL,
  display_currency_code VARCHAR(8) DEFAULT 'BDT',
  display_currency_rate_to_bdt DECIMAL(14,4) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insights cache: stores daily, demographics, placements, devices breakdowns
CREATE TABLE IF NOT EXISTS meta_ads_insights_cache (
  id VARCHAR(36) PRIMARY KEY,
  ad_id VARCHAR(64) NOT NULL,
  category VARCHAR(32) NOT NULL,
  data_json LONGTEXT,
  last_synced_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_insights_ad_category (ad_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS idx_meta_ads_insights_cache_ad ON meta_ads_insights_cache(ad_id);