-- Per-dashboard choice for how order-related KPI cards apply the dashboard
-- datetime filter:
--   'created_at' (default): orders created within the selected period.
--   'status_at': orders whose status action (delivered, picked, paid, ...)
--                happened within the selected period, mirroring the orders
--                page "Order Status" filter which compares against the
--                status_at timestamp columns.
ALTER TABLE dashboard_configurations
  ADD COLUMN IF NOT EXISTS order_kpi_time_basis VARCHAR(20) NOT NULL DEFAULT 'created_at' AFTER widgets;