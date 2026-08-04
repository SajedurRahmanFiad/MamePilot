-- Add product selection mode setting for order/bill product dropdowns.

CALL sp_add_col('system_defaults', 'product_selection_mode', 'VARCHAR(16) NOT NULL DEFAULT ''simple''');
