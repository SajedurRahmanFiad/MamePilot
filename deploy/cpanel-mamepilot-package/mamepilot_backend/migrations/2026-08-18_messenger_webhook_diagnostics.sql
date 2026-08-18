-- Messenger webhook delivery diagnostics.
-- Tracks whether Meta is actually delivering webhook events so setup
-- problems (signature failures, page-id mismatches) are visible in Settings.

ALTER TABLE messenger_settings
  ADD COLUMN webhook_events_received INT NOT NULL DEFAULT 0,
  ADD COLUMN webhook_events_processed INT NOT NULL DEFAULT 0,
  ADD COLUMN last_webhook_at DATETIME NULL,
  ADD COLUMN last_webhook_status VARCHAR(500) NULL;
