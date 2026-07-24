-- Payment confirmation email settings and auto-calling recharge audit trail.
-- This migration is additive and does not modify existing business rows.

CREATE TABLE IF NOT EXISTS email_settings (
  id VARCHAR(64) NOT NULL,
  recipient_email VARCHAR(255) NULL,
  smtp_host VARCHAR(255) NULL,
  smtp_port INT NOT NULL DEFAULT 587,
  smtp_username VARCHAR(255) NULL,
  smtp_password VARCHAR(500) NULL,
  smtp_encryption VARCHAR(16) NOT NULL DEFAULT 'tls',
  sender_email VARCHAR(255) NULL,
  sender_name VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auto_calling_recharges (
  id VARCHAR(64) NOT NULL,
  local_reference VARCHAR(64) NULL,
  gateway_payment_id VARCHAR(255) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  status VARCHAR(32) NOT NULL DEFAULT 'processing',
  submitted_by VARCHAR(64) NULL,
  submitted_at DATETIME NULL,
  processed_at DATETIME NULL,
  raw_payload LONGTEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_auto_calling_recharges_reference (local_reference),
  KEY idx_recharges_status (status),
  KEY idx_recharges_gateway_payment (gateway_payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE auto_calling_recharges
  ADD COLUMN IF NOT EXISTS raw_payload LONGTEXT NULL;

CREATE INDEX IF NOT EXISTS idx_recharges_gateway_payment
  ON auto_calling_recharges (gateway_payment_id);

CREATE TABLE IF NOT EXISTS developer_notes (
  id VARCHAR(64) NOT NULL,
  content LONGTEXT NULL,
  updated_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
