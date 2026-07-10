-- Grow Your Business: Recommendations cache + OpenRouter provider + Business Growth settings
-- Adds business_recommendations table for AI-generated product insights
-- Adds business_growth_settings table for dedicated AI config
-- Adds openrouter provider columns to agent_settings

CREATE TABLE IF NOT EXISTS business_recommendations (
  id VARCHAR(64) NOT NULL,
  recommendation_type VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description LONGTEXT NOT NULL,
  badge_color VARCHAR(16) NOT NULL DEFAULT 'green',
  priority INT NOT NULL DEFAULT 0,
  product_ids_json LONGTEXT NULL,
  metadata_json LONGTEXT NULL,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_business_recommendations_type (recommendation_type),
  KEY idx_business_recommendations_priority (priority),
  KEY idx_business_recommendations_generated (generated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_growth_settings (
  id VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL DEFAULT 'openai',
  openai_base_url VARCHAR(500) NULL,
  openai_api_key VARCHAR(500) NULL,
  openai_model VARCHAR(255) NULL,
  anthropic_base_url VARCHAR(500) NULL,
  anthropic_api_key VARCHAR(500) NULL,
  anthropic_model VARCHAR(255) NULL,
  google_base_url VARCHAR(500) NULL,
  google_api_key VARCHAR(500) NULL,
  google_model VARCHAR(255) NULL,
  openrouter_base_url VARCHAR(500) NULL,
  openrouter_api_key VARCHAR(500) NULL,
  openrouter_model VARCHAR(255) NULL,
  groq_base_url VARCHAR(500) NULL,
  groq_api_key VARCHAR(500) NULL,
  groq_model VARCHAR(255) NULL,
  recommendation_cache_hours INT NOT NULL DEFAULT 6,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `agent_settings`
  ADD COLUMN IF NOT EXISTS `openrouter_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `openrouter_base_url` VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS `openrouter_api_key` VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS `openrouter_model` VARCHAR(255) NULL;
