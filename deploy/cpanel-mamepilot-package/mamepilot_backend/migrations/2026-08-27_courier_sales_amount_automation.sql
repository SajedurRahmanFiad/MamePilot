-- When the courier "Delivered" event arrives through a webhook or via the
-- API polling fallback, gate the order transition on these two settings:
--
--   * automatically_deduct_shipping_costs: ship the courier's delivery fee
--     as an automatic expense on completion.
--   * automatically_record_sales_income: ship the courier's collected COD
--     as automatic income on completion.
--
-- When BOTH are on AND the order is in `Picked` and the courier reports
-- `Delivered`, the order lands in `pending_delivered` with
-- `delivery_action_required = 1` so a user must confirm before the
-- financial transactions post. When either is off, the order jumps
-- straight to `Completed` using whatever the webhook/poll payload already
-- provides (COD + shipping fee) and books the transactions immediately.
ALTER TABLE `courier_settings`
  ADD COLUMN IF NOT EXISTS `automatically_record_sales_income` TINYINT(1) NOT NULL DEFAULT 0;
