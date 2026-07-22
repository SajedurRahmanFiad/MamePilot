-- Repair the Auto Calling settings persistence and event timeline schema.
-- This migration is additive and does not modify existing business rows.

ALTER TABLE voice_survey_settings
  ADD COLUMN IF NOT EXISTS webhook_url VARCHAR(1000) NULL AFTER webhook_secret;

CREATE TABLE IF NOT EXISTS voice_survey_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id VARCHAR(64) NOT NULL,
  survey_id VARCHAR(64) NULL,
  event_type VARCHAR(32) NOT NULL,
  call_status VARCHAR(32) NULL,
  response VARCHAR(32) NULL,
  details TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_voice_survey_events_order_created (order_id, created_at),
  KEY idx_voice_survey_events_survey_id (survey_id),
  CONSTRAINT fk_voice_survey_events_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
