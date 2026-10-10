CREATE TABLE IF NOT EXISTS external_api_keys (
  id VARCHAR(64) NOT NULL,
  label VARCHAR(100) NOT NULL,
  key_prefix VARCHAR(32) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  created_by VARCHAR(64) NULL,
  scopes JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  revoked_at DATETIME NULL,
  last_used_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_external_api_keys_prefix (key_prefix),
  KEY idx_external_api_keys_creator (created_by, revoked_at),
  KEY idx_external_api_keys_expiry (expires_at, revoked_at),
  CONSTRAINT fk_external_api_keys_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;