-- Central LLM profiles, per-feature model assignments, and Be smart controls.

CREATE TABLE IF NOT EXISTS llm_configurations (
  id VARCHAR(64) NOT NULL,
  label VARCHAR(191) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  base_url VARCHAR(500) NULL,
  api_key TEXT NULL,
  model VARCHAR(255) NOT NULL,
  organization VARCHAR(255) NULL,
  project VARCHAR(255) NULL,
  site_url VARCHAR(500) NULL,
  app_name VARCHAR(255) NULL,
  anthropic_version VARCHAR(32) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_llm_configurations_provider_enabled (provider, enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS llm_feature_assignments (
  feature_key VARCHAR(64) NOT NULL,
  configuration_id VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (feature_key),
  KEY idx_llm_feature_assignments_configuration (configuration_id),
  CONSTRAINT fk_llm_feature_assignments_configuration
    FOREIGN KEY (configuration_id) REFERENCES llm_configurations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS be_smart_settings (
  id VARCHAR(64) NOT NULL,
  smart_customer_adding TINYINT(1) NOT NULL DEFAULT 0,
  smart_vendor_adding TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
