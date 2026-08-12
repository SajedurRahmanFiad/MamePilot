-- Seed default batch event types.
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
