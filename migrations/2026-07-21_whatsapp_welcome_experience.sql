-- Background WhatsApp welcome experience.
-- The server sends this automatically after a customer's first message.

ALTER TABLE whatsapp_settings
  ADD COLUMN welcome_message TEXT NULL AFTER quality_rating,
  ADD COLUMN get_started_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER welcome_message,
  ADD COLUMN ice_breakers_json LONGTEXT NULL AFTER get_started_enabled;

ALTER TABLE whatsapp_contacts
  ADD COLUMN welcome_sent_at DATETIME NULL AFTER last_message_at;

CREATE INDEX idx_whatsapp_contacts_welcome_sent ON whatsapp_contacts (welcome_sent_at);
