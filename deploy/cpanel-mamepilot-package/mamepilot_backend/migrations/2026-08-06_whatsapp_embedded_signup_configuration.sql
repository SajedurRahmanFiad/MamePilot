-- Developer-owned Meta Embedded Signup configuration.
-- Provider secrets remain server-side and are never returned to the browser.

ALTER TABLE whatsapp_settings
  ADD COLUMN embedded_signup_app_id VARCHAR(64) NULL AFTER business_account_id,
  ADD COLUMN embedded_signup_config_id VARCHAR(64) NULL AFTER embedded_signup_app_id,
  ADD COLUMN webhook_url VARCHAR(500) NULL AFTER app_secret;
