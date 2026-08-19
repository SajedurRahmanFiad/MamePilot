-- Steadfast return_status notifications no longer cancel the order. They only
-- mean the return flow has started, so the order is flagged action-required
-- (courier_return_action_required) instead of being auto-cancelled; real
-- status transitions are applied only from delivery_status notifications.
ALTER TABLE `orders`
  ADD COLUMN IF NOT EXISTS `courier_return_action_required` TINYINT(1) NOT NULL DEFAULT 0;