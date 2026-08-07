CREATE TABLE IF NOT EXISTS dashboard_configurations (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 0,
  system_key VARCHAR(20) NULL,
  kpi_cards LONGTEXT NOT NULL,
  widgets LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE KEY uq_dashboard_configurations_name (name),
  UNIQUE KEY uq_dashboard_configurations_system_key (system_key),
  KEY idx_dashboard_configurations_is_system (is_system)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE role_permissions
  ADD COLUMN dashboard_id VARCHAR(64) NULL AFTER permissions,
  ADD KEY idx_role_permissions_dashboard_id (dashboard_id);
