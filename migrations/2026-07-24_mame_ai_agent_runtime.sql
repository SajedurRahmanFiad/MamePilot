-- Durable provider-neutral Mame AI agent runtime.
-- Idempotent and row-preserving for fresh installs and upgrades.

ALTER TABLE `llm_configurations`
  ADD COLUMN IF NOT EXISTS `supports_tool_calling` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `supports_structured_output` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `supports_vision` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `supports_audio` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `context_window_tokens` INT NOT NULL DEFAULT 32768,
  ADD COLUMN IF NOT EXISTS `default_output_tokens` INT NOT NULL DEFAULT 4096;

ALTER TABLE `agent_settings`
  ADD COLUMN IF NOT EXISTS `query_max_columns` INT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS `query_max_bytes` INT NOT NULL DEFAULT 100000,
  ADD COLUMN IF NOT EXISTS `run_timeout_seconds` INT NOT NULL DEFAULT 240,
  ADD COLUMN IF NOT EXISTS `context_budget_tokens` INT NOT NULL DEFAULT 12000,
  ADD COLUMN IF NOT EXISTS `max_output_tokens` INT NOT NULL DEFAULT 4096,
  ADD COLUMN IF NOT EXISTS `retry_limit` INT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS `confirmation_expiry_minutes` INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS `lease_seconds` INT NOT NULL DEFAULT 90,
  ADD COLUMN IF NOT EXISTS `worker_last_heartbeat` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `worker_last_success_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `worker_last_error_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `worker_last_error` TEXT NULL;

ALTER TABLE `agent_conversations`
  ADD COLUMN IF NOT EXISTS `summary` LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS `summary_boundary_message_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `summary_updated_at` DATETIME NULL;

ALTER TABLE `agent_runs`
  ADD COLUMN IF NOT EXISTS `active_conversation_key` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `route` VARCHAR(32) NULL,
  ADD COLUMN IF NOT EXISTS `routed_domains_json` LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS `fast_configuration_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `reasoning_configuration_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `multimodal_configuration_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `worker_id` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `lease_expires_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `heartbeat_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `attempts` INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `cancellation_requested_at` DATETIME NULL,
  ADD COLUMN IF NOT EXISTS `cancellation_reason` TEXT NULL,
  ADD COLUMN IF NOT EXISTS `current_activity` VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS `tool_call_count` INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `model_call_count` INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `input_tokens` BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `output_tokens` BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `event_sequence` INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `attachment_ids_json` LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS `resume_payload_json` LONGTEXT NULL,
  ADD UNIQUE KEY IF NOT EXISTS `uq_agent_runs_active_conversation` (`active_conversation_key`),
  ADD KEY IF NOT EXISTS `idx_agent_runs_queue_lease` (`status`, `lease_expires_at`, `created_at`),
  ADD KEY IF NOT EXISTS `idx_agent_runs_worker` (`worker_id`, `lease_expires_at`);

UPDATE agent_runs r
SET r.event_sequence = (
  SELECT COALESCE(MAX(e.sequence_no), 0)
  FROM agent_run_events e
  WHERE e.run_id = r.id
)
WHERE r.event_sequence = 0;

ALTER TABLE `agent_messages`
  ADD COLUMN IF NOT EXISTS `attachment_ids_json` LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS `structured_reference_json` LONGTEXT NULL;

ALTER TABLE `agent_tool_calls`
  ADD COLUMN IF NOT EXISTS `provider_call_id` VARCHAR(191) NULL,
  ADD COLUMN IF NOT EXISTS `tool_version` VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  ADD COLUMN IF NOT EXISTS `risk_class` VARCHAR(32) NOT NULL DEFAULT 'read',
  ADD COLUMN IF NOT EXISTS `error_message` TEXT NULL,
  ADD COLUMN IF NOT EXISTS `confirmation_bundle_id` VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD UNIQUE KEY IF NOT EXISTS `uq_agent_tool_calls_provider_id` (`run_id`, `provider_call_id`),
  ADD KEY IF NOT EXISTS `idx_agent_tool_calls_status` (`run_id`, `status`);

ALTER TABLE `agent_run_events`
  ADD UNIQUE KEY IF NOT EXISTS `uq_agent_run_events_sequence` (`run_id`, `sequence_no`),
  ADD KEY IF NOT EXISTS `idx_agent_run_events_cursor` (`run_id`, `sequence_no`, `created_at`);

ALTER TABLE `agent_db_query_audit`
  ADD COLUMN IF NOT EXISTS `allowed_datasets_json` LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS `returned_columns_json` LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS `decision` VARCHAR(32) NOT NULL DEFAULT 'allowed',
  ADD COLUMN IF NOT EXISTS `error_message` TEXT NULL;

CREATE TABLE IF NOT EXISTS agent_action_bundles (
  id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  immutable_hash CHAR(64) NOT NULL,
  confirmation_token_hash CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  expires_at DATETIME NOT NULL,
  confirmed_by VARCHAR(64) NULL,
  confirmed_at DATETIME NULL,
  rejected_at DATETIME NULL,
  rejection_reason TEXT NULL,
  execution_started_at DATETIME NULL,
  execution_finished_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_action_bundles_run (run_id, created_at),
  KEY idx_agent_action_bundles_user_status (user_id, status, expires_at),
  CONSTRAINT fk_agent_action_bundles_run FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_action_bundles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_agent_action_bundles_confirmer FOREIGN KEY (confirmed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_action_items (
  id VARCHAR(64) NOT NULL,
  bundle_id VARCHAR(64) NOT NULL,
  position_no INT NOT NULL,
  tool_name VARCHAR(191) NOT NULL,
  tool_version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
  dependencies_json LONGTEXT NULL,
  input_json LONGTEXT NOT NULL,
  preview_json LONGTEXT NULL,
  idempotency_key CHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  result_json LONGTEXT NULL,
  error_message TEXT NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_agent_action_items_position (bundle_id, position_no),
  UNIQUE KEY uq_agent_action_items_idempotency (idempotency_key),
  KEY idx_agent_action_items_status (bundle_id, status),
  CONSTRAINT fk_agent_action_items_bundle FOREIGN KEY (bundle_id) REFERENCES agent_action_bundles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_attachments (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  storage_path VARCHAR(1000) NOT NULL,
  mime_type VARCHAR(191) NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  sha256_hash CHAR(64) NOT NULL,
  retention_state VARCHAR(32) NOT NULL DEFAULT 'active',
  deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_attachments_user (user_id, retention_state, created_at),
  CONSTRAINT fk_agent_attachments_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_model_calls (
  id VARCHAR(64) NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  phase VARCHAR(64) NOT NULL,
  profile_id VARCHAR(64) NULL,
  provider VARCHAR(32) NULL,
  model VARCHAR(255) NULL,
  provider_request_id VARCHAR(255) NULL,
  finish_reason VARCHAR(64) NULL,
  input_tokens INT NOT NULL DEFAULT 0,
  output_tokens INT NOT NULL DEFAULT 0,
  duration_ms INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_model_calls_run (run_id, created_at),
  KEY idx_agent_model_calls_profile (profile_id, created_at),
  CONSTRAINT fk_agent_model_calls_run FOREIGN KEY (run_id) REFERENCES agent_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
