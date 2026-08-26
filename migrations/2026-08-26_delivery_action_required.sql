-- Add delivery_action_required column to support pending_delivered workflow
-- When auto shipping cost deduction is enabled, orders awaiting manual delivery
-- confirmation are set to 'pending_delivered' with this flag = 1.

ALTER TABLE orders ADD COLUMN delivery_action_required TINYINT(1) NOT NULL DEFAULT 0;

-- Update the order_status_summary view to include delivery_action_required
CREATE OR REPLACE VIEW order_status_summary AS
SELECT
    status,
    COUNT(*) AS order_count,
    COALESCE(SUM(total), 0) AS total_amount,
    COALESCE(SUM(paid_amount), 0) AS paid_amount,
    MAX(created_at) AS latest_created_at
FROM orders
WHERE deleted_at IS NULL
GROUP BY status;

-- Update the order_lifecycle_view to include delivery_action_required
CREATE OR REPLACE VIEW order_lifecycle_view AS
SELECT
    o.id,
    o.order_number,
    o.status,
    o.total,
    o.paid_amount,
    o.created_at,
    o.partial_delivery_action_required,
    o.courier_return_action_required,
    o.delivery_action_required,
    c.name AS customer_name
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id
WHERE o.deleted_at IS NULL;
