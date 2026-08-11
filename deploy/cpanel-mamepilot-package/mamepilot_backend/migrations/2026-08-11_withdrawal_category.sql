-- Add system expense category for withdrawals.
INSERT INTO categories (id, name, type, color, is_system)
VALUES ('expense_withdrawal', 'Withdrawal', 'Expense', '#DB2777', TRUE)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  type = VALUES(type),
  color = VALUES(color),
  is_system = TRUE;
