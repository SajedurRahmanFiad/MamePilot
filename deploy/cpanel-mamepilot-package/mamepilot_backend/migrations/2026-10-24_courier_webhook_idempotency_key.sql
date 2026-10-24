ALTER TABLE `courier_webhook_events`
  ADD COLUMN IF NOT EXISTS `idempotency_key` VARCHAR(255) NULL;