-- ============================================================
-- Meta Ads sync: add auto-sync support table and cooldown tracking
-- Run this migration on existing databases before deploying.
-- ============================================================

CREATE TABLE IF NOT EXISTS meta_ads_sync_cache (
  id VARCHAR(36) PRIMARY KEY,
  sync_data LONGTEXT,
  last_synced_at DATETIME,
  last_manual_sync_at DATETIME DEFAULT NULL,
  sync_duration_ms INT,
  error_message LONGTEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX IF NOT EXISTS idx_meta_ads_sync_cache_synced_at ON meta_ads_sync_cache(last_synced_at DESC);

-- For existing tables that are missing the new column:
ALTER TABLE meta_ads_sync_cache ADD COLUMN IF NOT EXISTS last_manual_sync_at DATETIME DEFAULT NULL;
