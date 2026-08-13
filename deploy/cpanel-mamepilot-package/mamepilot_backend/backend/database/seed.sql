-- MamePilot seed data file.
-- Safe to re-run: insert missing fresh-install defaults without changing existing rows.

INSERT INTO payment_methods (id, name, description, is_active)
VALUES
  ('cash', 'Cash', 'Cash payment', 1),
  ('bank_transfer', 'Bank Transfer', 'Bank transfer or wire', 1),
  ('bkash', 'bKash', 'Mobile Banking', 1),
  ('nagad', 'Nagad', 'Mobile Banking', 1),
  ('rocket', 'Rocket', 'Mobile Banking', 1),
  ('upay', 'Upay', 'Mobile Banking', 1)
ON DUPLICATE KEY UPDATE
  id = id;
INSERT INTO units (id, name, short_name, description)
VALUES
  ('piece', 'Piece', 'pc', NULL),
  ('kilogram', 'Kilogram', 'kg', NULL),
  ('gram', 'Gram', 'g', NULL),
  ('liter', 'Liter', 'L', NULL),
  ('box', 'Box', 'box', NULL)
ON DUPLICATE KEY UPDATE
  id = id;
INSERT INTO categories (id, name, type, color, parent_id, is_system)
VALUES
  ('income_sales', 'Sales', 'Income', '#10B981', NULL, 1),
  ('income_other', 'Other Income', 'Income', '#8B5CF6', NULL, 0),
  ('expense_purchases', 'Purchases', 'Expense', '#EF4444', NULL, 1),
  ('expense_payroll', 'Payroll', 'Expense', '#0F766E', NULL, 0),
  ('expense_shipping', 'Shipping Costs', 'Expense', '#F97316', NULL, 1),
  ('expense_withdrawal', 'Withdrawal', 'Expense', '#DB2777', NULL, 1),
  ('expense_other', 'Other Expense', 'Expense', '#6B7280', NULL, 0),
  ('product_other', 'General', 'Product', '#8B5CF6', NULL, 0)
ON DUPLICATE KEY UPDATE
  id = id;
INSERT INTO company_settings (id, name, phone, email, address, logo)
VALUES ('company-default', 'MamePilot', '+880', 'info@mamepilot.com', '', '/uploads/Full Branding.png')
ON DUPLICATE KEY UPDATE
  id = id;
INSERT INTO order_settings (id, prefix, next_number)
VALUES ('order-default', 'ORD-', 1)
ON DUPLICATE KEY UPDATE
  id = id;
INSERT INTO invoice_settings (id, title, logo_width, logo_height, footer)
VALUES ('invoice-default', 'Invoice', 120, 120, 'Thank you for choosing MamePilot!')
ON DUPLICATE KEY UPDATE
  id = id;
INSERT INTO system_defaults (id, records_per_page, white_label, theme_color)
VALUES ('defaults-default', 10, 0, '#294b57')
ON DUPLICATE KEY UPDATE
  id = id;
INSERT INTO courier_settings (
  id,
  steadfast_enabled,
  carrybee_enabled,
  paperfly_max_weight_kg
)
VALUES ('courier-default', 0, 0, 0.300)
ON DUPLICATE KEY UPDATE
  id = id;
INSERT INTO payroll_settings (id, singleton, unit_amount, counted_statuses)
VALUES (
  'payroll-default',
  1,
  0.00,
  '["On Hold","Processing","Picked","Completed","Cancelled"]'
)
ON DUPLICATE KEY UPDATE
  id = id;
INSERT INTO service_subscription_items (id, name, description, amount, is_optional, is_active, display_order, system_key)
VALUES
  ('service-item-db-hosting', 'Database hosting', NULL, NULL, 0, 1, 10, 'database-hosting'),
  ('service-item-caching', 'Caching (Redis, in-memory stores)', NULL, NULL, 0, 1, 20, 'caching'),
  ('service-item-auth', 'Auth', NULL, NULL, 0, 1, 30, 'auth'),
  ('service-item-cdn', 'CDN', NULL, NULL, 0, 1, 40, 'cdn'),
  ('service-item-load-balancer', 'Load balancer', NULL, NULL, 0, 1, 50, 'load-balancer'),
  ('service-item-maintenance', 'Maintenance cost', NULL, NULL, 1, 1, 60, 'maintenance-cost')
ON DUPLICATE KEY UPDATE
  id = id;
INSERT INTO service_subscription_methods (id, name, description, is_active, display_order)
VALUES
  ('service-method-nagad', 'Nagad', 'Primary renewal payment method', 1, 10)
ON DUPLICATE KEY UPDATE
  id = id;
INSERT INTO users (id, name, phone, role, image, password_hash, created_at, updated_at)
VALUES ('developer-1', 'Fiad', '01404020000', 'Developer', NULL, '$2y$12$S83k2T8iMEi9uJP83IQqJeTulzW2OVd5w64nJlxht85zx8z6AWhPy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON DUPLICATE KEY UPDATE
  id = id;

