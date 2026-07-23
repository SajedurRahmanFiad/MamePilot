-- Lead intelligence, multimodal model profiles, analysis history, and realtime events.

CREATE TABLE IF NOT EXISTS multimodal_llm_configurations (
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
  system_prompt LONGTEXT NULL,
  temperature DECIMAL(5,3) NOT NULL DEFAULT 0.100,
  max_tokens INT NOT NULL DEFAULT 4096,
  supports_vision TINYINT(1) NOT NULL DEFAULT 1,
  supports_audio TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_multimodal_llm_enabled (enabled)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS multimodal_llm_assignments (
  id VARCHAR(32) NOT NULL,
  configuration_id VARCHAR(64) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT fk_multimodal_assignment_configuration FOREIGN KEY (configuration_id) REFERENCES multimodal_llm_configurations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_profiles (
  id VARCHAR(64) NOT NULL,
  source_channel VARCHAR(32) NOT NULL,
  messenger_contact_id VARCHAR(64) NULL,
  whatsapp_contact_id VARCHAR(64) NULL,
  assigned_model_id VARCHAR(64) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'new',
  stage VARCHAR(32) NOT NULL DEFAULT 'new',
  score DECIMAL(5,2) NOT NULL DEFAULT 0,
  order_probability DECIMAL(5,2) NOT NULL DEFAULT 0,
  profile_json LONGTEXT NOT NULL,
  last_analyzed_message_id VARCHAR(255) NULL,
  last_message_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_lead_messenger_contact (messenger_contact_id),
  UNIQUE KEY uq_lead_whatsapp_contact (whatsapp_contact_id),
  KEY idx_leads_updated (updated_at),
  KEY idx_leads_status_score (status, score),
  CONSTRAINT fk_lead_model FOREIGN KEY (assigned_model_id) REFERENCES multimodal_llm_configurations(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_analysis_runs (
  id VARCHAR(64) NOT NULL,
  lead_id VARCHAR(64) NOT NULL,
  trigger_message_id VARCHAR(255) NULL,
  model_id VARCHAR(64) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'queued',
  result_json LONGTEXT NULL,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_lead_runs_lead_time (lead_id, created_at),
  CONSTRAINT fk_lead_runs_lead FOREIGN KEY (lead_id) REFERENCES lead_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_suggestions (
  id VARCHAR(64) NOT NULL,
  lead_id VARCHAR(64) NOT NULL,
  analysis_run_id VARCHAR(64) NULL,
  suggestion_type VARCHAR(32) NOT NULL,
  text LONGTEXT NOT NULL,
  reason TEXT NULL,
  confidence DECIMAL(5,2) NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'available',
  sent_message_id VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lead_suggestions_lead_status (lead_id, status, created_at),
  CONSTRAINT fk_lead_suggestions_lead FOREIGN KEY (lead_id) REFERENCES lead_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lead_id VARCHAR(64) NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload_json LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lead_events_cursor (id),
  KEY idx_lead_events_lead (lead_id, id),
  CONSTRAINT fk_lead_events_lead FOREIGN KEY (lead_id) REFERENCES lead_profiles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
