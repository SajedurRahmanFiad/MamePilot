-- Add is_system column to categories table to mark fixed system categories
ALTER TABLE categories ADD COLUMN is_system BOOLEAN DEFAULT FALSE NOT NULL;

-- Mark the three fixed categories as system categories
UPDATE categories SET is_system = TRUE WHERE id IN ('income_sales', 'expense_purchases', 'expense_shipping');
