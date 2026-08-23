-- Add smart selection settings for order and bill forms.

ALTER TABLE be_smart_settings
  ADD COLUMN smart_order_customer_selection TINYINT(1) NOT NULL DEFAULT 0 AFTER smart_vendor_adding,
  ADD COLUMN smart_bill_vendor_selection TINYINT(1) NOT NULL DEFAULT 0 AFTER smart_order_customer_selection;
