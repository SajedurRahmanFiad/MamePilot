CREATE TABLE IF NOT EXISTS chat_push_subscriptions (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  endpoint_hash CHAR(64) NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh_key VARCHAR(255) NOT NULL,
  auth_secret VARCHAR(255) NOT NULL,
  messenger_enabled TINYINT(1) NOT NULL DEFAULT 0,
  whatsapp_enabled TINYINT(1) NOT NULL DEFAULT 0,
  last_seen_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chat_push_user_endpoint (user_id, endpoint_hash),
  KEY idx_chat_push_messenger_enabled (messenger_enabled),
  KEY idx_chat_push_whatsapp_enabled (whatsapp_enabled),
  CONSTRAINT fk_chat_push_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS chat_push_deliveries (
  id VARCHAR(64) NOT NULL,
  subscription_id VARCHAR(64) NOT NULL,
  channel VARCHAR(16) NOT NULL,
  message_id VARCHAR(255) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'queued',
  detail VARCHAR(1000) NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_chat_push_delivery_message (subscription_id, channel, message_id),
  KEY idx_chat_push_deliveries_status (status, created_at),
  CONSTRAINT fk_chat_push_delivery_subscription FOREIGN KEY (subscription_id) REFERENCES chat_push_subscriptions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;