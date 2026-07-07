-- Meta Ads Sync Cache Table
-- Stores the last sync results to avoid repeated API calls

CREATE TABLE IF NOT EXISTS meta_ads_sync_cache (
    id VARCHAR(36) PRIMARY KEY,
    sync_data LONGTEXT,
    last_synced_at DATETIME,
    sync_duration_ms INT,
    error_message LONGTEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX idx_meta_ads_sync_cache_synced_at ON meta_ads_sync_cache(last_synced_at DESC);
