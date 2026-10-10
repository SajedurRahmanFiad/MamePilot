ALTER TABLE external_api_keys
  ADD COLUMN IF NOT EXISTS rate_window_started_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS rate_count INT UNSIGNED NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS external_api_request_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  key_id VARCHAR(64) NULL,
  resource VARCHAR(32) NOT NULL,
  request_method VARCHAR(10) NOT NULL,
  response_status SMALLINT UNSIGNED NOT NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_external_api_request_logs_key_time (key_id, occurred_at),
  KEY idx_external_api_request_logs_time_status (occurred_at, response_status),
  CONSTRAINT fk_external_api_request_logs_key FOREIGN KEY (key_id) REFERENCES external_api_keys (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;