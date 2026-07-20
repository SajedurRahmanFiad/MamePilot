-- Auto Calling System (AwajDigital Voice Survey)
-- Adds voice survey columns to orders table and creates voice_survey_settings table.
-- Uses webhooks for survey result delivery (not polling).

-- Voice survey settings table
CREATE TABLE IF NOT EXISTS voice_survey_settings (
  id VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  delay_minutes INT NOT NULL DEFAULT 5,
  api_token TEXT NULL,
  sender VARCHAR(64) NULL,
  template_name VARCHAR(191) NULL,
  webhook_secret VARCHAR(255) NULL,
  max_survey_time_seconds INT NOT NULL DEFAULT 120,
  missed_call_retry_minutes INT NOT NULL DEFAULT 30,
  missed_call_retry_count INT NOT NULL DEFAULT 3,
  no_key_retry_minutes INT NOT NULL DEFAULT 10,
  no_key_retry_count INT NOT NULL DEFAULT 2,
  trigger_statuses TEXT NULL,
  cron_last_run DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE voice_survey_settings
  ADD COLUMN IF NOT EXISTS trigger_statuses TEXT NULL;

-- Survey columns on orders table
ALTER TABLE `orders`
  ADD COLUMN `survey_id` VARCHAR(64) NULL,
  ADD COLUMN `survey_status` VARCHAR(32) NULL DEFAULT NULL,
  ADD COLUMN `survey_response` VARCHAR(16) NULL,
  ADD COLUMN `survey_call_status` VARCHAR(32) NULL,
  ADD COLUMN `confirmation_status` VARCHAR(32) NULL,
  ADD COLUMN `survey_result_fetch_at` DATETIME NULL,
  ADD COLUMN `survey_next_retry_at` DATETIME NULL,
  ADD COLUMN `survey_retry_count` INT NOT NULL DEFAULT 0,
  ADD COLUMN `survey_last_retry_reason` VARCHAR(32) NULL,
  ADD COLUMN `survey_last_retry_at` DATETIME NULL,
  ADD COLUMN `survey_triggered_at` DATETIME NULL;

CREATE INDEX idx_orders_survey_status ON orders (survey_status);
CREATE INDEX idx_orders_confirmation_status ON orders (confirmation_status);
CREATE INDEX idx_orders_survey_next_retry_at ON orders (survey_next_retry_at);
