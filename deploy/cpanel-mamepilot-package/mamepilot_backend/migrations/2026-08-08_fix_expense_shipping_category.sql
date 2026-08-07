-- Fix: merge orphaned 'expense_shipping' category into the real 'Shipping Costs' category
--
-- Problem: The system hardcoded category id 'expense_shipping' but on some deployments
-- the actual 'Shipping Costs' category has a different id. This caused automatic courier
-- expenses to be filed under the orphan id while manual user entries used the real id,
-- splitting shipping cost calculations across two categories.
--
-- This migration reassigns all 'expense_shipping' references to the real category.

-- Reassign transactions
UPDATE transactions
SET category = (
    SELECT id FROM categories
    WHERE name = 'Shipping Costs' AND type = 'Expense'
    LIMIT 1
)
WHERE category = 'expense_shipping'
  AND EXISTS (
    SELECT 1 FROM categories
    WHERE name = 'Shipping Costs' AND type = 'Expense'
  );

-- Update courier_settings per-courier defaults
UPDATE courier_settings
SET steadfast_default_expense_category_id = (
    SELECT id FROM categories WHERE name = 'Shipping Costs' AND type = 'Expense' LIMIT 1
)
WHERE steadfast_default_expense_category_id = 'expense_shipping'
  AND EXISTS (SELECT 1 FROM categories WHERE name = 'Shipping Costs' AND type = 'Expense');

UPDATE courier_settings
SET carrybee_default_expense_category_id = (
    SELECT id FROM categories WHERE name = 'Shipping Costs' AND type = 'Expense' LIMIT 1
)
WHERE carrybee_default_expense_category_id = 'expense_shipping'
  AND EXISTS (SELECT 1 FROM categories WHERE name = 'Shipping Costs' AND type = 'Expense');

UPDATE courier_settings
SET paperfly_default_expense_category_id = (
    SELECT id FROM categories WHERE name = 'Shipping Costs' AND type = 'Expense' LIMIT 1
)
WHERE paperfly_default_expense_category_id = 'expense_shipping'
  AND EXISTS (SELECT 1 FROM categories WHERE name = 'Shipping Costs' AND type = 'Expense');

UPDATE courier_settings
SET pathao_default_expense_category_id = (
    SELECT id FROM categories WHERE name = 'Shipping Costs' AND type = 'Expense' LIMIT 1
)
WHERE pathao_default_expense_category_id = 'expense_shipping'
  AND EXISTS (SELECT 1 FROM categories WHERE name = 'Shipping Costs' AND type = 'Expense');

-- Clean up orphaned 'expense_shipping' row if nothing references it anymore
DELETE FROM categories
WHERE id = 'expense_shipping'
  AND NOT EXISTS (SELECT 1 FROM transactions WHERE category = 'expense_shipping')
  AND NOT EXISTS (SELECT 1 FROM courier_settings WHERE steadfast_default_expense_category_id = 'expense_shipping')
  AND NOT EXISTS (SELECT 1 FROM courier_settings WHERE carrybee_default_expense_category_id = 'expense_shipping')
  AND NOT EXISTS (SELECT 1 FROM courier_settings WHERE paperfly_default_expense_category_id = 'expense_shipping')
  AND NOT EXISTS (SELECT 1 FROM courier_settings WHERE pathao_default_expense_category_id = 'expense_shipping');
