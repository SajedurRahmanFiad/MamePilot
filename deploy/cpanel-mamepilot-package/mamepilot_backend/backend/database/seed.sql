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
INSERT INTO batch_event_types (id, name, description, is_system, requires_population_change, requires_expense_amount, requires_account_id, requires_payment_method, requires_notes, stock_adjustment_direction)
VALUES
  ('stocking',        'Stocking',        'New birds added to the batch',              1, 1, 0, 0, 0, 0, 'increase'),
  ('mortality',       'Mortality',       'Bird deaths in the batch',                 1, 1, 0, 0, 0, 1, 'decrease'),
  ('sale',            'Sale',            'Birds sold from the batch',                1, 1, 1, 0, 0, 1, 'decrease'),
  ('feeding_cost',    'Feeding Cost',    'Feed expense for the batch',               1, 0, 1, 1, 1, 1, 'none'),
  ('vaccination',     'Vaccination',     'Vaccination administered to the batch',    1, 0, 1, 1, 1, 1, 'none'),
  ('health_treatment','Health Treatment','Medication or treatment for the batch',    1, 0, 1, 1, 1, 1, 'none'),
  ('weight_check',    'Weight Check',    'Record batch weight measurement',          1, 0, 0, 0, 0, 1, 'none'),
  ('transfer_in',     'Transfer In',     'Birds transferred into this batch',        1, 1, 0, 0, 0, 1, 'increase'),
  ('transfer_out',    'Transfer Out',    'Birds transferred out of this batch',      1, 1, 0, 0, 0, 1, 'decrease'),
  ('other',           'Other',           'Miscellaneous batch event',                1, 0, 0, 0, 0, 1, 'none')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description);

