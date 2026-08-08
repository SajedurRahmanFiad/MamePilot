-- Additive indexes for stable, indexed list pagination at production scale.
-- Existing indexes and columns are intentionally retained for rollback safety.

ALTER TABLE `users`
  ADD INDEX IF NOT EXISTS `idx_users_active_created_id` (`deleted_at`, `is_system`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_users_active_role_name_id` (`deleted_at`, `is_system`, `role`, `name`, `id`);

ALTER TABLE `customers`
  ADD INDEX IF NOT EXISTS `idx_customers_active_created_id` (`deleted_at`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_customers_active_creator_created_id` (`deleted_at`, `created_by`, `created_at`, `id`);

ALTER TABLE `vendors`
  ADD INDEX IF NOT EXISTS `idx_vendors_active_created_id` (`deleted_at`, `created_at`, `id`);

ALTER TABLE `products`
  ADD COLUMN IF NOT EXISTS `slug` VARCHAR(255) NULL,
  ADD INDEX IF NOT EXISTS `idx_products_active_created_id` (`deleted_at`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_products_active_category_created_id` (`deleted_at`, `category`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_products_active_creator_created_id` (`deleted_at`, `created_by`, `created_at`, `id`);

ALTER TABLE `orders`
  ADD INDEX IF NOT EXISTS `idx_orders_active_created_id` (`deleted_at`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_orders_active_status_created_id` (`deleted_at`, `status`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_orders_active_creator_created_id` (`deleted_at`, `created_by`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_orders_active_customer_created_id` (`deleted_at`, `customer_id`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_orders_active_source_ad_created_id` (`deleted_at`, `source_ad`, `created_at`, `id`);

ALTER TABLE `bills`
  ADD INDEX IF NOT EXISTS `idx_bills_active_created_id` (`deleted_at`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_bills_active_status_created_id` (`deleted_at`, `status`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_bills_active_creator_created_id` (`deleted_at`, `created_by`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_bills_active_vendor_created_id` (`deleted_at`, `vendor_id`, `created_at`, `id`);

ALTER TABLE `transactions`
  ADD INDEX IF NOT EXISTS `idx_transactions_active_created_id` (`deleted_at`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_transactions_active_date_id` (`deleted_at`, `date`, `id`),
  ADD INDEX IF NOT EXISTS `idx_transactions_active_type_created_id` (`deleted_at`, `type`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_transactions_active_approval_created_id` (`deleted_at`, `approval_status`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_transactions_active_creator_created_id` (`deleted_at`, `created_by`, `created_at`, `id`);

ALTER TABLE `lead_profiles`
  ADD INDEX IF NOT EXISTS `idx_leads_active_updated_id` (`archived_at`, `updated_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_leads_active_status_updated_id` (`archived_at`, `status`, `updated_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_leads_active_channel_updated_id` (`archived_at`, `source_channel`, `updated_at`, `id`);

ALTER TABLE `notifications`
  ADD INDEX IF NOT EXISTS `idx_notifications_active_updated_id` (`is_active`, `updated_at`, `id`);

ALTER TABLE `notification_receipts`
  ADD INDEX IF NOT EXISTS `idx_notification_receipts_user_updated` (`user_id`, `updated_at`, `notification_id`);

ALTER TABLE `whatsapp_contacts`
  ADD INDEX IF NOT EXISTS `idx_whatsapp_contacts_last_message_id` (`last_message_at`, `updated_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_whatsapp_contacts_unread_last_message_id` (`unread_count`, `last_message_at`, `id`);

ALTER TABLE `whatsapp_messages`
  ADD INDEX IF NOT EXISTS `idx_whatsapp_messages_contact_time_id` (`contact_id`, `message_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_whatsapp_messages_contact_updated_id` (`contact_id`, `updated_at`, `id`);

ALTER TABLE `messenger_contacts`
  ADD INDEX IF NOT EXISTS `idx_messenger_contacts_last_message_id` (`last_message_at`, `updated_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_messenger_contacts_unread_last_message_id` (`unread_count`, `last_message_at`, `id`);

ALTER TABLE `messenger_messages`
  ADD INDEX IF NOT EXISTS `idx_messenger_messages_contact_time_id` (`contact_id`, `message_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_messenger_messages_contact_updated_id` (`contact_id`, `updated_at`, `id`);

ALTER TABLE `meta_ads`
  ADD INDEX IF NOT EXISTS `idx_meta_ads_status_updated_id` (`effective_status`, `updated_time`, `id`),
  ADD INDEX IF NOT EXISTS `idx_meta_ads_account_updated_id` (`ad_account_id`, `updated_time`, `id`),
  ADD INDEX IF NOT EXISTS `idx_meta_ads_business_updated_id` (`business_id`, `updated_time`, `id`),
  ADD INDEX IF NOT EXISTS `idx_meta_ads_campaign_updated_id` (`campaign_id`, `updated_time`, `id`);

ALTER TABLE `wallet_entries`
  ADD INDEX IF NOT EXISTS `idx_wallet_entries_employee_created_id` (`employee_id`, `created_at`, `id`),
  ADD INDEX IF NOT EXISTS `idx_wallet_entries_employee_type_order` (`employee_id`, `entry_type`, `source_order_id`, `created_at`, `id`);

ALTER TABLE `payroll_payments`
  ADD INDEX IF NOT EXISTS `idx_payroll_payments_type_employee_paid_id` (`compensation_type`, `employee_id`, `paid_at`, `id`);

ALTER TABLE `recurring_transactions`
  ADD INDEX IF NOT EXISTS `idx_recurring_active_next_run_id` (`is_active`, `next_run_at`, `id`);
