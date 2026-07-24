-- Meta WhatsApp Cloud API inbox.
-- Message transport comes from Meta; these tables retain webhook-delivered history for the inbox UI.

CREATE TABLE IF NOT EXISTS whatsapp_settings (
  id VARCHAR(64) NOT NULL,
  access_token TEXT NULL,
  phone_number_id VARCHAR(64) NULL,
  business_account_id VARCHAR(64) NULL,
  verify_token VARCHAR(255) NULL,
  app_secret VARCHAR(500) NULL,
  graph_version VARCHAR(16) NOT NULL DEFAULT 'v25.0',
  display_phone_number VARCHAR(64) NULL,
  verified_name VARCHAR(191) NULL,
  quality_rating VARCHAR(32) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS whatsapp_contacts (
  id VARCHAR(64) NOT NULL,
  wa_id VARCHAR(32) NOT NULL,
  phone_number VARCHAR(32) NOT NULL,
  name VARCHAR(191) NULL,
  profile_name VARCHAR(191) NULL,
  unread_count INT NOT NULL DEFAULT 0,
  last_message_preview VARCHAR(500) NULL,
  last_message_type VARCHAR(32) NULL,
  last_message_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_contacts_wa_id (wa_id),
  KEY idx_whatsapp_contacts_last_message_at (last_message_at),
  KEY idx_whatsapp_contacts_unread (unread_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id VARCHAR(64) NOT NULL,
  contact_id VARCHAR(64) NOT NULL,
  wa_message_id VARCHAR(255) NULL,
  direction VARCHAR(16) NOT NULL,
  message_type VARCHAR(32) NOT NULL DEFAULT 'text',
  message_text LONGTEXT NULL,
  caption TEXT NULL,
  media_id VARCHAR(255) NULL,
  media_url VARCHAR(500) NULL,
  media_mime_type VARCHAR(127) NULL,
  file_name VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'received',
  error_code VARCHAR(64) NULL,
  error_message TEXT NULL,
  reply_to_message_id VARCHAR(255) NULL,
  payload_json LONGTEXT NULL,
  message_at DATETIME NOT NULL,
  created_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_whatsapp_messages_wa_message_id (wa_message_id),
  KEY idx_whatsapp_messages_contact_time (contact_id, message_at),
  KEY idx_whatsapp_messages_status (status),
  CONSTRAINT fk_whatsapp_messages_contact FOREIGN KEY (contact_id) REFERENCES whatsapp_contacts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
