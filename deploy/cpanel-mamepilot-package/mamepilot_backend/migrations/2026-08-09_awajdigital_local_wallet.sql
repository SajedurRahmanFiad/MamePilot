-- Keep AwajDigital wallet and pricing local to each deployment.
ALTER TABLE voice_survey_settings
  ADD COLUMN IF NOT EXISTS balance DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER webhook_url,
  ADD COLUMN IF NOT EXISTS pulse_seconds INT NOT NULL DEFAULT 60 AFTER balance,
  ADD COLUMN IF NOT EXISTS taka_per_pulse DECIMAL(12,4) NOT NULL DEFAULT 0.5500 AFTER pulse_seconds,
  ADD COLUMN IF NOT EXISTS recharge_notification_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER taka_per_pulse;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS survey_duration_seconds INT NOT NULL DEFAULT 0 AFTER survey_call_status,
  ADD COLUMN IF NOT EXISTS survey_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER survey_duration_seconds;
