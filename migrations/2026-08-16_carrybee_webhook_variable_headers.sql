-- CarryBee webhook headers follow the Pathao pattern: the signature
-- verification header name (X-Carrybee-Webhook-Signature), and the
-- integration-handshake response header name and value
-- (X-CB-Webhook-Integration-Header / 40489fe0-9386-4fc9-8e92-2b2fcb9d451c)
-- must remain configurable because CarryBee may change either.
ALTER TABLE `courier_settings`
  ADD COLUMN IF NOT EXISTS `carrybee_webhook_header` VARCHAR(128) NULL,
  ADD COLUMN IF NOT EXISTS `carrybee_webhook_integration_header` VARCHAR(128) NULL,
  ADD COLUMN IF NOT EXISTS `carrybee_webhook_integration_value` VARCHAR(500) NULL;