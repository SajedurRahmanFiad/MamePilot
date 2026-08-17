-- Pathao handshake support: the merchant-integration webhook secret used by
-- courier-webhook.php to answer the Pathao webhook.integration handshake with
-- the X-Pathao-Merchant-Webhook-Integration-Secret response header. The code
-- referenced this column since v0.1.83 but no migration created it, which made
-- every courier settings save fail with "Unknown column" (HTTP 500).
ALTER TABLE `courier_settings`
  ADD COLUMN IF NOT EXISTS `pathao_merchant_webhook_secret` VARCHAR(500) NULL;
