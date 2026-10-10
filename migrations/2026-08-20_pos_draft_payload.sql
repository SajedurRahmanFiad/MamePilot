
CREATE TABLE IF NOT EXISTS `pos_drafts` (
  `id` VARCHAR(64) NOT NULL,
  `user_id` VARCHAR(64) NOT NULL,
  `items` JSON NOT NULL,
  `note` TEXT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_pos_drafts_user` (`user_id`),
  CONSTRAINT `fk_pos_drafts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE `pos_drafts`
  ADD COLUMN IF NOT EXISTS `data` JSON NULL AFTER `note`;