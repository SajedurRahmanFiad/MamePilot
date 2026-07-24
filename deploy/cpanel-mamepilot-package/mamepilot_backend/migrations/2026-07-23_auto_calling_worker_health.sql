-- Make the auto-calling queue observable without changing existing business rows.

ALTER TABLE voice_survey_settings
  ADD COLUMN IF NOT EXISTS cron_last_success_at DATETIME NULL AFTER cron_last_run,
  ADD COLUMN IF NOT EXISTS cron_last_error TEXT NULL AFTER cron_last_success_at,
  ADD COLUMN IF NOT EXISTS cron_last_processed_count INT NOT NULL DEFAULT 0 AFTER cron_last_error;
