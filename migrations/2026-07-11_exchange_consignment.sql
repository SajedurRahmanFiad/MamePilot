-- Exchange consignment tracking
-- Adds columns to store courier consignment details for exchange shipments.
-- When items are exchanged, replacement items need a separate courier consignment
-- to be shipped back to the customer.

ALTER TABLE orders
  ADD COLUMN exchange_courier TEXT,
  ADD COLUMN exchange_steadfast_consignment_id TEXT,
  ADD COLUMN exchange_carrybee_consignment_id TEXT,
  ADD COLUMN exchange_paperfly_tracking_number TEXT,
  ADD COLUMN exchange_courier_history TEXT;

-- New status value: 'Exchange pending'
-- Used when an exchange has been processed but the replacement items
-- haven't been shipped via courier yet.
-- This is a valid status in the OrderStatus enum and is handled by:
--   - Timeline UI in OrderDetails
--   - Courier sync (syncExchangeConsignmentStatuses)
--   - processOrderReturnExchange backend method
