-- MamePilot seed data file.
-- Use only for fresh installs or when intentionally refreshing defaults.

INSERT INTO payment_methods (id, name, description, is_active)
VALUES
  ('cash', 'Cash', 'Cash payment', 1),
  ('card', 'Card', 'Credit or debit card', 1),
  ('bank_transfer', 'Bank Transfer', 'Bank transfer or wire', 1),
  ('cheque', 'Cheque', 'Cheque payment', 1),
  ('digital_wallet', 'Digital Wallet', 'Digital wallet (Nagad, Bkash, etc.)', 1)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  is_active = VALUES(is_active);
INSERT INTO units (id, name, short_name, description)
VALUES
  ('piece', 'Piece', 'pc', NULL),
  ('kilogram', 'Kilogram', 'kg', NULL),
  ('gram', 'Gram', 'g', NULL),
  ('liter', 'Liter', 'L', NULL),
  ('milliliter', 'Milliliter', 'ml', NULL),
  ('meter', 'Meter', 'm', NULL),
  ('centimeter', 'Centimeter', 'cm', NULL),
  ('box', 'Box', 'box', NULL),
  ('pack', 'Pack', 'pack', NULL),
  ('dozen', 'Dozen', 'dz', NULL)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  short_name = VALUES(short_name),
  description = VALUES(description);
INSERT INTO categories (id, name, type, color, parent_id)
VALUES
  ('income_sales', 'Sales', 'Income', '#10B981', NULL),
  ('income_services', 'Services', 'Income', '#3B82F6', NULL),
  ('income_other', 'Other Income', 'Income', '#8B5CF6', NULL),
  ('expense_purchases', 'Purchases', 'Expense', '#EF4444', NULL),
  ('expense_payroll', 'Payroll', 'Expense', '#0F766E', NULL),
  ('expense_utilities', 'Utilities', 'Expense', '#F59E0B', NULL),
  ('expense_salaries', 'Salaries', 'Expense', '#EC4899', NULL),
  ('expense_rent', 'Rent', 'Expense', '#6366F1', NULL),
  ('expense_shipping', 'Shipping Costs', 'Expense', '#F97316', NULL),
  ('expense_other', 'Other Expense', 'Expense', '#6B7280', NULL),
  ('product_electronics', 'Electronics', 'Product', '#3B82F6', NULL),
  ('product_clothing', 'Clothing', 'Product', '#EC4899', NULL),
  ('product_food', 'Food & Beverage', 'Product', '#10B981', NULL),
  ('product_other', 'Other Products', 'Product', '#8B5CF6', NULL)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  color = VALUES(color),
  parent_id = VALUES(parent_id);
INSERT INTO company_settings (id, name, phone, email, address, logo)
VALUES ('company-default', 'MamePilot', '+880', 'info@mamepilot.com', '', '/uploads/Full Branding.png')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  phone = VALUES(phone),
  email = VALUES(email),
  address = VALUES(address),
  logo = VALUES(logo);
INSERT INTO order_settings (id, prefix, next_number)
VALUES ('order-default', 'ORD-', 1)
ON DUPLICATE KEY UPDATE
  prefix = VALUES(prefix);
INSERT INTO invoice_settings (id, title, logo_width, logo_height, footer)
VALUES ('invoice-default', 'Invoice', 120, 120, 'Thank you for choosing MamePilot!')
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  logo_width = VALUES(logo_width),
  logo_height = VALUES(logo_height),
  footer = VALUES(footer);
INSERT INTO system_defaults (id, records_per_page, white_label, theme_color)
VALUES ('defaults-default', 10, 0, '#294b57')
ON DUPLICATE KEY UPDATE
  records_per_page = VALUES(records_per_page),
  white_label = VALUES(white_label),
  theme_color = VALUES(theme_color);
INSERT INTO courier_settings (
  id,
  steadfast_enabled,
  carrybee_enabled,
  paperfly_max_weight_kg
)
VALUES ('courier-default', 0, 0, 0.300)
ON DUPLICATE KEY UPDATE
  paperfly_max_weight_kg = VALUES(paperfly_max_weight_kg);
INSERT INTO payroll_settings (id, singleton, unit_amount, counted_statuses)
VALUES (
  'payroll-default',
  1,
  0.00,
  '["On Hold","Processing","Picked","Completed","Cancelled"]'
)
ON DUPLICATE KEY UPDATE
  counted_statuses = COALESCE(payroll_settings.counted_statuses, VALUES(counted_statuses));
INSERT INTO service_subscription_items (id, name, description, amount, is_optional, is_active, display_order, system_key)
VALUES
  ('service-item-db-hosting', 'Database hosting', NULL, NULL, 0, 1, 10, 'database-hosting'),
  ('service-item-caching', 'Caching (Redis, in-memory stores)', NULL, NULL, 0, 1, 20, 'caching'),
  ('service-item-auth', 'Auth', NULL, NULL, 0, 1, 30, 'auth'),
  ('service-item-cdn', 'CDN', NULL, NULL, 0, 1, 40, 'cdn'),
  ('service-item-load-balancer', 'Load balancer', NULL, NULL, 0, 1, 50, 'load-balancer'),
  ('service-item-maintenance', 'Maintenance cost', NULL, NULL, 1, 1, 60, 'maintenance-cost')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  amount = VALUES(amount),
  is_optional = VALUES(is_optional),
  is_active = VALUES(is_active),
  display_order = VALUES(display_order),
  system_key = VALUES(system_key);
INSERT INTO service_subscription_methods (id, name, description, is_active, display_order)
VALUES
  ('service-method-nagad', 'Nagad', 'Primary renewal payment method', 1, 10)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  is_active = VALUES(is_active),
  display_order = VALUES(display_order);
INSERT INTO users (id, name, phone, role, image, password_hash, created_at, updated_at)
VALUES ('developer-1', 'Developer', '01404020000', 'Developer', NULL, '$2y$12$S83k2T8iMEi9uJP83IQqJeTulzW2OVd5w64nJlxht85zx8z6AWhPy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  phone = VALUES(phone),
  role = VALUES(role),
  password_hash = VALUES(password_hash),
  updated_at = VALUES(updated_at);

