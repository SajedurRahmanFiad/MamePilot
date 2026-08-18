-- Low-stock dashboard widget threshold. Products and batches at or below
-- this stock/population amount are listed by the Low Stock Products widget.
CALL sp_add_col('system_defaults', 'low_stock_threshold', 'INT NOT NULL DEFAULT 10');