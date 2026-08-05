-- Meta Embedded Signup / WhatsApp Business app Coexistence state.
-- Secrets remain server-side; these columns retain connection and sync state.

ALTER TABLE whatsapp_settings
  ADD COLUMN platform_type VARCHAR(32) NULL AFTER quality_rating,
  ADD COLUMN is_on_biz_app TINYINT(1) NULL AFTER platform_type,
  ADD COLUMN connection_status VARCHAR(32) NOT NULL DEFAULT 'disconnected' AFTER is_on_biz_app,
  ADD COLUMN contacts_sync_request_id VARCHAR(255) NULL AFTER connection_status,
  ADD COLUMN contacts_sync_requested_at DATETIME NULL AFTER contacts_sync_request_id,
  ADD COLUMN history_sync_request_id VARCHAR(255) NULL AFTER contacts_sync_requested_at,
  ADD COLUMN history_sync_requested_at DATETIME NULL AFTER history_sync_request_id,
  ADD COLUMN last_webhook_at DATETIME NULL AFTER history_sync_requested_at;
