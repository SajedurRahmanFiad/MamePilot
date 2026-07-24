-- Daily Meta ads insights for range-accurate marketing dashboard metrics.
CREATE TABLE IF NOT EXISTS meta_ads_insights_daily (
  id VARCHAR(64) NOT NULL,
  ad_id VARCHAR(64) NOT NULL,
  meta_ad_id VARCHAR(64) NOT NULL,
  insight_date DATE NOT NULL,
  spend DECIMAL(14,4) NOT NULL DEFAULT 0,
  impressions INT NOT NULL DEFAULT 0,
  reach INT NOT NULL DEFAULT 0,
  clicks INT NOT NULL DEFAULT 0,
  ctr DECIMAL(12,6) DEFAULT NULL,
  cpc DECIMAL(14,4) DEFAULT NULL,
  cpm DECIMAL(14,4) DEFAULT NULL,
  conversions DECIMAL(14,4) DEFAULT NULL,
  currency VARCHAR(16) DEFAULT NULL,
  synced_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_meta_ads_insights_daily_ad_date (ad_id, insight_date),
  KEY idx_meta_ads_insights_daily_date (insight_date),
  KEY idx_meta_ads_insights_daily_meta_ad (meta_ad_id),
  KEY idx_meta_ads_insights_daily_ad_date (ad_id, insight_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
